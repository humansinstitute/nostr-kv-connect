#!/usr/bin/env node
import 'websocket-polyfill';
import { BettingGameHttpServer } from './server.js';
import { pino } from 'pino';

const logger = pino({ name: 'betting-game-start' });

async function start() {
    try {
        console.log('🎮 Starting NostrKV Connect Betting Game Demo...');
        console.log('');
        
        // Check if Redis is available
        console.log('📡 Checking Redis connection...');
        
        const server = new BettingGameHttpServer();
        
        // Test Redis connection before starting server
        const redisConnected = await server.gameServer.testRedisConnection();
        
        if (!redisConnected) {
            console.error('❌ Redis connection failed! Make sure Redis is running on localhost:6379');
            process.exit(1);
        }
        
        console.log('✅ Redis connection successful');
        await server.start();
        
        console.log('');
        console.log('✅ Betting Game Demo is ready!');
        console.log('');
        console.log(`🎯 Open your browser to: http://localhost:${server.port}/demo/bettingGame`);
        console.log('');
        console.log('Press Ctrl+C to stop the server');
        
        // Handle graceful shutdown
        process.on('SIGINT', async () => {
            console.log('\n\n🛑 Shutting down...');
            await server.stop();
            process.exit(0);
        });
        
        process.on('SIGTERM', async () => {
            console.log('\n\n🛑 Shutting down...');
            await server.stop();
            process.exit(0);
        });
        
    } catch (error) {
        logger.error({ error }, 'Failed to start betting game');
        console.error('❌ Failed to start betting game:', error);
        process.exit(1);
    }
}

// Run if this script is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
    start();
}

export { start };