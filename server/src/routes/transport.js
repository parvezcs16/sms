// Transport: vehicles (with driver), routes (with stops and monthly fare) and
// which students use which route. A student's monthly transport fee is added
// to their fee invoices automatically when invoices are generated.
const express = require('express');
const { getDb } = require('../db/connection');
const asyncHandler = require('../utils/asyncHandler');
const { requireAuth } = require('../middleware/auth');
const { recordAudit } = require('../middleware/audit');
const { hasAccess, requireAccess } = require('../middleware/permissions');
const { HttpError } = require('../middleware/errors');
const { mountCrud } = require('../utils/crud');
const { localDateStr, DATE_RE } = require('../utils/localDate');

const router = express.Router();
router.use(requireAuth);

const canView = (req) => hasAccess(req, 'transport', 'view');
const canManage = (req) => hasAccess(req, 'transport', 'manage');

mountCrud({
  router,
  path: '/vehicles',
  table: 'transport_vehicles',
  entity: 'vehicle',
  canView,
  canEdit: canManage,
  listSql: `SELECT t.*, (SELECT GROUP_CONCAT(r.name, ', ') FROM transport_routes r WHERE r.vehicle_id = t.id AND r.archived = 0) AS routes
            FROM transport_vehicles t WHERE t.archived = 0`,
  orderBy: 't.vehicle_no',
  fields: {
    vehicle_no: { required: true, label: 'Vehicle number' },
    model: {}, capacity: { type: 'int', min: 1 },
    driver_name: {}, driver_phone: {}, driver_license: {}, conductor_name: {}, conductor_phone: {}
  },
  describe: (r) => ({ vehicle_no: r.vehicle_no })
});

const ACTIVE = (alias = 'st') => `(${alias}.end_date IS NULL OR ${alias}.end_date >= date('now', 'localtime'))`;

mountCrud({
  router,
  path: '/routes',
  table: 'transport_routes',
  entity: 'transport_route',
  canView,
  canEdit: canManage,
  listSql: `SELECT t.*, v.vehicle_no, v.capacity, v.driver_name, v.driver_phone,
              (SELECT COUNT(*) FROM student_transport st JOIN students s ON s.id = st.student_id
               WHERE st.route_id = t.id AND ${ACTIVE()} AND s.archived = 0 AND s.status NOT IN ('Left', 'Graduated')) AS students
            FROM transport_routes t LEFT JOIN transport_vehicles v ON v.id = t.vehicle_id WHERE t.archived = 0`,
  orderBy: 't.name',
  fields: {
    name: { required: true, label: 'Route name' },
    vehicle_id: { type: 'ref', label: 'Vehicle' },
    monthly_fee: { type: 'num', min: 0, default: 0, label: 'Monthly fee' },
    stops: { max: 4000 },
    morning_time: { type: 'time', label: 'Pick-up time' },
    return_time: { type: 'time', label: 'Drop-off time' }
  },
  beforeDelete(db, row) {
    const n = db.prepare(`SELECT COUNT(*) AS c FROM student_transport st WHERE st.route_id = ? AND ${ACTIVE()}`).get(row.id).c;
    if (n) throw new HttpError(400, `${n} student(s) still use this route — move or remove them first`);
  },
  describe: (r) => ({ name: r.name })
});

router.get('/students', requireAccess('transport', 'view'), asyncHandler(async (req, res) => {
  const { route_id = '', current = '1' } = req.query;
  const rows = getDb().prepare(
    `SELECT st.*, s.full_name, s.student_code, s.roll_number, c.name AS class_name, sec.name AS section_name,
            p.full_name AS parent_name, p.phone AS parent_phone, r.name AS route_name, r.monthly_fee AS route_fee,
            COALESCE(st.monthly_fee, r.monthly_fee) AS fee
     FROM student_transport st JOIN students s ON s.id = st.student_id JOIN transport_routes r ON r.id = st.route_id
     LEFT JOIN sections sec ON sec.id = s.section_id LEFT JOIN classes c ON c.id = sec.class_id LEFT JOIN parents p ON p.id = s.parent_id
     WHERE (@route_id = '' OR st.route_id = @route_id)
       AND (@current = '0' OR (${ACTIVE()} AND s.archived = 0 AND s.status NOT IN ('Left', 'Graduated')))
     ORDER BY r.name, c.sort_order, s.full_name`
  ).all({ route_id, current });
  res.json(rows);
}));

// Assigning a student ends any route they were on the day before.
router.post('/students', requireAccess('transport', 'manage'), asyncHandler(async (req, res) => {
  const db = getDb();
  const { student_id, route_id, stop } = req.body || {};
  const start = req.body.start_date || localDateStr();
  if (!DATE_RE.test(start)) throw new HttpError(400, 'Start date must be YYYY-MM-DD');
  const st = db.prepare("SELECT id, full_name FROM students WHERE id = ? AND archived = 0 AND status NOT IN ('Left', 'Graduated')").get(student_id);
  if (!st) throw new HttpError(400, 'Choose a current student');
  const route = db.prepare('SELECT * FROM transport_routes WHERE id = ? AND archived = 0').get(route_id);
  if (!route) throw new HttpError(400, 'Choose a route');
  const fee = req.body.monthly_fee === undefined || req.body.monthly_fee === '' || req.body.monthly_fee === null ? null : Number(req.body.monthly_fee);
  if (fee !== null && !(fee >= 0)) throw new HttpError(400, 'Fee must be 0 or more');
  const dayBefore = localDateStr(new Date(new Date(`${start}T00:00:00`).getTime() - 86400000));
  db.prepare(`UPDATE student_transport SET end_date = ? WHERE student_id = ? AND (end_date IS NULL OR end_date >= ?)`).run(dayBefore, st.id, start);
  const r = db.prepare('INSERT INTO student_transport (student_id, route_id, stop, monthly_fee, start_date, created_by) VALUES (?, ?, ?, ?, ?, ?)')
    .run(st.id, route.id, stop || null, fee, start, req.user.id);
  recordAudit(req, 'assign_transport', 'student', st.id, { route: route.name, start, fee });
  res.status(201).json({ id: Number(r.lastInsertRowid) });
}));

router.put('/students/:id', requireAccess('transport', 'manage'), asyncHandler(async (req, res) => {
  const db = getDb();
  const a = db.prepare('SELECT * FROM student_transport WHERE id = ?').get(req.params.id);
  if (!a) throw new HttpError(404, 'Not found');
  const b = req.body || {};
  const end = b.end_date === undefined ? a.end_date : (b.end_date || null);
  if (end && (!DATE_RE.test(end) || end < a.start_date)) throw new HttpError(400, 'End date must be on or after the start date');
  const fee = b.monthly_fee === undefined ? a.monthly_fee : (b.monthly_fee === '' || b.monthly_fee === null ? null : Number(b.monthly_fee));
  if (fee !== null && !(fee >= 0)) throw new HttpError(400, 'Fee must be 0 or more');
  db.prepare('UPDATE student_transport SET stop = ?, monthly_fee = ?, end_date = ? WHERE id = ?')
    .run(b.stop === undefined ? a.stop : (b.stop || null), fee, end, a.id);
  recordAudit(req, 'update_transport', 'student', a.student_id, { before: a, after: { stop: b.stop, fee, end } });
  res.json({ success: true });
}));

module.exports = router;
