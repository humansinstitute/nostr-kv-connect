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
   * Check if key contains escape attempts or malicious patterns
   * Enhanced security validation
   */
  private hasEscapeAttempt(key: string): boolean {
    // Check for common escape patterns
    const escapePatterns = [
      '..',          // Directory traversal
      '\x00',        // Null byte
      '\n',          // Newline
      '\r',          // Carriage return
      '*',           // Wildcard
      '?',           // Wildcard
      '[',           // Character class
      ']',           // Character class
      '\\',         // Backslash escape
      '$((',         // Command substitution
      '${',          // Variable expansion
      '../',         // Path traversal
      '..\\',       // Windows path traversal
      'eval(',       // Code execution
      'exec(',       // Code execution
    ];

    // Check for suspicious patterns
    const suspiciousPatterns = [
      /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/, // Control characters
      /^\s*$/, // Only whitespace
      /\.{3,}/, // Multiple dots
    ];

    return escapePatterns.some(pattern => key.includes(pattern)) ||
           suspiciousPatterns.some(pattern => pattern.test(key));
  }

  /**
   * Check if key has a different namespace prefix
   * Enhanced to prevent namespace escape attempts
   */
  private hasWrongNamespace(key: string): boolean {
    // Check if key has a colon (indicating namespace) but not our namespace
    const colonIndex = key.indexOf(':');
    if (colonIndex > 0) {
      const keyNamespace = key.substring(0, colonIndex + 1);
      // Strict namespace matching - must be exact
      if (keyNamespace !== this.namespace) {
        logger.warn({ 
          key, 
          keyNamespace, 
          expectedNamespace: this.namespace 
        }, 'Namespace mismatch detected - potential security violation');
        return true;
      }
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
   * Validate that this namespace is properly formatted and secure
   */
  validateNamespaceFormat(): boolean {
    // Must end with colon
    if (!this.namespace.endsWith(':')) {
      return false;
    }

    // Must not be empty or just colon
    if (this.namespace.length <= 1) {
      return false;
    }

    // Must not contain escape sequences
    if (this.hasEscapeAttempt(this.namespace)) {
      return false;
    }

    // Must be reasonable length (prevent abuse)
    if (this.namespace.length > 128) {
      return false;
    }

    return true;
  }

  /**
   * Check if a key belongs to this exact namespace
   * Used for additional validation
   */
  isKeyInNamespace(key: string): boolean {
    return key.startsWith(this.namespace);
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