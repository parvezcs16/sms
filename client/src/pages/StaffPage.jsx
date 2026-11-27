import { useEffect, useState } from 'react';
import { api, downloadFile } from '../api/client';
import { useToast } from '../context/ToastContext';
import DataTable from '../components/DataTable';
import Modal from '../components/Modal';
import Badge from '../components/Badge';
import Avatar from '../components/Avatar';
import StaffFormModal from '../components/StaffFormModal';
import EmploymentModal from '../components/EmploymentModal';
import HistoryModal from '../components/HistoryModal';
import IconButton from '../components/IconButton';
import DateInput from '../components/DateInput';

const emptyLeave = { staff_id: '', leave_type: 'Casual', start_date: '', end_date: '', reason: '' };

export default function StaffPage() {
  const toast = useToast();
  const [tab, setTab] = useState('directory');
  const [rows, setRows] = useState([]);
  const [categories, setCategories] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, limit: 15, total: 0 });
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState(null);
  const [employment, setEmployment] = useState(null);
  const [history, setHistory] = useState(null);
  const [showRelieved, setShowRelieved] = useState(true);
  const [leaves, setLeaves] = useState([]);
  const [leaveForm, setLeaveForm] = useState(emptyLeave);

  async function load(page = pagination.page, q = search) {
    setLoading(true);
    try {
      const data = await api.get(`/staff?search=${encodeURIComponent(q)}&page=${page}&limit=${pagination.limit}`);
      setRows(data.rows);
      setPagination(data.pagination);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function loadLeaves() {
    setLeaves(await api.get('/staff/leaves/all'));
  }

  useEffect(() => {
    load(1, '');
    api.get('/staff/categories').then(setCategories);
    loadLeaves();
  }, []);

  async function openEdit(id) {
    try { setEditing(await api.get(`/staff/${id}`)); } catch (err) { toast.error(err.message); }
  }

  async function archive(id) {
    if (!window.confirm('Archive this staff record? (For someone leaving the job, use Relieve instead — it keeps their dates and salary history.)')) return;
    try {
      await api.del(`/staff/${id}`);
      toast.success('Staff record archived');
      load();
    } catch (err) {
      toast.error(err.message);
    }
  }

  async function submitLeave(e) {
    e.preventDefault();
    try {
      await api.post(`/staff/${leaveForm.staff_id}/leaves`, leaveForm);
      toast.success('Leave recorded');
      setLeaveForm(emptyLeave);
      loadLeaves();
    } catch (err) {
      toast.error(err.message);
    }
  }

  async function decideLeave(leaveId, status) {
    try {
      await api.put(`/staff/leaves/${leaveId}/decision`, { status });
      toast.success(`Leave ${status.toLowerCase()}`);
      loadLeaves();
    } catch (err) {
      toast.error(err.message);
    }
  }

  return (
    <div>
      <div className="page-header">
        <h2>Non-Teaching Staff</h2>
        {tab === 'directory' && (
          <div className="page-actions">
            <button type="button" className="btn-secondary" onClick={() => downloadFile('/staff/id-cards.pdf', 'staff-id-cards.pdf')}>Print ID Cards (all)</button>
            <button type="button" onClick={() => setShowCreate(true)}>+ Add Staff Member</button>
          </div>
        )}
      </div>
      <div className="row" style={{ marginBottom: 16 }}>
        <button type="button" className={tab === 'directory' ? '' : 'btn-ghost'} onClick={() => setTab('directory')}>Directory</button>
        <button type="button" className={tab === 'leaves' ? '' : 'btn-ghost'} onClick={() => setTab('leaves')}>Leave</button>
      </div>

      {tab === 'directory' && (
        <div className="card">
          <label className="row" style={{ margin: '0 0 8px' }}><input type="checkbox" style={{ width: 'auto' }} checked={showRelieved} onChange={(e) => setShowRelieved(e.target.checked)} /> Show relieved staff</label>
          <DataTable
            loading={loading}
            search={search}
            onSearchChange={(v) => { setSearch(v); load(1, v); }}
            columns={[
              { key: 'photo_path', label: '', render: (r) => <Avatar photo={r.photo_path} name={r.full_name} size={34} /> },
              { key: 'staff_code', label: 'Code' },
              { key: 'full_name', label: 'Name', render: (r) => <a href="#" onClick={(e) => { e.preventDefault(); openEdit(r.id); }}>{r.full_name}</a> },
              { key: 'category_name', label: 'Category', render: (r) => <Badge variant="muted">{r.category_name}</Badge> },
              { key: 'phone', label: 'Phone' },
              { key: 'status', label: 'Status', render: (r) => <><Badge>{r.status}</Badge>{r.relieved_on && <span className="muted" style={{ fontSize: '0.75rem' }}> since {r.relieved_on}</span>}</> }
            ]}
            rows={showRelieved ? rows : rows.filter((r) => r.status !== 'Relieved')}
            pagination={{ ...pagination, onPageChange: (p) => load(p) }}
            rowActions={(row) => (
              <>
                <IconButton icon="edit" tone="primary" label="Edit" onClick={() => openEdit(row.id)} />
                <IconButton icon="pdf" tone="default" label="ID card" onClick={() => downloadFile(`/staff/id-cards.pdf?ids=${row.id}`, `id-card-${row.staff_code}.pdf`)} />
                <IconButton icon={row.status === 'Relieved' ? 'rejoin' : 'relieve'} tone={row.status === 'Relieved' ? 'success' : 'default'} label={row.status === 'Relieved' ? 'Re-join' : 'Relieve'} onClick={() => setEmployment(row)} />
                <IconButton icon="history" tone="default" label="History" onClick={() => setHistory(row)} />
                <IconButton icon="archive" tone="default" label="Archive" onClick={() => archive(row.id)} />
              </>
            )}
          />
        </div>
      )}

      {tab === 'leaves' && (
        <div className="grid two-col">
          <div className="card">
            <h3>Leave Requests</h3>
            <table>
              <thead><tr><th>Staff</th><th>Type</th><th>From</th><th>To</th><th>Status</th><th>Actions</th></tr></thead>
              <tbody>
                {leaves.map((l) => (
                  <tr key={l.id}>
                    <td>{l.staff_name}</td><td>{l.leave_type}</td><td>{l.start_date}</td><td>{l.end_date}</td>
                    <td><Badge>{l.status}</Badge></td>
                    <td>
                      {l.status === 'Pending' && (
                        <>
                          <IconButton icon="check" tone="success" label="Approve" onClick={() => decideLeave(l.id, 'Approved')} />
                          <IconButton icon="ban" tone="danger" label="Reject" onClick={() => decideLeave(l.id, 'Rejected')} />
                        </>
                      )}
                    </td>
                  </tr>
                ))}
                {leaves.length === 0 && <tr><td colSpan={6} className="muted">No leave requests yet.</td></tr>}
              </tbody>
            </table>
          </div>
          <div className="card">
            <h3>Record Leave</h3>
            <form onSubmit={submitLeave}>
              <div className="field"><label>Staff Member</label>
                <select required value={leaveForm.staff_id} onChange={(e) => setLeaveForm({ ...leaveForm, staff_id: e.target.value })}>
                  <option value="">Select</option>{rows.map((r) => <option key={r.id} value={r.id}>{r.full_name}</option>)}
                </select>
              </div>
              <div className="field"><label>Leave Type</label>
                <select value={leaveForm.leave_type} onChange={(e) => setLeaveForm({ ...leaveForm, leave_type: e.target.value })}>
                  <option>Casual</option><option>Sick</option><option>Annual</option><option>Unpaid</option>
                </select>
              </div>
              <div className="field"><label>Reason</label><input value={leaveForm.reason} onChange={(e) => setLeaveForm({ ...leaveForm, reason: e.target.value })} /></div>
              <div className="field"><label>Start Date</label><DateInput required value={leaveForm.start_date} onChange={(e) => setLeaveForm({ ...leaveForm, start_date: e.target.value })} /></div>
              <div className="field"><label>End Date</label><DateInput required value={leaveForm.end_date} onChange={(e) => setLeaveForm({ ...leaveForm, end_date: e.target.value })} /></div>
              <button type="submit">Record Leave</button>
            </form>
          </div>
        </div>
      )}

      {(showCreate || editing) && (
        <StaffFormModal
          member={editing}
          categories={categories}
          onClose={() => { setShowCreate(false); setEditing(null); }}
          onSaved={() => { setShowCreate(false); setEditing(null); load(); }}
        />
      )}
      {employment && (
        <EmploymentModal kind="staff" person={employment} onClose={() => setEmployment(null)} onDone={() => { setEmployment(null); load(); }} />
      )}
      {history && (
        <HistoryModal entityType="staff" entityId={history.id} title={`History — ${history.full_name}`} onClose={() => setHistory(null)} />
      )}
    </div>
  );
}
