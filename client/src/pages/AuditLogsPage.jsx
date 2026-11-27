import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { useToast } from '../context/ToastContext';
import DateInput from '../components/DateInput';

function details(json) {
  if (!json) return '';
  try {
    const d = JSON.parse(json);
    return Object.entries(d).map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`).join(' · ');
  } catch { return json; }
}

export default function AuditLogsPage() {
  const toast = useToast();
  const [f, setF] = useState({ username: '', action: '', entity_type: '', from: '', to: '', search: '' });
  const [page, setPage] = useState(1);
  const [data, setData] = useState({ rows: [], pagination: { total: 0, limit: 50 }, facets: { users: [], actions: [], entities: [] } });

  useEffect(() => {
    const q = Object.entries({ ...f, page, limit: 50 }).filter(([, v]) => v !== '').map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
    api.get(`/settings/audit-logs?${q}`).then(setData).catch((e) => toast.error(e.message));
  }, [JSON.stringify(f), page]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (k) => (e) => { setF({ ...f, [k]: e.target.value }); setPage(1); };
  const pages = Math.max(1, Math.ceil(data.pagination.total / 50));
  return (
    <div>
      <div className="page-header"><h2>Audit Logs</h2><span className="muted">{data.pagination.total} entries</span></div>
      <div className="card">
        <div className="row filters" style={{ margin: 0 }}>
          <select value={f.username} onChange={set('username')}><option value="">All users</option>{data.facets.users.map((u) => <option key={u}>{u}</option>)}</select>
          <select value={f.action} onChange={set('action')}><option value="">All actions</option>{data.facets.actions.map((a) => <option key={a}>{a}</option>)}</select>
          <select value={f.entity_type} onChange={set('entity_type')}><option value="">All areas</option>{data.facets.entities.map((a) => <option key={a}>{a}</option>)}</select>
          <DateInput value={f.from} onChange={set('from')} title="From" />
          <DateInput value={f.to} onChange={set('to')} title="To" />
          <input placeholder="Search details…" value={f.search} onChange={set('search')} />
        </div>
      </div>
      <div className="card">
        <div className="table-wrap">
          <table>
            <thead><tr><th>When</th><th>User</th><th>Action</th><th>Area</th><th>Record</th><th>Details</th><th>IP</th></tr></thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={r.id}>
                  <td style={{ whiteSpace: 'nowrap' }}>{r.local_time}</td><td>{r.username}</td><td>{r.action}</td><td>{r.entity_type}</td><td>{r.entity_id ?? ''}</td>
                  <td style={{ fontSize: '0.78rem', maxWidth: 480, wordBreak: 'break-word' }}>{details(r.details_json)}</td><td className="muted" style={{ fontSize: '0.75rem' }}>{r.ip_address}</td>
                </tr>
              ))}
              {data.rows.length === 0 && <tr><td colSpan={7} className="muted">No matching entries.</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn-ghost btn-sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>‹ Newer</button>
          <span className="muted">Page {page} of {pages}</span>
          <button type="button" className="btn-ghost btn-sm" disabled={page >= pages} onClick={() => setPage(page + 1)}>Older ›</button>
        </div>
      </div>
    </div>
  );
}
