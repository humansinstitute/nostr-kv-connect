import Redis from 'ioredis';
import { pino } from 'pino';

const logger = pino({ name: 'audit' });

interface AuditEntry {
  method: string;
  keyHash: string;
  valueSize: number;
  status: 'success' | 'error';
  errorCode?: string;
  latency: number;
  clientPubkey: string;
  timestamp?: number;
}

export class AuditLogger {
  private redis: Redis;
  private namespace: string;
  private auditKey: string;
  private maxEntries: number = 10000; // Keep last 10k entries

  constructor(redis: Redis, namespace: string) {
    this.redis = redis;
    this.namespace = namespace;
    this.auditKey = `${namespace}__audit`;
  }

  /**
   * Log an audit entry
   */
  async log(entry: AuditEntry): Promise<void> {
    try {
      const auditRecord = {
        ...entry,
        timestamp: entry.timestamp || Date.now(),
        // Redact sensitive information
        clientPubkey: this.redactPubkey(entry.clientPubkey)
      };

      // Convert to JSON and push to Redis list
      const serialized = JSON.stringify(auditRecord);
      
      // Push to the head of the list
      await this.redis.lpush(this.auditKey, serialized);
      
      // Trim to keep only last N entries
      await this.redis.ltrim(this.auditKey, 0, this.maxEntries - 1);
      
      logger.debug({ 
        method: entry.method, 
        status: entry.status,
        latency: entry.latency 
      }, 'Audit entry logged');
      
    } catch (error) {
      // Don't fail operations if audit logging fails
      logger.error({ error }, 'Failed to log audit entry');
    }
  }

  /**
   * Get recent audit entries
   */
  async getRecent(count: number = 100): Promise<AuditEntry[]> {
    try {
      const entries = await this.redis.lrange(this.auditKey, 0, count - 1);
      
      return entries.map(entry => {
        try {
          return JSON.parse(entry);
        } catch {
          return null;
        }
      }).filter(entry => entry !== null) as AuditEntry[];
      
    } catch (error) {
      logger.error({ error }, 'Failed to get audit entries');
      return [];
    }
  }

  /**
   * Get audit statistics
   */
  async getStats(windowMs: number = 3600000): Promise<{
    totalRequests: number;
    successRate: number;
    errorCounts: Record<string, number>;
    methodCounts: Record<string, number>;
    avgLatency: number;
  }> {
    try {
      const cutoff = Date.now() - windowMs;
      const entries = await this.getRecent(1000);
      
      const recentEntries = entries.filter(e => e.timestamp && e.timestamp > cutoff);
      
      if (recentEntries.length === 0) {
        return {
          totalRequests: 0,
          successRate: 0,
          errorCounts: {},
          methodCounts: {},
          avgLatency: 0
        };
      }

      const totalRequests = recentEntries.length;
      const successCount = recentEntries.filter(e => e.status === 'success').length;
      const successRate = (successCount / totalRequests) * 100;
      
      const errorCounts: Record<string, number> = {};
      const methodCounts: Record<string, number> = {};
      let totalLatency = 0;
      
      for (const entry of recentEntries) {
        // Count methods
        methodCounts[entry.method] = (methodCounts[entry.method] || 0) + 1;
        
        // Count errors
        if (entry.errorCode) {
          errorCounts[entry.errorCode] = (errorCounts[entry.errorCode] || 0) + 1;
        }
        
        // Sum latency
        totalLatency += entry.latency || 0;
      }
      
      const avgLatency = totalLatency / totalRequests;
      
      return {
        totalRequests,
        successRate,
        errorCounts,
        methodCounts,
        avgLatency
      };
      
    } catch (error) {
      logger.error({ error }, 'Failed to get audit stats');
      return {
        totalRequests: 0,
        successRate: 0,
        errorCounts: {},
        methodCounts: {},
        avgLatency: 0
      };
    }
  }

  /**
   * Clear audit log
   */
  async clear(): Promise<void> {
    try {
      await this.redis.del(this.auditKey);
      logger.info('Audit log cleared');
    } catch (error) {
      logger.error({ error }, 'Failed to clear audit log');
    }
  }

  /**
   * Redact pubkey for privacy (show first/last 4 chars)
   */
  private redactPubkey(pubkey: string): string {
    if (pubkey.length <= 8) {
      return '****';
    }
    return `${pubkey.substring(0, 4)}...${pubkey.substring(pubkey.length - 4)}`;
  }
}