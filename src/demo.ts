#!/usr/bin/env node
import 'websocket-polyfill';
import { spawn } from 'child_process';
import { WebServer } from './web-server.js';

class DemoLauncher {
  private webServer: WebServer;
  private nostrkv: any;

  constructor() {
    this.webServer = new WebServer();
  }

  async start(): Promise<void> {
    console.log('🚀 Starting NostrKV Connect Demo...');
    console.log('');

    try {
      // Start web server first to get the port
      const webPort = await this.webServer.start(3000);
      
      // Wait a moment for web server to be fully ready
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Start NostrKV server
      this.nostrkv = spawn('node', ['dist/server.js'], {
        env: { 
          ...process.env, 
          WEB_URL: `http://localhost:${webPort}` 
        },
        stdio: 'inherit'
      });

      this.nostrkv.on('error', (error: Error) => {
        console.error('NostrKV server error:', error);
      });

      this.nostrkv.on('close', (code: number) => {
        console.log(`NostrKV server exited with code ${code}`);
        this.webServer.stop();
        process.exit(code);
      });

      // Handle shutdown
      process.on('SIGINT', () => {
        console.log('\nShutting down demo...');
        if (this.nostrkv) {
          this.nostrkv.kill('SIGINT');
        }
        this.webServer.stop();
        process.exit(0);
      });

      process.on('SIGTERM', () => {
        console.log('\nShutting down demo...');
        if (this.nostrkv) {
          this.nostrkv.kill('SIGTERM');
        }
        this.webServer.stop();
        process.exit(0);
      });

    } catch (error) {
      console.error('Failed to start demo:', error);
      process.exit(1);
    }
  }
}

// If running directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const demo = new DemoLauncher();
  demo.start();
}