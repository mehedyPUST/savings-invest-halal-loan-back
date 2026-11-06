const { getDB } = require('../config/db');
const { ObjectId } = require('mongodb');

async function getOrCreateFund(db = getDB(), session = null) {
  const opts = session ? { session } : {};
  let fund = await db.collection('fund').findOne({}, opts);
  if (!fund) {
    const newFund = {
      balance: 0,
      targetAmount: 0,
      targetDate: null,
      status: 'collecting',
      totalSavedAllTime: 0,
      totalLoanedAllTime: 0,
      updatedAt: new Date(),
      createdAt: new Date(),
    };
    const result = await db.collection('fund').insertOne(newFund, opts);
    fund = { _id: result.insertedId, ...newFund };
  }
  return fund;
}

async function recordFundChange(
  db,
  { type, amount, referenceId, referenceType, performedBy, note, balanceAfter },
  session = null
) {
  const opts = session ? { session } : {};
  await db.collection('fundHistory').insertOne(
    {
      type,
      amount,
      referenceId,
      referenceType,
      performedBy,
      note: note || '',
      balanceAfter,
      createdAt: new Date(),
    },
    opts
  );
}

/**
 * Atomically adjust fund balance. Returns new balance.
 * delta can be negative (disbursement) or positive (saving / repayment).
 */
async function adjustBalance(db, delta, session = null) {
  const opts = session ? { session } : {};
  const result = await db.collection('fund').findOneAndUpdate(
    {},
    {
      $inc: { balance: delta },
      $set: { updatedAt: new Date() },
    },
    { ...opts, returnDocument: 'after' }
  );
  // Native driver may return document directly or under value depending on version
  const fund = result?.value ?? result;
  if (!fund) {
    // ensure fund exists then retry
    await getOrCreateFund(db, session);
    const retry = await db.collection('fund').findOneAndUpdate(
      {},
      { $inc: { balance: delta }, $set: { updatedAt: new Date() } },
      { ...opts, returnDocument: 'after' }
    );
    return (retry?.value ?? retry).balance;
  }
  return fund.balance;
}

async function getOverview() {
  const db = getDB();
  const fund = await getOrCreateFund(db);
  const members = await db.collection('users').find({ role: 'member', isActive: true }).toArray();
  const totalMonthlyPotential = members.reduce((sum, m) => sum + (m.monthlySavingAmount || 0), 0);
  return {
    ...fund,
    memberCount: members.length,
    totalMonthlyPotential,
  };
}

async function getHistory({ limit = 100, skip = 0 } = {}) {
  const db = getDB();
  const history = await db
    .collection('fundHistory')
    .find({})
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(Math.min(limit, 500))
    .toArray();
  return history;
}

async function updateTargets({ targetAmount, targetDate, status }) {
  const db = getDB();
  const update = { updatedAt: new Date() };
  if (targetAmount !== undefined) update.targetAmount = Number(targetAmount);
  if (targetDate !== undefined) update.targetDate = targetDate ? new Date(targetDate) : null;
  if (status && ['collecting', 'ready_to_invest', 'invested'].includes(status)) {
    update.status = status;
  }
  await db.collection('fund').updateOne({}, { $set: update });
  return getOrCreateFund(db);
}

module.exports = {
  getOrCreateFund,
  recordFundChange,
  adjustBalance,
  getOverview,
  getHistory,
  updateTargets,
};
