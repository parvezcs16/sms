const express = require('express');
const bcrypt = require('bcryptjs');
const { getDb } = require('../db/connection');
const asyncHandler = require('../utils/asyncHandler');
const { requireAuth, requireRole, ROLE_GROUPS } = require('../middleware/auth');
const { recordAudit } = require('../middleware/audit');
const { requireAccess, isManagement, requireManagement, MODULES, MODULE_KEYS, RANK, ROLE_DEFAULTS, MANAGEMENT_ROLES, roleDefaults, getEffectivePermissions } = require('../middleware/permissions');
const { HttpError } = require('../middleware/errors');

const router = express.Router();
router.use(requireAuth);

router.get('/', requireAccess('users', 'manage'), asyncHandler(async (req, res) => {
  const db = getDb();
  const { search = '', role = '', include_archived = 'false' } = req.query;
  const q = `%${search}%`;
  const archivedFilter = include_archived === 'true' ? '' : 'AND u.archived_at IS NULL';
  const rows = db.prepare(
    `SELECT u.id, u.username, u.full_name, u.email, u.phone, u.is_active, u.last_login_at, u.archived_at, r.name AS role,
            t.id AS teacher_id, st.id AS staff_id, (SELECT COUNT(*) FROM user_permissions up WHERE up.user_id = u.id) AS custom_permissions
     FROM users u JOIN roles r ON r.id = u.role_id
     LEFT JOIN teachers t ON t.user_id = u.id
     LEFT JOIN staff st ON st.user_id = u.id
     WHERE (u.full_name LIKE ? OR u.username LIKE ?) AND (? = '' OR r.name = ?) ${archivedFilter}
     ORDER BY u.id DESC`
  ).all(q, q, role, role);
  res.json(rows);
}));

router.get('/roles', asyncHandler(async (req, res) => {
  const db = getDb();
  res.json(db.prepare('SELECT id, name FROM roles ORDER BY id').all());
}));

router.post('/', requireAccess('users', 'manage'), asyncHandler(async (req, res) => {
  const { username, password, role, full_name, email, phone } = req.body;
  if (!username || !password || !role || !full_name) throw new HttpError(400, 'username, password, role and full_name are required');
  const db = getDb();
  const roleRow = db.prepare('SELECT id FROM roles WHERE name = ?').get(role);
  if (!roleRow) throw new HttpError(400, 'Unknown role');
  if (MANAGEMENT_ROLES.includes(role) && !isManagement(req.user)) throw new HttpError(403, 'Only an Admin, Principal or Super Admin can create an Admin / Principal / Super Admin account');
  const hash = bcrypt.hashSync(password, 10);
  try {
    const result = db.prepare(
      `INSERT INTO users (username, password_hash, role_id, full_name, email, phone, must_change_password) VALUES (?, ?, ?, ?, ?, ?, 1)`
    ).run(username, hash, roleRow.id, full_name, email || null, phone || null);
    recordAudit(req, 'create', 'user', Number(result.lastInsertRowid), { username, role });
    res.status(201).json({ id: Number(result.lastInsertRowid) });
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) throw new HttpError(409, 'Username already exists');
    throw err;
  }
}));

// Only the fields sent are changed (toggling "active" used to wipe the email
// and phone, because they weren't included in that request).
router.put('/:id', requireAccess('users', 'manage'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const db = getDb();
  const body = req.body || {};
  const target = db.prepare('SELECT u.*, r.name AS role FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ?').get(id);
  if (!target) throw new HttpError(404, 'User not found');

  const sets = [];
  const values = [];
  const setField = (col, v) => { sets.push(`${col} = ?`); values.push(v); };
  if (Object.prototype.hasOwnProperty.call(body, 'full_name')) {
    if (!String(body.full_name || '').trim()) throw new HttpError(400, 'Full name cannot be empty');
    setField('full_name', String(body.full_name).trim());
  }
  if (Object.prototype.hasOwnProperty.call(body, 'email')) setField('email', body.email ? String(body.email).trim() : null);
  if (Object.prototype.hasOwnProperty.call(body, 'phone')) setField('phone', body.phone ? String(body.phone).trim() : null);
  if (Object.prototype.hasOwnProperty.call(body, 'username')) {
    const username = String(body.username || '').trim();
    if (!username) throw new HttpError(400, 'Username cannot be empty');
    setField('username', username);
  }
  if (body.is_active !== undefined) {
    if (id === req.user.id && !body.is_active) throw new HttpError(400, 'You cannot deactivate your own account');
    setField('is_active', Number(Boolean(body.is_active)));
  }
  if (body.role && body.role !== target.role) {
    const roleRow = db.prepare('SELECT id FROM roles WHERE name = ?').get(body.role);
    if (!roleRow) throw new HttpError(400, 'Unknown role');
    if ((MANAGEMENT_ROLES.includes(body.role) || MANAGEMENT_ROLES.includes(target.role)) && !isManagement(req.user)) {
      throw new HttpError(403, 'Only an Admin, Principal or Super Admin can change an Admin / Principal / Super Admin role');
    }
    if (body.role === 'super_admin' && req.user.role !== 'super_admin') throw new HttpError(403, 'Only a Super Admin can grant Super Admin');
    if (target.role === 'super_admin' && req.user.role !== 'super_admin') throw new HttpError(403, 'Only a Super Admin can change a Super Admin');
    setField('role_id', roleRow.id);
  }
  // Never leave the school without an active Super Admin.
  const demoting = target.role === 'super_admin' && ((body.role && body.role !== 'super_admin') || (body.is_active !== undefined && !body.is_active));
  if (demoting) {
    const others = db.prepare(`SELECT COUNT(*) AS c FROM users u JOIN roles r ON r.id = u.role_id WHERE r.name = 'super_admin' AND u.is_active = 1 AND u.id != ?`).get(id).c;
    if (!others) throw new HttpError(400, 'This is the only active Super Admin — create another one first');
  }
  if (sets.length) {
    try {
      db.prepare(`UPDATE users SET ${sets.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(...values, id);
    } catch (err) {
      if (String(err.message).includes('UNIQUE')) throw new HttpError(409, 'Username already exists');
      throw err;
    }
  }
  recordAudit(req, 'update', 'user', id, { fields: Object.keys(body), role: body.role });
  res.json({ success: true });
}));

// "Remove" archives the account: it can no longer sign in and is hidden from
// the list, but it is kept (with everything it did in the audit log) and can
// be restored. Linked teacher/staff/student records are not touched.
router.delete('/:id', requireAccess('users', 'manage'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const db = getDb();
  if (id === req.user.id) throw new HttpError(400, 'You cannot remove your own account');
  const target = db.prepare('SELECT u.*, r.name AS role FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ?').get(id);
  if (!target) throw new HttpError(404, 'User not found');
  if (target.role === 'super_admin') {
    if (req.user.role !== 'super_admin') throw new HttpError(403, 'Only a Super Admin can remove a Super Admin');
    const others = db.prepare(`SELECT COUNT(*) AS c FROM users u JOIN roles r ON r.id = u.role_id WHERE r.name = 'super_admin' AND u.is_active = 1 AND u.archived_at IS NULL AND u.id != ?`).get(id).c;
    if (!others) throw new HttpError(400, 'This is the only active Super Admin — create another one first');
  }
  db.prepare('UPDATE users SET is_active = 0, archived_at = CURRENT_TIMESTAMP, archived_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(req.user.id, id);
  recordAudit(req, 'archive', 'user', id, { username: target.username, role: target.role });
  res.json({ success: true });
}));

router.post('/:id/restore', requireAccess('users', 'manage'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  getDb().prepare('UPDATE users SET is_active = 1, archived_at = NULL, archived_by = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(id);
  recordAudit(req, 'restore', 'user', id);
  res.json({ success: true });
}));

// ---- Per-user permissions (only management can see/change them) ----
router.get('/permissions/modules', asyncHandler(async (req, res) => {
  res.json({ modules: MODULES, roleDefaults: ROLE_DEFAULTS, managementRoles: MANAGEMENT_ROLES });
}));

router.get('/:id/permissions', requireManagement, asyncHandler(async (req, res) => {
  const db = getDb();
  const target = db.prepare('SELECT u.id, u.username, u.full_name, r.name AS role FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ?').get(req.params.id);
  if (!target) throw new HttpError(404, 'User not found');
  const overrides = Object.fromEntries(db.prepare('SELECT module, level FROM user_permissions WHERE user_id = ?').all(target.id).map((r) => [r.module, r.level]));
  res.json({
    user: target,
    fullAccess: MANAGEMENT_ROLES.includes(target.role),
    defaults: roleDefaults(target.role),
    overrides,
    effective: getEffectivePermissions(db, target)
  });
}));

// Body: { permissions: { fees: 'manage', academics: 'view', reports: 'none', ... } }
// A value equal to the role default removes the override (back to default).
router.put('/:id/permissions', requireManagement, asyncHandler(async (req, res) => {
  const db = getDb();
  const target = db.prepare('SELECT u.id, u.username, r.name AS role FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ?').get(req.params.id);
  if (!target) throw new HttpError(404, 'User not found');
  if (MANAGEMENT_ROLES.includes(target.role)) throw new HttpError(400, 'Admin, Principal and Super Admin always have full access');
  const incoming = (req.body && req.body.permissions) || {};
  const defaults = roleDefaults(target.role);
  const before = getEffectivePermissions(db, target);
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const [module, level] of Object.entries(incoming)) {
      if (!MODULE_KEYS.has(module) || RANK[level] === undefined) continue;
      if (level === defaults[module]) {
        db.prepare('DELETE FROM user_permissions WHERE user_id = ? AND module = ?').run(target.id, module);
      } else {
        db.prepare(
          `INSERT INTO user_permissions (user_id, module, level, granted_by) VALUES (?, ?, ?, ?)
           ON CONFLICT(user_id, module) DO UPDATE SET level = excluded.level, granted_by = excluded.granted_by, granted_at = CURRENT_TIMESTAMP`
        ).run(target.id, module, level, req.user.id);
      }
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  const after = getEffectivePermissions(db, target);
  const changes = {};
  Object.keys(after).forEach((m) => { if (after[m] !== before[m]) changes[m] = { from: before[m], to: after[m] }; });
  recordAudit(req, 'update_permissions', 'user', target.id, { changes });
  res.json({ success: true, effective: after });
}));

router.post('/:id/reset-password', requireAccess('users', 'manage'), asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { newPassword } = req.body;
  if (!newPassword || newPassword.length < 6) throw new HttpError(400, 'New password must be at least 6 characters');
  const db = getDb();
  const hash = bcrypt.hashSync(newPassword, 10);
  db.prepare('UPDATE users SET password_hash = ?, must_change_password = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(hash, id);
  recordAudit(req, 'reset_password', 'user', Number(id));
  res.json({ success: true });
}));

module.exports = router;
