/**
 * Socket.io client for poker game
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
      onPlayerLeave: null
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

      // If we have a game ID, join that room
      if (this.gameId) {
        console.log('Auto-joining game room after connection:', this.gameId);
        this.joinGame(this.gameId);
      }
    });

    this.socket.on('disconnect', () => {
      this.isConnected = false;
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

    // Add new events for player joining and leaving
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
    }
  }
  
  // Join a game room
  joinGame(gameId) {
    if (!this.isConnected) {
      // Store game ID for when we connect
      this.gameId = gameId;
      return false;
    }
    
    this.gameId = gameId;
    this.socket.emit('joinGame', gameId);
    console.log('Joining game room:', gameId);
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
  
  // Check if socket is connected
  isSocketConnected() {
    return this.isConnected && this.socket && this.socket.connected;
  }
  
  // Reconnect if disconnected
  reconnect() {
    if (!this.isConnected && !this.socket) {
      return this.connect();
    } else if (!this.socket.connected) {
      this.socket.connect();
      return true;
    }
    return false;
  }
}

// Create singleton instance
window.pokerSocket = window.pokerSocket || new PokerSocketClient();