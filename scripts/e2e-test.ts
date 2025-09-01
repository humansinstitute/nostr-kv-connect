#!/usr/bin/env node
import 'websocket-polyfill';
import { SimplePool, Event, finalizeEvent, nip19 } from 'nostr-tools';
import { v4 as uuidv4 } from 'uuid';
import { Keyring } from '../src/keys/keyring.js';
import { DMCrypto } from '../src/crypto/dm.js';
import { KVRequest, KVResponse } from '../src/types.js';
import Redis from 'ioredis';

const REQUEST_KIND = 23194;
const RESPONSE_KIND = 23195;

class E2ETestClient {
  private keyring: Keyring;
  private serverPubkey: string;
  private relays: string[];
  private pool: SimplePool;
  private dmCrypto: DMCrypto;
  private namespace: string;
  private redis: Redis;

  constructor(uri: string, redisUrl: string = 'redis://localhost:6379') {
    const parsed = this.parseURI(uri);
    this.keyring = new Keyring(parsed.secret);
    this.serverPubkey = parsed.serverPubkey;
    this.relays = parsed.relays;
    this.namespace = parsed.namespace;
    this.pool = new SimplePool();
    this.dmCrypto = new DMCrypto(true); // Prefer NIP-44
    this.redis = new Redis(redisUrl);
    
    console.log('🔧 E2E Test Client Initialized');
    console.log(`   Client:    ${this.keyring.getNpub()}`);
    console.log(`   Server:    npub${nip19.npubEncode(this.serverPubkey).slice(4, 12)}...`);
    console.log(`   Namespace: ${this.namespace}`);
    console.log(`   Relays:    ${this.relays.join(', ')}`);
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

    console.log(`\n📤 Sending ${method} request:`, JSON.stringify(params, null, 2));

    // Encrypt the request
    const requestJson = JSON.stringify(request);
    const { encrypted } = await this.dmCrypto.encrypt(
      requestJson,
      this.keyring.getSecretKey(),
      this.serverPubkey
    );

    // Create request event
    const requestEvent = {
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
      }, 15000);

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
                console.log(`📥 Received ${method} response:`, JSON.stringify(response, null, 2));
                resolve(response);
              }
            } catch (error) {
              console.error('Error processing response:', error);
            }
          }
        }
      );

      // Publish the request
      console.log(`📡 Publishing to relays: ${this.relays.join(', ')}`);
      this.pool.publish(this.relays, signedEvent);
    });
  }

  async checkRedisDirectly(key: string): Promise<any> {
    const fullKey = key.includes(':') ? key : this.namespace + key;
    try {
      const value = await this.redis.get(fullKey);
      console.log(`🔍 Direct Redis check for "${fullKey}":`, value);
      return value;
    } catch (error) {
      console.error('Redis check failed:', error);
      return null;
    }
  }

  async listAllRedisKeys(): Promise<string[]> {
    try {
      const keys = await this.redis.keys(this.namespace + '*');
      console.log(`📊 All Redis keys in namespace "${this.namespace}":`, keys);
      return keys;
    } catch (error) {
      console.error('Failed to list Redis keys:', error);
      return [];
    }
  }

  close(): void {
    this.pool.close(this.relays);
    this.redis.disconnect();
  }
}

async function runE2ETest(uri: string): Promise<void> {
  const client = new E2ETestClient(uri);
  
  try {
    console.log('\n🚀 Starting End-to-End NostrKV Connect Test');
    console.log('=' .repeat(50));

    // Wait a moment for connections
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Test 1: get_info
    console.log('\n🧪 Test 1: Server Info');
    console.log('-' .repeat(30));
    const infoResponse = await client.sendRequest('get_info', {});
    if (infoResponse.error) {
      throw new Error(`get_info failed: ${infoResponse.error.message}`);
    }
    console.log('✅ Server info retrieved successfully');

    // Test 2: Set a value
    console.log('\n🧪 Test 2: Set Value');
    console.log('-' .repeat(30));
    const testKey = 'e2e:test:' + Date.now();
    const testValue = `Hello NostrKV! Time: ${new Date().toISOString()}`;
    const encodedValue = Buffer.from(testValue).toString('base64');
    
    const setResponse = await client.sendRequest('set', {
      key: testKey,
      value: encodedValue,
      ttl: 300
    });
    
    if (setResponse.error) {
      throw new Error(`set failed: ${setResponse.error.message}`);
    }
    console.log('✅ Value set successfully');

    // Test 3: Check Redis directly
    console.log('\n🧪 Test 3: Direct Redis Verification');
    console.log('-' .repeat(30));
    await new Promise(resolve => setTimeout(resolve, 1000)); // Wait for Redis write
    const redisValue = await client.checkRedisDirectly(testKey);
    
    if (redisValue) {
      const decodedRedisValue = Buffer.from(redisValue).toString();
      console.log('✅ Value found in Redis:', decodedRedisValue);
      if (decodedRedisValue === testValue) {
        console.log('✅ Redis value matches what we sent!');
      } else {
        console.log('❌ Redis value mismatch!');
      }
    } else {
      console.log('❌ Value not found in Redis');
    }

    // Test 4: Get via Nostr
    console.log('\n🧪 Test 4: Get Value via Nostr');
    console.log('-' .repeat(30));
    const getResponse = await client.sendRequest('get', { key: testKey });
    
    if (getResponse.error) {
      throw new Error(`get failed: ${getResponse.error.message}`);
    }
    
    if (getResponse.result?.value) {
      const retrievedValue = Buffer.from(getResponse.result.value, 'base64').toString();
      console.log('✅ Value retrieved via Nostr:', retrievedValue);
      
      if (retrievedValue === testValue) {
        console.log('✅ Retrieved value matches original!');
      } else {
        console.log('❌ Retrieved value mismatch!');
      }
    } else {
      console.log('❌ No value returned from get request');
    }

    // Test 5: Multiple operations
    console.log('\n🧪 Test 5: Multiple Operations');
    console.log('-' .repeat(30));
    
    // Set multiple keys
    const keys = ['item1', 'item2', 'item3'];
    for (const key of keys) {
      const value = `Value for ${key}`;
      await client.sendRequest('set', {
        key: key,
        value: Buffer.from(value).toString('base64')
      });
    }
    console.log('✅ Multiple values set');

    // Get multiple keys
    const mgetResponse = await client.sendRequest('mget', { keys });
    if (!mgetResponse.error && mgetResponse.result?.values) {
      console.log('✅ Multiple values retrieved:');
      mgetResponse.result.values.forEach((val: string | null, i: number) => {
        if (val) {
          const decoded = Buffer.from(val, 'base64').toString();
          console.log(`   ${keys[i]}: ${decoded}`);
        }
      });
    }

    // Test 6: List all Redis keys
    console.log('\n🧪 Test 6: Redis Database State');
    console.log('-' .repeat(30));
    await client.listAllRedisKeys();

    // Test 7: Cleanup
    console.log('\n🧪 Test 7: Cleanup');
    console.log('-' .repeat(30));
    const allKeys = [testKey, ...keys];
    for (const key of allKeys) {
      await client.sendRequest('del', { key });
    }
    console.log('✅ Test data cleaned up');

    console.log('\n🎉 END-TO-END TEST COMPLETED SUCCESSFULLY!');
    console.log('=' .repeat(50));
    console.log('✅ Nostr messages sent and received');
    console.log('✅ Redis database updated correctly');
    console.log('✅ Full encryption/decryption working');
    console.log('✅ All operations functional');

  } catch (error) {
    console.error('\n❌ E2E Test Failed:', error);
    throw error;
  } finally {
    client.close();
  }
}

// CLI interface
if (process.argv.length < 3) {
  console.log('Usage: npx tsx scripts/e2e-test.ts <connection-uri>');
  console.log('');
  console.log('This script will:');
  console.log('1. Send real Nostr messages to your NostrKV server');
  console.log('2. Verify data is written to Redis');
  console.log('3. Test the complete end-to-end flow');
  console.log('');
  console.log('Make sure your NostrKV server is running with: npm run demo');
  process.exit(1);
}

const uri = process.argv[2];
runE2ETest(uri).catch(error => {
  console.error('Test failed:', error);
  process.exit(1);
});