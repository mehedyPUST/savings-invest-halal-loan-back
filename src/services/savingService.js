const { ObjectId } = require('mongodb');
const { getDB, withTransaction } = require('../config/db');
const { sendEmail, templates } = require('../utils/email');
const fundService = require('./fundService');
const { writeAudit } = require('./auditService');
const { createNotification, notifyMany } = require('./notificationService');

async function createRequest(user, { amount, method, transactionId, note }) {
  const amt = Number(amount);
  if (!amt || amt <= 0) {
    const err = new Error('Valid amount is required');
    err.status = 400;
    throw err;
  }
  if (!method) {
    const err = new Error('Payment method is required (bkash, bank, cash, etc.)');
    err.status = 400;
    throw err;
  }

  const db = getDB();
  const request = {
    memberId: new ObjectId(user._id),
    memberName: user.name,
    memberEmail: user.email,
    amount: amt,
    method: String(method).toLowerCase(),
    transactionId: transactionId || '',
    note: note || '',
    status: 'pending',
    denialReason: '',
    confirmedBy: null,
    confirmedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const result = await db.collection('savingRequests').insertOne(request);

  const managers = await db.collection('users').find({ role: 'manager', isActive: true }).toArray();
  for (const manager of managers) {
    if (templates.savingRequest) {
      const tmpl = templates.savingRequest(user.name, amt, method, transactionId);
      await sendEmail({ to: manager.email, ...tmpl });
    }
  }
  await notifyMany(
    managers.map((m) => m._id),
    {
      title: 'New saving request',
      body: `${user.name} — ৳${amt.toLocaleString()} via ${method}`,
      type: 'saving',
      link: '/manager/savings',
    }
  );

  await writeAudit({
    action: 'saving.requested',
    actorId: user._id,
    actorName: user.name,
    actorRole: user.role,
    targetType: 'savingRequest',
    targetId: result.insertedId,
    after: { amount: amt, method },
  });

  return { id: result.insertedId, ...request };
}

async function updateRequest(requestId, user, body) {
  const db = getDB();
  const id = new ObjectId(requestId);
  const existing = await db.collection('savingRequests').findOne({ _id: id });
  if (!existing) {
    const err = new Error('Request not found');
    err.status = 404;
    throw err;
  }
  if (existing.memberId.toString() !== user._id.toString()) {
    const err = new Error('Not your request');
    err.status = 403;
    throw err;
  }
  if (!['denied', 'pending'].includes(existing.status)) {
    const err = new Error('Only pending or denied requests can be updated');
    err.status = 400;
    throw err;
  }

  const update = { updatedAt: new Date(), status: 'pending', denialReason: '' };
  if (body.amount !== undefined) update.amount = Number(body.amount);
  if (body.method) update.method = String(body.method).toLowerCase();
  if (body.transactionId !== undefined) update.transactionId = body.transactionId;
  if (body.note !== undefined) update.note = body.note;

  await db.collection('savingRequests').updateOne({ _id: id }, { $set: update });
  return { message: 'Request updated and resubmitted for review' };
}

async function confirmRequest(requestId, actor) {
  const result = await withTransaction(async (session, db) => {
    const id = new ObjectId(requestId);
    const request = await db.collection('savingRequests').findOne({ _id: id }, { session });
    if (!request) {
      const err = new Error('Request not found');
      err.status = 404;
      throw err;
    }
    if (request.status !== 'pending') {
      const err = new Error('Request is not pending');
      err.status = 400;
      throw err;
    }

    await db.collection('savingRequests').updateOne(
      { _id: id },
      {
        $set: {
          status: 'confirmed',
          confirmedBy: new ObjectId(actor._id),
          confirmedAt: new Date(),
          updatedAt: new Date(),
        },
      },
      { session }
    );

    const fund = await fundService.getOrCreateFund(db, session);
    const newBalance = fund.balance + request.amount;

    await db.collection('fund').updateOne(
      { _id: fund._id },
      {
        $inc: { balance: request.amount, totalSavedAllTime: request.amount },
        $set: { updatedAt: new Date() },
      },
      { session }
    );

    await db.collection('users').updateOne(
      { _id: request.memberId },
      { $inc: { totalSaved: request.amount }, $set: { updatedAt: new Date() } },
      { session }
    );

    await fundService.recordFundChange(
      db,
      {
        type: 'saving_confirmed',
        amount: request.amount,
        referenceId: id,
        referenceType: 'savingRequest',
        performedBy: actor._id,
        note: `Confirmed saving from ${request.memberName} via ${request.method}`,
        balanceAfter: newBalance,
      },
      session
    );

    await writeAudit({
      action: 'saving.confirmed',
      actorId: actor._id,
      actorName: actor.name,
      actorRole: actor.role,
      targetType: 'savingRequest',
      targetId: id,
      after: { amount: request.amount, newBalance },
      session,
    });

    return { request, newBalance };
  });

  if (templates.savingConfirmed) {
    const tmpl = templates.savingConfirmed(result.request.memberName, result.request.amount);
    await sendEmail({ to: result.request.memberEmail, ...tmpl });
  }
  await createNotification({
    userId: result.request.memberId,
    title: 'Saving confirmed',
    body: `৳${result.request.amount.toLocaleString()} added to the fund`,
    type: 'saving',
    link: '/member/savings',
  });

  return {
    message: `Saving of ৳${result.request.amount.toLocaleString()} confirmed and added to fund.`,
    newBalance: result.newBalance,
  };
}

async function denyRequest(requestId, actor, reason) {
  if (!reason || String(reason).trim().length < 3) {
    const err = new Error('A denial reason is required');
    err.status = 400;
    throw err;
  }

  const db = getDB();
  const id = new ObjectId(requestId);
  const request = await db.collection('savingRequests').findOne({ _id: id });
  if (!request) {
    const err = new Error('Request not found');
    err.status = 404;
    throw err;
  }
  if (request.status !== 'pending') {
    const err = new Error('Request is not pending');
    err.status = 400;
    throw err;
  }

  await db.collection('savingRequests').updateOne(
    { _id: id },
    { $set: { status: 'denied', denialReason: reason, updatedAt: new Date() } }
  );

  if (templates.savingDenied) {
    const tmpl = templates.savingDenied(request.memberName, request.amount, reason);
    await sendEmail({ to: request.memberEmail, ...tmpl });
  }
  await createNotification({
    userId: request.memberId,
    title: 'Saving request denied',
    body: reason,
    type: 'saving',
    link: '/member/savings',
  });

  await writeAudit({
    action: 'saving.denied',
    actorId: actor._id,
    actorName: actor.name,
    actorRole: actor.role,
    targetType: 'savingRequest',
    targetId: id,
    after: { reason },
  });

  return { message: 'Request denied and member notified' };
}

async function listRequests(user, { status } = {}) {
  const db = getDB();
  const filter = user.role === 'manager' ? {} : { memberId: new ObjectId(user._id) };
  if (status) filter.status = status;
  return db.collection('savingRequests').find(filter).sort({ createdAt: -1 }).toArray();
}

module.exports = {
  createRequest,
  updateRequest,
  confirmRequest,
  denyRequest,
  listRequests,
};
