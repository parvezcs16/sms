const express = require('express');
const bcrypt = require('bcryptjs');
const { getDb } = require('../db/connection');
const asyncHandler = require('../utils/asyncHandler');
const { requireAuth, requireRole, ROLE_GROUPS } = require('../middleware/auth');
const { recordAudit } = require('../middleware/audit');
const { requireAccess, requireAccessAny, hasAccess, isManagement } = require('../middleware/permissions');
const { HttpError } = require('../middleware/errors');
const { upload } = require('../middleware/upload');
const ids = require('../utils/ids');
const employment = require('../services/employment');
const { buildPartialUpdate } = require('../utils/partialUpdate');
const { assertImage, removeUpload } = require('../utils/photos');

const router = express.Router();
router.use(requireAuth);

router.get('/', requireAccess(['teachers', 'payroll', 'academics', 'timetable', 'attendance'], 'view'), asyncHandler(async (req, res) => {
  const db = getDb();
  const { search = '', page = 1, limit = 20, includeArchived = 'false' } = req.query;
  const q = `%${search}%`;
  const offset = (Number(page) - 1) * Number(limit);
  const archivedFilter = includeArchived === 'true' ? '' : 'AND t.archived = 0';
  const rows = db.prepare(
    `SELECT t.* FROM teachers t
     WHERE (t.full_name LIKE ? OR t.teacher_code LIKE ? OR t.email LIKE ?) ${archivedFilter}
     ORDER BY t.id DESC LIMIT ? OFFSET ?`
  ).all(q, q, q, Number(limit), offset);
  const total = db.prepare(
    `SELECT COUNT(*) AS c FROM teachers t WHERE (t.full_name LIKE ? OR t.teacher_code LIKE ? OR t.email LIKE ?) ${archivedFilter}`
  ).get(q, q, q).c;
  res.json({ rows, pagination: { page: Number(page), limit: Number(limit), total } });
}));

// ID cards: ?ids=1,2 for some, or everyone active.
router.get('/id-cards.pdf', requireAccess('teachers', 'view'), asyncHandler(async (req, res) => {
  const ids = String(req.query.ids || '').split(',').map(Number).filter(Boolean);
  const { count, buffer } = await require('../services/employeeCards').employeeIdCards(getDb(), 'teacher', ids);
  if (!count) throw new HttpError(404, 'No active teachers to print');
  require('../services/pdf').sendPdf(res, 'teacher-id-cards.pdf', buffer);
}));

router.get('/:id(\\d+)', asyncHandler(async (req, res) => {
  const db = getDb();
  const teacher = db.prepare('SELECT * FROM teachers WHERE id = ?').get(req.params.id);
  if (!teacher) throw new HttpError(404, 'Teacher not found');
  const assignments = db.prepare(
    `SELECT cst.*, sub.name AS subject_name, sec.name AS section_name, c.name AS class_name
     FROM class_subject_teachers cst
     JOIN subjects sub ON sub.id = cst.subject_id
     JOIN sections sec ON sec.id = cst.section_id
     JOIN classes c ON c.id = sec.class_id
     WHERE cst.teacher_id = ?`
  ).all(req.params.id);
  const leaves = db.prepare('SELECT * FROM teacher_leaves WHERE teacher_id = ? ORDER BY applied_at DESC').all(req.params.id);
  res.json({ ...teacher, assignments, leaves });
}));

router.post('/', requireAccess('teachers', 'manage'), asyncHandler(async (req, res) => {
  const db = getDb();
  const { full_name, father_name, gender, date_of_birth, email, phone, address, qualification, designation, employment_type, hire_date, create_login, username, password } = req.body;
  if (!full_name) throw new HttpError(400, 'full_name is required');

  let userId = null;
  if (create_login) {
    if (!username || !password) throw new HttpError(400, 'username and password are required to create a login');
    const roleRow = db.prepare('SELECT id FROM roles WHERE name = ?').get('teacher');
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

  const code = ids.teacherCode(db);
  const result = db.prepare(
    `INSERT INTO teachers (user_id, teacher_code, full_name, father_name, gender, date_of_birth, email, phone, address, qualification, designation, employment_type, hire_date)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, date('now', 'localtime')))`
  ).run(userId, code, full_name, father_name || null, gender || null, date_of_birth || null, email || null, phone || null, address || null, qualification || null, designation || null, employment_type || 'Full-time', hire_date || null);

  recordAudit(req, 'create', 'teacher', Number(result.lastInsertRowid), { full_name });
  res.status(201).json({ id: Number(result.lastInsertRowid), teacher_code: code });
}));

const TEACHER_FIELDS = ['full_name', 'father_name', 'gender', 'date_of_birth', 'email', 'phone', 'address', 'qualification', 'designation', 'employment_type', 'hire_date', 'status'];

router.put('/:id(\\d+)', requireAccess('teachers', 'manage'), asyncHandler(async (req, res) => {
  const db = getDb();
  const body = req.body || {};
  const teacher = db.prepare('SELECT id, user_id FROM teachers WHERE id = ?').get(req.params.id);
  if (!teacher) throw new HttpError(404, 'Teacher not found');
  if (Object.prototype.hasOwnProperty.call(body, 'full_name') && !String(body.full_name || '').trim()) {
    throw new HttpError(400, 'full_name cannot be empty');
  }
  const { sql, values } = buildPartialUpdate('teachers', TEACHER_FIELDS, body, ['full_name', 'status', 'employment_type']);
  if (sql) db.prepare(`${sql}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(...values, teacher.id);
  // Keep the linked login's display name / contact details in step.
  if (teacher.user_id) {
    const u = buildPartialUpdate('users', ['full_name', 'email', 'phone'], body, ['full_name']);
    if (u.sql) db.prepare(`${u.sql} WHERE id = ?`).run(...u.values, teacher.user_id);
  }
  recordAudit(req, 'update', 'teacher', Number(req.params.id), { fields: Object.keys(body) });
  res.json({ success: true });
}));

router.delete('/:id(\\d+)', requireAccess('teachers', 'manage'), asyncHandler(async (req, res) => {
  getDb().prepare(`UPDATE teachers SET archived = 1, status = 'Inactive' WHERE id = ?`).run(req.params.id);
  recordAudit(req, 'archive', 'teacher', Number(req.params.id));
  res.json({ success: true });
}));

router.post('/:id(\\d+)/photo', requireAccess('teachers', 'manage'), upload.single('photo'), asyncHandler(async (req, res) => {
  if (!req.file) throw new HttpError(400, 'photo file is required');
  if (!assertImage(req.file)) throw new HttpError(400, 'Photo must be a JPG, PNG, GIF or WEBP image');
  const db = getDb();
  const existing = db.prepare('SELECT photo_path FROM teachers WHERE id = ?').get(req.params.id);
  if (!existing) {
    removeUpload(req.file.filename);
    throw new HttpError(404, 'Teacher not found');
  }
  db.prepare('UPDATE teachers SET photo_path = ? WHERE id = ?').run(req.file.filename, req.params.id);
  removeUpload(existing.photo_path);
  recordAudit(req, 'update_photo', 'teacher', Number(req.params.id));
  res.json({ success: true, file: req.file.filename });
}));

router.delete('/:id(\\d+)/photo', requireAccess('teachers', 'manage'), asyncHandler(async (req, res) => {
  const db = getDb();
  const existing = db.prepare('SELECT photo_path FROM teachers WHERE id = ?').get(req.params.id);
  if (!existing) throw new HttpError(404, 'Teacher not found');
  db.prepare('UPDATE teachers SET photo_path = NULL WHERE id = ?').run(req.params.id);
  removeUpload(existing.photo_path);
  res.json({ success: true });
}));

// ---- Leave management ----
router.post('/:id(\\d+)/leaves', asyncHandler(async (req, res) => {
  const { leave_type, start_date, end_date, reason } = req.body;
  if (!leave_type || !start_date || !end_date) throw new HttpError(400, 'leave_type, start_date and end_date are required');
  const result = getDb().prepare(
    'INSERT INTO teacher_leaves (teacher_id, leave_type, start_date, end_date, reason) VALUES (?, ?, ?, ?, ?)'
  ).run(req.params.id, leave_type, start_date, end_date, reason || null);
  recordAudit(req, 'apply_leave', 'teacher_leave', Number(result.lastInsertRowid));
  res.status(201).json({ id: Number(result.lastInsertRowid) });
}));

router.put('/leaves/:leaveId/decision', requireAccess('teachers', 'manage'), asyncHandler(async (req, res) => {
  const { status } = req.body; // 'Approved' | 'Rejected'
  if (!['Approved', 'Rejected'].includes(status)) throw new HttpError(400, 'status must be Approved or Rejected');
  getDb().prepare(
    'UPDATE teacher_leaves SET status = ?, decided_by = ?, decided_at = CURRENT_TIMESTAMP WHERE id = ?'
  ).run(status, req.user.id, req.params.leaveId);
  recordAudit(req, 'decide_leave', 'teacher_leave', Number(req.params.leaveId), { status });
  res.json({ success: true });
}));

router.get('/leaves/all', requireAccess('teachers', 'view'), asyncHandler(async (req, res) => {
  const db = getDb();
  const { status = '' } = req.query;
  const rows = db.prepare(
    `SELECT tl.*, t.full_name AS teacher_name, t.teacher_code
     FROM teacher_leaves tl JOIN teachers t ON t.id = tl.teacher_id
     WHERE (? = '' OR tl.status = ?) ORDER BY tl.applied_at DESC`
  ).all(status, status);
  res.json(rows);
}));

// ---- Relieve / re-join ----
router.post('/:id(\\d+)/relieve', requireAccess('teachers', 'manage'), asyncHandler(async (req, res) => {
  const result = employment.relieve(getDb(), 'teacher', Number(req.params.id), req.body || {}, req.user.id);
  recordAudit(req, 'relieve', 'teacher', Number(req.params.id), { relieving_date: result.date, reason: req.body.reason });
  res.json({ success: true });
}));

router.post('/:id(\\d+)/rejoin', requireAccess('teachers', 'manage'), asyncHandler(async (req, res) => {
  const result = employment.rejoin(getDb(), 'teacher', Number(req.params.id), req.body || {}, req.user.id);
  recordAudit(req, 'rejoin', 'teacher', Number(req.params.id), { rejoin_date: result.date, kept_salary: result.keptSalary, salary: result.salaryAfter });
  res.json({ success: true, salary: result.salaryAfter });
}));

router.get('/:id(\\d+)/employment-history', asyncHandler(async (req, res) => {
  res.json(employment.history(getDb(), 'teacher', Number(req.params.id)));
}));

module.exports = router;
