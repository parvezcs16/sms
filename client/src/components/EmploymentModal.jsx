import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { useToast } from '../context/ToastContext';
import { localDateStr } from '../utils/date';
import Modal from './Modal';
import DateInput from './DateInput';

// Relieve or re-join a teacher / non-teaching staff member.
//   kind: 'teacher' | 'staff'   person: the record (needs id, full_name, status)
export default function EmploymentModal({ kind, person, onClose, onDone }) {
  const toast = useToast();
  const relieving = person.status !== 'Relieved';
  const base = kind === 'teacher' ? '/teachers' : '/staff';
  const salaryPath = kind === 'teacher' ? `/payroll/structures/${person.id}` : `/payroll/staff/structures/${person.id}`;
  const [date, setDate] = useState(localDateStr());
  const [reason, setReason] = useState('');
  const [keepSalary, setKeepSalary] = useState(true);
  const [basic, setBasic] = useState('');
  const [current, setCurrent] = useState(undefined);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!relieving) {
      api.get(salaryPath).then((s) => { setCurrent(s); if (s) setBasic(String(s.basic_salary)); }).catch(() => setCurrent(null));
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      if (relieving) {
        await api.post(`${base}/${person.id}/relieve`, { relieving_date: date, reason });
        toast.success(`${person.full_name} relieved from ${date}. Their login has been disabled.`);
      } else {
        const result = await api.post(`${base}/${person.id}/rejoin`, {
          rejoin_date: date, reason, keep_salary: keepSalary, basic_salary: keepSalary ? undefined : Number(basic)
        });
        toast.success(`${person.full_name} re-joined from ${date}${result.salary != null ? ` — basic salary ${Number(result.salary).toFixed(2)}` : ''}`);
      }
      onDone();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={`${relieving ? 'Relieve' : 'Re-join'} — ${person.full_name}`} onClose={onClose}>
      <form onSubmit={submit}>
        {relieving ? (
          <p className="muted">They stay on record (attendance, payslips and history are kept), are left out of attendance rosters after this date and out of payroll runs, and their login is disabled. You can re-join them later.</p>
        ) : (
          <p className="muted">Relieved on {person.relieved_on || '—'}{person.relieve_reason ? ` (${person.relieve_reason})` : ''}. Re-joining makes them active again and re-enables their login.</p>
        )}
        <div className="form-grid">
          <div className="field"><label>{relieving ? 'Relieving date' : 'Re-join date'}</label>
            <DateInput required value={date} min={!relieving && person.relieved_on ? person.relieved_on : undefined} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="field"><label>{relieving ? 'Reason *' : 'Note (optional)'}</label>
            <input required={relieving} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={relieving ? 'Resigned / Contract ended / Terminated' : 'e.g. Rehired for new session'} />
          </div>
        </div>
        {!relieving && (
          <div className="card" style={{ background: 'var(--bg)' }}>
            <b>Salary from {date}</b>
            <p className="muted" style={{ margin: '4px 0 8px' }}>
              Previous basic salary: {current === undefined ? '…' : current ? Number(current.basic_salary).toFixed(2) : 'none set'}
            </p>
            <label className="row" style={{ margin: 0 }}>
              <input type="radio" style={{ width: 'auto' }} checked={keepSalary} onChange={() => setKeepSalary(true)} /> Keep the same salary
            </label>
            <label className="row" style={{ margin: '6px 0 0' }}>
              <input type="radio" style={{ width: 'auto' }} checked={!keepSalary} onChange={() => setKeepSalary(false)} /> New salary
            </label>
            {!keepSalary && (
              <div className="field" style={{ marginTop: 8 }}>
                <label>New basic salary</label>
                <input type="number" min="0" required value={basic} onChange={(e) => setBasic(e.target.value)} />
                <span className="muted" style={{ fontSize: '0.78rem' }}>Allowances and deductions stay as they were; change them in Payroll if needed.</span>
              </div>
            )}
          </div>
        )}
        <div className="modal-footer">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className={relieving ? 'btn-danger' : ''} disabled={busy}>{busy ? 'Saving…' : relieving ? 'Relieve' : 'Re-join'}</button>
        </div>
      </form>
    </Modal>
  );
}

export function EmploymentHistory({ kind, personId }) {
  const [rows, setRows] = useState([]);
  useEffect(() => {
    api.get(`${kind === 'teacher' ? '/teachers' : '/staff'}/${personId}/employment-history`).then(setRows).catch(() => {});
  }, [kind, personId]);
  if (!rows.length) return null;
  return (
    <table>
      <thead><tr><th>Date</th><th>Event</th><th>Reason / note</th><th>Salary</th><th>By</th></tr></thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id}>
            <td>{r.event_date}</td><td>{r.event}</td><td>{r.reason || '—'}</td>
            <td>{r.event === 'Rejoined'
              ? (r.salary_before === r.salary_after ? `Same (${r.salary_after ?? '—'})` : `${r.salary_before ?? '—'} → ${r.salary_after ?? '—'}`)
              : (r.salary_before ?? '—')}</td>
            <td>{r.created_by_name || '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
