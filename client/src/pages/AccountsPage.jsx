import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, downloadFile } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import CrudManager from '../components/CrudManager';
import { PAYMENT_MODES } from '../utils/payment';
import { todayStr } from '../utils/useRefs';
import DateInput from '../components/DateInput';

const money = (n) => Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const monthStart = () => `${todayStr().slice(0, 8)}01`;

export default function AccountsPage() {
  const { can } = useAuth();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') || 'summary';
  const [range, setRange] = useState({ from: monthStart(), to: todayStr() });
  const [summary, setSummary] = useState(null);
  const [book, setBook] = useState(null);
  const [cats, setCats] = useState([]);
  const q = `from=${range.from}&to=${range.to}`;

  useEffect(() => { api.get('/accounts/income/categories').then(setCats).catch(() => {}); }, []);
  useEffect(() => {
    if (tab === 'summary') api.get(`/accounts/summary?${q}`).then(setSummary).catch((e) => toast.error(e.message));
    if (tab === 'daybook') api.get(`/accounts/daybook?${q}`).then(setBook).catch((e) => toast.error(e.message));
  }, [tab, q]); // eslint-disable-line react-hooks/exhaustive-deps

  const tabs = [['summary', 'Income & Expenditure'], ['daybook', 'Cash Book'], ['income', 'Other Income']];
  return (
    <div>
      <div className="page-header"><h2>Accounting</h2></div>
      <div className="row" style={{ marginBottom: 12 }}>
        {tabs.map(([k, l]) => <button key={k} type="button" className={tab === k ? '' : 'btn-ghost'} onClick={() => setParams({ tab: k }, { replace: true })}>{l}</button>)}
      </div>
      {tab !== 'income' && (
        <div className="card">
          <div className="row filters" style={{ margin: 0 }}>
            <label className="muted">From</label><DateInput value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} />
            <label className="muted">To</label><DateInput value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} />
            <button type="button" className="btn-ghost btn-sm" onClick={() => setRange({ from: monthStart(), to: todayStr() })}>This month</button>
            <button type="button" className="btn-ghost btn-sm" onClick={() => setRange({ from: `${todayStr().slice(0, 4)}-01-01`, to: todayStr() })}>This year</button>
            {tab === 'daybook' && (
              <>
                <button type="button" className="btn-secondary btn-sm" onClick={() => downloadFile(`/accounts/daybook?${q}&format=pdf`, 'cash-book.pdf')}>PDF</button>
                <button type="button" className="btn-secondary btn-sm" onClick={() => downloadFile(`/accounts/daybook?${q}&format=excel`, 'cash-book.xlsx')}>Excel</button>
              </>
            )}
          </div>
        </div>
      )}

      {tab === 'summary' && summary && (
        <>
          <div className="grid" style={{ marginBottom: 16 }}>
            <div className="card stat-tile" style={{ marginBottom: 0 }}><span className="stat-label">Total income</span><span className="stat-value" style={{ color: 'var(--success, #15803d)' }}>{money(summary.total_income)}</span></div>
            <div className="card stat-tile" style={{ marginBottom: 0 }}><span className="stat-label">Total expenditure</span><span className="stat-value" style={{ color: 'var(--danger)' }}>{money(summary.total_expenditure)}</span></div>
            <div className="card stat-tile" style={{ marginBottom: 0 }}><span className="stat-label">{summary.surplus >= 0 ? 'Surplus' : 'Deficit'}</span><span className="stat-value" style={{ color: summary.surplus >= 0 ? 'var(--success, #15803d)' : 'var(--danger)' }}>{money(summary.surplus)}</span></div>
          </div>
          <div className="grid two-col">
            <HeadTable title="Income" rows={summary.income} total={summary.total_income} />
            <HeadTable title="Expenditure" rows={summary.expenditure} total={summary.total_expenditure} />
          </div>
          <div className="grid two-col">
            <div className="card">
              <h3>Month by month</h3>
              <table>
                <thead><tr><th>Month</th><th>Income</th><th>Expenditure</th><th>Net</th></tr></thead>
                <tbody>
                  {summary.months.map((m) => <tr key={m.month}><td>{m.month}</td><td>{money(m.income)}</td><td>{money(m.expenditure)}</td><td style={{ color: m.net < 0 ? 'var(--danger)' : undefined, fontWeight: 600 }}>{money(m.net)}</td></tr>)}
                  {summary.months.length === 0 && <tr><td colSpan={4} className="muted">No transactions.</td></tr>}
                </tbody>
              </table>
            </div>
            <div className="card">
              <h3>By payment mode</h3>
              <table>
                <thead><tr><th>Mode</th><th>In</th><th>Out</th><th>Net</th></tr></thead>
                <tbody>
                  {summary.by_mode.map((m) => <tr key={m.mode}><td>{m.mode}</td><td>{money(m.money_in)}</td><td>{money(m.money_out)}</td><td>{money(m.money_in - m.money_out)}</td></tr>)}
                </tbody>
              </table>
              <p className="muted" style={{ fontSize: '0.78rem' }}>Income = fee payments + other income. Expenditure = daily expenses + salaries marked paid.</p>
            </div>
          </div>
        </>
      )}

      {tab === 'daybook' && book && (
        <div className="card">
          <div className="row" style={{ gap: 24, marginTop: 0 }}>
            <span>Opening: <b>{money(book.opening)}</b></span>
            <span>Money in: <b style={{ color: 'var(--success, #15803d)' }}>{money(book.total_in)}</b></span>
            <span>Money out: <b style={{ color: 'var(--danger)' }}>{money(book.total_out)}</b></span>
            <span>Closing: <b>{money(book.closing)}</b></span>
          </div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Date</th><th>Head</th><th>Details</th><th>Ref</th><th>Mode</th><th style={{ textAlign: 'right' }}>In</th><th style={{ textAlign: 'right' }}>Out</th><th style={{ textAlign: 'right' }}>Balance</th></tr></thead>
              <tbody>
                {book.rows.map((r, i) => (
                  <tr key={i}>
                    <td>{r.date}</td><td>{r.category}</td><td dir="auto">{r.description}</td><td>{r.ref}</td><td>{r.mode}</td>
                    <td style={{ textAlign: 'right' }}>{r.money_in !== '' ? money(r.money_in) : ''}</td>
                    <td style={{ textAlign: 'right', color: 'var(--danger)' }}>{r.money_out !== '' ? money(r.money_out) : ''}</td>
                    <td style={{ textAlign: 'right', fontWeight: 600 }}>{money(r.balance)}</td>
                  </tr>
                ))}
                {book.rows.length === 0 && <tr><td colSpan={8} className="muted">No transactions in this period.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'income' && (
        <CrudManager
          endpoint="/accounts/income"
          noun="income entry"
          addLabel="Record Income"
          canManage={can('accounts', 'manage')}
          fields={[
            { key: 'income_date', label: 'Date', type: 'date', required: true, default: todayStr },
            { key: 'category', label: 'Head', required: true, list: 'income-cats', placeholder: 'e.g. Donation, Sale of Uniforms' },
            { key: 'amount', label: 'Amount', type: 'number', min: 0.01, required: true },
            { key: 'received_from', label: 'Received from' },
            { key: 'payment_method', label: 'Payment mode', type: 'select', options: PAYMENT_MODES, noBlank: true, default: 'Cash' },
            { key: 'reference', label: 'Reference / cheque no.' },
            { key: 'notes', label: 'Notes', full: true }
          ]}
          filters={[
            { key: 'from', label: 'From', type: 'date' },
            { key: 'to', label: 'To', type: 'date' },
            { key: 'category', label: 'All heads', type: 'select', options: cats }
          ]}
          toolbar={<datalist id="income-cats">{cats.map((c) => <option key={c} value={c} />)}</datalist>}
          columns={[
            { key: 'income_date', label: 'Date' },
            { key: 'category', label: 'Head' },
            { key: 'received_from', label: 'From' },
            { key: 'amount', label: 'Amount', render: (r) => <b>{money(r.amount)}</b> },
            { key: 'payment_method', label: 'Mode', render: (r) => `${r.payment_method}${r.reference ? ` · ${r.reference}` : ''}` },
            { key: 'recorded_by_name', label: 'Recorded by' },
            { key: 'notes', label: 'Notes' }
          ]}
          toPayload={(b) => ({ ...b, amount: Number(b.amount) })}
          emptyMessage="No other income recorded. Fee payments are counted automatically — use this for donations, sales, rent and so on."
          describe={(r) => `${r.category} ${money(r.amount)}`}
        />
      )}
    </div>
  );
}

function HeadTable({ title, rows, total }) {
  return (
    <div className="card">
      <h3>{title}</h3>
      <table>
        <tbody>
          {rows.map((r) => <tr key={r.category}><td>{r.category}</td><td style={{ textAlign: 'right' }}>{money(r.amount)}</td></tr>)}
          {rows.length === 0 && <tr><td className="muted">None in this period.</td></tr>}
          <tr><td><b>Total</b></td><td style={{ textAlign: 'right' }}><b>{money(total)}</b></td></tr>
        </tbody>
      </table>
    </div>
  );
}
