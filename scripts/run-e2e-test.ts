#!/usr/bin/env node
import 'websocket-polyfill';

async function getConnectionURI(): Promise<string> {
  // Try to get URI from the web server API
  const ports = [3000, 3001, 3002, 3003, 3004]; // Try common ports
  
  for (const port of ports) {
    try {
      const response = await fetch(`http://localhost:${port}/api/connection-uri`);
      if (response.ok) {
        const data = await response.json();
        console.log(`📡 Found running server on port ${port}`);
        return data.uri;
      }
    } catch (error) {
      // Port not available, try next
      continue;
    }
  }
  
  throw new Error('No running NostrKV web server found. Please run: npm run demo');
}

async function runAutoE2E(): Promise<void> {
  try {
    console.log('🔍 Looking for running NostrKV server...');
    
    const uri = await getConnectionURI();
    console.log('✅ Server found! Starting E2E test...\n');
    
    // Import and run the E2E test
    const { spawn } = await import('child_process');
    
    const child = spawn('npx', ['tsx', 'scripts/e2e-test.ts', uri], {
      stdio: 'inherit',
      shell: true
    });
    
    child.on('close', (code) => {
      process.exit(code || 0);
    });
    
  } catch (error) {
    console.error('❌ Auto E2E test failed:', error);
    console.log('\n💡 Make sure to run this in another terminal:');
    console.log('   npm run demo');
    console.log('\nThen try again:');
    console.log('   npm run e2e-test');
    process.exit(1);
  }
}

runAutoE2E();