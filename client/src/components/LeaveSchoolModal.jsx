import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { useToast } from '../context/ToastContext';
import Modal from './Modal';
import { localDateStr } from '../utils/date';
import DateInput from './DateInput';

const money = (n) => Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const TYPES = ['Transferred', 'Moved / Shifted', 'Withdrawn', 'Graduated', 'Other'];

// Mark a student as having left school. From the leaving date they get no new
// fee invoices and drop off attendance rosters; unpaid invoices for later
// months can be cancelled in the same step. Everything stays on record.
export default function LeaveSchoolModal({ student, onClose, onDone }) {
  const toast = useToast();
  const [leftOn, setLeftOn] = useState(localDateStr());
  const [type, setType] = useState('Transferred');
  const [reason, setReason] = useState('');
  const [cancel, setCancel] = useState('after');
  const [preview, setPreview] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!leftOn) return;
    api.get(`/students/${student.id}/leave-preview?left_on=${leftOn}`).then(setPreview).catch(() => setPreview(null));
  }, [student.id, leftOn]);

  const list = preview ? (cancel === 'all' ? preview.allUnpaid : cancel === 'after' ? preview.after : []) : [];
  const listTotal = list.reduce((s, i) => s + i.amount, 0);
  const remaining = preview ? Math.max(0, preview.outstanding - listTotal) : 0;

  async function submit(e) {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await api.post(`/students/${student.id}/leave`, { left_on: leftOn, leaving_type: type, reason, cancel_invoices: cancel });
      toast.success(`${student.full_name} marked as left on ${leftOn}${res.cancelled ? ` — ${res.cancelled} unpaid invoice(s) cancelled` : ''}. No new fees will be billed.`);
      if (res.outstanding > 0) toast.info(`Still outstanding from before leaving: ${money(res.outstanding)}`);
      onDone();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={`Left school — ${student.full_name}`} onClose={onClose}>
      <form onSubmit={submit}>
        <p className="muted" style={{ marginTop: 0 }}>
          From the leaving date this student gets no new fee invoices and is removed from attendance lists.
          Past attendance, fees and payments stay on record, and they can be re-admitted later.
        </p>
        <div className="form-grid">
          <div className="field"><label>Leaving date</label><DateInput required value={leftOn} onChange={(e) => setLeftOn(e.target.value)} /></div>
          <div className="field"><label>Reason type</label>
            <select value={type} onChange={(e) => setType(e.target.value)}>{TYPES.map((t) => <option key={t}>{t}</option>)}</select>
          </div>
        </div>
        <div className="field"><label>Details (optional)</label><input placeholder="e.g. Family moved to Lahore, joined another school" value={reason} onChange={(e) => setReason(e.target.value)} /></div>

        <div className="field">
          <label>Unpaid fee invoices</label>
          <div className="stack" style={{ gap: 4 }}>
            <label className="row" style={{ margin: 0 }}><input type="radio" style={{ width: 'auto' }} checked={cancel === 'after'} onChange={() => setCancel('after')} /> Cancel invoices due after the leaving date{preview ? ` (${preview.after.length})` : ''}</label>
            <label className="row" style={{ margin: 0 }}><input type="radio" style={{ width: 'auto' }} checked={cancel === 'all'} onChange={() => setCancel('all')} /> Cancel all unpaid invoices{preview ? ` (${preview.allUnpaid.length})` : ''}</label>
            <label className="row" style={{ margin: 0 }}><input type="radio" style={{ width: 'auto' }} checked={cancel === 'none'} onChange={() => setCancel('none')} /> Keep all invoices (dues still owed)</label>
          </div>
          <span className="muted" style={{ fontSize: '0.75rem' }}>Partly-paid invoices are never cancelled automatically.</span>
        </div>

        {list.length > 0 && (
          <table style={{ marginBottom: 10 }}>
            <thead><tr><th>Invoice</th><th>Period</th><th>Due</th><th>Amount</th></tr></thead>
            <tbody>
              {list.map((i) => <tr key={i.id} className="row-struck"><td>{i.invoice_number}</td><td>{i.period_label}</td><td>{i.due_date}</td><td>{money(i.amount)}</td></tr>)}
            </tbody>
          </table>
        )}
        {preview && (
          <p style={{ margin: '6px 0 0' }}>
            {list.length > 0 && <>Will cancel <b>{money(listTotal)}</b>. </>}
            {remaining > 0 ? <>Dues still owed after this: <b style={{ color: 'var(--danger)' }}>{money(remaining)}</b></> : <span className="muted">No dues left after this.</span>}
          </p>
        )}

        <div className="modal-footer">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-danger" disabled={saving}>{saving ? 'Saving…' : 'Mark as Left'}</button>
        </div>
      </form>
    </Modal>
  );
}

export function ReadmitModal({ student, sections, onClose, onDone }) {
  const toast = useToast();
  const [sectionId, setSectionId] = useState(String(student.section_id || ''));
  const [saving, setSaving] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post(`/students/${student.id}/readmit`, { section_id: sectionId ? Number(sectionId) : undefined });
      toast.success(`${student.full_name} re-admitted — fees and attendance resume`);
      onDone();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={`Re-admit — ${student.full_name}`} onClose={onClose}>
      <form onSubmit={submit}>
        <p className="muted" style={{ marginTop: 0 }}>
          Left on {student.left_on || '—'}{student.leaving_type ? ` (${student.leaving_type})` : ''}. Cancelled invoices stay cancelled; generate new ones from Fees.
        </p>
        <div className="field"><label>Class / Section</label>
          <select value={sectionId} onChange={(e) => setSectionId(e.target.value)}>
            {sections.map((s) => <option key={s.id} value={s.id}>{s.class_name} - {s.name}</option>)}
          </select>
        </div>
        <div className="modal-footer">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Re-admit'}</button>
        </div>
      </form>
    </Modal>
  );
}
