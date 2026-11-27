import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import CrudManager from '../components/CrudManager';
import Modal from '../components/Modal';
import IconButton from '../components/IconButton';
import Badge from '../components/Badge';
import { todayStr } from '../utils/useRefs';
import DateInput from '../components/DateInput';

const money = (n) => Number(n || 0).toFixed(2);

export default function LibraryPage() {
  const { can } = useAuth();
  const toast = useToast();
  const canManage = can('library', 'manage');
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') || 'books';
  const [stats, setStats] = useState({});
  const [reload, setReload] = useState(0);
  const [issuing, setIssuing] = useState(null);
  const [cfg, setCfg] = useState(null);

  useEffect(() => { api.get('/library/stats').then(setStats).catch(() => {}); }, [reload]);
  const bump = () => setReload((r) => r + 1);

  return (
    <div>
      <div className="page-header">
        <h2>Library</h2>
        {canManage && <button type="button" className="btn-ghost" onClick={() => api.get('/library/settings').then(setCfg)}>Loan &amp; Fine Rules</button>}
      </div>
      <div className="grid" style={{ marginBottom: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
        {[['Titles', stats.titles], ['Copies', stats.copies], ['Issued now', stats.issued], ['Overdue', stats.overdue]].map(([l, v]) => (
          <div key={l} className="card stat-tile" style={{ marginBottom: 0 }}><span className="stat-label">{l}</span><span className="stat-value" style={l === 'Overdue' && v ? { color: 'var(--danger)' } : undefined}>{v ?? '—'}</span></div>
        ))}
      </div>
      <div className="row" style={{ marginBottom: 16 }}>
        {[['books', 'Books'], ['issued', 'Issued & Overdue'], ['history', 'Returned (history)']].map(([k, l]) => (
          <button key={k} type="button" className={tab === k ? '' : 'btn-ghost'} onClick={() => setParams({ tab: k }, { replace: true })}>{l}</button>
        ))}
      </div>

      {tab === 'books' && (
        <CrudManager
          endpoint="/library/books"
          noun="book"
          addLabel="Add Book"
          canManage={canManage}
          reloadKey={reload}
          onLoaded={() => api.get('/library/stats').then(setStats).catch(() => {})}
          fields={[
            { key: 'title', label: 'Title', required: true, full: true },
            { key: 'author', label: 'Author' },
            { key: 'accession_no', label: 'Accession no.' },
            { key: 'category', label: 'Category', placeholder: 'e.g. Fiction, Science, Urdu Adab' },
            { key: 'language', label: 'Language' },
            { key: 'publisher', label: 'Publisher' },
            { key: 'isbn', label: 'ISBN' },
            { key: 'shelf', label: 'Shelf / rack' },
            { key: 'copies', label: 'Copies', type: 'number', min: 1, default: 1, required: true },
            { key: 'price', label: 'Price', type: 'number', min: 0 }
          ]}
          filters={[{ key: 'search', label: 'Search title, author, acc. no…' }]}
          columns={[
            { key: 'accession_no', label: 'Acc. No' },
            { key: 'title', label: 'Title', render: (r) => <span dir="auto"><b>{r.title}</b></span> },
            { key: 'author', label: 'Author', render: (r) => <span dir="auto">{r.author}</span> },
            { key: 'category', label: 'Category' },
            { key: 'shelf', label: 'Shelf' },
            { key: 'available', label: 'Available', render: (r) => <Badge variant={r.available > 0 ? 'success' : 'danger'}>{`${r.available} / ${r.copies}`}</Badge> }
          ]}
          rowActions={(r) => (canManage && r.available > 0 ? <IconButton icon="send" tone="success" label="Issue this book" onClick={() => setIssuing({ book: r })} /> : null)}
          toPayload={(b) => ({ ...b, copies: b.copies === null ? 1 : Number(b.copies), price: b.price === null ? null : Number(b.price) })}
          emptyMessage="No books yet. Add your library's books to start issuing them."
          describe={(r) => r.title}
        />
      )}
      {tab === 'issued' && <IssuesTable status="open" canManage={canManage} reloadKey={reload} onChange={bump} toast={toast} />}
      {tab === 'history' && <IssuesTable status="returned" canManage={false} reloadKey={reload} onChange={bump} toast={toast} />}

      {issuing && <IssueModal book={issuing.book} onClose={() => setIssuing(null)} onDone={() => { setIssuing(null); bump(); }} toast={toast} />}
      {cfg && (
        <Modal title="Loan & Fine Rules" onClose={() => setCfg(null)}>
          <form onSubmit={async (e) => {
            e.preventDefault();
            try { await api.put('/library/settings', cfg); toast.success('Saved'); setCfg(null); } catch (err) { toast.error(err.message); }
          }}>
            <div className="form-grid">
              <div className="field"><label>Loan period (days)</label><input type="number" min="1" value={cfg.loan_days} onChange={(e) => setCfg({ ...cfg, loan_days: e.target.value })} /></div>
              <div className="field"><label>Late fine per day</label><input type="number" min="0" step="any" value={cfg.fine_per_day} onChange={(e) => setCfg({ ...cfg, fine_per_day: e.target.value })} /></div>
            </div>
            <div className="modal-footer"><button type="button" className="btn-ghost" onClick={() => setCfg(null)}>Cancel</button><button type="submit">Save</button></div>
          </form>
        </Modal>
      )}
    </div>
  );
}

function IssuesTable({ status, canManage, reloadKey, onChange, toast }) {
  const [rows, setRows] = useState([]);
  const [search, setSearch] = useState('');
  const [onlyOverdue, setOnlyOverdue] = useState(false);
  const [returning, setReturning] = useState(null);
  const s = status === 'open' && onlyOverdue ? 'overdue' : status;

  useEffect(() => {
    api.get(`/library/issues?status=${s}&search=${encodeURIComponent(search)}`).then(setRows).catch((err) => toast.error(err.message));
  }, [s, search, reloadKey]); // eslint-disable-line react-hooks/exhaustive-deps

  async function renew(r) {
    const due = window.prompt('New return date (YYYY-MM-DD)', r.due_on);
    if (!due) return;
    try { await api.post(`/library/issues/${r.id}/renew`, { due_on: due }); toast.success('Renewed'); onChange(); } catch (err) { toast.error(err.message); }
  }

  return (
    <div className="card">
      <div className="row filters" style={{ marginBottom: 10 }}>
        <input placeholder="Search book or borrower…" dir="auto" value={search} onChange={(e) => setSearch(e.target.value)} />
        {status === 'open' && <label className="row" style={{ margin: 0, gap: 4 }}><input type="checkbox" style={{ width: 'auto' }} checked={onlyOverdue} onChange={(e) => setOnlyOverdue(e.target.checked)} /> Overdue only</label>}
      </div>
      <table>
        <thead><tr><th>Book</th><th>Borrower</th><th>Issued</th><th>Due</th>{status === 'returned' && <th>Returned</th>}<th>Late</th><th>Fine</th><th /></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td dir="auto"><b>{r.title}</b><div className="muted" style={{ fontSize: '0.75rem' }}>{r.accession_no}</div></td>
              <td>{r.borrower_name}</td><td>{r.issued_on}</td>
              <td style={!r.returned_on && r.late_days ? { color: 'var(--danger)', fontWeight: 600 } : undefined}>{r.due_on}</td>
              {status === 'returned' && <td>{r.returned_on}</td>}
              <td>{r.late_days ? `${r.late_days} day(s)` : '—'}</td>
              <td>{r.fine_due ? money(r.fine_due) : '—'}</td>
              <td><div className="actions-cell">
                {canManage && !r.returned_on && <IconButton icon="undo" tone="success" label="Return" onClick={() => setReturning({ ...r, fine: r.fine_due, returned_on: todayStr() })} />}
                {canManage && !r.returned_on && <IconButton icon="history" tone="default" label="Renew (extend due date)" onClick={() => renew(r)} />}
              </div></td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td colSpan={8} className="muted">Nothing here.</td></tr>}
        </tbody>
      </table>
      {returning && (
        <Modal title={`Return — ${returning.title}`} onClose={() => setReturning(null)}>
          <form onSubmit={async (e) => {
            e.preventDefault();
            try {
              const res = await api.post(`/library/issues/${returning.id}/return`, { returned_on: returning.returned_on, fine: returning.fine });
              toast.success(`Returned${res.fine ? ` — fine ${money(res.fine)}` : ''}`);
              setReturning(null);
              onChange();
            } catch (err) { toast.error(err.message); }
          }}>
            <p className="muted" style={{ marginTop: 0 }}>{returning.borrower_name} · due {returning.due_on}</p>
            <div className="form-grid">
              <div className="field"><label>Returned on</label><DateInput value={returning.returned_on} onChange={(e) => setReturning({ ...returning, returned_on: e.target.value })} /></div>
              <div className="field"><label>Fine</label><input type="number" min="0" step="any" value={returning.fine} onChange={(e) => setReturning({ ...returning, fine: e.target.value })} /></div>
            </div>
            <div className="modal-footer"><button type="button" className="btn-ghost" onClick={() => setReturning(null)}>Cancel</button><button type="submit">Return Book</button></div>
          </form>
        </Modal>
      )}
    </div>
  );
}

function IssueModal({ book, onClose, onDone, toast }) {
  const [type, setType] = useState('student');
  const [people, setPeople] = useState([]);
  const [search, setSearch] = useState('');
  const [borrowerId, setBorrowerId] = useState('');
  const [issuedOn, setIssuedOn] = useState(todayStr());
  const [dueOn, setDueOn] = useState('');

  useEffect(() => {
    setBorrowerId('');
    api.get(`/library/borrowers?type=${type}`).then((list) => {
      setPeople(list);
    }).catch(() => setPeople([]));
  }, [type]);

  const shown = people.filter((p) => p.label.toLowerCase().includes(search.toLowerCase())).slice(0, 200);

  async function submit(e) {
    e.preventDefault();
    try {
      const res = await api.post('/library/issues', { book_id: book.id, borrower_type: type, borrower_id: Number(borrowerId), issued_on: issuedOn, due_on: dueOn || undefined });
      toast.success(`Issued — return by ${res.due_on}`);
      onDone();
    } catch (err) { toast.error(err.message); }
  }

  return (
    <Modal title={`Issue — ${book.title}`} onClose={onClose}>
      <form onSubmit={submit}>
        <div className="seg" style={{ marginBottom: 10 }}>
          {[['student', 'Student'], ['teacher', 'Teacher'], ['staff', 'Staff']].map(([k, l]) => <button key={k} type="button" className={type === k ? 'active' : ''} onClick={() => setType(k)}>{l}</button>)}
        </div>
        <div className="field"><label>Find</label><input placeholder="Type a name…" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
        <div className="field"><label>Borrower</label>
          <select required value={borrowerId} onChange={(e) => setBorrowerId(e.target.value)} size={Math.min(8, Math.max(3, shown.length))}>
            {shown.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
        </div>
        <div className="form-grid">
          <div className="field"><label>Issue date</label><DateInput value={issuedOn} onChange={(e) => setIssuedOn(e.target.value)} /></div>
          <div className="field"><label>Return by <span className="muted">(blank = loan period)</span></label><DateInput value={dueOn} onChange={(e) => setDueOn(e.target.value)} /></div>
        </div>
        <div className="modal-footer"><button type="button" className="btn-ghost" onClick={onClose}>Cancel</button><button type="submit" disabled={!borrowerId}>Issue Book</button></div>
      </form>
    </Modal>
  );
}
