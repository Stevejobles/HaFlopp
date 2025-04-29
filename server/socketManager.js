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

      // Get each player's chip count from the users collection
      const usersCollection = this.db.collection("users");
      const playerData = [];

      for (const lobbyPlayer of lobby.players) {
        const user = await usersCollection.findOne({ _id: new ObjectId(lobbyPlayer.id) });

        // Use the user's actual chip count, or give a default if none or too low
        let chips = 1000; // Default starting chips

        if (user && user.chips && user.chips > 0) {
          chips = user.chips;
        } else {
          // Update the user with default chips if they don't have any
          await usersCollection.updateOne(
            { _id: new ObjectId(lobbyPlayer.id) },
            { $set: { chips: chips } }
          );
        }

        playerData.push({
          id: lobbyPlayer.id.toString(),
          username: lobbyPlayer.username,
          chips: chips
        });
      }

      // Initialize a basic game state
      const gameState = {
        lobbyId: lobbyId,
        players: playerData.map(player => ({
          id: player.id,
          username: player.username,
          chips: player.chips,
          hand: [], // Cards will be dealt when blinds are set
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
        currentRound: 'pre-flop',
        currentTurn: 0,
        dealer: 0,
        smallBlind: 0,
        bigBlind: 0,
        smallBlindAmount: 5,
        bigBlindAmount: 10,
        deck: this.createShuffledDeck(),
        isGameOver: false,
        winner: null,
        playersActedThisRound: new Set()
      };

      // Create the deck and deal cards
      gameState.deck = this.createShuffledDeck();

      // Deal two cards to each player
      gameState.players.forEach(player => {
        player.hand = [gameState.deck.pop(), gameState.deck.pop()];
      });

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

      return gameState;
    } catch (error) {
      console.error(`Start game error: ${error.message}`);
      return false;
    }
  }

  // Add a method to start a new hand
  startNewHand(gameState) {
    // Notify players that a new hand is starting
    this.io.to(gameState.lobbyId).emit('handStarting', {
      message: 'New hand starting...',
      startTime: Date.now() + 2000 // 2 second countdown
    });
    
    // Reset the game state for a new hand
    gameState.tableCards = [];
    gameState.pot = 0;
    gameState.currentBet = 0;
    gameState.currentRound = 'pre-flop';
    gameState.isGameOver = false;
    gameState.winner = null;
    
    // Check if any players are out of chips
    const bustedPlayers = gameState.players.filter(player => player.chips <= 0);
    
    // Handle players with no chips - give them an option rather than auto-rebuy
    if (bustedPlayers.length > 0) {
      bustedPlayers.forEach(player => {
        // For automatic rebuy (optional fallback):
        // player.chips = 500; // Minimum buy-in
        
        // Notify the specific player they need to add chips
        const playerSocket = this.userSockets.get(player.id);
        if (playerSocket) {
          playerSocket.emit('needChips', {
            message: 'You have run out of chips! Please add more chips to continue playing.',
            currentChips: player.chips
          });
        }
        
        // Also notify the table that a player needs chips
        this.io.to(gameState.lobbyId).emit('playerNeedsChips', {
          playerId: player.id,
          username: player.username
        });
      });
      
      // If all players are out of chips, we might need to handle that
      if (bustedPlayers.length === gameState.players.length) {
        this.io.to(gameState.lobbyId).emit('gameMessage', {
          message: 'All players need to add more chips to continue playing.'
        });
        // We might want to pause the game here until at least one player has chips
        return; // Don't start a new hand until someone has chips
      }
    }
    
    // Filter out players with no chips for this hand
    const activePlayers = gameState.players.filter(player => player.chips > 0);
    
    // Reset player states but keep chips!
    gameState.players.forEach(player => {
      player.hand = [];
      player.bet = 0;
      player.totalBet = 0;
      player.folded = false;
      player.isAllIn = false;
      player.isDealer = false;
      player.isSmallBlind = false;
      player.isBigBlind = false;
      player.isCurrentTurn = false;
      // Add a sitting out flag for players with no chips
      player.isSittingOut = player.chips <= 0;
    });
    
    // Move the dealer button
    gameState.dealer = (gameState.dealer + 1) % activePlayers.length;
    
    // Create a fresh deck
    gameState.deck = this.createShuffledDeck();
    
    // Deal cards only to active players
    activePlayers.forEach(player => {
      player.hand = [gameState.deck.pop(), gameState.deck.pop()];
    });
    
    // Set up blinds for the new hand - this should handle active players only
    this.setupBlinds(gameState);
    
    // Broadcast the updated game state
    this.broadcastGameState(gameState.lobbyId);
  }

  // Add a method to update player chips in the database
  async updatePlayerChips(gameState) {
    try {
      // Only update if database is connected
      if (!this.db) return;

      const usersCollection = this.db.collection("users");

      // Update each player's chips in the database
      for (const player of gameState.players) {
        await usersCollection.updateOne(
          { _id: new ObjectId(player.id) },
          { $set: { chips: player.chips } }
        );

        console.log(`Updated chips for player ${player.username} to ${player.chips}`);
      }
    } catch (error) {
      console.error('Error updating player chips in database:', error);
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
    
    // FIXED: Track which players have acted in this round
    if (!gameState.playersActedThisRound) {
      gameState.playersActedThisRound = new Set();
    }
    
    // Add this player to the list of players who have acted
    gameState.playersActedThisRound.add(playerIndex);
    
    // Handle different actions
    switch (action) {
      case 'fold':
        player.folded = true;
        break;
        
      case 'check':
        // Can only check if no bet or player already matched it
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
        
        // FIXED: When a player bets, reset who has acted, except folded/all-in players
        gameState.playersActedThisRound = new Set();
        for (let i = 0; i < gameState.players.length; i++) {
          if (gameState.players[i].folded || gameState.players[i].isAllIn) {
            gameState.playersActedThisRound.add(i);
          }
        }
        // The betting player has acted
        gameState.playersActedThisRound.add(playerIndex);
        
        // FIXED: Record this position as the last aggressor
        gameState.lastRaiseIndex = playerIndex;
        
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
        
        // FIXED: When a player raises, reset who has acted, except folded/all-in players
        gameState.playersActedThisRound = new Set();
        for (let i = 0; i < gameState.players.length; i++) {
          if (gameState.players[i].folded || gameState.players[i].isAllIn) {
            gameState.playersActedThisRound.add(i);
          }
        }
        // The raising player has acted
        gameState.playersActedThisRound.add(playerIndex);
        
        // FIXED: Record this position as the last aggressor
        gameState.lastRaiseIndex = playerIndex;
        
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
    
    // Check if only one player is left (not folded)
    const activePlayers = gameState.players.filter(p => !p.folded);
    if (activePlayers.length === 1) {
      // Only one player left, they win
      this.endHand(gameState);
      return;
    }
    
    // FIXED: Check if all players have acted and bets are equal
    const allActed = this.allPlayersHaveActed(gameState);
    const betsAreEqual = this.allBetsAreEqual(gameState);
    
    if (allActed && betsAreEqual) {
      // End of betting round, move to next round
      this.nextRound(gameState);
      return;
    }
    
    // Find next active player
    let nextPlayer = (gameState.currentTurn + 1) % gameState.players.length;
    
    // Skip folded or all-in players
    while (
      gameState.players[nextPlayer].folded || 
      gameState.players[nextPlayer].isAllIn
    ) {
      nextPlayer = (nextPlayer + 1) % gameState.players.length;
      
      // If we've gone full circle and everyone is folded or all-in, move to next round
      if (nextPlayer === gameState.currentTurn) {
        this.nextRound(gameState);
        return;
      }
    }
    
    // Set next player's turn
    gameState.currentTurn = nextPlayer;
    gameState.players[gameState.currentTurn].isCurrentTurn = true;
  }
  
  // Check if all players have acted
  allPlayersHaveActed(gameState) {
    // If we haven't initialized the set of players who have acted, do so now
    if (!gameState.playersActedThisRound) {
      gameState.playersActedThisRound = new Set();
      
      // Mark folded and all-in players as having acted
      for (let i = 0; i < gameState.players.length; i++) {
        if (gameState.players[i].folded || gameState.players[i].isAllIn) {
          gameState.playersActedThisRound.add(i);
        }
      }
    }
    
    // Count active players (not folded, not all-in)
    const activePlayerCount = gameState.players.filter(
      p => !p.folded && !p.isAllIn
    ).length;
    
    // Check if all active players have acted
    return gameState.playersActedThisRound.size >= gameState.players.length;
  }

  allBetsAreEqual(gameState) {
    let lastBet = null;
    
    for (let i = 0; i < gameState.players.length; i++) {
      const player = gameState.players[i];
      
      // Skip folded players
      if (player.folded) {
        continue;
      }
      
      // All-in players may have lower bets, that's fine
      if (player.isAllIn) {
        continue;
      }
      
      // First active player sets the bet to match
      if (lastBet === null) {
        lastBet = player.totalBet;
        continue;
      }
      
      // If any player hasn't matched the bet, bets are not equal
      if (player.totalBet !== lastBet) {
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
    
    // Reset the current bet
    gameState.currentBet = 0;
    
    // Reset the list of players who have acted
    gameState.playersActedThisRound = new Set();
    
    // Mark folded and all-in players as having acted
    for (let i = 0; i < gameState.players.length; i++) {
      if (gameState.players[i].folded || gameState.players[i].isAllIn) {
        gameState.playersActedThisRound.add(i);
      }
    }
    
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
    
    // FIXED: In a real poker game, action starts with first active player after dealer
    let startPlayerIndex = (gameState.dealer + 1) % gameState.players.length;
    
    // Skip folded or all-in players
    while (
      gameState.players[startPlayerIndex].folded || 
      gameState.players[startPlayerIndex].isAllIn
    ) {
      startPlayerIndex = (startPlayerIndex + 1) % gameState.players.length;
      
      // If we've gone full circle and everyone is folded or all-in, go to showdown
      if (startPlayerIndex === gameState.dealer) {
        this.showdown(gameState);
        return;
      }
    }
    
    // Set the starting player's turn
    gameState.currentTurn = startPlayerIndex;
    gameState.players[gameState.currentTurn].isCurrentTurn = true;
  }
  
  // Setup dealer and blinds
  setupBlinds(gameState) {
    // Get only active players (not sitting out)
    const activePlayers = gameState.players.filter(p => !p.isSittingOut);
    const activeCount = activePlayers.length;
    
    if (activeCount < 2) {
      // Not enough players to start a hand
      gameState.isGameOver = true;
      this.io.to(gameState.lobbyId).emit('gameMessage', {
        message: 'Not enough players with chips to start a hand.'
      });
      return false;
    }
    
    // Set dealer (move to next active player)
    let dealerIndex = gameState.dealer;
    // Find the dealer position among active players only
    let dealerActiveIndex = 0;
    for (let i = 0; i < activePlayers.length; i++) {
      if (activePlayers[i].id === gameState.players[dealerIndex].id) {
        dealerActiveIndex = i;
        break;
      }
    }
    
    // Set the dealer flag
    activePlayers[dealerActiveIndex].isDealer = true;
    
    // Set small blind to next active player
    const sbActiveIndex = (dealerActiveIndex + 1) % activeCount;
    const sbPlayer = activePlayers[sbActiveIndex];
    sbPlayer.isSmallBlind = true;
    
    // Set big blind to next active player after small blind
    const bbActiveIndex = (sbActiveIndex + 1) % activeCount;
    const bbPlayer = activePlayers[bbActiveIndex];
    bbPlayer.isBigBlind = true;
    
    // Place small blind bet
    const sbAmount = Math.min(gameState.smallBlindAmount, sbPlayer.chips);
    sbPlayer.bet = sbAmount;
    sbPlayer.totalBet = sbAmount;
    sbPlayer.chips -= sbAmount;
    gameState.pot += sbAmount;
    
    if (sbPlayer.chips === 0) {
      sbPlayer.isAllIn = true;
    }
    
    // Place big blind bet
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
    
    // In pre-flop, action starts with UTG (player after big blind)
    const utgActiveIndex = (bbActiveIndex + 1) % activeCount;
    const utgPlayer = activePlayers[utgActiveIndex];
    
    // Find the UTG player's index in the full player list
    const utgIndex = gameState.players.findIndex(p => p.id === utgPlayer.id);
    gameState.currentTurn = utgIndex;
    gameState.players[utgIndex].isCurrentTurn = true;
    
    // Initialize the set of players who have acted
    gameState.playersActedThisRound = new Set();
    
    // Mark sitting out, folded and all-in players as having acted
    for (let i = 0; i < gameState.players.length; i++) {
      if (gameState.players[i].isSittingOut || gameState.players[i].folded || gameState.players[i].isAllIn) {
        gameState.playersActedThisRound.add(i);
      }
    }
    
    // Save the last raise position (big blind) to ensure proper round completion
    // Find the BB player's index in the full player list
    const bbIndex = gameState.players.findIndex(p => p.id === bbPlayer.id);
    gameState.lastRaiseIndex = bbIndex;
    
    return true;
  }

  showdown(gameState) {
    gameState.currentRound = 'showdown';
    
    // Get active players (not folded)
    const activePlayers = gameState.players.filter(p => !p.folded);
    
    if (activePlayers.length === 1) {
      // Only one player left, they win
      gameState.winner = activePlayers[0].id;
      const winAmount = gameState.pot;
      activePlayers[0].chips += winAmount;
      gameState.pot = 0;
      
      // Announce the winner
      this.io.to(gameState.lobbyId).emit('gameResult', {
        winnerId: gameState.winner,
        winnerName: activePlayers[0].username,
        amount: winAmount,
        reason: 'Last player standing'
      });
    } else {
      // For simplicity, pick a random winner for now
      // In a real implementation, evaluate hands using pokerSolver.js
      const winnerIndex = Math.floor(Math.random() * activePlayers.length);
      gameState.winner = activePlayers[winnerIndex].id;
      const winAmount = gameState.pot;
      activePlayers[winnerIndex].chips += winAmount;
      gameState.pot = 0;
      
      // Announce the winner
      this.io.to(gameState.lobbyId).emit('gameResult', {
        winnerId: gameState.winner,
        winnerName: activePlayers[winnerIndex].username,
        amount: winAmount,
        reason: 'Best hand at showdown'
      });
    }
    
    gameState.isGameOver = true;
    
    // Schedule the next hand after a delay
    setTimeout(() => {
      // Update player chip counts in the database
      this.updatePlayerChips(gameState);
      
      // Start a new hand
      this.startNewHand(gameState);
    }, 5000); // 5 second delay
  }
  
  
  endHand(gameState) {
    // Find the last active player
    const winner = gameState.players.find(p => !p.folded);
    
    if (winner) {
      gameState.winner = winner.id;
      const winAmount = gameState.pot;
      winner.chips += winAmount;
      gameState.pot = 0;
      
      // Announce the winner
      this.io.to(gameState.lobbyId).emit('gameResult', {
        winnerId: gameState.winner,
        winnerName: winner.username,
        amount: winAmount,
        reason: 'All other players folded'
      });
    }
    
    gameState.isGameOver = true;
    gameState.currentRound = 'showdown';
    
    // Schedule the next hand after a delay
    setTimeout(() => {
      // Update player chip counts in the database
      this.updatePlayerChips(gameState);
      
      // Start a new hand
      this.startNewHand(gameState);
    }, 5000); // 5 second delay
  }

  startNewHand(gameState) {
    // Notify players that a new hand is starting
    this.io.to(gameState.lobbyId).emit('handStarting', {
      message: 'New hand starting...',
      startTime: Date.now() + 2000 // 2 second countdown
    });
    
    // Reset the game state for a new hand
    gameState.tableCards = [];
    gameState.pot = 0;
    gameState.currentBet = 0;
    gameState.currentRound = 'pre-flop';
    gameState.isGameOver = false;
    gameState.winner = null;
    
    // Reset player states but keep chips!
    gameState.players.forEach(player => {
      player.hand = [];
      player.bet = 0;
      player.totalBet = 0;
      player.folded = false;
      player.isAllIn = false;
      player.isDealer = false;
      player.isSmallBlind = false;
      player.isBigBlind = false;
      player.isCurrentTurn = false;
    });
    
    // Move the dealer button
    gameState.dealer = (gameState.dealer + 1) % gameState.players.length;
    
    // Check if any players are out of chips
    const bustedPlayers = gameState.players.filter(player => player.chips <= 0);
    if (bustedPlayers.length > 0) {
      // Reload players with minimum buy-in if they bust
      bustedPlayers.forEach(player => {
        player.chips = 500; // Minimum buy-in
        
        // Announce rebuy
        this.io.to(gameState.lobbyId).emit('playerRebuy', {
          playerId: player.id,
          username: player.username,
          amount: 500
        });
      });
    }
    
    // Create a fresh deck
    gameState.deck = this.createShuffledDeck();
    
    // Deal cards to players
    gameState.players.forEach(player => {
      player.hand = [gameState.deck.pop(), gameState.deck.pop()];
    });
    
    // Set up blinds for the new hand
    this.setupBlinds(gameState);
    
    // Broadcast the updated game state
    this.broadcastGameState(gameState.lobbyId);
  }

  async updatePlayerChips(gameState) {
    try {
      // Only update if database is connected
      if (!this.db) return;
      
      const usersCollection = this.db.collection("users");
      
      // Update each player's chips in the database
      for (const player of gameState.players) {
        await usersCollection.updateOne(
          { _id: new ObjectId(player.id) },
          { $set: { chips: player.chips } }
        );
        
        console.log(`Updated chips for player ${player.username} to ${player.chips}`);
      }
    } catch (error) {
      console.error('Error updating player chips in database:', error);
    }
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