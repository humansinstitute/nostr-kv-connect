import { nip04, nip44 } from 'nostr-tools';
import { pino } from 'pino';

const logger = pino({ name: 'crypto-dm' });

export class DMCrypto {
  private preferNip44: boolean;
  private nip44Available: boolean = true;
  private nip04Available: boolean = true;

  constructor(preferNip44: boolean = true) {
    this.preferNip44 = preferNip44;
  }

  async encrypt(
    content: string, 
    senderPrivkey: Uint8Array, 
    recipientPubkey: string
  ): Promise<{ encrypted: string; method: 'nip44' | 'nip04' }> {
    if (this.preferNip44 && this.nip44Available) {
      try {
        const conversationKey = nip44.v2.utils.getConversationKey(senderPrivkey, recipientPubkey);
        const encrypted = nip44.v2.encrypt(content, conversationKey);
        logger.debug('Encrypted with NIP-44');
        return { encrypted, method: 'nip44' };
      } catch (error) {
        logger.warn({ error }, 'NIP-44 encryption failed, falling back to NIP-04');
        this.nip44Available = false;
      }
    }

    // Fallback to NIP-04
    try {
      const encrypted = await nip04.encrypt(senderPrivkey, recipientPubkey, content);
      logger.debug('Encrypted with NIP-04');
      return { encrypted, method: 'nip04' };
    } catch (error) {
      logger.error({ error }, 'NIP-04 encryption failed');
      throw new Error('Failed to encrypt message');
    }
  }

  async decrypt(
    encryptedContent: string,
    recipientPrivkey: Uint8Array,
    senderPubkey: string
  ): Promise<{ decrypted: string; method: 'nip44' | 'nip04' }> {
    // Try NIP-44 first
    if (this.nip44Available) {
      try {
        const conversationKey = nip44.v2.utils.getConversationKey(recipientPrivkey, senderPubkey);
        const decrypted = nip44.v2.decrypt(encryptedContent, conversationKey);
        logger.debug('Decrypted with NIP-44');
        return { decrypted, method: 'nip44' };
      } catch (error) {
        logger.debug('NIP-44 decryption failed, trying NIP-04');
      }
    }

    // Try NIP-04
    try {
      const decrypted = await nip04.decrypt(recipientPrivkey, senderPubkey, encryptedContent);
      logger.debug('Decrypted with NIP-04');
      return { decrypted, method: 'nip04' };
    } catch (error) {
      logger.error({ error }, 'Failed to decrypt with both NIP-44 and NIP-04');
      throw new Error('Failed to decrypt message');
    }
  }

  getCapabilities(): { nip44: boolean; nip04: boolean } {
    return {
      nip44: this.nip44Available,
      nip04: this.nip04Available
    };
  }
}