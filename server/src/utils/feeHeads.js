// Fee heads (Tuition Fee, Transport Fee, Fine…): a ready list of common heads,
// and free text anywhere a head is chosen — a new name is saved as a head
// automatically so it is offered next time.
//
// Names are matched loosely so the same head is never created twice:
// "Transport", "transport fee" and "TRANSPORT FEES" are all one head.

const COMMON_FEE_HEADS = [
  'Tuition Fee', 'Admission Fee', 'Exam Fee', 'Transport Fee', 'Library Fee', 'Fine',
  'Late Fee', 'Trip Fee', 'Annual Charges', 'Sports Fee', 'Computer Lab Fee', 'Miscellaneous'
];

function cleanHeadName(name) {
  return String(name || '').replace(/\s+/g, ' ').trim().slice(0, 60);
}

function headKey(name) {
  return cleanHeadName(name).toLowerCase()
    .replace(/[^a-z0-9؀-ۿ]+/g, ' ').trim()
    .replace(/\s+(fee|fees)$/, '')
    .replace(/\s+/g, '');
}

function findHead(db, name) {
  const key = headKey(name);
  if (!key) return null;
  return db.prepare('SELECT id, name FROM fee_heads ORDER BY id').all().find((h) => headKey(h.name) === key) || null;
}

// Returns the id of the head with this name, creating it if it is new.
function ensureHead(db, name) {
  const clean = cleanHeadName(name);
  if (!clean) {
    const err = new Error('Enter a fee head name');
    err.status = 400;
    throw err;
  }
  const found = findHead(db, clean);
  if (found) return found.id;
  return Number(db.prepare('INSERT INTO fee_heads (name) VALUES (?)').run(clean).lastInsertRowid);
}

// fee_head_id (existing head) or fee_head_name (typed — found or created).
function headFrom(db, src) {
  if (!src) return null;
  if (src.fee_head_id) return Number(src.fee_head_id);
  if (src.fee_head_name && cleanHeadName(src.fee_head_name)) return ensureHead(db, src.fee_head_name);
  return null;
}

function seedCommonHeads(db) {
  let added = 0;
  for (const name of COMMON_FEE_HEADS) {
    if (!findHead(db, name)) { db.prepare('INSERT INTO fee_heads (name) VALUES (?)').run(name); added += 1; }
  }
  return added;
}

module.exports = { COMMON_FEE_HEADS, cleanHeadName, headKey, findHead, ensureHead, headFrom, seedCommonHeads };
