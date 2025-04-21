const { MongoClient, ObjectId } = require("mongodb");
const bcrypt = require("bcrypt");
const crypto = require("crypto");

class UserModel {
  constructor() {
    this.client = null;
    this.db = null;
    this.collection = null;
    this.resetTokensCollection = null;
    this.isConnected = false;
  }

  async connect() {
    if (this.isConnected) return;

    const uri = process.env.MONGODB_URI;
    this.client = new MongoClient(uri);
    
    try {
      await this.client.connect();
      this.db = this.client.db("poker");
      this.collection = this.db.collection("users");
      this.resetTokensCollection = this.db.collection("reset_tokens");
      this.isConnected = true;
      
      // Create a unique index on username to prevent duplicates
      await this.collection.createIndex({ username: 1 }, { unique: true });
      
      // Create a unique index on email to prevent duplicates
      await this.collection.createIndex({ email: 1 }, { unique: true });
      
      // Create index on reset tokens
      await this.resetTokensCollection.createIndex({ token: 1 }, { unique: true });
      await this.resetTokensCollection.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
      
      console.log("Connected to database successfully");
    } catch (error) {
      console.error("Database connection error:", error);
      throw error;
    }
  }

  async close() {
    if (this.client) {
      await this.client.close();
      this.isConnected = false;
    }
  }

  async createUser(username, email, password) {
    await this.connect();
    
    // Check if username already exists
    const existingUser = await this.collection.findOne({ 
      $or: [{ username }, { email }] 
    });
    
    if (existingUser) {
      if (existingUser.username === username) {
        throw { field: 'username', message: 'Username already taken' };
      } else {
        throw { field: 'email', message: 'Email already registered' };
      }
    }
    
    // Hash the password
    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(password, saltRounds);
    
    const newUser = {
      username,
      email,
      password: hashedPassword,
      chips: 1000, // Starting chips
      created_at: new Date(),
      updated_at: new Date()
    };
    
    const result = await this.collection.insertOne(newUser);
    
    return {
      id: result.insertedId,
      username,
      email,
      chips: newUser.chips
    };
  }

  async loginUser(username, password) {
    await this.connect();
    
    const user = await this.collection.findOne({ username });
    
    if (!user) {
      throw { message: 'Invalid username or password' };
    }
    
    const isPasswordValid = await bcrypt.compare(password, user.password);
    
    if (!isPasswordValid) {
      throw { message: 'Invalid username or password' };
    }
    
    return {
      id: user._id,
      username: user.username,
      email: user.email,
      chips: user.chips
    };
  }

  async getUserById(userId) {
    await this.connect();
    
    try {
      const user = await this.collection.findOne({ _id: new ObjectId(userId) });
      if (!user) {
        return null;
      }
      
      return {
        id: user._id,
        username: user.username,
        email: user.email,
        chips: user.chips
      };
    } catch (error) {
      console.error("Error getting user by ID:", error);
      return null;
    }
  }

  async updateUserChips(userId, chips) {
    await this.connect();
    
    const result = await this.collection.updateOne(
      { _id: new ObjectId(userId) },
      { $set: { chips, updated_at: new Date() } }
    );
    
    return result.modifiedCount > 0;
  }

  async createPasswordResetToken(email) {
    await this.connect();
    
    // Find user with the provided email
    const user = await this.collection.findOne({ email });
    
    if (!user) {
      throw { message: 'No account found with that email address' };
    }
    
    // Generate a random token
    const token = crypto.randomBytes(32).toString('hex');
    
    // Set expiration time (1 hour from now)
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 1);
    
    // Store the token in the reset_tokens collection
    await this.resetTokensCollection.insertOne({
      userId: user._id,
      token,
      expiresAt
    });
    
    return {
      email: user.email,
      token
    };
  }

  async resetPassword(token, newPassword) {
    await this.connect();
    
    // Find the reset token
    const resetToken = await this.resetTokensCollection.findOne({ token });
    
    if (!resetToken) {
      throw { message: 'Invalid or expired reset token' };
    }
    
    // Check if token is expired
    if (resetToken.expiresAt < new Date()) {
      await this.resetTokensCollection.deleteOne({ token });
      throw { message: 'Reset token has expired' };
    }
    
    // Hash the new password
    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(newPassword, saltRounds);
    
    // Update the user's password
    const result = await this.collection.updateOne(
      { _id: resetToken.userId },
      { $set: { password: hashedPassword, updated_at: new Date() } }
    );
    
    // Delete the used token
    await this.resetTokensCollection.deleteOne({ token });
    
    if (result.modifiedCount === 0) {
      throw { message: 'Failed to update password' };
    }
    
    return true;
  }
}

// Export a singleton instance
module.exports = new UserModel();