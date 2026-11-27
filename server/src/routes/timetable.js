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

router.get('/periods', asyncHandler(async (req, res) => {
  res.json(getDb().prepare('SELECT * FROM periods ORDER BY order_index').all());
}));

router.post('/periods', requireAccess('timetable', 'manage'), asyncHandler(async (req, res) => {
  const { name, start_time, end_time, order_index } = req.body;
  if (!name || !start_time || !end_time) throw new HttpError(400, 'name, start_time and end_time are required');
  const result = getDb().prepare(
    'INSERT INTO periods (name, start_time, end_time, order_index) VALUES (?, ?, ?, ?)'
  ).run(name, start_time, end_time, order_index || 0);
  res.status(201).json({ id: Number(result.lastInsertRowid) });
}));

router.put('/periods/:id', requireAccess('timetable', 'manage'), asyncHandler(async (req, res) => {
  const body = req.body || {};
  const { sql, values } = buildPartialUpdate('periods', ['name', 'start_time', 'end_time', 'order_index'], body, ['name', 'start_time', 'end_time']);
  if (sql) getDb().prepare(`${sql} WHERE id = ?`).run(...values, req.params.id);
  recordAudit(req, 'update', 'period', Number(req.params.id), body);
  res.json({ success: true });
}));

router.delete('/periods/:id', requireAccess('timetable', 'manage'), asyncHandler(async (req, res) => {
  const used = getDb().prepare('SELECT COUNT(*) AS c FROM timetable_entries WHERE period_id = ?').get(req.params.id).c;
  if (used) throw new HttpError(409, `This period is used in ${used} timetable slot(s) — clear those first`);
  try {
    getDb().prepare('DELETE FROM periods WHERE id = ?').run(req.params.id);
  } catch (err) {
    throw friendlyConstraint(err, HttpError);
  }
  recordAudit(req, 'delete', 'period', Number(req.params.id));
  res.json({ success: true });
}));

// Full grid for a section: 7 days x N periods
router.get('/section/:sectionId', asyncHandler(async (req, res) => {
  const db = getDb();
  const rows = db.prepare(
    `SELECT te.*, sub.name AS subject_name, t.full_name AS teacher_name, r.name AS room_name, p.name AS period_name, p.start_time, p.end_time
     FROM timetable_entries te
     JOIN subjects sub ON sub.id = te.subject_id
     JOIN teachers t ON t.id = te.teacher_id
     LEFT JOIN rooms r ON r.id = te.room_id
     JOIN periods p ON p.id = te.period_id
     WHERE te.section_id = ?
     ORDER BY te.day_of_week, p.order_index`
  ).all(req.params.sectionId);
  res.json(rows);
}));

router.get('/teacher/:teacherId', asyncHandler(async (req, res) => {
  const db = getDb();
  const rows = db.prepare(
    `SELECT te.*, sub.name AS subject_name, sec.name AS section_name, c.name AS class_name, r.name AS room_name, p.name AS period_name, p.start_time, p.end_time
     FROM timetable_entries te
     JOIN subjects sub ON sub.id = te.subject_id
     JOIN sections sec ON sec.id = te.section_id
     JOIN classes c ON c.id = sec.class_id
     LEFT JOIN rooms r ON r.id = te.room_id
     JOIN periods p ON p.id = te.period_id
     WHERE te.teacher_id = ?
     ORDER BY te.day_of_week, p.order_index`
  ).all(req.params.teacherId);
  res.json(rows);
}));

router.post('/', requireAccess('timetable', 'manage'), asyncHandler(async (req, res) => {
  const { section_id, day_of_week, period_id, subject_id, teacher_id, room_id } = req.body;
  if ([section_id, day_of_week, period_id, subject_id, teacher_id].some((v) => v === undefined || v === null)) {
    throw new HttpError(400, 'section_id, day_of_week, period_id, subject_id and teacher_id are required');
  }
  const db = getDb();

  // Conflict checks: teacher and room can't be double-booked for the same day/period.
  const teacherConflict = db.prepare(
    'SELECT id FROM timetable_entries WHERE teacher_id = ? AND day_of_week = ? AND period_id = ? AND section_id != ?'
  ).get(teacher_id, day_of_week, period_id, section_id);
  if (teacherConflict) throw new HttpError(409, 'Teacher is already scheduled for another class in this period');

  if (room_id) {
    const roomConflict = db.prepare(
      'SELECT id FROM timetable_entries WHERE room_id = ? AND day_of_week = ? AND period_id = ? AND section_id != ?'
    ).get(room_id, day_of_week, period_id, section_id);
    if (roomConflict) throw new HttpError(409, 'Room is already booked for another class in this period');
  }

  try {
    const result = db.prepare(
      `INSERT INTO timetable_entries (section_id, day_of_week, period_id, subject_id, teacher_id, room_id)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(section_id, day_of_week, period_id) DO UPDATE SET subject_id = excluded.subject_id, teacher_id = excluded.teacher_id, room_id = excluded.room_id`
    ).run(section_id, day_of_week, period_id, subject_id, teacher_id, room_id || null);
    recordAudit(req, 'upsert', 'timetable_entry', Number(result.lastInsertRowid));
    res.status(201).json({ success: true });
  } catch (err) {
    throw new HttpError(400, err.message);
  }
}));

router.delete('/:id', requireAccess('timetable', 'manage'), asyncHandler(async (req, res) => {
  getDb().prepare('DELETE FROM timetable_entries WHERE id = ?').run(req.params.id);
  recordAudit(req, 'delete', 'timetable_entry', Number(req.params.id));
  res.json({ success: true });
}));

module.exports = router;
