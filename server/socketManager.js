const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const { MongoClient, ObjectId } = require('mongodb');

// Game state tracking
class SocketManager {
  
  static instance = null;

  constructor(server, sessionMiddleware, db) {
    this.io = new Server(server, {
      cors: {
        origin: true, // Allow all origins (or specify your domain)
        methods: ["GET", "POST"],
        credentials: true,
        allowedHeaders: ["Cookie"]
      }
    });
  
    this.sessionMiddleware = sessionMiddleware;
    this.db = db;
    this.userSockets = new Map(); // Map of userId -> socket
    this.roomToGame = new Map(); // Map of lobbyId -> game state
    this.playerRooms = new Map(); // Map of userId -> lobbyId (to track which room each player is in)
    this.playerNames = new Map(); // Map of userId -> username
    this.chatHistory = new Map(); // Map of lobbyId -> array of chat messages
    
    this.setupSocketMiddleware();
    this.setupEventHandlers();
  }
  
  setupSocketMiddleware() {
    // Replace the existing middleware code with this new implementation
    this.io.use((socket, next) => {
      // Directly access the cookie string
      const cookieString = socket.request.headers.cookie;
      console.log('Socket request cookies raw:', cookieString);
      
      if (cookieString) {
        // Parse all cookies
        const cookies = {};
        cookieString.split(';').forEach(cookie => {
          const parts = cookie.split('=');
          if (parts.length >= 2) {
            cookies[parts[0].trim()] = parts[1].trim();
          }
        });
        
        // First try to use the rememberToken
        const token = cookies['rememberToken'];
        if (token) {
          try {
            console.log('Found remember token, attempting to verify');
            const decoded = jwt.verify(
              token, 
              process.env.JWT_SECRET || 'haflop-secret-key-should-be-environment-variable'
            );
            
            if (decoded && decoded.userId) {
              console.log('Successfully authenticated with token for user:', decoded.userId);
              socket.userId = decoded.userId;
              return next();
            }
          } catch (error) {
            console.error('Token verification error:', error);
          }
        }
        
        // If token auth failed, try query params next
        const queryUserId = socket.handshake.query.userId;
        if (queryUserId) {
          console.log('Found user ID in query params:', queryUserId);
          socket.userId = queryUserId;
          return next();
        }
        
        // Last resort - try session (but this likely won't work if no session cookie)
        const sessionId = cookies['connect.sid'];
        if (sessionId) {
          this.sessionMiddleware(socket.request, socket.request.res || {}, () => {
            const userId = socket.request.session?.userId;
            if (userId) {
              socket.userId = userId;
              return next();
            }
            return next(new Error('No user ID in session'));
          });
        } else {
          return next(new Error('Authentication failed'));
        }
      } else {
        // No cookies at all - check query params
        const queryUserId = socket.handshake.query.userId;
        if (queryUserId) {
          console.log('Found user ID in query params (no cookies):', queryUserId);
          socket.userId = queryUserId;
          return next();
        }
        return next(new Error('No authentication data found'));
      }
    });
  }
  
  setupEventHandlers() {
    this.io.on('connection', (socket) => {
      const userId = socket.userId;
      console.log(`User connected with socket ID: ${socket.id}, user ID: ${userId}`);
  
      console.log(`User connected: ${userId}`);
      
      // Store socket reference for this user
      this.userSockets.set(userId, socket);
      
      // Handle game state requests - this should be at this level, not inside joinGame
      socket.on('requestGameState', (data) => {
        const { lobbyId } = data;
        
        if (!lobbyId) {
          socket.emit('error', { message: 'Invalid lobby ID' });
          return;
        }
        
        console.log(`User ${socket.userId} requested game state for lobby ${lobbyId}`);
        
        // Get the game state for this lobby
        const gameState = this.roomToGame.get(lobbyId);
        if (!gameState) {
          socket.emit('error', { message: 'Game not found' });
          return;
        }
        
        // Send the current game state to just this client
        const userId = socket.userId;
        const publicState = this.getPublicGameState(gameState);
        const playerState = this.getPlayerState(gameState, userId);
        
        socket.emit('gameState', {
          gameState: publicState,
          playerState
        });
      });
      
      // Handle joining a game room
      socket.on('joinGame', async (lobbyId) => {
        console.log(`Attempt to join game: ${lobbyId} by user: ${userId}`);
        
        // Fetch user information to store username
        try {
          const usersCollection = this.db.collection("users");
          const user = await usersCollection.findOne({ _id: new ObjectId(userId) });
          if (user) {
            this.playerNames.set(userId, user.username);
          }
        } catch (error) {
          console.error('Error fetching user data:', error);
        }
        
        // Leave any previous rooms
        if (this.playerRooms.has(userId)) {
          const previousRoomId = this.playerRooms.get(userId);
          if (previousRoomId !== lobbyId) {
            await this.handlePlayerLeaving(userId, previousRoomId);
            socket.leave(previousRoomId);
          }
        }
      
        // Join the new room
        socket.join(lobbyId);
        this.playerRooms.set(userId, lobbyId);
        console.log(`User ${userId} joined room ${lobbyId}`);
      
        // Get username
        const username = this.playerNames.get(userId) || 'Player';
      
        // Notify other players in the room that a new player has joined
        socket.to(lobbyId).emit('playerJoined', {
          userId: userId,
          username: username,
          lobbyId: lobbyId
        });
      
        // Send chat history to the new player
        if (this.chatHistory.has(lobbyId)) {
          const history = this.chatHistory.get(lobbyId);
          socket.emit('chatHistory', { history });
        }
      
        // If there's an active game for this lobby, send game state
        if (this.roomToGame.has(lobbyId)) {
          const gameState = this.roomToGame.get(lobbyId);
          socket.emit('gameState', {
            gameState: this.getPublicGameState(gameState),
            playerState: this.getPlayerState(gameState, userId)
          });
        } else {
          // If there's no game yet, create one!
          console.log(`No game found for lobby ${lobbyId}, attempting to create one`);
          this.startGame(lobbyId).then(success => {
            if (success) {
              console.log(`Game created for lobby ${lobbyId}`);
            } else {
              console.error(`Failed to create game for lobby ${lobbyId}`);
              socket.emit('error', { message: 'Failed to create game' });
            }
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
        
        const gameState = this.roomToGame.get(lobbyId);
        
        try {
          // Process the action
          this.processGameAction(gameState, userId, action, amount);
          
          // Get username
          const username = this.playerNames.get(userId) || 'Player';
          
          // Broadcast player action to all players in the room
          this.io.to(lobbyId).emit('playerAction', {
            userId,
            username,
            action,
            amount
          });
          
          // Update all players with the new game state
          this.broadcastGameState(lobbyId);
        } catch (error) {
          console.error('Game action error:', error);
          socket.emit('error', { message: error.message });
        }
      });
      
      // Handle chat messages - FIXED
      socket.on('chatMessage', (data) => {
        const { lobbyId, message } = data;
        
        if (!message || !lobbyId) {
          console.error("Invalid chat message data:", data);
          return;
        }
        
        // Get username
        const username = this.playerNames.get(userId) || 'Player';
        
        console.log(`Chat message from ${username} in lobby ${lobbyId}: ${message}`);
        
        // Create chat message object
        const chatMessage = {
          userId,
          username,
          message,
          timestamp: new Date().toISOString()
        };
        
        // Store message in chat history
        if (!this.chatHistory.has(lobbyId)) {
          this.chatHistory.set(lobbyId, []);
        }
        
        const history = this.chatHistory.get(lobbyId);
        history.push(chatMessage);
        
        // Limit history to 100 messages
        if (history.length > 100) {
          history.shift();
        }
        
        // Broadcast message to all players in the room, including sender
        this.io.to(lobbyId).emit('chatMessage', chatMessage);
      });
      
      // Handle disconnection
      socket.on('disconnect', () => {
        console.log(`User disconnected: ${userId}`);
        
        // Check if user was in a room and handle leaving
        if (this.playerRooms.has(userId)) {
          const roomId = this.playerRooms.get(userId);
          this.handlePlayerLeaving(userId, roomId);
        }
        
        this.userSockets.delete(userId);
        this.playerRooms.delete(userId);
      });
    });
  }
  
  // Handle a player leaving a game room - FIXED
  async handlePlayerLeaving(userId, roomId) {
    console.log(`Handling player ${userId} leaving room ${roomId}`);
    
    // Get username
    const username = this.playerNames.get(userId) || 'Player';
    
    // Notify other players in the room that a player has left
    this.io.to(roomId).emit('playerLeft', {
      userId: userId,
      username: username,
      lobbyId: roomId
    });
    
    // Update game state if needed
    if (this.roomToGame.has(roomId)) {
      const gameState = this.roomToGame.get(roomId);
      
      // Find the player in the game
      const playerIndex = gameState.players.findIndex(p => p.id === userId);
      
      if (playerIndex !== -1) {
        // Remove player from game state or mark as inactive
        console.log(`Removing player ${userId} from game state`);
        gameState.players.splice(playerIndex, 1);
        
        // If no players left, clean up the game
        if (gameState.players.length === 0) {
          console.log(`No players left in room ${roomId}, cleaning up game state`);
          this.roomToGame.delete(roomId);
          
          // Clean up chat history too
          this.chatHistory.delete(roomId);
          
          // IMPORTANT FIX: Also remove the lobby from the database
          try {
            const lobbiesCollection = this.db.collection("lobbies");
            const result = await lobbiesCollection.deleteOne({ _id: new ObjectId(roomId) });
            
            if (result.deletedCount === 1) {
              console.log(`Successfully deleted lobby ${roomId} from database`);
            } else {
              console.log(`Lobby ${roomId} not found in database or already deleted`);
            }
          } catch (error) {
            console.error(`Error deleting lobby ${roomId} from database:`, error);
          }
        } else {
          // Otherwise broadcast updated game state
          this.broadcastGameState(roomId);
        }
      }
    }
    
    // Remove from tracking
    this.playerRooms.delete(userId);
  }
  
  // Broadcast game state to all players in a room
  broadcastGameState(lobbyId) {
    if (!this.roomToGame.has(lobbyId)) {
      return;
    }
    
    const gameState = this.roomToGame.get(lobbyId);
    const publicState = this.getPublicGameState(gameState);
    
    // Get all sockets in the room
    const room = this.io.sockets.adapter.rooms.get(lobbyId);
    
    if (!room) {
      return;
    }
    
    // Send personalized state to each player
    Array.from(room).forEach(socketId => {
      const socket = this.io.sockets.sockets.get(socketId);
      const userId = socket.userId;
      const playerState = this.getPlayerState(gameState, userId);
      
      socket.emit('gameState', {
        gameState: publicState,
        playerState
      });
    });
  }
  
  // Start a game for a lobby
  async startGame(lobbyId) {
    try {
      console.log(`Starting game for lobby: ${lobbyId}`);

      // Get the lobby
      const lobbiesCollection = this.db.collection("lobbies");
      const lobby = await lobbiesCollection.findOne({ _id: new ObjectId(lobbyId) });

      if (!lobby) {
        console.error(`Lobby not found: ${lobbyId}`);
        throw new Error("Lobby not found");
      }

      console.log(`Found lobby with ${lobby.players.length} players`);

      // Initialize a basic game state
      const gameState = {
        lobbyId: lobbyId,
        players: lobby.players.map(player => ({
          id: player.id.toString(),
          username: player.username,
          chips: 1000, // Starting chips
          hand: this.dealCards(2), // Deal 2 cards to each player
          bet: 0,
          totalBet: 0,
          folded: false,
          isAllIn: false,
          isDealer: false,
          isSmallBlind: false,
          isBigBlind: false,
          isCurrentTurn: false
        })),
        tableCards: [],
        pot: 0,
        currentBet: 0,
        currentRound: 'pre-flop', // pre-flop, flop, turn, river, showdown
        currentTurn: 0,
        dealer: 0,
        smallBlind: 0,
        bigBlind: 0,
        smallBlindAmount: 5,
        bigBlindAmount: 10,
        deck: this.createShuffledDeck(),
        isGameOver: false,
        winner: null
      };

      // Setup dealer and blinds
      this.setupBlinds(gameState);
      console.log(`Blinds set up. Dealer: ${gameState.dealer}, SB: ${gameState.smallBlind}, BB: ${gameState.bigBlind}`);

      // Store the game state
      this.roomToGame.set(lobbyId, gameState);
      console.log(`Game state created and stored for lobby: ${lobbyId}`);

      // Broadcast to all players in the room
      this.io.to(lobbyId).emit('gameStarted', { lobbyId });
      console.log(`Emitted gameStarted event to room ${lobbyId}`);

      // Add a small delay to ensure clients have processed the gameStarted event
      setTimeout(() => {
        this.broadcastGameState(lobbyId);
        console.log(`Broadcast initial game state to room ${lobbyId}`);
      }, 1000);

      // Update lobby status in database
      try {
        await lobbiesCollection.updateOne(
          { _id: new ObjectId(lobbyId) },
          { $set: { status: 'in_progress' } }
        );
        console.log(`Updated lobby status to 'in_progress' in database`);
      } catch (dbError) {
        console.error(`Error updating lobby status: ${dbError}`);
        // Continue even if database update fails
      }

      return true;
    } catch (error) {
      console.error(`Start game error: ${error.message}`);
      return false;
    }
  }
  
  // Process a game action
  processGameAction(gameState, userId, action, amount) {
    // Find player
    const playerIndex = gameState.players.findIndex(p => p.id === userId);
    
    if (playerIndex === -1) {
      throw new Error('Player not found');
    }
    
    // Check if it's the player's turn
    if (playerIndex !== gameState.currentTurn) {
      throw new Error('Not your turn');
    }
    
    const player = gameState.players[playerIndex];
    
    // Handle different actions (simplified for now)
    switch (action) {
      case 'fold':
        player.folded = true;
        break;
        
      case 'check':
        // Can only check if no bet
        if (gameState.currentBet > 0 && gameState.currentBet !== player.totalBet) {
          throw new Error('Cannot check, must call or fold');
        }
        break;
        
      case 'call':
        // Call the current bet
        const callAmount = gameState.currentBet - player.totalBet;
        
        // Limit call to player's chips
        const actualCallAmount = Math.min(callAmount, player.chips);
        player.bet = actualCallAmount;
        player.totalBet += actualCallAmount;
        player.chips -= actualCallAmount;
        gameState.pot += actualCallAmount;
        
        if (player.chips === 0) {
          player.isAllIn = true;
        }
        break;
        
      case 'bet':
        // Can only bet if no previous bet
        if (gameState.currentBet > 0) {
          throw new Error('Cannot bet, must raise instead');
        }
        
        // Ensure minimum bet
        if (amount < gameState.bigBlindAmount) {
          throw new Error(`Bet must be at least ${gameState.bigBlindAmount}`);
        }
        
        // Limit bet to player's chips
        const actualBetAmount = Math.min(amount, player.chips);
        player.bet = actualBetAmount;
        player.totalBet += actualBetAmount;
        player.chips -= actualBetAmount;
        gameState.pot += actualBetAmount;
        gameState.currentBet = player.totalBet;
        
        if (player.chips === 0) {
          player.isAllIn = true;
        }
        break;
        
      case 'raise':
        // Minimum raise is current bet + big blind
        const minRaise = gameState.currentBet + gameState.bigBlindAmount;
        
        if (amount < minRaise) {
          throw new Error(`Raise must be at least ${minRaise}`);
        }
        
        // Player must add enough to match current bet plus the raise
        const raiseAmount = amount - player.totalBet;
        
        // Limit raise to player's chips
        const actualRaiseAmount = Math.min(raiseAmount, player.chips);
        player.bet = actualRaiseAmount;
        player.totalBet += actualRaiseAmount;
        player.chips -= actualRaiseAmount;
        gameState.pot += actualRaiseAmount;
        gameState.currentBet = player.totalBet;
        
        if (player.chips === 0) {
          player.isAllIn = true;
        }
        break;
        
      default:
        throw new Error('Invalid action');
    }
    
    // Move to next player
    this.nextTurn(gameState);
  }
  
  // Move to next player's turn
  nextTurn(gameState) {
    // Reset current turn marker
    gameState.players[gameState.currentTurn].isCurrentTurn = false;
    
    // Find next active player
    let nextPlayer = (gameState.currentTurn + 1) % gameState.players.length;
    
    // Skip folded or all-in players
    while (
      gameState.players[nextPlayer].folded || 
      gameState.players[nextPlayer].isAllIn
    ) {
      nextPlayer = (nextPlayer + 1) % gameState.players.length;
      
      // If we've gone full circle, move to next round
      if (nextPlayer === gameState.currentTurn) {
        this.nextRound(gameState);
        return;
      }
    }
    
    // Check if round is over (everyone has acted)
    const allPlayersActed = this.allPlayersHaveActed(gameState);
    
    if (allPlayersActed) {
      // Move to next round
      this.nextRound(gameState);
      return;
    }
    
    // Set next player's turn
    gameState.currentTurn = nextPlayer;
    gameState.players[gameState.currentTurn].isCurrentTurn = true;
  }
  
  // Check if all players have acted
  allPlayersHaveActed(gameState) {
    for (let i = 0; i < gameState.players.length; i++) {
      const player = gameState.players[i];
      
      // Skip folded or all-in players
      if (player.folded || player.isAllIn) {
        continue;
      }
      
      // If player hasn't matched current bet, they haven't acted
      if (player.totalBet !== gameState.currentBet) {
        return false;
      }
    }
    
    return true;
  }
  
  // Move to next round
  nextRound(gameState) {
    // Reset bets for this round
    gameState.players.forEach(player => {
      player.bet = 0;
    });
    
    // Deal community cards based on current round
    switch (gameState.currentRound) {
      case 'pre-flop':
        // Deal the flop (3 cards)
        gameState.tableCards = gameState.deck.splice(0, 3);
        gameState.currentRound = 'flop';
        break;
        
      case 'flop':
        // Deal the turn (1 card)
        gameState.tableCards.push(gameState.deck.splice(0, 1)[0]);
        gameState.currentRound = 'turn';
        break;
        
      case 'turn':
        // Deal the river (1 card)
        gameState.tableCards.push(gameState.deck.splice(0, 1)[0]);
        gameState.currentRound = 'river';
        break;
        
      case 'river':
        // Move to showdown
        this.showdown(gameState);
        return;
    }
    
    // Reset the current bet
    gameState.currentBet = 0;
    
    // Start with player after dealer
    gameState.currentTurn = (gameState.dealer + 1) % gameState.players.length;
    
    // Skip folded or all-in players
    while (
      gameState.players[gameState.currentTurn].folded || 
      gameState.players[gameState.currentTurn].isAllIn
    ) {
      gameState.currentTurn = (gameState.currentTurn + 1) % gameState.players.length;
    }
    
    gameState.players[gameState.currentTurn].isCurrentTurn = true;
  }
  
  // Handle the showdown
  showdown(gameState) {
    gameState.currentRound = 'showdown';
    
    // Get active players (not folded)
    const activePlayers = gameState.players.filter(p => !p.folded);
    
    if (activePlayers.length === 1) {
      // Only one player left, they win
      gameState.winner = activePlayers[0].id;
      activePlayers[0].chips += gameState.pot;
      gameState.pot = 0;
    } else {
      // For simplicity, pick a random winner for now
      // In a real implementation, evaluate hands using pokerSolver.js
      const winnerIndex = Math.floor(Math.random() * activePlayers.length);
      gameState.winner = activePlayers[winnerIndex].id;
      activePlayers[winnerIndex].chips += gameState.pot;
      gameState.pot = 0;
    }
    
    gameState.isGameOver = true;
  }
  
  // Setup dealer and blinds
  setupBlinds(gameState) {
    const activePlayers = gameState.players.length;
    
    // Set dealer (random for first game)
    gameState.dealer = Math.floor(Math.random() * activePlayers);
    gameState.players[gameState.dealer].isDealer = true;
    
    // Set small blind
    gameState.smallBlind = (gameState.dealer + 1) % activePlayers;
    gameState.players[gameState.smallBlind].isSmallBlind = true;
    
    // Set big blind
    gameState.bigBlind = (gameState.smallBlind + 1) % activePlayers;
    gameState.players[gameState.bigBlind].isBigBlind = true;
    
    // Set the first player to act (after big blind)
    gameState.currentTurn = (gameState.bigBlind + 1) % activePlayers;
    gameState.players[gameState.currentTurn].isCurrentTurn = true;
    
    // Place blind bets
    const sbPlayer = gameState.players[gameState.smallBlind];
    const bbPlayer = gameState.players[gameState.bigBlind];
    
    // Place small blind
    const sbAmount = Math.min(gameState.smallBlindAmount, sbPlayer.chips);
    sbPlayer.bet = sbAmount;
    sbPlayer.totalBet = sbAmount;
    sbPlayer.chips -= sbAmount;
    gameState.pot += sbAmount;
    
    if (sbPlayer.chips === 0) {
      sbPlayer.isAllIn = true;
    }
    
    // Place big blind
    const bbAmount = Math.min(gameState.bigBlindAmount, bbPlayer.chips);
    bbPlayer.bet = bbAmount;
    bbPlayer.totalBet = bbAmount;
    bbPlayer.chips -= bbAmount;
    gameState.pot += bbAmount;
    
    if (bbPlayer.chips === 0) {
      bbPlayer.isAllIn = true;
    }
    
    // Set current bet to big blind amount
    gameState.currentBet = bbAmount;
  }
  
  // Create a shuffled deck
  createShuffledDeck() {
    const suits = ['h', 'd', 'c', 's']; // hearts, diamonds, clubs, spades
    const values = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];
    const deck = [];
    
    for (const suit of suits) {
      for (const value of values) {
        deck.push(value + suit);
      }
    }
    
    // Shuffle the deck
    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    
    return deck;
  }
  
  // Deal cards from the deck
  dealCards(count) {
    const deck = this.createShuffledDeck();
    return deck.splice(0, count);
  }
  
  // Get the public game state (visible to all players)
  getPublicGameState(gameState) {
    return {
      lobbyId: gameState.lobbyId,
      tableCards: gameState.tableCards,
      pot: gameState.pot,
      currentBet: gameState.currentBet,
      currentRound: gameState.currentRound,
      currentTurn: gameState.currentTurn,
      dealer: gameState.dealer,
      smallBlind: gameState.smallBlind,
      bigBlind: gameState.bigBlind,
      smallBlindAmount: gameState.smallBlindAmount,
      bigBlindAmount: gameState.bigBlindAmount,
      isGameOver: gameState.isGameOver,
      winner: gameState.winner,
      players: gameState.players.map(player => ({
        id: player.id,
        username: player.username,
        chips: player.chips,
        bet: player.bet,
        totalBet: player.totalBet,
        folded: player.folded,
        isAllIn: player.isAllIn,
        isDealer: player.isDealer,
        isSmallBlind: player.isSmallBlind,
        isBigBlind: player.isBigBlind,
        isCurrentTurn: player.isCurrentTurn,
        // Don't include player's cards in public state
      }))
    };
  }
  
  // Get the private state for a specific player
  getPlayerState(gameState, userId) {
    const player = gameState.players.find(p => p.id === userId);
    
    if (!player) {
      return null;
    }
    
    return {
      hand: player.hand,
      availableActions: this.getAvailableActions(gameState, player)
    };
  }
  
  // Get available actions for a player
  getAvailableActions(gameState, player) {
    // If game is over or not player's turn, no actions
    if (gameState.isGameOver || !player.isCurrentTurn) {
      return [];
    }
    
    // If player has folded, no actions
    if (player.folded) {
      return [];
    }
    
    const actions = ['fold'];
    
    // Can check if no active bet or player already matched it
    if (gameState.currentBet === 0 || gameState.currentBet === player.totalBet) {
      actions.push('check');
    }
    
    // Can call if there's a bet to call
    if (gameState.currentBet > player.totalBet) {
      actions.push('call');
    }
    
    // Can bet if no current bet
    if (gameState.currentBet === 0) {
      actions.push('bet');
    } else {
      // Can raise if there's a current bet
      actions.push('raise');
    }
    
    return actions;
  }
  
  // Get socket manager instance - was an error
  static getInstance(server, sessionMiddleware, db) {
    if (!SocketManager.instance) {
      SocketManager.instance = new SocketManager(server, sessionMiddleware, db);
    }
    return SocketManager.instance;
  }
}

module.exports = SocketManager;