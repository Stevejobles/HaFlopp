/**
 * Socket.io client for poker game
 */
class PokerSocketClient {
  constructor() {
    this.socket = null;
    this.isConnected = false;
    this.gameId = null;
    this.hasJoinedRoom = false; // Track if we've already joined the room
    this.lastJoinAttempt = 0; // Timestamp of last join attempt
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
  }
  
  // Initialize the socket connection with authentication
  connectWithAuth(userId) {
    // Check if Socket.io is available
    if (typeof io === 'undefined') {
      console.error('Socket.io not loaded');
      return false;
    }

    console.log('Connecting socket with user ID:', userId);

    if (this.socket) {
      this.socket.disconnect();
    }

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

    // Set up event listeners
    this.socket.on('connect', () => {
      this.isConnected = true;
      console.log('Socket connected successfully with ID:', this.socket.id);
      
      if (this.callbacks.onConnect) {
        this.callbacks.onConnect();
      }

      // If we have a game ID but haven't joined, join that room
      // Reset the hasJoinedRoom flag on new connections
      this.hasJoinedRoom = false;
      if (this.gameId) {
        console.log('Auto-joining game room after connection:', this.gameId);
        this.joinGame(this.gameId);
      }
    });

    this.socket.on('disconnect', () => {
      this.isConnected = false;
      // Reset the join flag on disconnect
      this.hasJoinedRoom = false;
      console.log('Socket disconnected');

      if (this.callbacks.onDisconnect) {
        this.callbacks.onDisconnect();
      }
    });

    this.socket.on('gameState', (data) => {
      console.log('Game state received:', data);

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
      console.log('Game started:', data);

      if (this.callbacks.onGameStarted) {
        this.callbacks.onGameStarted(data);
      }
    });

    this.socket.on('playerJoined', (data) => {
      console.log('Player joined:', data);

      if (this.callbacks.onPlayerJoin) {
        this.callbacks.onPlayerJoin(data);
      }
    });

    this.socket.on('playerLeft', (data) => {
      console.log('Player left:', data);

      if (this.callbacks.onPlayerLeave) {
        this.callbacks.onPlayerLeave(data);
      }
    });
    
    this.socket.on('chatMessage', (data) => {
      console.log('Chat message received:', data);
      
      if (this.callbacks.onChatMessage) {
        this.callbacks.onChatMessage(data);
      }
    });
    
    this.socket.on('chatHistory', (data) => {
      console.log('Chat history received:', data);
      
      if (this.callbacks.onChatHistory) {
        this.callbacks.onChatHistory(data);
      } else if (data.history && this.callbacks.onChatMessage) {
        // Fallback to process each message individually if onChatHistory isn't set
        data.history.forEach(msg => {
          this.callbacks.onChatMessage(msg);
        });
      }
    });
    
    this.socket.on('playerAction', (data) => {
      console.log('Player action received:', data);
      
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

    return true;
  }
  
  // Disconnect socket
  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
      this.isConnected = false;
      this.gameId = null;
      this.hasJoinedRoom = false;
    }
  }
  
  // Join a game room
  joinGame(gameId) {
    if (!gameId) {
      console.error('No game ID provided for joining');
      return false;
    }
    
    // Store game ID even if not connected yet
    this.gameId = gameId;
    
    if (!this.isConnected) {
      console.log('Not connected yet, will join room when connected');
      return false;
    }
    
    // Prevent spam joining - only join if:
    // 1. We haven't joined this room yet, or
    // 2. It's been at least 10 seconds since our last join attempt
    const now = Date.now();
    if (this.hasJoinedRoom && now - this.lastJoinAttempt < 10000) {
      console.log('Already joined room or too soon since last attempt, skipping');
      return false;
    }
    
    this.lastJoinAttempt = now;
    this.socket.emit('joinGame', gameId);
    console.log('Joining game room:', gameId);
    this.hasJoinedRoom = true;
    return true;
  }
  
  // Send a game action
  sendAction(action, amount = 0) {
    if (!this.isConnected || !this.gameId) {
      console.error('Cannot send action: not connected or no game ID');
      return false;
    }
    
    console.log('Sending action:', action, amount);
    this.socket.emit('gameAction', {
      lobbyId: this.gameId,
      action: action,
      amount: amount
    });
    
    return true;
  }
  
  // Send a chat message - FIXED
  sendChatMessage(message) {
    if (!this.isConnected || !this.gameId) {
      console.error('Cannot send chat message: not connected or no game ID');
      return false;
    }
    
    console.log('Sending chat message:', message, 'to lobby:', this.gameId);
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
    
    console.log('Requesting game start for:', this.gameId);
    this.socket.emit('startGame', this.gameId);
    return true;
  }
  
  // Set callback functions
  setCallbacks(callbacks) {
    this.callbacks = {
      ...this.callbacks,
      ...callbacks
    };
  }
  
  // Generic emit method for custom events
  emit(event, data) {
    if (!this.isConnected) {
      console.error('Cannot emit event: not connected');
      return false;
    }
    
    this.socket.emit(event, data);
    return true;
  }

  // Method to request current game state
  requestGameState() {
    if (!this.isConnected || !this.gameId) {
      console.error('Cannot request game state: not connected or no game ID');
      return false;
    }
    
    console.log('Requesting game state for:', this.gameId);
    this.socket.emit('requestGameState', {
      lobbyId: this.gameId
    });
    
    return true;
  }
  
  // Check if socket is connected
  isSocketConnected() {
    return this.isConnected && this.socket && this.socket.connected;
  }
}

// Create singleton instance
window.pokerSocket = window.pokerSocket || new PokerSocketClient();