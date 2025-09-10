const express = require('express');
const mongoose = require('mongoose');
const auth = require('../middleware/auth');
const User = require('../models/User');

const router = express.Router();

// Enhanced Post Schema with Replies
const postSchema = new mongoose.Schema({
  content: {
    type: String,
    required: true,
    maxlength: 500
  },
  author: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  replies: [{
    content: {
      type: String,
      required: true,
      maxlength: 300
    },
    author: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    createdAt: {
      type: Date,
      default: Date.now
    }
  }]
}, { timestamps: true });

const Post = mongoose.model('Post', postSchema);

// Get all posts with replies
router.get('/posts', auth, async (req, res) => {
  try {
    const posts = await Post.find()
      .populate('author', 'username hasPaid')
      .populate('replies.author', 'username hasPaid')
      .sort({ createdAt: -1 })
      .limit(20);
    
    res.json(posts);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching posts' });
  }
});

// Create new post
router.post('/posts', auth, async (req, res) => {
  try {
    const { content } = req.body;
    
    if (!content || content.trim().length === 0) {
      return res.status(400).json({ message: 'Content is required' });
    }

    const post = new Post({
      content: content.trim(),
      author: req.userId,
      replies: []
    });

    await post.save();
    await post.populate('author', 'username hasPaid');
    
    res.status(201).json({ message: 'Post created successfully', post });
  } catch (error) {
    res.status(500).json({ message: 'Error creating post' });
  }
});

// Add reply to a post
router.post('/posts/:postId/reply', auth, async (req, res) => {
  try {
    const { postId } = req.params;
    const { content } = req.body;
    
    if (!content || content.trim().length === 0) {
      return res.status(400).json({ message: 'Reply content is required' });
    }

    const post = await Post.findById(postId);
    if (!post) {
      return res.status(404).json({ message: 'Post not found' });
    }

    const reply = {
      content: content.trim(),
      author: req.userId,
      createdAt: new Date()
    };

    post.replies.push(reply);
    await post.save();
    
    await post.populate('replies.author', 'username hasPaid');
    
    res.status(201).json({ message: 'Reply added successfully', post });
  } catch (error) {
    res.status(500).json({ message: 'Error adding reply' });
  }
});

// Delete post (admin only)
router.delete('/posts/:postId', auth, async (req, res) => {
  try {
    const { postId } = req.params;
    
    // Check if user is admin
    const user = await User.findById(req.userId);
    if (!user.isAdmin) {
      return res.status(403).json({ message: 'Access denied. Admin only.' });
    }

    const deletedPost = await Post.findByIdAndDelete(postId);
    
    if (!deletedPost) {
      return res.status(404).json({ message: 'Post not found' });
    }

    res.json({ message: 'Post deleted successfully' });
  } catch (error) {
    console.error('Error deleting post:', error);
    res.status(500).json({ message: 'Error deleting post' });
  }
});

module.exports = router;
