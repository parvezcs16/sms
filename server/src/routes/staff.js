const express = require('express');
const bcrypt = require('bcryptjs');
const { getDb } = require('../db/connection');
const asyncHandler = require('../utils/asyncHandler');
const { localDateStr, assertAttendanceDate } = require('../utils/localDate');
const { requireAuth, requireRole, ROLE_GROUPS } = require('../middleware/auth');
const { recordAudit } = require('../middleware/audit');
const { requireAccess, requireAccessAny, hasAccess, isManagement } = require('../middleware/permissions');
const { HttpError } = require('../middleware/errors');
const { upload } = require('../middleware/upload');
const ids = require('../utils/ids');
const employment = require('../services/employment');
const { buildPartialUpdate } = require('../utils/partialUpdate');
const { assertImage, removeUpload } = require('../utils/photos');
const { friendlyConstraint } = require('../utils/tx');

const router = express.Router();
router.use(requireAuth);

// ---- Categories (Peon, Sweeper, Guard, Tea Boy, Driver, ...) — a real FK
// lookup table rather than free-text, so "which category" is always a valid,
// reportable value instead of whatever string someone typed.
router.get('/categories', asyncHandler(async (req, res) => {
  res.json(getDb().prepare('SELECT * FROM staff_categories ORDER BY name').all());
}));

router.post('/categories', requireAccess('staff', 'manage'), asyncHandler(async (req, res) => {
  const { name } = req.body;
  if (!name) throw new HttpError(400, 'name is required');
  const result = getDb().prepare('INSERT INTO staff_categories (name) VALUES (?)').run(name);
  res.status(201).json({ id: Number(result.lastInsertRowid) });
}));

router.get('/', requireAccess(['staff', 'payroll', 'attendance'], 'view'), asyncHandler(async (req, res) => {
  const db = getDb();
  const { search = '', page = 1, limit = 20, includeArchived = 'false', category_id = '' } = req.query;
  const q = `%${search}%`;
  const offset = (Number(page) - 1) * Number(limit);
  const archivedFilter = includeArchived === 'true' ? '' : 'AND st.archived = 0';
  const rows = db.prepare(
    `SELECT st.*, sc.name AS category_name FROM staff st JOIN staff_categories sc ON sc.id = st.category_id
     WHERE (st.full_name LIKE @q OR st.staff_code LIKE @q OR st.email LIKE @q) ${archivedFilter}
       AND (@category_id = '' OR st.category_id = @category_id)
     ORDER BY st.id DESC LIMIT @limit OFFSET @offset`
  ).all({ q, category_id, limit: Number(limit), offset });
  const total = db.prepare(
    `SELECT COUNT(*) AS c FROM staff st WHERE (st.full_name LIKE @q OR st.staff_code LIKE @q OR st.email LIKE @q) ${archivedFilter}
       AND (@category_id = '' OR st.category_id = @category_id)`
  ).get({ q, category_id }).c;
  res.json({ rows, pagination: { page: Number(page), limit: Number(limit), total } });
}));

// ID cards: ?ids=1,2 for some, or everyone active.
router.get('/id-cards.pdf', requireAccess('staff', 'view'), asyncHandler(async (req, res) => {
  const ids = String(req.query.ids || '').split(',').map(Number).filter(Boolean);
  const { count, buffer } = await require('../services/employeeCards').employeeIdCards(getDb(), 'staff', ids);
  if (!count) throw new HttpError(404, 'No active staff members to print');
  require('../services/pdf').sendPdf(res, 'staff-id-cards.pdf', buffer);
}));

router.get('/:id(\\d+)', asyncHandler(async (req, res) => {
  const db = getDb();
  const member = db.prepare(
    `SELECT st.*, sc.name AS category_name FROM staff st JOIN staff_categories sc ON sc.id = st.category_id WHERE st.id = ?`
  ).get(req.params.id);
  if (!member) throw new HttpError(404, 'Staff member not found');
  const leaves = db.prepare('SELECT * FROM staff_leaves WHERE staff_id = ? ORDER BY applied_at DESC').all(req.params.id);
  res.json({ ...member, leaves });
}));

router.post('/', requireAccess('staff', 'manage'), asyncHandler(async (req, res) => {
  const db = getDb();
  const { full_name, father_name, gender, date_of_birth, category_id, email, phone, address, employment_type, hire_date, create_login, username, password } = req.body;
  if (!full_name) throw new HttpError(400, 'full_name is required');
  if (!category_id) throw new HttpError(400, 'category_id is required');
  const categoryRow = db.prepare('SELECT id FROM staff_categories WHERE id = ?').get(category_id);
  if (!categoryRow) throw new HttpError(400, 'Unknown staff category');

  let userId = null;
  if (create_login) {
    if (!username || !password) throw new HttpError(400, 'username and password are required to create a login');
    // Non-teaching staff get the generic 'staff' login role (view-only access unless
    // an admin grants them something more specific by changing their role later).
    const roleRow = db.prepare('SELECT id FROM roles WHERE name = ?').get('staff');
    const hash = bcrypt.hashSync(password, 10);
    try {
      const userResult = db.prepare(
        'INSERT INTO users (username, password_hash, role_id, full_name, email, phone, must_change_password) VALUES (?, ?, ?, ?, ?, ?, 1)'
      ).run(username, hash, roleRow.id, full_name, email || null, phone || null);
      userId = Number(userResult.lastInsertRowid);
    } catch (err) {
      if (String(err.message).includes('UNIQUE')) throw new HttpError(409, 'Username already exists');
      throw err;
    }
  }

  const code = ids.staffCode(db);
  const result = db.prepare(
    `INSERT INTO staff (user_id, staff_code, full_name, father_name, gender, date_of_birth, category_id, email, phone, address, employment_type, hire_date)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(userId, code, full_name, father_name || null, gender || null, date_of_birth || null, category_id, email || null, phone || null, address || null, employment_type || 'Full-time', hire_date || null);

  recordAudit(req, 'create', 'staff', Number(result.lastInsertRowid), { full_name });
  res.status(201).json({ id: Number(result.lastInsertRowid), staff_code: code });
}));

const STAFF_FIELDS = ['full_name', 'father_name', 'gender', 'date_of_birth', 'category_id', 'email', 'phone', 'address', 'employment_type', 'hire_date', 'status'];

// Only the fields sent are changed (the old version blanked anything missing).
router.put('/:id(\\d+)', requireAccess('staff', 'manage'), asyncHandler(async (req, res) => {
  const db = getDb();
  const body = req.body || {};
  const member = db.prepare('SELECT id, user_id FROM staff WHERE id = ?').get(req.params.id);
  if (!member) throw new HttpError(404, 'Staff member not found');
  if (Object.prototype.hasOwnProperty.call(body, 'full_name') && !String(body.full_name || '').trim()) {
    throw new HttpError(400, 'full_name cannot be empty');
  }
  if (body.category_id && !db.prepare('SELECT id FROM staff_categories WHERE id = ?').get(body.category_id)) {
    throw new HttpError(400, 'Unknown staff category');
  }
  const { sql, values } = buildPartialUpdate('staff', STAFF_FIELDS, body, ['full_name', 'category_id', 'status', 'employment_type']);
  if (sql) db.prepare(`${sql}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(...values, member.id);
  // Give an existing staff member a login later (e.g. so they can check in themselves).
  if (body.create_login && !member.user_id) {
    if (!body.username || !body.password) throw new HttpError(400, 'username and password are required to create a login');
    const current = db.prepare('SELECT full_name, email, phone FROM staff WHERE id = ?').get(member.id);
    const roleRow = db.prepare('SELECT id FROM roles WHERE name = ?').get('staff');
    try {
      const userResult = db.prepare(
        'INSERT INTO users (username, password_hash, role_id, full_name, email, phone, must_change_password) VALUES (?, ?, ?, ?, ?, ?, 1)'
      ).run(body.username, bcrypt.hashSync(body.password, 10), roleRow.id, current.full_name, current.email || null, current.phone || null);
      db.prepare('UPDATE staff SET user_id = ? WHERE id = ?').run(Number(userResult.lastInsertRowid), member.id);
      member.user_id = null; // the new account already has the fresh name / contact
    } catch (err) {
      if (String(err.message).includes('UNIQUE')) throw new HttpError(409, 'Username already exists');
      throw err;
    }
  }
  if (member.user_id) {
    const u = buildPartialUpdate('users', ['full_name', 'email', 'phone'], body, ['full_name']);
    if (u.sql) db.prepare(`${u.sql} WHERE id = ?`).run(...u.values, member.user_id);
  }
  recordAudit(req, 'update', 'staff', Number(req.params.id), { fields: Object.keys(body) });
  res.json({ success: true });
}));

router.delete('/:id(\\d+)', requireAccess('staff', 'manage'), asyncHandler(async (req, res) => {
  getDb().prepare(`UPDATE staff SET archived = 1, status = 'Inactive' WHERE id = ?`).run(req.params.id);
  recordAudit(req, 'archive', 'staff', Number(req.params.id));
  res.json({ success: true });
}));

router.post('/:id(\\d+)/photo', requireAccess('staff', 'manage'), upload.single('photo'), asyncHandler(async (req, res) => {
  if (!req.file) throw new HttpError(400, 'photo file is required');
  if (!assertImage(req.file)) throw new HttpError(400, 'Photo must be a JPG, PNG, GIF or WEBP image');
  const db = getDb();
  const existing = db.prepare('SELECT photo_path FROM staff WHERE id = ?').get(req.params.id);
  if (!existing) {
    removeUpload(req.file.filename);
    throw new HttpError(404, 'Staff member not found');
  }
  db.prepare('UPDATE staff SET photo_path = ? WHERE id = ?').run(req.file.filename, req.params.id);
  removeUpload(existing.photo_path);
  recordAudit(req, 'update_photo', 'staff', Number(req.params.id));
  res.json({ success: true, file: req.file.filename });
}));

router.delete('/:id(\\d+)/photo', requireAccess('staff', 'manage'), asyncHandler(async (req, res) => {
  const db = getDb();
  const existing = db.prepare('SELECT photo_path FROM staff WHERE id = ?').get(req.params.id);
  if (!existing) throw new HttpError(404, 'Staff member not found');
  db.prepare('UPDATE staff SET photo_path = NULL WHERE id = ?').run(req.params.id);
  removeUpload(existing.photo_path);
  res.json({ success: true });
}));

router.put('/categories/:id', requireAccess('staff', 'manage'), asyncHandler(async (req, res) => {
  const name = String(req.body.name || '').trim();
  if (!name) throw new HttpError(400, 'name is required');
  try {
    getDb().prepare('UPDATE staff_categories SET name = ? WHERE id = ?').run(name, req.params.id);
  } catch (err) {
    throw friendlyConstraint(err, HttpError, { unique: 'A category with that name already exists' });
  }
  recordAudit(req, 'update', 'staff_category', Number(req.params.id), { name });
  res.json({ success: true });
}));

// ---- Attendance (simple daily present/absent/leave, marked by an admin — no
// auto-marking, since non-teaching staff don't have "classes" to submit) ----
router.get('/attendance', requireAccess('attendance', 'manage'), asyncHandler(async (req, res) => {
  const db = getDb();
  const { date = localDateStr() } = req.query;
  const rows = db.prepare(
    `SELECT st.id AS staff_id, st.full_name, st.staff_code, sc.name AS category_name, sa.id AS attendance_id, sa.status, sa.remarks, sa.source, sa.marked_at
     FROM staff st
     JOIN staff_categories sc ON sc.id = st.category_id
     LEFT JOIN staff_attendance sa ON sa.staff_id = st.id AND sa.attendance_date = @date
     WHERE st.archived = 0
       AND (st.relieved_on IS NULL OR st.relieved_on >= @date OR sa.id IS NOT NULL)
       AND (st.status != 'Relieved' OR st.relieved_on IS NOT NULL)
     ORDER BY st.full_name`
  ).all({ date });
  res.json(rows);
}));

router.post('/attendance/mark', requireAccess('attendance', 'manage'), asyncHandler(async (req, res) => {
  const { attendance_date, records } = req.body;
  if (!attendance_date || !Array.isArray(records) || !records.length) {
    throw new HttpError(400, 'attendance_date and records[] are required');
  }
  assertAttendanceDate(attendance_date, HttpError);
  const db = getDb();
  const upsert = db.prepare(
    `INSERT INTO staff_attendance (staff_id, attendance_date, status, marked_by, remarks, source)
     VALUES (?, ?, ?, ?, ?, 'manual')
     ON CONFLICT(staff_id, attendance_date) DO UPDATE SET status = excluded.status, marked_by = excluded.marked_by, remarks = excluded.remarks, source = 'manual', marked_at = CURRENT_TIMESTAMP`
  );
  let marked = 0;
  for (const record of records) {
    if (!record.staff_id || !record.status) continue;
    upsert.run(record.staff_id, attendance_date, record.status, req.user.id, record.remarks || null);
    marked += 1;
  }
  recordAudit(req, 'mark_staff_attendance', 'staff', null, { attendance_date, marked });
  res.json({ success: true, marked });
}));

router.get('/:id(\\d+)/attendance', asyncHandler(async (req, res) => {
  const db = getDb();
  const { from, to } = req.query;
  const rows = db.prepare(
    `SELECT * FROM staff_attendance WHERE staff_id = @staffId AND (@from IS NULL OR attendance_date >= @from) AND (@to IS NULL OR attendance_date <= @to)
     ORDER BY attendance_date DESC`
  ).all({ staffId: req.params.id, from: from || null, to: to || null });
  res.json(rows);
}));

// ---- Leave management ----
router.post('/:id(\\d+)/leaves', asyncHandler(async (req, res) => {
  const { leave_type, start_date, end_date, reason } = req.body;
  if (!leave_type || !start_date || !end_date) throw new HttpError(400, 'leave_type, start_date and end_date are required');
  const result = getDb().prepare(
    'INSERT INTO staff_leaves (staff_id, leave_type, start_date, end_date, reason) VALUES (?, ?, ?, ?, ?)'
  ).run(req.params.id, leave_type, start_date, end_date, reason || null);
  recordAudit(req, 'apply_leave', 'staff_leave', Number(result.lastInsertRowid));
  res.status(201).json({ id: Number(result.lastInsertRowid) });
}));

router.put('/leaves/:leaveId/decision', requireAccess('staff', 'manage'), asyncHandler(async (req, res) => {
  const { status } = req.body;
  if (!['Approved', 'Rejected'].includes(status)) throw new HttpError(400, 'status must be Approved or Rejected');
  getDb().prepare(
    'UPDATE staff_leaves SET status = ?, decided_by = ?, decided_at = CURRENT_TIMESTAMP WHERE id = ?'
  ).run(status, req.user.id, req.params.leaveId);
  recordAudit(req, 'decide_leave', 'staff_leave', Number(req.params.leaveId), { status });
  res.json({ success: true });
}));

router.get('/leaves/all', requireAccess('staff', 'view'), asyncHandler(async (req, res) => {
  const db = getDb();
  const { status = '' } = req.query;
  const rows = db.prepare(
    `SELECT sl.*, st.full_name AS staff_name, st.staff_code
     FROM staff_leaves sl JOIN staff st ON st.id = sl.staff_id
     WHERE (? = '' OR sl.status = ?) ORDER BY sl.applied_at DESC`
  ).all(status, status);
  res.json(rows);
}));

// ---- Relieve / re-join ----
router.post('/:id(\\d+)/relieve', requireAccess('staff', 'manage'), asyncHandler(async (req, res) => {
  const result = employment.relieve(getDb(), 'staff', Number(req.params.id), req.body || {}, req.user.id);
  recordAudit(req, 'relieve', 'staff', Number(req.params.id), { relieving_date: result.date, reason: req.body.reason });
  res.json({ success: true });
}));

router.post('/:id(\\d+)/rejoin', requireAccess('staff', 'manage'), asyncHandler(async (req, res) => {
  const result = employment.rejoin(getDb(), 'staff', Number(req.params.id), req.body || {}, req.user.id);
  recordAudit(req, 'rejoin', 'staff', Number(req.params.id), { rejoin_date: result.date, kept_salary: result.keptSalary, salary: result.salaryAfter });
  res.json({ success: true, salary: result.salaryAfter });
}));

router.get('/:id(\\d+)/employment-history', asyncHandler(async (req, res) => {
  res.json(employment.history(getDb(), 'staff', Number(req.params.id)));
}));

module.exports = router;
