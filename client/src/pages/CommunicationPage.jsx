import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { useToast } from '../context/ToastContext';
import Badge from '../components/Badge';
import ShareButtons from '../components/ShareButtons';

const CATEGORIES = ['Announcement', 'Holiday', 'Circular', 'Emergency'];
const CHANNELS = ['email', 'sms', 'whatsapp'];

export default function CommunicationPage() {
  const toast = useToast();
  const [history, setHistory] = useState([]);
  const [sections, setSections] = useState([]);
  const [channelStatus, setChannelStatus] = useState(null);
  const [form, setForm] = useState({ title: '', message: '', category: 'Announcement', audienceType: 'All', audienceRef: '', channels: ['email'], attachPdf: false });

  async function loadHistory() { setHistory(await api.get('/notifications')); }
  useEffect(() => {
    loadHistory();
    api.get('/academics/sections').then(setSections).catch(() => {});
    api.get('/notifications/channel-status').then(setChannelStatus).catch(() => {});
  }, []);

  function toggleChannel(channel) {
    setForm((f) => ({ ...f, channels: f.channels.includes(channel) ? f.channels.filter((c) => c !== channel) : [...f.channels, channel] }));
  }

  async function submit(e) {
    e.preventDefault();
    try {
      const result = await api.post('/notifications', form);
      toast.success(`Sent to ${result.recipientCount} recipients (${result.summary.sent} delivered, ${result.summary.simulated} simulated)`);
      setForm({ ...form, title: '', message: '' });
      loadHistory();
    } catch (err) {
      toast.error(err.message);
    }
  }

  return (
    <div>
      <div className="page-header"><h2>Communication</h2></div>

      {channelStatus && (!channelStatus.email || !channelStatus.sms || !channelStatus.whatsapp) && (
        <div className="card" style={{ borderColor: 'var(--warning)' }}>
          <p className="muted">
            {!channelStatus.email && 'Email (SMTP) is not configured — messages will be simulated. '}
            {!channelStatus.sms && 'SMS (Twilio) is not configured — set TWILIO_* in .env to send real texts. '}
            {!channelStatus.whatsapp && <>WhatsApp is not linked — connect it from <a href="/settings">Settings</a>. </>}
          </p>
        </div>
      )}

      <div className="grid two-col">
        <div className="card">
          <h3>Compose Notice</h3>
          <form onSubmit={submit}>
            <div className="field"><label>Title</label><input required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></div>
            <div className="field"><label>Message</label><textarea required value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} /></div>
            <div className="form-grid">
              <div className="field"><label>Category</label>
                <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                  {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
                </select>
              </div>
              <div className="field"><label>Audience</label>
                <select value={form.audienceType} onChange={(e) => setForm({ ...form, audienceType: e.target.value, audienceRef: '' })}>
                  <option value="All">Everyone</option>
                  <option value="Role">By Role</option>
                  <option value="Class">By Class/Section</option>
                </select>
              </div>
            </div>
            {form.audienceType === 'Role' && (
              <div className="field"><label>Role</label>
                <select value={form.audienceRef} onChange={(e) => setForm({ ...form, audienceRef: e.target.value })}>
                  <option value="">Select</option><option value="teacher">Teachers</option><option value="parent">Parents</option>
                </select>
              </div>
            )}
            {form.audienceType === 'Class' && (
              <div className="field"><label>Section</label>
                <select value={form.audienceRef} onChange={(e) => setForm({ ...form, audienceRef: e.target.value })}>
                  <option value="">Select</option>{sections.map((s) => <option key={s.id} value={s.id}>{s.class_name} - {s.name}</option>)}
                </select>
              </div>
            )}
            <div className="field">
              <label>Channels</label>
              <div className="row">
                {CHANNELS.map((c) => (
                  <label key={c} style={{ margin: 0 }}><input type="checkbox" style={{ width: 'auto' }} checked={form.channels.includes(c)} onChange={() => toggleChannel(c)} /> {c}</label>
                ))}
              </div>
            </div>
            <div className="field row">
              <label style={{ margin: 0 }}><input type="checkbox" style={{ width: 'auto' }} checked={form.attachPdf} onChange={(e) => setForm({ ...form, attachPdf: e.target.checked })} /> Attach as a branded PDF letter (school name + logo)</label>
            </div>
            <button type="submit">Send Notice</button>
          </form>
        </div>

        <div className="card">
          <h3>History</h3>
          <div className="stack" style={{ maxHeight: 520, overflowY: 'auto' }}>
            {history.map((n) => (
              <div key={n.id} className="card" style={{ marginBottom: 0 }}>
                <div className="row"><Badge>{n.category}</Badge><b>{n.title}</b></div>
                <p className="muted">{n.sent_count}/{n.recipient_count} delivered · {new Date(n.created_at).toLocaleString()}</p>
                <div className="row"><ShareButtons path={`/notifications/${n.id}/pdf`} filenameBase={`notice-${n.id}`} /></div>
              </div>
            ))}
            {history.length === 0 && <p className="muted">No notices sent yet.</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
