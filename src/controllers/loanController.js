const { getDB } = require('../config/db');
const { ObjectId } = require('mongodb');
const { sendEmail, templates } = require('../utils/email');
const { getOrCreateFund, recordFundChange } = require('./fundController');

// Helper: check if member can take a new loan
const canTakeLoan = async (db, userId) => {
  const user = await db.collection('users').findOne({ _id: new ObjectId(userId) });
  if (!user) return { allowed: false, reason: 'User not found' };

  // Check active/due loans
  const activeLoan = await db.collection('loans').findOne({
    memberId: new ObjectId(userId),
    status: { $in: ['approved', 'disbursed', 'repaying'] },
  });
  if (activeLoan) {
    return { allowed: false, reason: 'You already have an active or unpaid loan. Clear it first.' };
  }

  // Max 3 loans per calendar year
  const currentYear = new Date().getFullYear();
  if (user.lastLoanYear === currentYear && user.loansTakenThisYear >= 3) {
    return { allowed: false, reason: 'You have already taken 3 loans this year.' };
  }

  return { allowed: true };
};

// @desc    Member applies for a loan
// @route   POST /api/loans/apply
exports.apply = async (req, res) => {
  try {
    const { amount, purpose, preferredInstallments } = req.body;

    if (!amount || amount <= 0) {
      return res.status(400).json({ success: false, message: 'Valid amount is required' });
    }

    const db = getDB();
    const check = await canTakeLoan(db, req.user._id);
    if (!check.allowed) {
      return res.status(400).json({ success: false, message: check.reason });
    }

    // Check fund has enough balance
    const fund = await getOrCreateFund(db);
    if (fund.balance < amount) {
      return res.status(400).json({
        success: false,
        message: `Insufficient fund balance. Available: ৳${fund.balance.toLocaleString()}`,
      });
    }

    // Cooperative rule: max loan = 3 × member's total contribution (prevents over-borrowing)
    const maxAllowed = Math.max((req.user.totalSaved || 0) * 3, 0);
    if (maxAllowed > 0 && amount > maxAllowed) {
      return res.status(400).json({
        success: false,
        message: `Loan amount exceeds 3× your total savings (৳${maxAllowed.toLocaleString()}). Increase your contributions first.`,
      });
    }

    // Principal only — reject any non-integer / fractional interest-like amounts for clarity
    if (!Number.isInteger(Number(amount))) {
      return res.status(400).json({
        success: false,
        message: 'Loan amount must be a whole number (principal only, no decimals for interest).',
      });
    }

    const loan = {
      memberId: new ObjectId(req.user._id),
      memberName: req.user.name,
      memberEmail: req.user.email,
      amount: Number(amount),
      purpose: purpose || '',
      preferredInstallments: preferredInstallments || 0,
      status: 'pending', // pending → voting → approved/rejected → disbursed → repaying → completed
      votes: [], // { memberId, vote: 'yes'|'no', votedAt }
      yesCount: 0,
      noCount: 0,
      totalVotes: 0,
      approvalPercentage: 0,
      votingStartedAt: null,
      votingEndedAt: null,
      approvedAt: null,
      rejectedAt: null,
      disbursedAt: null,
      disbursementNote: '',
      receiptConfirmed: false,
      receiptConfirmedAt: null,
      reportMessage: '',
      installments: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const result = await db.collection('loans').insertOne(loan);

    // Notify managers
    const managers = await db.collection('users').find({ role: 'manager', isActive: true }).toArray();
    for (const manager of managers) {
      const tmpl = templates.loanApplication(req.user.name, amount, purpose);
      await sendEmail({ to: manager.email, ...tmpl });
    }

    res.status(201).json({
      success: true,
      message: 'Loan application submitted. Manager will start voting soon.',
      loanId: result.insertedId,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// @desc    Manager starts voting on a loan
// @route   POST /api/loans/:id/start-voting
exports.startVoting = async (req, res) => {
  try {
    const db = getDB();
    const loanId = new ObjectId(req.params.id);

    const loan = await db.collection('loans').findOne({ _id: loanId });
    if (!loan) return res.status(404).json({ success: false, message: 'Loan not found' });
    if (loan.status !== 'pending') {
      return res.status(400).json({ success: false, message: 'Voting can only be started for pending loans' });
    }

    await db.collection('loans').updateOne(
      { _id: loanId },
      {
        $set: {
          status: 'voting',
          votingStartedAt: new Date(),
          updatedAt: new Date(),
        },
      }
    );

    // Notify all active members
    const members = await db.collection('users').find({ role: 'member', isActive: true }).toArray();
    for (const member of members) {
      // Don't notify the applicant themselves? Or do – they can also vote? Usually members vote, applicant may abstain.
      const tmpl = templates.votingStarted(loanId.toString(), loan.memberName, loan.amount);
      await sendEmail({ to: member.email, ...tmpl });
    }

    res.json({ success: true, message: 'Voting started. All members have been notified by email.' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// @desc    Member casts a vote
// @route   POST /api/loans/:id/vote
exports.vote = async (req, res) => {
  try {
    const { vote } = req.body; // 'yes' | 'no'
    if (!['yes', 'no'].includes(vote)) {
      return res.status(400).json({ success: false, message: 'Vote must be "yes" or "no"' });
    }

    const db = getDB();
    const loanId = new ObjectId(req.params.id);

    const loan = await db.collection('loans').findOne({ _id: loanId });
    if (!loan) return res.status(404).json({ success: false, message: 'Loan not found' });
    if (loan.status !== 'voting') {
      return res.status(400).json({ success: false, message: 'Voting is not open for this loan' });
    }

    // Check if already voted
    const alreadyVoted = loan.votes.find((v) => v.memberId.toString() === req.user._id.toString());
    if (alreadyVoted) {
      return res.status(400).json({ success: false, message: 'You have already voted' });
    }

    const newVote = {
      memberId: new ObjectId(req.user._id),
      memberName: req.user.name,
      vote,
      votedAt: new Date(),
    };

    const yesCount = loan.yesCount + (vote === 'yes' ? 1 : 0);
    const noCount = loan.noCount + (vote === 'no' ? 1 : 0);
    const totalVotes = loan.totalVotes + 1;

    // Get total active members for percentage (excluding maybe applicant, but we use all)
    const totalMembers = await db.collection('users').countDocuments({ role: 'member', isActive: true });
    const approvalPercentage = totalMembers > 0 ? Math.round((yesCount / totalMembers) * 100) : 0;

    await db.collection('loans').updateOne(
      { _id: loanId },
      {
        $push: { votes: newVote },
        $set: {
          yesCount,
          noCount,
          totalVotes,
          approvalPercentage,
          updatedAt: new Date(),
        },
      }
    );

    res.json({
      success: true,
      message: `Vote recorded: ${vote.toUpperCase()}`,
      current: { yesCount, noCount, totalVotes, approvalPercentage, totalMembers },
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// @desc    Manager finalizes voting (or auto-check)
// @route   POST /api/loans/:id/finalize
exports.finalizeVoting = async (req, res) => {
  try {
    const db = getDB();
    const loanId = new ObjectId(req.params.id);

    const loan = await db.collection('loans').findOne({ _id: loanId });
    if (!loan) return res.status(404).json({ success: false, message: 'Loan not found' });
    if (loan.status !== 'voting') {
      return res.status(400).json({ success: false, message: 'Loan is not in voting status' });
    }

    const totalMembers = await db.collection('users').countDocuments({ role: 'member', isActive: true });
    const approvalPercentage = totalMembers > 0 ? Math.round((loan.yesCount / totalMembers) * 100) : 0;

    let newStatus = 'rejected';
    let message = 'Loan rejected (less than 67% approval)';

    if (approvalPercentage >= 67) {
      newStatus = 'approved';
      message = 'Loan approved (≥67% yes votes)';
    }

    await db.collection('loans').updateOne(
      { _id: loanId },
      {
        $set: {
          status: newStatus,
          approvalPercentage,
          votingEndedAt: new Date(),
          [newStatus === 'approved' ? 'approvedAt' : 'rejectedAt']: new Date(),
          updatedAt: new Date(),
        },
      }
    );

    // Notify applicant
    if (newStatus === 'approved') {
      const tmpl = templates.loanApproved(loan.memberName, loan.amount);
      await sendEmail({ to: loan.memberEmail, ...tmpl });
    } else {
      const tmpl = templates.loanRejected(loan.memberName, loan.amount);
      await sendEmail({ to: loan.memberEmail, ...tmpl });
    }

    res.json({
      success: true,
      message,
      status: newStatus,
      approvalPercentage,
      yesCount: loan.yesCount,
      totalMembers,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// @desc    Manager opens re-vote for members who voted no (when <33% total participation or specific case)
// @route   POST /api/loans/:id/re-vote
exports.openReVote = async (req, res) => {
  try {
    const db = getDB();
    const loanId = new ObjectId(req.params.id);

    const loan = await db.collection('loans').findOne({ _id: loanId });
    if (!loan) return res.status(404).json({ success: false, message: 'Loan not found' });

    // Only for rejected or low participation
    if (!['rejected', 'voting'].includes(loan.status)) {
      return res.status(400).json({ success: false, message: 'Re-vote only available for rejected or open voting loans' });
    }

    // Reset only the "no" votes so those members can vote again
    const keptVotes = loan.votes.filter((v) => v.vote === 'yes');
    const yesCount = keptVotes.length;
    const noCount = 0;
    const totalVotes = yesCount;

    const totalMembers = await db.collection('users').countDocuments({ role: 'member', isActive: true });
    const approvalPercentage = totalMembers > 0 ? Math.round((yesCount / totalMembers) * 100) : 0;

    await db.collection('loans').updateOne(
      { _id: loanId },
      {
        $set: {
          status: 'voting',
          votes: keptVotes,
          yesCount,
          noCount,
          totalVotes,
          approvalPercentage,
          votingStartedAt: new Date(),
          votingEndedAt: null,
          rejectedAt: null,
          updatedAt: new Date(),
        },
      }
    );

    // Notify previous no-voters
    const noVoters = loan.votes.filter((v) => v.vote === 'no');
    for (const v of noVoters) {
      const member = await db.collection('users').findOne({ _id: v.memberId });
      if (member) {
        const tmpl = templates.reVoteNotification(loanId.toString(), loan.memberName);
        await sendEmail({ to: member.email, ...tmpl });
      }
    }

    res.json({
      success: true,
      message: 'Re-vote opened for previously denied members. They have been notified.',
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// @desc    Manager disburses the loan (deducts from fund)
// @route   POST /api/loans/:id/disburse
exports.disburse = async (req, res) => {
  try {
    const { note, installments } = req.body; // installments: [{dueDate, amount}]
    const db = getDB();
    const loanId = new ObjectId(req.params.id);

    const loan = await db.collection('loans').findOne({ _id: loanId });
    if (!loan) return res.status(404).json({ success: false, message: 'Loan not found' });
    if (loan.status !== 'approved') {
      return res.status(400).json({ success: false, message: 'Only approved loans can be disbursed' });
    }

    const fund = await getOrCreateFund(db);
    if (fund.balance < loan.amount) {
      return res.status(400).json({
        success: false,
        message: `Insufficient fund balance. Available: ৳${fund.balance.toLocaleString()}`,
      });
    }

    const newBalance = fund.balance - loan.amount;

    // Update fund
    await db.collection('fund').updateOne(
      { _id: fund._id },
      {
        $inc: { balance: -loan.amount, totalLoanedAllTime: loan.amount },
        $set: { updatedAt: new Date() },
      }
    );

    // Prepare installments (if provided)
    let installmentList = [];
    if (Array.isArray(installments) && installments.length > 0) {
      installmentList = installments.map((inst, idx) => ({
        number: idx + 1,
        dueDate: new Date(inst.dueDate),
        amount: Number(inst.amount),
        status: 'pending', // pending | paid | overdue
        paidAt: null,
        paidAmount: 0,
      }));
    }

    // Update loan
    await db.collection('loans').updateOne(
      { _id: loanId },
      {
        $set: {
          status: 'disbursed',
          disbursedAt: new Date(),
          disbursementNote: note || '',
          installments: installmentList,
          updatedAt: new Date(),
        },
      }
    );

    // Update member loan counters
    const currentYear = new Date().getFullYear();
    const user = await db.collection('users').findOne({ _id: loan.memberId });
    const loansTakenThisYear =
      user.lastLoanYear === currentYear ? (user.loansTakenThisYear || 0) + 1 : 1;

    await db.collection('users').updateOne(
      { _id: loan.memberId },
      {
        $set: {
          loansTakenThisYear,
          lastLoanYear: currentYear,
          updatedAt: new Date(),
        },
      }
    );

    // History
    await recordFundChange(db, {
      type: 'loan_disbursed',
      amount: -loan.amount,
      referenceId: loanId,
      referenceType: 'loan',
      performedBy: req.user._id,
      note: `Loan disbursed to ${loan.memberName}`,
      balanceAfter: newBalance,
    });

    // Notify member
    const tmpl = templates.loanDisbursed(loan.memberName, loan.amount);
    await sendEmail({ to: loan.memberEmail, ...tmpl });

    res.json({
      success: true,
      message: `Loan of ৳${loan.amount.toLocaleString()} disbursed. Fund balance updated.`,
      newBalance,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// @desc    Member confirms receipt of loan money
// @route   POST /api/loans/:id/confirm-receipt
exports.confirmReceipt = async (req, res) => {
  try {
    const { reportMessage } = req.body; // optional report
    const db = getDB();
    const loanId = new ObjectId(req.params.id);

    const loan = await db.collection('loans').findOne({ _id: loanId });
    if (!loan) return res.status(404).json({ success: false, message: 'Loan not found' });
    if (loan.memberId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ success: false, message: 'Not your loan' });
    }
    if (loan.status !== 'disbursed') {
      return res.status(400).json({ success: false, message: 'Loan is not in disbursed status' });
    }

    await db.collection('loans').updateOne(
      { _id: loanId },
      {
        $set: {
          receiptConfirmed: true,
          receiptConfirmedAt: new Date(),
          reportMessage: reportMessage || '',
          status: 'repaying',
          updatedAt: new Date(),
        },
      }
    );

    res.json({
      success: true,
      message: reportMessage
        ? 'Receipt confirmed with report. Manager has been notified (fund balance unchanged).'
        : 'Receipt confirmed. Thank you.',
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// @desc    List loans
// @route   GET /api/loans
exports.listLoans = async (req, res) => {
  try {
    const db = getDB();
    const filter = req.user.role === 'manager' ? {} : { memberId: new ObjectId(req.user._id) };
    if (req.query.status) filter.status = req.query.status;

    const loans = await db.collection('loans').find(filter).sort({ createdAt: -1 }).toArray();
    res.json({ success: true, loans });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// @desc    Get single loan
// @route   GET /api/loans/:id
exports.getLoan = async (req, res) => {
  try {
    const db = getDB();
    const loan = await db.collection('loans').findOne({ _id: new ObjectId(req.params.id) });
    if (!loan) return res.status(404).json({ success: false, message: 'Loan not found' });

    // Members can only see their own or voting loans
    if (req.user.role === 'member' && loan.memberId.toString() !== req.user._id.toString() && loan.status !== 'voting') {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    res.json({ success: true, loan });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// @desc    Record a loan repayment (principal only — Riba-free)
// @route   POST /api/loans/:id/repay
exports.repay = async (req, res) => {
  try {
    const { amount, note, fundPassword } = req.body;
    const repayAmount = Number(amount);
    if (!repayAmount || repayAmount <= 0) {
      return res.status(400).json({ success: false, message: 'Valid repayment amount is required' });
    }

    const db = getDB();
    const loanId = new ObjectId(req.params.id);
    const loan = await db.collection('loans').findOne({ _id: loanId });
    if (!loan) return res.status(404).json({ success: false, message: 'Loan not found' });

    if (!['disbursed', 'repaying'].includes(loan.status)) {
      return res.status(400).json({ success: false, message: 'Loan is not in a repayable status' });
    }

    // Only manager can record repayment (or member self-report then manager confirms — keep simple: manager records)
    if (req.user.role !== 'manager') {
      return res.status(403).json({ success: false, message: 'Only manager can record repayments' });
    }

    const totalRepaid = (loan.totalRepaid || 0) + repayAmount;
    if (totalRepaid > loan.amount + 0.01) {
      return res.status(400).json({
        success: false,
        message: `Repayment exceeds principal. Remaining: ৳${(loan.amount - (loan.totalRepaid || 0)).toLocaleString()}`,
      });
    }

    const remaining = Math.max(0, loan.amount - totalRepaid);
    const isFullyPaid = remaining < 0.01;

    // Add money back to central fund (revolving)
    const fund = await getOrCreateFund(db);
    const newBalance = fund.balance + repayAmount;
    await db.collection('fund').updateOne(
      { _id: fund._id },
      { $inc: { balance: repayAmount }, $set: { updatedAt: new Date() } }
    );

    // Update loan
    const repaymentEntry = {
      amount: repayAmount,
      note: note || '',
      recordedBy: new ObjectId(req.user._id),
      recordedAt: new Date(),
    };

    await db.collection('loans').updateOne(
      { _id: loanId },
      {
        $inc: { totalRepaid: repayAmount },
        $push: { repayments: repaymentEntry },
        $set: {
          status: isFullyPaid ? 'completed' : 'repaying',
          remainingPrincipal: remaining,
          updatedAt: new Date(),
          ...(isFullyPaid ? { completedAt: new Date() } : {}),
        },
      }
    );

    // Update installment statuses if present
    if (Array.isArray(loan.installments) && loan.installments.length > 0) {
      let left = repayAmount;
      const updatedInst = loan.installments.map((inst) => {
        if (inst.status === 'paid' || left <= 0) return inst;
        const due = inst.amount - (inst.paidAmount || 0);
        if (due <= 0) return { ...inst, status: 'paid' };
        const pay = Math.min(left, due);
        left -= pay;
        const newPaid = (inst.paidAmount || 0) + pay;
        return {
          ...inst,
          paidAmount: newPaid,
          status: newPaid >= inst.amount - 0.01 ? 'paid' : 'pending',
          paidAt: newPaid >= inst.amount - 0.01 ? new Date() : inst.paidAt,
        };
      });
      await db.collection('loans').updateOne({ _id: loanId }, { $set: { installments: updatedInst } });
    }

    await recordFundChange(db, {
      type: 'loan_repayment',
      amount: repayAmount,
      referenceId: loanId,
      referenceType: 'loan',
      performedBy: req.user._id,
      note: `Repayment from ${loan.memberName}${isFullyPaid ? ' (FULLY PAID)' : ''}`,
      balanceAfter: newBalance,
    });

    // Notify member
    await sendEmail({
      to: loan.memberEmail,
      subject: isFullyPaid
        ? `✅ Loan Fully Repaid — ৳${loan.amount.toLocaleString()}`
        : `Repayment Recorded — ৳${repayAmount.toLocaleString()}`,
      html: `
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
          <h2 style="color:#0f766e;">Qard Hasan Repayment</h2>
          <p>Dear ${loan.memberName},</p>
          <p>A repayment of <strong>৳${repayAmount.toLocaleString()}</strong> has been recorded.</p>
          <p>Total repaid: ৳${totalRepaid.toLocaleString()} / ৳${loan.amount.toLocaleString()}</p>
          <p>Remaining: ৳${remaining.toLocaleString()}</p>
          ${isFullyPaid ? '<p style="color:#059669;font-weight:bold;">Your loan is now fully paid. JazakAllahu Khairan.</p>' : ''}
          <p style="font-size:13px;color:#666;">This is a principal-only repayment. No interest or extra charge was applied.</p>
        </div>
      `,
    });

    res.json({
      success: true,
      message: isFullyPaid
        ? `Full repayment recorded. Loan completed. Fund balance: ৳${newBalance.toLocaleString()}`
        : `Repayment of ৳${repayAmount.toLocaleString()} recorded. Remaining: ৳${remaining.toLocaleString()}`,
      remaining,
      totalRepaid,
      newBalance,
      status: isFullyPaid ? 'completed' : 'repaying',
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};
