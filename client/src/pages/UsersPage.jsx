import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { useToast } from '../context/ToastContext';
import DataTable from '../components/DataTable';
import Modal from '../components/Modal';
import Badge from '../components/Badge';
import HistoryModal from '../components/HistoryModal';
import PermissionsModal from '../components/PermissionsModal';
import { useAuth } from '../context/AuthContext';
import IconButton from '../components/IconButton';

const ROLE_LABEL = (r) => (r || '').replace('_', ' ');

export default function UsersPage() {
  const toast = useToast();
  const [rows, setRows] = useState([]);
  const [roles, setRoles] = useState([]);
  const [search, setSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [resetTarget, setResetTarget] = useState(null);
  const [newPassword, setNewPassword] = useState('');
  const [form, setForm] = useState({ username: '', password: '', role: '', full_name: '', email: '', phone: '' });
  const { user: me } = useAuth();
  const [editing, setEditing] = useState(null);
  const [history, setHistory] = useState(null);
  const [showArchived, setShowArchived] = useState(false);
  const [permUser, setPermUser] = useState(null);
  const MGMT = ['super_admin', 'principal', 'admin'];

  async function load(q = search, archived = showArchived) {
    try {
      setRows(await api.get(`/users?search=${encodeURIComponent(q)}&include_archived=${archived}`));
    } catch (err) {
      toast.error(err.message);
    }
  }
  useEffect(() => { load(); api.get('/users/roles').then(setRoles); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function saveEdit(e) {
    e.preventDefault();
    try {
      const { id, username, full_name, email, phone, role } = editing;
      await api.put(`/users/${id}`, { username, full_name, email, phone, role });
      toast.success('Account updated');
      setEditing(null);
      load();
    } catch (err) {
      toast.error(err.message);
    }
  }

  async function removeUser(row) {
    const linked = row.teacher_id ? ' Their teacher record is kept.' : row.staff_id ? ' Their staff record is kept.' : '';
    if (!window.confirm(`Remove ${row.full_name} (${row.username})? They will no longer be able to sign in. The account is archived, not erased, and can be restored.${linked}`)) return;
    try {
      await api.del(`/users/${row.id}`);
      toast.success('Account removed (archived)');
      load();
    } catch (err) {
      toast.error(err.message);
    }
  }

  async function restoreUser(row) {
    try {
      await api.post(`/users/${row.id}/restore`, {});
      toast.success('Account restored');
      load();
    } catch (err) {
      toast.error(err.message);
    }
  }

  async function submit(e) {
    e.preventDefault();
    try {
      await api.post('/users', form);
      toast.success('User account created');
      setShowCreate(false);
      setForm({ username: '', password: '', role: '', full_name: '', email: '', phone: '' });
      load();
    } catch (err) {
      toast.error(err.message);
    }
  }

  async function toggleActive(row) {
    try {
      await api.put(`/users/${row.id}`, { is_active: row.is_active ? 0 : 1 });
      load();
    } catch (err) {
      toast.error(err.message);
    }
  }

  async function submitReset(e) {
    e.preventDefault();
    try {
      await api.post(`/users/${resetTarget.id}/reset-password`, { newPassword });
      toast.success('Password reset');
      setResetTarget(null);
      setNewPassword('');
    } catch (err) {
      toast.error(err.message);
    }
  }

  return (
    <div>
      <div className="page-header"><h2>User Accounts</h2><button type="button" onClick={() => setShowCreate(true)}>+ New Account</button></div>
      <div className="card">
        <label className="row" style={{ margin: '0 0 8px' }}>
          <input type="checkbox" style={{ width: 'auto' }} checked={showArchived} onChange={(e) => { setShowArchived(e.target.checked); load(search, e.target.checked); }} /> Show removed accounts
        </label>
        <DataTable
          search={search} onSearchChange={(v) => { setSearch(v); load(v); }}
          columns={[
            { key: 'username', label: 'Username' }, { key: 'full_name', label: 'Name' }, { key: 'role', label: 'Role', render: (r) => <Badge>{ROLE_LABEL(r.role)}</Badge> },
            { key: 'email', label: 'Contact', render: (r) => (r.email || r.phone ? <div className="contact-cell">{r.email && <div>{r.email}</div>}{r.phone && <div className="muted">{r.phone}</div>}</div> : <span className="muted">—</span>) },
            { key: 'is_active', label: 'Status', render: (r) => <Badge>{r.archived_at ? 'Archived' : r.is_active ? 'Active' : 'Inactive'}</Badge> }
          ]}
          rows={rows}
          rowActions={(row) => (row.archived_at ? (
            <>
              <IconButton icon="restore" tone="success" label="Restore" onClick={() => restoreUser(row)} />
              <IconButton icon="history" tone="default" label="History" onClick={() => setHistory(row)} />
            </>
          ) : (!me.is_management && MGMT.includes(row.role)) ? <span className="muted" style={{ fontSize: '0.8rem' }}>Managed by Admin</span> : (
            <>
              <IconButton icon="edit" tone="primary" label="Edit" onClick={() => setEditing({ ...row, email: row.email || '', phone: row.phone || '' })} />
              <IconButton icon="power" tone={row.is_active ? 'default' : 'success'} label={row.id === me.id ? 'You cannot disable your own account' : row.is_active ? 'Disable sign-in' : 'Enable sign-in'} onClick={() => toggleActive(row)} disabled={row.id === me.id} />
              {me.is_management && !MGMT.includes(row.role) && <IconButton icon="shield" tone="default" label="Permissions" onClick={() => setPermUser(row)} />}
              <IconButton icon="key" tone="default" label="Reset password" onClick={() => setResetTarget(row)} />
              <IconButton icon="history" tone="default" label="History" onClick={() => setHistory(row)} />
              {row.id !== me.id && <IconButton icon="trash" tone="danger" label="Remove" onClick={() => removeUser(row)} />}
            </>
          ))}
        />
      </div>

      {showCreate && (
        <Modal title="New User Account" onClose={() => setShowCreate(false)}>
          <form onSubmit={submit}>
            <div className="field"><label>Full Name</label><input required value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} /></div>
            <div className="field"><label>Username</label><input required value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} /></div>
            <div className="field"><label>Password</label><input type="password" required value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></div>
            <div className="field"><label>Role</label>
              <select required value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                <option value="">Select</option>{roles.filter((r) => me.is_management || !MGMT.includes(r.name)).map((r) => <option key={r.id} value={r.name}>{ROLE_LABEL(r.name)}</option>)}
              </select>
            </div>
            <div className="field"><label>Email</label><input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
            <div className="field"><label>Phone</label><input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
            <div className="modal-footer">
              <button type="button" className="btn-ghost" onClick={() => setShowCreate(false)}>Cancel</button>
              <button type="submit">Create Account</button>
            </div>
          </form>
        </Modal>
      )}

      {editing && (
        <Modal title={`Edit Account — ${editing.username}`} onClose={() => setEditing(null)}>
          <form onSubmit={saveEdit}>
            <div className="field"><label>Full Name</label><input required value={editing.full_name} onChange={(e) => setEditing({ ...editing, full_name: e.target.value })} /></div>
            <div className="field"><label>Username</label><input required value={editing.username} onChange={(e) => setEditing({ ...editing, username: e.target.value })} /></div>
            <div className="field"><label>Role</label>
              <select value={editing.role} onChange={(e) => setEditing({ ...editing, role: e.target.value })} disabled={editing.id === me.id}>
                {roles.filter((r) => (r.name !== 'super_admin' || me.role === 'super_admin' || editing.role === 'super_admin') && (me.is_management || !MGMT.includes(r.name) || r.name === editing.role)).map((r) => <option key={r.id} value={r.name}>{ROLE_LABEL(r.name)}</option>)}
              </select>
              {editing.id === me.id && <span className="muted" style={{ fontSize: '0.75rem' }}>You cannot change your own role.</span>}
            </div>
            <div className="field"><label>Email</label><input type="email" value={editing.email} onChange={(e) => setEditing({ ...editing, email: e.target.value })} /></div>
            <div className="field"><label>Phone</label><input type="tel" value={editing.phone} onChange={(e) => setEditing({ ...editing, phone: e.target.value })} /></div>
            <div className="modal-footer">
              <button type="button" className="btn-ghost" onClick={() => setEditing(null)}>Cancel</button>
              <button type="submit">Save Changes</button>
            </div>
          </form>
        </Modal>
      )}
      {permUser && <PermissionsModal user={permUser} onClose={() => setPermUser(null)} />}
      {history && <HistoryModal entityType="user" entityId={history.id} title={`History — ${history.username}`} onClose={() => setHistory(null)} />}

      {resetTarget && (
        <Modal title={`Reset Password — ${resetTarget.username}`} onClose={() => setResetTarget(null)}>
          <form onSubmit={submitReset}>
            <div className="field"><label>New Password</label><input type="password" required minLength={6} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} /></div>
            <div className="modal-footer">
              <button type="button" className="btn-ghost" onClick={() => setResetTarget(null)}>Cancel</button>
              <button type="submit">Reset Password</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
