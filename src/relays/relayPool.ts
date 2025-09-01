import { SimplePool, Event, Filter } from 'nostr-tools';
import { pino } from 'pino';

const logger = pino({ name: 'relay-pool' });

export class RelayPool {
  private pool: SimplePool;
  private relays: string[];
  private reconnectAttempts: Map<string, number> = new Map();
  private maxReconnectAttempts = 5;
  private reconnectDelay = 1000; // Initial delay in ms

  constructor(relays: string[]) {
    this.pool = new SimplePool();
    this.relays = relays;
  }

  async connect(): Promise<void> {
    logger.info({ relays: this.relays }, 'Connecting to relays');
    
    for (const relay of this.relays) {
      try {
        await this.connectToRelay(relay);
      } catch (error) {
        logger.error({ relay, error }, 'Failed to connect to relay');
      }
    }
  }

  private async connectToRelay(relay: string): Promise<void> {
    try {
      // SimplePool handles connections automatically
      logger.info({ relay }, 'Connected to relay');
      this.reconnectAttempts.set(relay, 0);
    } catch (error) {
      await this.handleReconnect(relay);
      throw error;
    }
  }

  private async handleReconnect(relay: string): Promise<void> {
    const attempts = this.reconnectAttempts.get(relay) || 0;
    
    if (attempts >= this.maxReconnectAttempts) {
      logger.error({ relay }, 'Max reconnection attempts reached');
      return;
    }

    const delay = this.reconnectDelay * Math.pow(2, attempts) + Math.random() * 1000;
    this.reconnectAttempts.set(relay, attempts + 1);
    
    logger.info({ relay, attempt: attempts + 1, delay }, 'Scheduling reconnection');
    
    setTimeout(async () => {
      try {
        await this.connectToRelay(relay);
      } catch (error) {
        logger.error({ relay, error }, 'Reconnection failed');
      }
    }, delay);
  }

  async publish(event: Event): Promise<void> {
    try {
      const results = await Promise.allSettled(
        this.pool.publish(this.relays, event)
      );
      
      const successful = results.filter(r => r.status === 'fulfilled').length;
      const failed = results.filter(r => r.status === 'rejected').length;
      
      logger.info({ 
        eventId: event.id, 
        successful, 
        failed,
        totalRelays: this.relays.length 
      }, 'Event published');
      
      if (successful === 0) {
        throw new Error('Failed to publish to any relay');
      }
    } catch (error) {
      logger.error({ error }, 'Failed to publish event');
      throw error;
    }
  }

  subscribe(filters: Filter[], callback: (event: Event) => void): any {
    logger.info({ filters }, 'Subscribing to filters');
    
    const sub = this.pool.subscribeMany(this.relays, filters, {
      onevent: (event: Event) => {
        logger.debug({ eventId: event.id }, 'Received event');
        callback(event);
      },
      oneose: () => {
        logger.debug('End of stored events');
      }
    });

    return sub;
  }

  close(): void {
    logger.info('Closing relay pool');
    this.pool.close(this.relays);
  }
}