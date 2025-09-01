import { spawn } from 'child_process';
import { generateTestURI } from './admin/uri.js';
import { loadConfig } from './config.js';
import { Keyring } from './keys/keyring.js';

export class WebAPIHandler {
  private config = loadConfig();
  private keyring: Keyring;
  private testURI: string;

  constructor() {
    this.keyring = new Keyring(this.config.nostr.serverNsec);
    this.testURI = generateTestURI(this.config, this.keyring);
  }

  async executeNostrCommand(method: string, params: any): Promise<any> {
    return new Promise((resolve, reject) => {
      // Create a temporary E2E test script
      const scriptContent = `
import { spawn } from 'child_process';

const child = spawn('npx', ['tsx', 'scripts/e2e-test.ts', '${this.testURI}'], {
  stdio: ['pipe', 'pipe', 'pipe'],
  shell: true,
  env: { ...process.env, SINGLE_OPERATION: '${method}', OPERATION_PARAMS: '${JSON.stringify(params)}' }
});

let stdout = '';
let stderr = '';

child.stdout.on('data', (data) => {
  stdout += data.toString();
});

child.stderr.on('data', (data) => {
  stderr += data.toString();
});

child.on('close', (code) => {
  console.log(JSON.stringify({ code, stdout, stderr }));
});
      `;

      const child = spawn('node', ['-e', scriptContent], {
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: true
      });

      let output = '';
      child.stdout.on('data', (data) => {
        output += data.toString();
      });

      child.on('close', (code) => {
        try {
          if (code === 0) {
            // Parse the result - this is simplified
            resolve({ success: true, method, params });
          } else {
            reject(new Error('Command failed'));
          }
        } catch (error) {
          reject(error);
        }
      });
    });
  }

  getConnectionURI(): string {
    return this.testURI;
  }

  getServerInfo(): any {
    return {
      npub: this.keyring.getNpub(),
      namespace: this.config.redis.namespace,
      relays: this.config.nostr.relays,
      limits: this.config.limits
    };
  }
}