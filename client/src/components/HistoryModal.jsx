import { useEffect, useState } from 'react';
import { api } from '../api/client';
import Modal from './Modal';

const ACTION_LABELS = {
  create: 'Created', update: 'Edited', delete: 'Deleted', restore: 'Restored', archive: 'Archived',
  edit_invoice: 'Invoice edited', cancel_invoice: 'Invoice cancelled', restore_invoice: 'Invoice restored',
  pay: 'Payment recorded', edit_payment: 'Payment corrected', void_payment: 'Payment voided',
  edit_payslip: 'Payslip edited', delete_payslip: 'Payslip deleted', mark_paid: 'Marked paid', mark_unpaid: 'Marked unpaid',
  edit_advance: 'Advance edited', delete_advance: 'Advance deleted', relieve: 'Relieved', rejoin: 'Re-joined',
  update_photo: 'Photo changed', upsert: 'Saved'
};

const FIELD_LABELS = {
  amount: 'Amount', category_id: 'Category', expense_date: 'Date', paid_to: 'Paid to', payment_method: 'Method', notes: 'Notes',
  total_amount: 'Total', fine_amount: 'Fine', due_date: 'Due date', period_label: 'Period', payment_date: 'Payment date',
  basic: 'Basic', total_allowances: 'Allowances', total_deductions: 'Deductions', net_salary: 'Net salary', recovery_per_month: 'Monthly recovery'
};

function fmt(v) {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

function when(ts) {
  if (!ts) return '';
  const d = new Date(ts.includes('T') ? ts : `${ts.replace(' ', 'T')}Z`);
  return Number.isNaN(d.getTime()) ? ts : d.toLocaleString();
}

// Turns an audit-log details object into readable "field: old → new" lines.
function describe(details) {
  if (!details) return [];
  const lines = [];
  if (details.changes) {
    Object.entries(details.changes).forEach(([f, c]) => lines.push(`${FIELD_LABELS[f] || f}: ${fmt(c.from)} → ${fmt(c.to)}`));
  }
  if (details.before && details.after) {
    Object.keys(details.after).forEach((f) => {
      if (f === 'items' || details.after[f] === undefined || details.after[f] === null) return;
      if (fmt(details.before[f]) !== fmt(details.after[f])) lines.push(`${FIELD_LABELS[f] || f}: ${fmt(details.before[f])} → ${fmt(details.after[f])}`);
    });
    if (details.after.items) lines.push('Fee lines changed');
  }
  if (details.reason) lines.push(`Reason: ${details.reason}`);
  if (!lines.length) {
    ['amount', 'receipt_number', 'relieving_date', 'rejoin_date', 'salary'].forEach((f) => {
      if (details[f] !== undefined && details[f] !== null) lines.push(`${FIELD_LABELS[f] || f.replace(/_/g, ' ')}: ${fmt(details[f])}`);
    });
  }
  return lines;
}

// "Who changed what, and when" for one record, from the audit log.
export default function HistoryModal({ entityType, entityId, title, onClose }) {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    api.get(`/history/${entityType}/${entityId}`).then(setRows).catch((e) => setError(e.message));
  }, [entityType, entityId]);

  return (
    <Modal title={title || 'Change History'} onClose={onClose}>
      {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}
      {!rows && !error && <p className="muted">Loading…</p>}
      {rows && rows.length === 0 && <p className="muted">No changes recorded for this item yet.</p>}
      {rows && rows.length > 0 && (
        <ol className="history-list">
          {rows.map((r) => (
            <li key={r.id}>
              <div className="row" style={{ margin: 0, justifyContent: 'space-between' }}>
                <b>{ACTION_LABELS[r.action] || r.action.replace(/_/g, ' ')}</b>
                <span className="muted" style={{ fontSize: '0.8rem' }}>{when(r.created_at)}</span>
              </div>
              <div className="muted" style={{ fontSize: '0.82rem' }}>by {r.full_name || r.username || 'system'}</div>
              {describe(r.details).map((line, i) => <div key={i} style={{ fontSize: '0.85rem' }}>{line}</div>)}
            </li>
          ))}
        </ol>
      )}
      <div className="modal-footer"><button type="button" className="btn-ghost" onClick={onClose}>Close</button></div>
    </Modal>
  );
}
