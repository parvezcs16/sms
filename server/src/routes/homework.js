// Homework (per section & subject) and syllabus coverage (per class & subject).
// Teachers manage the classes / subjects they teach; "Homework & Syllabus"
// access covers every class. Parents and students see their own homework.
const express = require('express');
const { getDb } = require('../db/connection');
const asyncHandler = require('../utils/asyncHandler');
const { requireAuth } = require('../middleware/auth');
const { hasAccess } = require('../middleware/permissions');
const { HttpError } = require('../middleware/errors');
const { mountCrud } = require('../utils/crud');
const { localDateStr } = require('../utils/localDate');
const { teacherSectionIds, teacherTeaches, teacherTeachesClass, familySectionIds } = require('../utils/teacherScope');

const router = express.Router();
router.use(requireAuth);

const SYLLABUS_STATUSES = ['Pending', 'In Progress', 'Completed'];

const anyAccess = (req) => hasAccess(req, 'homework', 'view') || Boolean(req.user.teacher_id);

function sectionScopeFilter(req, db, rows) {
  if (hasAccess(req, 'homework', 'view')) return rows;
  const mine = teacherSectionIds(db, req.user.teacher_id);
  return rows.filter((r) => mine.has(r.section_id));
}

mountCrud({
  router,
  path: '/items',
  table: 'homework',
  entity: 'homework',
  withCreator: true,
  canView: anyAccess,
  canEdit: (req, row, db) => hasAccess(req, 'homework', 'manage') || (row.section_id && row.subject_id && teacherTeaches(db, req.user.teacher_id, row.section_id, row.subject_id)),
  listSql: `SELECT t.*, sub.name AS subject_name, c.name AS class_name, sec.name AS section_name, u.full_name AS created_by_name
            FROM homework t JOIN subjects sub ON sub.id = t.subject_id
            JOIN sections sec ON sec.id = t.section_id JOIN classes c ON c.id = sec.class_id
            LEFT JOIN users u ON u.id = t.created_by WHERE t.archived = 0`,
  filters: {
    section_id: 't.section_id = @section_id',
    subject_id: 't.subject_id = @subject_id',
    from: 't.assigned_on >= @from',
    to: 't.assigned_on <= @to'
  },
  orderBy: 't.assigned_on DESC, t.id DESC',
  afterList: sectionScopeFilter,
  fields: {
    section_id: { type: 'ref', required: true, label: 'Class' },
    subject_id: { type: 'ref', required: true, label: 'Subject' },
    title: { required: true, max: 300 },
    details: { max: 8000 },
    assigned_on: { type: 'date', required: true, default: () => localDateStr(), label: 'Date' },
    due_date: { type: 'date', label: 'Due date' }
  },
  validate(db, d) {
    if (d.due_date && d.assigned_on && d.due_date < d.assigned_on) throw new HttpError(400, 'The due date is before the homework date');
  },
  describe: (r) => ({ title: r.title, assigned_on: r.assigned_on })
});

// Homework for the people who do it: a parent's children, a student, or a teacher's classes.
router.get('/my', asyncHandler(async (req, res) => {
  const db = getDb();
  let sections = familySectionIds(db, req.user);
  if (!sections.length && req.user.teacher_id) sections = [...teacherSectionIds(db, req.user.teacher_id)];
  if (!sections.length) return res.json([]);
  const since = localDateStr(new Date(Date.now() - 21 * 86400000));
  const rows = db.prepare(
    `SELECT t.*, sub.name AS subject_name, c.name AS class_name, sec.name AS section_name
     FROM homework t JOIN subjects sub ON sub.id = t.subject_id
     JOIN sections sec ON sec.id = t.section_id JOIN classes c ON c.id = sec.class_id
     WHERE t.archived = 0 AND t.section_id IN (${sections.map(() => '?').join(',')})
       AND (t.assigned_on >= ? OR t.due_date >= ?)
     ORDER BY t.assigned_on DESC, t.id DESC LIMIT 100`
  ).all(...sections, since, localDateStr());
  res.json(rows);
}));

// ---- Syllabus ----
mountCrud({
  router,
  path: '/syllabus',
  table: 'syllabus_topics',
  entity: 'syllabus_topic',
  withCreator: true,
  canView: anyAccess,
  canEdit: (req, row, db) => hasAccess(req, 'homework', 'manage') || (row.class_id && row.subject_id && teacherTeachesClass(db, req.user.teacher_id, row.class_id, row.subject_id)),
  listSql: `SELECT t.*, sub.name AS subject_name, c.name AS class_name
            FROM syllabus_topics t JOIN subjects sub ON sub.id = t.subject_id JOIN classes c ON c.id = t.class_id
            WHERE t.archived = 0`,
  filters: {
    class_id: 't.class_id = @class_id',
    subject_id: 't.subject_id = @subject_id',
    term: 't.term = @term',
    status: 't.status = @status'
  },
  orderBy: "c.sort_order, sub.name, COALESCE(t.planned_from, '9999'), t.id",
  afterList(req, db, rows) {
    if (hasAccess(req, 'homework', 'view')) return rows;
    const mine = teacherSectionIds(db, req.user.teacher_id);
    const classIds = new Set(db.prepare(`SELECT class_id FROM sections WHERE id IN (${[...mine].map(() => '?').join(',') || 'NULL'})`).all(...mine).map((r) => r.class_id));
    return rows.filter((r) => classIds.has(r.class_id));
  },
  fields: {
    class_id: { type: 'ref', required: true, label: 'Class' },
    subject_id: { type: 'ref', required: true, label: 'Subject' },
    term: {},
    unit: { label: 'Unit / chapter' },
    topic: { required: true, max: 500 },
    planned_from: { type: 'date' },
    planned_to: { type: 'date' },
    status: { type: 'enum', values: SYLLABUS_STATUSES, default: 'Pending' },
    completed_on: { type: 'date' },
    notes: {}
  },
  validate(db, d) {
    if (d.status === 'Completed' && !d.completed_on) d.completed_on = localDateStr();
    if (d.status !== 'Completed') d.completed_on = null;
  },
  describe: (r) => ({ topic: r.topic })
});

// Coverage per class & subject: how many topics are done.
router.get('/syllabus-progress', asyncHandler(async (req, res) => {
  if (!anyAccess(req) && !familySectionIds(getDb(), req.user).length) throw new HttpError(403, "You don't have access to the syllabus");
  const db = getDb();
  const rows = db.prepare(
    `SELECT t.class_id, c.name AS class_name, t.subject_id, sub.name AS subject_name,
            COUNT(*) AS topics, SUM(CASE WHEN t.status = 'Completed' THEN 1 ELSE 0 END) AS completed,
            SUM(CASE WHEN t.status = 'In Progress' THEN 1 ELSE 0 END) AS in_progress,
            SUM(CASE WHEN t.status <> 'Completed' AND t.planned_to IS NOT NULL AND t.planned_to < @today THEN 1 ELSE 0 END) AS behind
     FROM syllabus_topics t JOIN classes c ON c.id = t.class_id JOIN subjects sub ON sub.id = t.subject_id
     WHERE t.archived = 0 GROUP BY t.class_id, t.subject_id ORDER BY c.sort_order, sub.name`
  ).all({ today: localDateStr() });
  res.json(rows);
}));

// ---- Share on WhatsApp (the class diary, one homework, or the syllabus) ----
// Goes to each parent's own WhatsApp and/or the class WhatsApp group, from the
// school's linked WhatsApp number. Without linking, the page can still open
// WhatsApp with the text ready to send.
const whatsappService = require('../services/notifications/whatsappService');
const notificationService = require('../services/notifications/notificationService');
const { getSetting, setSetting } = require('../services/settings');
const { recordAudit } = require('../middleware/audit');
const { localDateTimeStr } = require('../utils/people');

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const prettyDate = (d, withDay = false) => {
  if (!d) return '';
  const [y, m, day] = String(d).slice(0, 10).split('-').map(Number);
  const dt = new Date(y, m - 1, day);
  return `${withDay ? `${WEEKDAYS[dt.getDay()]}, ` : ''}${day} ${MONTHS[m - 1]} ${y}`;
};
const GROUP_RE = /^[\d-]+@g\.us$/;

function groupMap(db) {
  try { return JSON.parse(getSetting(db, 'wa_section_groups', '{}')) || {}; } catch { return {}; }
}

function sectionRows(db, ids) {
  if (!ids.length) return [];
  return db.prepare(`SELECT sec.id, sec.class_id, c.name AS class_name, sec.name AS section_name FROM sections sec JOIN classes c ON c.id = sec.class_id
    WHERE sec.id IN (${ids.map(() => '?').join(',')}) ORDER BY c.sort_order, sec.name`).all(...ids);
}

// Sections this user may share to (homework managers: any; teachers: their own).
function allowedSections(req, db, ids) {
  if (hasAccess(req, 'homework', 'manage')) return ids;
  if (!req.user.teacher_id) return [];
  const mine = teacherSectionIds(db, req.user.teacher_id);
  return ids.filter((id) => mine.has(Number(id)));
}

// Parents (with a phone) of current students; siblings' parent counted once.
function parentsOf(db, sectionIds) {
  if (!sectionIds.length) return [];
  const rows = db.prepare(`SELECT p.full_name AS name, p.phone, s.section_id FROM students s JOIN parents p ON p.id = s.parent_id
    WHERE s.archived = 0 AND s.left_on IS NULL AND s.section_id IN (${sectionIds.map(() => '?').join(',')}) AND TRIM(COALESCE(p.phone, '')) <> ''`).all(...sectionIds);
  const seen = new Map();
  for (const r of rows) {
    const key = String(r.phone).replace(/[^0-9]/g, '').replace(/^0+/, '').slice(-10);
    if (key && !seen.has(key)) seen.set(key, r);
  }
  return [...seen.values()];
}

// Builds the message and works out which sections it is for.
function buildShare(req, db, b) {
  const school = getSetting(db, 'school_name', 'CHAND School Management System');
  const footer = `\n— ${school}`;
  const kind = b.kind;
  if (kind === 'diary') {
    const sectionId = Number(b.section_id);
    const date = String(b.date || localDateStr()).slice(0, 10);
    const [sec] = sectionRows(db, [sectionId]);
    if (!sec) throw new HttpError(400, 'Choose a class');
    const items = db.prepare(`SELECT h.*, sub.name AS subject_name FROM homework h JOIN subjects sub ON sub.id = h.subject_id
      WHERE h.archived = 0 AND h.section_id = ? AND h.assigned_on = ? ORDER BY sub.name, h.id`).all(sectionId, date);
    if (!items.length) throw new HttpError(400, `No homework has been given to ${sec.class_name} - ${sec.section_name} on ${prettyDate(date)} yet`);
    const lines = items.map((h, i) => {
      const due = h.due_date && h.due_date !== date ? ` _(submit by ${prettyDate(h.due_date)})_` : '';
      const details = h.details ? `\n   ${String(h.details).trim().replace(/\n/g, '\n   ')}` : '';
      return `${i + 1}. *${h.subject_name}:* ${h.title}${due}${details}`;
    });
    return {
      kind, ref: `${sectionId}:${date}`, sectionIds: [sectionId], title: `Daily Diary — ${sec.class_name} - ${sec.section_name}`,
      text: `📘 *Daily Diary — ${sec.class_name} - ${sec.section_name}*\n🗓️ ${prettyDate(date, true)}\n\n${lines.join('\n\n')}\n\nPlease make sure your child completes the homework.${footer}`
    };
  }
  if (kind === 'homework') {
    const h = db.prepare(`SELECT h.*, sub.name AS subject_name, c.name AS class_name, sec.name AS section_name FROM homework h
      JOIN subjects sub ON sub.id = h.subject_id JOIN sections sec ON sec.id = h.section_id JOIN classes c ON c.id = sec.class_id
      WHERE h.id = ? AND h.archived = 0`).get(Number(b.homework_id));
    if (!h) throw new HttpError(404, 'Homework not found');
    const details = h.details ? `\n${String(h.details).trim()}` : '';
    const due = h.due_date ? `\n\n⏰ Submit by: *${prettyDate(h.due_date, true)}*` : '';
    return {
      kind, ref: String(h.id), sectionIds: [h.section_id], title: `Homework — ${h.subject_name}`,
      text: `📘 *Homework — ${h.class_name} - ${h.section_name}*\n🗓️ ${prettyDate(h.assigned_on, true)}\n\n*${h.subject_name}:* ${h.title}${details}${due}${footer}`
    };
  }
  if (kind === 'syllabus') {
    const classId = Number(b.class_id);
    const cls = db.prepare('SELECT id, name FROM classes WHERE id = ?').get(classId);
    if (!cls) throw new HttpError(400, 'Choose a class');
    const where = ['t.archived = 0', 't.class_id = @class_id'];
    const params = { class_id: classId };
    if (b.subject_id) { where.push('t.subject_id = @subject_id'); params.subject_id = Number(b.subject_id); }
    if (b.term) { where.push('t.term = @term'); params.term = String(b.term); }
    const topics = db.prepare(`SELECT t.*, sub.name AS subject_name FROM syllabus_topics t JOIN subjects sub ON sub.id = t.subject_id
      WHERE ${where.join(' AND ')} ORDER BY sub.name, COALESCE(t.planned_from, '9999'), t.id`).all(params);
    if (!topics.length) throw new HttpError(400, 'No syllabus topics match — add topics first');
    const bySubject = new Map();
    topics.forEach((t) => { if (!bySubject.has(t.subject_name)) bySubject.set(t.subject_name, []); bySubject.get(t.subject_name).push(t); });
    const icon = { Completed: '✅', 'In Progress': '⏳', Pending: '▫️' };
    const blocks = [...bySubject.entries()].map(([subject, list]) => {
      const done = list.filter((t) => t.status === 'Completed').length;
      const rows = list.map((t) => {
        const when = t.planned_from || t.planned_to ? ` _(${[t.planned_from, t.planned_to].filter(Boolean).map((d) => prettyDate(d)).join(' – ')})_` : '';
        return `${icon[t.status] || '▫️'} ${t.unit ? `${t.unit}: ` : ''}${t.topic}${when}`;
      });
      return `*${subject}* (${done}/${list.length} done)\n${rows.join('\n')}`;
    });
    const sectionIds = db.prepare('SELECT id FROM sections WHERE class_id = ?').all(classId).map((r) => r.id);
    return {
      kind, ref: `${classId}:${b.subject_id || ''}:${b.term || ''}`, sectionIds, title: `Syllabus — ${cls.name}`,
      text: `📚 *Syllabus — ${cls.name}*${b.term ? ` · ${b.term}` : ''}\n\n${blocks.join('\n\n')}\n\n✅ completed  ⏳ in progress  ▫️ coming up${footer}`
    };
  }
  throw new HttpError(400, 'Unknown share type');
}

function shareInfo(req, db, share) {
  const allowed = new Set(allowedSections(req, db, share.sectionIds));
  if (!allowed.size) throw new HttpError(403, 'You can only share for classes you teach');
  const groups = groupMap(db);
  const sections = sectionRows(db, [...allowed]).map((s) => ({
    id: s.id, label: `${s.class_name} - ${s.section_name}`, parents: parentsOf(db, [s.id]).length, group: groups[s.id] || null
  }));
  const last = db.prepare('SELECT * FROM share_log WHERE kind = ? AND ref = ? ORDER BY id DESC LIMIT 1').get(share.kind, share.ref) || null;
  return { sections, last };
}

router.post('/share/preview', asyncHandler(async (req, res) => {
  const db = getDb();
  const share = buildShare(req, db, req.body || {});
  res.json({ title: share.title, text: share.text, ...shareInfo(req, db, share), whatsapp: whatsappService.getStatus().status });
}));

router.post('/share/send', asyncHandler(async (req, res) => {
  const db = getDb();
  const b = req.body || {};
  const share = buildShare(req, db, b);
  const { sections } = shareInfo(req, db, share);
  const text = String(b.text || share.text).slice(0, 6000);
  const pick = Array.isArray(b.section_ids) && b.section_ids.length ? new Set(b.section_ids.map(Number)) : null;
  const targets = sections.filter((s) => !pick || pick.has(s.id));
  if (!targets.length) throw new HttpError(400, 'Choose at least one class');
  if (!b.to_parents && !b.to_group) throw new HttpError(400, 'Choose parents, the class group, or both');
  if (whatsappService.getStatus().status !== 'connected') {
    throw new HttpError(400, 'The school WhatsApp is not linked. Link it in Settings → WhatsApp, or use “Open in WhatsApp” to send it yourself.');
  }

  const tally = { parents: 0, sent: 0, failed: 0, simulated: 0, groups: 0, groups_sent: 0, no_group: [] };
  if (b.to_parents) {
    const parents = parentsOf(db, targets.map((s) => s.id));
    tally.parents = parents.length;
    if (parents.length) {
      const r = await notificationService.sendNotification({
        title: share.title, message: text, category: 'Homework', audienceType: 'Individual',
        audienceRef: JSON.stringify(parents.map((p) => ({ name: p.name, phone: p.phone }))), channels: ['whatsapp'], createdBy: req.user.id
      });
      tally.sent += r.summary.sent || 0;
      tally.failed += r.summary.failed || 0;
      tally.simulated += r.summary.simulated || 0;
    }
  }
  const groupNames = [];
  if (b.to_group) {
    for (const s of targets) {
      if (!s.group) { tally.no_group.push(s.label); continue; }
      tally.groups += 1;
      const r = await whatsappService.sendGroupText(s.group.id, text);
      if (r.status === 'sent') { tally.groups_sent += 1; groupNames.push(s.group.name); } else tally.failed += 1;
    }
  }
  const me = db.prepare('SELECT full_name FROM users WHERE id = ?').get(req.user.id);
  db.prepare(`INSERT INTO share_log (kind, ref, section_id, to_parents, to_group, sent, failed, simulated, created_by, created_by_name, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(share.kind, share.ref, targets.length === 1 ? targets[0].id : null, b.to_parents ? tally.parents : 0,
    groupNames.join(', ') || null, tally.sent + tally.groups_sent, tally.failed, tally.simulated, req.user.id, me ? me.full_name : null, localDateTimeStr());
  recordAudit(req, 'share_whatsapp', share.kind, null, { ref: share.ref, ...tally, no_group: tally.no_group.join(', ') });
  res.json(tally);
}));

// WhatsApp groups of the linked number, and which group belongs to which class.
router.get('/share/groups', asyncHandler(async (req, res) => {
  if (!anyAccess(req)) throw new HttpError(403, "You don't have access to homework");
  const status = whatsappService.getStatus().status;
  let groups = [];
  let error = null;
  if (status === 'connected') {
    try { groups = await whatsappService.listGroups(); } catch (err) { error = err.message; }
  }
  res.json({ status, groups, error, mapping: groupMap(getDb()) });
}));

router.put('/share/groups/:sectionId', asyncHandler(async (req, res) => {
  const db = getDb();
  const sectionId = Number(req.params.sectionId);
  if (!allowedSections(req, db, [sectionId]).length) throw new HttpError(403, 'You can only set the group for classes you teach');
  const map = groupMap(db);
  const { id, name } = req.body || {};
  if (id) {
    if (!GROUP_RE.test(String(id))) throw new HttpError(400, 'Not a WhatsApp group');
    map[sectionId] = { id: String(id), name: String(name || id).slice(0, 120) };
  } else delete map[sectionId];
  setSetting(db, 'wa_section_groups', JSON.stringify(map));
  recordAudit(req, 'update', 'whatsapp_class_group', sectionId, { group: map[sectionId] ? map[sectionId].name : null });
  res.json(map);
}));

module.exports = router;
