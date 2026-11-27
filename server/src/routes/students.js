const express = require('express');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');
const { getDb } = require('../db/connection');
const asyncHandler = require('../utils/asyncHandler');
const { requireAuth, requireRole, ROLE_GROUPS } = require('../middleware/auth');
const { recordAudit } = require('../middleware/audit');
const { requireAccess, requireAccessAny, hasAccess, isManagement } = require('../middleware/permissions');
const { HttpError } = require('../middleware/errors');
const { upload } = require('../middleware/upload');
const ids = require('../utils/ids');
const qrService = require('../services/qrcode');
const excelService = require('../services/excel');
const pdfService = require('../services/pdf');
const { getBranding, getSetting } = require('../services/settings');
const config = require('../config');
const { buildPartialUpdate } = require('../utils/partialUpdate');
const { assertImage, removeUpload } = require('../utils/photos');
const { localDateStr, DATE_RE } = require('../utils/localDate');
const { runInTransaction } = require('../utils/tx');

const router = express.Router();
router.use(requireAuth);

const LIST_SELECT = `
  SELECT s.*, c.name AS class_name, sec.name AS section_name, p.full_name AS parent_name, p.phone AS parent_phone, p.email AS parent_email, p.relation AS parent_relation
  FROM students s
  LEFT JOIN sections sec ON sec.id = s.section_id
  LEFT JOIN classes c ON c.id = sec.class_id
  LEFT JOIN parents p ON p.id = s.parent_id
`;

function scopeToParent(req, db) {
  if (req.user.role !== 'parent') return null;
  const row = db.prepare('SELECT id FROM parents WHERE user_id = ?').get(req.user.id);
  return row ? row.id : -1;
}

router.get('/', asyncHandler(async (req, res) => {
  const db = getDb();
  const { search = '', page = 1, limit = 20, includeArchived = 'false', section_id = '', class_id = '', enrollment = 'current' } = req.query;
  const q = `%${search}%`;
  const offset = (Number(page) - 1) * Number(limit);
  const archivedFilter = includeArchived === 'true' ? '' : 'AND s.archived = 0';

  // node:sqlite throws if a bound object has a key the SQL doesn't reference, so every
  // named param below must always appear in the SQL — use an OR-bypass sentinel instead
  // of conditionally omitting the clause.
  const parentId = scopeToParent(req, db); // null = not a parent account, no scoping needed
  const where = `WHERE (s.full_name LIKE @q OR s.student_code LIKE @q OR s.admission_number LIKE @q) ${archivedFilter}
    AND (@section_id = '' OR s.section_id = @section_id)
    AND (@class_id = '' OR s.section_id IN (SELECT id FROM sections WHERE class_id = @class_id))
    AND (@parentId = '' OR s.parent_id = @parentId OR s.secondary_parent_id = @parentId)
    AND (@enrollment = 'all'
      OR (@enrollment = 'current' AND s.status NOT IN ('Left', 'Graduated'))
      OR (@enrollment = 'left' AND s.status IN ('Left', 'Graduated')))`;
  const filterParams = { q, section_id: section_id || '', class_id: class_id || '', parentId: parentId === null ? '' : parentId, enrollment: ['current', 'left', 'all'].includes(enrollment) ? enrollment : 'current' };

  const rows = db.prepare(`${LIST_SELECT} ${where} ORDER BY ${req.query.sort === 'class' ? 'c.sort_order, c.name, sec.name, s.roll_number, s.full_name' : 's.id DESC'} LIMIT @limit OFFSET @offset`).all({ ...filterParams, limit: Number(limit), offset });
  const total = db.prepare(`SELECT COUNT(*) AS c FROM students s ${where}`).get(filterParams).c;
  res.json({ rows, pagination: { page: Number(page), limit: Number(limit), total } });
}));

router.get('/import/template', requireAccess('students', 'view'), asyncHandler(async (req, res) => {
  const db = getDb();
  const classes = db.prepare('SELECT id, name FROM classes ORDER BY sort_order, name').all().map((c) => ({
    name: c.name,
    sections: db.prepare(
      `SELECT sec.name, (SELECT COUNT(*) FROM students st WHERE st.section_id = sec.id AND st.archived = 0 AND st.status NOT IN ('Left', 'Graduated')) AS students
       FROM sections sec WHERE sec.class_id = ? ORDER BY sec.name`
    ).all(c.id)
  }));
  const buffer = await excelService.buildStudentImportTemplate(classes);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="student-import-template.xlsx"');
  res.send(Buffer.from(buffer));
}));

router.get('/export', requireAccess('students', 'view'), asyncHandler(async (req, res) => {
  const db = getDb();
  const rows = db.prepare(`${LIST_SELECT} WHERE s.archived = 0 ORDER BY s.full_name`).all();
  const buffer = await excelService.exportRowsToExcel({
    sheetName: 'Students',
    columns: [
      { header: 'Student Code', key: 'student_code', width: 16 },
      { header: 'Admission No', key: 'admission_number', width: 16 },
      { header: 'Full Name', key: 'full_name', width: 24 },
      { header: 'Class', key: 'class_name', width: 12 },
      { header: 'Section', key: 'section_name', width: 10 },
      { header: 'Roll No', key: 'roll_number', width: 10 },
      { header: 'Parent', key: 'parent_name', width: 22 },
      { header: 'Parent Phone', key: 'parent_phone', width: 16 },
      { header: 'Status', key: 'status', width: 10 }
    ],
    rows
  });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="students-export.xlsx"');
  res.send(Buffer.from(buffer));
}));

// ---- Bulk import helpers ----
// "1", "class 1", "Class-1", "CLASS 1", "Grade 1" → the same key, so the sheet
// matches the school's existing class names however it was typed.
const classKey = (v) => String(v || '').toLowerCase().replace(/\b(class|grade)\b/g, '').replace(/[^a-z0-9]/g, '');
const tidyName = (v) => String(v || '').replace(/\s+/g, ' ').trim();

// New classes from the sheet keep the sheet's own name; a bare number
// ("5") becomes "Class 5" like the rest of the app.
function newClassName(v) {
  const t = tidyName(v);
  return /^\d+$/.test(t) ? `Class ${t}` : t;
}

function parseDob(v) {
  const t = String(v || '').trim();
  if (!t) return null;
  let m = t.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  let y; let mo; let d;
  if (m) [, y, mo, d] = m;
  else if ((m = t.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/))) [, d, mo, y] = m; // 16/02/2015
  else if (/^\d{4,5}(\.\d+)?$/.test(t)) { // Excel serial date typed as a number
    const dt = new Date(Math.round((Number(t) - 25569) * 86400000));
    return dt.toISOString().slice(0, 10);
  } else throw new Error(`Date of birth "${t}" is not a date — use YYYY-MM-DD, e.g. 2015-02-16`);
  const iso = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const dt = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(dt.getTime()) || dt.toISOString().slice(0, 10) !== iso) throw new Error(`Date of birth "${t}" is not a real date`);
  return iso;
}

function parseGender(v) {
  const t = String(v || '').trim().toLowerCase();
  if (!t) return null;
  if (['m', 'male', 'boy'].includes(t)) return 'Male';
  if (['f', 'female', 'girl'].includes(t)) return 'Female';
  return t.charAt(0).toUpperCase() + t.slice(1);
}

// Spreadsheets drop the leading 0 of "03001234567" → put it back.
function parsePhone(v) {
  const t = String(v || '').trim();
  if (!t) return null;
  const digits = t.replace(/\D/g, '');
  if (/^3\d{9}$/.test(digits) && !/^\+/.test(t)) return `0${digits}`;
  return t;
}

// Database wording → plain words for the import result.
function friendlyImportError(msg) {
  const m = String(msg || '');
  if (/UNIQUE constraint failed: students\.section_id, students\.roll_number/i.test(m)) return 'This roll number is already used in this class and section. Please use a different roll number, or leave it empty.';
  if (/UNIQUE constraint failed: students\.(student_code|admission_number)/i.test(m)) return 'Could not give this student a new admission number. Please upload the file again.';
  if (/UNIQUE constraint failed/i.test(m)) return 'This student clashes with a record that already exists. Please check the row for repeated details.';
  if (/NOT NULL constraint failed: students\.(\w+)/i.test(m)) return `The ${m.match(/students\.(\w+)/i)[1].replace(/_/g, ' ')} is missing.`;
  if (/constraint failed|SQLITE/i.test(m)) return 'This row has a value the app cannot save. Please check it against the sample row.';
  return m;
}

router.post('/import', requireAccess('students', 'manage'), upload.single('file'), asyncHandler(async (req, res) => {
  if (!req.file) throw new HttpError(400, 'Excel file is required (field name "file")');
  const buffer = fs.readFileSync(req.file.path);
  let records;
  try {
    records = await excelService.parseStudentImport(buffer);
  } catch (err) {
    throw new HttpError(400, err.status ? err.message : 'Could not read this file — please upload the .xlsx template (File → Download → Microsoft Excel in Google Sheets).');
  } finally {
    try { fs.unlinkSync(req.file.path); } catch { /* ignore */ }
  }
  const db = getDb();
  const results = { created: 0, failed: [], skipped: [], createdClasses: [], createdSections: [], byClass: [] };
  const tally = new Map();

  const classes = db.prepare('SELECT id, name FROM classes').all();
  const findClass = (v) => classes.find((c) => c.name.toLowerCase() === tidyName(v).toLowerCase()) || classes.find((c) => classKey(c.name) && classKey(c.name) === classKey(v));
  const nextSort = () => (db.prepare('SELECT COALESCE(MAX(sort_order), 0) + 1 AS n FROM classes').get().n);

  for (const record of records) {
    const label = { row: record.row, full_name: record.full_name };
    try {
      if (String(record.full_name).startsWith(excelService.SAMPLE_PREFIX)) { results.skipped.push({ ...label, reason: 'Sample row' }); continue; }
      const fullName = tidyName(record.full_name);
      if (!tidyName(record.class_name)) throw new Error('The Class column is empty. Please write the class, e.g. Class 1.');
      const dob = parseDob(record.date_of_birth);
      const gender = parseGender(record.gender);
      const phone = parsePhone(record.guardian_phone);

      // Class / section come from the sheet: matched to an existing one, or created.
      let classRow = findClass(record.class_name);
      if (!classRow) {
        const name = newClassName(record.class_name);
        const num = name.match(/\d+/);
        const id = Number(db.prepare('INSERT INTO classes (name, sort_order) VALUES (?, ?)').run(name, num ? Number(num[0]) : nextSort()).lastInsertRowid);
        classRow = { id, name };
        classes.push(classRow);
        results.createdClasses.push(name);
      }
      let sectionName = tidyName(record.section_name).toUpperCase();
      const sections = db.prepare('SELECT id, name FROM sections WHERE class_id = ?').all(classRow.id);
      if (!sectionName) {
        if (sections.length === 1) sectionName = sections[0].name.toUpperCase();
        else if (sections.length === 0) sectionName = 'A';
        else throw new Error(`The Section column is empty. ${classRow.name} has more than one section (${sections.map((x) => x.name).join(' or ')}), so please write which one.`);
      }
      let sectionRow = sections.find((x) => x.name.toUpperCase() === sectionName);
      if (!sectionRow) {
        const id = Number(db.prepare('INSERT INTO sections (class_id, name) VALUES (?, ?)').run(classRow.id, sectionName).lastInsertRowid);
        sectionRow = { id, name: sectionName };
        results.createdSections.push(`${classRow.name} - ${sectionName}`);
      }

      // Already in the app (e.g. the same file uploaded twice) → skip.
      const dup = db.prepare(
        `SELECT id FROM students WHERE lower(full_name) = lower(?) AND section_id = ? AND archived = 0 AND (date_of_birth IS ? OR ? IS NULL)`
      ).get(fullName, sectionRow.id, dob, dob);
      if (dup) { results.skipped.push({ ...label, reason: `Already in ${classRow.name} - ${sectionRow.name}` }); continue; }

      // Each roll number can be used only once in a section.
      const roll = tidyName(record.roll_number) || null;
      if (roll) {
        const taken = db.prepare('SELECT full_name, status, archived FROM students WHERE section_id = ? AND roll_number = ?').get(sectionRow.id, roll);
        if (taken) {
          const who = taken.archived || ['Left', 'Graduated'].includes(taken.status) ? `${taken.full_name} (a past student)` : taken.full_name;
          throw new Error(`Roll number ${roll} is already given to ${who} in ${classRow.name} - ${sectionRow.name}. Please use a different roll number, or leave it empty.`);
        }
      }

      // Brothers/sisters: one guardian per phone number.
      let parentId = null;
      if (record.guardian_name || phone) {
        const existing = phone ? db.prepare('SELECT id FROM parents WHERE phone = ? ORDER BY id LIMIT 1').get(phone) : null;
        parentId = existing ? existing.id : Number(db.prepare('INSERT INTO parents (full_name, phone, email) VALUES (?, ?, ?)')
          .run(tidyName(record.guardian_name) || 'Guardian', phone, tidyName(record.guardian_email) || null).lastInsertRowid);
      }

      const code = ids.studentCode(db);
      const admissionNo = ids.admissionNumber(db);
      db.prepare(
        `INSERT INTO students (student_code, admission_number, full_name, gender, date_of_birth, section_id, roll_number, parent_id, address)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(code, admissionNo, fullName, gender, dob, sectionRow.id, roll, parentId, tidyName(record.address) || null);
      results.created += 1;
      const key = `${classRow.name} - ${sectionRow.name}`;
      tally.set(key, (tally.get(key) || 0) + 1);
    } catch (err) {
      results.failed.push({ ...label, error: friendlyImportError(err.message) });
    }
  }

  results.byClass = [...tally.entries()].map(([name, count]) => ({ name, count }));
  recordAudit(req, 'bulk_import', 'student', null, { created: results.created, failed: results.failed.length, skipped: results.skipped.length, createdClasses: results.createdClasses });
  res.json(results);
}));

router.post('/promote', requireAccess('students', 'manage'), asyncHandler(async (req, res) => {
  const { student_ids, to_section_id, academic_year_from, academic_year_to } = req.body;
  if (!Array.isArray(student_ids) || !student_ids.length || !to_section_id) {
    throw new HttpError(400, 'student_ids (array) and to_section_id are required');
  }
  const db = getDb();
  const insertPromotion = db.prepare(
    `INSERT INTO student_promotions (student_id, from_section_id, to_section_id, academic_year_from, academic_year_to, promoted_by)
     VALUES (?, ?, ?, ?, ?, ?)`
  );
  const updateStudent = db.prepare('UPDATE students SET section_id = ?, roll_number = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?');

  let count = 0;
  for (const studentId of student_ids) {
    const student = db.prepare('SELECT section_id FROM students WHERE id = ?').get(studentId);
    if (!student) continue;
    insertPromotion.run(studentId, student.section_id, to_section_id, academic_year_from || null, academic_year_to || null, req.user.id);
    updateStudent.run(to_section_id, studentId);
    count += 1;
  }
  recordAudit(req, 'promote', 'student', null, { count, to_section_id });
  res.json({ success: true, promoted: count });
}));

// NOTE: must stay registered before GET /:id below — Express matches routes in
// registration order, and /:id (a single path segment) would otherwise swallow
// a literal request to /id-cards.pdf, treating "id-cards.pdf" as the :id value.
router.get('/id-cards.pdf', requireAccess('students', 'view'), asyncHandler(async (req, res) => {
  const db = getDb();
  const { section_id = '', class_id = '' } = req.query;
  if (!section_id && !class_id) throw new HttpError(400, 'section_id or class_id is required');
  const students = db.prepare(
    `${LIST_SELECT} WHERE s.archived = 0 AND s.status NOT IN ('Left', 'Graduated') AND (@section_id = '' OR s.section_id = @section_id)
       AND (@class_id = '' OR sec.class_id = @class_id)
     ORDER BY s.roll_number, s.full_name`
  ).all({ section_id, class_id });
  if (students.length === 0) throw new HttpError(404, 'No students found for that class/section');
  const buffer = await buildIdCards(db, students);
  pdfService.sendPdf(res, 'student-id-cards.pdf', buffer);
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const db = getDb();
  const parentId = scopeToParent(req, db);
  const student = db.prepare(`${LIST_SELECT} WHERE s.id = ?`).get(req.params.id);
  if (!student) throw new HttpError(404, 'Student not found');
  if (parentId !== null && student.parent_id !== parentId && student.secondary_parent_id !== parentId) {
    throw new HttpError(403, 'Not your child’s record');
  }
  const documents = db.prepare('SELECT * FROM student_documents WHERE student_id = ? ORDER BY uploaded_at DESC').all(req.params.id);
  res.json({ ...student, documents });
}));

router.post('/', requireAccess('students', 'manage'), asyncHandler(async (req, res) => {
  const db = getDb();
  const {
    full_name, gender, date_of_birth, blood_group, section_id, roll_number,
    parent_name, parent_phone, parent_email, parent_relation, address, admission_date,
    create_login, username, password
  } = req.body;
  if (!full_name || !section_id) throw new HttpError(400, 'full_name and section_id are required');

  let parentId = null;
  if (parent_name) {
    const parentResult = db.prepare(
      'INSERT INTO parents (full_name, relation, phone, email) VALUES (?, ?, ?, ?)'
    ).run(parent_name, parent_relation || 'Guardian', parent_phone || null, parent_email || null);
    parentId = Number(parentResult.lastInsertRowid);
  }

  let userId = null;
  if (create_login) {
    if (!username || !password) throw new HttpError(400, 'username and password are required to create a login');
    const roleRow = db.prepare('SELECT id FROM roles WHERE name = ?').get('student');
    const hash = bcrypt.hashSync(password, 10);
    try {
      const userResult = db.prepare(
        'INSERT INTO users (username, password_hash, role_id, full_name, must_change_password) VALUES (?, ?, ?, ?, 1)'
      ).run(username, hash, roleRow.id, full_name);
      userId = Number(userResult.lastInsertRowid);
    } catch (err) {
      if (String(err.message).includes('UNIQUE')) throw new HttpError(409, 'Username already exists');
      throw err;
    }
  }

  const code = ids.studentCode(db);
  const admissionNo = ids.admissionNumber(db);
  const result = db.prepare(
    `INSERT INTO students (user_id, student_code, admission_number, full_name, gender, date_of_birth, blood_group, section_id, roll_number, parent_id, address, admission_date)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, date('now', 'localtime')))`
  ).run(userId, code, admissionNo, full_name, gender || null, date_of_birth || null, blood_group || null, section_id, roll_number || null, parentId, address || null, admission_date || null);

  recordAudit(req, 'create', 'student', Number(result.lastInsertRowid), { full_name });
  res.status(201).json({ id: Number(result.lastInsertRowid), student_code: code, admission_number: admissionNo });
}));

const STUDENT_FIELDS = ['full_name', 'gender', 'date_of_birth', 'blood_group', 'section_id', 'roll_number', 'address', 'admission_date', 'status'];
const PARENT_FIELDS = { parent_name: 'full_name', parent_phone: 'phone', parent_email: 'email', parent_relation: 'relation' };

router.put('/:id', requireAccess('students', 'manage'), asyncHandler(async (req, res) => {
  const db = getDb();
  const body = req.body || {};
  const student = db.prepare('SELECT id, parent_id FROM students WHERE id = ?').get(req.params.id);
  if (!student) throw new HttpError(404, 'Student not found');
  if (Object.prototype.hasOwnProperty.call(body, 'full_name') && !String(body.full_name || '').trim()) {
    throw new HttpError(400, 'full_name cannot be empty');
  }

  db.exec('BEGIN IMMEDIATE');
  try {
    const { sql, values } = buildPartialUpdate('students', STUDENT_FIELDS, body, ['full_name', 'section_id', 'status']);
    if (sql) db.prepare(`${sql}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(...values, student.id);
    // Status changed by hand from the edit form: keep the leaving date in step.
    if (['Left', 'Graduated'].includes(body.status)) {
      db.prepare('UPDATE students SET left_on = COALESCE(left_on, ?) WHERE id = ?').run(localDateStr(), student.id);
    } else if (body.status) {
      db.prepare('UPDATE students SET left_on = NULL, leaving_type = NULL, leaving_reason = NULL WHERE id = ?').run(student.id);
    }

    // Guardian details live in the parents table; edit the linked row, or create
    // one if the student was admitted without a guardian.
    const parentBody = {};
    Object.entries(PARENT_FIELDS).forEach(([from, to]) => {
      if (Object.prototype.hasOwnProperty.call(body, from)) parentBody[to] = body[from];
    });
    if (Object.keys(parentBody).length) {
      if (student.parent_id) {
        const p = buildPartialUpdate('parents', ['full_name', 'phone', 'email', 'relation'], parentBody, ['full_name']);
        if (p.sql) db.prepare(`${p.sql} WHERE id = ?`).run(...p.values, student.parent_id);
      } else if (String(parentBody.full_name || '').trim()) {
        const created = db.prepare('INSERT INTO parents (full_name, relation, phone, email) VALUES (?, ?, ?, ?)').run(
          parentBody.full_name.trim(), parentBody.relation || 'Guardian', parentBody.phone || null, parentBody.email || null
        );
        db.prepare('UPDATE students SET parent_id = ? WHERE id = ?').run(Number(created.lastInsertRowid), student.id);
      }
    }
    db.exec('COMMIT');
  } catch (err) {
    try { db.exec('ROLLBACK'); } catch { /* ignore */ }
    throw err;
  }
  recordAudit(req, 'update', 'student', Number(req.params.id), { fields: Object.keys(body) });
  res.json({ success: true });
}));

// ---- Leaving school (transfer / moved / withdrawn) and re-admission ----
// A student who leaves stops getting new fee invoices and drops off attendance
// rosters from the leaving date. Their history (attendance, paid fees) is kept.
const LEAVING_TYPES = ['Transferred', 'Moved / Shifted', 'Withdrawn', 'Graduated', 'Other'];

function unpaidAfter(db, studentId, leftOn, scope) {
  // Untouched invoices only: anything partly paid stays so the money is not lost.
  return db.prepare(
    `SELECT id, invoice_number, period_label, due_date, total_amount + fine_amount AS amount
     FROM fee_invoices
     WHERE student_id = @id AND status NOT IN ('Paid', 'Cancelled') AND paid_amount = 0
       AND (@scope = 'all' OR due_date > @leftOn)
     ORDER BY due_date`
  ).all({ id: studentId, leftOn, scope });
}

router.get('/:id/leave-preview', requireAccess('students', 'manage'), asyncHandler(async (req, res) => {
  const db = getDb();
  const leftOn = req.query.left_on || localDateStr();
  if (!DATE_RE.test(leftOn)) throw new HttpError(400, 'left_on must be YYYY-MM-DD');
  const student = db.prepare('SELECT id FROM students WHERE id = ?').get(req.params.id);
  if (!student) throw new HttpError(404, 'Student not found');
  const after = unpaidAfter(db, student.id, leftOn, 'after');
  const allUnpaid = unpaidAfter(db, student.id, leftOn, 'all');
  const outstanding = db.prepare(
    `SELECT COALESCE(SUM(total_amount + fine_amount - paid_amount), 0) AS s FROM fee_invoices WHERE student_id = ? AND status NOT IN ('Paid', 'Cancelled')`
  ).get(student.id).s;
  res.json({ left_on: leftOn, after, allUnpaid, outstanding, types: LEAVING_TYPES });
}));

router.post('/:id/leave', requireAccess('students', 'manage'), asyncHandler(async (req, res) => {
  const db = getDb();
  const { left_on = localDateStr(), leaving_type = 'Transferred', reason = '', cancel_invoices = 'after' } = req.body || {};
  if (!DATE_RE.test(left_on)) throw new HttpError(400, 'left_on must be YYYY-MM-DD');
  if (!LEAVING_TYPES.includes(leaving_type)) throw new HttpError(400, `leaving_type must be one of: ${LEAVING_TYPES.join(', ')}`);
  if (!['after', 'all', 'none'].includes(cancel_invoices)) throw new HttpError(400, 'cancel_invoices must be after, all or none');
  const student = db.prepare('SELECT id, full_name, status FROM students WHERE id = ? AND archived = 0').get(req.params.id);
  if (!student) throw new HttpError(404, 'Student not found');
  if (['Left', 'Graduated'].includes(student.status)) throw new HttpError(400, `${student.full_name} has already left`);

  const result = runInTransaction(db, () => {
    db.prepare(
      `UPDATE students SET status = ?, left_on = ?, leaving_type = ?, leaving_reason = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
    ).run(leaving_type === 'Graduated' ? 'Graduated' : 'Left', left_on, leaving_type, reason || null, student.id);
    const toCancel = cancel_invoices === 'none' ? [] : unpaidAfter(db, student.id, left_on, cancel_invoices);
    const cancel = db.prepare(
      `UPDATE fee_invoices SET status = 'Cancelled', cancelled_at = CURRENT_TIMESTAMP, cancelled_by = ?, cancel_reason = ? WHERE id = ?`
    );
    const note = `Student left school on ${left_on}${reason ? ` — ${reason}` : ''}`;
    toCancel.forEach((inv) => cancel.run(req.user.id, note, inv.id));
    return { cancelled: toCancel.length, cancelled_amount: toCancel.reduce((sum, inv) => sum + inv.amount, 0) };
  });
  const outstanding = db.prepare(
    `SELECT COALESCE(SUM(total_amount + fine_amount - paid_amount), 0) AS s FROM fee_invoices WHERE student_id = ? AND status NOT IN ('Paid', 'Cancelled')`
  ).get(student.id).s;
  recordAudit(req, 'student_left', 'student', student.id, { left_on, leaving_type, reason, ...result });
  res.json({ success: true, ...result, outstanding });
}));

router.post('/:id/readmit', requireAccess('students', 'manage'), asyncHandler(async (req, res) => {
  const db = getDb();
  const { section_id, readmit_on = localDateStr() } = req.body || {};
  if (!DATE_RE.test(readmit_on)) throw new HttpError(400, 'readmit_on must be YYYY-MM-DD');
  const student = db.prepare('SELECT id, status, left_on, section_id FROM students WHERE id = ? AND archived = 0').get(req.params.id);
  if (!student) throw new HttpError(404, 'Student not found');
  if (!['Left', 'Graduated'].includes(student.status)) throw new HttpError(400, 'This student is currently enrolled');
  if (section_id && !db.prepare('SELECT id FROM sections WHERE id = ?').get(section_id)) throw new HttpError(400, 'Unknown section');
  db.prepare(
    `UPDATE students SET status = 'Active', left_on = NULL, leaving_type = NULL, leaving_reason = NULL,
       section_id = COALESCE(?, section_id), updated_at = CURRENT_TIMESTAMP WHERE id = ?`
  ).run(section_id || null, student.id);
  recordAudit(req, 'student_readmitted', 'student', student.id, { readmit_on, previously_left_on: student.left_on, section_id: section_id || student.section_id });
  res.json({ success: true });
}));

router.delete('/:id', requireAccess('students', 'manage'), asyncHandler(async (req, res) => {
  getDb().prepare(`UPDATE students SET archived = 1, status = 'Archived' WHERE id = ?`).run(req.params.id);
  recordAudit(req, 'archive', 'student', Number(req.params.id));
  res.json({ success: true });
}));

router.post('/:id/photo', requireAccess('students', 'manage'), upload.single('photo'), asyncHandler(async (req, res) => {
  if (!req.file) throw new HttpError(400, 'photo file is required');
  if (!assertImage(req.file)) throw new HttpError(400, 'Photo must be a JPG, PNG, GIF or WEBP image');
  const db = getDb();
  const existing = db.prepare('SELECT photo_path FROM students WHERE id = ?').get(req.params.id);
  if (!existing) {
    removeUpload(req.file.filename);
    throw new HttpError(404, 'Student not found');
  }
  db.prepare('UPDATE students SET photo_path = ? WHERE id = ?').run(req.file.filename, req.params.id);
  removeUpload(existing.photo_path);
  recordAudit(req, 'update_photo', 'student', Number(req.params.id));
  res.json({ success: true, file: req.file.filename });
}));

router.delete('/:id/photo', requireAccess('students', 'manage'), asyncHandler(async (req, res) => {
  const db = getDb();
  const existing = db.prepare('SELECT photo_path FROM students WHERE id = ?').get(req.params.id);
  if (!existing) throw new HttpError(404, 'Student not found');
  db.prepare('UPDATE students SET photo_path = NULL WHERE id = ?').run(req.params.id);
  removeUpload(existing.photo_path);
  res.json({ success: true });
}));

router.post('/:id/documents', requireAccess('students', 'manage'), upload.single('document'), asyncHandler(async (req, res) => {
  if (!req.file) throw new HttpError(400, 'document file is required');
  const { doc_type } = req.body;
  const result = getDb().prepare(
    'INSERT INTO student_documents (student_id, doc_type, file_name, file_path) VALUES (?, ?, ?, ?)'
  ).run(req.params.id, doc_type || 'Other', req.file.originalname, req.file.filename);
  recordAudit(req, 'upload_document', 'student', Number(req.params.id));
  res.status(201).json({ id: Number(result.lastInsertRowid) });
}));

router.delete('/documents/:docId', requireAccess('students', 'manage'), asyncHandler(async (req, res) => {
  const doc = getDb().prepare('SELECT * FROM student_documents WHERE id = ?').get(req.params.docId);
  if (doc) {
    const filePath = require('path').join(config.uploadsDir, doc.file_path);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    getDb().prepare('DELETE FROM student_documents WHERE id = ?').run(req.params.docId);
  }
  res.json({ success: true });
}));

router.get('/:id/qrcode', asyncHandler(async (req, res) => {
  const student = getDb().prepare('SELECT student_code FROM students WHERE id = ?').get(req.params.id);
  if (!student) throw new HttpError(404, 'Student not found');
  const dataUrl = await qrService.studentQrDataUrl(student.student_code);
  res.json({ dataUrl });
}));

router.get('/:id/barcode', asyncHandler(async (req, res) => {
  const student = getDb().prepare('SELECT student_code FROM students WHERE id = ?').get(req.params.id);
  if (!student) throw new HttpError(404, 'Student not found');
  const buffer = await qrService.studentBarcodePngBuffer(student.student_code);
  res.setHeader('Content-Type', 'image/png');
  res.send(buffer);
}));

// ---- Printable ID cards (CR80 size, 8-up on A4) ----
async function buildIdCards(db, students) {
  const { schoolName, logoPath } = getBranding(db);
  const cards = await Promise.all(students.map(async (student) => ({
    student,
    qrBuffer: await qrService.studentQrPngBuffer(student.student_code),
    photoPath: student.photo_path ? path.join(config.uploadsDir, student.photo_path) : null
  })));
  return pdfService.studentIdCardsPdf({ schoolName, logoPath, cards, session: getSetting(db, 'academic_year', '') });
}

// ---- Complete history: attendance by month and the full fee ledger ----
function studentHistory(db, id) {
  const att = db.prepare('SELECT attendance_date, status, remarks FROM student_attendance WHERE student_id = ? ORDER BY attendance_date DESC').all(id);
  const months = new Map();
  for (const a of att) {
    const k = a.attendance_date.slice(0, 7);
    const m = months.get(k) || { month: k, Present: 0, Absent: 0, Late: 0, Leave: 0, total: 0 };
    m[a.status] = (m[a.status] || 0) + 1;
    m.total += 1;
    months.set(k, m);
  }
  const monthRows = [...months.values()].map((m) => ({ ...m, percent: m.total ? Math.round(((m.Present + m.Late) / m.total) * 1000) / 10 : null }));
  const totals = monthRows.reduce((t, m) => ({ Present: t.Present + m.Present, Absent: t.Absent + m.Absent, Late: t.Late + m.Late, Leave: t.Leave + m.Leave, total: t.total + m.total }), { Present: 0, Absent: 0, Late: 0, Leave: 0, total: 0 });
  totals.percent = totals.total ? Math.round(((totals.Present + totals.Late) / totals.total) * 1000) / 10 : null;

  const invoices = db.prepare(
    `SELECT id, invoice_number, period_label, due_date, status, total_amount, fine_amount, paid_amount,
            ROUND(total_amount + fine_amount, 2) AS billed, ROUND(CASE WHEN status = 'Cancelled' THEN 0 ELSE total_amount + fine_amount - paid_amount END, 2) AS balance
     FROM fee_invoices WHERE student_id = ? ORDER BY due_date, id`
  ).all(id);
  const payments = db.prepare(
    `SELECT fp.id, fp.receipt_number, fp.payment_date, fp.amount, fp.payment_method, fp.payment_reference, fp.voided_at,
            COALESCE(fp.received_by_name, u.full_name) AS received_by_name, fi.period_label, fi.invoice_number
     FROM fee_payments fp JOIN fee_invoices fi ON fi.id = fp.invoice_id LEFT JOIN users u ON u.id = fp.received_by
     WHERE fi.student_id = ? ORDER BY fp.payment_date, fp.id`
  ).all(id);
  const live = invoices.filter((i) => i.status !== 'Cancelled');
  const r2 = (n) => Math.round(n * 100) / 100;
  const feeTotals = {
    billed: r2(live.reduce((a, i) => a + i.billed, 0)),
    paid: r2(payments.filter((x) => !x.voided_at).reduce((a, x) => a + x.amount, 0)),
    balance: r2(live.reduce((a, i) => a + i.balance, 0))
  };
  // Running ledger: charges and payments in date order with the balance after each.
  const ledger = [
    ...live.map((i) => ({ date: i.due_date, kind: 'charge', text: `Fee ${i.period_label} (${i.invoice_number})`, debit: i.billed, credit: 0 })),
    ...payments.filter((x) => !x.voided_at).map((x) => ({ date: x.payment_date, kind: 'payment', text: `Paid — receipt ${x.receipt_number} (${x.payment_method})`, debit: 0, credit: x.amount }))
  ].sort((a, b) => (a.date === b.date ? (a.kind === 'charge' ? -1 : 1) : a.date < b.date ? -1 : 1));
  let bal = 0;
  ledger.forEach((l) => { bal = r2(bal + l.debit - l.credit); l.balance = bal; });
  return { attendance: { months: monthRows, totals, records: att }, fees: { invoices, payments, totals: feeTotals, ledger } };
}

function historyAllowed(req, db, student) {
  const parentId = scopeToParent(req, db);
  if (parentId !== null) return student.parent_id === parentId || student.secondary_parent_id === parentId;
  if (req.user.role === 'student') return student.user_id === req.user.id;
  return hasAccess(req, ['students', 'fees', 'attendance'], 'view') || Boolean(req.user.teacher_id);
}

router.get('/:id/history', asyncHandler(async (req, res) => {
  const db = getDb();
  const student = db.prepare(`${LIST_SELECT} WHERE s.id = ?`).get(req.params.id);
  if (!student) throw new HttpError(404, 'Student not found');
  if (!historyAllowed(req, db, student)) throw new HttpError(403, 'Not allowed');
  const h = studentHistory(db, student.id);
  if (!hasAccess(req, ['fees'], 'view') && scopeToParent(req, db) === null && req.user.role !== 'student') delete h.fees;
  res.json(h);
}));

async function statementPdf(db, student) {
  const h = studentHistory(db, student.id);
  const { schoolName, logoPath } = getBranding(db);
  return pdfService.renderPdf((doc) => {
    pdfService.drawHeader(doc, { schoolName, logoPath, subtitle: 'Student Statement — Fees & Attendance', badge: h.fees.totals.balance > 0 ? 'DUES' : 'CLEAR' });
    pdfService.drawInfoGrid(doc, [
      [['Student', `${student.full_name} (${student.student_code})`], ['Class', `${student.class_name || '-'} ${student.section_name || ''}`]],
      [['Guardian', student.parent_name || '-'], ['Phone', student.parent_phone || '-']],
      [['Total Billed', h.fees.totals.billed.toFixed(2)], ['Total Paid', h.fees.totals.paid.toFixed(2)]],
      [['Balance Due', h.fees.totals.balance.toFixed(2)], ['Attendance', h.attendance.totals.percent === null ? '-' : `${h.attendance.totals.percent}% (${h.attendance.totals.Present}/${h.attendance.totals.total} days)`]]
    ]);
    doc.font('Helvetica-Bold').fontSize(11).text('Fee History', pdfService.PAGE_LEFT, doc.y);
    doc.moveDown(0.3);
    pdfService.drawTable(doc, {
      columns: [{ key: 'period', label: 'Fee Month', width: 110 }, { key: 'voucher', label: 'Voucher', width: 80 }, { key: 'due', label: 'Due', width: 70 },
        { key: 'billed', label: 'Total', width: 65, align: 'right' }, { key: 'paid', label: 'Paid', width: 65, align: 'right' }, { key: 'balance', label: 'Balance', width: 65, align: 'right' }, { key: 'status', label: 'Status', width: 60 }],
      rows: h.fees.invoices.map((i) => ({ period: i.period_label, voucher: i.invoice_number, due: i.due_date, billed: i.billed.toFixed(2), paid: i.paid_amount.toFixed(2), balance: i.balance.toFixed(2), status: i.status }))
    });
    doc.font('Helvetica-Bold').fontSize(11).text('Attendance by Month', pdfService.PAGE_LEFT, doc.y);
    doc.moveDown(0.3);
    pdfService.drawTable(doc, {
      columns: [{ key: 'month', label: 'Month', width: 95 }, { key: 'p', label: 'Present', width: 70, align: 'center' }, { key: 'a', label: 'Absent', width: 70, align: 'center' },
        { key: 'l', label: 'Late', width: 70, align: 'center' }, { key: 'lv', label: 'Leave', width: 70, align: 'center' }, { key: 't', label: 'Days', width: 60, align: 'center' }, { key: 'pct', label: '%', width: 80, align: 'right' }],
      rows: h.attendance.months.map((m) => ({ month: m.month, p: m.Present, a: m.Absent, l: m.Late, lv: m.Leave, t: m.total, pct: m.percent === null ? '-' : `${m.percent}%` }))
    });
  });
}

router.get('/:id/statement.pdf', asyncHandler(async (req, res) => {
  const db = getDb();
  const student = db.prepare(`${LIST_SELECT} WHERE s.id = ?`).get(req.params.id);
  if (!student) throw new HttpError(404, 'Student not found');
  if (!historyAllowed(req, db, student) || (!hasAccess(req, 'fees', 'view') && scopeToParent(req, db) === null && req.user.role !== 'student')) throw new HttpError(403, 'Not allowed');
  pdfService.sendPdf(res, `statement-${student.student_code}.pdf`, await statementPdf(db, student));
}));

router.post('/:id/statement/send', requireAccess('fees', 'view'), asyncHandler(async (req, res) => {
  const db = getDb();
  const student = db.prepare(`${LIST_SELECT} WHERE s.id = ?`).get(req.params.id);
  if (!student) throw new HttpError(404, 'Student not found');
  const phone = (req.body && req.body.phone) || student.parent_phone;
  const email = (req.body && req.body.email) || student.parent_email;
  if (!phone && !email) throw new HttpError(400, 'No parent phone or email on file');
  const buffer = await statementPdf(db, student);
  const notificationService = require('../services/notifications/notificationService');
  const result = await notificationService.sendNotification({
    title: 'Student Statement', message: `Dear ${student.parent_name || 'Parent'}, the fee and attendance statement of ${student.full_name} is attached.`,
    category: 'FeeReminder', audienceType: 'Individual', audienceRef: JSON.stringify([{ name: student.parent_name, phone, email }]),
    channels: ['whatsapp', 'email'], createdBy: req.user.id,
    attachment: { buffer, fileName: `statement-${student.student_code}.pdf`, mimetype: 'application/pdf' }
  });
  recordAudit(req, 'send_statement', 'student', student.id, { summary: result.summary });
  res.json(result);
}));

router.get('/:id/id-card.pdf', asyncHandler(async (req, res) => {
  const db = getDb();
  const student = db.prepare(`${LIST_SELECT} WHERE s.id = ?`).get(req.params.id);
  if (!student) throw new HttpError(404, 'Student not found');
  const buffer = await buildIdCards(db, [student]);
  pdfService.sendPdf(res, `id-card-${student.student_code}.pdf`, buffer);
}));

module.exports = router;
