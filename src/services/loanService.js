const { ObjectId } = require('mongodb');
const { getDB, withTransaction } = require('../config/db');
const { sendEmail, templates } = require('../utils/email');
const fundService = require('./fundService');
const { writeAudit } = require('./auditService');
const { createNotification, notifyMany } = require('./notificationService');

const canTakeLoan = async (db, userId) => {
  const user = await db.collection('users').findOne({ _id: new ObjectId(userId) });
  if (!user) return { allowed: false, reason: 'User not found' };

  const activeLoan = await db.collection('loans').findOne({
    memberId: new ObjectId(userId),
    status: { $in: ['approved', 'disbursed', 'repaying'] },
  });
  if (activeLoan) {
    return { allowed: false, reason: 'You already have an active or unpaid loan. Clear it first.' };
  }

  const currentYear = new Date().getFullYear();
  if (user.lastLoanYear === currentYear && user.loansTakenThisYear >= 3) {
    return { allowed: false, reason: 'You have already taken 3 loans this year.' };
  }

  return { allowed: true };
};

async function applyLoan(user, { amount, purpose, preferredInstallments }) {
  const db = getDB();
  const amt = Number(amount);

  if (!Number.isInteger(amt) || amt <= 0) {
    const err = new Error('Loan amount must be a positive whole number (principal only).');
    err.status = 400;
    throw err;
  }

  const check = await canTakeLoan(db, user._id);
  if (!check.allowed) {
    const err = new Error(check.reason);
    err.status = 400;
    throw err;
  }

  const fund = await fundService.getOrCreateFund(db);
  if (fund.balance < amt) {
    const err = new Error(`Insufficient fund balance. Available: ৳${fund.balance.toLocaleString()}`);
    err.status = 400;
    throw err;
  }

  const maxAllowed = Math.max((user.totalSaved || 0) * 3, 0);
  if (maxAllowed > 0 && amt > maxAllowed) {
    const err = new Error(
      `Loan amount exceeds 3× your total savings (৳${maxAllowed.toLocaleString()}). Increase your contributions first.`
    );
    err.status = 400;
    throw err;
  }

  const loan = {
    memberId: new ObjectId(user._id),
    memberName: user.name,
    memberEmail: user.email,
    amount: amt,
    purpose: purpose || '',
    preferredInstallments: preferredInstallments || 0,
    status: 'pending',
    votes: [],
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
    totalRepaid: 0,
    repayments: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const result = await db.collection('loans').insertOne(loan);

  const managers = await db.collection('users').find({ role: 'manager', isActive: true }).toArray();
  for (const manager of managers) {
    const tmpl = templates.loanApplication(user.name, amt, purpose);
    await sendEmail({ to: manager.email, ...tmpl });
    await createNotification({
      userId: manager._id,
      title: 'New loan application',
      body: `${user.name} applied for ৳${amt.toLocaleString()}`,
      type: 'loan',
      link: '/manager/loans',
    });
  }

  await writeAudit({
    action: 'loan.applied',
    actorId: user._id,
    actorName: user.name,
    actorRole: user.role,
    targetType: 'loan',
    targetId: result.insertedId,
    after: { amount: amt, purpose },
  });

  return { loanId: result.insertedId };
}

async function startVoting(loanId, actor) {
  const db = getDB();
  const id = new ObjectId(loanId);
  const loan = await db.collection('loans').findOne({ _id: id });
  if (!loan) {
    const err = new Error('Loan not found');
    err.status = 404;
    throw err;
  }
  if (loan.status !== 'pending') {
    const err = new Error('Voting can only be started for pending loans');
    err.status = 400;
    throw err;
  }

  await db.collection('loans').updateOne(
    { _id: id },
    { $set: { status: 'voting', votingStartedAt: new Date(), updatedAt: new Date() } }
  );

  const members = await db.collection('users').find({ role: 'member', isActive: true }).toArray();
  const memberIds = members.map((m) => m._id);
  for (const member of members) {
    const tmpl = templates.votingStarted(id.toString(), loan.memberName, loan.amount);
    await sendEmail({ to: member.email, ...tmpl });
  }
  await notifyMany(memberIds, {
    title: 'Vote required',
    body: `Loan for ${loan.memberName} — ৳${loan.amount.toLocaleString()}`,
    type: 'vote',
    link: `/member/vote`,
  });

  await writeAudit({
    action: 'loan.voting_started',
    actorId: actor._id,
    actorName: actor.name,
    actorRole: actor.role,
    targetType: 'loan',
    targetId: id,
  });

  return { message: 'Voting started. All members have been notified.' };
}

async function castVote(loanId, user, vote) {
  const db = getDB();
  const id = new ObjectId(loanId);
  const loan = await db.collection('loans').findOne({ _id: id });
  if (!loan) {
    const err = new Error('Loan not found');
    err.status = 404;
    throw err;
  }
  if (loan.status !== 'voting') {
    const err = new Error('Voting is not open for this loan');
    err.status = 400;
    throw err;
  }

  const alreadyVoted = (loan.votes || []).find((v) => v.memberId.toString() === user._id.toString());
  if (alreadyVoted) {
    const err = new Error('You have already voted');
    err.status = 400;
    throw err;
  }

  const newVote = {
    memberId: new ObjectId(user._id),
    memberName: user.name,
    vote,
    votedAt: new Date(),
  };

  const yesCount = loan.yesCount + (vote === 'yes' ? 1 : 0);
  const noCount = loan.noCount + (vote === 'no' ? 1 : 0);
  const totalVotes = loan.totalVotes + 1;
  const totalMembers = await db.collection('users').countDocuments({ role: 'member', isActive: true });
  const approvalPercentage = totalMembers > 0 ? Math.round((yesCount / totalMembers) * 100) : 0;

  await db.collection('loans').updateOne(
    { _id: id },
    {
      $push: { votes: newVote },
      $set: { yesCount, noCount, totalVotes, approvalPercentage, updatedAt: new Date() },
    }
  );

  return { yesCount, noCount, totalVotes, approvalPercentage, totalMembers };
}

async function finalizeVoting(loanId, actor) {
  const db = getDB();
  const id = new ObjectId(loanId);
  const loan = await db.collection('loans').findOne({ _id: id });
  if (!loan) {
    const err = new Error('Loan not found');
    err.status = 404;
    throw err;
  }
  if (loan.status !== 'voting') {
    const err = new Error('Loan is not in voting status');
    err.status = 400;
    throw err;
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
    { _id: id },
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

  if (newStatus === 'approved') {
    const tmpl = templates.loanApproved(loan.memberName, loan.amount);
    await sendEmail({ to: loan.memberEmail, ...tmpl });
  } else {
    const tmpl = templates.loanRejected(loan.memberName, loan.amount);
    await sendEmail({ to: loan.memberEmail, ...tmpl });
  }

  await createNotification({
    userId: loan.memberId,
    title: newStatus === 'approved' ? 'Loan approved' : 'Loan rejected',
    body: message,
    type: 'loan',
    link: '/member/loans',
  });

  await writeAudit({
    action: `loan.${newStatus}`,
    actorId: actor._id,
    actorName: actor.name,
    actorRole: actor.role,
    targetType: 'loan',
    targetId: id,
    after: { status: newStatus, approvalPercentage },
  });

  return { message, status: newStatus, approvalPercentage, yesCount: loan.yesCount, totalMembers };
}

async function openReVote(loanId, actor) {
  const db = getDB();
  const id = new ObjectId(loanId);
  const loan = await db.collection('loans').findOne({ _id: id });
  if (!loan) {
    const err = new Error('Loan not found');
    err.status = 404;
    throw err;
  }
  if (!['rejected', 'voting'].includes(loan.status)) {
    const err = new Error('Re-vote only available for rejected or open voting loans');
    err.status = 400;
    throw err;
  }

  const keptVotes = (loan.votes || []).filter((v) => v.vote === 'yes');
  const yesCount = keptVotes.length;
  const totalMembers = await db.collection('users').countDocuments({ role: 'member', isActive: true });
  const approvalPercentage = totalMembers > 0 ? Math.round((yesCount / totalMembers) * 100) : 0;

  await db.collection('loans').updateOne(
    { _id: id },
    {
      $set: {
        status: 'voting',
        votes: keptVotes,
        yesCount,
        noCount: 0,
        totalVotes: yesCount,
        approvalPercentage,
        votingStartedAt: new Date(),
        votingEndedAt: null,
        rejectedAt: null,
        updatedAt: new Date(),
      },
    }
  );

  const noVoters = (loan.votes || []).filter((v) => v.vote === 'no');
  for (const v of noVoters) {
    const member = await db.collection('users').findOne({ _id: v.memberId });
    if (member) {
      if (templates.reVoteNotification) {
        const tmpl = templates.reVoteNotification(id.toString(), loan.memberName);
        await sendEmail({ to: member.email, ...tmpl });
      }
      await createNotification({
        userId: member._id,
        title: 'Re-vote opened',
        body: `Please vote again on ${loan.memberName}'s loan`,
        type: 'vote',
        link: '/member/vote',
      });
    }
  }

  await writeAudit({
    action: 'loan.revote_opened',
    actorId: actor._id,
    actorName: actor.name,
    actorRole: actor.role,
    targetType: 'loan',
    targetId: id,
  });

  return { message: 'Re-vote opened for previously denied members.' };
}

/**
 * Disburse loan inside a transaction: fund balance + loan status + member counters + history.
 */
async function disburseLoan(loanId, actor, { note, installments }) {
  const result = await withTransaction(async (session, db) => {
    const id = new ObjectId(loanId);
    const loan = await db.collection('loans').findOne({ _id: id }, { session });
    if (!loan) {
      const err = new Error('Loan not found');
      err.status = 404;
      throw err;
    }
    if (loan.status !== 'approved') {
      const err = new Error('Only approved loans can be disbursed');
      err.status = 400;
      throw err;
    }

    const fund = await fundService.getOrCreateFund(db, session);
    if (fund.balance < loan.amount) {
      const err = new Error(`Insufficient fund balance. Available: ৳${fund.balance.toLocaleString()}`);
      err.status = 400;
      throw err;
    }

    const newBalance = fund.balance - loan.amount;

    await db.collection('fund').updateOne(
      { _id: fund._id },
      {
        $inc: { balance: -loan.amount, totalLoanedAllTime: loan.amount },
        $set: { updatedAt: new Date() },
      },
      { session }
    );

    let installmentList = [];
    if (Array.isArray(installments) && installments.length > 0) {
      installmentList = installments.map((inst, idx) => ({
        number: idx + 1,
        dueDate: new Date(inst.dueDate),
        amount: Number(inst.amount),
        status: 'pending',
        paidAt: null,
        paidAmount: 0,
      }));
    }

    await db.collection('loans').updateOne(
      { _id: id },
      {
        $set: {
          status: 'disbursed',
          disbursedAt: new Date(),
          disbursementNote: note || '',
          installments: installmentList,
          updatedAt: new Date(),
        },
      },
      { session }
    );

    const currentYear = new Date().getFullYear();
    const user = await db.collection('users').findOne({ _id: loan.memberId }, { session });
    const loansTakenThisYear =
      user && user.lastLoanYear === currentYear ? (user.loansTakenThisYear || 0) + 1 : 1;

    await db.collection('users').updateOne(
      { _id: loan.memberId },
      {
        $set: {
          loansTakenThisYear,
          lastLoanYear: currentYear,
          updatedAt: new Date(),
        },
      },
      { session }
    );

    await fundService.recordFundChange(
      db,
      {
        type: 'loan_disbursed',
        amount: -loan.amount,
        referenceId: id,
        referenceType: 'loan',
        performedBy: actor._id,
        note: `Loan disbursed to ${loan.memberName}`,
        balanceAfter: newBalance,
      },
      session
    );

    await writeAudit({
      action: 'loan.disbursed',
      actorId: actor._id,
      actorName: actor.name,
      actorRole: actor.role,
      targetType: 'loan',
      targetId: id,
      after: { amount: loan.amount, newBalance },
      session,
    });

    return { loan, newBalance };
  });

  const tmpl = templates.loanDisbursed(result.loan.memberName, result.loan.amount);
  await sendEmail({ to: result.loan.memberEmail, ...tmpl });
  await createNotification({
    userId: result.loan.memberId,
    title: 'Loan disbursed',
    body: `৳${result.loan.amount.toLocaleString()} has been disbursed`,
    type: 'loan',
    link: '/member/loans',
  });

  return {
    message: `Loan of ৳${result.loan.amount.toLocaleString()} disbursed. Fund balance updated.`,
    newBalance: result.newBalance,
  };
}

async function confirmReceipt(loanId, user, { reportMessage }) {
  const db = getDB();
  const id = new ObjectId(loanId);
  const loan = await db.collection('loans').findOne({ _id: id });
  if (!loan) {
    const err = new Error('Loan not found');
    err.status = 404;
    throw err;
  }
  if (loan.memberId.toString() !== user._id.toString()) {
    const err = new Error('Not your loan');
    err.status = 403;
    throw err;
  }
  if (loan.status !== 'disbursed') {
    const err = new Error('Loan is not in disbursed status');
    err.status = 400;
    throw err;
  }

  await db.collection('loans').updateOne(
    { _id: id },
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

  const managers = await db.collection('users').find({ role: 'manager', isActive: true }).toArray();
  await notifyMany(
    managers.map((m) => m._id),
    {
      title: 'Loan receipt confirmed',
      body: `${user.name} confirmed receipt${reportMessage ? ' with a report' : ''}`,
      type: 'loan',
      link: '/manager/loans',
    }
  );

  return {
    message: reportMessage
      ? 'Receipt confirmed with report. Manager has been notified.'
      : 'Receipt confirmed. Thank you.',
  };
}

/**
 * Record repayment inside a transaction.
 */
async function repayLoan(loanId, actor, { amount, note }) {
  const repayAmount = Number(amount);
  if (!repayAmount || repayAmount <= 0) {
    const err = new Error('Valid repayment amount is required');
    err.status = 400;
    throw err;
  }

  const result = await withTransaction(async (session, db) => {
    const id = new ObjectId(loanId);
    const loan = await db.collection('loans').findOne({ _id: id }, { session });
    if (!loan) {
      const err = new Error('Loan not found');
      err.status = 404;
      throw err;
    }
    if (!['disbursed', 'repaying'].includes(loan.status)) {
      const err = new Error('Loan is not in a repayable status');
      err.status = 400;
      throw err;
    }

    const totalRepaid = (loan.totalRepaid || 0) + repayAmount;
    if (totalRepaid > loan.amount + 0.01) {
      const err = new Error(
        `Repayment exceeds principal. Remaining: ৳${(loan.amount - (loan.totalRepaid || 0)).toLocaleString()}`
      );
      err.status = 400;
      throw err;
    }

    const remaining = Math.max(0, loan.amount - totalRepaid);
    const isFullyPaid = remaining < 0.01;

    const fund = await fundService.getOrCreateFund(db, session);
    const newBalance = fund.balance + repayAmount;
    await db.collection('fund').updateOne(
      { _id: fund._id },
      { $inc: { balance: repayAmount }, $set: { updatedAt: new Date() } },
      { session }
    );

    const repaymentEntry = {
      amount: repayAmount,
      note: note || '',
      recordedBy: new ObjectId(actor._id),
      recordedAt: new Date(),
    };

    const update = {
      $inc: { totalRepaid: repayAmount },
      $push: { repayments: repaymentEntry },
      $set: {
        status: isFullyPaid ? 'completed' : 'repaying',
        updatedAt: new Date(),
      },
    };

    if (isFullyPaid) {
      update.$set.completedAt = new Date();
    }

    await db.collection('loans').updateOne({ _id: id }, update, { session });

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
      await db.collection('loans').updateOne({ _id: id }, { $set: { installments: updatedInst } }, { session });
    }

    await fundService.recordFundChange(
      db,
      {
        type: 'loan_repayment',
        amount: repayAmount,
        referenceId: id,
        referenceType: 'loan',
        performedBy: actor._id,
        note: `Repayment from ${loan.memberName}${isFullyPaid ? ' (FULLY PAID)' : ''}`,
        balanceAfter: newBalance,
      },
      session
    );

    await writeAudit({
      action: isFullyPaid ? 'loan.completed' : 'loan.repayment',
      actorId: actor._id,
      actorName: actor.name,
      actorRole: actor.role,
      targetType: 'loan',
      targetId: id,
      after: { repayAmount, totalRepaid, remaining, newBalance },
      session,
    });

    return { loan, repayAmount, totalRepaid, remaining, isFullyPaid, newBalance };
  });

  await sendEmail({
    to: result.loan.memberEmail,
    subject: result.isFullyPaid
      ? `✅ Loan Fully Repaid — ৳${result.loan.amount.toLocaleString()}`
      : `Repayment Recorded — ৳${result.repayAmount.toLocaleString()}`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
        <h2 style="color:#0f766e;">Qard Hasan Repayment</h2>
        <p>Dear ${result.loan.memberName},</p>
        <p>A repayment of <strong>৳${result.repayAmount.toLocaleString()}</strong> has been recorded.</p>
        <p>Total repaid: ৳${result.totalRepaid.toLocaleString()} / ৳${result.loan.amount.toLocaleString()}</p>
        <p>Remaining: ৳${result.remaining.toLocaleString()}</p>
        ${result.isFullyPaid ? '<p style="color:#059669;font-weight:bold;">Your loan is now fully paid. JazakAllahu Khairan.</p>' : ''}
        <p style="font-size:13px;color:#666;">This is a principal-only repayment. No interest or extra charge was applied.</p>
      </div>
    `,
  });

  await createNotification({
    userId: result.loan.memberId,
    title: result.isFullyPaid ? 'Loan fully repaid' : 'Repayment recorded',
    body: `৳${result.repayAmount.toLocaleString()} recorded. Remaining ৳${result.remaining.toLocaleString()}`,
    type: 'loan',
    link: '/member/loans',
  });

  return {
    message: result.isFullyPaid
      ? `Full repayment recorded. Loan completed. Fund balance: ৳${result.newBalance.toLocaleString()}`
      : `Repayment of ৳${result.repayAmount.toLocaleString()} recorded. Remaining: ৳${result.remaining.toLocaleString()}`,
    remaining: result.remaining,
    totalRepaid: result.totalRepaid,
    newBalance: result.newBalance,
    status: result.isFullyPaid ? 'completed' : 'repaying',
  };
}

async function listLoans(user, { status } = {}) {
  const db = getDB();
  const filter = user.role === 'manager' ? {} : { memberId: new ObjectId(user._id) };
  if (status) filter.status = status;
  const loans = await db.collection('loans').find(filter).sort({ createdAt: -1 }).toArray();
  return loans;
}

async function getLoan(loanId, user) {
  const db = getDB();
  const loan = await db.collection('loans').findOne({ _id: new ObjectId(loanId) });
  if (!loan) {
    const err = new Error('Loan not found');
    err.status = 404;
    throw err;
  }
  if (
    user.role === 'member' &&
    loan.memberId.toString() !== user._id.toString() &&
    loan.status !== 'voting'
  ) {
    const err = new Error('Access denied');
    err.status = 403;
    throw err;
  }
  return loan;
}

module.exports = {
  canTakeLoan,
  applyLoan,
  startVoting,
  castVote,
  finalizeVoting,
  openReVote,
  disburseLoan,
  confirmReceipt,
  repayLoan,
  listLoans,
  getLoan,
};
