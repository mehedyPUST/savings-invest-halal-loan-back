const { validationResult, body, param, query } = require('express-validator');

const handleValidation = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: errors.array().map((e) => ({ field: e.path, message: e.msg })),
    });
  }
  next();
};

const loginRules = [
  body('email').isEmail().normalizeEmail().withMessage('Valid email required'),
  body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
];

const registerRules = [
  body('name').trim().isLength({ min: 2 }).withMessage('Name is required'),
  body('email').isEmail().normalizeEmail().withMessage('Valid email required'),
  body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
  body('phone').optional().isString(),
  body('monthlySavingAmount').optional().isFloat({ min: 0 }),
  body('role').optional().isIn(['member', 'manager']),
];

const loanApplyRules = [
  body('amount')
    .isInt({ min: 1 })
    .withMessage('Loan amount must be a positive whole number (principal only)'),
  body('purpose').optional().isString().trim().isLength({ max: 500 }),
  body('preferredInstallments').optional().isInt({ min: 1, max: 36 }),
];

const voteRules = [
  param('id').isMongoId().withMessage('Invalid loan id'),
  body('vote').isIn(['yes', 'no']).withMessage('Vote must be yes or no'),
];

const repayRules = [
  param('id').isMongoId().withMessage('Invalid loan id'),
  body('amount').isFloat({ min: 1 }).withMessage('Repayment amount must be positive'),
  body('fundPassword').notEmpty().withMessage('Fund action password required'),
];

const savingRequestRules = [
  body('amount').isFloat({ min: 1 }).withMessage('Amount must be positive'),
  body('month').optional().isString(),
  body('note').optional().isString().isLength({ max: 300 }),
];

const objectIdParam = [param('id').isMongoId().withMessage('Invalid id')];

const forgotPasswordRules = [
  body('email').isEmail().normalizeEmail().withMessage('Valid email required'),
];

const resetPasswordRules = [
  body('token').notEmpty().withMessage('Reset token required'),
  body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
];

module.exports = {
  handleValidation,
  loginRules,
  registerRules,
  loanApplyRules,
  voteRules,
  repayRules,
  savingRequestRules,
  objectIdParam,
  forgotPasswordRules,
  resetPasswordRules,
};
