# NostrKV Connect Web Test Interface

A simple web interface for testing the NostrKV Connect service. This allows you to:
- Add key-value pairs via a form
- View all stored data in a list
- Test connection to your NostrKV server
- Monitor basic statistics

## Features

- **Connection Testing** - Verify your NostrKV Connect URI works
- **Data Entry Form** - Add keys, values, and optional TTL
- **Data Viewer** - See all stored key-value pairs
- **Statistics Display** - View namespace, limits, and key count
- **Interactive Controls** - Delete individual keys or clear all data

## Usage

### Method 1: Direct File Opening
1. Open `index.html` in your web browser
2. The interface will load with a demo configuration

### Method 2: Local HTTP Server
```bash
# From the web-test directory
python3 -m http.server 8080
# Then visit http://localhost:8080
```

### Method 3: With NostrKV Server
1. Start your NostrKV Connect server
2. Generate a pairing URI using the CLI tool
3. Paste the URI into the web interface
4. Click "Test Connection" to verify

## Demo Mode

The web interface includes a **demo mode** that simulates the NostrKV Connect protocol using localStorage. This allows you to test the interface without running the full NostrKV server.

### Demo Features:
- Simulates all KV operations (get, set, delete, exists)
- Uses localStorage to persist data during browser session
- Implements TTL expiration checking
- Shows realistic response times (300-1000ms delays)

## Testing Workflow

1. **Configure Connection**
   - Enter your NostrKV Connect URI
   - Click "Test Connection"
   - Verify server info loads

2. **Add Data**
   - Enter a key (e.g., "user:123")
   - Enter a value (e.g., "John Doe")
   - Optionally set TTL in seconds
   - Click "Add Data"

3. **View Data**
   - Click "Refresh Data" to load all stored pairs
   - See key-value pairs displayed in organized cards
   - View statistics (total keys, namespace, limits)

4. **Manage Data**
   - Delete individual keys using the delete button
   - Check if specific keys exist
   - Clear all data with the "Clear All Data" button

## Example URI Format

```
nostr+kvconnect://npub1serverkey?relay=wss://relay.damus.io&relay=wss://nos.lol&secret=nsec1clientkey&ns=myapp:&cmds=get,set,del,exists,mget,expire,ttl,get_info&mps=60&bps=1048576
```

## Troubleshooting

### "Please test connection first" Error
- Make sure you've entered a valid NostrKV Connect URI
- Click "Test Connection" before trying other operations

### Connection Timeout
- Check that your NostrKV server is running
- Verify the relays in your URI are accessible
- Ensure Redis is running and accessible

### Demo Mode Issues
- Clear your browser's localStorage if data seems corrupted
- Refresh the page to reset the demo state

## Real vs Demo Mode

**Demo Mode (Default):**
- Uses browser localStorage
- No network communication
- Perfect for UI testing and development
- Data persists only during browser session

**Real Mode:**
- Requires running NostrKV Connect server
- Uses actual Nostr relays for communication
- Data persists in Redis
- Full encryption and authentication

## Integration Notes

To integrate this with a real NostrKV Connect setup:

1. Replace the simulated client with actual nostr-tools implementation
2. Add proper NIP-44/NIP-04 encryption
3. Implement real relay communication
4. Add proper error handling for network issues

The current implementation provides a fully functional demo that shows how the real system would work, making it perfect for testing and development purposes.