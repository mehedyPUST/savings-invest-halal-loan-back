const { getDB } = require('../config/db');
const { ObjectId } = require('mongodb');
const { sendEmail, templates } = require('../utils/email');

// Get or create the single central fund document
const getOrCreateFund = async (db) => {
  let fund = await db.collection('fund').findOne({});
  if (!fund) {
    const newFund = {
      balance: 0,
      targetAmount: 0,
      targetDate: null,
      status: 'collecting', // collecting | ready_to_invest | invested
      totalSavedAllTime: 0,
      totalLoanedAllTime: 0,
      updatedAt: new Date(),
      createdAt: new Date(),
    };
    const result = await db.collection('fund').insertOne(newFund);
    fund = { _id: result.insertedId, ...newFund };
  }
  return fund;
};

// @desc    Get fund overview
// @route   GET /api/fund
exports.getFund = async (req, res) => {
  try {
    const db = getDB();
    const fund = await getOrCreateFund(db);

    // Member count & total monthly potential
    const members = await db.collection('users').find({ role: 'member', isActive: true }).toArray();
    const totalMonthlyPotential = members.reduce((sum, m) => sum + (m.monthlySavingAmount || 0), 0);

    res.json({
      success: true,
      fund: {
        ...fund,
        memberCount: members.length,
        totalMonthlyPotential,
      },
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// @desc    Update fund targets (manager only)
// @route   PUT /api/fund/targets
exports.updateTargets = async (req, res) => {
  try {
    const { targetAmount, targetDate, status } = req.body;
    const db = getDB();

    const update = { updatedAt: new Date() };
    if (targetAmount !== undefined) update.targetAmount = Number(targetAmount);
    if (targetDate !== undefined) update.targetDate = targetDate ? new Date(targetDate) : null;
    if (status && ['collecting', 'ready_to_invest', 'invested'].includes(status)) {
      update.status = status;
    }

    await db.collection('fund').updateOne({}, { $set: update });
    const fund = await getOrCreateFund(db);

    res.json({ success: true, message: 'Fund targets updated', fund });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// @desc    Get fund transaction history
// @route   GET /api/fund/history
exports.getHistory = async (req, res) => {
  try {
    const db = getDB();
    const history = await db
      .collection('fundHistory')
      .find({})
      .sort({ createdAt: -1 })
      .limit(100)
      .toArray();

    res.json({ success: true, history });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// Helper used by other controllers
exports.recordFundChange = async (db, { type, amount, referenceId, referenceType, performedBy, note, balanceAfter }) => {
  await db.collection('fundHistory').insertOne({
    type, // 'saving_confirmed' | 'loan_disbursed' | 'loan_repayment' | 'adjustment'
    amount,
    referenceId,
    referenceType,
    performedBy,
    note: note || '',
    balanceAfter,
    createdAt: new Date(),
  });
};

exports.getOrCreateFund = getOrCreateFund;
