import { Fragment, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import Modal from './Modal';

// Class-wise breakdown of unpaid fees; click a class to see its sections.
export default function OutstandingModal({ currency = '', onClose }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [open, setOpen] = useState({});

  useEffect(() => {
    api.get('/dashboard/outstanding').then(setData).catch((err) => setError(err.message));
  }, []);

  const money = (n) => `${currency ? `${currency} ` : ''}${Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
  const max = data ? Math.max(1, ...data.classes.map((c) => c.outstanding)) : 1;

  return (
    <Modal title="Outstanding Fees — Class wise" onClose={onClose} wide
      footer={<><Link to="/fees" className="btn btn-secondary" onClick={onClose}>Open Fees & Accounts</Link><button type="button" onClick={onClose}>Close</button></>}>
      {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}
      {!data && !error && <p className="muted">Loading…</p>}
      {data && (
        data.classes.length === 0 ? <p className="muted">No outstanding fees. Every invoice is paid.</p> : (
          <>
            <div className="out-summary">
              <div><span className="muted">Total outstanding</span><b>{money(data.total)}</b></div>
              <div><span className="muted">Students with dues</span><b>{data.students}</b></div>
              <div><span className="muted">Classes</span><b>{data.classes.length}</b></div>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table className="out-table">
                <thead>
                  <tr><th>Class</th><th className="num">Students</th><th className="num">Invoices</th><th className="num">Overdue</th><th className="num">Outstanding</th><th className="hide-mobile" style={{ width: '24%' }}>Share</th></tr>
                </thead>
                <tbody>
                  {data.classes.map((c) => {
                    const key = c.class_id ?? 'none';
                    const isOpen = Boolean(open[key]);
                    return (
                      <Fragment key={key}>
                        <tr className="out-class" onClick={() => setOpen({ ...open, [key]: !isOpen })} title="Show sections">
                          <td><span className={`out-chev${isOpen ? ' open' : ''}`}>›</span> <b>{c.class_name}</b> <span className="muted">({c.sections.length} section{c.sections.length === 1 ? '' : 's'})</span></td>
                          <td className="num">{c.students}</td>
                          <td className="num">{c.invoices}</td>
                          <td className="num" style={{ color: c.overdue > 0 ? 'var(--danger)' : undefined }}>{money(c.overdue)}</td>
                          <td className="num"><b>{money(c.outstanding)}</b></td>
                          <td className="hide-mobile">
                            <div className="out-bar"><span style={{ width: `${(c.outstanding / max) * 100}%` }} /></div>
                            <span className="muted" style={{ fontSize: '0.72rem' }}>{data.total ? Math.round((c.outstanding / data.total) * 100) : 0}%</span>
                          </td>
                        </tr>
                        {isOpen && c.sections.map((s) => (
                          <tr key={`${key}-${s.section_id}`} className="out-section">
                            <td style={{ paddingLeft: 30 }}>Section {s.section_name}</td>
                            <td className="num">{s.students}</td>
                            <td className="num">{s.invoices}</td>
                            <td className="num">{money(s.overdue)}</td>
                            <td className="num">{money(s.outstanding)}</td>
                            <td className="hide-mobile" />
                          </tr>
                        ))}
                      </Fragment>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr><td><b>Total</b></td><td className="num"><b>{data.students}</b></td><td className="num"><b>{data.classes.reduce((s, c) => s + c.invoices, 0)}</b></td>
                    <td className="num"><b>{money(data.classes.reduce((s, c) => s + c.overdue, 0))}</b></td><td className="num"><b>{money(data.total)}</b></td><td className="hide-mobile" /></tr>
                </tfoot>
              </table>
            </div>
            <p className="muted" style={{ fontSize: '0.75rem', marginTop: 8 }}>Unpaid and part-paid invoices (fines included). Overdue = past its due date.</p>
          </>
        )
      )}
    </Modal>
  );
}
