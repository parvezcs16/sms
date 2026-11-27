// School calendar: events, holidays, exams, meetings, PTMs. Everyone signed in
// sees the calendar (filtered to their audience); "Events & Calendar" access
// is needed to add or change entries.
const express = require('express');
const { getDb } = require('../db/connection');
const asyncHandler = require('../utils/asyncHandler');
const { requireAuth } = require('../middleware/auth');
const { hasAccess } = require('../middleware/permissions');
const { HttpError } = require('../middleware/errors');
const { mountCrud } = require('../utils/crud');
const { localDateStr } = require('../utils/localDate');

const router = express.Router();
router.use(requireAuth);

const KINDS = ['Event', 'Holiday', 'Exam', 'Meeting', 'PTM', 'Sports', 'Other'];
const AUDIENCES = ['All', 'Staff', 'Parents & Students'];

function audienceFor(req) {
  return ['parent', 'student'].includes(req.user.role) ? ['All', 'Parents & Students'] : AUDIENCES;
}

mountCrud({
  router,
  path: '/items',
  table: 'events',
  entity: 'event',
  withCreator: true,
  canView: () => true,
  canEdit: (req) => hasAccess(req, 'events', 'manage'),
  listSql: `SELECT t.*, u.full_name AS created_by_name FROM events t LEFT JOIN users u ON u.id = t.created_by WHERE t.archived = 0`,
  filters: {
    from: 'COALESCE(t.end_date, t.start_date) >= @from',
    to: 't.start_date <= @to',
    kind: 't.kind = @kind'
  },
  orderBy: "t.start_date, COALESCE(t.start_time, '')",
  afterList: (req, db, rows) => rows.filter((r) => audienceFor(req).includes(r.audience)),
  fields: {
    title: { required: true, max: 300 },
    description: { max: 4000 },
    start_date: { type: 'date', required: true, label: 'Date' },
    end_date: { type: 'date', label: 'End date' },
    start_time: { type: 'time', label: 'Time' },
    kind: { type: 'enum', values: KINDS, default: 'Event', label: 'Type' },
    audience: { type: 'enum', values: AUDIENCES, default: 'All' }
  },
  validate(db, d) {
    if (d.end_date && d.end_date < d.start_date) throw new HttpError(400, 'The end date is before the start date');
  },
  describe: (r) => ({ title: r.title, start_date: r.start_date })
});

router.get('/upcoming', asyncHandler(async (req, res) => {
  const today = localDateStr();
  const aud = audienceFor(req);
  const rows = getDb().prepare(
    `SELECT * FROM events WHERE archived = 0 AND COALESCE(end_date, start_date) >= ?
       AND audience IN (${aud.map(() => '?').join(',')}) ORDER BY start_date, COALESCE(start_time, '') LIMIT ?`
  ).all(today, ...aud, Math.min(50, Number(req.query.limit) || 6));
  res.json(rows);
}));

router.get('/meta', (req, res) => res.json({ kinds: KINDS, audiences: AUDIENCES, can_manage: hasAccess(req, 'events', 'manage') }));

module.exports = router;
