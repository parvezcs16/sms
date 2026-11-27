// Change history for one record (who changed what, and when), read from the
// audit log. Powers the "History" buttons on expenses, invoices, payments,
// payroll and people records.
const express = require('express');
const { getDb } = require('../db/connection');
const asyncHandler = require('../utils/asyncHandler');
const { requireAuth } = require('../middleware/auth');
const { hasAccess } = require('../middleware/permissions');
const { HttpError } = require('../middleware/errors');

const router = express.Router();
router.use(requireAuth);

const ALLOWED = new Set([
  'expense', 'fee_invoice', 'fee_payment', 'fee_structure', 'fee_head', 'fee_discount',
  'payroll_run', 'staff_payroll_run', 'salary_advances', 'staff_salary_advances',
  'student', 'teacher', 'staff', 'user', 'section', 'class', 'subject', 'room', 'period', 'question'
]);

const ENTITY_MODULE = {
  expense: 'expenses', fee_invoice: 'fees', fee_payment: 'fees', fee_structure: 'fees', fee_head: 'fees', fee_discount: 'fees',
  payroll_run: 'payroll', staff_payroll_run: 'payroll', salary_advances: 'payroll', staff_salary_advances: 'payroll',
  student: 'students', teacher: 'teachers', staff: 'staff', user: 'users', section: 'academics', class: 'academics',
  subject: 'academics', room: 'academics', period: 'timetable', question: 'exams'
};

router.get('/:entityType/:entityId', asyncHandler(async (req, res) => {
  const { entityType, entityId } = req.params;
  if (!ALLOWED.has(entityType)) throw new HttpError(400, 'History is not available for this kind of record');
  if (!hasAccess(req, ENTITY_MODULE[entityType], 'view')) throw new HttpError(403, "You don't have access to this record's history");
  const db = getDb();
  const rows = db.prepare(
    `SELECT a.id, a.action, a.username, u.full_name, a.details_json, a.created_at
     FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id
     WHERE a.entity_type = ? AND a.entity_id = ?
     ORDER BY a.created_at DESC, a.id DESC LIMIT 200`
  ).all(entityType, Number(entityId));
  // Payments on an invoice belong in the invoice's history too.
  let extra = [];
  if (entityType === 'fee_invoice') {
    extra = db.prepare(
      `SELECT a.id, a.action, a.username, u.full_name, a.details_json, a.created_at
       FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id
       WHERE a.entity_type = 'fee_payment' AND a.entity_id IN (SELECT id FROM fee_payments WHERE invoice_id = ?)
          OR (a.entity_type = 'fee_invoice' AND a.action = 'pay' AND a.entity_id = ?)`
    ).all(Number(entityId), -1);
  }
  const all = [...rows, ...extra]
    .map((r) => ({ ...r, details: r.details_json ? safeParse(r.details_json) : null, details_json: undefined }))
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)) || b.id - a.id);
  res.json(all);
}));

function safeParse(s) {
  try { return JSON.parse(s); } catch { return null; }
}

module.exports = router;
