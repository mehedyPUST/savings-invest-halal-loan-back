const fundService = require('../services/fundService');
const { writeAudit } = require('../services/auditService');

exports.getFund = async (req, res) => {
  try {
    const fund = await fundService.getOverview();
    res.json({ success: true, fund });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

exports.updateTargets = async (req, res) => {
  try {
    const { targetAmount, targetDate, status } = req.body;
    const fund = await fundService.updateTargets({ targetAmount, targetDate, status });
    await writeAudit({
      action: 'fund.targets_updated',
      actorId: req.user._id,
      actorName: req.user.name,
      actorRole: req.user.role,
      targetType: 'fund',
      after: { targetAmount, targetDate, status },
      ip: req.ip,
    });
    res.json({ success: true, message: 'Fund targets updated', fund });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

exports.getHistory = async (req, res) => {
  try {
    const limit = parseInt(req.query.limit || '100', 10);
    const skip = parseInt(req.query.skip || '0', 10);
    const history = await fundService.getHistory({ limit, skip });
    res.json({ success: true, history });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// Re-export helpers for other modules that still import from controller
exports.getOrCreateFund = fundService.getOrCreateFund;
exports.recordFundChange = fundService.recordFundChange;
