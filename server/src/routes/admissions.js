// Admission enquiries / applications: from first contact to an admitted
// student. "Admit" opens the normal student form pre-filled; once the student
// is saved the enquiry is linked to them and marked Admitted.
const express = require('express');
const { getDb } = require('../db/connection');
const asyncHandler = require('../utils/asyncHandler');
const { requireAuth } = require('../middleware/auth');
const { recordAudit } = require('../middleware/audit');
const { hasAccess, requireAccess } = require('../middleware/permissions');
const { HttpError } = require('../middleware/errors');
const { mountCrud } = require('../utils/crud');

const router = express.Router();
router.use(requireAuth);

const STATUSES = ['New', 'Contacted', 'Test Scheduled', 'Approved', 'Admitted', 'Rejected', 'Withdrawn'];

mountCrud({
  router,
  path: '/enquiries',
  table: 'admission_enquiries',
  entity: 'admission_enquiry',
  withCreator: true,
  canView: (req) => hasAccess(req, 'admissions', 'view'),
  canEdit: (req) => hasAccess(req, 'admissions', 'manage'),
  listSql: `SELECT t.*, c.name AS class_name, u.full_name AS created_by_name, s.student_code
            FROM admission_enquiries t LEFT JOIN classes c ON c.id = t.class_id
            LEFT JOIN users u ON u.id = t.created_by LEFT JOIN students s ON s.id = t.student_id
            WHERE t.archived = 0`,
  filters: {
    status: 't.status = @status',
    class_id: 't.class_id = @class_id',
    search: '(t.full_name LIKE @search OR t.parent_name LIKE @search OR t.parent_phone LIKE @search)'
  },
  orderBy: 't.id DESC',
  fields: {
    full_name: { required: true, label: 'Student name' },
    gender: { type: 'enum', values: ['Male', 'Female', 'Other'] },
    date_of_birth: { type: 'date', label: 'Date of birth' },
    class_id: { type: 'ref', label: 'Class applied for' },
    parent_name: { label: 'Parent name' },
    parent_phone: { label: 'Parent phone' },
    parent_email: {},
    address: {},
    previous_school: {},
    source: {},
    status: { type: 'enum', values: STATUSES, default: 'New' },
    test_date: { type: 'date', label: 'Test / interview date' },
    test_result: {},
    notes: {}
  },
  describe: (r) => ({ full_name: r.full_name })
});

router.get('/stats', requireAccess('admissions', 'view'), asyncHandler(async (req, res) => {
  const rows = getDb().prepare('SELECT status, COUNT(*) AS c FROM admission_enquiries WHERE archived = 0 GROUP BY status').all();
  res.json({ statuses: STATUSES, counts: Object.fromEntries(rows.map((r) => [r.status, r.c])) });
}));

// Called after the student record has been created from this enquiry.
router.post('/enquiries/:id/admitted', requireAccess('admissions', 'manage'), asyncHandler(async (req, res) => {
  const db = getDb();
  const e = db.prepare('SELECT * FROM admission_enquiries WHERE id = ? AND archived = 0').get(req.params.id);
  if (!e) throw new HttpError(404, 'Enquiry not found');
  const studentId = Number(req.body && req.body.student_id);
  if (!studentId || !db.prepare('SELECT id FROM students WHERE id = ?').get(studentId)) throw new HttpError(400, 'Student not found');
  db.prepare("UPDATE admission_enquiries SET status = 'Admitted', student_id = ? WHERE id = ?").run(studentId, e.id);
  recordAudit(req, 'admit', 'admission_enquiry', e.id, { student_id: studentId });
  res.json({ success: true });
}));

module.exports = router;
module.exports.STATUSES = STATUSES;
