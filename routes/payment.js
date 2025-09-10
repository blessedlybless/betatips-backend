const express = require('express');
const User = require('../models/User');
const auth = require('../middleware/auth');
const isAdmin = require('../middleware/isAdmin');

const router = express.Router();

// Get all users (admin only)
router.get('/users', auth, isAdmin, async (req, res) => {
  try {
    const users = await User.find()
      .select('-password')
      .sort({ createdAt: -1 });
    
    console.log(`📋 Admin fetched ${users.length} users`);
    console.log(`👑 VIP users: ${users.filter(u => u.hasPaid).length}`);
    
    res.json(users);
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Update user VIP status (admin only)
router.patch('/users/:userId/vip', auth, isAdmin, async (req, res) => {
  try {
    const { userId } = req.params;
    const { hasPaid } = req.body;

    console.log(`🔄 Updating VIP status for user ${userId}: ${hasPaid ? 'GRANT' : 'REMOVE'}`);

    const updateData = {
      hasPaid
    };

    // If granting VIP access, set expiry date
    if (hasPaid) {
      updateData.vipStartDate = new Date();
      updateData.vipExpiryDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days
      updateData.transactionId = `ADMIN_GRANTED_${Date.now()}`;
    } else {
      // If removing VIP access, clear dates
      updateData.vipStartDate = null;
      updateData.vipExpiryDate = null;
      updateData.transactionId = null;
    }

    const updatedUser = await User.findByIdAndUpdate(
      userId,
      updateData,
      { new: true }
    ).select('-password');

    if (!updatedUser) {
      return res.status(404).json({ message: 'User not found' });
    }

    console.log(`✅ User ${updatedUser.username} VIP status: ${hasPaid ? 'GRANTED' : 'REMOVED'}`);
    console.log(`📅 VIP expires: ${hasPaid ? updatedUser.vipExpiryDate : 'N/A'}`);
    
    res.json({ 
      message: `VIP status ${hasPaid ? 'granted' : 'removed'} successfully`, 
      user: updatedUser 
    });
  } catch (error) {
    console.error('Error updating user VIP status:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Get user statistics (admin only)
router.get('/stats', auth, isAdmin, async (req, res) => {
  try {
    const totalUsers = await User.countDocuments();
    const vipUsers = await User.countDocuments({ hasPaid: true });
    const freeUsers = totalUsers - vipUsers;
    
    const stats = {
      totalUsers,
      vipUsers,
      freeUsers,
      conversionRate: totalUsers > 0 ? ((vipUsers / totalUsers) * 100).toFixed(1) : 0
    };

    console.log('📊 Admin stats requested:', stats);
    res.json(stats);
  } catch (error) {
    console.error('Error fetching admin stats:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

module.exports = router;
