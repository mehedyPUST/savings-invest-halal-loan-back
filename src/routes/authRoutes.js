const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { protect, restrictTo } = require('../middleware/auth');

router.post('/register', protect, restrictTo('manager'), authController.register); // Only manager can create users
router.post('/login', authController.login);
router.post('/logout', authController.logout);
router.get('/me', protect, authController.getMe);
router.put('/profile', protect, authController.updateProfile);

// Public first-manager bootstrap (only if no users exist)
router.post('/bootstrap-manager', async (req, res) => {
  try {
    const { getDB } = require('../config/db');
    const bcrypt = require('bcryptjs');
    const jwt = require('jsonwebtoken');
    const db = getDB();

    const count = await db.collection('users').countDocuments();
    if (count > 0) {
      return res.status(403).json({ success: false, message: 'Manager already exists. Use normal registration.' });
    }

    const { name, email, password, phone } = req.body;
    if (!name || !email || !password) {
      return res.status(400).json({ success: false, message: 'Name, email, password required' });
    }

    const hashed = await bcrypt.hash(password, 12);
    const user = {
      name,
      email: email.toLowerCase(),
      password: hashed,
      phone: phone || '',
      role: 'manager',
      monthlySavingAmount: 0,
      totalSaved: 0,
      loansTakenThisYear: 0,
      lastLoanYear: null,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const result = await db.collection('users').insertOne(user);
    const token = jwt.sign({ id: result.insertedId.toString() }, process.env.JWT_SECRET, {
      expiresIn: process.env.JWT_EXPIRES_IN || '7d',
    });

    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    res.status(201).json({
      success: true,
      message: 'First manager created successfully',
      user: { id: result.insertedId, name, email, role: 'manager' },
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

module.exports = router;
