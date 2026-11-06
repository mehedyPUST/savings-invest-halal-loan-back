require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');
const morgan = require('morgan');
const { connectDB } = require('./config/db');

const authRoutes = require('./routes/authRoutes');
const fundRoutes = require('./routes/fundRoutes');
const savingRoutes = require('./routes/savingRoutes');
const loanRoutes = require('./routes/loanRoutes');
const userRoutes = require('./routes/userRoutes');

const app = express();
const PORT = process.env.PORT || 5000;

// Security & parsing
app.use(helmet());
app.use(
  cors({
    origin: process.env.CLIENT_URL || 'http://localhost:3000',
    credentials: true,
  })
);
app.use(express.json({ limit: '10kb' }));
app.use(cookieParser());
app.use(morgan('dev'));

// Health
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'Cooperative Fund API is running' });
});

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/fund', fundRoutes);
app.use('/api/savings', savingRoutes);
app.use('/api/loans', loanRoutes);
app.use('/api/users', userRoutes);

// 404
app.use((req, res) => {
  res.status(404).json({ success: false, message: 'Route not found' });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ success: false, message: 'Internal server error' });
});

// Start
const start = async () => {
  await connectDB();
  app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
    console.log(`📧 Email mode: ${process.env.EMAIL_USER ? 'Live' : 'Dev (console only)'}`);
  });
};

start();
