import { useState } from 'react';
import { api } from '../api/client';
import { useToast } from '../context/ToastContext';
import Modal from './Modal';
import PhotoInput from './PhotoInput';
import { EmploymentHistory } from './EmploymentModal';
import DateInput from './DateInput';

const blank = {
  full_name: '', father_name: '', gender: '', date_of_birth: '', category_id: '', email: '', phone: '', address: '',
  employment_type: 'Full-time', hire_date: '', status: 'Active', create_login: false, username: '', password: ''
};

function fromMember(m) {
  const out = { ...blank };
  Object.keys(blank).forEach((k) => { if (m[k] !== undefined && m[k] !== null) out[k] = m[k]; });
  out.category_id = m.category_id ? String(m.category_id) : '';
  out.create_login = false;
  return out;
}

// Add or edit a non-teaching staff member (same form for both).
export default function StaffFormModal({ member, categories, onClose, onSaved }) {
  const toast = useToast();
  const editing = Boolean(member);
  const [form, setForm] = useState(() => (editing ? fromMember(member) : blank));
  const [photo, setPhoto] = useState(null);
  const [currentPhoto, setCurrentPhoto] = useState(member?.photo_path || null);
  const [saving, setSaving] = useState(false);
  const set = (f) => (e) => setForm({ ...form, [f]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });

  async function removePhoto() {
    if (!window.confirm('Remove this photo?')) return;
    try {
      await api.del(`/staff/${member.id}/photo`);
      setCurrentPhoto(null);
    } catch (err) {
      toast.error(err.message);
    }
  }

  async function submit(e) {
    e.preventDefault();
    setSaving(true);
    try {
      let id = member?.id;
      if (editing) {
        const { create_login, username, password, ...fields } = form;
        if (create_login && !member.user_id) Object.assign(fields, { create_login, username, password });
        if (fields.status === 'Relieved') delete fields.status; // relieving goes through the Relieve button
        await api.put(`/staff/${id}`, fields);
      } else {
        id = (await api.post('/staff', form)).id;
      }
      if (photo) {
        const fd = new FormData();
        fd.append('photo', photo);
        try { await api.upload(`/staff/${id}/photo`, fd); } catch (err) { toast.error(`Saved, but the photo failed to upload: ${err.message}`); }
      }
      toast.success(editing ? 'Staff details updated' : 'Staff member added');
      onSaved(id);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={editing ? `Edit — ${member.full_name}` : 'Add Staff Member'} onClose={onClose} wide>
      <form onSubmit={submit}>
        <PhotoInput label="Photo" currentPhoto={currentPhoto} file={photo} onChange={setPhoto} onRemove={editing ? removePhoto : undefined} />
        <div className="form-grid">
          <div className="field"><label>Full Name *</label><input required value={form.full_name} onChange={set('full_name')} /></div>
          <div className="field"><label>Father Name</label><input value={form.father_name} onChange={set('father_name')} /></div>
          <div className="field"><label>Category *</label>
            <select required value={form.category_id} onChange={set('category_id')}>
              <option value="">Select</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div className="field"><label>Gender</label>
            <select value={form.gender} onChange={set('gender')}>
              <option value="">Select</option><option>Male</option><option>Female</option><option>Other</option>
            </select>
          </div>
          <div className="field"><label>Date of Birth</label><DateInput value={form.date_of_birth} onChange={set('date_of_birth')} /></div>
          <div className="field"><label>Phone</label><input type="tel" value={form.phone} onChange={set('phone')} /></div>
          <div className="field"><label>Email</label><input type="email" value={form.email} onChange={set('email')} /></div>
          <div className="field"><label>Employment Type</label>
            <select value={form.employment_type} onChange={set('employment_type')}>
              <option>Full-time</option><option>Part-time</option><option>Contract</option><option>Daily Wage</option>
            </select>
          </div>
          <div className="field"><label>Joining Date</label><DateInput value={form.hire_date} onChange={set('hire_date')} /></div>
          {editing && member.status !== 'Relieved' && (
            <div className="field"><label>Status</label>
              <select value={form.status} onChange={set('status')}>
                <option>Active</option><option>Inactive</option><option>On Leave</option>
              </select>
            </div>
          )}
        </div>
        <div className="field"><label>Address</label><textarea value={form.address} onChange={set('address')} /></div>
        {(!editing || !member.user_id) && (
          <>
            <div className="field row">
              <label style={{ margin: 0 }}><input type="checkbox" style={{ width: 'auto' }} checked={form.create_login} onChange={set('create_login')} /> Create a login for this staff member (lets them check in their own attendance)</label>
            </div>
            {form.create_login && (
              <div className="form-grid">
                <div className="field"><label>Username</label><input value={form.username} onChange={set('username')} /></div>
                <div className="field"><label>Password</label><input type="password" value={form.password} onChange={set('password')} /></div>
              </div>
            )}
          </>
        )}
        {editing && <EmploymentHistory kind="staff" personId={member.id} />}
        <div className="modal-footer">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" disabled={saving}>{saving ? 'Saving…' : editing ? 'Save Changes' : 'Save Staff Member'}</button>
        </div>
      </form>
    </Modal>
  );
}
