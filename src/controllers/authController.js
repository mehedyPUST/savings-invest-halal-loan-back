const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { getDB } = require('../config/db');
const { ObjectId } = require('mongodb');
const crypto = require('crypto');
const { sendEmail } = require('../utils/email');
const { writeAudit } = require('../services/auditService');

const generateToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  });
};

const setTokenCookie = (res, token) => {
  const isProd = process.env.NODE_ENV === 'production';
  res.cookie('token', token, {
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? 'none' : 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  });
};

// @desc    Register new member (Manager only creates users in this small coop)
// @route   POST /api/auth/register
exports.register = async (req, res) => {
  try {
    const { name, email, password, phone, monthlySavingAmount, role = 'member' } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ success: false, message: 'Name, email and password are required' });
    }

    const db = getDB();
    const existing = await db.collection('users').findOne({ email: email.toLowerCase() });
    if (existing) {
      return res.status(400).json({ success: false, message: 'Email already registered' });
    }

    // Only allow manager role if no manager exists yet, or if current user is manager
    if (role === 'manager') {
      const managerCount = await db.collection('users').countDocuments({ role: 'manager' });
      if (managerCount > 0 && (!req.user || req.user.role !== 'manager')) {
        return res.status(403).json({ success: false, message: 'Only existing manager can create another manager' });
      }
    }

    const hashedPassword = await bcrypt.hash(password, 12);

    const user = {
      name,
      email: email.toLowerCase(),
      password: hashedPassword,
      phone: phone || '',
      role: role === 'manager' ? 'manager' : 'member',
      monthlySavingAmount: Number(monthlySavingAmount) || 0,
      totalSaved: 0,
      loansTakenThisYear: 0,
      lastLoanYear: null,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const result = await db.collection('users').insertOne(user);

    const token = generateToken(result.insertedId.toString());
    setTokenCookie(res, token);

    res.status(201).json({
      success: true,
      message: 'User registered successfully',
      user: {
        id: result.insertedId,
        name: user.name,
        email: user.email,
        role: user.role,
        monthlySavingAmount: user.monthlySavingAmount,
      },
    });
  } catch (error) {
    console.error('Register error:', error);
    res.status(500).json({ success: false, message: 'Server error during registration' });
  }
};

// @desc    Login
// @route   POST /api/auth/login
exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'Email and password required' });
    }

    const db = getDB();
    const user = await db.collection('users').findOne({ email: email.toLowerCase() });

    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(401).json({ success: false, message: 'Invalid email or password' });
    }

    if (!user.isActive) {
      return res.status(403).json({ success: false, message: 'Account is deactivated. Contact manager.' });
    }

    const token = generateToken(user._id.toString());
    setTokenCookie(res, token);

    res.json({
      success: true,
      message: 'Login successful',
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        monthlySavingAmount: user.monthlySavingAmount,
        totalSaved: user.totalSaved,
      },
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ success: false, message: 'Server error during login' });
  }
};

// @desc    Logout
// @route   POST /api/auth/logout
exports.logout = (req, res) => {
  res.cookie('token', '', {
    httpOnly: true,
    expires: new Date(0),
  });
  res.json({ success: true, message: 'Logged out successfully' });
};

// @desc    Get current logged in user
// @route   GET /api/auth/me
exports.getMe = async (req, res) => {
  try {
    res.json({
      success: true,
      user: {
        id: req.user._id,
        name: req.user.name,
        email: req.user.email,
        role: req.user.role,
        phone: req.user.phone,
        monthlySavingAmount: req.user.monthlySavingAmount,
        totalSaved: req.user.totalSaved,
        loansTakenThisYear: req.user.loansTakenThisYear,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// @desc    Update own profile
// @route   PUT /api/auth/profile
exports.updateProfile = async (req, res) => {
  try {
    const { name, phone, monthlySavingAmount } = req.body;
    const db = getDB();

    const update = { updatedAt: new Date() };
    if (name) update.name = name;
    if (phone !== undefined) update.phone = phone;
    if (monthlySavingAmount !== undefined) update.monthlySavingAmount = Number(monthlySavingAmount);

    await db.collection('users').updateOne(
      { _id: new ObjectId(req.user._id) },
      { $set: update }
    );

    const updated = await db.collection('users').findOne(
      { _id: new ObjectId(req.user._id) },
      { projection: { password: 0 } }
    );

    res.json({ success: true, message: 'Profile updated', user: updated });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};


// @desc    Request password reset
// @route   POST /api/auth/forgot-password
exports.forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ success: false, message: 'Email is required' });
    }

    const db = getDB();
    const user = await db.collection('users').findOne({ email: email.toLowerCase() });

    // Always return success to avoid email enumeration
    if (!user) {
      return res.json({ success: true, message: 'If that email exists, a reset link has been sent.' });
    }

    const resetToken = crypto.randomBytes(32).toString('hex');
    const resetExpires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    await db.collection('users').updateOne(
      { _id: user._id },
      {
        $set: {
          resetPasswordToken: crypto.createHash('sha256').update(resetToken).digest('hex'),
          resetPasswordExpires: resetExpires,
          updatedAt: new Date(),
        },
      }
    );

    const resetUrl = `${process.env.CLIENT_URL}/reset-password?token=${resetToken}`;
    await sendEmail({
      to: user.email,
      subject: 'Password Reset — Cooperative Fund',
      html: `
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
          <h2 style="color:#0f766e;">Reset Your Password</h2>
          <p>Dear ${user.name},</p>
          <p>You requested a password reset. Click the button below (valid for 1 hour):</p>
          <a href="${resetUrl}" style="background:#0f766e;color:white;padding:12px 24px;text-decoration:none;border-radius:6px;display:inline-block;">Reset Password</a>
          <p style="margin-top:16px;font-size:13px;color:#666;">If you did not request this, ignore this email.</p>
        </div>
      `,
    });

    res.json({ success: true, message: 'If that email exists, a reset link has been sent.' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// @desc    Reset password with token
// @route   POST /api/auth/reset-password
exports.resetPassword = async (req, res) => {
  try {
    const { token, password } = req.body;
    if (!token || !password || password.length < 6) {
      return res.status(400).json({ success: false, message: 'Token and password (min 6 chars) are required' });
    }

    const hashedToken = crypto.createHash('sha256').update(token).digest('hex');
    const db = getDB();
    const user = await db.collection('users').findOne({
      resetPasswordToken: hashedToken,
      resetPasswordExpires: { $gt: new Date() },
    });

    if (!user) {
      return res.status(400).json({ success: false, message: 'Invalid or expired reset token' });
    }

    const hashedPassword = await bcrypt.hash(password, 12);
    await db.collection('users').updateOne(
      { _id: user._id },
      {
        $set: { password: hashedPassword, updatedAt: new Date() },
        $unset: { resetPasswordToken: '', resetPasswordExpires: '' },
      }
    );

    await writeAudit({
      action: 'auth.password_reset',
      actorId: user._id,
      actorName: user.name,
      actorRole: user.role,
      targetType: 'user',
      targetId: user._id,
    });

    res.json({ success: true, message: 'Password has been reset. You can now log in.' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// @desc    Change password while logged in
// @route   POST /api/auth/change-password
exports.changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword || newPassword.length < 6) {
      return res.status(400).json({ success: false, message: 'Current and new password (min 6) required' });
    }

    const db = getDB();
    const user = await db.collection('users').findOne({ _id: new ObjectId(req.user._id) });
    if (!user || !(await bcrypt.compare(currentPassword, user.password))) {
      return res.status(401).json({ success: false, message: 'Current password is incorrect' });
    }

    const hashed = await bcrypt.hash(newPassword, 12);
    await db.collection('users').updateOne(
      { _id: user._id },
      { $set: { password: hashed, updatedAt: new Date() } }
    );

    await writeAudit({
      action: 'auth.password_changed',
      actorId: user._id,
      actorName: user.name,
      actorRole: user.role,
      targetType: 'user',
      targetId: user._id,
    });

    res.json({ success: true, message: 'Password changed successfully' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};
