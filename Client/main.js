const express = require('express');
const session = require('express-session');
const path = require('path');
const UserModel = require('./models/user');

const app = express();
const port = 3000;

// Middleware for parsing JSON and urlencoded form data
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static files from the current directory
app.use(express.static(path.join(__dirname)));

// Session management
app.use(session({
  secret: 'haflop-poker-secret-key',
  resave: false,
  saveUninitialized: false,
  cookie: { 
    secure: false, // Set to true if using HTTPS
    maxAge: 1000 * 60 * 60 * 24 // 24 hours
  }
}));

// Authentication middleware
const requireAuth = (req, res, next) => {
  if (!req.session.userId) {
    return res.redirect('/login.html');
  }
  next();
};

// API Routes for authentication
app.post('/api/signup', async (req, res) => {
  try {
    const { username, email, password } = req.body;
    
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
    
    // Create user
    const user = await UserModel.createUser(username, email, password);
    
    res.status(201).json({ 
      message: 'User created successfully', 
      user 
    });
    
  } catch (error) {
    if (error.field) {
      return res.status(400).json(error);
    }
    console.error('Signup error:', error);
    res.status(500).json({ message: 'An error occurred during sign up' });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    // Validate input
    if (!username || !password) {
      return res.status(400).json({ 
        message: 'Username and password are required' 
      });
    }
    
    // Authenticate user
    const user = await UserModel.loginUser(username, password);
    
    // Set session
    req.session.userId = user.id;
    
    res.json({ message: 'Login successful', user });
    
  } catch (error) {
    console.error('Login error:', error);
    res.status(401).json({ message: 'Invalid username or password' });
  }
});

app.post('/api/logout', (req, res) => {
  req.session.destroy();
  res.json({ message: 'Logged out successfully' });
});

app.get('/api/user', async (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ message: 'Not authenticated' });
  }
  
  try {
    const user = await UserModel.getUserById(req.session.userId);
    if (!user) {
      req.session.destroy();
      return res.status(401).json({ message: 'User not found' });
    }
    
    res.json({ user });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ message: 'An error occurred' });
  }
});

// Protected routes example
app.get('/create-lobby.html', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'create-lobby.html'));
});

app.get('/join-game.html', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'join-game.html'));
});

// Serve main pages
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/learn2play', (req, res) => {
  res.sendFile(path.join(__dirname, 'learn2play.html'));
});

// Start the server
app.listen(port, () => {
  console.log(`Poker server running on http://localhost:${port}`);
});

// Graceful shutdown
process.on('SIGINT', async () => {
  try {
    await UserModel.close();
    console.log('Database connection closed');
    process.exit(0);
  } catch (error) {
    console.error('Error during shutdown:', error);
    process.exit(1);
  }
});