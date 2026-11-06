/**
 * Validate required environment variables at startup.
 * Fails fast with a clear message if anything critical is missing.
 */
const required = ['MONGODB_URI', 'JWT_SECRET'];

const optionalDefaults = {
  PORT: '5000',
  NODE_ENV: 'development',
  JWT_EXPIRES_IN: '7d',
  CLIENT_URL: 'http://localhost:3000',
  FUND_ACTION_PASSWORD: '',
  RATE_LIMIT_WINDOW_MS: '900000',
  RATE_LIMIT_MAX: '100',
  AUTH_RATE_LIMIT_MAX: '20',
};

function validateEnv() {
  const missing = required.filter((k) => !process.env[k] || String(process.env[k]).trim() === '');
  if (missing.length) {
    console.error('❌ Missing required environment variables:', missing.join(', '));
    console.error('   Copy .env.example to .env and fill in the values.');
    process.exit(1);
  }

  if (process.env.JWT_SECRET.length < 32) {
    console.warn('⚠️  JWT_SECRET is shorter than 32 characters. Use a stronger secret in production.');
  }

  if (
    process.env.MONGODB_URI.includes('mehedy') ||
    process.env.MONGODB_URI.includes('KXC1je7') ||
    process.env.JWT_SECRET.includes('CVJm1rfHdyF7')
  ) {
    console.error('❌ Detected previously exposed secrets in environment. Rotate them immediately.');
    process.exit(1);
  }

  for (const [key, val] of Object.entries(optionalDefaults)) {
    if (process.env[key] === undefined || process.env[key] === '') {
      process.env[key] = val;
    }
  }

  if (process.env.NODE_ENV === 'production') {
    if (!process.env.FUND_ACTION_PASSWORD || process.env.FUND_ACTION_PASSWORD.includes('change_me')) {
      console.error('❌ FUND_ACTION_PASSWORD must be set to a strong value in production.');
      process.exit(1);
    }
  }

  console.log('✅ Environment validated');
}

module.exports = { validateEnv };
