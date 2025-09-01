import Redis from 'ioredis';
import { pino } from 'pino';

const logger = pino({ name: 'redis-kv' });

export class KVAdapter {
  private redis: Redis;

  constructor(redisUrl: string) {
    this.redis = new Redis(redisUrl, {
      retryStrategy: (times: number) => {
        const delay = Math.min(times * 50, 2000);
        logger.warn({ attempt: times, delay }, 'Retrying Redis connection');
        return delay;
      },
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
      lazyConnect: false
    });

    this.redis.on('connect', () => {
      logger.info('Connected to Redis');
    });

    this.redis.on('error', (error) => {
      logger.error({ error }, 'Redis error');
    });

    this.redis.on('close', () => {
      logger.warn('Redis connection closed');
    });
  }

  /**
   * Get a value by key
   * Returns base64-encoded value or null if not found
   */
  async get(key: string): Promise<string | null> {
    try {
      const value = await this.redis.get(key);
      if (value === null) {
        return null;
      }
      // Convert to base64 if not already
      if (this.isBase64(value)) {
        return value;
      }
      return Buffer.from(value).toString('base64');
    } catch (error) {
      logger.error({ error, key }, 'Failed to get value');
      throw error;
    }
  }

  /**
   * Set a value with optional TTL
   * Value should be base64-encoded
   */
  async set(key: string, value: string, ttl?: number): Promise<void> {
    try {
      // Decode base64 to store as binary in Redis
      const decodedValue = Buffer.from(value, 'base64');
      
      if (ttl && ttl > 0) {
        await this.redis.set(key, decodedValue, 'EX', ttl);
      } else {
        await this.redis.set(key, decodedValue);
      }
      
      logger.debug({ key, ttl }, 'Value set');
    } catch (error) {
      logger.error({ error, key }, 'Failed to set value');
      throw error;
    }
  }

  /**
   * Delete a key
   * Returns number of keys deleted (0 or 1)
   */
  async del(key: string): Promise<number> {
    try {
      const result = await this.redis.del(key);
      logger.debug({ key, deleted: result }, 'Key deleted');
      return result;
    } catch (error) {
      logger.error({ error, key }, 'Failed to delete key');
      throw error;
    }
  }

  /**
   * Check if a key exists
   */
  async exists(key: string): Promise<boolean> {
    try {
      const result = await this.redis.exists(key);
      return result === 1;
    } catch (error) {
      logger.error({ error, key }, 'Failed to check existence');
      throw error;
    }
  }

  /**
   * Get multiple values
   * Returns array of base64-encoded values (null for missing keys)
   */
  async mget(keys: string[]): Promise<(string | null)[]> {
    try {
      const values = await this.redis.mget(keys);
      
      return values.map(value => {
        if (value === null) {
          return null;
        }
        // Convert to base64 if not already
        if (this.isBase64(value)) {
          return value;
        }
        return Buffer.from(value).toString('base64');
      });
    } catch (error) {
      logger.error({ error, keyCount: keys.length }, 'Failed to get multiple values');
      throw error;
    }
  }

  /**
   * Set expiration on a key
   * Returns true if expiration was set, false if key doesn't exist
   */
  async expire(key: string, ttl: number): Promise<boolean> {
    try {
      const result = await this.redis.expire(key, ttl);
      return result === 1;
    } catch (error) {
      logger.error({ error, key, ttl }, 'Failed to set expiration');
      throw error;
    }
  }

  /**
   * Get TTL of a key
   * Returns:
   * - positive number: TTL in seconds
   * - -1: key exists but has no TTL
   * - -2: key doesn't exist
   */
  async ttl(key: string): Promise<number> {
    try {
      const result = await this.redis.ttl(key);
      return result;
    } catch (error) {
      logger.error({ error, key }, 'Failed to get TTL');
      throw error;
    }
  }

  /**
   * Check if a string is valid base64
   */
  private isBase64(str: string): boolean {
    try {
      return Buffer.from(str, 'base64').toString('base64') === str;
    } catch {
      return false;
    }
  }

  /**
   * Close Redis connection
   */
  async close(): Promise<void> {
    await this.redis.quit();
    logger.info('Redis connection closed');
  }

  /**
   * Check if Redis is ready
   */
  isReady(): boolean {
    return this.redis.status === 'ready';
  }
}