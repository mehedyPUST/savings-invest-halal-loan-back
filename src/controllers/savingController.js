const savingService = require('../services/savingService');

exports.createRequest = async (req, res) => {
  try {
    const request = await savingService.createRequest(req.user, req.body);
    res.status(201).json({
      success: true,
      message: 'Saving request submitted. Manager will review shortly.',
      request,
    });
  } catch (error) {
    console.error(error);
    res.status(error.status || 500).json({ success: false, message: error.message || 'Server error' });
  }
};

exports.updateRequest = async (req, res) => {
  try {
    const result = await savingService.updateRequest(req.params.id, req.user, req.body);
    res.json({ success: true, ...result });
  } catch (error) {
    console.error(error);
    res.status(error.status || 500).json({ success: false, message: error.message || 'Server error' });
  }
};

exports.confirmRequest = async (req, res) => {
  try {
    const result = await savingService.confirmRequest(req.params.id, req.user);
    res.json({ success: true, ...result });
  } catch (error) {
    console.error(error);
    res.status(error.status || 500).json({ success: false, message: error.message || 'Server error' });
  }
};

exports.denyRequest = async (req, res) => {
  try {
    const result = await savingService.denyRequest(req.params.id, req.user, req.body.reason);
    res.json({ success: true, ...result });
  } catch (error) {
    console.error(error);
    res.status(error.status || 500).json({ success: false, message: error.message || 'Server error' });
  }
};

exports.listRequests = async (req, res) => {
  try {
    const requests = await savingService.listRequests(req.user, { status: req.query.status });
    res.json({ success: true, requests });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};
