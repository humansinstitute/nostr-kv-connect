# NostrKV Betting Game Demo

A fast, party-style web game where players paste their NPub to register, then spam a "Bet" button during a secretly-timed round. Built on NostrKV-Connect using Redis as state storage.

## Features

- **Simple Registration**: Players paste their NPub to join
- **Fair Gaming**: Hidden end time (20-40 seconds) with rate limiting
- **Real-time Updates**: WebSocket-powered live leaderboard
- **Nostr Integration**: Fetches player profiles from Nostr relays
- **Winner Celebration**: Puppy animation for the winner!

## Quick Start

1. **Prerequisites**: 
   - Redis server running on localhost:6379
   - Node.js 18+ installed

2. **Install Dependencies**:
   ```bash
   npm install
   ```

3. **Build Project**:
   ```bash
   npm run build
   ```

4. **Start the Demo**:
   ```bash
   npm run demo:betting
   ```

5. **Open Browser**:
   Visit `http://localhost:3001/demo/bettingGame`

## Game Flow

1. **Home**: Click "New Game" to create a new game room
2. **Lobby**: Players register with NPub, 30-second countdown to start
3. **Active**: Spam the BET button! Hidden timer ends between 20-40 seconds
4. **Winner**: Last person to bet when timer ends wins!

## Configuration

Environment variables:
- `REDIS_HOST`: Redis host (default: localhost)  
- `REDIS_PORT`: Redis port (default: 6379)
- `NOSTR_REMOTE_RELAYS`: Comma-separated Nostr relays
- `BETS_PER_SECOND`: Rate limit (default: 4)
- `BET_DEBOUNCE_MS`: Button debounce (default: 200)
- `GAME_TTL_HOURS`: Game data retention (default: 24)

## Architecture

- **Game Server**: Manages game state in Redis via NostrKV-Connect
- **HTTP Server**: Serves frontend and REST API
- **WebSocket Server**: Real-time updates
- **Frontend**: Vanilla JavaScript SPA

## Game Rules

- Players must register with valid NPub before betting
- Rate limited to 4 bets per second per player
- 200ms debounce between bet attempts
- Timer countdown only visible in final 3 seconds
- Winner determined by last successful bet before hidden end time

## Future Enhancements

- Zap payouts (NIP-57 integration)
- Multi-room lobbies
- Host controls
- Better anti-spam measures