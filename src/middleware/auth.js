const jwt = require('jsonwebtoken');
const { getDB } = require('../config/db');
const { ObjectId } = require('mongodb');

const protect = async (req, res, next) => {
  try {
    const token = req.cookies.token;

    if (!token) {
      return res.status(401).json({ success: false, message: 'Not authorized. Please login.' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const db = getDB();
    const user = await db.collection('users').findOne(
      { _id: new ObjectId(decoded.id) },
      { projection: { password: 0 } }
    );

    if (!user) {
      return res.status(401).json({ success: false, message: 'User no longer exists.' });
    }

    if (!user.isActive) {
      return res.status(403).json({ success: false, message: 'Account is deactivated.' });
    }

    req.user = user;
    next();
  } catch (error) {
    console.error('Auth middleware error:', error.message);
    return res.status(401).json({ success: false, message: 'Invalid or expired token.' });
  }
};

const restrictTo = (...roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: `Access denied. Role '${req.user.role}' is not allowed.`,
      });
    }
    next();
  };
};

// Extra password check for any fund balance changing action
const requireFundPassword = (req, res, next) => {
  const { fundPassword } = req.body;
  if (!fundPassword || fundPassword !== process.env.FUND_ACTION_PASSWORD) {
    return res.status(403).json({
      success: false,
      message: 'Invalid fund action password. This action requires manager authorization password.',
    });
  }
  next();
};

module.exports = { protect, restrictTo, requireFundPassword };
