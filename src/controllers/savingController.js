const { getDB } = require('../config/db');
const { ObjectId } = require('mongodb');
const { sendEmail, templates } = require('../utils/email');
const { getOrCreateFund, recordFundChange } = require('./fundController');

// @desc    Member creates a saving placement request
// @route   POST /api/savings/request
exports.createRequest = async (req, res) => {
  try {
    const { amount, method, transactionId, note } = req.body;

    if (!amount || amount <= 0) {
      return res.status(400).json({ success: false, message: 'Valid amount is required' });
    }
    if (!method) {
      return res.status(400).json({ success: false, message: 'Payment method is required (bkash, bank, cash, etc.)' });
    }

    const db = getDB();
    const request = {
      memberId: new ObjectId(req.user._id),
      memberName: req.user.name,
      memberEmail: req.user.email,
      amount: Number(amount),
      method: method.toLowerCase(),
      transactionId: transactionId || '',
      note: note || '',
      status: 'pending', // pending | confirmed | denied | revised
      denialReason: '',
      confirmedBy: null,
      confirmedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const result = await db.collection('savingRequests').insertOne(request);

    // Notify manager(s)
    const managers = await db.collection('users').find({ role: 'manager', isActive: true }).toArray();
    for (const manager of managers) {
      const tmpl = templates.savingRequest(req.user.name, amount, method, transactionId);
      await sendEmail({ to: manager.email, ...tmpl });
    }

    res.status(201).json({
      success: true,
      message: 'Saving request submitted. Manager will review shortly.',
      request: { id: result.insertedId, ...request },
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// @desc    Member updates a denied request
// @route   PUT /api/savings/request/:id
exports.updateRequest = async (req, res) => {
  try {
    const { amount, method, transactionId, note } = req.body;
    const db = getDB();
    const requestId = new ObjectId(req.params.id);

    const existing = await db.collection('savingRequests').findOne({ _id: requestId });
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Request not found' });
    }
    if (existing.memberId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ success: false, message: 'Not your request' });
    }
    if (!['denied', 'pending'].includes(existing.status)) {
      return res.status(400).json({ success: false, message: 'Only pending or denied requests can be updated' });
    }

    const update = {
      amount: amount ? Number(amount) : existing.amount,
      method: method ? method.toLowerCase() : existing.method,
      transactionId: transactionId !== undefined ? transactionId : existing.transactionId,
      note: note !== undefined ? note : existing.note,
      status: 'pending',
      denialReason: '',
      updatedAt: new Date(),
    };

    await db.collection('savingRequests').updateOne({ _id: requestId }, { $set: update });

    // Notify manager again
    const managers = await db.collection('users').find({ role: 'manager', isActive: true }).toArray();
    for (const manager of managers) {
      const tmpl = templates.savingRequest(req.user.name, update.amount, update.method, update.transactionId);
      await sendEmail({
        to: manager.email,
        subject: `Updated Saving Request - ${req.user.name}`,
        html: tmpl.html,
      });
    }

    res.json({ success: true, message: 'Request updated and sent for re-review' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// @desc    Manager confirms a saving request (adds to fund)
// @route   POST /api/savings/confirm/:id
exports.confirmRequest = async (req, res) => {
  try {
    const db = getDB();
    const requestId = new ObjectId(req.params.id);

    const request = await db.collection('savingRequests').findOne({ _id: requestId });
    if (!request) {
      return res.status(404).json({ success: false, message: 'Request not found' });
    }
    if (request.status !== 'pending') {
      return res.status(400).json({ success: false, message: 'Request is not pending' });
    }

    // Update request
    await db.collection('savingRequests').updateOne(
      { _id: requestId },
      {
        $set: {
          status: 'confirmed',
          confirmedBy: new ObjectId(req.user._id),
          confirmedAt: new Date(),
          updatedAt: new Date(),
        },
      }
    );

    // Add to central fund
    const fund = await getOrCreateFund(db);
    const newBalance = fund.balance + request.amount;

    await db.collection('fund').updateOne(
      { _id: fund._id },
      {
        $inc: { balance: request.amount, totalSavedAllTime: request.amount },
        $set: { updatedAt: new Date() },
      }
    );

    // Update member totalSaved
    await db.collection('users').updateOne(
      { _id: request.memberId },
      { $inc: { totalSaved: request.amount }, $set: { updatedAt: new Date() } }
    );

    // History
    await recordFundChange(db, {
      type: 'saving_confirmed',
      amount: request.amount,
      referenceId: requestId,
      referenceType: 'savingRequest',
      performedBy: req.user._id,
      note: `Confirmed saving from ${request.memberName} via ${request.method}`,
      balanceAfter: newBalance,
    });

    // Email member
    const tmpl = templates.savingConfirmed(request.memberName, request.amount);
    await sendEmail({ to: request.memberEmail, ...tmpl });

    res.json({
      success: true,
      message: `Saving of ৳${request.amount.toLocaleString()} confirmed and added to fund.`,
      newBalance,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// @desc    Manager denies a saving request
// @route   POST /api/savings/deny/:id
exports.denyRequest = async (req, res) => {
  try {
    const { reason } = req.body;
    if (!reason || reason.trim().length < 3) {
      return res.status(400).json({ success: false, message: 'A denial reason is required' });
    }

    const db = getDB();
    const requestId = new ObjectId(req.params.id);

    const request = await db.collection('savingRequests').findOne({ _id: requestId });
    if (!request) {
      return res.status(404).json({ success: false, message: 'Request not found' });
    }
    if (request.status !== 'pending') {
      return res.status(400).json({ success: false, message: 'Request is not pending' });
    }

    await db.collection('savingRequests').updateOne(
      { _id: requestId },
      {
        $set: {
          status: 'denied',
          denialReason: reason,
          updatedAt: new Date(),
        },
      }
    );

    const tmpl = templates.savingDenied(request.memberName, request.amount, reason);
    await sendEmail({ to: request.memberEmail, ...tmpl });

    res.json({ success: true, message: 'Request denied and member notified' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// @desc    List requests (manager sees all, member sees own)
// @route   GET /api/savings
exports.listRequests = async (req, res) => {
  try {
    const db = getDB();
    const filter = req.user.role === 'manager' ? {} : { memberId: new ObjectId(req.user._id) };
    const status = req.query.status;
    if (status) filter.status = status;

    const requests = await db
      .collection('savingRequests')
      .find(filter)
      .sort({ createdAt: -1 })
      .toArray();

    res.json({ success: true, requests });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};
