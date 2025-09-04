#!/usr/bin/env node
import 'websocket-polyfill';
import { pino } from 'pino';
import { Event, finalizeEvent, kinds } from 'nostr-tools';
import Redis from 'ioredis';
import { loadConfig } from './config.js';
import { Keyring } from './keys/keyring.js';
import { RelayPool } from './relays/relayPool.js';
import { DMCrypto } from './crypto/dm.js';
import { ProtocolRouter } from './protocol/router.js';
import { KVAdapter } from './redis/kv.js';
import { AuditLogger } from './audit/audit.js';
import { ClientConnection, KVRequest, KVResponse } from './types.js';
import { generateTestURI, displayConnectionInfo } from './admin/uri.js';
import fs from 'fs';
import path from 'path';

const logger = pino({ 
  name: 'nostrkv-server',
  transport: {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'SYS:standard',
      ignore: 'pid,hostname'
    }
  }
});

// Event kinds for NostrKV Connect (mirroring NIP-47)
const REQUEST_KIND = 23194;
const RESPONSE_KIND = 23195;

class NostrKVServer {
  private config = loadConfig();
  private keyring: Keyring;
  private relayPool: RelayPool;
  private dmCrypto: DMCrypto;
  private router: ProtocolRouter;
  private kvAdapter: KVAdapter;
  private auditLogger: AuditLogger;
  private redis: Redis;
  private connections: Map<string, ClientConnection> = new Map();
  private isShuttingDown = false;
  private testURI: string = '';

  constructor() {
    this.keyring = new Keyring(this.config.nostr.serverNsec);
    this.relayPool = new RelayPool(this.config.nostr.relays);
    this.dmCrypto = new DMCrypto(this.config.nostr.encryptionPref === 'nip44');
    this.kvAdapter = new KVAdapter(this.config.redis.url);
    this.redis = new Redis(this.config.redis.url);
    this.auditLogger = new AuditLogger(this.redis, this.config.redis.namespace);
    this.router = new ProtocolRouter(
      this.kvAdapter,
      this.auditLogger,
      this.dmCrypto
    );

    // Setup signal handlers
    process.on('SIGINT', () => this.shutdown());
    process.on('SIGTERM', () => this.shutdown());
  }

  async start(): Promise<void> {
    // Generate test URI
    this.testURI = generateTestURI(this.config, this.keyring);

    logger.info({ 
      serverPubkey: this.keyring.getPublicKey(),
      serverNpub: this.keyring.getNpub(),
      namespace: this.config.redis.namespace,
      relays: this.config.nostr.relays 
    }, 'Starting NostrKV Connect server');

    // Connect to relays
    await this.relayPool.connect();

    // Subscribe to encrypted DMs for this server
    const filters = [{
      kinds: [REQUEST_KIND],
      '#p': [this.keyring.getPublicKey()],
      since: Math.floor(Date.now() / 1000)
    }];

    this.relayPool.subscribe(filters, (event) => {
      this.handleIncomingEvent(event).catch(error => {
        logger.error({ error, eventId: event.id }, 'Error handling event');
      });
    });

    // Display connection info and test URI
    const webUrl = process.env.WEB_URL;
    displayConnectionInfo(this.config, this.keyring, this.testURI, webUrl);
  }

  getTestURI(): string {
    return this.testURI;
  }

  private async handleIncomingEvent(event: Event): Promise<void> {
    const startTime = Date.now();
    
    // Log every incoming Nostr event
    logger.info({
      eventId: event.id,
      eventKind: event.kind,
      clientPubkey: event.pubkey,
      clientShort: event.pubkey.substring(0, 8),
      createdAt: new Date(event.created_at * 1000).toISOString(),
      contentLength: event.content.length,
      tagsCount: event.tags?.length || 0,
      hasSignature: !!event.sig
    }, '📨 Received Nostr event');
    
    try {
      // Verify event signature
      if (!event.sig) {
        logger.warn({ eventId: event.id }, 'Event missing signature');
        return;
      }

      // Decrypt the content
      let decrypted: { decrypted: string; method: 'nip44' | 'nip04' };
      try {
        decrypted = await this.dmCrypto.decrypt(
          event.content,
          this.keyring.getSecretKey(),
          event.pubkey
        );
        logger.debug({
          eventId: event.id,
          encryptionMethod: decrypted.method,
          decryptedLength: decrypted.decrypted.length
        }, '🔓 Successfully decrypted event content');
      } catch (error) {
        logger.error({ error, eventId: event.id, clientShort: event.pubkey.substring(0, 8) }, '❌ Failed to decrypt event');
        return;
      }

      // Parse the request
      let request: KVRequest;
      try {
        request = JSON.parse(decrypted.decrypted);
        logger.info({
          eventId: event.id,
          method: request.method,
          requestId: request.id,
          hasParams: !!request.params,
          paramKeys: request.params ? Object.keys(request.params) : []
        }, '📋 Parsed NostrKV request');
      } catch (error) {
        logger.error({ 
          error, 
          eventId: event.id, 
          decryptedContent: decrypted.decrypted.substring(0, 100) + '...' 
        }, '❌ Invalid JSON in decrypted content');
        return;
      }

      logger.info({ 
        method: request.method,
        requestId: request.id,
        clientPubkey: event.pubkey.substring(0, 8),
        encryptionMethod: decrypted.method
      }, 'Processing request');

      // Get or create client connection
      let connection = this.connections.get(event.pubkey);
      if (!connection) {
        // Try to load from connection registry first
        connection = this.loadConnectionFromRegistry(event.pubkey);
        if (!connection) {
          // Create default connection for new clients
          connection = this.createDefaultConnection(event.pubkey);
          logger.info({
            clientPubkey: event.pubkey,
            clientShort: event.pubkey.substring(0, 8),
            namespace: connection.namespace,
            allowedMethods: connection.allowedMethods,
            source: 'default',
            totalConnections: this.connections.size + 1
          }, '🔑 New client connected with default settings');
        } else {
          logger.info({
            clientPubkey: event.pubkey,
            clientShort: event.pubkey.substring(0, 8),
            namespace: connection.namespace,
            allowedMethods: connection.allowedMethods,
            source: 'registry',
            totalConnections: this.connections.size + 1
          }, '🔑 New client connected with connection string');
        }
        this.connections.set(event.pubkey, connection);
      }

      // Handle the request
      const response = await this.router.handleRequest(request, connection);

      // Send response
      await this.sendResponse(response, event.pubkey);

      const latency = Date.now() - startTime;
      logger.info({ 
        method: request.method,
        requestId: request.id,
        latency,
        success: response.error === null
      }, 'Request completed');

    } catch (error) {
      logger.error({ error, eventId: event.id }, 'Unexpected error handling event');
    }
  }

  private loadConnectionFromRegistry(pubkey: string): ClientConnection | undefined {
    try {
      const registryPath = path.join(process.cwd(), '.nostrkv-connections.json');
      if (!fs.existsSync(registryPath)) {
        return undefined;
      }
      
      const content = fs.readFileSync(registryPath, 'utf8');
      const registry = JSON.parse(content);
      const registryEntry = registry[pubkey];
      
      if (!registryEntry) {
        return undefined;
      }
      
      return {
        pubkey,
        namespace: registryEntry.namespace,
        allowedMethods: registryEntry.allowedMethods,
        limits: registryEntry.limits
      };
    } catch (error) {
      logger.error({ error, pubkey: pubkey.substring(0, 8) }, 'Failed to load connection from registry');
      return undefined;
    }
  }

  private createDefaultConnection(pubkey: string): ClientConnection {
    return {
      pubkey,
      namespace: this.config.redis.namespace,
      allowedMethods: ['get_info', 'get', 'set', 'del', 'exists', 'mget', 'expire', 'ttl'],
      limits: {
        mps: this.config.limits.mps,
        bps: this.config.limits.bps,
        maxKey: this.config.limits.maxKey,
        maxVal: this.config.limits.maxVal,
        mgetMax: this.config.limits.mgetMax
      }
    };
  }

  private async sendResponse(response: KVResponse, recipientPubkey: string): Promise<void> {
    try {
      // Log outgoing response details
      logger.info({
        responseId: response.id,
        recipientShort: recipientPubkey.substring(0, 8),
        hasResult: response.result !== null,
        hasError: response.error !== null,
        errorCode: response.error?.code,
        resultType: typeof response.result
      }, '📤 Sending NostrKV response');

      // Encrypt the response
      const responseJson = JSON.stringify(response);
      const { encrypted } = await this.dmCrypto.encrypt(
        responseJson,
        this.keyring.getSecretKey(),
        recipientPubkey
      );

      // Create response event
      const responseEvent = {
        kind: RESPONSE_KIND,
        created_at: Math.floor(Date.now() / 1000),
        tags: [['p', recipientPubkey]],
        content: encrypted,
        pubkey: this.keyring.getPublicKey()
      };

      // Sign the event
      const signedEvent = finalizeEvent(responseEvent, this.keyring.getSecretKey());

      // Publish to relays
      await this.relayPool.publish(signedEvent);

      logger.info({ 
        responseId: response.id,
        eventId: signedEvent.id,
        recipientShort: recipientPubkey.substring(0, 8),
        encryptedLength: encrypted.length
      }, '✅ Response published to relays');

    } catch (error) {
      logger.error({ 
        error, 
        responseId: response.id,
        recipientShort: recipientPubkey.substring(0, 8)
      }, '❌ Failed to send response');
    }
  }

  /**
   * Add or update a client connection with specific permissions
   */
  addConnection(
    clientPubkey: string, 
    namespace: string,
    allowedMethods: string[],
    limits: ClientConnection['limits']
  ): void {
    const connection: ClientConnection = {
      pubkey: clientPubkey,
      namespace,
      allowedMethods,
      limits
    };
    
    this.connections.set(clientPubkey, connection);
    
    logger.info({ 
      clientPubkey: clientPubkey.substring(0, 8),
      namespace,
      methods: allowedMethods.length
    }, 'Connection added/updated');
  }

  /**
   * Remove a client connection
   */
  removeConnection(clientPubkey: string): void {
    this.connections.delete(clientPubkey);
    logger.info({ 
      clientPubkey: clientPubkey.substring(0, 8)
    }, 'Connection removed');
  }

  private async shutdown(): Promise<void> {
    if (this.isShuttingDown) return;
    this.isShuttingDown = true;

    logger.info('Shutting down server...');

    try {
      this.relayPool.close();
      this.router.destroy();
      await this.kvAdapter.close();
      await this.redis.quit();
      
      logger.info('Server shutdown complete');
      process.exit(0);
    } catch (error) {
      logger.error({ error }, 'Error during shutdown');
      process.exit(1);
    }
  }
}

// Start the server
async function main() {
  try {
    const server = new NostrKVServer();
    await server.start();
  } catch (error) {
    logger.error({ error }, 'Failed to start server');
    process.exit(1);
  }
}

main();