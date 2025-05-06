const express = require('express');
const session = require('express-session');
const path = require('path');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const { MongoClient, ObjectId } = require('mongodb');
const http = require('http');
const nodemailer = require('nodemailer');
const { Resend } = require('resend');
const resend = new Resend(process.env.RESEND_API_KEY);

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
  saveUninitialized: true,
  cookie: { 
    secure: process.env.NODE_ENV === 'production',
    httpOnly: false, // Set to false to make it accessible to JavaScript
    maxAge: 1000 * 60 * 60 * 24
  }
});

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(sessionMiddleware);

// Serve static files
// This is important - serve the entire Client directory as static
app.use(express.static(path.join(__dirname, '..', 'Client')));

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

// Authentication middleware for page requests
app.use((req, res, next) => {
  // Log the request path for debugging
  console.log(`Request path: ${req.path}`);
  
  // Paths that don't require authentication
  const publicPaths = [
    '/login.html', 
    '/signup.html', 
    '/forgot-password.html', 
    '/reset-password.html',
    '/api/login', 
    '/api/signup', 
    '/api/forgot-password', 
    '/api/reset-password',
    '/style.css', // Allow access to CSS
    '/pokerSolver.js' // Allow access to JS
  ];
  
  // Check if the path is a public asset (CSS, JS, images)
  const isPublicAsset = req.path.match(/\.(css|js|jpg|jpeg|png|gif|svg)$/i);
  
  // Skip authentication for API endpoints and public paths
  if (publicPaths.some(path => req.path.includes(path)) || isPublicAsset) {
    return next();
  }
  
  // Check if user is authenticated in session
  if (req.session.userId) {
    // User is logged in via session, continue to the requested page
    return next();
  } 
  
  // Check for authentication cookies
  const sessionToken = req.cookies.sessionToken;
  const rememberToken = req.cookies.rememberToken;
  
  if (sessionToken) {
    try {
      // Verify the session token
      const decoded = jwt.verify(sessionToken, JWT_SECRET);
      req.session.userId = decoded.userId;
      return next();
    } catch (error) {
      console.error('Session token verification error:', error);
      // Clear invalid session token
      res.clearCookie('sessionToken');
      // Continue to check other auth methods
    }
  }
  
  if (rememberToken) {
    try {
      // Verify the remember token
      const decoded = jwt.verify(rememberToken, JWT_SECRET);
      req.session.userId = decoded.userId;
      return next();
    } catch (error) {
      console.error('Remember token verification error:', error);
      // Clear invalid remember token
      res.clearCookie('rememberToken');
    }
  }
  
  // If it's an API request, return 401 Unauthorized
  if (req.path.startsWith('/api/')) {
    return res.status(401).json({ message: 'Authentication required' });
  }
  
  // Otherwise redirect to login page
  return res.redirect('/Screens/login.html');
});

// Root route - redirect to index.html if authenticated
app.get('/', (req, res) => {
  if (!req.session.userId && !req.cookies.rememberToken) {
    return res.redirect('/Screens/login.html');
  }
  res.sendFile(path.join(__dirname, '..', 'Client', 'Screens', 'index.html'));
});

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
    req.session.userId = user._id.toString(); // Convert to string to ensure consistent format
    req.session.save((err) => {
      if (err) {
        console.error('Session save error:', err);
      }
    });
    console.log("User logged in:", username, "Session ID:", req.session.id);
    
    // Create a session token (expires when browser is closed)
    const sessionToken = jwt.sign(
      { userId: user._id.toString() },
      JWT_SECRET,
      { expiresIn: '12h' } // Session token expires after 12 hours of inactivity
    );
    
    // Set session token cookie (no maxAge = session cookie that expires when browser closes)
    res.cookie('sessionToken', sessionToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict'
    });
    
    // If remember me is checked, also set a persistent cookie
    if (rememberMe) {
      // Create a JWT token with user ID
      const rememberToken = jwt.sign(
        { userId: user._id.toString() },
        JWT_SECRET,
        { expiresIn: '14d' } // Token expires after 14 days
      );
      
      // Set the token in a cookie
      res.cookie('rememberToken', rememberToken, {
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
  
  // Clear all authentication cookies
  res.clearCookie('sessionToken');
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
        res.clearCookie('sessionToken');
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
    
    // If not in session, check for authentication cookies
    const sessionToken = req.cookies.sessionToken;
    const rememberToken = req.cookies.rememberToken;
    
    // First try session token (temporary login)
    if (sessionToken) {
      try {
        const decoded = jwt.verify(sessionToken, JWT_SECRET);
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
        console.error('Session token verification error:', error);
        res.clearCookie('sessionToken');
      }
    }
    
    // Then try remember token (long-term login)
    if (rememberToken) {
      try {
        const decoded = jwt.verify(rememberToken, JWT_SECRET);
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
        console.error('Remember token verification error:', error);
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
    
    // Start the game
    const lobby = await lobbyModel.startGame(lobbyId, userId);
    
    res.json({ lobby });
  } catch (error) {
    console.error('Start game error:', error);
    res.status(400).json({ message: error.message || 'An error occurred while starting the game' });
  }
});

app.post('/api/user/add-chips', requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId;
    const { amount } = req.body;
    
    // Validate amount
    const chipAmount = parseInt(amount, 10);
    if (isNaN(chipAmount) || chipAmount <= 0) {
      return res.status(400).json({ message: 'Invalid chip amount' });
    }
    
    // Set a maximum amount to prevent integer overflow
    // JavaScript's max safe integer is 9007199254740991, but we'll use a more reasonable limit
    const MAX_CHIPS = 1000000000; // 1 billion chips
    
    // Get current user
    const usersCollection = db.collection("users");
    const user = await usersCollection.findOne({ _id: new ObjectId(userId) });
    
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    // Calculate new chip total, respecting the max limit
    const currentChips = user.chips || 0;
    const newTotal = Math.min(currentChips + chipAmount, MAX_CHIPS);
    
    // Update user's chips in the database
    const result = await usersCollection.updateOne(
      { _id: new ObjectId(userId) },
      { $set: { chips: newTotal } }
    );
    
    if (result.modifiedCount === 0) {
      return res.status(500).json({ message: 'Failed to update chips' });
    }
    
    // Return success with new total
    res.json({
      message: 'Chips added successfully',
      chips: newTotal,
      added: newTotal - currentChips // This might be less than requested if hit max
    });
    
  } catch (error) {
    console.error('Add chips error:', error);
    res.status(500).json({ message: 'An error occurred while adding chips' });
  }
});

/**
 * Quick add money API - Adds a fixed amount to the user's balance
 * POST /api/user/quick-add-money
 */
app.post('/api/user/quick-add-money', requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId;
    // Fixed amount to add - you can change this value as needed
    const QUICK_ADD_AMOUNT = 1000;
    
    // Get current user
    const usersCollection = db.collection("users");
    const user = await usersCollection.findOne({ _id: new ObjectId(userId) });
    
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    // Calculate new chip total
    const currentChips = user.chips || 0;
    const newTotal = currentChips + QUICK_ADD_AMOUNT;
    
    // Update user's chips in the database
    const result = await usersCollection.updateOne(
      { _id: new ObjectId(userId) },
      { $set: { chips: newTotal } }
    );
    
    if (result.modifiedCount === 0) {
      return res.status(500).json({ message: 'Failed to update chips' });
    }
    
    // Return success with new total
    res.json({
      message: 'Chips added successfully',
      chips: newTotal,
      added: QUICK_ADD_AMOUNT
    });
    
  } catch (error) {
    console.error('Quick add chips error:', error);
    res.status(500).json({ message: 'An error occurred while adding chips' });
  }
});

/**
 * Forgot password API - Request password reset email
 * POST /api/forgot-password
*/
app.post('/api/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    
    if (!email) {
      return res.status(400).json({ message: 'Email is required' });
    }
    
    // Find the user with this email
    const usersCollection = db.collection("users");
    const user = await usersCollection.findOne({ email });
    
    // Generate a token whether the user exists or not
    // This way, we don't leak information about which emails exist in our system
    const token = crypto.randomBytes(32).toString('hex');
    
    // Only proceed with token storage if the user exists
    if (user) {
      // Store the token in the database with expiration time (1 hour from now)
      const resetTokensCollection = db.collection("reset_tokens");
      
      // Set expiration time (1 hour from now)
      const expiresAt = new Date();
      expiresAt.setHours(expiresAt.getHours() + 1);
      
      // Create the token record
      await resetTokensCollection.insertOne({
        userId: user._id,
        token,
        expiresAt
      });
      
      // Send email with Resend
      try {
        const baseUrl = process.env.BASE_URL || `http://${req.get('host') || 'localhost:3000'}`;
        const resetLink = `${baseUrl}/Screens/reset-password.html?token=${token}`;

        console.log('we innnn swamp izzo');
        const { data, error } = await resend.emails.send({
          from: process.env.FROM_EMAIL || 'onboarding@resend.dev',
          to: user.email,
          subject: 'Password Reset Request',
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <h2 style="color: #2c3e50;">Password Reset Request</h2>
              <p>You requested a password reset for your Poker Game account.</p>
              <p>Please click the button below to reset your password:</p>
              <div style="text-align: center; margin: 30px 0;">
                <a href="${resetLink}" 
                  style="background-color: #3498db; color: white; padding: 12px 25px; text-decoration: none; border-radius: 5px; display: inline-block;">
                  Reset Password
                </a>
              </div>
              <p>This link will expire in 1 hour.</p>
              <p>If you didn't request this password reset, please ignore this email.</p>
            </div>
            `
        });

        if (error) {
          console.error('Error sending email with Resend:', error);
        } else {
          console.log('Reset password email sent successfully with ID:', data.id);
        }
      } catch (emailError) {
        console.error('Exception when sending email with Resend:', emailError);
      }
    } else {
      console.log(`Password reset requested for non-existent email: ${email}`);
    }

    // Always return the same response whether the user exists or not
    // For security reasons, don't reveal if an email exists in our system
    const response = {
      message: 'If an account with that email exists, a password reset link has been sent.'
    };

    // Only in development mode, include the token in the response
    if (process.env.NODE_ENV !== 'production' && user) {
      response.development = true;
      response.token = token;
    }

    return res.status(200).json(response);

  } catch (error) {
    console.error('Forgot password error:', error);

    // Still return a "success" response for security
    // Don't reveal if the error was related to a specific email
    return res.status(200).json({
      message: 'If an account with that email exists, a password reset link has been sent.'
    });
  }
});

/**
 * Reset password API
 * POST /api/reset-password
 */
app.post('/api/reset-password', async (req, res) => {
  try {
    const { token, password } = req.body;
    
    if (!token || !password) {
      return res.status(400).json({ message: 'Token and password are required' });
    }
    
    // Validate password
    if (password.length < 6) {
      return res.status(400).json({ message: 'Password must be at least 6 characters long' });
    }
    
    // Find the token
    const resetTokensCollection = db.collection("reset_tokens");
    const tokenDoc = await resetTokensCollection.findOne({ token });
    
    if (!tokenDoc) {
      return res.status(400).json({ message: 'Invalid or expired token' });
    }
    
    // Check if token is expired
    if (tokenDoc.expiresAt < new Date()) {
      await resetTokensCollection.deleteOne({ token });
      return res.status(400).json({ message: 'Token has expired' });
    }
    
    // Hash the new password
    const bcrypt = require('bcrypt');
    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(password, saltRounds);
    
    // Update the user's password
    const usersCollection = db.collection("users");
    const result = await usersCollection.updateOne(
      { _id: tokenDoc.userId },
      { $set: { password: hashedPassword, updated_at: new Date() } }
    );
    
    if (result.modifiedCount === 0) {
      return res.status(400).json({ message: 'Failed to update password' });
    }
    
    // Delete the token
    await resetTokensCollection.deleteOne({ token });
    
    res.status(200).json({ message: 'Password has been reset successfully' });
    
  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({ message: 'Error resetting password' });
  }
});

// Direct screen routes for our HTML pages
app.get('/Screens/:page', (req, res) => {
  console.log(`Serving screen: ${req.params.page}`);
  res.sendFile(path.join(__dirname, '..', 'Client', 'Screens', req.params.page));
});

// Handle deeper path structures
app.get('/Screens/:folder/:page', (req, res) => {
  // Extract just the filename part before any query parameters
  const pageName = req.params.page.split('?')[0];
  console.log(`Serving nested screen: ${req.params.folder}/${pageName}`);
  res.sendFile(path.join(__dirname, '..', 'Client', 'Screens', req.params.folder, pageName));
});

// Catch-all route to handle page refreshes with client-side routing
app.get('*', (req, res) => {
  console.log(`Catch-all route hit for: ${req.path}`);
  if (!req.session.userId && !req.cookies.rememberToken) {
    return res.redirect('/Screens/login.html');
  }
  // For all other routes, send the index.html
  res.sendFile(path.join(__dirname, '..', 'Client', 'Screens', 'index.html'));
});

// Start the server
async function startServer() {
  await connectToDatabase();
  
  // Import and initialize Socket.io after database connection is established
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