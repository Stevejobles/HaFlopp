const express = require('express');
const session = require('express-session');
const path = require('path');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const { MongoClient, ObjectId } = require('mongodb');
const http = require('http');

// Import our models
const lobbyModel = require('./models/lobby');
const pokerGame = require('./models/pokerGame');

const app = express();
const port = process.env.PORT || 3000;

// Create HTTP server
const server = http.createServer(app);

// MongoDB Connection
let db;
const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017';
const client = new MongoClient(uri);

async function connectToDatabase() {
  try {
    await client.connect();
    console.log("Connected to MongoDB");
    db = client.db("poker");
    
    // Create indexes for users collection
    const usersCollection = db.collection("users");
    await usersCollection.createIndex({ username: 1 }, { unique: true });
    await usersCollection.createIndex({ email: 1 }, { unique: true });
    
    // Initialize our models
    await lobbyModel.connect(client);
    await pokerGame.connect(client);
    
    return "Connected to database";
  } catch (error) {
    console.error("Error connecting to database:", error);
    process.exit(1);
  }
}

// JWT secret key
const JWT_SECRET = process.env.JWT_SECRET || 'haflop-secret-key-should-be-environment-variable';

// Session middleware
const sessionMiddleware = session({
  secret: 'haflop-poker-secret-key',
  resave: false,
  saveUninitialized: false,
  cookie: { 
    secure: process.env.NODE_ENV === 'production', // Set to true if using HTTPS
    maxAge: 1000 * 60 * 60 * 24 // 24 hours
  }
});

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(sessionMiddleware);

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

// Authentication redirect middleware - add this after other middleware but before routes
app.use((req, res, next) => {
  // Paths that don't require authentication
  const publicPaths = [
    '/login.html', 
    '/signup.html', 
    '/forgot-password.html', 
    '/reset-password.html',
    '/api/login', 
    '/api/signup', 
    '/api/forgot-password', 
    '/api/reset-password'
  ];
  
  // Check if the path is a public asset (CSS, JS, images)
  const isPublicAsset = req.path.match(/\.(css|js|jpg|jpeg|png|gif|svg)$/i);
  
  // Skip authentication for API endpoints and public paths
  if (publicPaths.some(path => req.path.includes(path)) || isPublicAsset) {
    return next();
  }
  
  // Check if user is authenticated
  if (req.session.userId) {
    // User is logged in, continue to the requested page
    return next();
  } else {
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
    
    // If it's an API request, return 401 Unauthorized
    if (req.path.startsWith('/api/')) {
      return res.status(401).json({ message: 'Authentication required' });
    }
    
    // Otherwise redirect to login page
    return res.redirect('/login.html');
  }
});

// Modify this route to redirect to login
app.get('/', (req, res) => {
  if (!req.session.userId && !req.cookies.rememberToken) {
    return res.redirect('/login.html');
  }
  res.sendFile(path.join(__dirname, '..', 'Client', 'Screens', 'index.html'));
});

// Your other routes remain the same...

// Serve static files from the Client directory
app.use(express.static(path.join(__dirname, '..', 'Client')));

// User Registration (Signup) API
app.post('/api/signup', async (req, res) => {
  try {
    const { username, email, password } = req.body;
    console.log("Received signup request:", { username, email, password: "***" });

    // Validate input
    if (!username || !email || !password) {
      return res.status(400).json({ 
        message: 'Username, email and password are required' 
      });
    }
    
    if (username.length < 3) {
      return res.status(400).json({ 
        field: 'username', 
        message: 'Username must be at least 3 characters long' 
      });
    }
    
    if (password.length < 6) {
      return res.status(400).json({ 
        field: 'password', 
        message: 'Password must be at least 6 characters long' 
      });
    }

    // Check if username or email already exists
    const usersCollection = db.collection("users");
    const existingUser = await usersCollection.findOne({ 
      $or: [{ username }, { email }] 
    });
    
    if (existingUser) {
      if (existingUser.username === username) {
        return res.status(400).json({ field: 'username', message: 'Username already taken' });
      } else {
        return res.status(400).json({ field: 'email', message: 'Email already registered' });
      }
    }
    
    // Hash the password
    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(password, saltRounds);
    
    // Create the user in the database
    const newUser = {
      username,
      email,
      password: hashedPassword,
      chips: 1000, // Starting chips
      created_at: new Date(),
      updated_at: new Date()
    };
    
    const result = await usersCollection.insertOne(newUser);
    console.log("User created successfully:", result.insertedId);
    
    // Return the new user (without the password)
    res.status(201).json({ 
      message: 'User created successfully', 
      user: {
        id: result.insertedId,
        username,
        email,
        chips: newUser.chips
      }
    });
  } catch (error) {
    console.error('Signup error:', error);
    if (error.code === 11000) { // MongoDB duplicate key error
      return res.status(400).json({ 
        field: error.keyPattern?.username ? 'username' : 'email',
        message: error.keyPattern?.username ? 'Username already taken' : 'Email already registered'
      });
    }
    res.status(500).json({ message: 'An error occurred during sign up' });
  }
});

// Login API
app.post('/api/login', async (req, res) => {
  try {
    const { username, password, rememberMe } = req.body;
    console.log("Login attempt for:", username);
    
    // Validate input
    if (!username || !password) {
      return res.status(400).json({ 
        message: 'Username and password are required' 
      });
    }
    
    // Find the user
    const usersCollection = db.collection("users");
    const user = await usersCollection.findOne({ username });
    
    if (!user) {
      console.log("User not found:", username);
      return res.status(401).json({ message: 'Invalid username or password' });
    }
    
    // Verify password
    const isPasswordValid = await bcrypt.compare(password, user.password);
    
    if (!isPasswordValid) {
      console.log("Invalid password for user:", username);
      return res.status(401).json({ message: 'Invalid username or password' });
    }
    
    // Set session
    req.session.userId = user._id;
    console.log("User logged in:", username);
    
    // If remember me is checked, set a persistent cookie
    if (rememberMe) {
      // Create a JWT token with user ID
      const token = jwt.sign(
        { userId: user._id },
        JWT_SECRET,
        { expiresIn: '14d' } // Token expires after 14 days
      );
      
      // Set the token in a cookie
      res.cookie('rememberToken', token, {
        maxAge: 14 * 24 * 60 * 60 * 1000, // 14 days
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict'
      });
    }
    
    // Return user data (without password)
    res.json({
      message: 'Login successful',
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        chips: user.chips
      }
    });
    
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ message: 'An error occurred during login' });
  }
});

// Logout API
app.post('/api/logout', (req, res) => {
  // Clear the session
  req.session.destroy();
  
  // Clear the remember me cookie
  res.clearCookie('rememberToken');
  
  res.json({ message: 'Logged out successfully' });
});

// Get current user API
app.get('/api/user', async (req, res) => {
  try {
    // Check if user is authenticated via session
    if (req.session.userId) {
      const usersCollection = db.collection("users");
      const user = await usersCollection.findOne({ _id: new ObjectId(req.session.userId) });
      
      if (!user) {
        req.session.destroy();
        res.clearCookie('rememberToken');
        return res.status(401).json({ message: 'User not found' });
      }
      
      return res.json({ 
        user: {
          id: user._id,
          username: user.username,
          email: user.email,
          chips: user.chips
        } 
      });
    }
    
    // If not in session, check for authentication cookie
    const token = req.cookies.rememberToken;
    if (token) {
      try {
        const decoded = jwt.verify(token, JWT_SECRET);
        const usersCollection = db.collection("users");
        const user = await usersCollection.findOne({ _id: new ObjectId(decoded.userId) });
        
        if (user) {
          req.session.userId = user._id;
          return res.json({ 
            user: {
              id: user._id,
              username: user.username,
              email: user.email,
              chips: user.chips
            } 
          });
        }
      } catch (error) {
        console.error('Token verification error:', error);
        res.clearCookie('rememberToken');
      }
    }
    
    return res.status(401).json({ message: 'Not authenticated' });
  } catch (error) {
    console.error('Get user error:', error);
    return res.status(500).json({ message: 'Server error' });
  }
});

// LOBBY MANAGEMENT ENDPOINTS

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
    
    // Start the game via traditional REST API
    const lobby = await lobbyModel.startGame(lobbyId, userId);
    
    // Also start the game via WebSockets for real-time updates
    // We'll use the socketManager later after it's initialized
    
    res.json({ lobby });
  } catch (error) {
    console.error('Start game error:', error);
    res.status(400).json({ message: error.message || 'An error occurred while starting the game' });
  }
});

// Route to serve the login page
app.get('/login', (req, res) => {
  // If already logged in, redirect to home
  if (req.session.userId) {
    return res.redirect('/');
  }
  res.sendFile(path.join(__dirname, '..', 'Client', 'Screens', 'login.html'));
});

// Login page is also available at /login.html
app.get('/login.html', (req, res) => {
  // If already logged in, redirect to home
  if (req.session.userId) {
    return res.redirect('/');
  }
  res.sendFile(path.join(__dirname, '..', 'Client', 'Screens', 'login.html'));
});

// Route to serve the signup page
app.get('/signup', (req, res) => {
  // If already logged in, redirect to home
  if (req.session.userId) {
    return res.redirect('/');
  }
  res.sendFile(path.join(__dirname, '..', 'Client', 'Screens', 'signup.html'));
});

app.get('/signup.html', (req, res) => {
  // If already logged in, redirect to home
  if (req.session.userId) {
    return res.redirect('/');
  }
  res.sendFile(path.join(__dirname, '..', 'Client', 'Screens', 'signup.html'));
});

// Other public pages
app.get('/forgot-password', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'Client', 'Screens', 'forgot-password.html'));
});

app.get('/forgot-password.html', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'Client', 'Screens', 'forgot-password.html'));
});

app.get('/reset-password', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'Client', 'Screens', 'reset-password.html'));
});

app.get('/reset-password.html', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'Client', 'Screens', 'reset-password.html'));
});

// Protected routes - all of these already have the requireAuth middleware
// so they'll redirect to login if user isn't authenticated

// Catch-all route to handle page refreshes with client-side routing
// This will also catch any undefined routes and redirect to login if not authenticated
app.get('*', (req, res) => {
  if (!req.session.userId && !req.cookies.rememberToken) {
    return res.redirect('/login.html');
  }
  // For all other routes, serve the main app
  res.sendFile(path.join(__dirname, '..', 'Client', 'Screens', 'index.html'));
});

// Start the server
async function startServer() {
  await connectToDatabase();
  
  // Import and initialize Socket.io after database connection is established
  // This avoids the "Module not found" error, as the module is loaded here
  const SocketManager = require('./socketManager');
  const socketManager = SocketManager.getInstance(server, sessionMiddleware, db);
  
  // Start HTTP server
  server.listen(port, () => {
    console.log(`Poker server running at http://localhost:${port}`);
  });
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
  console.log('Closing database connection...');
  await client.close();
  console.log('Database connection closed.');
  process.exit(0);
});

// Start the server
startServer().catch(console.error);

// For platforms like Render that need direct binding
// If startServer() isn't executed correctly for some reason
if (process.env.NODE_ENV === 'production') {
  // Ensure the server is listening on a port for platforms like Render
  server.listen(port, () => {
    console.log(`Backup listener: Server running on port ${port}`);
  });
}