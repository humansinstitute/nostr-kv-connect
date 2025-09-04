import 'websocket-polyfill';
import { WebSocket } from 'ws';
import { randomBytes } from 'crypto';
import { Redis } from 'ioredis';
import { nip19, SimplePool, Event, getPublicKey, getEventHash, signEvent, nip44, finalizeEvent } from 'nostr-tools';
import { RateLimiterRedis } from 'rate-limiter-flexible';
import { pino } from 'pino';
import { loadConfig } from '../../src/config.js';

const logger = pino({ name: 'betting-game' });

// Game configuration from environment
const config = {
  relays: process.env.NOSTR_REMOTE_RELAYS?.split(',') || [
    'wss://nostr.wine',
    'wss://relayable.org', 
    'wss://relay.primal.net',
    'wss://nostr.bitcoiner.social',
    'wss://relay.damus.io',
    'wss://nos.lol',
    'wss://relay.snort.social',
    'wss://purplepag.es',
    'wss://relay.nostr.band'
  ],
  betsPerSecond: parseInt(process.env.BETS_PER_SECOND || '4'),
  betDebounceMs: parseInt(process.env.BET_DEBOUNCE_MS || '200'),
  gameTtlHours: parseInt(process.env.GAME_TTL_HOURS || '24'),
  gameNsec: process.env.GAME_NSEC, // For DM sending
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379'),
    namespace: process.env.REDIS_NAMESPACE || 'nkvc:bettingGame'
  }
};

interface GameState {
  id: string;
  status: 'lobby' | 'prestart' | 'active' | 'ended';
  startAt: number;
  endAt?: number;
  holder?: string;
  winner?: string;
  players: Set<string>;
  recentBettors: string[];
  lastBetTimes: Map<string, number>;
  // Prize system (in-memory only)
  prizeToken?: string;
  prizeSummary?: { display: string, amount?: string | number };
  adminKey: string;
}

interface PlayerProfile {
  npub: string;
  name?: string;
  displayName?: string;
  picture?: string;
}

export class BettingGameServer {
  private redis: Redis;
  private pool: SimplePool;
  private games: Map<string, GameState>;
  private rateLimiter: RateLimiterRedis;
  private profiles: Map<string, PlayerProfile>;
  private wsClients: Map<string, Set<WebSocket>>;

  constructor() {
    this.redis = new Redis({
      host: config.redis.host,
      port: config.redis.port,
      keyPrefix: config.redis.namespace + ':'
    });

    // Add Redis connection event handlers
    this.redis.on('connect', () => {
      logger.info({ host: config.redis.host, port: config.redis.port }, 'Connected to Redis');
    });

    this.redis.on('error', (error) => {
      logger.error({ error }, 'Redis connection error');
    });

    this.redis.on('ready', () => {
      logger.info('Redis connection ready');
    });

    this.pool = new SimplePool();
    this.games = new Map();
    this.profiles = new Map();
    this.wsClients = new Map();

    // Rate limiter for bets
    this.rateLimiter = new RateLimiterRedis({
      storeClient: this.redis,
      keyPrefix: 'rl:bet',
      points: config.betsPerSecond,
      duration: 1, // Per second
      blockDuration: 0 // Don't block, just reject
    });
  }

  // Test Redis connection
  async testRedisConnection(): Promise<boolean> {
    try {
      await this.redis.ping();
      logger.info('Redis ping successful');
      return true;
    } catch (error) {
      logger.error({ error }, 'Redis ping failed');
      return false;
    }
  }

  // Generate a unique game ID (8-char base36)
  private generateGameId(): string {
    const bytes = randomBytes(5);
    return parseInt(bytes.toString('hex'), 16).toString(36).padStart(8, '0').slice(0, 8);
  }

  // Create a new game
  async createGame(): Promise<{ gameId: string; adminKey: string }> {
    const gameId = this.generateGameId();
    const adminKey = randomBytes(16).toString('base64url'); // Generate admin key

    const gameState: GameState = {
      id: gameId,
      status: 'lobby',
      startAt: 0, // No automatic start time - manual start only
      players: new Set(),
      recentBettors: [],
      lastBetTimes: new Map(),
      adminKey
    };

    this.games.set(gameId, gameState);

    // Store in Redis with TTL (without adminKey and prizeToken)
    try {
      await this.redis.setex(
        `game:${gameId}`,
        config.gameTtlHours * 3600,
        JSON.stringify({
          id: gameId,
          status: gameState.status,
          startAt: gameState.startAt,
          players: [],
          prizeSummary: gameState.prizeSummary
        })
      );
      logger.debug({ gameId }, 'Game stored in Redis');
    } catch (error) {
      logger.error({ error, gameId }, 'Failed to store game in Redis');
      throw error;
    }

    // Do NOT auto-schedule game start - manual start only

    logger.info({ gameId, adminKey: adminKey.slice(0, 8) + '...' }, 'Game created with admin key');
    return { gameId, adminKey };
  }

  // Start a game
  private async startGame(gameId: string): Promise<void> {
    const game = this.games.get(gameId);
    if (!game) return;
    if (game.status !== 'lobby' && game.status !== 'prestart') return;

    // Random end time between 20-40 seconds
    const duration = 20000 + Math.random() * 20000;
    const now = Date.now();
    game.startAt = now; // Update start time to actual start
    game.endAt = now + duration;
    game.status = 'active';

    // Update Redis
    await this.redis.set(
      `game:${gameId}`,
      JSON.stringify({
        id: gameId,
        status: game.status,
        startAt: game.startAt,
        endAt: game.endAt,
        players: Array.from(game.players)
      })
    );

    // Broadcast game start
    this.broadcast(gameId, {
      type: 'gameStart',
      startAt: game.startAt
    });

    // Start final countdown timer (check every 100ms for final 3 seconds)
    const countdownInterval = setInterval(() => {
      const now = Date.now();
      const timeRemaining = game.endAt ? Math.max(0, game.endAt - now) : 0;
      
      if (timeRemaining <= 3000 && timeRemaining > 0) {
        this.broadcast(gameId, {
          type: 'finalCountdown',
          timeRemaining
        });
      } else if (timeRemaining <= 0) {
        clearInterval(countdownInterval);
      }
    }, 100);

    // Schedule game end
    setTimeout(() => {
      clearInterval(countdownInterval);
      this.endGame(gameId);
    }, duration);

    logger.info({ gameId, duration }, 'Game started');
  }

  // End a game
  private async endGame(gameId: string): Promise<void> {
    const game = this.games.get(gameId);
    if (!game || game.status !== 'active') return;

    game.status = 'ended';
    game.winner = game.holder;

    // Update Redis
    await this.redis.set(
      `game:${gameId}`,
      JSON.stringify({
        id: gameId,
        status: game.status,
        startAt: game.startAt,
        endAt: game.endAt,
        winner: game.winner,
        players: Array.from(game.players)
      })
    );

    // Send prize DM if winner and prize token exist
    let dmEventId: string | undefined;
    if (game.winner && game.prizeToken) {
      try {
        dmEventId = await this.sendPrizeDM(gameId, game.winner, game.prizeToken);
      } catch (error) {
        logger.error({ error, gameId, winner: game.winner }, 'Failed to send prize DM');
      }
    }

    // Broadcast winner
    this.broadcast(gameId, {
      type: 'gameEnd',
      winner: game.winner,
      winnerProfile: game.winner ? this.profiles.get(game.winner) : undefined
    });

    // Broadcast prize sent if successful
    if (dmEventId) {
      this.broadcast(gameId, {
        type: 'prizeSent',
        eventId: dmEventId,
        recipientNpub: game.winner
      });
    }

    // Purge token from memory
    if (game.prizeToken) {
      delete game.prizeToken;
      logger.debug({ gameId }, 'Prize token purged from memory');
    }

    logger.info({ gameId, winner: game.winner, dmEventId }, 'Game ended');
  }

  // Register a player
  async registerPlayer(gameId: string, npub: string): Promise<PlayerProfile> {
    const game = this.games.get(gameId);
    if (!game) throw new Error('Game not found');
    if (game.status !== 'lobby') throw new Error('Registration closed - game is starting or in progress');

    // Validate npub
    let pubkey: string;
    try {
      const decoded = nip19.decode(npub);
      if (decoded.type !== 'npub') throw new Error('Invalid npub');
      pubkey = decoded.data as string;
    } catch (error) {
      throw new Error('Invalid npub format');
    }

    // Check if already registered
    if (game.players.has(npub)) {
      const profile = this.profiles.get(npub);
      if (profile) return profile;
    }

    // Fetch profile from relays
    const profile = await this.fetchProfile(npub, pubkey);
    
    // Store profile
    this.profiles.set(npub, profile);
    game.players.add(npub);

    // Cache in Redis
    await this.redis.setex(
      `profile:${npub}`,
      86400, // 24 hours
      JSON.stringify(profile)
    );

    // Update game in Redis
    await this.redis.set(
      `game:${gameId}`,
      JSON.stringify({
        id: gameId,
        status: game.status,
        startAt: game.startAt,
        endAt: game.endAt,
        players: Array.from(game.players)
      })
    );

    // Broadcast player joined
    this.broadcast(gameId, {
      type: 'playerJoined',
      playersCount: game.players.size
    });

    logger.info({ gameId, npub }, 'Player registered');
    return profile;
  }

  // Fetch profile from Nostr relays
  private async fetchProfile(npub: string, pubkey: string): Promise<PlayerProfile> {
    try {
      const events = await this.pool.list(config.relays, [{
        kinds: [0],
        authors: [pubkey],
        limit: 1
      }]);

      if (events.length > 0) {
        const metadata = JSON.parse(events[0].content);
        return {
          npub,
          name: metadata.name,
          displayName: metadata.display_name || metadata.name,
          picture: metadata.picture
        };
      }
    } catch (error) {
      logger.error({ error, npub }, 'Failed to fetch profile');
    }

    return { npub };
  }

  // Process a bet
  async processBet(gameId: string, npub: string): Promise<boolean> {
    const game = this.games.get(gameId);
    if (!game) throw new Error('Game not found');
    if (game.status !== 'active') {
      logger.warn({ gameId, status: game.status }, 'Bet attempted on non-active game');
      throw new Error(`Game not active (status: ${game.status})`);
    }
    if (!game.players.has(npub)) {
      logger.warn({ gameId, npub, registeredPlayers: Array.from(game.players) }, 'Unregistered player attempted bet');
      throw new Error('Player not registered');
    }

    const now = Date.now();
    
    // Check if game has ended
    if (game.endAt && now >= game.endAt) {
      throw new Error('Game has ended');
    }

    // Check debounce
    const lastBetTime = game.lastBetTimes.get(npub) || 0;
    const timeSinceLastBet = now - lastBetTime;
    if (timeSinceLastBet < config.betDebounceMs) {
      logger.debug({ gameId, npub, timeSinceLastBet, required: config.betDebounceMs }, 'Bet rejected due to debounce');
      throw new Error(`Too fast, please wait ${config.betDebounceMs - timeSinceLastBet}ms`);
    }

    // Check rate limit
    try {
      await this.rateLimiter.consume(npub);
    } catch (error) {
      logger.debug({ gameId, npub }, 'Bet rejected due to rate limit');
      throw new Error('Rate limit exceeded - wait a moment');
    }

    // Update game state
    game.holder = npub;
    game.lastBetTimes.set(npub, now);

    // Update recent bettors (keep top 3 distinct)
    game.recentBettors = game.recentBettors.filter(b => b !== npub);
    game.recentBettors.unshift(npub);
    game.recentBettors = game.recentBettors.slice(0, 3);

    // Update Redis
    await this.redis.set(
      `game:${gameId}:holder`,
      npub
    );
    await this.redis.set(
      `game:${gameId}:recentBettors`,
      JSON.stringify(game.recentBettors)
    );

    // Broadcast update
    this.broadcast(gameId, {
      type: 'betUpdate',
      holder: npub,
      recentBettors: game.recentBettors.map(n => ({
        npub: n,
        ...this.profiles.get(n)
      }))
    });

    logger.debug({ gameId, npub }, 'Bet processed');
    return true;
  }

  // Get game state
  async getGameState(gameId: string): Promise<any> {
    const game = this.games.get(gameId);
    if (!game) {
      // Try to load from Redis
      const data = await this.redis.get(`game:${gameId}`);
      if (!data) throw new Error('Game not found');
      return JSON.parse(data);
    }

    const now = Date.now();
    const timeRemaining = game.endAt ? Math.max(0, game.endAt - now) : undefined;
    const showTimer = timeRemaining !== undefined && timeRemaining <= 3000;

    return {
      id: game.id,
      status: game.status,
      startAt: game.startAt,
      endAt: game.endAt,
      holder: game.holder,
      winner: game.winner,
      playersCount: game.players.size,
      recentBettors: game.recentBettors.map(n => ({
        npub: n,
        ...this.profiles.get(n)
      })),
      timeRemaining: showTimer ? timeRemaining : undefined,
      prizeSummary: game.prizeSummary // Include prize summary (but not raw token)
    };
  }

  // WebSocket management
  addWebSocketClient(gameId: string, ws: WebSocket): void {
    if (!this.wsClients.has(gameId)) {
      this.wsClients.set(gameId, new Set());
    }
    this.wsClients.get(gameId)!.add(ws);
  }

  removeWebSocketClient(gameId: string, ws: WebSocket): void {
    const clients = this.wsClients.get(gameId);
    if (clients) {
      clients.delete(ws);
      if (clients.size === 0) {
        this.wsClients.delete(gameId);
      }
    }
  }

  private broadcast(gameId: string, data: any): void {
    const clients = this.wsClients.get(gameId);
    if (!clients) return;

    const message = JSON.stringify(data);
    for (const ws of clients) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(message);
      }
    }
  }

  // Set prize for a game (admin only)
  async setPrize(gameId: string, token: string, adminKey: string): Promise<{ prizeSummary: any }> {
    const game = this.games.get(gameId);
    if (!game) throw new Error('Game not found');
    if (game.adminKey !== adminKey) throw new Error('Invalid admin key');
    if (game.status !== 'lobby') throw new Error('Can only set prize during lobby');

    // Store token in memory only
    game.prizeToken = token;
    
    // Create best-effort prize summary
    const prizeSummary = this.parseCashuToken(token);
    game.prizeSummary = prizeSummary;

    // Log the token as requested by PM
    logger.info({ gameId, prizeToken: token }, 'Prize token set');

    // Broadcast prize update to all clients (but not the raw token)
    this.broadcast(gameId, {
      type: 'prizeUpdated',
      prizeSummary
    });

    // Update Redis (without token or adminKey)
    try {
      await this.redis.set(
        `game:${gameId}`,
        JSON.stringify({
          id: gameId,
          status: game.status,
          startAt: game.startAt,
          players: Array.from(game.players),
          prizeSummary
        })
      );
    } catch (error) {
      logger.error({ error, gameId }, 'Failed to update game with prize in Redis');
    }

    return { prizeSummary };
  }

  // Parse Cashu token for display (best effort)
  private parseCashuToken(token: string): { display: string; amount?: number } {
    try {
      // Basic Cashu token parsing - this is best effort
      if (token.startsWith('cashuA')) {
        // Try to decode and extract amount
        const decoded = JSON.parse(atob(token.slice(6)));
        const proofs = decoded?.token?.[0]?.proofs;
        if (proofs && Array.isArray(proofs)) {
          const amount = proofs.reduce((sum: number, proof: any) => sum + (proof.amount || 0), 0);
          return {
            display: `${amount} sats`,
            amount
          };
        }
      }
      
      // Fallback for any format
      return {
        display: 'Cashu Token Prize',
        amount: undefined
      };
    } catch (error) {
      logger.debug({ error }, 'Failed to parse Cashu token');
      return {
        display: 'Mystery Prize Token',
        amount: undefined
      };
    }
  }

  // Start pre-start countdown (admin only)
  async startPrestartCountdown(gameId: string, adminKey: string): Promise<void> {
    const game = this.games.get(gameId);
    if (!game) throw new Error('Game not found');
    if (game.adminKey !== adminKey) throw new Error('Invalid admin key');
    if (game.status !== 'lobby') throw new Error('Game must be in lobby to start');

    game.status = 'prestart';
    logger.info({ gameId }, 'Pre-start countdown beginning');

    // Broadcast 10-second countdown
    let secondsRemaining = 10;
    const countdownInterval = setInterval(() => {
      this.broadcast(gameId, {
        type: 'preStartCountdown',
        secondsRemaining
      });

      secondsRemaining--;
      
      if (secondsRemaining < 0) {
        clearInterval(countdownInterval);
        this.startGame(gameId); // Start the actual game
      }
    }, 1000);

    // Initial countdown broadcast
    this.broadcast(gameId, {
      type: 'preStartCountdown',
      secondsRemaining: 10
    });
  }

  // Send prize DM via NIP-17 (NIP-44 + NIP-59)
  private async sendPrizeDM(gameId: string, winnerNpub: string, prizeToken: string): Promise<string | undefined> {
    if (!config.gameNsec) {
      logger.warn({ gameId }, 'GAME_NSEC not configured, skipping DM');
      return undefined;
    }

    try {
      // Decode winner npub to pubkey
      const { data: winnerPubkey } = nip19.decode(winnerNpub);
      if (typeof winnerPubkey !== 'string') {
        throw new Error('Invalid npub format');
      }

      // Normalize game private key
      let gameSecretKey: Uint8Array;
      if (config.gameNsec.startsWith('nsec1')) {
        const { data } = nip19.decode(config.gameNsec);
        gameSecretKey = data as Uint8Array;
      } else {
        // Assume hex format
        gameSecretKey = new Uint8Array(
          config.gameNsec.match(/.{2}/g)?.map(byte => parseInt(byte, 16)) || []
        );
      }

      if (gameSecretKey.length !== 32) {
        throw new Error('Invalid GAME_NSEC format');
      }

      const gamePubkey = getPublicKey(gameSecretKey);

      // Create the kind:14 DM event
      const dmEvent = {
        kind: 14,
        content: prizeToken, // Raw Cashu token
        tags: [
          ['p', winnerPubkey]
        ],
        created_at: Math.floor(Date.now() / 1000),
        pubkey: gamePubkey
      };

      // Seal the DM (kind:13) using NIP-44
      const sealEvent = await this.sealEvent(dmEvent, winnerPubkey, gameSecretKey);
      
      // Gift wrap the sealed event (kind:1059)
      const giftWrapEvent = await this.giftWrapEvent(sealEvent, winnerPubkey, gameSecretKey);

      // Publish to relays
      const publishPromises = config.relays.map(relay => 
        this.pool.publish([relay], giftWrapEvent)
      );

      const results = await Promise.allSettled(publishPromises);
      const successCount = results.filter(r => r.status === 'fulfilled').length;

      logger.info({ 
        gameId, 
        winnerNpub, 
        eventId: giftWrapEvent.id,
        relaysSuccess: successCount,
        relaysTotal: config.relays.length
      }, 'Prize DM sent');

      return giftWrapEvent.id;

    } catch (error) {
      logger.error({ error, gameId, winnerNpub }, 'Failed to send prize DM');
      throw error;
    }
  }

  // Seal event per NIP-59 (kind:13)
  private async sealEvent(event: any, recipientPubkey: string, senderSecretKey: Uint8Array): Promise<Event> {
    const sharedSecret = nip44.getConversationKey(senderSecretKey, recipientPubkey);
    const encryptedContent = nip44.encrypt(JSON.stringify(event), sharedSecret);
    
    const sealEvent = {
      kind: 13,
      content: encryptedContent,
      tags: [],
      created_at: Math.floor(Date.now() / 1000),
      pubkey: getPublicKey(senderSecretKey)
    };

    return finalizeEvent(sealEvent, senderSecretKey);
  }

  // Gift wrap event per NIP-59 (kind:1059)
  private async giftWrapEvent(sealedEvent: Event, recipientPubkey: string, senderSecretKey: Uint8Array): Promise<Event> {
    // Generate random key for gift wrapping
    const randomSecretKey = randomBytes(32);
    const randomPubkey = getPublicKey(randomSecretKey);
    
    const sharedSecret = nip44.getConversationKey(randomSecretKey, recipientPubkey);
    const encryptedContent = nip44.encrypt(JSON.stringify(sealedEvent), sharedSecret);
    
    const giftWrapEvent = {
      kind: 1059,
      content: encryptedContent,
      tags: [
        ['p', recipientPubkey]
      ],
      created_at: Math.floor(Date.now() / 1000),
      pubkey: randomPubkey
    };

    return finalizeEvent(giftWrapEvent, randomSecretKey);
  }

  // Get Redis debug data
  async getDebugRedisData(): Promise<any> {
    try {
      // Get all betting game keys
      const keys = await this.redis.keys('*');
      const data: Record<string, any> = {};
      
      // Fetch values for all keys
      for (const key of keys) {
        try {
          const value = await this.redis.get(key);
          data[key] = value ? JSON.parse(value) : value;
        } catch (parseError) {
          // If not JSON, store as string
          data[key] = await this.redis.get(key);
        }
      }
      
      return {
        keys: keys.length,
        data,
        timestamp: Date.now()
      };
    } catch (error) {
      logger.error({ error }, 'Failed to get Redis debug data');
      throw error;
    }
  }

  // Cleanup
  async cleanup(): Promise<void> {
    await this.redis.quit();
    this.pool.close(config.relays);
  }
}