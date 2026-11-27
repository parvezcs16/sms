import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, downloadFile } from '../api/client';
import { useToast } from '../context/ToastContext';
import DataTable from '../components/DataTable';
import Badge from '../components/Badge';
import Avatar from '../components/Avatar';
import TeacherFormModal from '../components/TeacherFormModal';
import EmploymentModal from '../components/EmploymentModal';
import HistoryModal from '../components/HistoryModal';
import IconButton, { IconLink } from '../components/IconButton';

export default function TeachersPage() {
  const toast = useToast();
  const [rows, setRows] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, limit: 15, total: 0 });
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState(null);
  const [employment, setEmployment] = useState(null);
  const [history, setHistory] = useState(null);

  async function load(page = pagination.page, q = search) {
    setLoading(true);
    try {
      const data = await api.get(`/teachers?search=${encodeURIComponent(q)}&page=${page}&limit=${pagination.limit}`);
      setRows(data.rows);
      setPagination(data.pagination);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(1, ''); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function archive(id) {
    if (!window.confirm('Archive this teacher?')) return;
    try {
      await api.del(`/teachers/${id}`);
      toast.success('Teacher archived');
      load();
    } catch (err) {
      toast.error(err.message);
    }
  }

  return (
    <div>
      <div className="page-header">
        <h2>Teachers</h2>
        <div className="page-actions">
          <button type="button" className="btn-secondary" onClick={() => downloadFile('/teachers/id-cards.pdf', 'teacher-id-cards.pdf')}>Print ID Cards (all)</button>
          <button type="button" onClick={() => setShowCreate(true)}>+ Add Teacher</button>
        </div>
      </div>

      <div className="card">
        <DataTable
          loading={loading}
          search={search}
          onSearchChange={(v) => { setSearch(v); load(1, v); }}
          columns={[
            { key: 'photo_path', label: '', render: (r) => <Avatar photo={r.photo_path} name={r.full_name} size={34} /> },
            { key: 'teacher_code', label: 'Code' },
            { key: 'full_name', label: 'Name', render: (r) => <Link to={`/teachers/${r.id}`}>{r.full_name}</Link> },
            { key: 'designation', label: 'Designation' },
            { key: 'phone', label: 'Phone' },
            { key: 'status', label: 'Status', render: (r) => <><Badge>{r.status}</Badge>{r.relieved_on && <span className="muted" style={{ fontSize: '0.75rem' }}> since {r.relieved_on}</span>}</> }
          ]}
          rows={rows}
          pagination={{ ...pagination, onPageChange: (p) => load(p) }}
          rowActions={(row) => (
            <>
              <IconLink icon="view" label="View profile" to={`/teachers/${row.id}`} LinkComponent={Link} />
              <IconButton icon="edit" tone="primary" label="Edit" onClick={() => setEditing(row)} />
              <IconButton icon="pdf" tone="default" label="ID card" onClick={() => downloadFile(`/teachers/id-cards.pdf?ids=${row.id}`, `id-card-${row.teacher_code}.pdf`)} />
              <IconButton icon={row.status === 'Relieved' ? 'rejoin' : 'relieve'} tone={row.status === 'Relieved' ? 'success' : 'default'} label={row.status === 'Relieved' ? 'Re-join' : 'Relieve'} onClick={() => setEmployment(row)} />
              <IconButton icon="history" tone="default" label="History" onClick={() => setHistory(row)} />
              <IconButton icon="archive" tone="default" label="Archive" onClick={() => archive(row.id)} />
            </>
          )}
        />
      </div>

      {(showCreate || editing) && (
        <TeacherFormModal
          teacher={editing}
          onClose={() => { setShowCreate(false); setEditing(null); }}
          onSaved={() => { setShowCreate(false); setEditing(null); load(); }}
        />
      )}
      {employment && (
        <EmploymentModal kind="teacher" person={employment} onClose={() => setEmployment(null)} onDone={() => { setEmployment(null); load(); }} />
      )}
      {history && (
        <HistoryModal entityType="teacher" entityId={history.id} title={`History — ${history.full_name}`} onClose={() => setHistory(null)} />
      )}
    </div>
  );
}
