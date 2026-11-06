const express = require('express');
const router = express.Router();
const fundController = require('../controllers/fundController');
const { protect, restrictTo } = require('../middleware/auth');

router.use(protect);

router.get('/', fundController.getFund);
router.get('/history', fundController.getHistory);
router.put('/targets', restrictTo('manager'), fundController.updateTargets);

module.exports = router;
