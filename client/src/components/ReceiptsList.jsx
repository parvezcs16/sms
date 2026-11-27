import { useEffect, useState } from 'react';
import { api } from '../api/client';
import ShareButtons from './ShareButtons';
import { PAYMENT_MODES, fmtDateTime } from '../utils/payment';
import { todayStr } from '../utils/useRefs';
import DateInput from './DateInput';

// Every fee receipt in a period: reprint, share, see who received / verified it.
export default function ReceiptsList({ onOpenInvoice }) {
  const [f, setF] = useState({ from: `${todayStr().slice(0, 8)}01`, to: todayStr(), search: '', method: '' });
  const [rows, setRows] = useState([]);
  useEffect(() => {
    const q = Object.entries(f).filter(([, v]) => v).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
    api.get(`/fees/payments?${q}`).then(setRows).catch(() => setRows([]));
  }, [JSON.stringify(f)]); // eslint-disable-line react-hooks/exhaustive-deps
  const live = rows.filter((r) => !r.voided_at);
  const total = live.reduce((s, r) => s + r.amount, 0);
  return (
    <div className="card">
      <div className="row filters" style={{ marginBottom: 10 }}>
        <DateInput value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} title="From" />
        <DateInput value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} title="To" />
        <select value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })}><option value="">All modes</option>{PAYMENT_MODES.map((m) => <option key={m}>{m}</option>)}</select>
        <input placeholder="Student, receipt or voucher no…" value={f.search} onChange={(e) => setF({ ...f, search: e.target.value })} />
        <span className="muted">{live.length} receipts · <b>{total.toFixed(2)}</b></span>
      </div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Receipt</th><th>Date</th><th>Student</th><th>Voucher</th><th>Amount</th><th>Mode</th><th>Received by</th><th>Verified</th><th /></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className={r.voided_at ? 'row-struck' : 'row-selectable'} onClick={() => onOpenInvoice && onOpenInvoice(r.invoice_id)}>
                <td>{r.receipt_number}</td>
                <td>{r.payment_date}{r.recorded_at && <div className="muted" style={{ fontSize: '0.72rem' }}>{fmtDateTime(r.recorded_at)}</div>}</td>
                <td>{r.student_name}<div className="muted" style={{ fontSize: '0.72rem' }}>{r.class_name}</div></td>
                <td>{r.invoice_number}<div className="muted" style={{ fontSize: '0.72rem' }}>{r.period_label}</div></td>
                <td><b>{r.amount.toFixed(2)}</b></td>
                <td>{r.payment_method}{r.payment_reference && <div className="muted" style={{ fontSize: '0.72rem' }}>{r.payment_reference}</div>}</td>
                <td>{r.received_by_name}</td>
                <td>{r.verified_at ? `✔ ${r.verified_by_name}` : <span className="muted">—</span>}</td>
                <td onClick={(e) => e.stopPropagation()}>{!r.voided_at && <div className="actions-cell"><ShareButtons iconOnly path={`/fees/payments/${r.id}/receipt.pdf`} filenameBase={`receipt-${r.receipt_number}`} /></div>}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={9} className="muted">No receipts in this period.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
