const express = require('express');
const { getDb } = require('../db/connection');
const asyncHandler = require('../utils/asyncHandler');
const { requireAuth, requireRole, ROLE_GROUPS } = require('../middleware/auth');
const { recordAudit } = require('../middleware/audit');
const { requireAccess, requireAccessAny, hasAccess, isManagement } = require('../middleware/permissions');
const { HttpError } = require('../middleware/errors');

const router = express.Router();
router.use(requireAuth);

router.get('/', requireAccess(['students', 'communication'], 'view'), asyncHandler(async (req, res) => {
  const db = getDb();
  const { search = '' } = req.query;
  const q = `%${search}%`;
  res.json(db.prepare(
    `SELECT * FROM parents WHERE full_name LIKE ? OR phone LIKE ? OR email LIKE ? ORDER BY full_name LIMIT 50`
  ).all(q, q, q));
}));

router.get('/:id/students', asyncHandler(async (req, res) => {
  const db = getDb();
  if (req.user.role === 'parent') {
    const owned = db.prepare('SELECT id FROM parents WHERE user_id = ?').get(req.user.id);
    if (!owned || Number(owned.id) !== Number(req.params.id)) throw new HttpError(403, 'Not your record');
  }
  const rows = db.prepare(
    `SELECT s.*, c.name AS class_name, sec.name AS section_name
     FROM students s LEFT JOIN sections sec ON sec.id = s.section_id LEFT JOIN classes c ON c.id = sec.class_id
     WHERE s.parent_id = ? OR s.secondary_parent_id = ?`
  ).all(req.params.id, req.params.id);
  res.json(rows);
}));

router.post('/', requireAccess('students', 'manage'), asyncHandler(async (req, res) => {
  const { full_name, relation, phone, email, occupation, address } = req.body;
  if (!full_name) throw new HttpError(400, 'full_name is required');
  const result = getDb().prepare(
    'INSERT INTO parents (full_name, relation, phone, email, occupation, address) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(full_name, relation || 'Guardian', phone || null, email || null, occupation || null, address || null);
  recordAudit(req, 'create', 'parent', Number(result.lastInsertRowid));
  res.status(201).json({ id: Number(result.lastInsertRowid) });
}));

router.put('/:id', requireAccess('students', 'manage'), asyncHandler(async (req, res) => {
  const { full_name, relation, phone, email, occupation, address } = req.body;
  getDb().prepare(
    `UPDATE parents SET full_name = COALESCE(?, full_name), relation = ?, phone = ?, email = ?, occupation = ?, address = ? WHERE id = ?`
  ).run(full_name || null, relation || null, phone || null, email || null, occupation || null, address || null, req.params.id);
  recordAudit(req, 'update', 'parent', Number(req.params.id));
  res.json({ success: true });
}));

module.exports = router;
