const { MongoClient } = require('mongodb');

let db = null;
let client = null;

const connectDB = async () => {
  try {
    const uri = process.env.MONGODB_URI;
    if (!uri) {
      throw new Error('MONGODB_URI is not defined in environment variables');
    }

    client = new MongoClient(uri, {
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 5000,
    });

    await client.connect();
    db = client.db();
    console.log('✅ MongoDB Native Driver connected successfully');
    return db;
  } catch (error) {
    console.error('❌ MongoDB connection error:', error.message);
    process.exit(1);
  }
};

const getDB = () => {
  if (!db) {
    throw new Error('Database not connected. Call connectDB first.');
  }
  return db;
};

const getClient = () => {
  if (!client) {
    throw new Error('MongoClient not connected.');
  }
  return client;
};

/**
 * Run work inside a MongoDB transaction.
 * Automatically aborts on error and commits on success.
 */
const withTransaction = async (work) => {
  const session = getClient().startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      result = await work(session, getDB());
    });
    return result;
  } finally {
    await session.endSession();
  }
};

const closeDB = async () => {
  if (client) {
    await client.close();
    console.log('MongoDB connection closed');
  }
};

module.exports = { connectDB, getDB, getClient, withTransaction, closeDB };
