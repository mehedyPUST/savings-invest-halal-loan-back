const { getDB } = require('../config/db');
const { ObjectId } = require('mongodb');

async function createNotification({ userId, title, body, type, link, meta, session }) {
  const db = getDB();
  const doc = {
    userId: new ObjectId(userId),
    title,
    body: body || '',
    type: type || 'info', // info | loan | saving | vote | system
    link: link || null,
    meta: meta || {},
    read: false,
    createdAt: new Date(),
  };
  const opts = session ? { session } : {};
  await db.collection('notifications').insertOne(doc, opts);
  return doc;
}

async function notifyMany(userIds, payload, session) {
  if (!userIds || !userIds.length) return;
  const db = getDB();
  const now = new Date();
  const docs = userIds.map((id) => ({
    userId: new ObjectId(id),
    title: payload.title,
    body: payload.body || '',
    type: payload.type || 'info',
    link: payload.link || null,
    meta: payload.meta || {},
    read: false,
    createdAt: now,
  }));
  const opts = session ? { session } : {};
  await db.collection('notifications').insertMany(docs, opts);
}

async function listForUser(userId, { limit = 30, unreadOnly = false } = {}) {
  const db = getDB();
  const filter = { userId: new ObjectId(userId) };
  if (unreadOnly) filter.read = false;
  return db
    .collection('notifications')
    .find(filter)
    .sort({ createdAt: -1 })
    .limit(limit)
    .toArray();
}

async function markRead(userId, notificationId) {
  const db = getDB();
  await db.collection('notifications').updateOne(
    { _id: new ObjectId(notificationId), userId: new ObjectId(userId) },
    { $set: { read: true, readAt: new Date() } }
  );
}

async function markAllRead(userId) {
  const db = getDB();
  await db.collection('notifications').updateMany(
    { userId: new ObjectId(userId), read: false },
    { $set: { read: true, readAt: new Date() } }
  );
}

async function unreadCount(userId) {
  const db = getDB();
  return db.collection('notifications').countDocuments({
    userId: new ObjectId(userId),
    read: false,
  });
}

module.exports = {
  createNotification,
  notifyMany,
  listForUser,
  markRead,
  markAllRead,
  unreadCount,
};
