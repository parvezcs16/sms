const express = require('express');
const { getDb } = require('../db/connection');
const asyncHandler = require('../utils/asyncHandler');
const { requireAuth, requireRole, ROLE_GROUPS } = require('../middleware/auth');
const { recordAudit } = require('../middleware/audit');
const { requireAccess, requireAccessAny, hasAccess, isManagement } = require('../middleware/permissions');
const { HttpError } = require('../middleware/errors');
const pdfService = require('../services/pdf');
const docxService = require('../services/docxExport');
const { getBranding } = require('../services/settings');
const { runInTransaction } = require('../utils/tx');

const router = express.Router();
router.use(requireAuth);

const TEACHER_PLUS = [...ROLE_GROUPS.management, 'teacher'];

// ---- Question bank ----
router.get('/questions', requireAccess('exams', 'view'), asyncHandler(async (req, res) => {
  const db = getDb();
  const { subject_id = '', class_id = '', chapter = '', difficulty = '', question_type = '', search = '' } = req.query;
  const q = `%${search}%`;
  const rows = db.prepare(
    `SELECT qb.*, sub.name AS subject_name, c.name AS class_name FROM question_bank qb
     JOIN subjects sub ON sub.id = qb.subject_id
     LEFT JOIN classes c ON c.id = qb.class_id
     WHERE qb.archived = 0
       AND (@subject_id = '' OR qb.subject_id = @subject_id)
       AND (@class_id = '' OR qb.class_id = @class_id)
       AND (@chapter = '' OR qb.chapter = @chapter)
       AND (@difficulty = '' OR qb.difficulty = @difficulty)
       AND (@question_type = '' OR qb.question_type = @question_type)
       AND (@search = '' OR qb.question_text LIKE @q)
     ORDER BY qb.id DESC`
  ).all({ subject_id, class_id, chapter, difficulty, question_type, search, q });
  res.json(rows);
}));

router.post('/questions', requireAccess('exams', 'manage'), asyncHandler(async (req, res) => {
  const { subject_id, class_id, chapter, topic, difficulty, marks, question_type, question_text, options, correct_answer } = req.body;
  if (!subject_id || !question_type || !question_text || !marks) {
    throw new HttpError(400, 'subject_id, question_type, question_text and marks are required');
  }
  const db = getDb();
  const result = db.prepare(
    `INSERT INTO question_bank (subject_id, class_id, chapter, topic, difficulty, marks, question_type, question_text, options_json, correct_answer, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(subject_id, class_id || null, chapter || null, topic || null, difficulty || 'Medium', marks, question_type, question_text, options ? JSON.stringify(options) : null, correct_answer || null, req.user.id);
  recordAudit(req, 'create', 'question', Number(result.lastInsertRowid));
  res.status(201).json({ id: Number(result.lastInsertRowid) });
}));

// Only the fields sent are changed (the old version wiped chapter/topic/options
// whenever they weren't included).
router.put('/questions/:id', requireAccess('exams', 'manage'), asyncHandler(async (req, res) => {
  const db = getDb();
  const body = { ...(req.body || {}) };
  if (!db.prepare('SELECT id FROM question_bank WHERE id = ?').get(req.params.id)) throw new HttpError(404, 'Question not found');
  if (Object.prototype.hasOwnProperty.call(body, 'options')) {
    body.options_json = Array.isArray(body.options) && body.options.length ? JSON.stringify(body.options) : null;
  }
  if (body.marks !== undefined && !(Number(body.marks) > 0)) throw new HttpError(400, 'Marks must be more than 0');
  const fields = ['subject_id', 'class_id', 'chapter', 'topic', 'difficulty', 'marks', 'question_type', 'question_text', 'options_json', 'correct_answer'];
  const sets = [];
  const values = [];
  for (const f of fields) {
    if (!Object.prototype.hasOwnProperty.call(body, f)) continue;
    let v = body[f];
    if (typeof v === 'string') v = v.trim();
    if (v === '') v = null;
    if (v === null && ['subject_id', 'difficulty', 'marks', 'question_type', 'question_text'].includes(f)) continue;
    sets.push(`${f} = ?`);
    values.push(v);
  }
  if (sets.length) db.prepare(`UPDATE question_bank SET ${sets.join(', ')} WHERE id = ?`).run(...values, req.params.id);
  recordAudit(req, 'update', 'question', Number(req.params.id), { fields: Object.keys(req.body || {}) });
  res.json({ success: true });
}));

router.delete('/questions/:id', requireAccess('exams', 'manage'), asyncHandler(async (req, res) => {
  getDb().prepare('UPDATE question_bank SET archived = 1 WHERE id = ?').run(req.params.id);
  recordAudit(req, 'archive', 'question', Number(req.params.id));
  res.json({ success: true });
}));

// ---- Exam paper generator ----
function shuffle(arr) {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

router.post('/papers/generate', requireAccess('exams', 'manage'), asyncHandler(async (req, res) => {
  const { title, class_id, subject_id, term, total_marks, num_questions, chapters, topics, duration_minutes, instructions, scheduled_date, randomize = true } = req.body;
  if (!title || !subject_id || !total_marks || !num_questions) {
    throw new HttpError(400, 'title, subject_id, total_marks and num_questions are required');
  }
  const db = getDb();

  let pool = db.prepare(
    `SELECT * FROM question_bank WHERE archived = 0 AND subject_id = ? AND (? IS NULL OR class_id = ?)`
  ).all(subject_id, class_id || null, class_id || null);

  if (Array.isArray(chapters) && chapters.length) pool = pool.filter((q) => chapters.includes(q.chapter));
  if (Array.isArray(topics) && topics.length) pool = pool.filter((q) => topics.includes(q.topic));
  if (pool.length === 0) throw new HttpError(400, 'No questions in the question bank match these filters');

  pool = randomize ? shuffle(pool) : pool;

  const selected = [];
  let marksSoFar = 0;
  for (const question of pool) {
    if (selected.length >= num_questions) break;
    if (marksSoFar + question.marks > total_marks && selected.length > 0) continue;
    selected.push(question);
    marksSoFar += question.marks;
  }
  if (selected.length === 0) throw new HttpError(400, 'Could not fit any questions within the given total marks');

  const paperResult = db.prepare(
    `INSERT INTO exam_papers (title, class_id, subject_id, term, total_marks, duration_minutes, instructions, scheduled_date, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(title, class_id || null, subject_id, term || null, marksSoFar, duration_minutes || 60, instructions || null, scheduled_date || null, req.user.id);
  const paperId = Number(paperResult.lastInsertRowid);

  const insertPq = db.prepare('INSERT INTO exam_paper_questions (exam_paper_id, question_id, order_index) VALUES (?, ?, ?)');
  selected.forEach((q, idx) => insertPq.run(paperId, q.id, idx));

  recordAudit(req, 'generate', 'exam_paper', paperId, { question_count: selected.length, total_marks: marksSoFar });
  res.status(201).json({ id: paperId, total_marks: marksSoFar, question_count: selected.length });
}));

// ---- Build a paper from questions the teacher picked ----
// questions: [{ id, marks }] in the order they should appear. Only these
// questions go on the paper; total marks are the sum of the marks set here.
function validatePaperBody(db, body) {
  const { title, subject_id, questions } = body || {};
  if (!String(title || '').trim()) throw new HttpError(400, 'Please give the paper a title');
  if (!subject_id) throw new HttpError(400, 'Please select the subject');
  if (!Array.isArray(questions) || questions.length === 0) throw new HttpError(400, 'Select at least one question for the paper');
  const seen = new Set();
  const list = questions.map((q, i) => {
    const id = Number(q && q.id);
    if (!id || seen.has(id)) throw new HttpError(400, `Question ${i + 1} is missing or repeated`);
    seen.add(id);
    const row = db.prepare('SELECT id, marks, subject_id FROM question_bank WHERE id = ?').get(id);
    if (!row) throw new HttpError(400, `Question #${id} is no longer in the question bank`);
    const marks = q.marks === undefined || q.marks === '' || q.marks === null ? row.marks : Number(q.marks);
    if (!(marks > 0)) throw new HttpError(400, `Marks for question ${i + 1} must be more than 0`);
    return { id, marks, override: marks !== row.marks ? marks : null };
  });
  return list;
}

function savePaperQuestions(db, paperId, list) {
  db.prepare('DELETE FROM exam_paper_questions WHERE exam_paper_id = ?').run(paperId);
  const ins = db.prepare('INSERT INTO exam_paper_questions (exam_paper_id, question_id, marks_override, order_index) VALUES (?, ?, ?, ?)');
  list.forEach((q, idx) => ins.run(paperId, q.id, q.override, idx));
}

router.post('/papers', requireAccess('exams', 'manage'), asyncHandler(async (req, res) => {
  const db = getDb();
  const list = validatePaperBody(db, req.body);
  const b = req.body;
  const total = list.reduce((sum, q) => sum + q.marks, 0);
  let paperId;
  runInTransaction(db, () => {
    const r = db.prepare(
      `INSERT INTO exam_papers (title, class_id, subject_id, term, total_marks, duration_minutes, instructions, scheduled_date, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(String(b.title).trim(), b.class_id || null, b.subject_id, b.term || null, total, Number(b.duration_minutes) || 60, b.instructions || null, b.scheduled_date || null, req.user.id);
    paperId = Number(r.lastInsertRowid);
    savePaperQuestions(db, paperId, list);
  });
  recordAudit(req, 'create', 'exam_paper', paperId, { question_count: list.length, total_marks: total });
  res.status(201).json({ id: paperId, total_marks: total, question_count: list.length });
}));

router.put('/papers/:id', requireAccess('exams', 'manage'), asyncHandler(async (req, res) => {
  const db = getDb();
  const paper = db.prepare('SELECT * FROM exam_papers WHERE id = ?').get(req.params.id);
  if (!paper) throw new HttpError(404, 'Exam paper not found');
  const list = validatePaperBody(db, req.body);
  const b = req.body;
  const total = list.reduce((sum, q) => sum + q.marks, 0);
  runInTransaction(db, () => {
    db.prepare(
      `UPDATE exam_papers SET title = ?, class_id = ?, subject_id = ?, term = ?, total_marks = ?, duration_minutes = ?, instructions = ?, scheduled_date = ? WHERE id = ?`
    ).run(String(b.title).trim(), b.class_id || null, b.subject_id, b.term || null, total, Number(b.duration_minutes) || 60, b.instructions || null, b.scheduled_date || null, paper.id);
    savePaperQuestions(db, paper.id, list);
  });
  recordAudit(req, 'update', 'exam_paper', paper.id, { question_count: list.length, total_marks: total });
  res.json({ id: paper.id, total_marks: total, question_count: list.length });
}));

router.get('/papers', requireAccess('exams', 'view'), asyncHandler(async (req, res) => {
  const db = getDb();
  const rows = db.prepare(
    `SELECT ep.*, sub.name AS subject_name, c.name AS class_name,
            (SELECT COUNT(*) FROM exam_paper_questions WHERE exam_paper_id = ep.id) AS question_count
     FROM exam_papers ep
     LEFT JOIN subjects sub ON sub.id = ep.subject_id
     LEFT JOIN classes c ON c.id = ep.class_id
     ORDER BY ep.id DESC`
  ).all();
  res.json(rows);
}));

function loadPaperWithQuestions(db, paperId) {
  const paper = db.prepare(
    `SELECT ep.*, sub.name AS subject_name, c.name AS class_name FROM exam_papers ep
     LEFT JOIN subjects sub ON sub.id = ep.subject_id
     LEFT JOIN classes c ON c.id = ep.class_id
     WHERE ep.id = ?`
  ).get(paperId);
  if (!paper) return null;
  const questions = db.prepare(
    `SELECT qb.*, epq.marks_override, epq.order_index FROM exam_paper_questions epq
     JOIN question_bank qb ON qb.id = epq.question_id
     WHERE epq.exam_paper_id = ? ORDER BY epq.order_index`
  ).all(paperId);
  return { paper, questions };
}

router.get('/papers/:id', requireAccess('exams', 'view'), asyncHandler(async (req, res) => {
  const data = loadPaperWithQuestions(getDb(), req.params.id);
  if (!data) throw new HttpError(404, 'Exam paper not found');
  res.json({ ...data.paper, questions: data.questions });
}));

router.delete('/papers/:id', requireAccess('exams', 'manage'), asyncHandler(async (req, res) => {
  const db = getDb();
  db.prepare('DELETE FROM exam_paper_questions WHERE exam_paper_id = ?').run(req.params.id);
  db.prepare('DELETE FROM exam_papers WHERE id = ?').run(req.params.id);
  recordAudit(req, 'delete', 'exam_paper', Number(req.params.id));
  res.json({ success: true });
}));

router.get('/papers/:id/pdf', requireAccess('exams', 'view'), asyncHandler(async (req, res) => {
  const db = getDb();
  const data = loadPaperWithQuestions(db, req.params.id);
  if (!data) throw new HttpError(404, 'Exam paper not found');
  const { schoolName, logoPath } = getBranding(db);
  const buffer = await pdfService.examPaperPdf({ schoolName, logoPath, paper: data.paper, questions: data.questions });
  pdfService.sendPdf(res, `exam-${req.params.id}.pdf`, buffer);
}));

router.get('/papers/:id/docx', requireAccess('exams', 'view'), asyncHandler(async (req, res) => {
  const db = getDb();
  const data = loadPaperWithQuestions(db, req.params.id);
  if (!data) throw new HttpError(404, 'Exam paper not found');
  const { schoolName, logoPath } = getBranding(db);
  const buffer = await docxService.examPaperDocx({ schoolName, paper: data.paper, questions: data.questions });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  res.setHeader('Content-Disposition', `attachment; filename="exam-${req.params.id}.docx"`);
  res.send(Buffer.from(buffer));
}));

module.exports = router;
