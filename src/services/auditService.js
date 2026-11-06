const { getDB } = require('../config/db');
const { ObjectId } = require('mongodb');

/**
 * Immutable audit log for every sensitive action.
 */
async function writeAudit({
  action,
  actorId,
  actorName,
  actorRole,
  targetType,
  targetId,
  before,
  after,
  meta,
  ip,
  session,
}) {
  const db = getDB();
  const doc = {
    action,
    actorId: actorId ? new ObjectId(actorId) : null,
    actorName: actorName || null,
    actorRole: actorRole || null,
    targetType: targetType || null,
    targetId: targetId ? (typeof targetId === 'string' ? new ObjectId(targetId) : targetId) : null,
    before: before || null,
    after: after || null,
    meta: meta || {},
    ip: ip || null,
    createdAt: new Date(),
  };

  const opts = session ? { session } : {};
  await db.collection('auditLogs').insertOne(doc, opts);
  return doc;
}

async function listAudit({ limit = 50, skip = 0, action, actorId } = {}) {
  const db = getDB();
  const filter = {};
  if (action) filter.action = action;
  if (actorId) filter.actorId = new ObjectId(actorId);

  const [items, total] = await Promise.all([
    db
      .collection('auditLogs')
      .find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(Math.min(limit, 200))
      .toArray(),
    db.collection('auditLogs').countDocuments(filter),
  ]);

  return { items, total };
}

module.exports = { writeAudit, listAudit };
