import { pino } from 'pino';
import { z } from 'zod';
import { KVRequest, KVResponse, ErrorCodes, ClientConnection } from '../types.js';
import { baseRequestSchema, methodSchemas } from './schema.js';
import { IdempotencyCache } from './idempotency.js';
import { NamespaceManager } from '../namespacing/ns.js';
import { RateLimiter } from '../limits/rate.js';
import { BudgetManager } from '../limits/budget.js';
import { Validator } from '../limits/validate.js';
import { KVAdapter } from '../redis/kv.js';
import { AuditLogger } from '../audit/audit.js';
import { DMCrypto } from '../crypto/dm.js';

const logger = pino({ name: 'protocol-router' });

export class ProtocolRouter {
  private idempotencyCache: IdempotencyCache;
  private namespaceManager: NamespaceManager;
  private rateLimiter: RateLimiter;
  private budgetManager: BudgetManager;
  private validator: Validator;
  private kvAdapter: KVAdapter;
  private auditLogger: AuditLogger;
  private dmCrypto: DMCrypto;

  constructor(
    kvAdapter: KVAdapter,
    auditLogger: AuditLogger,
    dmCrypto: DMCrypto,
    namespace: string
  ) {
    this.idempotencyCache = new IdempotencyCache();
    this.namespaceManager = new NamespaceManager(namespace);
    this.rateLimiter = new RateLimiter();
    this.budgetManager = new BudgetManager();
    this.validator = new Validator();
    this.kvAdapter = kvAdapter;
    this.auditLogger = auditLogger;
    this.dmCrypto = dmCrypto;
  }

  async handleRequest(
    request: KVRequest,
    connection: ClientConnection
  ): Promise<KVResponse> {
    const startTime = Date.now();
    
    try {
      // Validate base request structure
      const validatedRequest = baseRequestSchema.parse(request);
      
      // Check idempotency cache
      const cached = this.idempotencyCache.get(connection.pubkey, validatedRequest.id);
      if (cached) {
        return cached;
      }

      // Check if method is allowed
      if (!connection.allowedMethods.includes(validatedRequest.method)) {
        return this.errorResponse(
          validatedRequest.id,
          ErrorCodes.RESTRICTED,
          `Method ${validatedRequest.method} not allowed`
        );
      }

      // Check rate limits
      if (!this.rateLimiter.checkLimit(connection)) {
        return this.errorResponse(
          validatedRequest.id,
          ErrorCodes.RATE_LIMITED,
          'Rate limit exceeded'
        );
      }

      // Check byte budget
      const requestSize = JSON.stringify(request).length;
      if (!this.budgetManager.checkBudget(connection, requestSize)) {
        return this.errorResponse(
          validatedRequest.id,
          ErrorCodes.RATE_LIMITED,
          'Byte budget exceeded'
        );
      }

      // Route to method handler
      let response: KVResponse;
      
      switch (validatedRequest.method) {
        case 'get_info':
          response = await this.handleGetInfo(validatedRequest, connection);
          break;
        case 'get':
          response = await this.handleGet(validatedRequest, connection);
          break;
        case 'set':
          response = await this.handleSet(validatedRequest, connection);
          break;
        case 'del':
          response = await this.handleDel(validatedRequest, connection);
          break;
        case 'exists':
          response = await this.handleExists(validatedRequest, connection);
          break;
        case 'mget':
          response = await this.handleMget(validatedRequest, connection);
          break;
        case 'expire':
          response = await this.handleExpire(validatedRequest, connection);
          break;
        case 'ttl':
          response = await this.handleTtl(validatedRequest, connection);
          break;
        default:
          response = this.errorResponse(
            validatedRequest.id,
            ErrorCodes.NOT_IMPLEMENTED,
            `Method ${validatedRequest.method} not implemented`
          );
      }

      // Cache response
      this.idempotencyCache.set(connection.pubkey, validatedRequest.id, response);

      // Update byte budget with response size
      const responseSize = JSON.stringify(response).length;
      this.budgetManager.consumeBudget(connection, responseSize);

      // Audit log
      const latency = Date.now() - startTime;
      await this.auditLogger.log({
        method: validatedRequest.method,
        keyHash: this.hashKey(validatedRequest.params.key || ''),
        valueSize: validatedRequest.params.value?.length || 0,
        status: response.error ? 'error' : 'success',
        errorCode: response.error?.code,
        latency,
        clientPubkey: connection.pubkey
      });

      return response;

    } catch (error) {
      logger.error({ error, request }, 'Request handling error');
      return this.errorResponse(
        request.id,
        ErrorCodes.INTERNAL,
        'Internal server error'
      );
    }
  }

  private async handleGetInfo(request: KVRequest, connection: ClientConnection): Promise<KVResponse> {
    return {
      result: {
        methods: connection.allowedMethods,
        ns: connection.namespace,
        limits: {
          mps: connection.limits.mps,
          bps: connection.limits.bps,
          maxkey: connection.limits.maxKey,
          maxval: connection.limits.maxVal,
          mget_max: connection.limits.mgetMax
        },
        encryption: this.dmCrypto.getCapabilities()
      },
      error: null,
      id: request.id
    };
  }

  private async handleGet(request: KVRequest, connection: ClientConnection): Promise<KVResponse> {
    try {
      const params = methodSchemas.get.params.parse(request.params);
      
      // Validate key
      if (!this.validator.validateKey(params.key, connection.limits.maxKey)) {
        return this.errorResponse(request.id, ErrorCodes.INVALID_KEY, 'Key too long or invalid');
      }

      // Ensure namespace
      const fullKey = this.namespaceManager.ensureNamespace(params.key);
      if (!fullKey) {
        return this.errorResponse(request.id, ErrorCodes.RESTRICTED, 'Key outside namespace');
      }

      const value = await this.kvAdapter.get(fullKey);
      
      return {
        result: { value },
        error: null,
        id: request.id
      };
    } catch (error) {
      logger.error({ error }, 'Error in handleGet');
      return this.errorResponse(request.id, ErrorCodes.INTERNAL, 'Failed to get value');
    }
  }

  private async handleSet(request: KVRequest, connection: ClientConnection): Promise<KVResponse> {
    try {
      const params = methodSchemas.set.params.parse(request.params);
      
      // Validate key and value
      if (!this.validator.validateKey(params.key, connection.limits.maxKey)) {
        return this.errorResponse(request.id, ErrorCodes.INVALID_KEY, 'Key too long or invalid');
      }
      
      if (!this.validator.validateValue(params.value, connection.limits.maxVal)) {
        return this.errorResponse(request.id, ErrorCodes.INVALID_VALUE, 'Value too large');
      }

      // Ensure namespace
      const fullKey = this.namespaceManager.ensureNamespace(params.key);
      if (!fullKey) {
        return this.errorResponse(request.id, ErrorCodes.RESTRICTED, 'Key outside namespace');
      }

      await this.kvAdapter.set(fullKey, params.value, params.ttl);
      
      return {
        result: { ok: true },
        error: null,
        id: request.id
      };
    } catch (error) {
      logger.error({ error }, 'Error in handleSet');
      return this.errorResponse(request.id, ErrorCodes.INTERNAL, 'Failed to set value');
    }
  }

  private async handleDel(request: KVRequest, connection: ClientConnection): Promise<KVResponse> {
    try {
      const params = methodSchemas.del.params.parse(request.params);
      
      if (!this.validator.validateKey(params.key, connection.limits.maxKey)) {
        return this.errorResponse(request.id, ErrorCodes.INVALID_KEY, 'Key too long or invalid');
      }

      const fullKey = this.namespaceManager.ensureNamespace(params.key);
      if (!fullKey) {
        return this.errorResponse(request.id, ErrorCodes.RESTRICTED, 'Key outside namespace');
      }

      const deleted = await this.kvAdapter.del(fullKey);
      
      return {
        result: { deleted },
        error: null,
        id: request.id
      };
    } catch (error) {
      logger.error({ error }, 'Error in handleDel');
      return this.errorResponse(request.id, ErrorCodes.INTERNAL, 'Failed to delete key');
    }
  }

  private async handleExists(request: KVRequest, connection: ClientConnection): Promise<KVResponse> {
    try {
      const params = methodSchemas.exists.params.parse(request.params);
      
      if (!this.validator.validateKey(params.key, connection.limits.maxKey)) {
        return this.errorResponse(request.id, ErrorCodes.INVALID_KEY, 'Key too long or invalid');
      }

      const fullKey = this.namespaceManager.ensureNamespace(params.key);
      if (!fullKey) {
        return this.errorResponse(request.id, ErrorCodes.RESTRICTED, 'Key outside namespace');
      }

      const exists = await this.kvAdapter.exists(fullKey);
      
      return {
        result: { exists },
        error: null,
        id: request.id
      };
    } catch (error) {
      logger.error({ error }, 'Error in handleExists');
      return this.errorResponse(request.id, ErrorCodes.INTERNAL, 'Failed to check existence');
    }
  }

  private async handleMget(request: KVRequest, connection: ClientConnection): Promise<KVResponse> {
    try {
      const params = methodSchemas.mget.params.parse(request.params);
      
      // Validate mget count
      if (!this.validator.validateMgetCount(params.keys.length, connection.limits.mgetMax)) {
        return this.errorResponse(request.id, ErrorCodes.PAYLOAD_TOO_LARGE, 'Too many keys in mget');
      }

      // Validate and namespace all keys
      const fullKeys: string[] = [];
      for (const key of params.keys) {
        if (!this.validator.validateKey(key, connection.limits.maxKey)) {
          return this.errorResponse(request.id, ErrorCodes.INVALID_KEY, `Key too long: ${key}`);
        }
        
        const fullKey = this.namespaceManager.ensureNamespace(key);
        if (!fullKey) {
          return this.errorResponse(request.id, ErrorCodes.RESTRICTED, `Key outside namespace: ${key}`);
        }
        
        fullKeys.push(fullKey);
      }

      const values = await this.kvAdapter.mget(fullKeys);
      
      return {
        result: { values },
        error: null,
        id: request.id
      };
    } catch (error) {
      logger.error({ error }, 'Error in handleMget');
      return this.errorResponse(request.id, ErrorCodes.INTERNAL, 'Failed to get multiple values');
    }
  }

  private async handleExpire(request: KVRequest, connection: ClientConnection): Promise<KVResponse> {
    try {
      const params = methodSchemas.expire.params.parse(request.params);
      
      if (!this.validator.validateKey(params.key, connection.limits.maxKey)) {
        return this.errorResponse(request.id, ErrorCodes.INVALID_KEY, 'Key too long or invalid');
      }

      const fullKey = this.namespaceManager.ensureNamespace(params.key);
      if (!fullKey) {
        return this.errorResponse(request.id, ErrorCodes.RESTRICTED, 'Key outside namespace');
      }

      const ok = await this.kvAdapter.expire(fullKey, params.ttl);
      
      return {
        result: { ok },
        error: null,
        id: request.id
      };
    } catch (error) {
      logger.error({ error }, 'Error in handleExpire');
      return this.errorResponse(request.id, ErrorCodes.INTERNAL, 'Failed to set expiration');
    }
  }

  private async handleTtl(request: KVRequest, connection: ClientConnection): Promise<KVResponse> {
    try {
      const params = methodSchemas.ttl.params.parse(request.params);
      
      if (!this.validator.validateKey(params.key, connection.limits.maxKey)) {
        return this.errorResponse(request.id, ErrorCodes.INVALID_KEY, 'Key too long or invalid');
      }

      const fullKey = this.namespaceManager.ensureNamespace(params.key);
      if (!fullKey) {
        return this.errorResponse(request.id, ErrorCodes.RESTRICTED, 'Key outside namespace');
      }

      const ttl = await this.kvAdapter.ttl(fullKey);
      
      return {
        result: { ttl },
        error: null,
        id: request.id
      };
    } catch (error) {
      logger.error({ error }, 'Error in handleTtl');
      return this.errorResponse(request.id, ErrorCodes.INTERNAL, 'Failed to get TTL');
    }
  }

  private errorResponse(id: string, code: string, message: string): KVResponse {
    return {
      result: null,
      error: { code, message },
      id
    };
  }

  private hashKey(key: string): string {
    // Simple hash for audit logging (not cryptographic)
    if (!key) return '';
    return Buffer.from(key).toString('base64').substring(0, 8);
  }

  destroy(): void {
    this.idempotencyCache.destroy();
  }
}