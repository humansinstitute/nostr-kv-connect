import { Keyring } from '../keys/keyring.js';
import { Config } from '../types.js';

export function generateTestURI(config: Config, serverKeyring: Keyring): string {
  // Generate a client keypair for testing
  const clientKeyring = new Keyring();
  
  // Build URI components
  const params = new URLSearchParams();
  
  // Add relays
  config.nostr.relays.forEach(relay => {
    params.append('relay', relay);
  });

  // Add client secret
  params.append('secret', clientKeyring.getNsec());
  
  // Add namespace
  params.append('ns', config.redis.namespace);
  
  // Add all available methods
  params.append('cmds', 'get_info,get,set,del,exists,mget,expire,ttl');
  
  // Add limits
  params.append('mps', config.limits.mps.toString());
  params.append('bps', config.limits.bps.toString());
  params.append('maxkey', config.limits.maxKey.toString());
  params.append('maxval', config.limits.maxVal.toString());
  params.append('mget_max', config.limits.mgetMax.toString());
  
  // Add name
  params.append('name', 'Test Connection');

  // Construct full URI
  const uri = `nostr+kvconnect://${serverKeyring.getNpub()}?${params.toString()}`;
  
  return uri;
}

export function displayConnectionInfo(config: Config, serverKeyring: Keyring, testURI: string, webUrl?: string): void {
  console.log('\n🚀 NostrKV Connect Server Started!');
  console.log('=====================================');
  console.log('');
  console.log('📡 Server Details:');
  console.log(`   Public Key: ${serverKeyring.getNpub()}`);
  console.log(`   Namespace:  ${config.redis.namespace}`);
  console.log(`   Redis URL:  ${config.redis.url}`);
  console.log(`   Relays:     ${config.nostr.relays.join(', ')}`);
  console.log('');
  console.log('📊 Limits:');
  console.log(`   Requests:   ${config.limits.mps}/minute`);
  console.log(`   Bandwidth:  ${formatBytes(config.limits.bps)}/minute`);
  console.log(`   Max Key:    ${config.limits.maxKey} chars`);
  console.log(`   Max Value:  ${formatBytes(config.limits.maxVal)}`);
  console.log('');
  
  if (webUrl) {
    console.log('=' .repeat(60));
    console.log('🌐 WEB INTERFACE AVAILABLE!');
    console.log('=' .repeat(60));
    console.log('');
    console.log('🎯 OPEN THIS URL IN YOUR BROWSER:');
    console.log('');
    console.log(`   ➤  ${webUrl}`);
    console.log('');
    console.log('=' .repeat(60));
    console.log('');
    console.log('✨ Connection URI will be loaded automatically!');
    console.log('');
  } else {
    console.log('🔗 Test Connection URI:');
    console.log('   Use this URI with the demo client or web interface:');
    console.log('');
    console.log(`   ${testURI}`);
    console.log('');
    console.log('🌐 Web Interface:');
    console.log('   Static file: file://' + process.cwd() + '/web-test/index.html');
    console.log('   Or run: npm run web');
    console.log('');
  }
  
  console.log('✨ Ready for connections!');
  console.log('');
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}