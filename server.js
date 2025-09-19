require('dotenv').config();
console.log('All environment variables:', process.env.MONGO_URL); // Add this line
console.log('Current directory:', __dirname); // And this one

const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const app = express();

// ============================================
// ENVIRONMENT VARIABLES VALIDATION
// ============================================
const MONGODB_URI = process.env.MONGODB_URI;
const JWT_SECRET = process.env.JWT_SECRET || 'betatips_default_secret';
const NODE_ENV = process.env.NODE_ENV || 'development';
const PORT = process.env.PORT || 5000;

// Debug environment variables
console.log('🔍 Environment Check:');
console.log('NODE_ENV:', NODE_ENV);
console.log('PORT:', PORT);
console.log('MONGODB_URI exists:', !!MONGODB_URI);
console.log('MONGODB_URI starts with:', MONGODB_URI?.substring(0, 20));
console.log('Connection format:', MONGODB_URI?.startsWith('mongodb+srv') ? 'SRV' : 'Standard');
console.log('JWT_SECRET set:', !!JWT_SECRET);

// Validate required environment variables
if (!MONGODB_URI) {
  console.error('❌ MONGODB_URI environment variable is not set!');
  console.error('Please set MONGODB_URI in your environment variables.');
  process.exit(1);
}

if (!MONGODB_URI.startsWith('mongodb://') && !MONGODB_URI.startsWith('mongodb+srv://')) {
  console.error('❌ Invalid MONGODB_URI format!');
  console.error('MONGODB_URI must start with "mongodb://" or "mongodb+srv://"');
  console.error('Current value:', MONGODB_URI);
  process.exit(1);
}

// ============================================
// MIDDLEWARE
// ============================================
app.use(cors());
app.use(express.json());

// ============================================
// MONGODB CONNECTION
// ============================================
console.log('🔗 Connecting to MongoDB Atlas...');

mongoose.connect(MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
.then(() => {
  console.log('✅ Successfully connected to MongoDB Atlas');
  console.log('🏠 Database host:', mongoose.connection.host);
  console.log('📦 Database name:', mongoose.connection.name);
})
.catch((error) => {
  console.error('❌ MongoDB connection error:', error.message);
  console.error('Full error:', error);
  process.exit(1);
});

// Connection event listeners
mongoose.connection.on('connected', () => {
  console.log('🟢 Mongoose connected to MongoDB');
});

mongoose.connection.on('error', (err) => {
  console.error('🔴 Mongoose connection error:', err);
});

mongoose.connection.on('disconnected', () => {
  console.log('🟡 Mongoose disconnected from MongoDB');
});

// ============================================
// MODELS
// ============================================
const User = mongoose.model('User', {
  username: { type: String, required: true, unique: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  hasPaid: { type: Boolean, default: false },
  isAdmin: { type: Boolean, default: false },
  isBlocked: { type: Boolean, default: false }, // ADD THIS LINE
  needsPasswordChange: { type: Boolean, default: false }, // ADD THIS LINE
  paymentDate: { type: Date },
  createdAt: { type: Date, default: Date.now }
});

const Game = mongoose.model('Game', {
  homeTeam: { type: String, required: true },
  awayTeam: { type: String, required: true },
  league: { type: String, required: true },
  prediction: { type: String, required: true },
  odds: { type: String, required: true },
  gameTime: { type: Date, required: true },
  status: { type: String, enum: ['pending', 'won', 'lost'], default: 'pending' },
  isVip: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now }
});

const Post = mongoose.model('Post', {
  title: { type: String, required: true },
  content: { type: String, required: true },
  author: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  createdAt: { type: Date, default: Date.now },
  likes: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  comments: [{
    content: String,
    author: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    createdAt: { type: Date, default: Date.now }
  }]
});

// ============================================
// MIDDLEWARE FOR AUTHENTICATION
// ============================================
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ message: 'Access token required' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ message: 'Invalid or expired token' });
    }
    req.user = user;
    next();
  });
};

// ============================================
// ROUTES
// ============================================

// Health check route
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    environment: NODE_ENV,
    database: mongoose.connection.readyState === 1 ? 'Connected' : 'Disconnected'
  });
});

// Auth routes
app.post('/api/auth/register', async (req, res) => {
  try {
    const { username, email, password } = req.body;
    
    // Check if user exists
    const existingUser = await User.findOne({ 
      $or: [{ email }, { username }] 
    });
    
    if (existingUser) {
      return res.status(400).json({ message: 'User already exists' });
    }
    
    // Hash password
    const hashedPassword = await bcrypt.hash(password, 12);
    
    // Create user
    const user = new User({
      username,
      email,
      password: hashedPassword
    });
    
    await user.save();
    
    // Generate token
    const token = jwt.sign(
      { userId: user._id, username: user.username },
      JWT_SECRET,
      { expiresIn: '7d' }
    );
    
    res.status(201).json({
      message: 'User created successfully',
      token,
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        hasPaid: user.hasPaid,
        isAdmin: user.isAdmin
      }
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ message: 'Server error during registration' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    // Find user
    const user = await User.findOne({ username });
    if (!user) {
      return res.status(400).json({ message: 'Invalid credentials' });
    }
    
    // Check password
    const isValidPassword = await bcrypt.compare(password, user.password);
    if (!isValidPassword) {
      return res.status(400).json({ message: 'Invalid credentials' });
    }
    
    // Generate token
    const token = jwt.sign(
      { userId: user._id, username: user.username },
      JWT_SECRET,
      { expiresIn: '7d' }
    );
    
    res.json({
      message: 'Login successful',
      token,
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        hasPaid: user.hasPaid,
        isAdmin: user.isAdmin
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ message: 'Server error during login' });
  }
});

app.get('/api/auth/me', authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId).select('-password');
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    res.json(user);
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

app.patch('/api/auth/change-password', authenticateToken, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    
    // Find user
    const user = await User.findById(req.user.userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    // Verify current password
    const isValidPassword = await bcrypt.compare(currentPassword, user.password);
    if (!isValidPassword) {
      return res.status(400).json({ message: 'Current password is incorrect' });
    }
    
    // Hash new password
    const hashedPassword = await bcrypt.hash(newPassword, 12);
    
    // Update password
    user.password = hashedPassword;
    await user.save();
    
    res.json({ message: 'Password changed successfully' });
  } catch (error) {
    console.error('Change password error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Game routes
app.get('/api/games', authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    let games;
    
    if (user.hasPaid || user.isAdmin) {
      // VIP users see all games
      games = await Game.find().sort({ createdAt: -1 });
    } else {
      // Free users see only non-VIP games
      games = await Game.find({ isVip: false }).sort({ createdAt: -1 });
    }
    
    res.json(games);
  } catch (error) {
    console.error('Get games error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

app.post('/api/games', authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    if (!user.isAdmin) {
      return res.status(403).json({ message: 'Admin access required' });
    }
    
    const game = new Game(req.body);
    await game.save();
    res.status(201).json(game);
  } catch (error) {
    console.error('Create game error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Community routes
app.get('/api/posts', authenticateToken, async (req, res) => {
  try {
    const posts = await Post.find()
      .populate('author', 'username')
      .populate('comments.author', 'username')
      .sort({ createdAt: -1 });
    res.json(posts);
  } catch (error) {
    console.error('Get posts error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

app.post('/api/posts', authenticateToken, async (req, res) => {
  try {
    const post = new Post({
      ...req.body,
      author: req.user.userId
    });
    await post.save();
    await post.populate('author', 'username');
    res.status(201).json(post);
  } catch (error) {
    console.error('Create post error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Payment status update
app.patch('/api/user/payment', authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    user.hasPaid = true;
    user.paymentDate = new Date();
    await user.save();
    
    res.json({ message: 'Payment status updated successfully' });
  } catch (error) {
    console.error('Payment update error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Default route
app.get('/', (req, res) => {
  res.json({ 
    message: 'Beta Tips API Server',
    status: 'Running',
    environment: NODE_ENV,
    timestamp: new Date().toISOString()
  });
});

// 🆕 ADD THE NEW ROUTES HERE (AFTER EXISTING ROUTES)
// Delete game
app.delete('/api/games/:id', authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    if (!user.isAdmin) {
      return res.status(403).json({ message: 'Admin access required' });
    }
    
    await Game.findByIdAndDelete(req.params.id);
    res.json({ message: 'Game deleted successfully' });
  } catch (error) {
    console.error('Delete game error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Update game result (fix the existing one)
app.patch('/api/games/:id/result', authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    if (!user.isAdmin) {
      return res.status(403).json({ message: 'Admin access required' });
    }

    console.log('🎯 Received request to update game:', req.params.id); // Add this
    console.log('🎯 Result value:', result); // Add this
    console.log('🎯 Request body:', req.body); // Add this
    
    const { result } = req.body;
    const game = await Game.findByIdAndUpdate(
      req.params.id, 
      { result: result }, // Make sure this field matches your Game model
      { new: true }
    );
    
    if (!game) {
      return res.status(404).json({ message: 'Game not found' });
    }
    
    console.log(`Game ${req.params.id} result updated to: ${result}`); // Debug log
    res.json(game);
  } catch (error) {
    console.error('Update game result error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});


// Add comment to post
app.post('/api/posts/:id/comments', authenticateToken, async (req, res) => {
  try {
    const post = await Post.findById(req.params.id);
    if (!post) {
      return res.status(404).json({ message: 'Post not found' });
    }
    
    post.comments.push({
      content: req.body.content,
      author: req.user.userId,
      createdAt: new Date()
    });
    
    await post.save();
    res.status(201).json(post);
  } catch (error) {
    console.error('Add comment error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Delete post
app.delete('/api/posts/:id', authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    const post = await Post.findById(req.params.id);
    
    if (!post) {
      return res.status(404).json({ message: 'Post not found' });
    }
    
    if (post.author.toString() !== req.user.userId && !user.isAdmin) {
      return res.status(403).json({ message: 'Not authorized' });
    }
    
    await Post.findByIdAndDelete(req.params.id);
    res.json({ message: 'Post deleted successfully' });
  } catch (error) {
    console.error('Delete post error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get all users (Admin only)
app.get('/api/admin/users', authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    if (!user.isAdmin) {
      return res.status(403).json({ message: 'Admin access required' });
    }
    
    const users = await User.find()
      .select('-password') // Don't send passwords
      .sort({ createdAt: -1 }); // Newest first
    
    console.log('Returning users to admin:', users.length); // Debug log
    res.json(users);
  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({ message: 'Server error fetching users' });
  }
});

// Block/Unblock user (Admin only)
app.patch('/api/admin/users/:id/block', authenticateToken, async (req, res) => {
  try {
    const admin = await User.findById(req.user.userId);
    if (!admin.isAdmin) {
      return res.status(403).json({ message: 'Admin access required' });
    }
    
    const { blocked } = req.body; // true or false
    const user = await User.findByIdAndUpdate(
      req.params.id,
      { isBlocked: blocked },
      { new: true }
    ).select('-password');
    
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    res.json({ message: `User ${blocked ? 'blocked' : 'unblocked'} successfully`, user });
  } catch (error) {
    console.error('Block user error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Grant/Remove VIP access (Admin only)
app.patch('/api/admin/users/:id/vip', authenticateToken, async (req, res) => {
  try {
    const admin = await User.findById(req.user.userId);
    if (!admin.isAdmin) {
      return res.status(403).json({ message: 'Admin access required' });
    }
    
    const { hasPaid } = req.body; // true or false
    const user = await User.findByIdAndUpdate(
      req.params.id,
      { 
        hasPaid: hasPaid,
        paymentDate: hasPaid ? new Date() : null
      },
      { new: true }
    ).select('-password');
    
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    res.json({ message: `VIP access ${hasPaid ? 'granted' : 'removed'} successfully`, user });
  } catch (error) {
    console.error('VIP update error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Generate temporary password for user (Admin only)
app.patch('/api/admin/users/:id/generate-temp-password', authenticateToken, async (req, res) => {
  try {
    const admin = await User.findById(req.user.userId);
    if (!admin.isAdmin) {
      return res.status(403).json({ message: 'Admin access required' });
    }
    
    // Generate 6-digit temporary password
    const tempPassword = Math.floor(100000 + Math.random() * 900000).toString();
    
    // Hash the temporary password
    const hashedPassword = await bcrypt.hash(tempPassword, 12);
    
    const user = await User.findByIdAndUpdate(
      req.params.id,
      { 
        password: hashedPassword,
        needsPasswordChange: true // Flag to force password change
      },
      { new: true }
    ).select('-password');
    
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    console.log(`Temporary password generated for user ${user.username} by admin ${admin.username}`);
    res.json({ 
      message: 'Temporary password generated successfully',
      tempPassword: tempPassword, // Send back to admin to give to user
      user: user
    });
  } catch (error) {
    console.error('Generate temp password error:', error);
    res.status(500).json({ message: 'Server error: ' + error.message });
  }
});

// Block/Unblock user (Admin only)
app.patch('/api/admin/users/:id/block', authenticateToken, async (req, res) => {
  try {
    const admin = await User.findById(req.user.userId);
    if (!admin.isAdmin) {
      return res.status(403).json({ message: 'Admin access required' });
    }
    
    const { blocked } = req.body;
    console.log(`Admin attempting to ${blocked ? 'block' : 'unblock'} user ${req.params.id}`);
    
    const user = await User.findByIdAndUpdate(
      req.params.id,
      { isBlocked: blocked },
      { new: true }
    ).select('-password');
    
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    res.json({ message: `User ${blocked ? 'blocked' : 'unblocked'} successfully`, user });
  } catch (error) {
    console.error('Block user error:', error);
    res.status(500).json({ message: 'Server error: ' + error.message });
  }
});





// ============================================
// ERROR HANDLING
// ============================================
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ message: 'Internal server error' });
});

// Handle 404
app.use('*', (req, res) => {
  res.status(404).json({ message: 'Route not found' });
});

// ============================================
// START SERVER
// ============================================
app.listen(PORT, '0.0.0.0', () => {
  console.log('🚀 Beta Tips Server Status:');
  console.log(`   Server: Running on port ${PORT}`);
  console.log(`   Environment: ${NODE_ENV}`);
  console.log(`   Database: ${mongoose.connection.readyState === 1 ? 'Connected' : 'Connecting...'}`);
  console.log(`   URL: http://localhost:${PORT}`);
  console.log('=====================================');
});

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('🛑 Shutting down server...');
  await mongoose.connection.close();
  console.log('✅ Database connection closed');
  process.exit(0);
});

