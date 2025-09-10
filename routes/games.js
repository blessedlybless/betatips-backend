const express = require('express');
const Game = require('../models/Game');
const auth = require('../middleware/auth');
const isAdmin = require('../middleware/isAdmin');

const router = express.Router();

// Get games by specific date
router.get('/date/:date', auth, async (req, res) => {
  try {
    const { date } = req.params; // Format: YYYY-MM-DD
    console.log(`🔍 Fetching games for date: ${date}`);

    // Create start and end of day for the selected date
    const startDate = new Date(date);
    startDate.setHours(0, 0, 0, 0); // Start of day

    const endDate = new Date(date);
    endDate.setHours(23, 59, 59, 999); // End of day

    const games = await Game.find({
      matchTime: {
        $gte: startDate,
        $lte: endDate
      }
    }).sort({ matchTime: 1 }); // Sort by match time ascending

    console.log(`✅ Found ${games.length} games for ${date}`);
    res.json(games);
  } catch (error) {
    console.error('Error fetching games by date:', error);
    res.status(500).json({ message: 'Error fetching games', error: error.message });
  }
});

// Get today's games (keep existing functionality)
router.get('/today', auth, async (req, res) => {
  try {
    console.log('🔍 Fetching today\'s games...');
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const games = await Game.find({
      matchTime: {
        $gte: today,
        $lt: tomorrow
      }
    }).sort({ matchTime: 1 });

    console.log(`✅ Found ${games.length} games for today`);
    res.json(games);
  } catch (error) {
    console.error('Error fetching today\'s games:', error);
    res.status(500).json({ message: 'Error fetching games', error: error.message });
  }
});

// Get all games (for admin)
router.get('/all', auth, async (req, res) => {
  try {
    console.log('🔍 Admin fetching all games...');
    
    const games = await Game.find().sort({ matchTime: -1 }); // Most recent first
    
    console.log(`✅ Found ${games.length} total games`);
    res.json(games);
  } catch (error) {
    console.error('Error fetching all games:', error);
    res.status(500).json({ message: 'Error fetching games', error: error.message });
  }
});

// Create new game (admin only)
router.post('/', auth, isAdmin, async (req, res) => {
  try {
    console.log('🎯 Admin creating new game...');
    console.log('Game data received:', req.body);

    const { homeTeam, awayTeam, prediction, odds, category, matchTime } = req.body;

    // Validation
    if (!homeTeam || !awayTeam || !prediction || !odds || !category || !matchTime) {
      return res.status(400).json({ 
        message: 'All fields are required',
        required: ['homeTeam', 'awayTeam', 'prediction', 'odds', 'category', 'matchTime']
      });
    }

    if (parseFloat(odds) <= 1.0) {
      return res.status(400).json({ message: 'Odds must be greater than 1.0' });
    }

    const validCategories = ['All Tips', 'Sure Tips', 'Over/Under Tips', 'Bonus', 'VIP Tips'];
    if (!validCategories.includes(category)) {
      return res.status(400).json({ 
        message: 'Invalid category',
        validCategories 
      });
    }

    const game = new Game({
      homeTeam: homeTeam.trim(),
      awayTeam: awayTeam.trim(),
      prediction: prediction.trim(),
      odds: parseFloat(odds),
      category,
      matchTime: new Date(matchTime)
    });

    const savedGame = await game.save();
    console.log('✅ Game created successfully:', savedGame._id);
    
    res.status(201).json({ 
      message: 'Game created successfully', 
      game: savedGame 
    });
  } catch (error) {
    console.error('Error creating game:', error);
    
    if (error.name === 'ValidationError') {
      const errors = Object.values(error.errors).map(err => err.message);
      return res.status(400).json({ message: 'Validation error', errors });
    }
    
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Update game result (admin only)
router.patch('/:id/result', auth, isAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { result } = req.body;

    console.log(`🔄 Admin updating game ${id} result to: ${result}`);

    if (!['win', 'loss'].includes(result)) {
      return res.status(400).json({ 
        message: 'Invalid result. Must be "win" or "loss"' 
      });
    }

    const game = await Game.findByIdAndUpdate(
      id,
      { result },
      { new: true }
    );

    if (!game) {
      return res.status(404).json({ message: 'Game not found' });
    }

    console.log(`✅ Game ${id} result updated to: ${result}`);
    res.json({ 
      message: `Game result updated to ${result}`, 
      game 
    });
  } catch (error) {
    console.error('Error updating game result:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Delete game (admin only)
router.delete('/:id', auth, isAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    console.log(`🗑️ Admin deleting game: ${id}`);

    const game = await Game.findByIdAndDelete(id);

    if (!game) {
      return res.status(404).json({ message: 'Game not found' });
    }

    console.log(`✅ Game deleted: ${game.homeTeam} vs ${game.awayTeam}`);
    res.json({ 
      message: 'Game deleted successfully',
      deletedGame: {
        id: game._id,
        match: `${game.homeTeam} vs ${game.awayTeam}`,
        category: game.category
      }
    });
  } catch (error) {
    console.error('Error deleting game:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Get games statistics (admin only)
router.get('/stats/summary', auth, isAdmin, async (req, res) => {
  try {
    console.log('📊 Admin requesting games statistics...');

    const totalGames = await Game.countDocuments();
    const completedGames = await Game.countDocuments({ result: { $exists: true } });
    const wonGames = await Game.countDocuments({ result: 'win' });
    const lostGames = await Game.countDocuments({ result: 'loss' });
    const pendingGames = totalGames - completedGames;
    
    const winRate = completedGames > 0 ? ((wonGames / completedGames) * 100).toFixed(1) : 0;

    // Games by category
    const categoriesStats = await Game.aggregate([
      {
        $group: {
          _id: '$category',
          count: { $sum: 1 },
          won: {
            $sum: {
              $cond: [{ $eq: ['$result', 'win'] }, 1, 0]
            }
          },
          lost: {
            $sum: {
              $cond: [{ $eq: ['$result', 'loss'] }, 1, 0]
            }
          }
        }
      }
    ]);

    const stats = {
      totalGames,
      completedGames,
      pendingGames,
      wonGames,
      lostGames,
      winRate: parseFloat(winRate),
      categoriesStats
    };

    console.log('✅ Games statistics compiled:', stats);
    res.json(stats);
  } catch (error) {
    console.error('Error fetching games statistics:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

module.exports = router;
