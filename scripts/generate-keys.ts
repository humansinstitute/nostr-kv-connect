#!/usr/bin/env node
import { generateSecretKey, getPublicKey, nip19 } from 'nostr-tools';

// Generate a new keypair
const secretKey = generateSecretKey();
const publicKey = getPublicKey(secretKey);

// Encode to bech32 formats
const nsec = nip19.nsecEncode(secretKey);
const npub = nip19.npubEncode(publicKey);

console.log('Generated new Nostr keypair:');
console.log('');
console.log('Secret Key (nsec):', nsec);
console.log('Public Key (npub):', npub);
console.log('');
console.log('Public Key (hex):', publicKey);
console.log('Secret Key (hex):', Buffer.from(secretKey).toString('hex'));
console.log('');
console.log('Add this to your .env file:');
console.log(`SERVER_NSEC=${nsec}`);