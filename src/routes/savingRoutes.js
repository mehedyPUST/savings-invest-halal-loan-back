const express = require('express');
const router = express.Router();
const savingController = require('../controllers/savingController');
const { protect, restrictTo, requireFundPassword } = require('../middleware/auth');

router.use(protect);

// Member
router.post('/request', restrictTo('member'), savingController.createRequest);
router.put('/request/:id', restrictTo('member'), savingController.updateRequest);
router.get('/', savingController.listRequests);

// Manager – fund changing actions need extra password
router.post('/confirm/:id', restrictTo('manager'), requireFundPassword, savingController.confirmRequest);
router.post('/deny/:id', restrictTo('manager'), savingController.denyRequest);

module.exports = router;
