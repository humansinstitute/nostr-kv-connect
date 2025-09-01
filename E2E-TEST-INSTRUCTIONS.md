# End-to-End NostrKV Connect Test

This test demonstrates the **complete flow** from Nostr message to Redis database.

## What The E2E Test Does

🎯 **Full Integration Test:**
1. ✅ Sends **real encrypted Nostr DM** (kind 23194) to your server
2. ✅ Server **decrypts and processes** the request  
3. ✅ Server **writes data to Docker Redis** database
4. ✅ Server **sends encrypted response** (kind 23195) back
5. ✅ Client **receives and decrypts** the response
6. ✅ **Verifies Redis data** matches what was sent
7. ✅ Tests multiple operations (set, get, mget, del)

## Prerequisites

1. **Docker Redis running:**
   ```bash
   docker run -d -p 6379:6379 --name nostrkv-redis redis:7
   ```

2. **NostrKV server running:**
   ```bash
   npm run demo
   ```
   (Leave this running in one terminal)

## Run The Test

### Option 1: Automatic (Recommended)
```bash
# In a NEW terminal window:
npm run e2e-test
```
This automatically finds your running server and runs the full test.

### Option 2: Manual
```bash
# Get the URI from your demo terminal, then:
npm run e2e-manual "nostr+kvconnect://npub1...?relay=..."
```

## Expected Output

You should see something like:

```
🚀 Starting End-to-End NostrKV Connect Test
==================================================

🔧 E2E Test Client Initialized
   Client:    npub1abc123...
   Server:    npub1xyz789...
   Namespace: testapp:
   Relays:    wss://relay.damus.io, wss://relay.nostr.band

🧪 Test 1: Server Info
------------------------------
📤 Sending get_info request: {}
📡 Publishing to relays: wss://relay.damus.io, wss://relay.nostr.band
📥 Received get_info response: { "result": {...}, "error": null }
✅ Server info retrieved successfully

🧪 Test 2: Set Value  
------------------------------
📤 Sending set request: {
  "key": "e2e:test:1756644123456",
  "value": "SGVsbG8gTm9zdHJLViE=",
  "ttl": 300
}
📡 Publishing to relays: wss://relay.damus.io, wss://relay.nostr.band
📥 Received set response: { "result": { "ok": true }, "error": null }
✅ Value set successfully

🧪 Test 3: Direct Redis Verification
------------------------------
🔍 Direct Redis check for "testapp:e2e:test:1756644123456": "Hello NostrKV!"
✅ Value found in Redis: Hello NostrKV!
✅ Redis value matches what we sent!

🧪 Test 4: Get Value via Nostr
------------------------------
📤 Sending get request: { "key": "e2e:test:1756644123456" }
📥 Received get response: { "result": { "value": "SGVsbG8gTm9zdHJLViE=" } }
✅ Value retrieved via Nostr: Hello NostrKV!
✅ Retrieved value matches original!

🧪 Test 5: Multiple Operations
------------------------------
✅ Multiple values set
✅ Multiple values retrieved:
   item1: Value for item1
   item2: Value for item2  
   item3: Value for item3

🧪 Test 6: Redis Database State
------------------------------
📊 All Redis keys in namespace "testapp:":
[
  "testapp:e2e:test:1756644123456",
  "testapp:item1",
  "testapp:item2", 
  "testapp:item3"
]

🧪 Test 7: Cleanup
------------------------------
✅ Test data cleaned up

🎉 END-TO-END TEST COMPLETED SUCCESSFULLY!
==================================================
✅ Nostr messages sent and received
✅ Redis database updated correctly  
✅ Full encryption/decryption working
✅ All operations functional
```

## What To Watch In Your Demo Terminal

While the test runs, you should see activity in your `npm run demo` terminal:

```
📥 Processing request: set
📤 Response sent to client
📥 Processing request: get  
📤 Response sent to client
[etc...]
```

## Verification Commands

After the test, you can manually verify Redis:

```bash
# Connect to Redis container
docker exec -it nostrkv-redis redis-cli

# List all keys
127.0.0.1:6379> KEYS testapp:*

# Check a specific key
127.0.0.1:6379> GET testapp:some-key

# Exit Redis
127.0.0.1:6379> EXIT
```

## Troubleshooting

**"No running NostrKV web server found"**
- Make sure `npm run demo` is running in another terminal
- Check that the web interface is accessible at http://localhost:3001

**"Request timeout"**  
- Verify Redis is running: `docker ps | grep redis`
- Check relay connectivity (some relays may be slow)
- Ensure your `.env` file has valid `SERVER_NSEC`

**"Redis check failed"**
- Ensure Docker Redis is running on port 6379
- Check Redis URL in `.env` matches your Docker setup

## Success Criteria

✅ **Full Integration Working When:**
- Test completes without errors
- Values written to Redis match sent values  
- All Nostr messages encrypt/decrypt properly
- Multiple relay communication works
- Namespace enforcement works correctly

This test proves your NostrKV Connect system is working end-to-end! 🎉