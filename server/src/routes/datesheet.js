// Exam date sheet: which subject's paper is on which day and time, per class.
const express = require('express');
const PDFDocument = require('pdfkit');
const { dmyDoc } = require('../utils/dmy');
const { getDb } = require('../db/connection');
const asyncHandler = require('../utils/asyncHandler');
const { requireAuth } = require('../middleware/auth');
const { hasAccess } = require('../middleware/permissions');
const { HttpError } = require('../middleware/errors');
const { mountCrud } = require('../utils/crud');
const { localDateStr } = require('../utils/localDate');
const { familySectionIds } = require('../utils/teacherScope');
const pdf = require('../services/pdf');
const { getBranding } = require('../services/settings');

const router = express.Router();
router.use(requireAuth);

const isStaff = (req) => !['parent', 'student'].includes(req.user.role);
const canManage = (req) => hasAccess(req, 'results', 'manage') || hasAccess(req, 'exams', 'manage');

const LIST_SQL = `SELECT t.*, c.name AS class_name, c.sort_order, sub.name AS subject_name, et.name AS term_name
  FROM exam_schedule t JOIN classes c ON c.id = t.class_id JOIN subjects sub ON sub.id = t.subject_id
  LEFT JOIN exam_terms et ON et.id = t.term_id WHERE t.archived = 0`;

mountCrud({
  router,
  path: '/entries',
  table: 'exam_schedule',
  entity: 'date_sheet',
  withCreator: true,
  canView: isStaff,
  canEdit: canManage,
  listSql: LIST_SQL,
  filters: { term_id: 't.term_id = @term_id', class_id: 't.class_id = @class_id' },
  orderBy: "t.exam_date, COALESCE(t.start_time, ''), c.sort_order",
  fields: {
    term_id: { type: 'ref', label: 'Exam' },
    class_id: { type: 'ref', required: true, label: 'Class' },
    subject_id: { type: 'ref', required: true, label: 'Subject' },
    exam_date: { type: 'date', required: true, label: 'Date' },
    start_time: { type: 'time', label: 'Starts' },
    end_time: { type: 'time', label: 'Ends' },
    room: {},
    invigilator: {},
    notes: {}
  },
  validate(db, d) {
    if (d.start_time && d.end_time && d.end_time <= d.start_time) throw new HttpError(400, 'The end time must be after the start time');
    const clash = db.prepare(
      `SELECT sub.name FROM exam_schedule t JOIN subjects sub ON sub.id = t.subject_id
       WHERE t.archived = 0 AND t.class_id = ? AND t.exam_date = ? AND t.id <> ?
         AND (? IS NULL OR t.start_time IS NULL OR (t.start_time < COALESCE(?, '99:99') AND COALESCE(t.end_time, '99:99') > ?))`
    ).get(d.class_id, d.exam_date, d.id || 0, d.start_time || null, d.end_time || null, d.start_time || '00:00');
    if (clash) throw new HttpError(400, `This class already has the ${clash.name} paper at that time on ${d.exam_date}`);
  }
});

// Upcoming papers for a parent's children / a student.
router.get('/my', asyncHandler(async (req, res) => {
  const db = getDb();
  const sections = familySectionIds(db, req.user);
  if (!sections.length) return res.json([]);
  const classIds = db.prepare(`SELECT DISTINCT class_id FROM sections WHERE id IN (${sections.map(() => '?').join(',')})`).all(...sections).map((r) => r.class_id);
  const rows = db.prepare(`${LIST_SQL} AND t.class_id IN (${classIds.map(() => '?').join(',')}) AND t.exam_date >= ? ORDER BY t.exam_date, t.start_time LIMIT 60`)
    .all(...classIds, localDateStr());
  res.json(rows);
}));

const fmtDate = (d) => {
  const dt = new Date(`${d}T00:00:00`);
  return `${dt.toLocaleDateString('en-GB', { weekday: 'short' })} ${d.slice(8, 10)}-${d.slice(5, 7)}-${d.slice(0, 4)}`;
};

// One page per class: Date | Day | Subject | Time | Room.
router.get('/print.pdf', asyncHandler(async (req, res) => {
  if (!isStaff(req)) throw new HttpError(403, 'Not allowed');
  const db = getDb();
  const { term_id = '', class_id = '' } = req.query;
  const rows = db.prepare(`${LIST_SQL} AND (@term_id = '' OR t.term_id = @term_id) AND (@class_id = '' OR t.class_id = @class_id)
    ORDER BY c.sort_order, c.name, t.exam_date, t.start_time`).all({ term_id, class_id });
  if (!rows.length) throw new HttpError(404, 'No papers on the date sheet yet');
  const term = term_id ? db.prepare('SELECT name FROM exam_terms WHERE id = ?').get(term_id) : null;
  const { schoolName, logoPath } = getBranding(db);
  const byClass = new Map();
  rows.forEach((r) => { if (!byClass.has(r.class_id)) byClass.set(r.class_id, []); byClass.get(r.class_id).push(r); });
  const buffer = await new Promise((resolve, reject) => {
    const doc = dmyDoc(new PDFDocument({ margin: 40, size: 'A4' }));
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    [...byClass.values()].forEach((list, i) => {
      if (i > 0) doc.addPage();
      pdf.drawHeader(doc, { schoolName, logoPath, subtitle: `Date Sheet — ${term ? term.name : (list[0].term_name || 'Examinations')}`, badge: list[0].class_name });
      pdf.drawTable(doc, {
        columns: [
          { key: 'date', label: 'Date', width: 110 },
          { key: 'subject', label: 'Subject', width: 150 },
          { key: 'time', label: 'Time', width: 100 },
          { key: 'room', label: 'Room', width: 70 },
          { key: 'inv', label: 'Invigilator', width: 85 }
        ],
        rows: list.map((r) => ({
          date: fmtDate(r.exam_date), subject: r.subject_name,
          time: r.start_time ? `${r.start_time}${r.end_time ? ` - ${r.end_time}` : ''}` : '-', room: r.room || '-', inv: r.invigilator || '-'
        }))
      });
      const notes = list.filter((r) => r.notes).map((r) => `${r.subject_name}: ${r.notes}`);
      if (notes.length) doc.font('Helvetica').fontSize(9).fillColor('#444').text(notes.join('\n'), pdf.PAGE_LEFT, doc.y).fillColor('#000');
      doc.moveDown();
      doc.font('Helvetica-Oblique').fontSize(9).fillColor('#555').text('Students must reach school 15 minutes before each paper and bring their admit/ID card.', pdf.PAGE_LEFT, doc.y).fillColor('#000');
    });
    doc.end();
  });
  pdf.sendPdf(res, 'date-sheet.pdf', buffer);
}));

module.exports = router;
