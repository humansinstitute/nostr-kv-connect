import 'websocket-polyfill';
import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { BettingGameServer } from './game-server.js';
import { pino } from 'pino';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const logger = pino({ name: 'betting-game-http' });

export class BettingGameHttpServer {
  private httpServer: http.Server;
  private wsServer: WebSocketServer | null;
  public gameServer: BettingGameServer;
  public port: number;

  constructor(port: number = 3002) {
    this.port = port;
    this.gameServer = new BettingGameServer();
    
    // Create HTTP server
    this.httpServer = http.createServer((req, res) => {
      this.handleHttpRequest(req, res);
    });

    // WebSocket server will be created after HTTP server successfully binds
    this.wsServer = null;
  }

  private async handleHttpRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const url = new URL(req.url || '/', `http://${req.headers.host}`);
    
    // Enable CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(200);
      res.end();
      return;
    }

    // Debug logging for API routes
    if (url.pathname.startsWith('/demo/bettingGame/api/')) {
      logger.debug({ method: req.method, pathname: url.pathname }, 'API request');
    }

    try {
      // API Routes
      if (url.pathname === '/demo/bettingGame/api/new-game' && req.method === 'POST') {
        const result = await this.gameServer.createGame();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result)); // Returns { gameId, adminKey }
        return;
      }

      if (url.pathname.startsWith('/demo/bettingGame/api/game/') && req.method === 'GET') {
        const gameId = url.pathname.split('/').pop();
        if (!gameId) {
          res.writeHead(404);
          res.end('Game not found');
          return;
        }
        
        const gameState = await this.gameServer.getGameState(gameId);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(gameState));
        return;
      }

      if (url.pathname.startsWith('/demo/bettingGame/api/register') && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk.toString());
        req.on('end', async () => {
          try {
            const { gameId, npub } = JSON.parse(body);
            const profile = await this.gameServer.registerPlayer(gameId, npub);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(profile));
          } catch (error: any) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: error.message }));
          }
        });
        return;
      }

      if (url.pathname.startsWith('/demo/bettingGame/api/bet') && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk.toString());
        req.on('end', async () => {
          try {
            const { gameId, npub } = JSON.parse(body);
            logger.debug({ gameId, npub }, 'Processing bet request');
            const success = await this.gameServer.processBet(gameId, npub);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success }));
          } catch (error: any) {
            logger.error({ error: error.message }, 'Bet processing error');
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: error.message }));
          }
        });
        return;
      }

      // Prize setting endpoint
      if (url.pathname.match(/^\/demo\/bettingGame\/api\/game\/[^\/]+\/set-prize$/) && req.method === 'POST') {
        const gameId = url.pathname.split('/')[5]; // Extract gameId from path
        let body = '';
        req.on('data', chunk => body += chunk.toString());
        req.on('end', async () => {
          try {
            const { token, adminKey } = JSON.parse(body);
            const result = await this.gameServer.setPrize(gameId, token, adminKey);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true, ...result }));
          } catch (error: any) {
            logger.error({ error: error.message, gameId }, 'Set prize error');
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: error.message }));
          }
        });
        return;
      }

      // Start game endpoint
      if (url.pathname.match(/^\/demo\/bettingGame\/api\/game\/[^\/]+\/start$/) && req.method === 'POST') {
        const gameId = url.pathname.split('/')[5]; // Extract gameId from path
        let body = '';
        req.on('data', chunk => body += chunk.toString());
        req.on('end', async () => {
          try {
            const { adminKey } = JSON.parse(body);
            await this.gameServer.startPrestartCountdown(gameId, adminKey);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true, countdownSeconds: 10 }));
          } catch (error: any) {
            logger.error({ error: error.message, gameId }, 'Start game error');
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: error.message }));
          }
        });
        return;
      }

      if (url.pathname === '/demo/bettingGame/api/debug/redis' && req.method === 'GET') {
        try {
          const redisData = await this.gameServer.getDebugRedisData();
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(redisData));
        } catch (error: any) {
          logger.error({ error: error.message }, 'Debug Redis error');
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: error.message }));
        }
        return;
      }

      // Handle favicon
      if (url.pathname === '/favicon.ico') {
        res.writeHead(200, { 'Content-Type': 'image/x-icon' });
        res.end(''); // Empty favicon
        return;
      }

      // Serve static files
      let filePath = url.pathname;
      
      // Route mapping for demo
      if (filePath === '/demo/bettingGame' || filePath === '/demo/bettingGame/') {
        filePath = '/index.html';
      } else if (filePath.startsWith('/demo/bettingGame/')) {
        // For game rooms, serve the same index.html (client-side routing)
        const pathParts = filePath.split('/');
        if (pathParts.length === 4 && pathParts[3].length === 8) {
          filePath = '/index.html';
        } else {
          // Remove /demo/bettingGame prefix for other static files
          filePath = filePath.replace('/demo/bettingGame', '');
        }
      }

      const fullPath = path.join(__dirname, 'public', filePath);
      
      // Check if file exists and is not a directory
      if (!fs.existsSync(fullPath) || fs.lstatSync(fullPath).isDirectory()) {
        res.writeHead(404);
        res.end('Not found');
        return;
      }

      // Get content type
      const ext = path.extname(fullPath);
      const contentType = this.getContentType(ext);

      // Serve file
      const content = fs.readFileSync(fullPath);
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content);

    } catch (error: any) {
      logger.error({ error: error.message }, 'Request error');
      res.writeHead(500);
      res.end('Internal server error');
    }
  }

  private getContentType(ext: string): string {
    switch (ext) {
      case '.html': return 'text/html';
      case '.js': return 'application/javascript';
      case '.css': return 'text/css';
      case '.json': return 'application/json';
      case '.png': return 'image/png';
      case '.jpg': return 'image/jpeg';
      case '.gif': return 'image/gif';
      case '.svg': return 'image/svg+xml';
      default: return 'text/plain';
    }
  }

  private setupWebSocketServer(): void {
    this.wsServer.on('connection', (ws: WebSocket, req: http.IncomingMessage) => {
      try {
        const url = new URL(req.url || '/', `http://${req.headers?.host}`);
        const gameId = url.searchParams.get('gameId');

        if (!gameId) {
          ws.close(1002, 'Missing gameId');
          return;
        }

        logger.info({ gameId }, 'WebSocket connected');

      // Add client to game
      this.gameServer.addWebSocketClient(gameId, ws);

      // Send initial state
      this.gameServer.getGameState(gameId)
        .then(state => {
          ws.send(JSON.stringify({ type: 'state', ...state }));
        })
        .catch(error => {
          ws.send(JSON.stringify({ type: 'error', message: error.message }));
        });

      // Handle messages
      ws.on('message', async (data) => {
        try {
          const message = JSON.parse(data.toString());
          
          switch (message.type) {
            case 'bet':
              await this.gameServer.processBet(gameId, message.npub);
              break;
            case 'register':
              const profile = await this.gameServer.registerPlayer(gameId, message.npub);
              ws.send(JSON.stringify({ type: 'registered', profile }));
              break;
          }
        } catch (error: any) {
          ws.send(JSON.stringify({ type: 'error', message: error.message }));
        }
      });

      // Handle disconnect
      ws.on('close', () => {
        this.gameServer.removeWebSocketClient(gameId, ws);
        logger.info({ gameId }, 'WebSocket disconnected');
      });

        ws.on('error', (error) => {
          logger.error({ error, gameId }, 'WebSocket error');
          this.gameServer.removeWebSocketClient(gameId, ws);
        });
      } catch (error) {
        logger.error({ error }, 'WebSocket setup error');
        ws.close(1011, 'Server error');
      }
    });

    // Handle WebSocket server errors
    this.wsServer.on('error', (error) => {
      logger.error({ error }, 'WebSocket server error');
    });
  }

  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      const tryPort = (port: number) => {
        // Set up error handler before attempting to listen
        const errorHandler = (error: any) => {
          if (error.code === 'EADDRINUSE') {
            console.log(`Port ${port} is busy, trying ${port + 1}...`);
            this.httpServer.removeAllListeners('error');
            this.httpServer.removeAllListeners('listening'); 
            tryPort(port + 1);
          } else {
            reject(error);
          }
        };
        
        this.httpServer.once('error', errorHandler);
        
        this.httpServer.listen(port, () => {
          this.port = port;
          this.httpServer.removeAllListeners('error'); // Clean up error handler on success
          
          // Now create and setup WebSocket server on the same HTTP server
          if (!this.wsServer) {
            this.wsServer = new WebSocketServer({ server: this.httpServer });
            this.setupWebSocketServer();
          }
          
          logger.info({ port: this.port }, 'Betting game server started');
          console.log(`🎮 Betting Game Server running at http://localhost:${this.port}/demo/bettingGame`);
          resolve();
        });
      };
      
      tryPort(this.port);
    });
  }

  async stop(): Promise<void> {
    if (this.wsServer) {
      this.wsServer.close();
    }
    this.httpServer.close();
    await this.gameServer.cleanup();
  }
}

// If running directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const server = new BettingGameHttpServer();
  
  server.start().catch(error => {
    console.error('Failed to start server:', error);
    process.exit(1);
  });

  process.on('SIGINT', async () => {
    console.log('\nShutting down...');
    await server.stop();
    process.exit(0);
  });
}