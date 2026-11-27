// Certificates: award certificates (1st / 2nd / 3rd position, appreciation,
// participation) and school documents (leaving, provisional, character).
// The page designs live in the client; the server keeps the register: every
// issued certificate gets a serial number (e.g. LC-2026-0004) and the exact
// details printed on it, so it can be reprinted or cancelled later.
const express = require('express');
const { getDb } = require('../db/connection');
const asyncHandler = require('../utils/asyncHandler');
const { requireAuth } = require('../middleware/auth');
const { requireAccess } = require('../middleware/permissions');
const { recordAudit } = require('../middleware/audit');
const { HttpError } = require('../middleware/errors');
const { localDateStr } = require('../utils/localDate');

const router = express.Router();
router.use(requireAuth);

const CATEGORIES = {
  position: { label: 'Position Certificate', prefix: 'POS' },
  appreciation: { label: 'Appreciation Certificate', prefix: 'APR' },
  participation: { label: 'Participation Certificate', prefix: 'PAR' },
  leaving: { label: 'School Leaving Certificate', prefix: 'LC' },
  provisional: { label: 'Provisional Certificate', prefix: 'PC' },
  character: { label: 'Character Certificate', prefix: 'CC' }
};
const TEMPLATES = ['classic', 'royal', 'modern'];

const STUDENT_SELECT = `
  SELECT s.id, s.full_name, s.student_code, s.admission_number, s.gender, s.date_of_birth, s.admission_date, s.roll_number,
         s.status, s.left_on, s.leaving_type, s.leaving_reason, s.address, s.photo_path,
         c.name AS class_name, sec.name AS section_name, p.full_name AS parent_name, p.relation AS parent_relation
  FROM students s
  LEFT JOIN sections sec ON sec.id = s.section_id
  LEFT JOIN classes c ON c.id = sec.class_id
  LEFT JOIN parents p ON p.id = s.parent_id`;

router.get('/meta', requireAccess('certificates', 'view'), asyncHandler(async (req, res) => {
  res.json({ categories: Object.entries(CATEGORIES).map(([key, v]) => ({ key, ...v })), templates: TEMPLATES });
}));

// Student picker: a class's students (left / graduated included, for leaving certificates).
router.get('/students', requireAccess('certificates', 'view'), asyncHandler(async (req, res) => {
  const db = getDb();
  const { class_id = '', search = '' } = req.query;
  const rows = db.prepare(
    `SELECT s.id, s.full_name, s.admission_number, s.roll_number, s.status, c.name AS class_name, sec.name AS section_name
     FROM students s LEFT JOIN sections sec ON sec.id = s.section_id LEFT JOIN classes c ON c.id = sec.class_id
     WHERE s.archived = 0 AND (@class_id = '' OR sec.class_id = @class_id)
       AND (@q = '%%' OR s.full_name LIKE @q OR s.admission_number LIKE @q OR s.student_code LIKE @q)
     ORDER BY sec.name, s.roll_number, s.full_name LIMIT 500`
  ).all({ class_id: String(class_id), q: `%${search}%` });
  res.json(rows);
}));

// Student details used to pre-fill a certificate.
router.get('/student/:id', requireAccess('certificates', 'view'), asyncHandler(async (req, res) => {
  const db = getDb();
  const s = db.prepare(`${STUDENT_SELECT} WHERE s.id = ?`).get(req.params.id);
  if (!s) throw new HttpError(404, 'Student not found');
  const att = db.prepare(
    `SELECT COUNT(*) AS total, SUM(CASE WHEN status IN ('Present', 'Late') THEN 1 ELSE 0 END) AS present FROM student_attendance WHERE student_id = ?`
  ).get(s.id);
  res.json({ ...s, attendance: { total: att.total || 0, present: att.present || 0 } });
}));

router.get('/', requireAccess('certificates', 'view'), asyncHandler(async (req, res) => {
  const db = getDb();
  const { category = '', search = '', limit = 100 } = req.query;
  const rows = db.prepare(
    `SELECT * FROM certificates
     WHERE (@category = '' OR category = @category)
       AND (@q = '%%' OR recipient_name LIKE @q OR certificate_number LIKE @q OR title LIKE @q)
     ORDER BY id DESC LIMIT @limit`
  ).all({ category, q: `%${search}%`, limit: Math.min(500, Number(limit) || 100) });
  res.json(rows.map((r) => ({ ...r, data: safeJson(r.data_json), data_json: undefined })));
}));

function safeJson(s) { try { return JSON.parse(s || '{}'); } catch { return {}; } }

function nextNumber(db, category) {
  const year = localDateStr().slice(0, 4);
  const prefix = `${CATEGORIES[category].prefix}-${year}-`;
  const row = db.prepare('SELECT certificate_number FROM certificates WHERE certificate_number LIKE ? ORDER BY id DESC LIMIT 1').get(`${prefix}%`);
  const n = row ? Number(row.certificate_number.slice(prefix.length)) + 1 : 1;
  return `${prefix}${String(n).padStart(4, '0')}`;
}

router.post('/', requireAccess('certificates', 'manage'), asyncHandler(async (req, res) => {
  const db = getDb();
  const { category, template = 'classic', student_id = null, recipient_name, title = '', issue_date, data = {} } = req.body || {};
  if (!CATEGORIES[category]) throw new HttpError(400, 'Choose a certificate type');
  if (!TEMPLATES.includes(template)) throw new HttpError(400, 'Choose a template');
  const name = String(recipient_name || '').trim();
  if (!name) throw new HttpError(400, 'Recipient name is required');
  if (student_id && !db.prepare('SELECT id FROM students WHERE id = ?').get(student_id)) throw new HttpError(400, 'Student not found');
  if (category === 'position' && !['1st', '2nd', '3rd'].includes(data.position)) throw new HttpError(400, 'Choose 1st, 2nd or 3rd position');
  if (category === 'leaving' && student_id) {
    const dup = db.prepare(`SELECT certificate_number FROM certificates WHERE category = 'leaving' AND student_id = ? AND cancelled_at IS NULL`).get(student_id);
    if (dup && !req.body.allow_duplicate) throw new HttpError(409, `A leaving certificate (${dup.certificate_number}) was already issued to this student. Reprint it from the register, or cancel it first.`);
  }
  const json = JSON.stringify(data || {});
  if (json.length > 20000) throw new HttpError(400, 'Certificate details are too long');

  // BEGIN IMMEDIATE so two PCs issuing at once can't get the same number.
  db.exec('BEGIN IMMEDIATE');
  let row;
  try {
    const number = nextNumber(db, category);
    const info = db.prepare(
      `INSERT INTO certificates (certificate_number, category, template, student_id, recipient_name, title, issue_date, data_json, issued_by, issued_by_name, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(number, category, template, student_id || null, name.slice(0, 150), String(title).slice(0, 200),
      /^\d{4}-\d{2}-\d{2}$/.test(issue_date || '') ? issue_date : localDateStr(), json, req.user.id, req.user.full_name || req.user.username, new Date().toISOString());
    db.exec('COMMIT');
    row = db.prepare('SELECT * FROM certificates WHERE id = ?').get(info.lastInsertRowid);
  } catch (err) {
    try { db.exec('ROLLBACK'); } catch { /* ignore */ }
    throw err;
  }
  recordAudit(req, 'issue_certificate', 'certificate', row.id, { number: row.certificate_number, category, recipient: name });
  res.status(201).json({ ...row, data: safeJson(row.data_json), data_json: undefined });
}));

router.post('/:id/cancel', requireAccess('certificates', 'manage'), asyncHandler(async (req, res) => {
  const db = getDb();
  const row = db.prepare('SELECT * FROM certificates WHERE id = ?').get(req.params.id);
  if (!row) throw new HttpError(404, 'Certificate not found');
  if (row.cancelled_at) throw new HttpError(400, 'Already cancelled');
  db.prepare('UPDATE certificates SET cancelled_at = ?, cancel_reason = ? WHERE id = ?')
    .run(new Date().toISOString(), String((req.body && req.body.reason) || '').slice(0, 300), row.id);
  recordAudit(req, 'cancel_certificate', 'certificate', row.id, { number: row.certificate_number });
  res.json({ success: true });
}));

module.exports = router;
