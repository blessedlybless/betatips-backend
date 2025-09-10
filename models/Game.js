const mongoose = require('mongoose');

const gameSchema = new mongoose.Schema({
  homeTeam: {
    type: String,
    required: true,
    trim: true
  },
  awayTeam: {
    type: String,
    required: true,
    trim: true
  },
  prediction: {
    type: String,
    required: true,
    trim: true
  },
  odds: {
    type: Number,
    required: true
  },
  category: {
    type: String,
    enum: ['All Tips', 'Sure Tips', 'Over/Under Tips', 'Bonus', 'VIP Tips'],
    required: true,
    default: 'All Tips'
  },
  matchTime: {
    type: Date,
    required: true
  },
  result: {
    type: String,
    enum: ['win', 'loss'],
    // Remove default: null - this causes the enum validation error
    // Don't set required: false either, just leave it undefined
  },
  postedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  }
}, {
  timestamps: true
});

// Pre-save middleware to remove result field if it's null or empty
gameSchema.pre('save', function(next) {
  // If result is null, undefined, or empty string, remove it completely
  if (this.result === null || this.result === undefined || this.result === '') {
    this.result = undefined;
  }
  next();
});

module.exports = mongoose.model('Game', gameSchema);
