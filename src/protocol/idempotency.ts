import { pino } from 'pino';
import { KVResponse } from '../types.js';

const logger = pino({ name: 'idempotency' });

interface CachedResponse {
  response: KVResponse;
  timestamp: number;
}

export class IdempotencyCache {
  private cache: Map<string, CachedResponse> = new Map();
  private windowMs: number = 60000; // 1 minute window
  private cleanupInterval: NodeJS.Timeout;

  constructor(windowMs: number = 60000) {
    this.windowMs = windowMs;
    
    // Cleanup old entries every minute
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, 60000);
  }

  private getCacheKey(clientPubkey: string, requestId: string): string {
    return `${clientPubkey}:${requestId}`;
  }

  get(clientPubkey: string, requestId: string): KVResponse | null {
    const key = this.getCacheKey(clientPubkey, requestId);
    const cached = this.cache.get(key);
    
    if (!cached) {
      return null;
    }

    const age = Date.now() - cached.timestamp;
    
    if (age > this.windowMs) {
      this.cache.delete(key);
      return null;
    }

    logger.debug({ clientPubkey, requestId, age }, 'Returning cached response');
    return cached.response;
  }

  set(clientPubkey: string, requestId: string, response: KVResponse): void {
    const key = this.getCacheKey(clientPubkey, requestId);
    
    this.cache.set(key, {
      response,
      timestamp: Date.now()
    });
    
    logger.debug({ clientPubkey, requestId }, 'Cached response');
  }

  private cleanup(): void {
    const now = Date.now();
    let cleaned = 0;
    
    for (const [key, cached] of this.cache.entries()) {
      if (now - cached.timestamp > this.windowMs) {
        this.cache.delete(key);
        cleaned++;
      }
    }
    
    if (cleaned > 0) {
      logger.debug({ cleaned, remaining: this.cache.size }, 'Cleaned up old cache entries');
    }
  }

  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    this.cache.clear();
  }
}