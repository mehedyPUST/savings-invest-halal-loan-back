/**
 * Optional: run once after deploy to create helpful indexes.
 * node src/utils/ensureIndexes.js
 */
require('dotenv').config();
const { connectDB, getDB, closeDB } = require('../config/db');

async function run() {
  await connectDB();
  const db = getDB();

  await db.collection('users').createIndex({ email: 1 }, { unique: true });
  await db.collection('users').createIndex({ role: 1, isActive: 1 });
  await db.collection('loans').createIndex({ memberId: 1, status: 1 });
  await db.collection('loans').createIndex({ status: 1, createdAt: -1 });
  await db.collection('savingRequests').createIndex({ memberId: 1, status: 1 });
  await db.collection('savingRequests').createIndex({ status: 1, createdAt: -1 });
  await db.collection('fundHistory').createIndex({ createdAt: -1 });
  await db.collection('notifications').createIndex({ userId: 1, read: 1, createdAt: -1 });
  await db.collection('auditLogs').createIndex({ createdAt: -1 });
  await db.collection('auditLogs').createIndex({ action: 1, createdAt: -1 });

  console.log('✅ Indexes ensured');
  await closeDB();
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
