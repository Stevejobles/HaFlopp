// Add these imports to server.js
const lobbyModel = require('./models/lobby');

// Initialize the lobby model
async function initializeLobbyModel(client) {
  await lobbyModel.connect(client);
}

// Middleware to check if user is authenticated
function requireAuth(req, res, next) {
  if (req.session.userId) {
    return next();
  }
  
  // Check for authentication cookie
  const token = req.cookies.rememberToken;
  if (token) {
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      req.session.userId = decoded.userId;
      return next();
    } catch (error) {
      console.error('Token verification error:', error);
      res.clearCookie('rememberToken');
    }
  }
  
  res.status(401).json({ message: 'Authentication required' });
}

// Add these routes to server.js

// Create a new lobby
app.post('/api/lobbies', requireAuth, async (req, res) => {
  try {
    const { lobbyName, maxPlayers } = req.body;
    const userId = req.session.userId;
    
    // Validate input
    if (!lobbyName) {
      return res.status(400).json({ message: 'Lobby name is required' });
    }
    
    // Get user information
    const usersCollection = db.collection("users");
    const user = await usersCollection.findOne({ _id: new ObjectId(userId) });
    
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    // Create the lobby
    const lobby = await lobbyModel.createLobby(
      userId, 
      user.username, 
      lobbyName, 
      maxPlayers || 6
    );
    
    res.status(201).json({ lobby });
  } catch (error) {
    console.error('Create lobby error:', error);
    res.status(500).json({ message: 'An error occurred while creating the lobby' });
  }
});

// Get lobby by ID
app.get('/api/lobbies/:id', requireAuth, async (req, res) => {
  try {
    const lobbyId = req.params.id;
    const lobby = await lobbyModel.getLobbyById(lobbyId);
    
    if (!lobby) {
      return res.status(404).json({ message: 'Lobby not found' });
    }
    
    res.json({ lobby });
  } catch (error) {
    console.error('Get lobby error:', error);
    res.status(500).json({ message: 'An error occurred while getting the lobby' });
  }
});

// Get lobby by PIN
app.get('/api/lobbies/pin/:pin', requireAuth, async (req, res) => {
  try {
    const pin = req.params.pin;
    const lobby = await lobbyModel.getLobbyByPin(pin);
    
    if (!lobby) {
      return res.status(404).json({ message: 'Lobby not found' });
    }
    
    res.json({ lobby });
  } catch (error) {
    console.error('Get lobby by PIN error:', error);
    res.status(500).json({ message: 'An error occurred while getting the lobby' });
  }
});

// Join a lobby
app.post('/api/lobbies/:id/join', requireAuth, async (req, res) => {
  try {
    const lobbyId = req.params.id;
    const userId = req.session.userId;
    
    // Get user information
    const usersCollection = db.collection("users");
    const user = await usersCollection.findOne({ _id: new ObjectId(userId) });
    
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    // Join the lobby
    const lobby = await lobbyModel.joinLobby(lobbyId, userId, user.username);
    
    res.json({ lobby });
  } catch (error) {
    console.error('Join lobby error:', error);
    res.status(400).json({ message: error.message || 'An error occurred while joining the lobby' });
  }
});

// Leave a lobby
app.post('/api/lobbies/:id/leave', requireAuth, async (req, res) => {
  try {
    const lobbyId = req.params.id;
    const userId = req.session.userId;
    
    // Leave the lobby
    const lobby = await lobbyModel.leaveLobby(lobbyId, userId);
    
    res.json({ lobby });
  } catch (error) {
    console.error('Leave lobby error:', error);
    res.status(400).json({ message: error.message || 'An error occurred while leaving the lobby' });
  }
});

// Get all active lobbies
app.get('/api/lobbies', requireAuth, async (req, res) => {
  try {
    const lobbies = await lobbyModel.getActiveLobbies();
    res.json({ lobbies });
  } catch (error) {
    console.error('Get lobbies error:', error);
    res.status(500).json({ message: 'An error occurred while getting lobbies' });
  }
});

// Set player ready status
app.post('/api/lobbies/:id/ready', requireAuth, async (req, res) => {
  try {
    const lobbyId = req.params.id;
    const userId = req.session.userId;
    const { isReady } = req.body;
    
    // Update player ready status
    const lobby = await lobbyModel.updatePlayerReadyStatus(lobbyId, userId, isReady);
    
    res.json({ lobby });
  } catch (error) {
    console.error('Update ready status error:', error);
    res.status(400).json({ message: error.message || 'An error occurred while updating ready status' });
  }
});

// Start the game
app.post('/api/lobbies/:id/start', requireAuth, async (req, res) => {
  try {
    const lobbyId = req.params.id;
    const userId = req.session.userId;
    
    // Start the game
    const lobby = await lobbyModel.startGame(lobbyId, userId);
    
    res.json({ lobby });
  } catch (error) {
    console.error('Start game error:', error);
    res.status(400).json({ message: error.message || 'An error occurred while starting the game' });
  }
});

// Add this to the startServer function
async function startServer() {
  await connectToDatabase();
  await initializeLobbyModel(client);
  
  app.listen(port, () => {
    console.log(`Poker server running at http://localhost:${port}`);
  });
}