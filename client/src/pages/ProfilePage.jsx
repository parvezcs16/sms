import { useState } from 'react';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import PhotoInput from '../components/PhotoInput';
import Avatar from '../components/Avatar';

const ROLE_LABEL = (r) => String(r || '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

// Everyone can update their own name, contact number, email and photo here.
export default function ProfilePage() {
  const { user, refresh } = useAuth();
  const toast = useToast();
  const [form, setForm] = useState({ full_name: user.full_name || '', phone: user.phone || '', email: user.email || '' });
  const [photoFile, setPhotoFile] = useState(null);
  const [saving, setSaving] = useState(false);
  const [pw, setPw] = useState({ currentPassword: '', newPassword: '', confirm: '' });

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await api.put('/auth/profile', form);
      if (photoFile) {
        const fd = new FormData();
        fd.append('photo', photoFile);
        await api.upload('/auth/profile/photo', fd);
        setPhotoFile(null);
      }
      await refresh();
      toast.success('Profile updated');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function removePhoto() {
    try {
      await api.del('/auth/profile/photo');
      await refresh();
      toast.success('Photo removed');
    } catch (err) {
      toast.error(err.message);
    }
  }

  async function changePassword(e) {
    e.preventDefault();
    if (pw.newPassword !== pw.confirm) { toast.error('New passwords do not match'); return; }
    try {
      await api.post('/auth/change-password', { currentPassword: pw.currentPassword, newPassword: pw.newPassword });
      setPw({ currentPassword: '', newPassword: '', confirm: '' });
      toast.success('Password changed');
    } catch (err) {
      toast.error(err.message);
    }
  }

  return (
    <div>
      <div className="page-header"><h2>My Profile</h2></div>
      <div className="profile-head card">
        <Avatar photo={user.photo} name={user.full_name} size={72} />
        <div>
          <h3 style={{ margin: 0 }}>{user.full_name}</h3>
          <div className="muted">{ROLE_LABEL(user.role)} · @{user.username}</div>
          {(user.phone || user.email) && <div className="muted" style={{ fontSize: '0.82rem' }}>{[user.phone, user.email].filter(Boolean).join(' · ')}</div>}
        </div>
      </div>

      <div className="grid two-col">
        <form className="card" onSubmit={save}>
          <h3>Personal details</h3>
          <PhotoInput label="Profile photo" currentPhoto={user.photo} file={photoFile} onChange={setPhotoFile} onRemove={removePhoto} />
          <div className="field"><label>Full name</label><input required value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} /></div>
          <div className="form-grid">
            <div className="field"><label>Contact number</label><input type="tel" placeholder="e.g. 0300-1234567" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
            <div className="field"><label>Email</label><input type="email" placeholder="name@example.com" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
          </div>
          <div className="field"><label>Username</label><input value={user.username} disabled /><span className="muted" style={{ fontSize: '0.78rem' }}>Only an Admin can change usernames (User Management).</span></div>
          <button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save Profile'}</button>
        </form>

        <form className="card" onSubmit={changePassword}>
          <h3>Change password</h3>
          <div className="field"><label>Current password</label><input type="password" autoComplete="current-password" required value={pw.currentPassword} onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })} /></div>
          <div className="field"><label>New password</label><input type="password" autoComplete="new-password" minLength={6} required value={pw.newPassword} onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} /></div>
          <div className="field"><label>Confirm new password</label><input type="password" autoComplete="new-password" minLength={6} required value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} /></div>
          <button type="submit" className="btn-secondary">Change Password</button>
        </form>
      </div>
    </div>
  );
}
