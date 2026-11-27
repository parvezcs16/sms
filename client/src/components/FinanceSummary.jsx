import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { localDateStr } from '../utils/date';
import DateInput from './DateInput';

const PERIODS = [
  ['today', 'Today'], ['month', 'This month'], ['last_month', 'Last month'], ['year', 'This year'], ['custom', 'Custom']
];
const money = (n) => Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const monthLabel = (ym) => new Date(`${ym}-01T00:00:00`).toLocaleDateString(undefined, { month: 'short', year: 'numeric' });

// Fees collected vs. salaries + expenses for a period, with profit / loss.
export default function FinanceSummary() {
  const [period, setPeriod] = useState('month');
  const [from, setFrom] = useState(() => `${localDateStr().slice(0, 7)}-01`);
  const [to, setTo] = useState(() => localDateStr());
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (period === 'custom' && (!from || !to)) return;
    const q = new URLSearchParams({ period });
    if (period === 'custom') { q.set('from', from); q.set('to', to); }
    api.get(`/dashboard/finance?${q}`)
      .then((d) => { setData(d); setError(''); })
      .catch((err) => setError(err.message));
  }, [period, from, to]);

  if (error && !data) return <div className="card"><h3>Finance Summary</h3><p className="muted">{error}</p></div>;
  if (!data) return <div className="card"><h3>Finance Summary</h3><p className="muted">Loading…</p></div>;

  const outgoing = data.salaries.total + data.expenses.total;
  const isProfit = data.profit >= 0;
  const maxBar = Math.max(1, ...data.months.map((m) => Math.max(m.fees, m.salaries + m.expenses)));

  return (
    <div className="card finance-card">
      <div className="page-header" style={{ marginBottom: 10 }}>
        <div>
          <h3 style={{ margin: 0 }}>Finance Summary</h3>
          <span className="muted" style={{ fontSize: '0.8rem' }}>{data.from === data.to ? data.from : `${data.from} → ${data.to}`}</span>
        </div>
        <div className="row" style={{ margin: 0, alignItems: 'center' }}>
          <div className="seg">
            {PERIODS.map(([k, label]) => (
              <button key={k} type="button" className={period === k ? 'active' : ''} onClick={() => setPeriod(k)}>{label}</button>
            ))}
          </div>
          {period === 'custom' && (
            <>
              <DateInput value={from} max={to} onChange={(e) => setFrom(e.target.value)} style={{ width: 'auto' }} />
              <DateInput value={to} min={from} onChange={(e) => setTo(e.target.value)} style={{ width: 'auto' }} />
            </>
          )}
        </div>
      </div>
      {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}

      <div className="finance-grid">
        <div className="stat-tile fin-tile fin-in">
          <span className="stat-label">Fees Collected</span>
          <span className="stat-value">{money(data.fees.total)}</span>
          <span className="stat-sub">{data.fees.count} payment{data.fees.count === 1 ? '' : 's'}</span>
        </div>
        <div className="stat-tile fin-tile fin-out">
          <span className="stat-label">Salaries</span>
          <span className="stat-value">{money(data.salaries.total)}</span>
          <span className="stat-sub">Paid {money(data.salaries.paid)} · Pending {money(data.salaries.pending)}</span>
        </div>
        <div className="stat-tile fin-tile fin-out">
          <span className="stat-label">Expenses</span>
          <span className="stat-value">{money(data.expenses.total)}</span>
          <span className="stat-sub">{data.expenses.count} {data.expenses.count === 1 ? 'entry' : 'entries'}</span>
        </div>
        <div className={`stat-tile fin-tile ${isProfit ? 'fin-profit' : 'fin-loss'}`}>
          <span className="stat-label">{isProfit ? 'Profit' : 'Loss'}</span>
          <span className="stat-value">{isProfit ? '' : '−'}{money(Math.abs(data.profit))}</span>
          <span className="stat-sub">Fees − Salaries − Expenses ({money(outgoing)} out)</span>
        </div>
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table className="finance-trend">
          <thead><tr><th>Month</th><th>Fees</th><th>Salaries</th><th>Expenses</th><th>Profit / Loss</th><th className="hide-mobile" style={{ width: '28%' }} /></tr></thead>
          <tbody>
            {data.months.map((m) => (
              <tr key={m.month}>
                <td>{monthLabel(m.month)}</td>
                <td>{money(m.fees)}</td>
                <td>{money(m.salaries)}</td>
                <td>{money(m.expenses)}</td>
                <td style={{ color: m.profit >= 0 ? 'var(--success)' : 'var(--danger)', fontWeight: 600 }}>{m.profit >= 0 ? '' : '−'}{money(Math.abs(m.profit))}</td>
                <td className="hide-mobile">
                  <div className="fin-bar" title={`Fees ${money(m.fees)}`}><span className="in" style={{ width: `${(m.fees / maxBar) * 100}%` }} /></div>
                  <div className="fin-bar" title={`Salaries + expenses ${money(m.salaries + m.expenses)}`}><span className="out" style={{ width: `${((m.salaries + m.expenses) / maxBar) * 100}%` }} /></div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted" style={{ fontSize: '0.75rem', margin: '8px 0 0' }}>
        Fees = payments received (voided excluded). Salaries = payroll generated for the months in range. Expenses exclude deleted entries.
        <span className="hide-mobile"> Bars: blue = fees in, amber = salaries + expenses out.</span>
      </p>
    </div>
  );
}
