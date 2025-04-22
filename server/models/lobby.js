const { ObjectId } = require("mongodb");
const crypto = require("crypto");

class LobbyModel {
  constructor() {
    this.client = null;
    this.db = null;
    this.collection = null;
    this.isConnected = false;
  }

  async connect(client) {
    if (this.isConnected) return;

    if (client) {
      this.client = client;
      this.db = client.db("poker");
      this.collection = this.db.collection("lobbies");
      this.isConnected = true;
      
      // Create indexes
      await this.collection.createIndex({ pin: 1 }, { unique: true });
      await this.collection.createIndex({ createdAt: 1 }, { expireAfterSeconds: 86400 }); // Auto-delete after 24 hours
      
      console.log("Connected to lobbies collection");
    } else {
      throw new Error("MongoDB client is required");
    }
  }

  // Generate a unique 6-digit PIN
  async generateUniquePin() {
    let pin;
    let exists = true;
    
    // Keep generating until we find a unique PIN
    while (exists) {
      // Generate a random 6-digit number
      pin = Math.floor(100000 + Math.random() * 900000).toString();
      
      // Check if this PIN already exists
      const existingLobby = await this.collection.findOne({ pin });
      exists = !!existingLobby;
    }
    
    return pin;
  }

  // Create a new lobby
  async createLobby(userId, username, lobbyName, maxPlayers = 6) {
    if (!this.isConnected) {
      throw new Error("Database not connected");
    }
    
    // Generate a unique PIN
    const pin = await this.generateUniquePin();
    
    // Create the lobby document
    const lobby = {
      name: lobbyName,
      pin: pin,
      creatorId: new ObjectId(userId),
      creatorName: username,
      maxPlayers: Math.min(maxPlayers, 6), // Ensure maximum of 6 players
      players: [{
        id: new ObjectId(userId),
        username: username,
        chips: 0, // Will be set when game starts
        isCreator: true,
        isReady: false
      }],
      status: "waiting", // waiting, starting, in_progress, completed
      createdAt: new Date(),
      updatedAt: new Date()
    };
    
    // Insert the lobby into the database
    const result = await this.collection.insertOne(lobby);
    
    // Return the created lobby with its ID
    return {
      ...lobby,
      _id: result.insertedId
    };
  }

  // Get lobby by PIN
  async getLobbyByPin(pin) {
    if (!this.isConnected) {
      throw new Error("Database not connected");
    }
    
    return await this.collection.findOne({ pin });
  }

  // Get lobby by ID
  async getLobbyById(lobbyId) {
    if (!this.isConnected) {
      throw new Error("Database not connected");
    }
    
    try {
      return await this.collection.findOne({ _id: new ObjectId(lobbyId) });
    } catch (error) {
      console.error("Error getting lobby by ID:", error);
      return null;
    }
  }

  // Join a lobby
  async joinLobby(lobbyId, userId, username) {
    if (!this.isConnected) {
      throw new Error("Database not connected");
    }
    
    // Get the lobby
    const lobby = await this.getLobbyById(lobbyId);
    
    if (!lobby) {
      throw new Error("Lobby not found");
    }
    
    // Check if the player is already in the lobby
    const existingPlayer = lobby.players.find(p => p.id.toString() === userId.toString());
    if (existingPlayer) {
      throw new Error("Player already in lobby");
    }
    
    // Check if the lobby is full
    if (lobby.players.length >= lobby.maxPlayers) {
      throw new Error("Lobby is full");
    }
    
    // Check if the game is already in progress
    if (lobby.status !== "waiting") {
      throw new Error("Game is already in progress");
    }
    
    // Add the player to the lobby
    const result = await this.collection.updateOne(
      { _id: new ObjectId(lobbyId) },
      { 
        $push: { 
          players: {
            id: new ObjectId(userId),
            username: username,
            chips: 0,
            isCreator: false,
            isReady: false
          } 
        },
        $set: { updatedAt: new Date() }
      }
    );
    
    if (result.modifiedCount === 0) {
      throw new Error("Failed to join lobby");
    }
    
    return await this.getLobbyById(lobbyId);
  }

  // Leave a lobby
  async leaveLobby(lobbyId, userId) {
    if (!this.isConnected) {
      throw new Error("Database not connected");
    }
    
    // Get the lobby
    const lobby = await this.getLobbyById(lobbyId);
    
    if (!lobby) {
      throw new Error("Lobby not found");
    }
    
    // Check if the player is in the lobby
    const playerIndex = lobby.players.findIndex(p => p.id.toString() === userId.toString());
    if (playerIndex === -1) {
      throw new Error("Player not in lobby");
    }
    
    // If the player is the creator and there are other players, assign a new creator
    const isCreator = lobby.players[playerIndex].isCreator;
    let update = {
      $pull: { players: { id: new ObjectId(userId) } },
      $set: { updatedAt: new Date() }
    };
    
    const result = await this.collection.updateOne(
      { _id: new ObjectId(lobbyId) },
      update
    );
    
    // Get updated lobby
    const updatedLobby = await this.getLobbyById(lobbyId);
    
    // If the creator left and there are still players, assign the first player as the new creator
    if (isCreator && updatedLobby && updatedLobby.players.length > 0) {
      await this.collection.updateOne(
        { _id: new ObjectId(lobbyId), "players.id": updatedLobby.players[0].id },
        { $set: { "players.$.isCreator": true } }
      );
    }
    
    // If no players left, delete the lobby
    if (updatedLobby && updatedLobby.players.length === 0) {
      await this.collection.deleteOne({ _id: new ObjectId(lobbyId) });
      return null;
    }
    
    return await this.getLobbyById(lobbyId);
  }

  // Get all active lobbies
  async getActiveLobbies() {
    if (!this.isConnected) {
      throw new Error("Database not connected");
    }
    
    return await this.collection.find({ 
      status: "waiting",
      // Only include lobbies that are not full
      $expr: { $lt: [{ $size: "$players" }, "$maxPlayers"] }
    }).toArray();
  }

  // Update player ready status
  async updatePlayerReadyStatus(lobbyId, userId, isReady) {
    if (!this.isConnected) {
      throw new Error("Database not connected");
    }
    
    const result = await this.collection.updateOne(
      { _id: new ObjectId(lobbyId), "players.id": new ObjectId(userId) },
      { $set: { "players.$.isReady": isReady, updatedAt: new Date() } }
    );
    
    if (result.modifiedCount === 0) {
      throw new Error("Failed to update player status");
    }
    
    return await this.getLobbyById(lobbyId);
  }

  // Start the game
  async startGame(lobbyId, userId) {
    if (!this.isConnected) {
      throw new Error("Database not connected");
    }
    
    // Get the lobby
    const lobby = await this.getLobbyById(lobbyId);
    
    if (!lobby) {
      throw new Error("Lobby not found");
    }
    
    // Verify the user is the creator
    const player = lobby.players.find(p => p.id.toString() === userId.toString());
    if (!player || !player.isCreator) {
      throw new Error("Only the creator can start the game");
    }
    
    // Check if all players are ready
    const allReady = lobby.players.every(p => p.isCreator || p.isReady);
    if (!allReady) {
      throw new Error("Not all players are ready");
    }
    
    // Update the lobby status
    const result = await this.collection.updateOne(
      { _id: new ObjectId(lobbyId) },
      { 
        $set: { 
          status: "in_progress",
          updatedAt: new Date(),
          gameStartedAt: new Date()
        } 
      }
    );
    
    if (result.modifiedCount === 0) {
      throw new Error("Failed to start game");
    }
    
    return await this.getLobbyById(lobbyId);
  }
}

// Export a singleton instance
module.exports = new LobbyModel();