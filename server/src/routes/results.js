// Student marks (daily tests … annual exams), progress reports and result cards.
//
// Access: management and anyone given "Results" access see everything ("manage"
// can edit everything). A teacher works with the sections they teach: the
// class teacher for any subject of their section, a subject teacher for their
// subject. Parents can download their own children's reports.
const express = require('express');
const path = require('path');
const { getDb } = require('../db/connection');
const config = require('../config');
const asyncHandler = require('../utils/asyncHandler');
const { requireAuth } = require('../middleware/auth');
const { recordAudit } = require('../middleware/audit');
const { hasAccess, isManagement } = require('../middleware/permissions');
const { HttpError } = require('../middleware/errors');
const { runInTransaction } = require('../utils/tx');
const { DATE_RE, localDateStr } = require('../utils/localDate');
const { userDesignation, localDateTimeStr } = require('../utils/people');
const { getBranding, getSetting, setSetting } = require('../services/settings');
const pdfService = require('../services/pdf');
const resultPdf = require('../services/resultPdf');
const notificationService = require('../services/notifications/notificationService');
const R = require('../services/results');

const router = express.Router();
router.use(requireAuth);

// ---------- access helpers ----------
function teacherSectionIds(db, teacherId) {
  if (!teacherId) return new Set();
  return new Set(db.prepare(
    `SELECT id FROM sections WHERE class_teacher_id = @t
     UNION SELECT section_id FROM class_subject_teachers WHERE teacher_id = @t`
  ).all({ t: teacherId }).map((r) => r.id));
}

function canViewSection(req, db, sectionId) {
  if (hasAccess(req, 'results', 'view')) return true;
  return teacherSectionIds(db, req.user.teacher_id).has(Number(sectionId));
}

function canEditMarks(req, db, sectionId, subjectId) {
  if (hasAccess(req, 'results', 'manage')) return true;
  const t = req.user.teacher_id;
  if (!t) return false;
  if (db.prepare('SELECT id FROM sections WHERE id = ? AND class_teacher_id = ?').get(sectionId, t)) return true;
  return Boolean(db.prepare('SELECT id FROM class_subject_teachers WHERE section_id = ? AND subject_id = ? AND teacher_id = ?').get(sectionId, subjectId, t));
}

function isClassTeacher(req, db, sectionId) {
  return Boolean(req.user.teacher_id && db.prepare('SELECT id FROM sections WHERE id = ? AND class_teacher_id = ?').get(sectionId, req.user.teacher_id));
}

function parentOwns(req, db, student) {
  if (req.user.role !== 'parent') return false;
  const p = db.prepare('SELECT id FROM parents WHERE user_id = ?').get(req.user.id);
  return Boolean(p && (student.parent_id === p.id || student.secondary_parent_id === p.id));
}

function loadStudent(db, id) {
  return db.prepare(
    `SELECT s.*, c.name AS class_name, sec.name AS section_name, (c.name || ' - ' || sec.name) AS class_label,
            p.full_name AS parent_name, p.phone AS parent_phone, p.email AS parent_email
     FROM students s
     LEFT JOIN sections sec ON sec.id = s.section_id LEFT JOIN classes c ON c.id = sec.class_id
     LEFT JOIN parents p ON p.id = s.parent_id
     WHERE s.id = ?`
  ).get(id);
}

// Can this user see this student's marks? (any section the student has marks in counts)
function canViewStudent(req, db, student) {
  if (hasAccess(req, 'results', 'view')) return true;
  if (parentOwns(req, db, student)) return true;
  if (req.user.role === 'student') {
    const me = db.prepare('SELECT id FROM students WHERE user_id = ?').get(req.user.id);
    return Boolean(me && me.id === student.id);
  }
  const mine = teacherSectionIds(db, req.user.teacher_id);
  if (!mine.size) return false;
  if (mine.has(student.section_id)) return true;
  return db.prepare('SELECT DISTINCT a.section_id FROM assessment_marks am JOIN assessments a ON a.id = am.assessment_id WHERE am.student_id = ?')
    .all(student.id).some((r) => mine.has(r.section_id));
}

const num = (v) => (v === '' || v === null || v === undefined ? null : Number(v));

// ---------- meta ----------
router.get('/meta', asyncHandler(async (req, res) => {
  const db = getDb();
  const all = hasAccess(req, 'results', 'view');
  const mine = teacherSectionIds(db, req.user.teacher_id);
  if (!all && !mine.size) throw new HttpError(403, "You don't have access to marks and results. Ask an Admin, Principal or Super Admin.");
  const sections = db.prepare(
    `SELECT sec.id, sec.name AS section_name, c.name AS class_name, c.id AS class_id, sec.class_teacher_id
     FROM sections sec JOIN classes c ON c.id = sec.class_id ORDER BY c.sort_order, c.name, sec.name`
  ).all().filter((s) => all || mine.has(s.id));
  const subjects = db.prepare('SELECT id, name FROM subjects ORDER BY name').all();
  // Which subjects a teacher may enter marks for, per section.
  let editable = null;
  if (!hasAccess(req, 'results', 'manage')) {
    editable = {};
    const t = req.user.teacher_id;
    for (const s of sections) {
      if (s.class_teacher_id === t) editable[s.id] = 'all';
      else editable[s.id] = db.prepare('SELECT subject_id FROM class_subject_teachers WHERE section_id = ? AND teacher_id = ?').all(s.id, t).map((r) => r.subject_id);
    }
  }
  const terms = db.prepare('SELECT * FROM exam_terms WHERE archived = 0 ORDER BY COALESCE(start_date, created_at) DESC, id DESC').all();
  res.json({
    kinds: R.ASSESSMENT_KINDS,
    term_kinds: R.TERM_KINDS,
    sections,
    subjects,
    editable,
    terms,
    grading: R.getGrading(db),
    can_manage: hasAccess(req, 'results', 'manage'),
    is_management: isManagement(req.user),
    session: getSetting(db, 'academic_year', '')
  });
}));

// ---------- grading rules ----------
router.put('/grading', asyncHandler(async (req, res) => {
  if (!isManagement(req.user)) throw new HttpError(403, 'Only the Principal, Admin or Super Admin can change the grading rules');
  const { scale, pass_percentage } = req.body || {};
  const db = getDb();
  if (scale !== undefined) {
    if (!Array.isArray(scale) || !scale.length) throw new HttpError(400, 'Add at least one grade');
    const clean = scale.map((s) => ({ min: Number(s.min), grade: String(s.grade || '').trim(), remark: String(s.remark || '').trim() }));
    if (clean.some((s) => !s.grade || !(s.min >= 0 && s.min <= 100))) throw new HttpError(400, 'Each grade needs a name and a minimum % between 0 and 100');
    if (!clean.some((s) => s.min === 0)) throw new HttpError(400, 'One grade must start at 0%');
    setSetting(db, 'grading_scale', JSON.stringify(clean));
  }
  if (pass_percentage !== undefined) {
    const p = Number(pass_percentage);
    if (!(p >= 0 && p <= 100)) throw new HttpError(400, 'Pass percentage must be between 0 and 100');
    setSetting(db, 'pass_percentage', String(p));
  }
  recordAudit(req, 'update', 'grading', null, req.body);
  res.json(R.getGrading(db));
}));

// ---------- terms (exams that produce a result card) ----------
function requireTermAdmin(req) {
  if (!hasAccess(req, 'results', 'manage')) throw new HttpError(403, 'Only staff with Results (manage) access can set up exam terms');
}

router.get('/terms', asyncHandler(async (req, res) => {
  const db = getDb();
  if (!hasAccess(req, 'results', 'view') && !teacherSectionIds(db, req.user.teacher_id).size) throw new HttpError(403, "You don't have access to results");
  res.json(db.prepare(
    `SELECT t.*, (SELECT COUNT(*) FROM assessments a WHERE a.term_id = t.id AND a.archived = 0) AS papers,
            (SELECT COUNT(DISTINCT a.section_id) FROM assessments a WHERE a.term_id = t.id AND a.archived = 0) AS classes,
            (SELECT COUNT(*) FROM result_approvals ra WHERE ra.term_id = t.id) AS approved_classes,
            (SELECT COUNT(*) FROM exam_schedule es WHERE es.term_id = t.id AND es.archived = 0) AS scheduled
     FROM exam_terms t WHERE t.archived = 0 ORDER BY COALESCE(t.start_date, t.created_at) DESC, t.id DESC`
  ).all());
}));

router.post('/terms', asyncHandler(async (req, res) => {
  requireTermAdmin(req);
  const { name, kind = 'Annual', session, start_date, end_date } = req.body || {};
  if (!String(name || '').trim()) throw new HttpError(400, 'Please give the exam a name, e.g. "Annual Examination 2026"');
  if (!R.TERM_KINDS.includes(kind)) throw new HttpError(400, 'Unknown exam type');
  const db = getDb();
  const r = db.prepare('INSERT INTO exam_terms (name, kind, session, start_date, end_date, created_by) VALUES (?, ?, ?, ?, ?, ?)')
    .run(String(name).trim(), kind, session || getSetting(db, 'academic_year', '') || null, start_date || null, end_date || null, req.user.id);
  recordAudit(req, 'create', 'exam_term', Number(r.lastInsertRowid), { name });
  res.status(201).json({ id: Number(r.lastInsertRowid) });
}));

router.put('/terms/:id', asyncHandler(async (req, res) => {
  requireTermAdmin(req);
  const db = getDb();
  const t = db.prepare('SELECT * FROM exam_terms WHERE id = ?').get(req.params.id);
  if (!t) throw new HttpError(404, 'Exam not found');
  const b = req.body || {};
  if (b.kind !== undefined && !R.TERM_KINDS.includes(b.kind)) throw new HttpError(400, 'Unknown exam type');
  db.prepare('UPDATE exam_terms SET name = ?, kind = ?, session = ?, start_date = ?, end_date = ? WHERE id = ?').run(
    b.name !== undefined ? (String(b.name).trim() || t.name) : t.name,
    b.kind ?? t.kind,
    b.session !== undefined ? (b.session || null) : t.session,
    b.start_date !== undefined ? (b.start_date || null) : t.start_date,
    b.end_date !== undefined ? (b.end_date || null) : t.end_date,
    t.id
  );
  recordAudit(req, 'update', 'exam_term', t.id, b);
  res.json({ success: true });
}));

router.delete('/terms/:id', asyncHandler(async (req, res) => {
  requireTermAdmin(req);
  const db = getDb();
  db.prepare('UPDATE exam_terms SET archived = 1 WHERE id = ?').run(req.params.id);
  recordAudit(req, 'archive', 'exam_term', Number(req.params.id));
  res.json({ success: true });
}));

// ---------- assessments (one test of one subject for one section) ----------
router.get('/assessments', asyncHandler(async (req, res) => {
  const db = getDb();
  const { section_id = '', subject_id = '', kind = '', term_id = '', from = '', to = '' } = req.query;
  const all = hasAccess(req, 'results', 'view');
  const mine = teacherSectionIds(db, req.user.teacher_id);
  if (!all && !mine.size) throw new HttpError(403, "You don't have access to marks and results");
  if (section_id && !canViewSection(req, db, section_id)) throw new HttpError(403, 'You are not assigned to this class');
  const rows = db.prepare(
    `SELECT a.*, sub.name AS subject_name, c.name AS class_name, sec.name AS section_name, t.name AS term_name,
            u.full_name AS created_by_name,
            (SELECT COUNT(*) FROM assessment_marks am WHERE am.assessment_id = a.id AND (am.obtained IS NOT NULL OR am.absent = 1)) AS entered,
            (SELECT ROUND(AVG(am.obtained * 100.0 / a.total_marks), 1) FROM assessment_marks am WHERE am.assessment_id = a.id AND am.obtained IS NOT NULL AND am.absent = 0) AS average
     FROM assessments a
     JOIN subjects sub ON sub.id = a.subject_id
     JOIN sections sec ON sec.id = a.section_id JOIN classes c ON c.id = sec.class_id
     LEFT JOIN exam_terms t ON t.id = a.term_id
     LEFT JOIN users u ON u.id = a.created_by
     WHERE a.archived = 0
       AND (@section_id = '' OR a.section_id = @section_id)
       AND (@subject_id = '' OR a.subject_id = @subject_id)
       AND (@kind = '' OR a.kind = @kind)
       AND (@term_id = '' OR a.term_id = @term_id)
       AND (@from = '' OR a.held_on >= @from) AND (@to = '' OR a.held_on <= @to)
     ORDER BY a.held_on DESC, a.id DESC
     LIMIT 500`
  ).all({ section_id, subject_id, kind, term_id, from, to });
  res.json(all ? rows : rows.filter((r) => mine.has(r.section_id)));
}));

function readAssessmentBody(body, existing = {}) {
  const b = { ...existing, ...body };
  const out = {
    kind: String(b.kind || '').trim(),
    title: String(b.title || '').trim(),
    section_id: Number(b.section_id),
    subject_id: Number(b.subject_id),
    term_id: b.term_id ? Number(b.term_id) : null,
    held_on: String(b.held_on || '').trim(),
    total_marks: Number(b.total_marks),
    pass_marks: num(b.pass_marks)
  };
  if (!R.ASSESSMENT_KINDS.includes(out.kind)) throw new HttpError(400, 'Choose the test type');
  if (!out.section_id || !out.subject_id) throw new HttpError(400, 'Choose the class and subject');
  if (!DATE_RE.test(out.held_on)) throw new HttpError(400, 'Choose the test date');
  if (!(out.total_marks > 0)) throw new HttpError(400, 'Total marks must be more than 0');
  if (out.pass_marks !== null && !(out.pass_marks >= 0 && out.pass_marks <= out.total_marks)) throw new HttpError(400, 'Pass marks must be between 0 and the total marks');
  if (!out.title) out.title = out.kind;
  return out;
}

router.post('/assessments', asyncHandler(async (req, res) => {
  const db = getDb();
  const a = readAssessmentBody(req.body || {});
  if (!canEditMarks(req, db, a.section_id, a.subject_id)) throw new HttpError(403, 'You can only add tests for the classes and subjects you teach');
  if (a.term_id && !db.prepare('SELECT id FROM exam_terms WHERE id = ? AND archived = 0').get(a.term_id)) throw new HttpError(400, 'That exam no longer exists');
  const r = db.prepare(
    `INSERT INTO assessments (kind, title, section_id, subject_id, term_id, held_on, total_marks, pass_marks, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(a.kind, a.title, a.section_id, a.subject_id, a.term_id, a.held_on, a.total_marks, a.pass_marks, req.user.id);
  recordAudit(req, 'create', 'assessment', Number(r.lastInsertRowid), a);
  res.status(201).json({ id: Number(r.lastInsertRowid) });
}));

router.put('/assessments/:id', asyncHandler(async (req, res) => {
  const db = getDb();
  const cur = db.prepare('SELECT * FROM assessments WHERE id = ? AND archived = 0').get(req.params.id);
  if (!cur) throw new HttpError(404, 'Test not found');
  if (!canEditMarks(req, db, cur.section_id, cur.subject_id)) throw new HttpError(403, 'You can only change tests for the classes and subjects you teach');
  const a = readAssessmentBody(req.body || {}, cur);
  if (!canEditMarks(req, db, a.section_id, a.subject_id)) throw new HttpError(403, 'You can only move tests to classes and subjects you teach');
  const over = db.prepare('SELECT COUNT(*) AS c FROM assessment_marks WHERE assessment_id = ? AND obtained > ?').get(cur.id, a.total_marks).c;
  if (over) throw new HttpError(400, `${over} student(s) already have more than ${a.total_marks} marks in this test — correct their marks first`);
  db.prepare('UPDATE assessments SET kind = ?, title = ?, section_id = ?, subject_id = ?, term_id = ?, held_on = ?, total_marks = ?, pass_marks = ? WHERE id = ?')
    .run(a.kind, a.title, a.section_id, a.subject_id, a.term_id, a.held_on, a.total_marks, a.pass_marks, cur.id);
  recordAudit(req, 'update', 'assessment', cur.id, { before: cur, after: a });
  res.json({ success: true });
}));

router.delete('/assessments/:id', asyncHandler(async (req, res) => {
  const db = getDb();
  const cur = db.prepare('SELECT * FROM assessments WHERE id = ? AND archived = 0').get(req.params.id);
  if (!cur) throw new HttpError(404, 'Test not found');
  if (!canEditMarks(req, db, cur.section_id, cur.subject_id)) throw new HttpError(403, 'You can only remove tests for the classes and subjects you teach');
  db.prepare('UPDATE assessments SET archived = 1 WHERE id = ?').run(cur.id);
  recordAudit(req, 'archive', 'assessment', cur.id, { title: cur.title, held_on: cur.held_on });
  res.json({ success: true });
}));

router.get('/assessments/:id/marks', asyncHandler(async (req, res) => {
  const db = getDb();
  const a = db.prepare(
    `SELECT a.*, sub.name AS subject_name, c.name AS class_name, sec.name AS section_name, t.name AS term_name
     FROM assessments a JOIN subjects sub ON sub.id = a.subject_id
     JOIN sections sec ON sec.id = a.section_id JOIN classes c ON c.id = sec.class_id
     LEFT JOIN exam_terms t ON t.id = a.term_id WHERE a.id = ? AND a.archived = 0`
  ).get(req.params.id);
  if (!a) throw new HttpError(404, 'Test not found');
  if (!canViewSection(req, db, a.section_id)) throw new HttpError(403, 'You are not assigned to this class');
  const roster = R.sectionRoster(db, a.section_id, a.held_on, [a.id]);
  const marks = new Map(db.prepare('SELECT * FROM assessment_marks WHERE assessment_id = ?').all(a.id).map((m) => [m.student_id, m]));
  res.json({
    assessment: a,
    can_edit: canEditMarks(req, db, a.section_id, a.subject_id),
    rows: roster.map((s) => {
      const m = marks.get(s.id) || {};
      return { student_id: s.id, full_name: s.full_name, student_code: s.student_code, roll_number: s.roll_number, obtained: m.obtained ?? null, absent: Boolean(m.absent), remarks: m.remarks || '' };
    })
  });
}));

router.put('/assessments/:id/marks', asyncHandler(async (req, res) => {
  const db = getDb();
  const a = db.prepare('SELECT * FROM assessments WHERE id = ? AND archived = 0').get(req.params.id);
  if (!a) throw new HttpError(404, 'Test not found');
  if (!canEditMarks(req, db, a.section_id, a.subject_id)) throw new HttpError(403, 'You can only enter marks for the classes and subjects you teach');
  const list = Array.isArray(req.body && req.body.marks) ? req.body.marks : [];
  if (!list.length) throw new HttpError(400, 'No marks to save');
  const allowed = new Set(R.sectionRoster(db, a.section_id, a.held_on, [a.id]).map((s) => s.id));
  const clean = list.map((m) => {
    const sid = Number(m.student_id);
    if (!allowed.has(sid)) throw new HttpError(400, 'One of the students is not in this class');
    const absent = Boolean(m.absent);
    const obtained = absent ? null : num(m.obtained);
    if (obtained !== null && !(obtained >= 0 && obtained <= a.total_marks)) throw new HttpError(400, `Marks must be between 0 and ${a.total_marks}`);
    if (obtained !== null && Number.isNaN(obtained)) throw new HttpError(400, 'Marks must be a number');
    return { sid, absent: absent ? 1 : 0, obtained, remarks: String(m.remarks || '').trim() || null };
  });
  const upsert = db.prepare(
    `INSERT INTO assessment_marks (assessment_id, student_id, obtained, absent, remarks, entered_by, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(assessment_id, student_id) DO UPDATE SET obtained = excluded.obtained, absent = excluded.absent,
       remarks = excluded.remarks, entered_by = excluded.entered_by, updated_at = CURRENT_TIMESTAMP`
  );
  runInTransaction(db, () => clean.forEach((m) => upsert.run(a.id, m.sid, m.obtained, m.absent, m.remarks, req.user.id)));
  recordAudit(req, 'enter_marks', 'assessment', a.id, { count: clean.length });
  res.json({ success: true, saved: clean.length });
}));

// ---------- progress reports ----------
function periodLabel(from, to) {
  if (from && to && from === to) return from;
  if (from && to) return `${from} to ${to}`;
  if (from) return `from ${from}`;
  if (to) return `up to ${to}`;
  return 'All time';
}

function readRange(q) {
  const from = DATE_RE.test(q.from || '') ? q.from : '';
  const to = DATE_RE.test(q.to || '') ? q.to : '';
  return { from, to, kind: R.ASSESSMENT_KINDS.includes(q.kind) ? q.kind : '', label: String(q.label || '').slice(0, 40) || periodLabel(from, to) };
}

function studentForReport(req, db, id) {
  const st = loadStudent(db, id);
  if (!st) throw new HttpError(404, 'Student not found');
  if (!canViewStudent(req, db, st)) throw new HttpError(403, "You don't have access to this student's results");
  return st;
}

router.get('/students/:id/progress', asyncHandler(async (req, res) => {
  const db = getDb();
  const st = studentForReport(req, db, req.params.id);
  const range = readRange(req.query);
  const report = R.studentProgress(db, st.id, range);
  res.json({
    student: { id: st.id, full_name: st.full_name, student_code: st.student_code, roll_number: st.roll_number, class_label: st.class_label, parent_name: st.parent_name, parent_phone: st.parent_phone, photo_path: st.photo_path, status: st.status },
    range,
    ...report
  });
}));

async function buildProgressPdf(req, db, st, range) {
  const report = R.studentProgress(db, st.id, range);
  const { schoolName, logoPath, stampPath } = getBranding(db, 'progress_reports');
  const who = userDesignation(db, req.user.id);
  const buffer = await resultPdf.progressReportPdf({
    schoolName,
    logoPath,
    stampPath,
    student: { ...st, photoPath: st.photo_path ? path.join(config.uploadsDir, st.photo_path) : null },
    periodLabel: range.label,
    kind: range.kind,
    report,
    preparedBy: { ...who, at: localDateTimeStr() }
  });
  return { report, buffer };
}

router.get('/students/:id/progress.pdf', asyncHandler(async (req, res) => {
  const db = getDb();
  const st = studentForReport(req, db, req.params.id);
  const { buffer } = await buildProgressPdf(req, db, st, readRange(req.query));
  pdfService.sendPdf(res, `progress-${st.student_code}.pdf`, buffer);
}));

// Sends the report PDF to the parent's WhatsApp through the school's linked
// WhatsApp number (Settings → WhatsApp).
router.post('/students/:id/progress/send', asyncHandler(async (req, res) => {
  const db = getDb();
  const st = studentForReport(req, db, req.params.id);
  if (req.user.role === 'parent' || req.user.role === 'student') throw new HttpError(403, 'Only school staff can send reports');
  const phone = String((req.body && req.body.phone) || st.parent_phone || '').trim();
  if (!phone && !st.parent_email) throw new HttpError(400, 'No parent phone number or email on file for this student');
  const range = readRange(req.body || {});
  const { report, buffer } = await buildProgressPdf(req, db, st, range);
  const o = report.overall;
  const message = `Dear ${st.parent_name || 'Parent'}, the progress report of ${st.full_name} (${st.class_label || ''}) for ${range.label} is attached. Average: ${o.percentage ?? '-'}% (Grade ${o.grade}).`;
  const result = await notificationService.sendNotification({
    title: 'Student Progress Report',
    message,
    category: 'Academic',
    audienceType: 'Individual',
    audienceRef: JSON.stringify([{ name: st.parent_name || 'Parent', phone, email: st.parent_email }]),
    channels: ['whatsapp', 'email'],
    createdBy: req.user.id,
    attachment: { buffer, fileName: `progress-${st.student_code}.pdf`, mimetype: 'application/pdf' }
  });
  recordAudit(req, 'send_progress_report', 'student', st.id, { phone, period: range.label, summary: result.summary });
  res.json({ ...result, message });
}));

// Class report: every student's average per subject for a period.
router.get('/sections/:id/summary', asyncHandler(async (req, res) => {
  const db = getDb();
  if (!canViewSection(req, db, req.params.id)) throw new HttpError(403, 'You are not assigned to this class');
  const range = readRange(req.query);
  const grading = R.getGrading(db);
  const assessments = db.prepare(
    `SELECT a.id, a.subject_id, a.total_marks, sub.name AS subject_name FROM assessments a JOIN subjects sub ON sub.id = a.subject_id
     WHERE a.archived = 0 AND a.section_id = @s AND (@from = '' OR a.held_on >= @from) AND (@to = '' OR a.held_on <= @to) AND (@kind = '' OR a.kind = @kind)`
  ).all({ s: req.params.id, from: range.from, to: range.to, kind: range.kind });
  const ids = assessments.map((a) => a.id);
  const subjects = [...new Map(assessments.map((a) => [a.subject_id, { subject_id: a.subject_id, subject_name: a.subject_name }])).values()].sort((x, y) => x.subject_name.localeCompare(y.subject_name));
  const roster = R.sectionRoster(db, req.params.id, range.to || localDateStr(), ids);
  const marks = ids.length ? db.prepare(`SELECT * FROM assessment_marks WHERE assessment_id IN (${ids.map(() => '?').join(',')})`).all(...ids) : [];
  const aMap = new Map(assessments.map((a) => [a.id, a]));
  const acc = new Map();
  for (const m of marks) {
    if (m.absent || m.obtained === null) continue;
    const a = aMap.get(m.assessment_id);
    const k = `${m.student_id}:${a.subject_id}`;
    const v = acc.get(k) || { o: 0, t: 0 };
    v.o += m.obtained;
    v.t += a.total_marks;
    acc.set(k, v);
  }
  const students = roster.map((s) => {
    let o = 0;
    let t = 0;
    const per = {};
    subjects.forEach((sub) => {
      const v = acc.get(`${s.id}:${sub.subject_id}`);
      per[sub.subject_id] = v ? R.pctOf(v.o, v.t) : null;
      if (v) { o += v.o; t += v.t; }
    });
    const pct = R.pctOf(o, t);
    return { student_id: s.id, full_name: s.full_name, roll_number: s.roll_number, subjects: per, percentage: pct, ...R.gradeFor(grading, pct) };
  });
  res.json({ range, subjects, students, tests: assessments.length });
}));

// ---------- result cards ----------
function termSheet(req, db, termId, sectionId) {
  if (!canViewSection(req, db, sectionId)) throw new HttpError(403, 'You are not assigned to this class');
  const data = R.termResults(db, termId, sectionId);
  if (!data) throw new HttpError(404, 'Exam or class not found');
  return data;
}

router.get('/terms/:termId/sections/:sectionId', asyncHandler(async (req, res) => {
  const db = getDb();
  const data = termSheet(req, db, req.params.termId, req.params.sectionId);
  res.json({
    ...data,
    can_edit_teacher_remarks: hasAccess(req, 'results', 'manage') || isClassTeacher(req, db, req.params.sectionId),
    can_edit_principal_remarks: isManagement(req.user),
    can_approve: isManagement(req.user)
  });
}));

router.put('/terms/:termId/sections/:sectionId/remarks', asyncHandler(async (req, res) => {
  const db = getDb();
  const sectionId = Number(req.params.sectionId);
  const termId = Number(req.params.termId);
  if (!db.prepare('SELECT id FROM exam_terms WHERE id = ?').get(termId)) throw new HttpError(404, 'Exam not found');
  const teacherOk = hasAccess(req, 'results', 'manage') || isClassTeacher(req, db, sectionId);
  const principalOk = isManagement(req.user);
  if (!teacherOk && !principalOk) throw new HttpError(403, 'Only the class teacher, Principal or Admin can write result remarks');
  const list = Array.isArray(req.body && req.body.remarks) ? req.body.remarks : [];
  const onRoll = new Set(db.prepare('SELECT id FROM students WHERE section_id = ?').all(sectionId).map((r) => r.id));
  db.prepare('SELECT DISTINCT am.student_id FROM assessment_marks am JOIN assessments a ON a.id = am.assessment_id WHERE a.term_id = ? AND a.section_id = ?')
    .all(termId, sectionId).forEach((r) => onRoll.add(r.student_id));
  const get = db.prepare('SELECT * FROM result_remarks WHERE term_id = ? AND student_id = ?');
  const put = db.prepare(
    `INSERT INTO result_remarks (term_id, student_id, teacher_remarks, principal_remarks, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(term_id, student_id) DO UPDATE SET teacher_remarks = excluded.teacher_remarks, principal_remarks = excluded.principal_remarks,
       updated_by = excluded.updated_by, updated_at = CURRENT_TIMESTAMP`
  );
  let saved = 0;
  runInTransaction(db, () => {
    for (const r of list) {
      const sid = Number(r.student_id);
      if (!onRoll.has(sid)) continue;
      const cur = get.get(termId, sid) || {};
      const teacher = teacherOk && r.teacher_remarks !== undefined ? (String(r.teacher_remarks).trim() || null) : (cur.teacher_remarks ?? null);
      const principal = principalOk && r.principal_remarks !== undefined ? (String(r.principal_remarks).trim() || null) : (cur.principal_remarks ?? null);
      put.run(termId, sid, teacher, principal, req.user.id);
      saved += 1;
    }
  });
  recordAudit(req, 'result_remarks', 'exam_term', termId, { section_id: sectionId, count: saved });
  res.json({ success: true, saved });
}));

router.post('/terms/:termId/sections/:sectionId/approve', asyncHandler(async (req, res) => {
  if (!isManagement(req.user)) throw new HttpError(403, 'Only the Principal, Admin or Super Admin can approve results');
  const db = getDb();
  const data = termSheet(req, db, req.params.termId, req.params.sectionId);
  if (data.stats.incomplete && !(req.body && req.body.force)) {
    throw new HttpError(400, `${data.stats.incomplete} student(s) still have marks missing. Enter them first, or approve anyway.`);
  }
  const who = userDesignation(db, req.user.id);
  const at = localDateTimeStr();
  db.prepare(
    `INSERT INTO result_approvals (term_id, section_id, approved_by, approved_by_name, approved_by_designation, approved_at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(term_id, section_id) DO UPDATE SET approved_by = excluded.approved_by, approved_by_name = excluded.approved_by_name,
       approved_by_designation = excluded.approved_by_designation, approved_at = excluded.approved_at`
  ).run(data.term.id, data.section.id, req.user.id, who.name, who.designation, at);
  recordAudit(req, 'approve_results', 'exam_term', data.term.id, { section_id: data.section.id, ...data.stats });
  res.json({ success: true, approved_by_name: who.name, approved_by_designation: who.designation, approved_at: at });
}));

router.delete('/terms/:termId/sections/:sectionId/approve', asyncHandler(async (req, res) => {
  if (!isManagement(req.user)) throw new HttpError(403, 'Only the Principal, Admin or Super Admin can change an approval');
  const db = getDb();
  db.prepare('DELETE FROM result_approvals WHERE term_id = ? AND section_id = ?').run(req.params.termId, req.params.sectionId);
  recordAudit(req, 'unapprove_results', 'exam_term', Number(req.params.termId), { section_id: Number(req.params.sectionId) });
  res.json({ success: true });
}));

async function buildCards(db, data, studentIds) {
  const { schoolName, logoPath, stampPath } = getBranding(db, 'result_cards');
  const students = studentIds ? data.students.filter((s) => studentIds.includes(s.student_id)) : data.students;
  if (!students.length) throw new HttpError(404, 'No students to print');
  return resultPdf.resultCardsPdf({
    schoolName,
    logoPath,
    stampPath,
    session: getSetting(db, 'academic_year', ''),
    data,
    students,
    photoPathFor: (s) => (s.photo_path ? path.join(config.uploadsDir, s.photo_path) : null)
  });
}

router.get('/terms/:termId/sections/:sectionId/cards.pdf', asyncHandler(async (req, res) => {
  const db = getDb();
  const data = termSheet(req, db, req.params.termId, req.params.sectionId);
  const only = req.query.student_id ? [Number(req.query.student_id)] : null;
  const buffer = await buildCards(db, data, only);
  pdfService.sendPdf(res, `result-cards-${data.section.class_name}-${data.section.section_name}.pdf`.replace(/\s+/g, '-'), buffer);
}));

// A parent (or the student) downloads their own result card.
router.get('/terms/:termId/students/:studentId/card.pdf', asyncHandler(async (req, res) => {
  const db = getDb();
  const st = studentForReport(req, db, req.params.studentId);
  const sec = db.prepare('SELECT DISTINCT a.section_id FROM assessments a JOIN assessment_marks am ON am.assessment_id = a.id WHERE a.term_id = ? AND am.student_id = ?').get(req.params.termId, st.id);
  const sectionId = sec ? sec.section_id : st.section_id;
  const data = R.termResults(db, req.params.termId, sectionId);
  if (!data) throw new HttpError(404, 'Result not found');
  if ((req.user.role === 'parent' || req.user.role === 'student') && !data.approval) throw new HttpError(403, 'This result has not been approved by the school yet');
  const buffer = await buildCards(db, data, [st.id]);
  pdfService.sendPdf(res, `result-card-${st.student_code}.pdf`, buffer);
}));

router.post('/terms/:termId/sections/:sectionId/cards/:studentId/send', asyncHandler(async (req, res) => {
  const db = getDb();
  if (req.user.role === 'parent' || req.user.role === 'student') throw new HttpError(403, 'Only school staff can send result cards');
  const data = termSheet(req, db, req.params.termId, req.params.sectionId);
  const row = data.students.find((s) => s.student_id === Number(req.params.studentId));
  if (!row) throw new HttpError(404, 'Student not found in this class');
  const st = loadStudent(db, row.student_id);
  const phone = String((req.body && req.body.phone) || st.parent_phone || '').trim();
  if (!phone && !st.parent_email) throw new HttpError(400, 'No parent phone number or email on file for this student');
  const buffer = await buildCards(db, data, [row.student_id]);
  const message = `Dear ${st.parent_name || 'Parent'}, the ${data.term.name} result card of ${st.full_name} is attached: ${row.percentage ?? '-'}%, Grade ${row.grade}, ${row.status}${row.position ? `, Position ${row.position}` : ''}.`;
  const result = await notificationService.sendNotification({
    title: `Result Card — ${data.term.name}`,
    message,
    category: 'Academic',
    audienceType: 'Individual',
    audienceRef: JSON.stringify([{ name: st.parent_name || 'Parent', phone, email: st.parent_email }]),
    channels: ['whatsapp', 'email'],
    createdBy: req.user.id,
    attachment: { buffer, fileName: `result-card-${st.student_code}.pdf`, mimetype: 'application/pdf' }
  });
  recordAudit(req, 'send_result_card', 'student', st.id, { term_id: data.term.id, phone, summary: result.summary });
  res.json({ ...result, message });
}));

// Approved result cards for a parent / student portal.
router.get('/students/:id/terms', asyncHandler(async (req, res) => {
  const db = getDb();
  const st = studentForReport(req, db, req.params.id);
  const rows = db.prepare(
    `SELECT DISTINCT t.id, t.name, t.kind, t.session, a.section_id,
            (SELECT approved_at FROM result_approvals ra WHERE ra.term_id = t.id AND ra.section_id = a.section_id) AS approved_at
     FROM exam_terms t JOIN assessments a ON a.term_id = t.id AND a.archived = 0
     JOIN assessment_marks am ON am.assessment_id = a.id AND am.student_id = ?
     WHERE t.archived = 0 ORDER BY t.id DESC`
  ).all(st.id);
  const portal = req.user.role === 'parent' || req.user.role === 'student';
  res.json(portal ? rows.filter((r) => r.approved_at) : rows);
}));

// ---- Send to every parent in a class (WhatsApp + email) ----
async function sendToParents(req, db, students, build) {
  const tally = { students: students.length, sent: 0, simulated: 0, failed: 0, no_contact: 0 };
  for (const row of students) {
    const st = loadStudent(db, row.student_id || row.id);
    if (!st || (!st.parent_phone && !st.parent_email)) { tally.no_contact += 1; continue; }
    const { title, message, buffer, fileName } = await build(st, row);
    const result = await notificationService.sendNotification({
      title, message, category: 'Academic', audienceType: 'Individual',
      audienceRef: JSON.stringify([{ name: st.parent_name || 'Parent', phone: st.parent_phone, email: st.parent_email }]),
      channels: ['whatsapp', 'email'], createdBy: req.user.id,
      attachment: { buffer, fileName, mimetype: 'application/pdf' }
    });
    if (result.summary.sent) tally.sent += 1;
    else if (result.summary.simulated) tally.simulated += 1;
    else tally.failed += 1;
  }
  return tally;
}

router.post('/terms/:termId/sections/:sectionId/cards/send-all', asyncHandler(async (req, res) => {
  const db = getDb();
  if (!isManagement(req.user) && !hasAccess(req, 'results', 'manage') && !isClassTeacher(req, db, req.params.sectionId)) throw new HttpError(403, 'Only the class teacher, Principal or Admin can send result cards');
  const data = termSheet(req, db, req.params.termId, req.params.sectionId);
  if (!data.approval && !(req.body && req.body.force)) throw new HttpError(400, 'Approve the results first (or send anyway)');
  const tally = await sendToParents(req, db, data.students.filter((s) => s.complete), async (st, row) => ({
    title: `Result Card — ${data.term.name}`,
    message: `Dear ${st.parent_name || 'Parent'}, the ${data.term.name} result card of ${st.full_name} is attached: ${row.percentage ?? '-'}%, Grade ${row.grade}, ${row.status}${row.position ? `, Position ${row.position}` : ''}.`,
    buffer: await buildCards(db, data, [row.student_id]),
    fileName: `result-card-${st.student_code}.pdf`
  }));
  recordAudit(req, 'send_all_result_cards', 'exam_term', data.term.id, { section_id: data.section.id, ...tally });
  res.json(tally);
}));

router.post('/sections/:id/progress/send-all', asyncHandler(async (req, res) => {
  const db = getDb();
  if (!canViewSection(req, db, req.params.id)) throw new HttpError(403, 'You are not assigned to this class');
  const range = readRange(req.body || {});
  const roster = R.sectionRoster(db, req.params.id, range.to || localDateStr());
  const tally = await sendToParents(req, db, roster, async (st) => {
    const { report, buffer } = await buildProgressPdf(req, db, st, range);
    return {
      title: 'Student Progress Report',
      message: `Dear ${st.parent_name || 'Parent'}, the progress report of ${st.full_name} (${st.class_label || ''}) for ${range.label} is attached. Average: ${report.overall.percentage ?? '-'}% (Grade ${report.overall.grade}).`,
      buffer,
      fileName: `progress-${st.student_code}.pdf`
    };
  });
  recordAudit(req, 'send_all_progress', 'section', Number(req.params.id), { period: range.label, ...tally });
  res.json(tally);
}));

module.exports = router;
