const express = require('express');
const router = express.Router();
const { getDB } = require('../config/db');
const { ObjectId } = require('mongodb');
const { protect, restrictTo } = require('../middleware/auth');

router.use(protect);

// Manager: list all members
router.get('/', restrictTo('manager'), async (req, res) => {
  try {
    const db = getDB();
    const users = await db
      .collection('users')
      .find({}, { projection: { password: 0 } })
      .sort({ createdAt: -1 })
      .toArray();
    res.json({ success: true, users });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Manager: toggle active status
router.patch('/:id/status', restrictTo('manager'), async (req, res) => {
  try {
    const { isActive } = req.body;
    const db = getDB();
    await db.collection('users').updateOne(
      { _id: new ObjectId(req.params.id) },
      { $set: { isActive: Boolean(isActive), updatedAt: new Date() } }
    );
    res.json({ success: true, message: 'User status updated' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

module.exports = router;
