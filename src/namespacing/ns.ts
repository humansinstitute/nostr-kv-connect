import { pino } from 'pino';

const logger = pino({ name: 'namespace' });

export class NamespaceManager {
  private namespace: string;

  constructor(namespace: string) {
    // Ensure namespace ends with colon
    this.namespace = namespace.endsWith(':') ? namespace : namespace + ':';
  }

  /**
   * Ensures a key is within the configured namespace
   * Returns the fully-qualified key or null if invalid
   */
  ensureNamespace(key: string): string | null {
    if (!key) {
      logger.warn('Empty key provided');
      return null;
    }

    // Check for escape attempts
    if (this.hasEscapeAttempt(key)) {
      logger.warn({ key }, 'Key contains escape attempt');
      return null;
    }

    // If key already has namespace prefix, validate it
    if (key.startsWith(this.namespace)) {
      return key;
    }

    // Check if key has a different namespace prefix (reject)
    if (this.hasWrongNamespace(key)) {
      logger.warn({ key, expectedNamespace: this.namespace }, 'Key has wrong namespace');
      return null;
    }

    // Auto-prefix bare keys
    return this.namespace + key;
  }

  /**
   * Check if key contains escape attempts
   */
  private hasEscapeAttempt(key: string): boolean {
    // Check for common escape patterns
    const escapePatterns = [
      '..',     // Directory traversal
      '\x00',   // Null byte
      '\n',     // Newline
      '\r',     // Carriage return
      '*',      // Wildcard
      '?',      // Wildcard
      '[',      // Character class
      ']',      // Character class
    ];

    return escapePatterns.some(pattern => key.includes(pattern));
  }

  /**
   * Check if key has a different namespace prefix
   */
  private hasWrongNamespace(key: string): boolean {
    // Check if key has a colon (indicating namespace) but not our namespace
    const colonIndex = key.indexOf(':');
    if (colonIndex > 0) {
      const keyNamespace = key.substring(0, colonIndex + 1);
      return keyNamespace !== this.namespace;
    }
    return false;
  }

  /**
   * Strip namespace from a key for display purposes
   */
  stripNamespace(key: string): string {
    if (key.startsWith(this.namespace)) {
      return key.substring(this.namespace.length);
    }
    return key;
  }

  /**
   * Get the current namespace
   */
  getNamespace(): string {
    return this.namespace;
  }

  /**
   * Validate a list of keys for mget operations
   */
  validateKeys(keys: string[]): { valid: string[]; invalid: string[] } {
    const valid: string[] = [];
    const invalid: string[] = [];

    for (const key of keys) {
      const fullKey = this.ensureNamespace(key);
      if (fullKey) {
        valid.push(fullKey);
      } else {
        invalid.push(key);
      }
    }

    return { valid, invalid };
  }
}