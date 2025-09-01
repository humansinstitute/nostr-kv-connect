import { pino } from 'pino';

const logger = pino({ name: 'validator' });

export class Validator {
  /**
   * Validate key length and format
   */
  validateKey(key: string, maxLength: number): boolean {
    if (!key) {
      logger.warn('Empty key');
      return false;
    }

    if (key.length > maxLength) {
      logger.warn({ keyLength: key.length, maxLength }, 'Key too long');
      return false;
    }

    // Check for invalid characters
    if (key.includes('\x00')) {
      logger.warn('Key contains null byte');
      return false;
    }

    return true;
  }

  /**
   * Validate value size (base64 encoded)
   */
  validateValue(value: string, maxSize: number): boolean {
    if (!value) {
      // Empty value is valid (for clearing)
      return true;
    }

    // Check base64 format
    try {
      const decoded = Buffer.from(value, 'base64');
      
      if (decoded.length > maxSize) {
        logger.warn({ 
          encodedSize: value.length,
          decodedSize: decoded.length, 
          maxSize 
        }, 'Value too large');
        return false;
      }

      return true;
    } catch (error) {
      logger.warn({ error }, 'Invalid base64 value');
      return false;
    }
  }

  /**
   * Validate mget count
   */
  validateMgetCount(count: number, maxCount: number): boolean {
    if (count <= 0) {
      logger.warn('mget with no keys');
      return false;
    }

    if (count > maxCount) {
      logger.warn({ count, maxCount }, 'Too many keys in mget');
      return false;
    }

    return true;
  }

  /**
   * Validate TTL value
   */
  validateTTL(ttl: number): boolean {
    if (!Number.isInteger(ttl)) {
      logger.warn({ ttl }, 'TTL must be an integer');
      return false;
    }

    if (ttl <= 0) {
      logger.warn({ ttl }, 'TTL must be positive');
      return false;
    }

    // Max TTL of 30 days
    const maxTTL = 30 * 24 * 60 * 60;
    if (ttl > maxTTL) {
      logger.warn({ ttl, maxTTL }, 'TTL exceeds maximum');
      return false;
    }

    return true;
  }

  /**
   * Validate namespace format
   */
  validateNamespace(namespace: string): boolean {
    if (!namespace) {
      logger.warn('Empty namespace');
      return false;
    }

    // Must end with colon
    if (!namespace.endsWith(':')) {
      logger.warn('Namespace must end with colon');
      return false;
    }

    // Check for invalid characters
    const validPattern = /^[a-zA-Z0-9_-]+:$/;
    if (!validPattern.test(namespace)) {
      logger.warn({ namespace }, 'Invalid namespace format');
      return false;
    }

    return true;
  }
}