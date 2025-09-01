import { pino } from 'pino';
import { ClientConnection } from '../types.js';

const logger = pino({ name: 'rate-limiter' });

export class RateLimiter {
  private windowMs: number = 60000; // 1 minute sliding window

  /**
   * Check if a request is within rate limits
   */
  checkLimit(connection: ClientConnection): boolean {
    const now = Date.now();
    
    // Initialize rate limit state if needed
    if (!connection.rateLimitState) {
      connection.rateLimitState = {
        requests: [],
        bytes: []
      };
    }

    // Clean up old entries (outside sliding window)
    connection.rateLimitState.requests = connection.rateLimitState.requests.filter(
      timestamp => now - timestamp < this.windowMs
    );

    // Check if we're within limits
    if (connection.rateLimitState.requests.length >= connection.limits.mps) {
      logger.warn({ 
        clientPubkey: connection.pubkey,
        current: connection.rateLimitState.requests.length,
        limit: connection.limits.mps 
      }, 'Rate limit exceeded');
      return false;
    }

    // Add current request timestamp
    connection.rateLimitState.requests.push(now);
    
    return true;
  }

  /**
   * Get remaining requests in current window
   */
  getRemainingRequests(connection: ClientConnection): number {
    if (!connection.rateLimitState) {
      return connection.limits.mps;
    }

    const now = Date.now();
    
    // Clean up old entries
    connection.rateLimitState.requests = connection.rateLimitState.requests.filter(
      timestamp => now - timestamp < this.windowMs
    );

    return Math.max(0, connection.limits.mps - connection.rateLimitState.requests.length);
  }

  /**
   * Reset rate limits for a connection
   */
  reset(connection: ClientConnection): void {
    if (connection.rateLimitState) {
      connection.rateLimitState.requests = [];
    }
  }

  /**
   * Get time until next request is allowed (in ms)
   */
  getResetTime(connection: ClientConnection): number {
    if (!connection.rateLimitState || connection.rateLimitState.requests.length === 0) {
      return 0;
    }

    const oldestRequest = Math.min(...connection.rateLimitState.requests);
    const resetTime = oldestRequest + this.windowMs - Date.now();
    
    return Math.max(0, resetTime);
  }
}