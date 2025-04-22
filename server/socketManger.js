const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const { ObjectId } = require('mongodb');

// Import models
const pokerGame = require('./models/pokerGame');

class SocketManager {
  constructor(server, sessionMiddleware) {
    this.io = new Server(server);
    this.sessionMiddleware = sessionMiddleware;
    this.userSockets = new Map(); // Map of userId -> socket
    this.roomToGame = new Map(); // Map of lobbyId -> game instance
    
    this.setupSocketMiddleware();
    this.setupEventHandlers();
  }
  
  setupSocketMiddleware() {
    // Convert express middleware to socket.io middleware
    const wrap = middleware => (socket, next) => middleware(socket.request, {}, next);
    
    // Apply session middleware to socket.io
    this.io.use(wrap(this.sessionMiddleware));
    
    // Authentication middleware
    this.io.use(async (socket, next) => {
      const userId = socket.request.session.userId;
      
      if (userId) {
        socket.userId = userId;
        return next();
      }
      
      // Check for token in cookies
      const token = socket.request.cookies?.rememberToken;
      
      if (token) {
        try {
          const decoded = jwt.verify(token, process.env.JWT_SECRET || 'haflop-secret-key-should-be-environment-variable');
          socket.userId = decoded.userId;
          return next();
        } catch (error) {
          console.error('Socket auth error:', error);
        }
      }
      
      return next(new Error('Authentication required'));
    });
  }
  
  setupEventHandlers() {
    this.io.on('connection', (socket) => {
      const userId = socket.userId;
      
      console.log(`User connected: ${userId}`);
      
      // Store socket reference for this user
      this.userSockets.set(userId, socket);
      
      // Handle joining a game room
      socket.on('joinRoom', (lobbyId) => {
        // Leave any previous rooms
        Array.from(socket.rooms)
          .filter(room => room !== socket.id)
          .forEach(room => socket.leave(room));
        
        // Join the new room
        socket.join(lobbyId);
        console.log(`User ${userId} joined room ${lobbyId}`);
        
        // If there's an active game for this lobby, send game state
        if (this.roomToGame.has(lobbyId)) {
          const game = this.roomToGame.get(lobbyId);
          const playerState = game.getPlayerState(userId);
          
          socket.emit('gameState', {
            gameState: game.getPublicState(),
            playerState
          });
        }
      });
      
      // Handle game actions
      socket.on('gameAction', async (data) => {
        const { lobbyId, action, amount } = data;
        
        if (!this.roomToGame.has(lobbyId)) {
          socket.emit('error', { message: 'Game not found' });
          return;
        }
        
        const game = this.roomToGame.get(lobbyId);
        
        try {
          // Process the action
          await game.processAction(userId, action, amount);
          
          // Update all players
          this.broadcastGameState(lobbyId);
        } catch (error) {
          console.error('Game action error:', error);
          socket.emit('error', { message: error.message });
        }
      });
      
      // Handle starting a game
      socket.on('startGame', async (lobbyId) => {
        try {
          // Initialize a new game
          const game = await pokerGame.createGame(lobbyId);
          this.roomToGame.set(lobbyId, game);
          
          // Broadcast to all players in the room
          this.broadcastGameState(lobbyId);
        } catch (error) {
          console.error('Start game error:', error);
          socket.emit('error', { message: error.message });
        }
      });
      
      // Handle disconnection
      socket.on('disconnect', () => {
        console.log(`User disconnected: ${userId}`);
        this.userSockets.delete(userId);
      });
    });
  }
  
  // Broadcast game state to all players in a room
  broadcastGameState(lobbyId) {
    if (!this.roomToGame.has(lobbyId)) {
      return;
    }
    
    const game = this.roomToGame.get(lobbyId);
    const publicState = game.getPublicState();
    
    // Get all sockets in the room
    const room = this.io.sockets.adapter.rooms.get(lobbyId);
    
    if (!room) {
      return;
    }
    
    // Send personalized state to each player
    Array.from(room).forEach(socketId => {
      const socket = this.io.sockets.sockets.get(socketId);
      const userId = socket.userId;
      const playerState = game.getPlayerState(userId);
      
      socket.emit('gameState', {
        gameState: publicState,
        playerState
      });
    });
  }
  
  // Start a game for a lobby
  async startGame(lobbyId) {
    try {
      // Initialize a new game
      const game = await pokerGame.createGame(lobbyId);
      this.roomToGame.set(lobbyId, game);
      
      // Broadcast to all players in the room
      this.io.to(lobbyId).emit('gameStarted', { lobbyId });
      this.broadcastGameState(lobbyId);
      
      return true;
    } catch (error) {
      console.error('Start game error:', error);
      return false;
    }
  }
  
  // Get socket manager instance
  static getInstance(server, sessionMiddleware) {
    if (!SocketManager.instance) {
      SocketManager.instance = new SocketManager(server, sessionMiddleware);
    }
    return SocketManager.instance;
  }
}

module.exports = SocketManager;