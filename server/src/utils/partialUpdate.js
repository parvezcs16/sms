// Builds an UPDATE that only touches the fields actually present in `body`.
// The old PUT handlers wrote every column on every call, so saving a form that
// didn't include e.g. date_of_birth silently wiped it. Empty strings are
// stored as NULL so a user can still clear a field on purpose.
function buildPartialUpdate(table, allowed, body, required = []) {
  const sets = [];
  const values = [];
  for (const field of allowed) {
    if (!Object.prototype.hasOwnProperty.call(body, field)) continue;
    let value = body[field];
    if (typeof value === 'string') value = value.trim();
    if (value === '' || value === undefined) value = null;
    if (value === null && required.includes(field)) continue; // never blank a required column
    sets.push(`${field} = ?`);
    values.push(value);
  }
  return { sql: sets.length ? `UPDATE ${table} SET ${sets.join(', ')}` : null, values };
}

module.exports = { buildPartialUpdate };
