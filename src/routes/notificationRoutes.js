const express = require('express');
const router = express.Router();
const { protect, restrictTo } = require('../middleware/auth');
const notificationService = require('../services/notificationService');
const { listAudit } = require('../services/auditService');

router.use(protect);

router.get('/', async (req, res) => {
  try {
    const unreadOnly = req.query.unread === 'true';
    const items = await notificationService.listForUser(req.user._id, {
      limit: parseInt(req.query.limit || '30', 10),
      unreadOnly,
    });
    const unread = await notificationService.unreadCount(req.user._id);
    res.json({ success: true, notifications: items, unread });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

router.get('/unread-count', async (req, res) => {
  try {
    const unread = await notificationService.unreadCount(req.user._id);
    res.json({ success: true, unread });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

router.post('/:id/read', async (req, res) => {
  try {
    await notificationService.markRead(req.user._id, req.params.id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

router.post('/read-all', async (req, res) => {
  try {
    await notificationService.markAllRead(req.user._id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Manager audit log
router.get('/audit', restrictTo('manager'), async (req, res) => {
  try {
    const result = await listAudit({
      limit: parseInt(req.query.limit || '50', 10),
      skip: parseInt(req.query.skip || '0', 10),
      action: req.query.action,
    });
    res.json({ success: true, ...result });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

module.exports = router;
