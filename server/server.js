const express = require('express');
const session = require('express-session');
const path = require('path');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const { MongoClient, ObjectId } = require('mongodb');

const app = express();
const port = 3000;

// MongoDB Connection
let db;
const uri = process.env.MONGODB_URI;
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
    
    return "Connected to database";
  } catch (error) {
    console.error("Error connecting to database:", error);
    process.exit(1);
  }
}

// JWT secret key
const JWT_SECRET = process.env.JWT_SECRET;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Session setup
app.use(session({
  secret: 'haflop-poker-secret-key',
  resave: false,
  saveUninitialized: false,
  cookie: { 
    secure: false, // Set to true if using HTTPS
    maxAge: 1000 * 60 * 60 * 24 // 24 hours
  }
}));

// Serve static files from the Client directory
app.use(express.static(path.join(__dirname, 'Client')));

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


// Route to serve the main page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'Client', 'Screens', 'index.html'));
});

// Serve other HTML pages
app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'Client', 'Screens', 'login.html'));
});

app.get('/signup', (req, res) => {
  res.sendFile(path.join(__dirname, 'Client', 'Screens', 'signup.html'));
});

app.get('/learn2play', (req, res) => {
  res.sendFile(path.join(__dirname, 'Client', 'Screens', 'learn2play.html'));
});

app.get('/forgot-password', (req, res) => {
  res.sendFile(path.join(__dirname, 'Client', 'Screens', 'forgot-password.html'));
});

app.get('/reset-password', (req, res) => {
  res.sendFile(path.join(__dirname, 'Client', 'Screens', 'reset-password.html'));
});

// Protected routes example
app.get('/create-lobby', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'Client', 'Screens', 'create-lobby.html'));
});

app.get('/join-game', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'Client', 'Screens', 'join-game.html'));
});

// Catch-all route to handle page refreshes with client-side routing
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'Client', 'Screens', 'index.html'));
});

// Start the server
async function startServer() {
  await connectToDatabase();
  
  app.listen(port, () => {
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