#!/usr/bin/env node
import 'websocket-polyfill';
import { Command } from 'commander';
import { SimplePool, Event, finalizeEvent, nip19 } from 'nostr-tools';
import { v4 as uuidv4 } from 'uuid';
import { Keyring } from '../src/keys/keyring.js';
import { DMCrypto } from '../src/crypto/dm.js';
import { KVRequest, KVResponse } from '../src/types.js';

const REQUEST_KIND = 23194;
const RESPONSE_KIND = 23195;

class DemoClient {
  private keyring: Keyring;
  private serverPubkey: string;
  private relays: string[];
  private pool: SimplePool;
  private dmCrypto: DMCrypto;
  private namespace: string;

  constructor(uri: string) {
    const parsed = this.parseURI(uri);
    this.keyring = new Keyring(parsed.secret);
    this.serverPubkey = parsed.serverPubkey;
    this.relays = parsed.relays;
    this.namespace = parsed.namespace;
    this.pool = new SimplePool();
    this.dmCrypto = new DMCrypto(true); // Prefer NIP-44
  }

  private parseURI(uri: string): {
    serverPubkey: string;
    relays: string[];
    secret: string;
    namespace: string;
  } {
    const url = new URL(uri);
    
    // Extract server pubkey
    let serverPubkey: string;
    const serverNpub = url.hostname;
    if (serverNpub.startsWith('npub1')) {
      const decoded = nip19.decode(serverNpub);
      if (decoded.type !== 'npub') {
        throw new Error('Invalid server npub');
      }
      serverPubkey = decoded.data;
    } else {
      serverPubkey = serverNpub;
    }

    // Extract parameters
    const params = url.searchParams;
    const relays = params.getAll('relay');
    const secret = params.get('secret') || '';
    const namespace = params.get('ns') || '';

    return { serverPubkey, relays, secret, namespace };
  }

  async sendRequest(method: string, params: Record<string, any>): Promise<KVResponse> {
    const request: KVRequest = {
      method,
      params,
      id: uuidv4()
    };

    console.log(`\nSending ${method} request:`, JSON.stringify(params, null, 2));

    // Encrypt the request
    const requestJson = JSON.stringify(request);
    const { encrypted } = await this.dmCrypto.encrypt(
      requestJson,
      this.keyring.getSecretKey(),
      this.serverPubkey
    );

    // Create request event
    const requestEvent: Event = {
      kind: REQUEST_KIND,
      created_at: Math.floor(Date.now() / 1000),
      tags: [['p', this.serverPubkey]],
      content: encrypted,
      pubkey: this.keyring.getPublicKey()
    };

    // Sign the event
    const signedEvent = finalizeEvent(requestEvent, this.keyring.getSecretKey());

    // Publish and wait for response
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        sub.close();
        reject(new Error('Request timeout'));
      }, 10000);

      // Subscribe to responses
      const sub = this.pool.subscribeMany(
        this.relays,
        [{
          kinds: [RESPONSE_KIND],
          authors: [this.serverPubkey],
          '#p': [this.keyring.getPublicKey()],
          since: Math.floor(Date.now() / 1000) - 1
        }],
        {
          onevent: async (event: Event) => {
            try {
              // Decrypt response
              const { decrypted } = await this.dmCrypto.decrypt(
                event.content,
                this.keyring.getSecretKey(),
                event.pubkey
              );

              const response: KVResponse = JSON.parse(decrypted);
              
              // Check if this is our response
              if (response.id === request.id) {
                clearTimeout(timeout);
                sub.close();
                resolve(response);
              }
            } catch (error) {
              console.error('Error processing response:', error);
            }
          }
        }
      );

      // Publish the request
      this.pool.publish(this.relays, signedEvent);
    });
  }

  async runDemo(): Promise<void> {
    try {
      console.log('NostrKV Connect Demo Client');
      console.log('==========================');
      console.log('Server:', this.serverPubkey.substring(0, 16) + '...');
      console.log('Client:', this.keyring.getPublicKey().substring(0, 16) + '...');
      console.log('Namespace:', this.namespace);
      console.log('Relays:', this.relays.join(', '));

      // Test get_info
      console.log('\n1. Testing get_info...');
      const infoResponse = await this.sendRequest('get_info', {});
      console.log('Response:', JSON.stringify(infoResponse, null, 2));

      // Test set
      console.log('\n2. Testing set...');
      const testValue = Buffer.from('Hello, NostrKV!').toString('base64');
      const setResponse = await this.sendRequest('set', {
        key: 'test:greeting',
        value: testValue,
        ttl: 300
      });
      console.log('Response:', JSON.stringify(setResponse, null, 2));

      // Test get
      console.log('\n3. Testing get...');
      const getResponse = await this.sendRequest('get', {
        key: 'test:greeting'
      });
      console.log('Response:', JSON.stringify(getResponse, null, 2));
      if (getResponse.result?.value) {
        const decoded = Buffer.from(getResponse.result.value, 'base64').toString();
        console.log('Decoded value:', decoded);
      }

      // Test exists
      console.log('\n4. Testing exists...');
      const existsResponse = await this.sendRequest('exists', {
        key: 'test:greeting'
      });
      console.log('Response:', JSON.stringify(existsResponse, null, 2));

      // Test mget
      console.log('\n5. Testing mget...');
      await this.sendRequest('set', {
        key: 'test:item1',
        value: Buffer.from('Item 1').toString('base64')
      });
      await this.sendRequest('set', {
        key: 'test:item2',
        value: Buffer.from('Item 2').toString('base64')
      });
      
      const mgetResponse = await this.sendRequest('mget', {
        keys: ['test:greeting', 'test:item1', 'test:item2', 'test:nonexistent']
      });
      console.log('Response:', JSON.stringify(mgetResponse, null, 2));

      // Test ttl
      console.log('\n6. Testing ttl...');
      const ttlResponse = await this.sendRequest('ttl', {
        key: 'test:greeting'
      });
      console.log('Response:', JSON.stringify(ttlResponse, null, 2));

      // Test expire
      console.log('\n7. Testing expire...');
      const expireResponse = await this.sendRequest('expire', {
        key: 'test:greeting',
        ttl: 60
      });
      console.log('Response:', JSON.stringify(expireResponse, null, 2));

      // Test del
      console.log('\n8. Testing del...');
      const delResponse = await this.sendRequest('del', {
        key: 'test:greeting'
      });
      console.log('Response:', JSON.stringify(delResponse, null, 2));

      // Verify deletion
      console.log('\n9. Verifying deletion...');
      const verifyResponse = await this.sendRequest('exists', {
        key: 'test:greeting'
      });
      console.log('Response:', JSON.stringify(verifyResponse, null, 2));

      console.log('\nDemo completed successfully!');

    } catch (error) {
      console.error('Demo error:', error);
    } finally {
      this.pool.close(this.relays);
    }
  }

  close(): void {
    this.pool.close(this.relays);
  }
}

const program = new Command();

program
  .name('demo-client')
  .description('Demo client for NostrKV Connect')
  .requiredOption('--uri <uri>', 'NostrKV Connect URI')
  .option('--method <method>', 'Single method to test')
  .option('--key <key>', 'Key for the operation')
  .option('--value <value>', 'Value for set operation')
  .option('--ttl <ttl>', 'TTL in seconds');

program.parse();

const options = program.opts();

async function main() {
  const client = new DemoClient(options.uri);

  if (options.method) {
    // Run single method
    const params: Record<string, any> = {};
    
    if (options.key) params.key = options.key;
    if (options.value) params.value = Buffer.from(options.value).toString('base64');
    if (options.ttl) params.ttl = parseInt(options.ttl);
    
    try {
      const response = await client.sendRequest(options.method, params);
      console.log('Response:', JSON.stringify(response, null, 2));
    } catch (error) {
      console.error('Error:', error);
    }
    
    client.close();
  } else {
    // Run full demo
    await client.runDemo();
  }
}

main();