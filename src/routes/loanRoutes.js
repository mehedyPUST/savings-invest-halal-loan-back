const express = require('express');
const router = express.Router();
const loanController = require('../controllers/loanController');
const { protect, restrictTo, requireFundPassword } = require('../middleware/auth');
const { voteLimiter } = require('../middleware/rateLimiter');
const {
  handleValidation,
  loanApplyRules,
  voteRules,
  repayRules,
  objectIdParam,
} = require('../middleware/validate');

router.use(protect);

// Member
router.post('/apply', restrictTo('member'), loanApplyRules, handleValidation, loanController.apply);
router.post('/:id/vote', restrictTo('member'), voteLimiter, voteRules, handleValidation, loanController.vote);
router.post('/:id/confirm-receipt', restrictTo('member'), objectIdParam, handleValidation, loanController.confirmReceipt);

// Manager
router.post('/:id/start-voting', restrictTo('manager'), objectIdParam, handleValidation, loanController.startVoting);
router.post('/:id/finalize', restrictTo('manager'), objectIdParam, handleValidation, loanController.finalizeVoting);
router.post('/:id/re-vote', restrictTo('manager'), objectIdParam, handleValidation, loanController.openReVote);
router.post('/:id/disburse', restrictTo('manager'), requireFundPassword, objectIdParam, handleValidation, loanController.disburse);
router.post('/:id/repay', restrictTo('manager'), requireFundPassword, repayRules, handleValidation, loanController.repay);

// Both
router.get('/', loanController.listLoans);
router.get('/:id', objectIdParam, handleValidation, loanController.getLoan);

module.exports = router;
