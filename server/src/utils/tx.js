// Runs fn inside a single SQLite transaction (all-or-nothing).
function runInTransaction(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    try { db.exec('ROLLBACK'); } catch { /* already rolled back */ }
    throw err;
  }
}

// Turns SQLite constraint errors into a readable 409 instead of a 500.
function friendlyConstraint(err, HttpError, { unique = 'That name is already in use', foreignKey = 'This record is still in use and cannot be deleted' } = {}) {
  const msg = String(err && err.message);
  if (msg.includes('UNIQUE')) return new HttpError(409, unique);
  if (msg.includes('FOREIGN KEY')) return new HttpError(409, foreignKey);
  return err;
}

module.exports = { runInTransaction, friendlyConstraint };
