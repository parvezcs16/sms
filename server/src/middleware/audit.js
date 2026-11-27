const { getDb } = require('../db/connection');

function recordAudit(req, action, entityType, entityId, details) {
  const db = getDb();
  db.prepare(
    `INSERT INTO audit_logs (user_id, username, action, entity_type, entity_id, details_json, ip_address)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    req.user ? req.user.id : null,
    req.user ? req.user.username : 'system',
    action,
    entityType || null,
    entityId || null,
    details ? JSON.stringify(details) : null,
    req.ip || null
  );
}

module.exports = { recordAudit };
