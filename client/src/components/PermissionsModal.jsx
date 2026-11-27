import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { useToast } from '../context/ToastContext';
import Modal from './Modal';

const LEVELS = [
  { key: 'none', label: 'No access' },
  { key: 'view', label: 'View only' },
  { key: 'manage', label: 'View & manage' }
];

// Admin / Principal / Super Admin choose, area by area, what a user can open
// (View only) or change (View & manage). Starts from the user's role defaults.
export default function PermissionsModal({ user, onClose, onSaved }) {
  const toast = useToast();
  const [modules, setModules] = useState([]);
  const [data, setData] = useState(null);
  const [draft, setDraft] = useState({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    Promise.all([api.get('/users/permissions/modules'), api.get(`/users/${user.id}/permissions`)])
      .then(([m, d]) => { setModules(m.modules); setData(d); setDraft(d.effective); })
      .catch((err) => toast.error(err.message));
  }, [user.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function save() {
    setSaving(true);
    try {
      await api.put(`/users/${user.id}/permissions`, { permissions: draft });
      toast.success(`Permissions saved for ${user.full_name}. They apply straight away.`);
      onSaved && onSaved();
      onClose();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  }

  const setAll = (level) => setDraft(Object.fromEntries(modules.map((m) => [m.key, level])));
  const changedCount = data ? modules.filter((m) => draft[m.key] !== data.defaults[m.key]).length : 0;

  return (
    <Modal title={`Permissions — ${user.full_name} (${user.username})`} onClose={onClose} wide>
      {!data ? <p className="muted">Loading…</p> : data.fullAccess ? (
        <p>{user.full_name} is a <b>{data.user.role.replace('_', ' ')}</b> and always has full access to everything.</p>
      ) : (
        <>
          <p className="muted">
            Role: <b>{data.user.role}</b>. Pick what this person can do in each area. <b>View only</b> lets them open and read it;
            <b> View &amp; manage</b> also lets them add, edit and delete. Items marked “role default” are what a {data.user.role} gets normally.
          </p>
          <div className="row" style={{ marginBottom: 8 }}>
            <button type="button" className="btn-ghost btn-sm" onClick={() => setDraft(data.defaults)}>Reset to role defaults</button>
            <button type="button" className="btn-ghost btn-sm" onClick={() => setAll('view')}>View all</button>
            <button type="button" className="btn-ghost btn-sm" onClick={() => setAll('none')}>Remove all</button>
          </div>
          <table className="perm-table">
            <thead><tr><th>Area</th>{LEVELS.map((l) => <th key={l.key}>{l.label}</th>)}</tr></thead>
            <tbody>
              {modules.map((m) => (
                <tr key={m.key} className={draft[m.key] !== data.defaults[m.key] ? 'perm-changed' : ''}>
                  <td>
                    {m.label}
                    {draft[m.key] !== data.defaults[m.key] && <span className="edited-tag">CHANGED</span>}
                  </td>
                  {LEVELS.map((l) => (
                    <td key={l.key} className="perm-cell" onClick={() => setDraft({ ...draft, [m.key]: l.key })}>
                      <input type="radio" name={`perm-${m.key}`} checked={draft[m.key] === l.key} onChange={() => setDraft({ ...draft, [m.key]: l.key })} />
                      {data.defaults[m.key] === l.key && <span className="muted perm-default">role default</span>}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted" style={{ fontSize: '0.8rem', marginTop: 8 }}>
            Only an Admin, Principal or Super Admin can change permissions, create Admin-level accounts or restore backups — those are never given away here.
            Teachers can always mark attendance for their own assigned classes; “Attendance” here means every class plus teacher &amp; staff attendance.
          </p>
        </>
      )}
      <div className="modal-footer">
        <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
        {data && !data.fullAccess && <button type="button" onClick={save} disabled={saving}>{saving ? 'Saving…' : `Save Permissions${changedCount ? ` (${changedCount} changed from default)` : ''}`}</button>}
      </div>
    </Modal>
  );
}
