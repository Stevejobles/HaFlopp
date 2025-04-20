const express = require('express');
const session = require('express-session');
const path = require('path');
const UserModel = require('./models/user');
const nodemailer = require('nodemailer');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');

const app = express();
const port = 3000;

// JWT secret key
const JWT_SECRET = 'GenghisKhan';

// Configure nodemailer (for sending emails)
// For testing, you can use a service like Mailtrap.io
// For production, replace with your actual email service configuration
const transporter = nodemailer.createTransport({
  host: 'smtp.mailtrap.io',
  port: 2525,
  auth: {
    user: 'your_mailtrap_username', // Replace with your actual credentials
    pass: 'your_mailtrap_password'  // Replace with your actual credentials
  }
});
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
const requireAuth = async (req, res, next) => {
  // Check if user is authenticated via session
  if (req.session.userId) {
    return next();
  }
  
  // If not in session, check for authentication cookie
  const token = req.cookies.rememberToken;
  if (token) {
    try {
      // Verify and decode the token
      const decoded = jwt.verify(token, JWT_SECRET);
      
      // Get user from database
      const user = await UserModel.getUserById(decoded.userId);
      
      if (user) {
        // Set the user in session
        req.session.userId = user.id;
        return next();
      }
    } catch (error) {
      console.error('Token verification error:', error);
      // Continue to redirect if token is invalid
    }
  }
  
  return res.redirect('/login.html');
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
    
    // Password strength validation
    if (password.length < 6) {
      return res.status(400).json({ 
        field: 'password', 
        message: 'Password must be at least 6 characters long' 
      });
    }
    
    const hasUpperCase = /[A-Z]/.test(password);
    const hasLowerCase = /[a-z]/.test(password);
    const hasSpecialChar = /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password);
    
    if (!hasUpperCase) {
      return res.status(400).json({ 
        field: 'password', 
        message: 'Password must contain at least one uppercase letter' 
      });
    }
    
    if (!hasLowerCase) {
      return res.status(400).json({ 
        field: 'password', 
        message: 'Password must contain at least one lowercase letter' 
      });
    }
    
    if (!hasSpecialChar) {
      return res.status(400).json({ 
        field: 'password', 
        message: 'Password must contain at least one special character' 
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
    const { username, password, rememberMe } = req.body;
    
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
    
    // If remember me is checked, set a persistent cookie
    if (rememberMe) {
      // Create a JWT token with user ID
      const token = jwt.sign(
        { userId: user.id },
        JWT_SECRET,
        { expiresIn: '14d' } // Token expires after 14 days
      );
      
      // Set the token in a cookie that expires in 14 days
      res.cookie('rememberToken', token, {
        maxAge: 14 * 24 * 60 * 60 * 1000, // 14 days in milliseconds
        httpOnly: true, // Cookie cannot be accessed by client-side JavaScript
        secure: process.env.NODE_ENV === 'production', // Cookie only sent over HTTPS in production
        sameSite: 'strict' // Cookie only sent in first-party context
      });
    }
    
    res.json({ message: 'Login successful', user });
    
  } catch (error) {
    console.error('Login error:', error);
    res.status(401).json({ message: 'Invalid username or password' });
  }
});

app.post('/api/logout', (req, res) => {
  // Clear the session
  req.session.destroy();
  
  // Clear the remember me cookie
  res.clearCookie('rememberToken');
  
  res.json({ message: 'Logged out successfully' });
});

app.get('/api/user', async (req, res) => {
  // If user is authenticated via session
  if (req.session.userId) {
    try {
      const user = await UserModel.getUserById(req.session.userId);
      if (!user) {
        req.session.destroy();
        res.clearCookie('rememberToken');
        return res.status(401).json({ message: 'User not found' });
      }
      
      return res.json({ user });
    } catch (error) {
      console.error('Get user error:', error);
      return res.status(500).json({ message: 'An error occurred' });
    }
  }
  
  // If not in session, check for authentication cookie
  const token = req.cookies.rememberToken;
  if (token) {
    try {
      // Verify and decode the token
      const decoded = jwt.verify(token, JWT_SECRET);
      
      // Get user from database
      const user = await UserModel.getUserById(decoded.userId);
      
      if (user) {
        // Set the user in session
        req.session.userId = user.id;
        return res.json({ user });
      }
    } catch (error) {
      console.error('Token verification error:', error);
      res.clearCookie('rememberToken');
    }
  }
  
  return res.status(401).json({ message: 'Not authenticated' });
});

// Password reset routes
app.post('/api/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    
    if (!email) {
      return res.status(400).json({ message: 'Email is required' });
    }
    
    // Generate and store reset token
    const resetData = await UserModel.createPasswordResetToken(email);
    
    // Create reset link
    const resetLink = `http://localhost:${port}/reset-password.html?token=${resetData.token}`;
    
    // Send email with reset link
    await transporter.sendMail({
      from: '"Haflop Poker" <noreply@haflop.com>',
      to: resetData.email,
      subject: 'Password Reset Request',
      html: `
        <p>You requested a password reset for your Haflop Poker account.</p>
        <p>Please click the link below to reset your password:</p>
        <p><a href="${resetLink}">Reset Password</a></p>
        <p>This link will expire in 1 hour.</p>
        <p>If you did not request this reset, you can safely ignore this email.</p>
      `
    });
    
    res.json({ message: 'Password reset email sent' });
    
  } catch (error) {
    console.error('Forgot password error:', error);
    res.status(400).json({ message: error.message || 'Error sending password reset email' });
  }
});

app.post('/api/reset-password', async (req, res) => {
  try {
    const { token, password } = req.body;
    
    if (!token || !password) {
      return res.status(400).json({ message: 'Token and password are required' });
    }
    
    if (password.length < 6) {
      return res.status(400).json({ message: 'Password must be at least 6 characters long' });
    }
    
    // Reset the password
    await UserModel.resetPassword(token, password);
    
    res.json({ message: 'Password has been reset successfully' });
    
  } catch (error) {
    console.error('Reset password error:', error);
    res.status(400).json({ message: error.message || 'Error resetting password' });
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