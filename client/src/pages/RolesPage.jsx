import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import PermissionsModal from '../components/PermissionsModal';

const ROLES = ['super_admin', 'principal', 'admin', 'accountant', 'teacher', 'staff', 'parent', 'student'];
const ROLE_LABEL = { super_admin: 'Super Admin', principal: 'Principal', admin: 'Admin', accountant: 'Accountant', teacher: 'Teacher', staff: 'Staff', parent: 'Parent', student: 'Student' };
const LEVEL = { manage: { t: 'Manage', c: 'var(--success, #15803d)' }, view: { t: 'View', c: 'var(--accent)' }, none: { t: '—', c: 'var(--text-muted)' } };

export default function RolesPage() {
  const { user } = useAuth();
  const [meta, setMeta] = useState(null);
  const [users, setUsers] = useState([]);
  const [role, setRole] = useState('');
  const [permUser, setPermUser] = useState(null);
  const [tick, setTick] = useState(0);

  useEffect(() => { api.get('/users/permissions/modules').then(setMeta).catch(() => {}); }, []);
  useEffect(() => { api.get(`/users?role=${role}`).then(setUsers).catch(() => setUsers([])); }, [role, tick]);

  if (!meta) return <div className="card muted">Loading…</div>;
  const level = (r, m) => (meta.managementRoles.includes(r) ? 'manage' : (meta.roleDefaults[r] || {})[m] || 'none');
  const people = users.filter((u) => !meta.managementRoles.includes(u.role));

  return (
    <div>
      <div className="page-header"><h2>Roles &amp; Permissions</h2></div>
      <div className="card">
        <h3>What each role can do by default</h3>
        <p className="muted" style={{ marginTop: 0 }}>Super Admin, Principal and Admin always have full access. Anyone else can be given more (or less) access individually below — changes apply immediately. Teachers always manage attendance, marks and homework for the classes they teach.</p>
        <div className="table-wrap">
          <table className="perm-matrix">
            <thead><tr><th>Area</th>{ROLES.map((r) => <th key={r}>{ROLE_LABEL[r]}</th>)}</tr></thead>
            <tbody>
              {meta.modules.map((m) => (
                <tr key={m.key}>
                  <td>{m.label}</td>
                  {ROLES.map((r) => { const l = LEVEL[level(r, m.key)]; return <td key={r} style={{ color: l.c, fontWeight: l.t === '—' ? 400 : 600 }}>{l.t}</td>; })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <div className="row" style={{ justifyContent: 'space-between', margin: '0 0 10px' }}>
          <h3 style={{ margin: 0 }}>Individual access</h3>
          <div className="row filters" style={{ margin: 0 }}>
            <select value={role} onChange={(e) => setRole(e.target.value)}>
              <option value="">All roles</option>{ROLES.filter((r) => !meta.managementRoles.includes(r)).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
            </select>
          </div>
        </div>
        <table>
          <thead><tr><th>Name</th><th>Username</th><th>Role</th><th>Access</th><th /></tr></thead>
          <tbody>
            {people.map((u) => (
              <tr key={u.id} className={user.is_management ? 'row-selectable' : ''} onClick={user.is_management ? () => setPermUser(u) : undefined}>
                <td>{u.full_name}</td><td>{u.username}</td><td>{ROLE_LABEL[u.role] || u.role}</td>
                <td>{u.custom_permissions ? <b>{u.custom_permissions} custom change(s)</b> : <span className="muted">Role default</span>}</td>
                <td>{user.is_management && <button type="button" className="btn-ghost btn-sm" onClick={(e) => { e.stopPropagation(); setPermUser(u); }}>Change access</button>}</td>
              </tr>
            ))}
            {people.length === 0 && <tr><td colSpan={5} className="muted">No users.</td></tr>}
          </tbody>
        </table>
      </div>
      {permUser && <PermissionsModal user={permUser} onClose={() => { setPermUser(null); setTick((t) => t + 1); }} onSaved={() => setTick((t) => t + 1)} />}
    </div>
  );
}
