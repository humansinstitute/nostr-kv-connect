import { pino } from 'pino';
import { ClientConnection } from '../types.js';

const logger = pino({ name: 'budget-manager' });

interface ByteRecord {
  timestamp: number;
  bytes: number;
}

export class BudgetManager {
  private windowMs: number = 60000; // 1 minute sliding window

  /**
   * Check if a request is within byte budget
   */
  checkBudget(connection: ClientConnection, requestBytes: number): boolean {
    const now = Date.now();
    
    // Initialize rate limit state if needed
    if (!connection.rateLimitState) {
      connection.rateLimitState = {
        requests: [],
        bytes: []
      };
    }

    // Clean up old entries (outside sliding window)
    connection.rateLimitState.bytes = connection.rateLimitState.bytes.filter(
      record => now - record.timestamp < this.windowMs
    );

    // Calculate current byte usage
    const currentUsage = connection.rateLimitState.bytes.reduce(
      (sum, record) => sum + record.bytes, 
      0
    );

    // Check if adding this request would exceed budget
    if (currentUsage + requestBytes > connection.limits.bps) {
      logger.warn({ 
        clientPubkey: connection.pubkey,
        currentUsage,
        requestBytes,
        limit: connection.limits.bps,
        wouldExceedBy: (currentUsage + requestBytes) - connection.limits.bps
      }, 'Byte budget would be exceeded');
      return false;
    }

    return true;
  }

  /**
   * Consume bytes from the budget
   */
  consumeBudget(connection: ClientConnection, bytes: number): void {
    if (!connection.rateLimitState) {
      connection.rateLimitState = {
        requests: [],
        bytes: []
      };
    }

    connection.rateLimitState.bytes.push({
      timestamp: Date.now(),
      bytes
    });

    logger.debug({ 
      clientPubkey: connection.pubkey,
      bytesConsumed: bytes,
      totalUsage: this.getCurrentUsage(connection)
    }, 'Budget consumed');
  }

  /**
   * Get remaining byte budget
   */
  getRemainingBudget(connection: ClientConnection): number {
    const currentUsage = this.getCurrentUsage(connection);
    return Math.max(0, connection.limits.bps - currentUsage);
  }

  /**
   * Get current byte usage in window
   */
  getCurrentUsage(connection: ClientConnection): number {
    if (!connection.rateLimitState) {
      return 0;
    }

    const now = Date.now();
    
    // Clean up old entries
    connection.rateLimitState.bytes = connection.rateLimitState.bytes.filter(
      record => now - record.timestamp < this.windowMs
    );

    return connection.rateLimitState.bytes.reduce(
      (sum, record) => sum + record.bytes, 
      0
    );
  }

  /**
   * Reset byte budget for a connection
   */
  reset(connection: ClientConnection): void {
    if (connection.rateLimitState) {
      connection.rateLimitState.bytes = [];
    }
  }

  /**
   * Get time until budget resets (in ms)
   */
  getResetTime(connection: ClientConnection): number {
    if (!connection.rateLimitState || connection.rateLimitState.bytes.length === 0) {
      return 0;
    }

    const oldestRecord = Math.min(...connection.rateLimitState.bytes.map(r => r.timestamp));
    const resetTime = oldestRecord + this.windowMs - Date.now();
    
    return Math.max(0, resetTime);
  }
}