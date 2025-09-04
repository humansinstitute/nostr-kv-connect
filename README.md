# NostrKV Connect

A NIP-47-style protocol and service that grants scoped, revocable, per-connection access to a remote Redis key-value store via encrypted Nostr DMs.

**NOTE - Experimentation whilst specifying correctly - on't use yet!**

## Overview

NostrKV Connect adapts the NIP-47 (Nostr Wallet Connect) request/response pattern to provide secure, namespaced access to Redis. Applications can read/write to owner-exposed Redis keys over Nostr without direct network access.

## Features

- **Secure Communication**: Encrypted DMs using NIP-44 (preferred) or NIP-04
- **Namespace Isolation**: Strict key prefix enforcement per connection
- **Rate Limiting**: Configurable requests/minute and bytes/minute budgets
- **Audit Logging**: Append-only audit trail with redacted sensitive data
- **Method Allowlisting**: Per-connection method permissions
- **Size Limits**: Configurable max key length and value size
- **Idempotency**: Request deduplication within time window

## Supported Methods

- `get_info` - Get server capabilities and limits
- `get` - Get a value by key
- `set` - Set a value with optional TTL
- `del` - Delete a key
- `exists` - Check if key exists
- `mget` - Get multiple values (explicit list)
- `expire` - Set expiration on existing key
- `ttl` - Get remaining TTL

## Quick Start

### Prerequisites

- Node.js 20+
- Redis 7+
- Nostr relay access

### Installation

```bash
npm install
npm run build
```

### Configuration

Copy `.env.example` to `.env` and configure:

```bash
# Redis
REDIS_URL=redis://localhost:6379
REDIS_NAMESPACE=appA:

# Nostr
RELAYS=wss://relay.damus.io,wss://relay.nostr.band
SERVER_NSEC=nsec1... # Generate with: npx tsx scripts/generate-uri.ts

# Encryption
ENCRYPTION_PREF=nip44

# Limits
LIMITS_MPS=60           # Max requests/minute
LIMITS_BPS=1048576      # Max bytes/minute
LIMITS_MAXKEY=256       # Max key length
LIMITS_MAXVAL=65536     # Max value size
LIMITS_MGET_MAX=16      # Max items in mget
```

### Quick Demo (Recommended)

```bash
# Start Redis
docker run -p 6379:6379 redis:7

# One-command demo - starts server AND web interface!
npm run demo
```

Then open the URL shown in the terminal (automatically finds available port).

### Running Components Separately

```bash
# Start just the NostrKV server
npm start

# Start just the web interface
npm run test-server
```

### Generate Pairing URI

```bash
npx tsx scripts/generate-uri.ts \
  --server-npub npub1... \
  --relays "wss://relay.damus.io,wss://relay.nostr.band" \
  --namespace "appA:" \
  --methods "get,set,del,exists,mget,expire,ttl,get_info" \
  --mps 60 \
  --bps 1048576
```

### Test with Demo Client

```bash
# Run full demo
npx tsx scripts/demo-client.ts --uri "nostr+kvconnect://..."

# Test single method
npx tsx scripts/demo-client.ts \
  --uri "nostr+kvconnect://..." \
  --method set \
  --key "test:hello" \
  --value "world" \
  --ttl 300
```

## Protocol Details

### Event Kinds
- Request: `23194`
- Response: `23195`

### Request Format
```json
{
  "method": "set",
  "params": {
    "key": "user:123",
    "value": "SGVsbG8gV29ybGQ=",
    "ttl": 3600
  },
  "id": "unique-request-id"
}
```

### Response Format
```json
{
  "result": { "ok": true },
  "error": null,
  "id": "unique-request-id"
}
```

### Error Response
```json
{
  "result": null,
  "error": {
    "code": "RATE_LIMITED",
    "message": "Rate limit exceeded"
  },
  "id": "unique-request-id"
}
```

## Error Codes

- `UNAUTHORIZED` - Client not authorized
- `RESTRICTED` - Method/key not allowed
- `RATE_LIMITED` - Rate or byte limit exceeded
- `PAYLOAD_TOO_LARGE` - Key/value size exceeded
- `INVALID_KEY` - Invalid key format
- `INVALID_VALUE` - Invalid value format
- `NOT_IMPLEMENTED` - Method not implemented
- `INTERNAL` - Internal server error

## Security Considerations

1. **Never log secrets**: All keys/values are redacted in logs
2. **Namespace enforcement**: Keys outside namespace are rejected
3. **Escape prevention**: Common escape patterns blocked
4. **Rate limiting**: Per-client sliding window limits
5. **Encryption**: Always use NIP-44 when possible

## Development

### Project Structure
```
src/
├── keys/         # Key management
├── relays/       # Relay pool management
├── crypto/       # DM encryption/decryption
├── protocol/     # Request routing & validation
├── limits/       # Rate limiting & validation
├── namespacing/  # Namespace enforcement
├── redis/        # Redis KV adapters
├── audit/        # Audit logging
└── server.ts     # Main server
```

### Testing
```bash
npm test
```

### Building
```bash
npm run build
```

## License

MIT
