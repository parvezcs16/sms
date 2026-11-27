// Inventory / store: items with stock levels; every change is a movement
// (stock in, issued out, or a stock-count adjustment) so the history shows
// who changed what and when. Items below their minimum are flagged.
const express = require('express');
const { getDb } = require('../db/connection');
const asyncHandler = require('../utils/asyncHandler');
const { requireAuth } = require('../middleware/auth');
const { recordAudit } = require('../middleware/audit');
const { hasAccess, requireAccess } = require('../middleware/permissions');
const { HttpError } = require('../middleware/errors');
const { mountCrud } = require('../utils/crud');
const { runInTransaction } = require('../utils/tx');
const { localDateStr, DATE_RE } = require('../utils/localDate');
const { userDesignation } = require('../utils/people');

const router = express.Router();
router.use(requireAuth);

mountCrud({
  router,
  path: '/items',
  table: 'inventory_items',
  entity: 'inventory_item',
  canView: (req) => hasAccess(req, 'inventory', 'view'),
  canEdit: (req) => hasAccess(req, 'inventory', 'manage'),
  listSql: `SELECT t.*, CASE WHEN t.quantity <= t.min_quantity AND t.min_quantity > 0 THEN 1 ELSE 0 END AS low_stock,
              (SELECT MAX(moved_on) FROM inventory_moves m WHERE m.item_id = t.id) AS last_moved
            FROM inventory_items t WHERE t.archived = 0`,
  filters: {
    category: 't.category = @category',
    low: '(t.quantity <= t.min_quantity AND t.min_quantity > 0)',
    search: '(t.name LIKE @search OR t.category LIKE @search OR t.location LIKE @search)'
  },
  orderBy: 't.category, t.name',
  fields: {
    name: { required: true },
    category: {}, unit: { default: 'pcs' }, location: {},
    min_quantity: { type: 'num', min: 0, default: 0, label: 'Minimum stock' },
    unit_cost: { type: 'num', min: 0, label: 'Unit cost' }
  },
  // A number typed as the unit (e.g. "200") is really the stock count.
  validate: (db, data) => {
    if (data.unit !== undefined && /^\s*[\d.,]+\s*$/.test(String(data.unit || ''))) {
      throw new HttpError(400, `Unit should be a word like pcs, box or set — not a number. Put ${String(data.unit).trim()} in "Opening stock" instead.`);
    }
  },
  // Opening stock on a new item is saved as its first "Stock In".
  afterCreate: (db, id, req) => {
    const qty = Number(req.body && req.body.opening_stock);
    if (!(qty > 0)) return;
    const who = userDesignation(db, req.user.id);
    db.prepare(`INSERT INTO inventory_moves (item_id, kind, quantity, balance_after, moved_on, party, notes, created_by, created_by_name)
      VALUES (?, 'In', ?, ?, ?, NULL, 'Opening stock', ?, ?)`).run(id, qty, qty, localDateStr(), req.user.id, who.name);
    db.prepare('UPDATE inventory_items SET quantity = ? WHERE id = ?').run(qty, id);
  },
  describe: (r) => ({ name: r.name, quantity: r.quantity })
});

const KINDS = ['In', 'Out', 'Adjust'];

router.post('/items/:id/moves', requireAccess('inventory', 'manage'), asyncHandler(async (req, res) => {
  const db = getDb();
  const item = db.prepare('SELECT * FROM inventory_items WHERE id = ? AND archived = 0').get(req.params.id);
  if (!item) throw new HttpError(404, 'Item not found');
  const { kind, party, notes } = req.body || {};
  const qty = Number(req.body.quantity);
  const on = req.body.moved_on || localDateStr();
  if (!KINDS.includes(kind)) throw new HttpError(400, 'Choose Stock In, Issue Out or Stock Count');
  if (!DATE_RE.test(on)) throw new HttpError(400, 'Date must be YYYY-MM-DD');
  if (!Number.isFinite(qty) || qty < 0 || (kind !== 'Adjust' && qty === 0)) throw new HttpError(400, 'Enter a quantity');
  let balance;
  if (kind === 'In') balance = item.quantity + qty;
  else if (kind === 'Out') {
    if (qty > item.quantity) throw new HttpError(400, `Only ${item.quantity} ${item.unit || ''} in stock`);
    balance = item.quantity - qty;
  } else balance = qty;
  const change = kind === 'Adjust' ? balance - item.quantity : qty;
  const who = userDesignation(db, req.user.id);
  runInTransaction(db, () => {
    db.prepare(`INSERT INTO inventory_moves (item_id, kind, quantity, balance_after, moved_on, party, notes, created_by, created_by_name)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(item.id, kind, change, balance, on, party || null, notes || null, req.user.id, who.name);
    db.prepare('UPDATE inventory_items SET quantity = ? WHERE id = ?').run(balance, item.id);
  });
  recordAudit(req, `stock_${kind.toLowerCase()}`, 'inventory_item', item.id, { quantity: change, balance, party });
  res.status(201).json({ balance });
}));

router.get('/moves', requireAccess('inventory', 'view'), asyncHandler(async (req, res) => {
  const { item_id = '', from = '', to = '' } = req.query;
  res.json(getDb().prepare(
    `SELECT m.*, i.name AS item_name, i.unit FROM inventory_moves m JOIN inventory_items i ON i.id = m.item_id
     WHERE (@item_id = '' OR m.item_id = @item_id) AND (@from = '' OR m.moved_on >= @from) AND (@to = '' OR m.moved_on <= @to)
     ORDER BY m.moved_on DESC, m.id DESC LIMIT 1000`
  ).all({ item_id, from, to }));
}));

module.exports = router;
