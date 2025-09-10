const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const User = require('./models/User');

mongoose.connect('mongodb://localhost:27017/sports-prediction', {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

const createAdmin = async () => {
  try {
    console.log('Checking for admin user...');
    
    // Check if admin exists
    const existingAdmin = await User.findOne({ username: 'admin' });
    
    if (existingAdmin) {
      console.log('Admin user already exists, deleting old one...');
      await User.deleteOne({ username: 'admin' });
    }
    
    console.log('Creating new admin user...');
    
    // Create new admin - the pre-save middleware will hash the password
    const admin = new User({
      username: 'admin',
      email: 'admin@example.com',
      password: 'admin123',
      isAdmin: true,
      hasPaid: true
    });
    
    await admin.save();
    
    console.log('✅ Admin user created successfully!');
    console.log('Username: admin');
    console.log('Password: admin123');
    console.log('');
    
    // Verify the admin was created
    const verifyAdmin = await User.findOne({ username: 'admin' });
    if (verifyAdmin) {
      console.log('✅ Admin verification successful');
      console.log('Admin ID:', verifyAdmin._id);
      console.log('Is Admin:', verifyAdmin.isAdmin);
      console.log('Has Paid:', verifyAdmin.hasPaid);
    }
    
    mongoose.connection.close();
    process.exit(0);
  } catch (error) {
    console.error('❌ Error creating admin:', error);
    mongoose.connection.close();
    process.exit(1);
  }
};

createAdmin();
