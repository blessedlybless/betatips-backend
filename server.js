const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
require('dotenv').config();

const authRoutes = require('./routes/auth');
const gameRoutes = require('./routes/games');
const adminRoutes = require('./routes/admin');
const communityRoutes = require('./routes/community');

const app = express();

// Basic Middleware (NO compression yet)
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/sports-prediction', {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/games', gameRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/community', communityRoutes);

// Default admin user creation
const User = require('./models/User');

const createDefaultAdmin = async () => {
  try {
    console.log('🔍 Checking for existing admin user...');
    
    const adminExists = await User.findOne({ username: 'admin' });
    
    if (!adminExists) {
      console.log('👤 No admin found, creating default admin...');
      
      const admin = new User({
        username: 'admin',
        email: 'admin@betatips.com.ng',
        password: 'admin123',
        isAdmin: true,
        hasPaid: true,
        isActive: true
      });
      
      await admin.save();
      console.log('✅ Default admin created successfully!');
      console.log('📧 Username: admin');
      console.log('🔑 Password: admin123');
      console.log('👑 Admin: true');
      console.log('💳 Has Paid: true');
      console.log('✅ Active: true');
    } else {
      console.log('✅ Admin user already exists:', adminExists.username);
      console.log('👑 Is Admin:', adminExists.isAdmin);
      console.log('💳 Has Paid:', adminExists.hasPaid);
      console.log('✅ Is Active:', adminExists.isActive);
    }

    const userCount = await User.countDocuments();
    console.log('👥 Total users in database:', userCount);

  } catch (error) {
    console.error('❌ Error creating/checking default admin:', error);
  }
};

mongoose.connection.once('open', () => {
  console.log('✅ Connected to MongoDB');
  createDefaultAdmin();
});

mongoose.connection.on('error', (error) => {
  console.error('❌ MongoDB connection error:', error);
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
