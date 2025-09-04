class BettingGame {
    constructor() {
        this.gameId = null;
        this.npub = null;
        this.profile = null;
        this.ws = null;
        this.gameState = null;
        this.betDebounce = null;
        this.countdownInterval = null;
        this.debugMessages = [];
        this.redisKeys = new Set();
        this.adminKey = null; // Store admin key
        this.isAdmin = false;
        
        this.screens = {
            home: document.getElementById('home-screen'),
            lobby: document.getElementById('lobby-screen'),
            game: document.getElementById('game-screen'),
            winner: document.getElementById('winner-screen')
        };
        
        this.init();
    }
    
    init() {
        // Setup debug panel
        this.setupDebugPanel();
        
        // Check if we're on a game page
        const path = window.location.pathname;
        const match = path.match(/\/demo\/bettingGame\/([a-z0-9]{8})$/);
        
        if (match) {
            this.gameId = match[1];
            this.loadGame();
        } else {
            this.showScreen('home');
            this.setupHomeScreen();
        }
    }
    
    setupDebugPanel() {
        const toggleBtn = document.getElementById('toggle-debug');
        const debugContent = document.getElementById('debug-content');
        
        if (toggleBtn && debugContent) {
            toggleBtn.addEventListener('click', () => {
                debugContent.classList.toggle('hidden');
                if (!debugContent.classList.contains('hidden')) {
                    this.fetchRedisData();
                    this.startDebugPolling();
                } else {
                    this.stopDebugPolling();
                }
            });
        }
    }
    
    startDebugPolling() {
        this.debugInterval = setInterval(() => {
            this.fetchRedisData();
        }, 2000); // Update every 2 seconds
    }
    
    stopDebugPolling() {
        if (this.debugInterval) {
            clearInterval(this.debugInterval);
            this.debugInterval = null;
        }
    }
    
    async fetchRedisData() {
        try {
            const response = await fetch('/demo/bettingGame/api/debug/redis');
            const data = await response.json();
            this.updateRedisDebugData(data);
        } catch (error) {
            console.error('Failed to fetch Redis data:', error);
        }
    }
    
    updateRedisDebugData(redisData) {
        // Extract all keys
        Object.keys(redisData.data).forEach(key => {
            if (key.startsWith('nkvc:bettingGame:')) {
                this.redisKeys.add(key);
            }
        });
        
        this.updateRedisKeys();
        this.addDebugMessage('incoming', 'Redis', { 
            keysCount: redisData.keys, 
            bettingKeys: Array.from(this.redisKeys).length,
            timestamp: new Date(redisData.timestamp).toLocaleTimeString()
        });
    }
    
    showScreen(screenName) {
        Object.values(this.screens).forEach(screen => {
            screen.classList.add('hidden');
        });
        
        if (this.screens[screenName]) {
            this.screens[screenName].classList.remove('hidden');
        }
    }
    
    setupHomeScreen() {
        const newGameBtn = document.getElementById('new-game-btn');
        newGameBtn.addEventListener('click', () => this.createGame());
    }
    
    async createGame() {
        try {
            const response = await fetch('/demo/bettingGame/api/new-game', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' }
            });
            
            const data = await response.json();
            this.gameId = data.gameId;
            this.adminKey = data.adminKey; // Store admin key
            this.isAdmin = true;
            
            // Save admin key in localStorage for this game
            localStorage.setItem(`adminKey:${this.gameId}`, this.adminKey);
            
            // Navigate to game page
            window.history.pushState({}, '', `/demo/bettingGame/${this.gameId}`);
            this.loadGame();
        } catch (error) {
            console.error('Failed to create game:', error);
            alert('Failed to create game. Please try again.');
        }
    }
    
    async loadGame() {
        try {
            // Check if we have admin key for this game
            const storedAdminKey = localStorage.getItem(`adminKey:${this.gameId}`);
            if (storedAdminKey) {
                this.adminKey = storedAdminKey;
                this.isAdmin = true;
            }
            
            // Fetch game state
            const response = await fetch(`/demo/bettingGame/api/game/${this.gameId}`);
            if (!response.ok) {
                throw new Error('Game not found');
            }
            
            this.gameState = await response.json();
            
            // Connect WebSocket
            this.connectWebSocket();
            
            // Show appropriate screen based on game status
            if (this.gameState.status === 'lobby' || this.gameState.status === 'prestart') {
                this.showLobbyScreen();
            } else if (this.gameState.status === 'active') {
                if (this.npub) {
                    this.showGameScreen();
                } else {
                    this.showLobbyScreen(); // Show registration even during active game
                }
            } else if (this.gameState.status === 'ended') {
                this.showWinnerScreen();
            }
        } catch (error) {
            console.error('Failed to load game:', error);
            alert('Game not found');
            window.location.href = '/demo/bettingGame';
        }
    }
    
    connectWebSocket() {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}?gameId=${this.gameId}`;
        
        this.ws = new WebSocket(wsUrl);
        
        this.ws.onopen = () => {
            console.log('WebSocket connected');
        };
        
        this.ws.onmessage = (event) => {
            const message = JSON.parse(event.data);
            this.addDebugMessage('incoming', 'WebSocket', message);
            this.handleWebSocketMessage(message);
        };
        
        this.ws.onerror = (error) => {
            console.error('WebSocket error:', error);
        };
        
        this.ws.onclose = () => {
            console.log('WebSocket disconnected');
            // Attempt to reconnect after 2 seconds
            setTimeout(() => {
                if (this.gameState?.status !== 'ended') {
                    this.connectWebSocket();
                }
            }, 2000);
        };
    }
    
    handleWebSocketMessage(message) {
        switch (message.type) {
            case 'state':
                this.gameState = message;
                this.updateUI();
                break;
                
            case 'gameStart':
                this.gameState.status = 'active';
                if (this.npub) {
                    this.showGameScreen();
                }
                break;
                
            case 'gameEnd':
                this.gameState.status = 'ended';
                this.gameState.winner = message.winner;
                this.gameState.winnerProfile = message.winnerProfile;
                this.showWinnerScreen();
                break;
                
            case 'betUpdate':
                this.gameState.holder = message.holder;
                this.gameState.recentBettors = message.recentBettors;
                this.updateLeaderboard();
                break;
                
            case 'finalCountdown':
                this.gameState.timeRemaining = message.timeRemaining;
                this.updateFinalCountdown();
                break;
                
            case 'playerJoined':
                this.gameState.playersCount = message.playersCount;
                this.updatePlayersCount();
                break;
                
            case 'registered':
                this.profile = message.profile;
                this.showRegistrationSuccess();
                if (this.gameState.status === 'active') {
                    this.showGameScreen();
                }
                break;
                
            case 'prizeUpdated':
                this.gameState.prizeSummary = message.prizeSummary;
                this.updatePrizeDisplay();
                break;
                
            case 'preStartCountdown':
                this.gameState.status = 'prestart';
                this.updatePreStartCountdown(message.secondsRemaining);
                break;
                
            case 'prizeSent':
                console.log('Prize sent to winner:', message.recipientNpub, 'Event ID:', message.eventId);
                this.addDebugMessage('incoming', 'Prize', { 
                    sent: true, 
                    eventId: message.eventId,
                    recipient: message.recipientNpub
                });
                break;
                
            case 'error':
                this.handleError(message.message);
                break;
        }
    }
    
    showLobbyScreen() {
        this.showScreen('lobby');
        
        // Setup share link
        const shareLink = document.getElementById('share-link');
        const currentUrl = window.location.href;
        shareLink.value = currentUrl;
        
        document.getElementById('copy-link-btn').addEventListener('click', () => {
            shareLink.select();
            document.execCommand('copy');
            alert('Link copied to clipboard!');
        });
        
        // Generate QR code (with a small delay to ensure library is loaded)
        setTimeout(() => {
            this.generateQRCode(currentUrl);
        }, 100);
        
        // Setup registration
        const registerBtn = document.getElementById('register-btn');
        const npubInput = document.getElementById('npub-input');
        
        // Load saved npub if exists
        const savedNpub = localStorage.getItem('npub');
        if (savedNpub) {
            npubInput.value = savedNpub;
        }
        
        registerBtn.addEventListener('click', () => this.register());
        npubInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                this.register();
            }
        });
        
        // Setup admin controls
        this.setupAdminControls();
        
        // Update players count
        this.updatePlayersCount();
        
        // Start countdown (or show prestart countdown if in prestart)
        if (this.gameState?.status === 'prestart') {
            this.showPreStartCountdown();
        } else if (this.gameState?.startAt && this.gameState.startAt > 0) {
            this.startLobbyCountdown();
        } else {
            // Manual start - hide countdown display
            const countdownDisplay = document.querySelector('.countdown-display');
            if (countdownDisplay) {
                countdownDisplay.style.display = 'none';
            }
        }
    }
    
    async register() {
        const npubInput = document.getElementById('npub-input');
        const npub = npubInput.value.trim();
        
        if (!npub) {
            this.showRegistrationError('Please enter your NPub');
            return;
        }
        
        if (!npub.startsWith('npub1')) {
            this.showRegistrationError('Invalid NPub format (should start with npub1)');
            return;
        }
        
        try {
            const response = await fetch('/demo/bettingGame/api/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ gameId: this.gameId, npub })
            });
            
            const data = await response.json();
            
            if (!response.ok) {
                throw new Error(data.error || 'Registration failed');
            }
            
            this.npub = npub;
            this.profile = data;
            
            // Save npub for future use
            localStorage.setItem('npub', npub);
            
            // Send registration via WebSocket too
            if (this.ws?.readyState === WebSocket.OPEN) {
                this.ws.send(JSON.stringify({ type: 'register', npub }));
            }
            
            this.showRegistrationSuccess();
            
            // If game is already active, go to game screen
            if (this.gameState?.status === 'active') {
                this.showGameScreen();
            }
        } catch (error) {
            this.showRegistrationError(error.message);
        }
    }
    
    showRegistrationError(message) {
        const errorDiv = document.getElementById('registration-error');
        const successDiv = document.getElementById('registration-success');
        
        errorDiv.textContent = message;
        errorDiv.classList.remove('hidden');
        successDiv.classList.add('hidden');
        
        setTimeout(() => {
            errorDiv.classList.add('hidden');
        }, 5000);
    }
    
    showRegistrationSuccess() {
        const errorDiv = document.getElementById('registration-error');
        const successDiv = document.getElementById('registration-success');
        
        const displayName = this.profile?.displayName || this.profile?.name || 'Anonymous';
        successDiv.textContent = `Registered as ${displayName}`;
        successDiv.classList.remove('hidden');
        errorDiv.classList.add('hidden');
    }
    
    startLobbyCountdown() {
        const countdownEl = document.getElementById('lobby-countdown');
        
        if (this.countdownInterval) {
            clearInterval(this.countdownInterval);
        }
        
        this.countdownInterval = setInterval(() => {
            const now = Date.now();
            const timeUntilStart = Math.max(0, this.gameState.startAt - now);
            const seconds = Math.ceil(timeUntilStart / 1000);
            
            countdownEl.textContent = seconds;
            
            if (seconds <= 0) {
                clearInterval(this.countdownInterval);
            }
        }, 100);
    }
    
    showGameScreen() {
        this.showScreen('game');
        
        // Setup bet button
        const betBtn = document.getElementById('bet-btn');
        betBtn.addEventListener('click', () => this.placeBet());
        
        // Update leaderboard
        this.updateLeaderboard();
        
        // Start checking for final countdown
        this.checkFinalCountdown();
    }
    
    async placeBet() {
        if (!this.npub) {
            alert('Please register first');
            return;
        }
        
        const betBtn = document.getElementById('bet-btn');
        const feedback = document.getElementById('bet-feedback');
        
        // Debounce check
        if (this.betDebounce) {
            feedback.textContent = 'Too fast!';
            feedback.className = 'bet-feedback throttled';
            return;
        }
        
        // Disable button
        betBtn.disabled = true;
        this.betDebounce = true;
        
        try {
            let success = false;
            
            // Try WebSocket first (faster)
            if (this.ws?.readyState === WebSocket.OPEN) {
                const message = { type: 'bet', npub: this.npub };
                this.ws.send(JSON.stringify(message));
                this.addDebugMessage('outgoing', 'WebSocket', message);
                feedback.textContent = 'Bet placed!';
                feedback.className = 'bet-feedback success';
                success = true;
            } else {
                // Fallback to HTTP if WebSocket not available
                const response = await fetch('/demo/bettingGame/api/bet', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ gameId: this.gameId, npub: this.npub })
                });
                
                const data = await response.json();
                
                if (!response.ok) {
                    console.error('Bet failed:', data);
                    throw new Error(data.error || 'Bet failed');
                }
                
                feedback.textContent = 'Bet placed!';
                feedback.className = 'bet-feedback success';
                success = true;
            }
        } catch (error) {
            console.error('Bet error:', error);
            feedback.textContent = error.message;
            feedback.className = 'bet-feedback error';
        }
        
        // Re-enable after debounce period
        setTimeout(() => {
            betBtn.disabled = false;
            this.betDebounce = false;
            feedback.textContent = '';
        }, 200);
    }
    
    updateLeaderboard() {
        // Update current holder
        const holderDiv = document.getElementById('current-holder');
        if (this.gameState?.holder) {
            const holder = this.gameState.recentBettors?.find(b => b.npub === this.gameState.holder);
            const name = holder?.displayName || holder?.name || this.gameState.holder.slice(0, 8) + '...';
            
            holderDiv.innerHTML = `
                <div class="holder-avatar">👑</div>
                <div class="holder-name">${name}</div>
            `;
        } else {
            holderDiv.innerHTML = `
                <div class="holder-avatar">❓</div>
                <div class="holder-name">Nobody yet...</div>
            `;
        }
        
        // Update recent bettors
        const bettorsDiv = document.getElementById('recent-bettors');
        if (this.gameState?.recentBettors && this.gameState.recentBettors.length > 0) {
            bettorsDiv.innerHTML = this.gameState.recentBettors.map((bettor, index) => {
                const name = bettor.displayName || bettor.name || bettor.npub.slice(0, 8) + '...';
                const position = ['🥇', '🥈', '🥉'][index] || '';
                
                return `
                    <div class="bettor-item">
                        <div class="bettor-position">${position}</div>
                        <div class="bettor-avatar">${name[0].toUpperCase()}</div>
                        <div class="bettor-name">${name}</div>
                    </div>
                `;
            }).join('');
        } else {
            bettorsDiv.innerHTML = '<div class="empty-state">No bets yet...</div>';
        }
    }
    
    updateFinalCountdown() {
        const finalCountdown = document.getElementById('final-countdown');
        const finalSeconds = document.getElementById('final-seconds');
        
        if (this.gameState?.timeRemaining !== undefined && this.gameState.timeRemaining <= 3000) {
            finalCountdown.classList.remove('hidden');
            finalSeconds.textContent = Math.ceil(this.gameState.timeRemaining / 1000);
        } else {
            finalCountdown.classList.add('hidden');
        }
    }
    
    checkFinalCountdown() {
        // This method is now mainly for fallback if WebSocket updates fail
        const finalCountdown = document.getElementById('final-countdown');
        const finalSeconds = document.getElementById('final-seconds');
        
        const checkInterval = setInterval(() => {
            if (this.gameState?.timeRemaining !== undefined && this.gameState.timeRemaining <= 3000) {
                finalCountdown.classList.remove('hidden');
                finalSeconds.textContent = Math.ceil(this.gameState.timeRemaining / 1000);
            } else {
                finalCountdown.classList.add('hidden');
            }
            
            if (this.gameState?.status === 'ended') {
                clearInterval(checkInterval);
            }
        }, 100);
    }
    
    showWinnerScreen() {
        this.showScreen('winner');
        
        const winnerName = document.querySelector('.winner-name');
        const winnerAvatar = document.querySelector('.winner-avatar');
        
        if (this.gameState?.winner) {
            const profile = this.gameState.winnerProfile;
            const name = profile?.displayName || profile?.name || this.gameState.winner.slice(0, 8) + '...';
            
            winnerName.textContent = name;
            winnerAvatar.textContent = '🏆';
        } else {
            winnerName.textContent = 'No winner';
            winnerAvatar.textContent = '❓';
        }
        
        // Setup winner debug panel
        this.setupWinnerDebugPanel();
        
        // Setup play again button
        document.getElementById('play-again-btn').addEventListener('click', () => {
            window.location.href = '/demo/bettingGame';
        });
    }
    
    setupWinnerDebugPanel() {
        const toggleBtn = document.getElementById('winner-toggle-debug');
        const debugContent = document.getElementById('winner-debug-content');
        
        if (toggleBtn && debugContent) {
            toggleBtn.addEventListener('click', () => {
                debugContent.classList.toggle('hidden');
                if (!debugContent.classList.contains('hidden')) {
                    this.showWinnerDebugData();
                }
            });
        }
    }
    
    async showWinnerDebugData() {
        // Show final game state
        const gameStateContainer = document.getElementById('winner-debug-game-state');
        if (gameStateContainer && this.gameState) {
            const finalState = {
                ...this.gameState,
                gameDuration: this.gameState.endAt && this.gameState.startAt ? 
                    `${Math.round((this.gameState.endAt - this.gameState.startAt) / 1000)}s` : 'unknown',
                winnerProfile: this.gameState.winnerProfile,
                totalPlayers: this.gameState.playersCount || 0,
                finalHolder: this.gameState.holder,
                recentBettors: this.gameState.recentBettors
            };
            
            gameStateContainer.textContent = JSON.stringify(finalState, null, 2);
        }
        
        // Show Redis keys used
        const redisContainer = document.getElementById('winner-debug-redis-keys');
        if (redisContainer) {
            redisContainer.innerHTML = Array.from(this.redisKeys).map(key => 
                `<span class="redis-key" data-key="${key}" onclick="navigator.clipboard.writeText('${key}')">${key}</span>`
            ).join('');
        }
        
        // Show game timeline
        const timelineContainer = document.getElementById('winner-debug-timeline');
        if (timelineContainer) {
            const gameEvents = this.debugMessages.filter(msg => 
                msg.source === 'WebSocket' || msg.source === 'Redis'
            );
            
            timelineContainer.innerHTML = gameEvents.map(msg => `
                <div class="debug-message ${msg.type}">
                    <div class="debug-message-time">${msg.timestamp} [${msg.source}]</div>
                    <div>${JSON.stringify(msg.data, null, 2)}</div>
                </div>
            `).join('');
        }
        
        // Fetch final Redis state
        try {
            const response = await fetch('/demo/bettingGame/api/debug/redis');
            const redisData = await response.json();
            
            // Add final Redis snapshot to timeline
            this.addDebugMessage('incoming', 'Redis Final', {
                gameComplete: true,
                totalKeys: redisData.keys,
                gameKeys: Object.keys(redisData.data).filter(k => k.includes(this.gameId)).length,
                finalSnapshot: new Date().toLocaleTimeString()
            });
            
            // Refresh timeline with final data
            this.showWinnerDebugData();
        } catch (error) {
            console.error('Failed to fetch final Redis data:', error);
        }
    }
    
    updatePlayersCount() {
        const countEl = document.getElementById('players-count');
        if (countEl && this.gameState) {
            countEl.textContent = this.gameState.playersCount || 0;
        }
    }
    
    updateUI() {
        if (this.gameState.status === 'lobby') {
            this.updatePlayersCount();
        } else if (this.gameState.status === 'active') {
            this.updateLeaderboard();
        }
    }
    
    handleError(message) {
        console.error('Game error:', message);
        this.addDebugMessage('error', 'Error', { error: message });
    }
    
    addDebugMessage(type, source, data) {
        const timestamp = new Date().toLocaleTimeString();
        this.debugMessages.push({ type, source, data, timestamp });
        
        // Keep only last 50 messages
        if (this.debugMessages.length > 50) {
            this.debugMessages.shift();
        }
        
        this.updateDebugMessages();
        
        // Track Redis keys mentioned in messages
        if (data && typeof data === 'object') {
            this.extractRedisKeys(data);
        }
    }
    
    extractRedisKeys(data) {
        const dataStr = JSON.stringify(data);
        const keyPattern = /nkvc:bettingGame:[a-zA-Z0-9:]+/g;
        const matches = dataStr.match(keyPattern);
        
        if (matches) {
            matches.forEach(key => {
                this.redisKeys.add(key);
                this.highlightRedisKey(key);
            });
            this.updateRedisKeys();
        }
    }
    
    highlightRedisKey(key) {
        setTimeout(() => {
            const keyElement = document.querySelector(`[data-key="${key}"]`);
            if (keyElement) {
                keyElement.classList.add('updated');
                setTimeout(() => keyElement.classList.remove('updated'), 1000);
            }
        }, 100);
    }
    
    updateDebugMessages() {
        const container = document.getElementById('debug-ws-messages');
        if (!container) return;
        
        container.innerHTML = this.debugMessages.slice(-20).map(msg => `
            <div class="debug-message ${msg.type}">
                <div class="debug-message-time">${msg.timestamp} [${msg.source}]</div>
                <div>${JSON.stringify(msg.data, null, 2)}</div>
            </div>
        `).join('');
        
        container.scrollTop = container.scrollHeight;
    }
    
    updateRedisKeys() {
        const container = document.getElementById('debug-redis-keys');
        if (!container) return;
        
        container.innerHTML = Array.from(this.redisKeys).map(key => 
            `<span class="redis-key" data-key="${key}" onclick="navigator.clipboard.writeText('${key}')">${key}</span>`
        ).join('');
    }
    
    updateDebugGameState() {
        const container = document.getElementById('debug-game-state');
        if (!container || !this.gameState) return;
        
        container.textContent = JSON.stringify({
            ...this.gameState,
            profile: this.profile,
            npub: this.npub,
            wsConnected: this.ws?.readyState === WebSocket.OPEN
        }, null, 2);
    }
    
    setupAdminControls() {
        const adminControls = document.getElementById('admin-controls');
        const showAdminBtn = document.getElementById('show-admin-btn');
        
        if (this.isAdmin) {
            showAdminBtn.textContent = '🔑 Admin Controls';
            
            // Show/hide admin controls
            showAdminBtn.addEventListener('click', () => {
                adminControls.classList.toggle('hidden');
                if (!adminControls.classList.contains('hidden')) {
                    showAdminBtn.textContent = 'Hide Admin Controls';
                } else {
                    showAdminBtn.textContent = '🔑 Admin Controls';
                }
            });
            
            // Setup prize controls
            const setPrizeBtn = document.getElementById('set-prize-btn');
            const prizeTokenInput = document.getElementById('prize-token-input');
            
            setPrizeBtn.addEventListener('click', () => this.setPrize());
            prizeTokenInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    this.setPrize();
                }
            });
            
            // Setup start game controls
            const startGameBtn = document.getElementById('start-game-btn');
            startGameBtn.addEventListener('click', () => this.startGame());
            
            // Enable start button if we have prize or allow without prize
            this.updateStartGameButton();
            
            // Update prize display if already set
            this.updatePrizeDisplay();
        } else {
            // Hide admin toggle for non-admins
            showAdminBtn.style.display = 'none';
        }
    }
    
    async setPrize() {
        const prizeTokenInput = document.getElementById('prize-token-input');
        const prizeError = document.getElementById('prize-error');
        const prizeDisplay = document.getElementById('prize-display');
        
        const token = prizeTokenInput.value.trim();
        if (!token) {
            this.showPrizeError('Please enter a prize token');
            return;
        }
        
        try {
            const response = await fetch(`/demo/bettingGame/api/game/${this.gameId}/set-prize`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token, adminKey: this.adminKey })
            });
            
            const data = await response.json();
            
            if (!response.ok) {
                throw new Error(data.error || 'Failed to set prize');
            }
            
            // Clear input and show success
            prizeTokenInput.value = '';
            prizeError.classList.add('hidden');
            
            // Update game state and UI
            this.gameState.prizeSummary = data.prizeSummary;
            this.updatePrizeDisplay();
            this.updateStartGameButton();
            
            this.addDebugMessage('outgoing', 'Admin', { action: 'setPrize', prizeSummary: data.prizeSummary });
            
        } catch (error) {
            this.showPrizeError(error.message);
        }
    }
    
    async startGame() {
        const startError = document.getElementById('start-error');
        const startGameBtn = document.getElementById('start-game-btn');
        
        try {
            startGameBtn.disabled = true;
            startError.classList.add('hidden');
            
            const response = await fetch(`/demo/bettingGame/api/game/${this.gameId}/start`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ adminKey: this.adminKey })
            });
            
            const data = await response.json();
            
            if (!response.ok) {
                throw new Error(data.error || 'Failed to start game');
            }
            
            this.addDebugMessage('outgoing', 'Admin', { action: 'startGame', countdownSeconds: data.countdownSeconds });
            
        } catch (error) {
            startGameBtn.disabled = false;
            startError.textContent = error.message;
            startError.classList.remove('hidden');
        }
    }
    
    showPrizeError(message) {
        const prizeError = document.getElementById('prize-error');
        prizeError.textContent = message;
        prizeError.classList.remove('hidden');
        
        setTimeout(() => {
            prizeError.classList.add('hidden');
        }, 5000);
    }
    
    updatePrizeDisplay() {
        const prizeDisplay = document.getElementById('prize-display');
        
        if (this.gameState?.prizeSummary) {
            prizeDisplay.textContent = `Prize set: ${this.gameState.prizeSummary.display}`;
            prizeDisplay.classList.remove('hidden');
        } else {
            prizeDisplay.classList.add('hidden');
        }
    }
    
    updateStartGameButton() {
        const startGameBtn = document.getElementById('start-game-btn');
        if (startGameBtn) {
            // Enable start button always (can start with or without prize)
            startGameBtn.disabled = false;
        }
    }
    
    updatePreStartCountdown(secondsRemaining) {
        // Hide normal countdown and show prestart countdown
        const countdownDisplay = document.querySelector('.countdown-display');
        const adminControls = document.getElementById('admin-controls');
        
        // Hide normal countdown and admin controls during prestart
        if (countdownDisplay) countdownDisplay.style.display = 'none';
        if (adminControls) adminControls.style.display = 'none';
        
        // Show or update prestart countdown
        let prestartDiv = document.getElementById('prestart-countdown');
        if (!prestartDiv) {
            prestartDiv = document.createElement('div');
            prestartDiv.id = 'prestart-countdown';
            prestartDiv.className = 'prestart-countdown';
            prestartDiv.innerHTML = `
                <h3>Game Starting!</h3>
                <div id="prestart-timer" class="prestart-timer">${secondsRemaining}</div>
            `;
            
            const container = document.querySelector('#lobby-screen .container');
            container.insertBefore(prestartDiv, container.children[1]);
        } else {
            const timer = document.getElementById('prestart-timer');
            if (timer) timer.textContent = secondsRemaining;
        }
    }
    
    showPreStartCountdown() {
        // Show prestart countdown UI without timer (will be updated via WebSocket)
        this.updatePreStartCountdown('--');
    }
    
    generateQRCode(url) {
        const qrContainer = document.getElementById('qr-code');
        if (qrContainer && window.QRCode) {
            try {
                // Clear any existing QR code
                qrContainer.innerHTML = '';
                
                // Generate new QR code
                new QRCode(qrContainer, {
                    text: url,
                    width: 200,
                    height: 200,
                    colorDark: '#000000',
                    colorLight: '#ffffff',
                    correctLevel: QRCode.CorrectLevel.H
                });
            } catch (error) {
                console.error('QR Code generation failed:', error);
                // Hide QR code section if generation fails
                const qrSection = document.querySelector('.qr-code-section');
                if (qrSection) qrSection.style.display = 'none';
            }
        } else {
            console.warn('QR Code library not loaded');
            const qrSection = document.querySelector('.qr-code-section');
            if (qrSection) qrSection.style.display = 'none';
        }
    }
    
    updateUI() {
        if (this.gameState.status === 'lobby') {
            this.updatePlayersCount();
        } else if (this.gameState.status === 'active') {
            this.updateLeaderboard();
        }
        
        // Update debug panel
        this.updateDebugGameState();
    }
}

// Initialize the game when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    new BettingGame();
});