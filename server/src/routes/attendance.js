const express = require('express');
const { getDb } = require('../db/connection');
const asyncHandler = require('../utils/asyncHandler');
const { localDateStr, assertAttendanceDate } = require('../utils/localDate');
const { requireAuth, requireRole, ROLE_GROUPS } = require('../middleware/auth');
const { recordAudit } = require('../middleware/audit');
const { requireAccess, requireAccessAny, hasAccess, isManagement } = require('../middleware/permissions');
const { HttpError } = require('../middleware/errors');

const router = express.Router();
router.use(requireAuth);

function teacherCanAccessSection(db, teacherId, sectionId) {
  const isClassTeacher = db.prepare('SELECT id FROM sections WHERE id = ? AND class_teacher_id = ?').get(sectionId, teacherId);
  if (isClassTeacher) return true;
  const isSubjectTeacher = db.prepare(
    'SELECT id FROM class_subject_teachers WHERE section_id = ? AND teacher_id = ?'
  ).get(sectionId, teacherId);
  return Boolean(isSubjectTeacher);
}

// Sections a teacher is allowed to mark attendance for.
// What "today" is according to the school server — phones use this instead of
// their own clock.
router.get('/server-date', asyncHandler(async (req, res) => {
  res.json({ date: localDateStr(), time: new Date().toISOString() });
}));

router.get('/my-sections', asyncHandler(async (req, res) => {
  const db = getDb();
  if (!req.user.teacher_id) return res.json([]);
  const rows = db.prepare(
    `SELECT DISTINCT sec.id, sec.name AS section_name, c.name AS class_name
     FROM sections sec
     JOIN classes c ON c.id = sec.class_id
     WHERE sec.class_teacher_id = @teacherId
        OR sec.id IN (SELECT section_id FROM class_subject_teachers WHERE teacher_id = @teacherId)
     ORDER BY c.sort_order, sec.name`
  ).all({ teacherId: req.user.teacher_id });
  res.json(rows);
}));

router.get('/section/:sectionId', asyncHandler(async (req, res) => {
  const db = getDb();
  const { date = localDateStr() } = req.query;
  if (!hasAccess(req, 'attendance', 'manage') && !(req.user.teacher_id && teacherCanAccessSection(db, req.user.teacher_id, req.params.sectionId))) {
    throw new HttpError(403, 'You are not assigned to this class');
  }
  const rows = db.prepare(
    `SELECT s.id AS student_id, s.full_name, s.student_code, s.roll_number, sa.id AS attendance_id, sa.status, sa.remarks, sa.marked_at, sa.corrected_by
     FROM students s
     LEFT JOIN student_attendance sa ON sa.student_id = s.id AND sa.attendance_date = @date
     WHERE s.section_id = @section AND s.archived = 0
       AND (s.status NOT IN ('Left', 'Graduated') OR sa.id IS NOT NULL OR (s.left_on IS NOT NULL AND s.left_on > @date))
     ORDER BY s.roll_number, s.full_name`
  ).all({ date, section: req.params.sectionId });
  res.json(rows);
}));

const STUDENT_STATUSES = ['Present', 'Absent', 'Late', 'Leave'];
const TEACHER_STATUSES = ['Present', 'Absent', 'Late', 'Leave'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function runInTransaction(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    try { db.exec('ROLLBACK'); } catch { /* already rolled back */ }
    throw err;
  }
}

// Saves a whole class roster in one transaction. Safe to call repeatedly with
// the same payload (phones retry queued submissions after a Wi-Fi drop or a
// re-login), because every row is an upsert keyed on (student, date).
router.post('/mark', asyncHandler(async (req, res) => {
  const { section_id, attendance_date, records } = req.body;
  if (!section_id || !attendance_date || !Array.isArray(records) || !records.length) {
    throw new HttpError(400, 'section_id, attendance_date and records[] are required');
  }
  assertAttendanceDate(attendance_date, HttpError);
  const db = getDb();
  // "Attendance" permission = any class (and it overrides a teacher-entered value);
  // otherwise a teacher may mark only the classes assigned to them.
  const canAllClasses = hasAccess(req, 'attendance', 'manage');
  if (!canAllClasses && !req.user.teacher_id) {
    throw new HttpError(403, 'You do not have permission to mark attendance');
  }
  if (!canAllClasses && !teacherCanAccessSection(db, req.user.teacher_id, section_id)) {
    throw new HttpError(403, 'You can only mark attendance for classes assigned to you');
  }
  const isManagement = canAllClasses;

  const inSection = new Set(
    db.prepare(`SELECT id FROM students WHERE section_id = ? AND archived = 0
      AND (status NOT IN ('Left', 'Graduated') OR (left_on IS NOT NULL AND left_on > ?))`).all(section_id, attendance_date).map((r) => r.id)
  );
  const existing = db.prepare('SELECT corrected_by FROM student_attendance WHERE student_id = ? AND attendance_date = ?');
  // Teachers never overwrite a value management has manually corrected; management
  // saving the roster is itself an authoritative correction, so it always applies.
  const upsert = db.prepare(
    `INSERT INTO student_attendance (student_id, section_id, attendance_date, status, marked_by, remarks)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(student_id, attendance_date) DO UPDATE SET
       status = excluded.status, section_id = excluded.section_id, marked_by = excluded.marked_by,
       remarks = excluded.remarks, marked_at = CURRENT_TIMESTAMP`
  );

  const result = runInTransaction(db, () => {
    let marked = 0;
    const skipped = [];
    for (const record of records) {
      const studentId = Number(record.student_id);
      if (!studentId || !STUDENT_STATUSES.includes(record.status)) {
        skipped.push({ student_id: record.student_id, reason: 'invalid' });
        continue;
      }
      if (!inSection.has(studentId)) {
        skipped.push({ student_id: studentId, reason: 'not_in_section' });
        continue;
      }
      const prior = existing.get(studentId, attendance_date);
      if (prior && prior.corrected_by && !isManagement) {
        skipped.push({ student_id: studentId, reason: 'corrected_by_admin' });
        continue;
      }
      upsert.run(studentId, section_id, attendance_date, record.status, req.user.id, record.remarks || null);
      marked += 1;
    }

    // Auto-mark the submitting teacher present for the day (unless an admin already manually corrected it).
    if (req.user.teacher_id && marked > 0) {
      db.prepare(
        `INSERT INTO teacher_attendance (teacher_id, attendance_date, status, source)
         VALUES (?, ?, 'Present', 'auto')
         ON CONFLICT(teacher_id, attendance_date) DO UPDATE SET status = 'Present', marked_at = CURRENT_TIMESTAMP
         WHERE source = 'auto'`
      ).run(req.user.teacher_id, attendance_date);
    }
    return { marked, skipped };
  });

  recordAudit(req, 'mark_attendance', 'section', Number(section_id), { attendance_date, marked: result.marked, skipped: result.skipped.length });
  res.json({ success: true, marked: result.marked, skipped: result.skipped, saved_at: new Date().toISOString() });
}));

router.put('/student/:recordId/correct', requireAccess('attendance', 'manage'), asyncHandler(async (req, res) => {
  const { status, remarks } = req.body;
  if (!status) throw new HttpError(400, 'status is required');
  getDb().prepare(
    `UPDATE student_attendance SET status = ?, remarks = ?, corrected_by = ?, corrected_at = CURRENT_TIMESTAMP WHERE id = ?`
  ).run(status, remarks || null, req.user.id, req.params.recordId);
  recordAudit(req, 'correct_attendance', 'student_attendance', Number(req.params.recordId), { status });
  res.json({ success: true });
}));

router.get('/student/:studentId', asyncHandler(async (req, res) => {
  const db = getDb();
  const { from, to } = req.query;
  const rows = db.prepare(
    `SELECT * FROM student_attendance WHERE student_id = @studentId AND (@from IS NULL OR attendance_date >= @from) AND (@to IS NULL OR attendance_date <= @to)
     ORDER BY attendance_date DESC`
  ).all({ studentId: req.params.studentId, from: from || null, to: to || null });
  res.json(rows);
}));

// ---- Teacher attendance (auto-derived + admin correction) ----
router.get('/teacher/:teacherId', asyncHandler(async (req, res) => {
  const db = getDb();
  const { from, to } = req.query;
  const rows = db.prepare(
    `SELECT * FROM teacher_attendance WHERE teacher_id = @teacherId AND (@from IS NULL OR attendance_date >= @from) AND (@to IS NULL OR attendance_date <= @to)
     ORDER BY attendance_date DESC`
  ).all({ teacherId: req.params.teacherId, from: from || null, to: to || null });
  res.json(rows);
}));

router.put('/teacher/:recordId/correct', requireAccess('attendance', 'manage'), asyncHandler(async (req, res) => {
  const { status } = req.body;
  if (!status) throw new HttpError(400, 'status is required');
  getDb().prepare(
    `UPDATE teacher_attendance SET status = ?, source = 'manual', corrected_by = ?, corrected_at = CURRENT_TIMESTAMP WHERE id = ?`
  ).run(status, req.user.id, req.params.recordId);
  recordAudit(req, 'correct_teacher_attendance', 'teacher_attendance', Number(req.params.recordId), { status });
  res.json({ success: true });
}));

router.post('/teacher/:teacherId/mark', requireAccess('attendance', 'manage'), asyncHandler(async (req, res) => {
  const { attendance_date, status } = req.body;
  if (!attendance_date || !status) throw new HttpError(400, 'attendance_date and status are required');
  getDb().prepare(
    `INSERT INTO teacher_attendance (teacher_id, attendance_date, status, source, corrected_by, corrected_at)
     VALUES (?, ?, ?, 'manual', ?, CURRENT_TIMESTAMP)
     ON CONFLICT(teacher_id, attendance_date) DO UPDATE SET status = excluded.status, source = 'manual', corrected_by = excluded.corrected_by, corrected_at = CURRENT_TIMESTAMP`
  ).run(req.params.teacherId, attendance_date, status, req.user.id);
  recordAudit(req, 'manual_teacher_attendance', 'teacher_attendance', Number(req.params.teacherId), { attendance_date, status });
  res.json({ success: true });
}));

// Roster of all active teachers with their status for one date — lets the
// Principal / Super Admin / Admin mark (or correct) teacher attendance in bulk.
router.get('/teachers', requireAccess('attendance', 'manage'), asyncHandler(async (req, res) => {
  const { date } = req.query;
  if (!date || !DATE_RE.test(date)) throw new HttpError(400, 'date (YYYY-MM-DD) is required');
  const rows = getDb().prepare(
    `SELECT t.id AS teacher_id, t.full_name, t.teacher_code, t.designation, t.photo_path,
            ta.id AS attendance_id, ta.status, ta.source, ta.remarks, ta.marked_at, ta.corrected_at
     FROM teachers t
     LEFT JOIN teacher_attendance ta ON ta.teacher_id = t.id AND ta.attendance_date = @date
     WHERE t.archived = 0
       AND (t.relieved_on IS NULL OR t.relieved_on >= @date OR ta.id IS NOT NULL)
       AND (t.status != 'Relieved' OR t.relieved_on IS NOT NULL)
     ORDER BY t.full_name`
  ).all({ date });
  res.json(rows);
}));

router.post('/teachers/mark', requireAccess('attendance', 'manage'), asyncHandler(async (req, res) => {
  const { attendance_date, records } = req.body;
  if (!attendance_date || !Array.isArray(records) || !records.length) {
    throw new HttpError(400, 'attendance_date (YYYY-MM-DD) and records[] are required');
  }
  assertAttendanceDate(attendance_date, HttpError);
  const db = getDb();
  const upsert = db.prepare(
    `INSERT INTO teacher_attendance (teacher_id, attendance_date, status, source, remarks, corrected_by, corrected_at)
     VALUES (?, ?, ?, 'manual', ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(teacher_id, attendance_date) DO UPDATE SET status = excluded.status, source = 'manual',
       remarks = excluded.remarks, corrected_by = excluded.corrected_by, corrected_at = CURRENT_TIMESTAMP`
  );
  const marked = runInTransaction(db, () => {
    let count = 0;
    for (const record of records) {
      if (!record.teacher_id || !TEACHER_STATUSES.includes(record.status)) continue;
      upsert.run(Number(record.teacher_id), attendance_date, record.status, record.remarks || null, req.user.id);
      count += 1;
    }
    return count;
  });
  recordAudit(req, 'mark_teacher_attendance', 'teacher_attendance', null, { attendance_date, marked });
  res.json({ success: true, marked, saved_at: new Date().toISOString() });
}));

// ---- Self check-in (teachers and non-teaching staff) ----
// The first time a teacher or staff member signs in each day they can mark
// themselves Present. The date always comes from the server clock, and an
// existing record (one the office marked, or an earlier check-in) is never
// overwritten.
function selfProfile(db, user) {
  const teacher = db.prepare('SELECT id, archived, status FROM teachers WHERE id = ? OR user_id = ? LIMIT 1').get(user.teacher_id || -1, user.id);
  if (teacher) return { kind: 'teacher', id: teacher.id, active: !teacher.archived && teacher.status !== 'Relieved', table: 'teacher_attendance', key: 'teacher_id' };
  const member = db.prepare('SELECT id, archived, status FROM staff WHERE user_id = ?').get(user.id);
  if (member) return { kind: 'staff', id: member.id, active: !member.archived && member.status !== 'Relieved', table: 'staff_attendance', key: 'staff_id' };
  return null;
}

function myTodayStatus(db, prof) {
  const today = localDateStr();
  const row = db.prepare(`SELECT id, status, source, marked_at, remarks FROM ${prof.table} WHERE ${prof.key} = ? AND attendance_date = ?`).get(prof.id, today);
  return { kind: prof.kind, date: today, record: row || null };
}

router.get('/me/today', asyncHandler(async (req, res) => {
  const db = getDb();
  const prof = selfProfile(db, req.user);
  if (!prof || !prof.active) return res.json({ applicable: false });
  res.json({ applicable: true, ...myTodayStatus(db, prof) });
}));

router.post('/me/check-in', asyncHandler(async (req, res) => {
  const db = getDb();
  const prof = selfProfile(db, req.user);
  if (!prof) throw new HttpError(400, 'Only a teacher or staff login linked to their profile can check in');
  if (!prof.active) throw new HttpError(400, 'This profile is not active');
  const today = localDateStr();
  const result = prof.kind === 'teacher'
    ? db.prepare(
      `INSERT INTO teacher_attendance (teacher_id, attendance_date, status, source, remarks)
       VALUES (?, ?, 'Present', 'self', 'Self check-in')
       ON CONFLICT(teacher_id, attendance_date) DO NOTHING`
    ).run(prof.id, today)
    : db.prepare(
      `INSERT INTO staff_attendance (staff_id, attendance_date, status, marked_by, remarks, source)
       VALUES (?, ?, 'Present', ?, 'Self check-in', 'self')
       ON CONFLICT(staff_id, attendance_date) DO NOTHING`
    ).run(prof.id, today, req.user.id);
  const created = result.changes > 0;
  if (created) recordAudit(req, 'self_check_in', prof.table, prof.id, { attendance_date: today });
  res.json({ success: true, created, ...myTodayStatus(db, prof), saved_at: new Date().toISOString() });
}));

module.exports = router;
