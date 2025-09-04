#!/usr/bin/env node
import 'websocket-polyfill';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { pino } from 'pino';
import { loadConfig } from './config.js';
import { Keyring } from './keys/keyring.js';
import { generateTestURI, generateCustomURI, AppConnectionRequest } from './admin/uri.js';
import { randomUUID } from 'crypto';

const logger = pino({ name: 'web-server' });

interface AppConnection {
  appName: string;
  namespace: string; // Auto-generated, kept for display
  methods: string[];
  limits: {
    mps: number;
    bps: number;
    maxkey: number;
    maxval: number;
    mget_max: number;
  };
  uri: string;
  clientPubkey: string;
  created: string;
}

class WebServer {
  private server: http.Server;
  private config = loadConfig();
  private keyring: Keyring;
  private testURI: string;
  private appConnections: AppConnection[] = [];

  constructor() {
    this.keyring = new Keyring(this.config.nostr.serverNsec);
    this.testURI = generateTestURI(this.config, this.keyring);
    
    this.server = http.createServer((req, res) => {
      this.handleRequest(req, res);
    });

    // Log startup info
    logger.info({
      serverPubkey: this.keyring.getNpub(),
      namespace: this.config.redis.namespace,
      relays: this.config.nostr.relays,
      limits: this.config.limits
    }, '🚀 NostrKV Web Server initialized');
  }

  private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const url = new URL(req.url || '/', `http://${req.headers.host}`);
    
    try {
      // API endpoint to get the connection URI
      if (url.pathname === '/api/connection-uri') {
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type'
        });
        res.end(JSON.stringify({ 
          uri: this.testURI,
          serverInfo: {
            npub: this.keyring.getNpub(),
            namespace: this.config.redis.namespace,
            relays: this.config.nostr.relays,
            limits: this.config.limits
          }
        }));
        return;
      }

      // API endpoint to execute NostrKV commands
      if (url.pathname === '/api/nostrkv' && req.method === 'POST') {
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type'
        });

        let body = '';
        req.on('data', chunk => {
          body += chunk.toString();
        });

        req.on('end', async () => {
          const startTime = Date.now();
          try {
            const { method, params } = JSON.parse(body);
            logger.info({ 
              method, 
              params: method === 'set' ? { key: params.key, hasValue: !!params.value, ttl: params.ttl } : params,
              userAgent: req.headers['user-agent'],
              ip: req.socket.remoteAddress
            }, '📡 Web API Request');
            
            const result = await this.executeNostrKVCommand(method, params);
            const duration = Date.now() - startTime;
            
            logger.info({ 
              method, 
              success: !result.error,
              duration,
              resultType: typeof result
            }, '✅ Web API Response');
            
            res.end(JSON.stringify({ result, error: null }));
          } catch (error: any) {
            const duration = Date.now() - startTime;
            logger.error({ 
              error: error.message, 
              stack: error.stack,
              duration,
              ip: req.socket.remoteAddress
            }, '❌ Web API Error');
            res.end(JSON.stringify({ 
              result: null, 
              error: { code: 'INTERNAL', message: error.message } 
            }));
          }
        });
        return;
      }

      // API endpoint to create new app connection
      if (url.pathname === '/api/create-app-connection' && req.method === 'POST') {
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type'
        });

        let body = '';
        req.on('data', chunk => {
          body += chunk.toString();
        });

        req.on('end', async () => {
          try {
            const appConfig: AppConnectionRequest = JSON.parse(body);
            logger.debug({ appConfig }, 'Creating new app connection');
            
            // Validate input
            if (!appConfig.appName || !appConfig.methods || !appConfig.limits) {
              res.end(JSON.stringify({ 
                result: null, 
                error: { code: 'INVALID_REQUEST', message: 'Missing required fields' } 
              }));
              return;
            }

            // Check if app name already exists
            const existingApp = this.appConnections.find(app => app.appName === appConfig.appName);
            if (existingApp) {
              res.end(JSON.stringify({ 
                result: null, 
                error: { code: 'APP_EXISTS', message: 'App name already exists' } 
              }));
              return;
            }

            // Generate custom URI with auto-generated namespace
            const { uri, clientKeyring, namespace } = generateCustomURI(this.config, this.keyring, appConfig);
            
            // Create app connection record with auto-generated namespace
            const connection: AppConnection = {
              appName: appConfig.appName,
              namespace: namespace, // Auto-generated secure namespace
              methods: appConfig.methods,
              limits: appConfig.limits,
              uri,
              clientPubkey: clientKeyring.getNpub(),
              created: new Date().toISOString()
            };

            // Store connection
            this.appConnections.push(connection);
            
            // Also save to shared registry for main server
            await this.saveConnectionRegistry(clientKeyring.getPublicKey(), appConfig, namespace);
            
            logger.info({ 
              appName: appConfig.appName, 
              namespace: namespace, // Auto-generated secure namespace
              clientPubkey: clientKeyring.getNpub(),
              clientNsec: clientKeyring.getNsec(),
              clientHex: clientKeyring.getPublicKey(),
              methods: appConfig.methods,
              limits: appConfig.limits,
              totalConnections: this.appConnections.length
            }, '🔗 Created new app connection with custom client keys');

            res.end(JSON.stringify({ 
              connection,
              error: null 
            }));
          } catch (error: any) {
            logger.error({ error: error.message, stack: error.stack }, 'Error creating app connection');
            res.end(JSON.stringify({ 
              result: null, 
              error: { code: 'INTERNAL', message: error.message } 
            }));
          }
        });
        return;
      }

      // API endpoint to get all app connections
      if (url.pathname === '/api/app-connections' && req.method === 'GET') {
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type'
        });

        logger.info({ 
          totalConnections: this.appConnections.length,
          appNames: this.appConnections.map(c => c.appName),
          ip: req.socket.remoteAddress 
        }, '📋 Listing app connections');

        res.end(JSON.stringify({ 
          connections: this.appConnections,
          error: null 
        }));
        return;
      }

      // API endpoint to delete an app connection
      if (url.pathname === '/api/delete-app-connection' && req.method === 'POST') {
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type'
        });

        let body = '';
        req.on('data', chunk => {
          body += chunk.toString();
        });

        req.on('end', async () => {
          try {
            const { appName } = JSON.parse(body);
            const index = this.appConnections.findIndex(app => app.appName === appName);
            
            if (index === -1) {
              res.end(JSON.stringify({ 
                result: null, 
                error: { code: 'APP_NOT_FOUND', message: 'App connection not found' } 
              }));
              return;
            }

            this.appConnections.splice(index, 1);
            logger.info({ appName }, 'Deleted app connection');

            res.end(JSON.stringify({ 
              result: { deleted: true },
              error: null 
            }));
          } catch (error: any) {
            logger.error({ error: error.message, stack: error.stack }, 'Error deleting app connection');
            res.end(JSON.stringify({ 
              result: null, 
              error: { code: 'INTERNAL', message: error.message } 
            }));
          }
        });
        return;
      }

      // Handle CORS preflight
      if (req.method === 'OPTIONS') {
        res.writeHead(200, {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type'
        });
        res.end();
        return;
      }

      // Serve static files
      let filePath = url.pathname;
      if (filePath === '/') {
        filePath = '/bridge-client.html';  // Use the bridge client by default
      }
      
      // Allow access to different interfaces
      if (filePath === '/demo') {
        filePath = '/index.html';  // Demo/simulation mode
      }
      if (filePath === '/real') {
        filePath = '/real-nostr-client.html';  // Real Nostr client (incomplete)
      }
      if (filePath === '/client') {
        // Serve the real NostrKV client
        const realClientPath = '/Users/mini/code/Reddisconnect/docs/real-client.html';
        if (fs.existsSync(realClientPath)) {
          const content = fs.readFileSync(realClientPath);
          res.writeHead(200, { 
            'Content-Type': 'text/html',
            'Cache-Control': 'no-cache'
          });
          res.end(content);
          return;
        }
      }

      // Security: prevent directory traversal
      if (filePath.includes('..')) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
      }

      const fullPath = path.join(process.cwd(), 'web-test', filePath);
      
      // Check if file exists
      if (!fs.existsSync(fullPath)) {
        res.writeHead(404);
        res.end('File not found');
        return;
      }

      // Determine content type
      const ext = path.extname(fullPath);
      const contentTypes: Record<string, string> = {
        '.html': 'text/html',
        '.js': 'application/javascript',
        '.css': 'text/css',
        '.json': 'application/json',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.gif': 'image/gif',
        '.ico': 'image/x-icon'
      };
      
      const contentType = contentTypes[ext] || 'text/plain';

      // Read and serve file
      const content = fs.readFileSync(fullPath);
      
      // If it's the main HTML file, inject the connection URI
      if (filePath === '/index.html') {
        let htmlContent = content.toString();
        
        // Inject the connection URI into the HTML
        const uriScript = `
          <script>
            window.NOSTRKV_CONNECTION_URI = ${JSON.stringify(this.testURI)};
            window.NOSTRKV_SERVER_INFO = ${JSON.stringify({
              npub: this.keyring.getNpub(),
              namespace: this.config.redis.namespace,
              relays: this.config.nostr.relays,
              limits: this.config.limits
            })};
          </script>
        `;
        
        htmlContent = htmlContent.replace('</head>', uriScript + '</head>');
        
        res.writeHead(200, { 
          'Content-Type': contentType,
          'Cache-Control': 'no-cache'
        });
        res.end(htmlContent);
      } else {
        res.writeHead(200, { 'Content-Type': contentType });
        res.end(content);
      }

    } catch (error) {
      logger.error({ error, url: url.pathname }, 'Error serving request');
      res.writeHead(500);
      res.end('Internal Server Error');
    }
  }

  async start(port: number = 3000): Promise<number> {
    return new Promise((resolve, reject) => {
      const tryPort = (currentPort: number) => {
        this.server.listen(currentPort, () => {
          console.log('\n' + '='.repeat(60));
          console.log('🌐 NOSTRKV CONNECT WEB INTERFACE - READY!');
          console.log('='.repeat(60));
          console.log('');
          console.log('🎯 OPEN THIS URL IN YOUR BROWSER:');
          console.log('');
          console.log(`   ➤  http://localhost:${currentPort}`);
          console.log('');
          console.log('='.repeat(60));
          console.log('');
          console.log('✨ The connection URI is automatically loaded!');
          console.log('✨ No need to copy/paste - just click "Test Connection"');
          console.log('');
          resolve(currentPort);
        });

        this.server.on('error', (error: any) => {
          if (error.code === 'EADDRINUSE') {
            logger.info({ port: currentPort }, 'Port in use, trying next port...');
            this.server.removeAllListeners();
            this.server = http.createServer((req: any, res: any) => {
              this.handleRequest(req, res);
            });
            tryPort(currentPort + 1);
          } else {
            logger.error({ error }, 'Web server error');
            reject(error);
          }
        });
      };

      tryPort(port);
    });
  }

  private async executeNostrKVCommand(method: string, params: any): Promise<any> {
    // For the web interface, bypass Nostr and directly use Redis for better reliability
    // This provides immediate feedback while keeping the full Nostr protocol for the main server
    const { KVAdapter } = await import('./redis/kv.js');
    
    try {
      const adapter = new KVAdapter(this.config.redis.url);
      const namespace = this.config.redis.namespace;
      
      switch (method) {
        case 'get_info':
          return {
            methods: ['get_info', 'get', 'set', 'del', 'exists', 'mget', 'expire', 'ttl'],
            ns: namespace,
            limits: this.config.limits,
            encryption: { nip44: true, nip04: true }
          };
          
        case 'set':
          if (!params.key || params.value === undefined) {
            throw new Error('Missing key or value');
          }
          const key = namespace + params.key;
          // Convert value to base64 if it's not already
          const base64Value = Buffer.from(params.value).toString('base64');
          await adapter.set(key, base64Value, params.ttl);
          
          // Generate event ID for tracking
          const eventId = randomUUID();
          return { ok: true, eventId };
          
        case 'get':
          if (!params.key) {
            throw new Error('Missing key');
          }
          const base64Result = await adapter.get(namespace + params.key);
          if (base64Result === null) {
            return { value: null };
          }
          // Return the base64 value as expected by the protocol
          return { value: base64Result };
          
        case 'exists':
          if (!params.key) {
            throw new Error('Missing key');
          }
          const exists = await adapter.exists(namespace + params.key);
          return { exists };
          
        case 'del':
          if (!params.key) {
            throw new Error('Missing key');
          }
          const deleted = await adapter.del(namespace + params.key);
          return { deleted };
          
        default:
          throw new Error(`Unsupported method: ${method}`);
      }
    } catch (error: any) {
      throw new Error(`Redis operation failed: ${error.message}`);
    }
  }

  private async saveConnectionRegistry(clientPubkey: string, appConfig: AppConnectionRequest, namespace: string): Promise<void> {
    try {
      const registryPath = path.join(process.cwd(), '.nostrkv-connections.json');
      
      // Read existing registry
      let registry: Record<string, any> = {};
      if (fs.existsSync(registryPath)) {
        const content = fs.readFileSync(registryPath, 'utf8');
        registry = JSON.parse(content);
      }
      
      // Add new connection with auto-generated namespace
      registry[clientPubkey] = {
        namespace: namespace, // Auto-generated secure namespace
        allowedMethods: appConfig.methods,
        limits: appConfig.limits,
        appName: appConfig.appName,
        created: new Date().toISOString()
      };
      
      // Write updated registry
      fs.writeFileSync(registryPath, JSON.stringify(registry, null, 2));
      logger.info({ clientPubkey: clientPubkey.substring(0, 8), namespace: namespace }, 'Saved client connection to registry');
      
    } catch (error) {
      logger.error({ error }, 'Failed to save connection registry');
    }
  }

  stop(): void {
    this.server.close();
  }
}

// If running directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const webServer = new WebServer();
  const port = parseInt(process.env.WEB_PORT || '3000');
  
  webServer.start(port).then((actualPort) => {
    // Handle shutdown
    process.on('SIGINT', () => {
      console.log('\nShutting down web server...');
      webServer.stop();
      process.exit(0);
    });
  }).catch((error) => {
    console.error('Failed to start web server:', error);
    process.exit(1);
  });
}

export { WebServer };