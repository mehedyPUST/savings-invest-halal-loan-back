const express = require('express');
const router = express.Router();
const loanController = require('../controllers/loanController');
const { protect, restrictTo, requireFundPassword } = require('../middleware/auth');

router.use(protect);

// Member
router.post('/apply', restrictTo('member'), loanController.apply);
router.post('/:id/vote', restrictTo('member'), loanController.vote);
router.post('/:id/confirm-receipt', restrictTo('member'), loanController.confirmReceipt);

// Manager
router.post('/:id/start-voting', restrictTo('manager'), loanController.startVoting);
router.post('/:id/finalize', restrictTo('manager'), loanController.finalizeVoting);
router.post('/:id/re-vote', restrictTo('manager'), loanController.openReVote);
router.post('/:id/disburse', restrictTo('manager'), requireFundPassword, loanController.disburse);
router.post('/:id/repay', restrictTo('manager'), requireFundPassword, loanController.repay);

// Both
router.get('/', loanController.listLoans);
router.get('/:id', loanController.getLoan);

module.exports = router;
