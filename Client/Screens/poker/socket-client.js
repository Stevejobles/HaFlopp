/**
 * Socket.io client for poker game - Debugging Version
 */
class PokerSocketClient {
  constructor() {
    this.socket = null;
    this.isConnected = false;
    this.gameId = null;
    this.callbacks = {
      onConnect: null,
      onDisconnect: null,
      onGameState: null,
      onError: null,
      onGameStarted: null,
      onPlayerJoin: null,
      onPlayerLeave: null,
      onChatMessage: null,
      onChatHistory: null,
      onPlayerAction: null
    };
    
    // Debugging flag
    this.debug = true;
  }
  
  log(...args) {
    if (this.debug) {
      console.log('[PokerSocket]', ...args);
    }
  }
  
  // Initialize the socket connection with authentication
  connectWithAuth(userId) {
    // Check if Socket.io is available
    if (typeof io === 'undefined') {
      console.error('Socket.io not loaded');
      alert('Socket.io is not loaded. Check network connections or refresh the page.');
      return false;
    }

    this.log('Connecting socket with user ID:', userId);

    if (this.socket) {
      this.log('Disconnecting existing socket');
      this.socket.disconnect();
    }

    try {
      // Create socket connection with user ID in query
      this.socket = io({
        query: { userId: userId },
        withCredentials: true,
        reconnection: true,
        reconnectionAttempts: 5,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
        timeout: 20000
      });
      
      this.log('Socket.io instance created:', this.socket);
      
      // Debug connection status
      window.setTimeout(() => {
        this.log('Socket connection state after 2s:', 
          this.socket ? (this.socket.connected ? 'Connected' : 'Not Connected') : 'No Socket');
      }, 2000);

      // Set up event listeners
      this.socket.on('connect', () => {
        this.isConnected = true;
        this.log('Socket connected successfully with ID:', this.socket.id);
        
        if (this.callbacks.onConnect) {
          this.callbacks.onConnect();
        }

        // If we have a game ID, join that room
        if (this.gameId) {
          this.log('Auto-joining game room after connection:', this.gameId);
          this.joinGame(this.gameId);
        }
      });

      this.socket.on('disconnect', (reason) => {
        this.isConnected = false;
        this.log('Socket disconnected. Reason:', reason);

        if (this.callbacks.onDisconnect) {
          this.callbacks.onDisconnect();
        }
      });

      this.socket.on('gameState', (data) => {
        this.log('Game state received:', data);

        if (this.callbacks.onGameState) {
          this.callbacks.onGameState(data);
        }
      });

      this.socket.on('error', (error) => {
        console.error('Socket error:', error);

        if (this.callbacks.onError) {
          this.callbacks.onError(error);
        }
      });

      this.socket.on('gameStarted', (data) => {
        this.log('Game started:', data);

        if (this.callbacks.onGameStarted) {
          this.callbacks.onGameStarted(data);
        }
      });

      this.socket.on('playerJoined', (data) => {
        this.log('Player joined:', data);

        if (this.callbacks.onPlayerJoin) {
          this.callbacks.onPlayerJoin(data);
        }
      });

      this.socket.on('playerLeft', (data) => {
        this.log('Player left:', data);

        if (this.callbacks.onPlayerLeave) {
          this.callbacks.onPlayerLeave(data);
        }
      });
      
      this.socket.on('chatMessage', (data) => {
        this.log('Chat message received:', data);
        
        if (this.callbacks.onChatMessage) {
          this.callbacks.onChatMessage(data);
        }
      });
      
      this.socket.on('chatHistory', (data) => {
        this.log('Chat history received:', data);
        
        if (this.callbacks.onChatHistory) {
          this.callbacks.onChatHistory(data);
        } else if (data.history && this.callbacks.onChatMessage) {
          data.history.forEach(msg => {
            this.callbacks.onChatMessage(msg);
          });
        }
      });
      
      this.socket.on('playerAction', (data) => {
        this.log('Player action received:', data);
        
        if (this.callbacks.onPlayerAction) {
          this.callbacks.onPlayerAction(data);
        }
      });

      this.socket.on('connect_error', (error) => {
        console.error('Socket connection error:', error);
        this.isConnected = false;

        if (this.callbacks.onError) {
          this.callbacks.onError({
            message: 'Failed to connect to server: ' + (error.message || 'Unknown error')
          });
        }
      });
      
      // Additional debugging
      this.socket.on('reconnect_attempt', (attempt) => {
        this.log('Socket reconnection attempt:', attempt);
      });
      
      this.socket.on('reconnect', (attempt) => {
        this.log('Socket reconnected after attempts:', attempt);
        this.isConnected = true;
      });
      
      this.socket.on('reconnect_error', (error) => {
        this.log('Socket reconnection error:', error);
      });
      
      this.socket.on('reconnect_failed', () => {
        this.log('Socket reconnection failed');
        alert('Connection to game server failed. Please refresh the page and try again.');
      });
      
      return true;
    } catch (error) {
      console.error('Error creating socket connection:', error);
      alert('Failed to connect to game server: ' + error.message);
      return false;
    }
  }
  
  // Disconnect socket
  disconnect() {
    if (this.socket) {
      this.log('Manually disconnecting socket');
      this.socket.disconnect();
      this.socket = null;
      this.isConnected = false;
      this.gameId = null;
    }
  }
  
  // Join a game room
  joinGame(gameId) {
    this.log('Joining game:', gameId, 'Connected:', this.isConnected);
    
    if (!gameId) {
      console.error('No game ID provided');
      return false;
    }
    
    if (!this.isConnected) {
      // Store game ID for when we connect
      this.gameId = gameId;
      this.log('Not connected yet, storing game ID for later join');
      return false;
    }
    
    this.gameId = gameId;
    this.socket.emit('joinGame', gameId);
    this.log('Emitted joinGame event for room:', gameId);
    return true;
  }
  
  // Send a game action
  sendAction(action, amount = 0) {
    if (!this.isConnected || !this.gameId) {
      console.error('Cannot send action: not connected or no game ID');
      return false;
    }
    
    this.log('Sending action:', action, amount);
    this.socket.emit('gameAction', {
      lobbyId: this.gameId,
      action: action,
      amount: amount
    });
    
    return true;
  }
  
  // Send a chat message
  sendChatMessage(message) {
    if (!this.isConnected || !this.gameId) {
      console.error('Cannot send chat message: not connected or no game ID');
      return false;
    }
    
    this.log('Sending chat message:', message);
    this.socket.emit('chatMessage', {
      lobbyId: this.gameId,
      message: message
    });
    
    return true;
  }
  
  // Request to start the game
  startGame() {
    if (!this.isConnected || !this.gameId) {
      console.error('Cannot start game: not connected or no game ID');
      return false;
    }
    
    this.log('Requesting game start for:', this.gameId);
    this.socket.emit('startGame', this.gameId);
    return true;
  }
  
  // Set callback functions
  setCallbacks(callbacks) {
    this.callbacks = {
      ...this.callbacks,
      ...callbacks
    };
    this.log('Callbacks set:', Object.keys(callbacks));
  }
  
  // Generic emit method for custom events
  emit(event, data) {
    if (!this.isConnected) {
      console.error('Cannot emit event: not connected');
      return false;
    }
    
    this.log('Emitting event:', event, data);
    this.socket.emit(event, data);
    return true;
  }
  
  // Check if socket is connected
  isSocketConnected() {
    const status = this.isConnected && this.socket && this.socket.connected;
    this.log('Socket connection status check:', status);
    return status;
  }
  
  // Reconnect if disconnected
  reconnect() {
    this.log('Reconnect requested. Currently connected:', this.isConnected);
    if (!this.isConnected && !this.socket) {
      return this.connect();
    } else if (this.socket && !this.socket.connected) {
      this.log('Attempting to reconnect socket');
      this.socket.connect();
      return true;
    }
    return false;
  }
}

// Create singleton instance with explicit global variable
window.pokerSocket = new PokerSocketClient();