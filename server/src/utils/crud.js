// Small list / create / edit / remove endpoint set for simple record types
// (library books, vehicles, events…), driven by a field list so every module
// validates and audits the same way.
//
// fields: { name: { type: 'text'|'int'|'num'|'date'|'time'|'enum'|'ref', required, values, max } }
const asyncHandler = require('./asyncHandler');
const { HttpError } = require('../middleware/errors');
const { recordAudit } = require('../middleware/audit');
const { getDb } = require('../db/connection');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;

function cleanValue(name, def, raw) {
  if (raw === undefined) return undefined;
  if (raw === null || (typeof raw === 'string' && raw.trim() === '')) return null;
  const label = def.label || name.replace(/_/g, ' ');
  switch (def.type) {
    case 'int':
    case 'ref': {
      const n = Number(raw);
      if (!Number.isInteger(n)) throw new HttpError(400, `${label} must be a whole number`);
      if (def.min !== undefined && n < def.min) throw new HttpError(400, `${label} must be at least ${def.min}`);
      return n;
    }
    case 'num': {
      const n = Number(raw);
      if (!Number.isFinite(n)) throw new HttpError(400, `${label} must be a number`);
      if (def.min !== undefined && n < def.min) throw new HttpError(400, `${label} must be at least ${def.min}`);
      return Math.round(n * 100) / 100;
    }
    case 'date':
      if (!DATE_RE.test(String(raw))) throw new HttpError(400, `${label} must be a date (YYYY-MM-DD)`);
      return String(raw);
    case 'time':
      if (!TIME_RE.test(String(raw))) throw new HttpError(400, `${label} must be a time (HH:MM)`);
      return String(raw);
    case 'enum':
      if (!def.values.includes(String(raw))) throw new HttpError(400, `${label} must be one of: ${def.values.join(', ')}`);
      return String(raw);
    default: {
      const s = String(raw).trim();
      if (s.length > (def.max || 4000)) throw new HttpError(400, `${label} is too long`);
      return s;
    }
  }
}

function readBody(fields, body, { partial }) {
  const out = {};
  for (const [name, def] of Object.entries(fields)) {
    let v = cleanValue(name, def, body[name]);
    if (v === undefined && !partial && def.default !== undefined) v = typeof def.default === 'function' ? def.default() : def.default;
    if (v === undefined) continue;
    if (v === null && def.required) throw new HttpError(400, `${def.label || name.replace(/_/g, ' ')} is required`);
    out[name] = v;
  }
  if (!partial) {
    for (const [name, def] of Object.entries(fields)) {
      if (def.required && (out[name] === undefined || out[name] === null)) throw new HttpError(400, `${def.label || name.replace(/_/g, ' ')} is required`);
    }
  }
  return out;
}

/**
 * opts: { router, path, table, entity, fields, canView(req), canEdit(req, row|body),
 *         listSql (SELECT … with @params and "WHERE 1=1" placeholder for filters via filterSql),
 *         filters: { queryName: 'SQL condition using @queryName' }, orderBy, withCreator, validate(db, data, existing) }
 */
function mountCrud(opts) {
  const { router, path, table, entity, fields } = opts;
  const canView = opts.canView || (() => true);
  const canEdit = opts.canEdit || (() => false);
  const filters = opts.filters || {};

  router.get(path, asyncHandler(async (req, res) => {
    if (!canView(req)) throw new HttpError(403, "You don't have access to this area. Ask an Admin, Principal or Super Admin.");
    const db = getDb();
    const params = {};
    const conds = [];
    for (const [q, cond] of Object.entries(filters)) {
      const v = req.query[q];
      if (v !== undefined && v !== '') {
        if (cond.includes(`@${q}`)) params[q] = q === 'search' ? `%${v}%` : v;
        conds.push(cond);
      }
    }
    const base = opts.listSql || `SELECT t.* FROM ${table} t WHERE t.archived = 0`;
    const sql = `${base}${conds.length ? ` AND ${conds.join(' AND ')}` : ''} ORDER BY ${opts.orderBy || 't.id DESC'} LIMIT 2000`;
    let rows = db.prepare(sql).all(params);
    if (opts.afterList) rows = opts.afterList(req, db, rows);
    res.json(rows);
  }));

  router.post(path, asyncHandler(async (req, res) => {
    const db = getDb();
    const data = readBody(fields, req.body || {}, { partial: false });
    if (!canEdit(req, data, db)) throw new HttpError(403, "You don't have permission to add this. Ask an Admin, Principal or Super Admin.");
    if (opts.validate) opts.validate(db, data, null, req);
    if (opts.withCreator) data.created_by = req.user.id;
    const cols = Object.keys(data);
    const r = db.prepare(`INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`).run(...cols.map((c) => data[c]));
    const id = Number(r.lastInsertRowid);
    if (opts.afterCreate) opts.afterCreate(db, id, req);
    recordAudit(req, 'create', entity, id, data);
    res.status(201).json({ id });
  }));

  router.put(`${path}/:id`, asyncHandler(async (req, res) => {
    const db = getDb();
    const existing = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(req.params.id);
    if (!existing || existing.archived) throw new HttpError(404, 'Record not found');
    if (!canEdit(req, existing, db)) throw new HttpError(403, "You don't have permission to change this.");
    const data = readBody(fields, req.body || {}, { partial: true });
    if (!canEdit(req, { ...existing, ...data }, db)) throw new HttpError(403, "You don't have permission to make this change.");
    if (opts.validate) {
      const merged = { ...existing, ...data };
      opts.validate(db, merged, existing, req);
      // validate() may fill in or clear values (e.g. a completion date).
      for (const k of Object.keys(fields)) if (merged[k] !== existing[k] || k in data) data[k] = merged[k];
    }
    const cols = Object.keys(data);
    if (cols.length) db.prepare(`UPDATE ${table} SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`).run(...cols.map((c) => data[c]), existing.id);
    const before = Object.fromEntries(cols.map((c) => [c, existing[c]]));
    recordAudit(req, 'update', entity, existing.id, { before, after: data });
    res.json({ success: true });
  }));

  router.delete(`${path}/:id`, asyncHandler(async (req, res) => {
    const db = getDb();
    const existing = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(req.params.id);
    if (!existing || existing.archived) throw new HttpError(404, 'Record not found');
    if (!canEdit(req, existing, db)) throw new HttpError(403, "You don't have permission to remove this.");
    if (opts.beforeDelete) opts.beforeDelete(db, existing);
    db.prepare(`UPDATE ${table} SET archived = 1 WHERE id = ?`).run(existing.id);
    recordAudit(req, 'archive', entity, existing.id, opts.describe ? opts.describe(existing) : null);
    res.json({ success: true });
  }));
}

module.exports = { mountCrud, readBody, cleanValue };
