// Relieve / re-join for teachers and non-teaching staff. Both share this
// logic through a small table map so the two can never behave differently.
const { HttpError } = require('../middleware/errors');
const { runInTransaction } = require('../utils/tx');
const { localDateStr, DATE_RE } = require('../utils/localDate');

const KINDS = {
  teacher: { table: 'teachers', structures: 'payroll_structures', person: 'teacher_id', label: 'Teacher' },
  staff: { table: 'staff', structures: 'staff_payroll_structures', person: 'staff_id', label: 'Staff member' }
};

function currentSalary(db, k, id) {
  return db.prepare(`SELECT * FROM ${k.structures} WHERE ${k.person} = ?`).get(id) || null;
}

function relieve(db, kind, id, { relieving_date, reason }, userId) {
  const k = KINDS[kind];
  const person = db.prepare(`SELECT * FROM ${k.table} WHERE id = ?`).get(id);
  if (!person) throw new HttpError(404, `${k.label} not found`);
  if (person.status === 'Relieved') throw new HttpError(400, `${person.full_name} is already relieved`);
  const date = relieving_date || localDateStr();
  if (!DATE_RE.test(date)) throw new HttpError(400, 'relieving_date must be YYYY-MM-DD');
  const why = String(reason || '').trim();
  if (!why) throw new HttpError(400, 'Please give a reason (e.g. Resigned, Contract ended)');
  const salary = currentSalary(db, k, id);
  runInTransaction(db, () => {
    db.prepare(`UPDATE ${k.table} SET status = 'Relieved', relieved_on = ?, relieve_reason = ? WHERE id = ?`).run(date, why, id);
    if (person.user_id) db.prepare('UPDATE users SET is_active = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(person.user_id);
    db.prepare(
      `INSERT INTO employment_history (person_type, person_id, event, event_date, reason, salary_before, created_by)
       VALUES (?, ?, 'Relieved', ?, ?, ?, ?)`
    ).run(kind, id, date, why, salary ? salary.basic_salary : null, userId);
  });
  return { person, date };
}

// keep_salary = true keeps the previous salary structure; otherwise the new
// basic/allowances/deductions take effect from the re-join date.
function rejoin(db, kind, id, body, userId) {
  const k = KINDS[kind];
  const person = db.prepare(`SELECT * FROM ${k.table} WHERE id = ?`).get(id);
  if (!person) throw new HttpError(404, `${k.label} not found`);
  if (person.status !== 'Relieved' && !person.archived) throw new HttpError(400, `${person.full_name} is not relieved`);
  const date = body.rejoin_date || localDateStr();
  if (!DATE_RE.test(date)) throw new HttpError(400, 'rejoin_date must be YYYY-MM-DD');
  if (person.relieved_on && date < person.relieved_on) throw new HttpError(400, `The re-join date can't be before the relieving date (${person.relieved_on})`);
  const before = currentSalary(db, k, id);
  const keep = body.keep_salary !== false && body.keep_salary !== 'false';
  let salaryAfter = before ? before.basic_salary : null;
  if (!keep) {
    const basic = Number(body.basic_salary);
    if (!(basic >= 0) || body.basic_salary === '' || body.basic_salary === undefined) throw new HttpError(400, 'Enter the new basic salary (or choose to keep the same salary)');
    salaryAfter = basic;
  }
  runInTransaction(db, () => {
    db.prepare(
      `UPDATE ${k.table} SET status = 'Active', archived = 0, relieved_on = NULL, relieve_reason = NULL WHERE id = ?`
    ).run(id);
    if (person.user_id) db.prepare('UPDATE users SET is_active = 1, archived_at = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(person.user_id);
    if (!keep) {
      const allowances = Array.isArray(body.allowances) ? body.allowances : (before ? JSON.parse(before.allowances_json || '[]') : []);
      const deductions = Array.isArray(body.deductions) ? body.deductions : (before ? JSON.parse(before.deductions_json || '[]') : []);
      db.prepare(
        `INSERT INTO ${k.structures} (${k.person}, basic_salary, allowances_json, deductions_json, effective_from)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(${k.person}) DO UPDATE SET basic_salary = excluded.basic_salary, allowances_json = excluded.allowances_json,
           deductions_json = excluded.deductions_json, effective_from = excluded.effective_from`
      ).run(id, salaryAfter, JSON.stringify(allowances), JSON.stringify(deductions), date);
    } else if (before) {
      db.prepare(`UPDATE ${k.structures} SET effective_from = ? WHERE ${k.person} = ?`).run(date, id);
    }
    db.prepare(
      `INSERT INTO employment_history (person_type, person_id, event, event_date, reason, salary_before, salary_after, created_by)
       VALUES (?, ?, 'Rejoined', ?, ?, ?, ?, ?)`
    ).run(kind, id, date, String(body.reason || '').trim() || null, before ? before.basic_salary : null, salaryAfter, userId);
  });
  return { person, date, salaryAfter, keptSalary: keep };
}

function history(db, kind, id) {
  return db.prepare(
    `SELECT eh.*, u.full_name AS created_by_name FROM employment_history eh LEFT JOIN users u ON u.id = eh.created_by
     WHERE eh.person_type = ? AND eh.person_id = ? ORDER BY eh.event_date DESC, eh.id DESC`
  ).all(kind, id);
}

module.exports = { relieve, rejoin, history };
