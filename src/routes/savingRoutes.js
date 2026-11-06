const express = require('express');
const router = express.Router();
const savingController = require('../controllers/savingController');
const { protect, restrictTo, requireFundPassword } = require('../middleware/auth');
const { handleValidation, savingRequestRules, objectIdParam } = require('../middleware/validate');

router.use(protect);

router.post('/request', restrictTo('member'), savingRequestRules, handleValidation, savingController.createRequest);
router.put('/request/:id', restrictTo('member'), objectIdParam, handleValidation, savingController.updateRequest);
router.get('/', savingController.listRequests);

router.post('/confirm/:id', restrictTo('manager'), requireFundPassword, objectIdParam, handleValidation, savingController.confirmRequest);
router.post('/deny/:id', restrictTo('manager'), objectIdParam, handleValidation, savingController.denyRequest);

module.exports = router;
