#!/usr/bin/env node
import 'websocket-polyfill';
import { Command } from 'commander';
import { nip19, generateSecretKey } from 'nostr-tools';
import { Keyring } from '../src/keys/keyring.js';

const program = new Command();

program
  .name('generate-uri')
  .description('Generate a pairing URI for NostrKV Connect')
  .requiredOption('--server-npub <npub>', 'Server npub')
  .requiredOption('--relays <urls>', 'Comma-separated relay URLs')
  .requiredOption('--namespace <ns>', 'Namespace (e.g., appA:)')
  .option('--client-nsec <nsec>', 'Client nsec (generates new if not provided)')
  .option('--methods <methods>', 'Allowed methods (comma-separated)', 'get,set,del,exists,mget,expire,ttl,get_info')
  .option('--mps <number>', 'Max requests per minute', '60')
  .option('--bps <number>', 'Max bytes per minute', '1048576')
  .option('--maxkey <number>', 'Max key length', '256')
  .option('--maxval <number>', 'Max value size', '65536')
  .option('--mget-max <number>', 'Max items in mget', '16')
  .option('--name <name>', 'Human-readable name', 'NostrKV Connection');

program.parse();

const options = program.opts();

function generateURI(): void {
  try {
    // Generate or parse client key
    let clientKeyring: Keyring;
    if (options.clientNsec) {
      clientKeyring = new Keyring(options.clientNsec);
    } else {
      clientKeyring = new Keyring();
      console.log('Generated new client key:');
      console.log('  nsec:', clientKeyring.getNsec());
      console.log('  npub:', clientKeyring.getNpub());
      console.log('');
    }

    // Build URI components
    const params = new URLSearchParams();
    
    // Add relays
    const relays = options.relays.split(',').map((r: string) => r.trim());
    relays.forEach((relay: string) => {
      params.append('relay', relay);
    });

    // Add secret
    params.append('secret', clientKeyring.getNsec());
    
    // Add namespace
    params.append('ns', options.namespace);
    
    // Add methods
    params.append('cmds', options.methods);
    
    // Add limits
    params.append('mps', options.mps);
    params.append('bps', options.bps);
    params.append('maxkey', options.maxkey);
    params.append('maxval', options.maxval);
    params.append('mget_max', options.mgetMax);
    
    // Add name
    params.append('name', options.name);

    // Construct full URI
    const uri = `nostr+kvconnect://${options.serverNpub}?${params.toString()}`;

    console.log('Pairing URI:');
    console.log('');
    console.log(uri);
    console.log('');
    console.log('Configuration Summary:');
    console.log('  Server:', options.serverNpub);
    console.log('  Client:', clientKeyring.getNpub());
    console.log('  Namespace:', options.namespace);
    console.log('  Methods:', options.methods);
    console.log('  Relays:', relays.join(', '));
    console.log('  Limits:');
    console.log(`    - ${options.mps} requests/minute`);
    console.log(`    - ${options.bps} bytes/minute`);
    console.log(`    - Max key: ${options.maxkey} chars`);
    console.log(`    - Max value: ${options.maxval} bytes`);
    console.log(`    - Max mget: ${options.mgetMax} items`);

  } catch (error) {
    console.error('Error generating URI:', error);
    process.exit(1);
  }
}

generateURI();