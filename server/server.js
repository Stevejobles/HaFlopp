const express = require('express');
const session = require('express-session');
const path = require('path');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const { MongoClient, ObjectId } = require('mongodb');
const http = require('http');
const sgMail = require('@sendgrid/mail');

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
    return res.redirect('/Screens/login.html');
  }
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
    
    // If remember me is checked, set a persistent cookie
    if (rememberMe) {
      // Create a JWT token with user ID
      const token = jwt.sign(
        { userId: user._id.toString() },
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
 * Forgot password API - Request password reset email
 * POST /api/forgot-password
 */

app.post('/api/forgot-password', async (req, res) => {
  let emailSent = false;

  try {
    // Check if we have SMTP settings in environment variables
    if (process.env.SMTP_USER && process.env.SMTP_PASS) {
      console.log(`Attempting to connect to SMTP server: ${process.env.SMTP_HOST || 'gmail'}`);

      // For Gmail, we'll use the specialized service setting if the host is gmail
      let transportConfig;

      if (process.env.SMTP_HOST === 'smtp.gmail.com') {
        // Gmail-specific transport configuration
        transportConfig = {
          service: 'gmail',  // Using gmail preset
          auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS
          },
          // Extended timeout settings to prevent quick timeouts
          connectionTimeout: 60000, // 60 seconds
          greetingTimeout: 30000,   // 30 seconds
          socketTimeout: 60000      // 60 seconds
        };
        console.log('Using Gmail preset configuration');
      } else {
        // Standard SMTP configuration for other providers
        transportConfig = {
          host: process.env.SMTP_HOST,
          port: process.env.SMTP_PORT || 587,
          secure: process.env.SMTP_SECURE === 'true',
          auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS
          },
          // Extended timeout settings
          connectionTimeout: 30000,
          greetingTimeout: 15000,
          socketTimeout: 30000
        };
        console.log('Using standard SMTP configuration');
      }

      const transporter = nodemailer.createTransport(transportConfig);

      // Get the base URL
      const baseUrl = process.env.BASE_URL || `http://${req.get('host')}`;

      // Setup email data
      const mailOptions = {
        from: process.env.SMTP_FROM || process.env.SMTP_USER, // Use SMTP_FROM if available, otherwise use SMTP_USER
        to: user.email,
        subject: 'Password Reset Request',
        text: `You requested a password reset. Please use the following link to reset your password: ${baseUrl}/Screens/reset-password.html?token=${token}`,
        html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #2c3e50;">Password Reset Request</h2>
          <p>You requested a password reset for your Poker Game account.</p>
          <p>Please click the button below to reset your password:</p>
          <div style="text-align: center; margin: 30px 0;">
            <a href="${baseUrl}/Screens/reset-password.html?token=${token}" 
               style="background-color: #3498db; color: white; padding: 12px 25px; text-decoration: none; border-radius: 5px; display: inline-block;">
              Reset Password
            </a>
          </div>
          <p>This link will expire in 1 hour.</p>
          <p>If you didn't request this password reset, please ignore this email.</p>
          <hr style="border: 1px solid #eee; margin: 20px 0;">
          <p style="color: #7f8c8d; font-size: 12px;">Poker Game Team</p>
        </div>
      `
      };

      // Create a promise that rejects in 30 seconds to prevent hanging
      const sendWithTimeout = async () => {
        return new Promise((resolve, reject) => {
          const timeout = setTimeout(() => {
            reject(new Error('Email sending timed out after 30 seconds'));
          }, 30000);

          transporter.sendMail(mailOptions, (error, info) => {
            clearTimeout(timeout);
            if (error) {
              reject(error);
            } else {
              resolve(info);
            }
          });
        });
      };

      // Try to send the email with timeout protection
      try {
        console.log('Attempting to send email...');
        const info = await sendWithTimeout();
        console.log('Password reset email sent successfully:', info.messageId);
        emailSent = true;
      } catch (sendError) {
        console.error('Email sending error:', sendError);
        throw sendError; // Re-throw to be caught by the outer try/catch
      }

    } else {
      // Development fallback - log instead of actually sending
      console.log('No SMTP credentials found. In development mode.');
      console.log('\n-------- PASSWORD RESET EMAIL PREVIEW --------');
      console.log(`To: ${user.email}`);
      console.log(`Subject: Password Reset Request`);
      console.log(`Reset Link: http://localhost:3000/Screens/reset-password.html?token=${token}`);
      console.log('----------------------------------------------\n');

      // Return early with success response for development
      return res.status(200).json({
        message: 'If an account with that email exists, a password reset link has been sent.',
        development: true,
        token: token // Only include token in development mode
      });
    }

  } catch (error) {
    console.error('Forgot password error:', error);

    // Return as development mode if we encounter SMTP errors
    if (error.code === 'ETIMEDOUT' ||
      error.code === 'ECONNREFUSED' ||
      error.code === 'EAUTH' ||
      error.message.includes('timeout')) {

      console.log('SMTP connection failed. Falling back to development mode.');

      return res.status(200).json({
        message: 'If an account with that email exists, a password reset link has been sent.',
        development: true,
        token: token, // Return token for testing purposes
        smtp_error: error.message // Include error for debugging
      });
    }

    // Fall back to development mode for any email error
    return res.status(200).json({
      message: 'If an account with that email exists, a password reset link has been sent.',
      development: true,
      token: token,
      email_error: error.message
    });
  }

  // Return success message without revealing if the email exists
  res.status(200).json({
    message: 'If an account with that email exists, a password reset link has been sent.'
  });
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