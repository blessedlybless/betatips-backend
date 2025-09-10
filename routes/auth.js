const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const auth = require('../middleware/auth');

const router = express.Router();

// Register
router.post('/register', async (req, res) => {
  try {
    const { username, email, password } = req.body;

    // Check if user exists
    const existingUser = await User.findOne({
      $or: [{ email }, { username }]
    });

    if (existingUser) {
      return res.status(400).json({ message: 'User already exists' });
    }

    // Create new user
    const user = new User({
      username,
      email,
      password,
      isActive: true
    });

    await user.save();

    // Generate JWT token with isAdmin included
    const token = jwt.sign(
      { 
        userId: user._id, 
        isAdmin: user.isAdmin
      },
      process.env.JWT_SECRET || 'fallback_secret',
      { expiresIn: '24h' }
    );

    res.status(201).json({
      token,
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        isAdmin: user.isAdmin,
        hasPaid: user.hasPaid,
        vipExpiryDate: user.vipExpiryDate,
        isActive: user.isActive
      }
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Login
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    console.log(`🔐 Login attempt for user: ${username}`);

    // Find user
    const user = await User.findOne({ username });
    if (!user) {
      console.log(`❌ User not found: ${username}`);
      return res.status(400).json({ message: 'Invalid credentials' });
    }

    // Check if user is active
    if (!user.isActive) {
      console.log(`🚫 User account deactivated: ${username}`);
      return res.status(403).json({ 
        message: 'Account has been deactivated. Contact support.' 
      });
    }

    // Check password
    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      console.log(`❌ Invalid password for user: ${username}`);
      return res.status(400).json({ message: 'Invalid credentials' });
    }

    // Generate JWT token with isAdmin included
    const token = jwt.sign(
      { 
        userId: user._id, 
        isAdmin: user.isAdmin  // IMPORTANT: Include isAdmin in JWT
      },
      process.env.JWT_SECRET || 'fallback_secret',
      { expiresIn: '24h' }
    );

    console.log(`✅ Login successful for ${username} - Admin: ${user.isAdmin}`);

    res.json({
      token,
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        isAdmin: user.isAdmin,
        hasPaid: user.hasPaid,
        vipExpiryDate: user.vipExpiryDate,
        isActive: user.isActive
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get current user
router.get('/me', auth, async (req, res) => {
  try {
    console.log(`📋 Fetching user data for ID: ${req.userId}`);
    
    const user = await User.findById(req.userId).select('-password');
    
    // Check if user exists and is still active
    if (!user || !user.isActive) {
      console.log(`🚫 User not found or deactivated: ${req.userId}`);
      return res.status(403).json({ message: 'Account deactivated' });
    }
    // Change password (for logged-in users)
router.patch('/change-password', auth, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const userId = req.userId;

    console.log(`🔄 User ${userId} requesting password change`);

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ message: 'Current password and new password are required' });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ message: 'New password must be at least 6 characters' });
    }

    // Find user
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Check current password
    const isCurrentPasswordValid = await user.comparePassword(currentPassword);
    if (!isCurrentPasswordValid) {
      return res.status(400).json({ message: 'Current password is incorrect' });
    }

    // Update password (will be hashed automatically by pre-save hook)
    user.password = newPassword;
    await user.save();

    console.log(`✅ Password changed successfully for user: ${user.username}`);
    res.json({ message: 'Password changed successfully' });
  } catch (error) {
    console.error('Error changing password:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

    
    // Return complete user data
    const userResponse = {
      id: user._id,
      username: user.username,
      email: user.email,
      isAdmin: user.isAdmin,
      hasPaid: user.hasPaid,
      isActive: user.isActive,
      vipExpiryDate: user.vipExpiryDate,
      createdAt: user.createdAt
    };
    
    console.log(`✅ User data sent - Admin: ${userResponse.isAdmin}`);
    res.json(userResponse);
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
