const loanService = require('../services/loanService');

const handle = (fn) => async (req, res) => {
  try {
    const data = await fn(req, res);
    if (data !== undefined && !res.headersSent) {
      // functions return payloads; controllers that already sent response skip this
    }
  } catch (error) {
    console.error(error);
    const status = error.status || 500;
    res.status(status).json({ success: false, message: error.message || 'Server error' });
  }
};

exports.apply = async (req, res) => {
  try {
    const result = await loanService.applyLoan(req.user, req.body);
    res.status(201).json({
      success: true,
      message: 'Loan application submitted. Manager will start voting soon.',
      loanId: result.loanId,
    });
  } catch (error) {
    console.error(error);
    res.status(error.status || 500).json({ success: false, message: error.message || 'Server error' });
  }
};

exports.startVoting = async (req, res) => {
  try {
    const result = await loanService.startVoting(req.params.id, req.user);
    res.json({ success: true, ...result });
  } catch (error) {
    console.error(error);
    res.status(error.status || 500).json({ success: false, message: error.message || 'Server error' });
  }
};

exports.vote = async (req, res) => {
  try {
    const current = await loanService.castVote(req.params.id, req.user, req.body.vote);
    res.json({ success: true, message: `Vote recorded: ${req.body.vote.toUpperCase()}`, current });
  } catch (error) {
    console.error(error);
    res.status(error.status || 500).json({ success: false, message: error.message || 'Server error' });
  }
};

exports.finalizeVoting = async (req, res) => {
  try {
    const result = await loanService.finalizeVoting(req.params.id, req.user);
    res.json({ success: true, ...result });
  } catch (error) {
    console.error(error);
    res.status(error.status || 500).json({ success: false, message: error.message || 'Server error' });
  }
};

exports.openReVote = async (req, res) => {
  try {
    const result = await loanService.openReVote(req.params.id, req.user);
    res.json({ success: true, ...result });
  } catch (error) {
    console.error(error);
    res.status(error.status || 500).json({ success: false, message: error.message || 'Server error' });
  }
};

exports.disburse = async (req, res) => {
  try {
    const result = await loanService.disburseLoan(req.params.id, req.user, req.body);
    res.json({ success: true, ...result });
  } catch (error) {
    console.error(error);
    res.status(error.status || 500).json({ success: false, message: error.message || 'Server error' });
  }
};

exports.confirmReceipt = async (req, res) => {
  try {
    const result = await loanService.confirmReceipt(req.params.id, req.user, req.body);
    res.json({ success: true, ...result });
  } catch (error) {
    console.error(error);
    res.status(error.status || 500).json({ success: false, message: error.message || 'Server error' });
  }
};

exports.repay = async (req, res) => {
  try {
    const result = await loanService.repayLoan(req.params.id, req.user, req.body);
    res.json({ success: true, ...result });
  } catch (error) {
    console.error(error);
    res.status(error.status || 500).json({ success: false, message: error.message || 'Server error' });
  }
};

exports.listLoans = async (req, res) => {
  try {
    const loans = await loanService.listLoans(req.user, { status: req.query.status });
    res.json({ success: true, loans });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

exports.getLoan = async (req, res) => {
  try {
    const loan = await loanService.getLoan(req.params.id, req.user);
    res.json({ success: true, loan });
  } catch (error) {
    console.error(error);
    res.status(error.status || 500).json({ success: false, message: error.message || 'Server error' });
  }
};
