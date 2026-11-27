const express = require('express');
const { getDb } = require('../db/connection');
const asyncHandler = require('../utils/asyncHandler');
const { requireAuth, requireRole, ROLE_GROUPS } = require('../middleware/auth');
const { recordAudit } = require('../middleware/audit');
const { requireAccess, requireAccessAny, hasAccess, isManagement } = require('../middleware/permissions');
const { HttpError } = require('../middleware/errors');
const { buildPartialUpdate } = require('../utils/partialUpdate');
const { friendlyConstraint } = require('../utils/tx');

const router = express.Router();
router.use(requireAuth);

// ---- Subjects ----
router.get('/subjects', asyncHandler(async (req, res) => {
  res.json(getDb().prepare('SELECT * FROM subjects ORDER BY name').all());
}));

router.post('/subjects', requireAccess('academics', 'manage'), asyncHandler(async (req, res) => {
  const { name, code } = req.body;
  if (!name) throw new HttpError(400, 'Subject name is required');
  const result = getDb().prepare('INSERT INTO subjects (name, code) VALUES (?, ?)').run(name, code || null);
  recordAudit(req, 'create', 'subject', Number(result.lastInsertRowid));
  res.status(201).json({ id: Number(result.lastInsertRowid) });
}));

router.put('/subjects/:id', requireAccess('academics', 'manage'), asyncHandler(async (req, res) => {
  const body = req.body || {};
  if (Object.prototype.hasOwnProperty.call(body, 'name') && !String(body.name || '').trim()) throw new HttpError(400, 'Subject name is required');
  const { sql, values } = buildPartialUpdate('subjects', ['name', 'code'], body, ['name']);
  try {
    if (sql) getDb().prepare(`${sql} WHERE id = ?`).run(...values, req.params.id);
  } catch (err) {
    throw friendlyConstraint(err, HttpError, { unique: 'A subject with that name already exists' });
  }
  recordAudit(req, 'update', 'subject', Number(req.params.id), body);
  res.json({ success: true });
}));

router.delete('/subjects/:id', requireAccess('academics', 'manage'), asyncHandler(async (req, res) => {
  try {
    getDb().prepare('DELETE FROM subjects WHERE id = ?').run(req.params.id);
  } catch (err) {
    throw friendlyConstraint(err, HttpError, { foreignKey: 'This subject is used by class assignments, the timetable or the question bank — remove those first' });
  }
  recordAudit(req, 'delete', 'subject', Number(req.params.id));
  res.json({ success: true });
}));

// ---- Rooms ----
router.get('/rooms', asyncHandler(async (req, res) => {
  res.json(getDb().prepare('SELECT * FROM rooms ORDER BY name').all());
}));

router.post('/rooms', requireAccess('academics', 'manage'), asyncHandler(async (req, res) => {
  const { name, capacity } = req.body;
  if (!name) throw new HttpError(400, 'Room name is required');
  const result = getDb().prepare('INSERT INTO rooms (name, capacity) VALUES (?, ?)').run(name, capacity || 40);
  recordAudit(req, 'create', 'room', Number(result.lastInsertRowid));
  res.status(201).json({ id: Number(result.lastInsertRowid) });
}));

router.put('/rooms/:id', requireAccess('academics', 'manage'), asyncHandler(async (req, res) => {
  const body = req.body || {};
  if (Object.prototype.hasOwnProperty.call(body, 'name') && !String(body.name || '').trim()) throw new HttpError(400, 'Room name is required');
  const { sql, values } = buildPartialUpdate('rooms', ['name', 'capacity'], body, ['name']);
  try {
    if (sql) getDb().prepare(`${sql} WHERE id = ?`).run(...values, req.params.id);
  } catch (err) {
    throw friendlyConstraint(err, HttpError, { unique: 'A room with that name already exists' });
  }
  recordAudit(req, 'update', 'room', Number(req.params.id), body);
  res.json({ success: true });
}));

router.delete('/rooms/:id', requireAccess('academics', 'manage'), asyncHandler(async (req, res) => {
  try {
    getDb().prepare('DELETE FROM rooms WHERE id = ?').run(req.params.id);
  } catch (err) {
    throw friendlyConstraint(err, HttpError, { foreignKey: 'This room is used by a section or the timetable — change those first' });
  }
  recordAudit(req, 'delete', 'room', Number(req.params.id));
  res.json({ success: true });
}));

// ---- Classes ----
router.get('/classes', asyncHandler(async (req, res) => {
  res.json(getDb().prepare('SELECT * FROM classes ORDER BY sort_order, name').all());
}));

router.post('/classes', requireAccess('academics', 'manage'), asyncHandler(async (req, res) => {
  const { name, sort_order } = req.body;
  if (!name) throw new HttpError(400, 'Class name is required');
  const result = getDb().prepare('INSERT INTO classes (name, sort_order) VALUES (?, ?)').run(name, sort_order || 0);
  recordAudit(req, 'create', 'class', Number(result.lastInsertRowid));
  res.status(201).json({ id: Number(result.lastInsertRowid) });
}));

router.put('/classes/:id', requireAccess('academics', 'manage'), asyncHandler(async (req, res) => {
  const body = req.body || {};
  if (Object.prototype.hasOwnProperty.call(body, 'name') && !String(body.name || '').trim()) throw new HttpError(400, 'Class name is required');
  const { sql, values } = buildPartialUpdate('classes', ['name', 'sort_order'], body, ['name']);
  try {
    if (sql) getDb().prepare(`${sql} WHERE id = ?`).run(...values, req.params.id);
  } catch (err) {
    throw friendlyConstraint(err, HttpError, { unique: 'A class with that name already exists' });
  }
  recordAudit(req, 'update', 'class', Number(req.params.id), body);
  res.json({ success: true });
}));

router.delete('/classes/:id', requireAccess('academics', 'manage'), asyncHandler(async (req, res) => {
  try {
    getDb().prepare('DELETE FROM classes WHERE id = ?').run(req.params.id);
  } catch (err) {
    throw friendlyConstraint(err, HttpError, { foreignKey: 'This class still has sections, fee structures or other records — remove those first' });
  }
  recordAudit(req, 'delete', 'class', Number(req.params.id));
  res.json({ success: true });
}));

// ---- Sections ----
router.get('/sections', asyncHandler(async (req, res) => {
  const db = getDb();
  const { class_id } = req.query;
  const rows = db.prepare(
    `SELECT sec.*, c.name AS class_name, r.name AS room_name, t.full_name AS class_teacher_name,
            (SELECT COUNT(*) FROM students st WHERE st.section_id = sec.id AND st.archived = 0 AND st.status NOT IN ('Left', 'Graduated')) AS student_count
     FROM sections sec
     JOIN classes c ON c.id = sec.class_id
     LEFT JOIN rooms r ON r.id = sec.room_id
     LEFT JOIN teachers t ON t.id = sec.class_teacher_id
     WHERE (? = '' OR sec.class_id = ?)
     ORDER BY c.sort_order, sec.name`
  ).all(class_id || '', Number(class_id) || 0);
  res.json(rows);
}));

router.post('/sections', requireAccess('academics', 'manage'), asyncHandler(async (req, res) => {
  const { class_id, name, capacity, room_id, class_teacher_id } = req.body;
  if (!class_id || !name) throw new HttpError(400, 'class_id and name are required');
  try {
    const result = getDb().prepare(
      'INSERT INTO sections (class_id, name, capacity, room_id, class_teacher_id) VALUES (?, ?, ?, ?, ?)'
    ).run(class_id, name, capacity || 40, room_id || null, class_teacher_id || null);
    recordAudit(req, 'create', 'section', Number(result.lastInsertRowid));
    res.status(201).json({ id: Number(result.lastInsertRowid) });
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) throw new HttpError(409, 'This section already exists for the class');
    throw err;
  }
}));

router.put('/sections/:id', requireAccess('academics', 'manage'), asyncHandler(async (req, res) => {
  const body = req.body || {};
  if (Object.prototype.hasOwnProperty.call(body, 'name') && !String(body.name || '').trim()) throw new HttpError(400, 'Section name is required');
  const { sql, values } = buildPartialUpdate('sections', ['name', 'capacity', 'room_id', 'class_teacher_id', 'class_id'], body, ['name', 'class_id']);
  try {
    if (sql) getDb().prepare(`${sql} WHERE id = ?`).run(...values, req.params.id);
  } catch (err) {
    throw friendlyConstraint(err, HttpError, { unique: 'This section already exists for the class' });
  }
  recordAudit(req, 'update', 'section', Number(req.params.id), body);
  res.json({ success: true });
}));

router.delete('/sections/:id', requireAccess('academics', 'manage'), asyncHandler(async (req, res) => {
  const db = getDb();
  const students = db.prepare('SELECT COUNT(*) AS c FROM students WHERE section_id = ?').get(req.params.id).c;
  if (students) throw new HttpError(409, `This section has ${students} student record(s) — move them to another section first`);
  try {
    db.prepare('DELETE FROM sections WHERE id = ?').run(req.params.id);
  } catch (err) {
    throw friendlyConstraint(err, HttpError, { foreignKey: 'This section is still used by the timetable, attendance or assignments' });
  }
  recordAudit(req, 'delete', 'section', Number(req.params.id));
  res.json({ success: true });
}));

router.put('/assignments/:id', requireAccess('academics', 'manage'), asyncHandler(async (req, res) => {
  const { teacher_id } = req.body;
  if (!teacher_id) throw new HttpError(400, 'teacher_id is required');
  getDb().prepare('UPDATE class_subject_teachers SET teacher_id = ? WHERE id = ?').run(teacher_id, req.params.id);
  recordAudit(req, 'update', 'assignment', Number(req.params.id), { teacher_id });
  res.json({ success: true });
}));

// ---- Subject-Teacher assignment per section (drives timetable + attendance permission) ----
router.get('/assignments', asyncHandler(async (req, res) => {
  const db = getDb();
  const { section_id, teacher_id } = req.query;
  const rows = db.prepare(
    `SELECT cst.*, sub.name AS subject_name, t.full_name AS teacher_name, sec.name AS section_name, c.name AS class_name
     FROM class_subject_teachers cst
     JOIN subjects sub ON sub.id = cst.subject_id
     JOIN teachers t ON t.id = cst.teacher_id
     JOIN sections sec ON sec.id = cst.section_id
     JOIN classes c ON c.id = sec.class_id
     WHERE (? = '' OR cst.section_id = ?) AND (? = '' OR cst.teacher_id = ?)
     ORDER BY c.sort_order, sec.name, sub.name`
  ).all(section_id || '', Number(section_id) || 0, teacher_id || '', Number(teacher_id) || 0);
  res.json(rows);
}));

router.post('/assignments', requireAccess('academics', 'manage'), asyncHandler(async (req, res) => {
  const { section_id, subject_id, teacher_id } = req.body;
  if (!section_id || !subject_id || !teacher_id) throw new HttpError(400, 'section_id, subject_id and teacher_id are required');
  try {
    const result = getDb().prepare(
      'INSERT INTO class_subject_teachers (section_id, subject_id, teacher_id) VALUES (?, ?, ?)'
    ).run(section_id, subject_id, teacher_id);
    recordAudit(req, 'create', 'assignment', Number(result.lastInsertRowid));
    res.status(201).json({ id: Number(result.lastInsertRowid) });
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) throw new HttpError(409, 'This subject is already assigned for the section');
    throw err;
  }
}));

router.delete('/assignments/:id', requireAccess('academics', 'manage'), asyncHandler(async (req, res) => {
  getDb().prepare('DELETE FROM class_subject_teachers WHERE id = ?').run(req.params.id);
  recordAudit(req, 'delete', 'assignment', Number(req.params.id));
  res.json({ success: true });
}));

module.exports = router;
