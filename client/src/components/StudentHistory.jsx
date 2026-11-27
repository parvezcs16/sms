import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { useToast } from '../context/ToastContext';
import Badge from './Badge';
import ShareButtons from './ShareButtons';

const money = (n) => Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Complete fee and attendance history for one student, with a printable /
// sendable statement.
export default function StudentHistory({ studentId, code, canSend }) {
  const toast = useToast();
  const [h, setH] = useState(null);
  const [tab, setTab] = useState('fees');
  const [month, setMonth] = useState('');
  useEffect(() => { api.get(`/students/${studentId}/history`).then((d) => { setH(d); if (!d.fees) setTab('attendance'); }).catch(() => {}); }, [studentId]);
  if (!h) return null;

  async function send() {
    try {
      const r = await api.post(`/students/${studentId}/statement/send`, {});
      if (r.summary.sent) toast.success('Statement sent to the parent');
      else if (r.summary.simulated) toast.info('WhatsApp / email is not set up in Settings, so nothing was sent. Use the PDF button to share it yourself.');
      else toast.error('Could not deliver the statement — check the parent’s phone / email');
    } catch (err) { toast.error(err.message); }
  }

  const records = month ? h.attendance.records.filter((r) => r.attendance_date.startsWith(month)) : h.attendance.records.slice(0, 60);
  const t = h.attendance.totals;
  return (
    <div className="card">
      <div className="row" style={{ justifyContent: 'space-between', margin: 0 }}>
        <div className="row" style={{ margin: 0 }}>
          {h.fees && <button type="button" className={tab === 'fees' ? '' : 'btn-ghost'} onClick={() => setTab('fees')}>Fee History</button>}
          <button type="button" className={tab === 'attendance' ? '' : 'btn-ghost'} onClick={() => setTab('attendance')}>Attendance History</button>
        </div>
        {h.fees && (
          <div className="actions-cell">
            <span className="muted" style={{ fontSize: '0.8rem' }}>Statement:</span>
            <ShareButtons iconOnly path={`/students/${studentId}/statement.pdf`} filenameBase={`statement-${code}`} />
            {canSend && <button type="button" className="btn-ghost btn-sm" onClick={send}>Send to parent</button>}
          </div>
        )}
      </div>

      {tab === 'fees' && h.fees && (
        <>
          <div className="grid" style={{ margin: '12px 0', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
            <div className="card stat-tile" style={{ marginBottom: 0 }}><span className="stat-label">Total fees</span><span className="stat-value">{money(h.fees.totals.billed)}</span></div>
            <div className="card stat-tile" style={{ marginBottom: 0 }}><span className="stat-label">Paid</span><span className="stat-value" style={{ color: 'var(--success, #15803d)' }}>{money(h.fees.totals.paid)}</span></div>
            <div className="card stat-tile" style={{ marginBottom: 0 }}><span className="stat-label">Remaining</span><span className="stat-value" style={{ color: h.fees.totals.balance > 0 ? 'var(--danger)' : undefined }}>{money(h.fees.totals.balance)}</span></div>
          </div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Fee month</th><th>Voucher</th><th>Due</th><th style={{ textAlign: 'right' }}>Total</th><th style={{ textAlign: 'right' }}>Paid</th><th style={{ textAlign: 'right' }}>Balance</th><th>Status</th></tr></thead>
              <tbody>
                {h.fees.invoices.map((i) => (
                  <tr key={i.id} className={i.status === 'Cancelled' ? 'row-struck' : ''}>
                    <td>{i.period_label}</td><td>{i.invoice_number}</td><td>{i.due_date}</td>
                    <td style={{ textAlign: 'right' }}>{money(i.billed)}</td><td style={{ textAlign: 'right' }}>{money(i.paid_amount)}</td>
                    <td style={{ textAlign: 'right', fontWeight: 600, color: i.balance > 0 ? 'var(--danger)' : undefined }}>{money(i.balance)}</td>
                    <td><Badge>{i.status}</Badge></td>
                  </tr>
                ))}
                {h.fees.invoices.length === 0 && <tr><td colSpan={7} className="muted">No fee invoices yet.</td></tr>}
              </tbody>
            </table>
          </div>
          {h.fees.ledger.length > 0 && (
            <>
              <h4>Ledger (charges &amp; payments in date order)</h4>
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Date</th><th>Details</th><th style={{ textAlign: 'right' }}>Charge</th><th style={{ textAlign: 'right' }}>Paid</th><th style={{ textAlign: 'right' }}>Balance</th></tr></thead>
                  <tbody>
                    {h.fees.ledger.map((l, i) => (
                      <tr key={i}><td>{l.date}</td><td>{l.text}</td><td style={{ textAlign: 'right' }}>{l.debit ? money(l.debit) : ''}</td><td style={{ textAlign: 'right', color: 'var(--success, #15803d)' }}>{l.credit ? money(l.credit) : ''}</td><td style={{ textAlign: 'right', fontWeight: 600 }}>{money(l.balance)}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}

      {tab === 'attendance' && (
        <>
          <p style={{ margin: '12px 0' }}>
            Overall: <b>{t.percent === null ? '—' : `${t.percent}%`}</b> · Present {t.Present} · Absent {t.Absent} · Late {t.Late} · Leave {t.Leave} · {t.total} days marked
          </p>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Month</th><th>Present</th><th>Absent</th><th>Late</th><th>Leave</th><th>Days</th><th>%</th></tr></thead>
              <tbody>
                {h.attendance.months.map((m) => (
                  <tr key={m.month} className={`row-selectable${month === m.month ? ' row-selected' : ''}`} onClick={() => setMonth(month === m.month ? '' : m.month)}>
                    <td>{m.month}</td><td>{m.Present}</td><td style={{ color: m.Absent ? 'var(--danger)' : undefined }}>{m.Absent}</td><td>{m.Late}</td><td>{m.Leave}</td><td>{m.total}</td><td><b>{m.percent === null ? '—' : `${m.percent}%`}</b></td>
                  </tr>
                ))}
                {h.attendance.months.length === 0 && <tr><td colSpan={7} className="muted">No attendance recorded yet.</td></tr>}
              </tbody>
            </table>
          </div>
          {records.length > 0 && (
            <>
              <h4>{month ? `Days in ${month}` : 'Latest days'} <span className="muted" style={{ fontWeight: 400, fontSize: '0.8rem' }}>(click a month above to see all its days)</span></h4>
              <div className="att-days">
                {records.map((r) => <span key={r.attendance_date} className={`att-day att-${r.status.toLowerCase()}`} title={`${r.attendance_date}: ${r.status}${r.remarks ? ` — ${r.remarks}` : ''}`}>{r.attendance_date.slice(5)}<b>{r.status[0]}</b></span>)}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
