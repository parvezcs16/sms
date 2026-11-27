import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { BRAND } from '../brand';
import DashIcon from '../components/DashIcons';

// Software support contacts (set per brand in brands/<id>/brand.json) and a
// quick "report a problem" message that already carries the app details.
export default function SupportPage() {
  const { user } = useAuth();
  const toast = useToast();
  const [version, setVersion] = useState(null);
  const [school, setSchool] = useState('');
  const [issue, setIssue] = useState('');
  useEffect(() => {
    api.get('/settings/version').then(setVersion).catch(() => {});
    api.get('/settings').then((s) => setSchool(s.school_name || '')).catch(() => {});
  }, []);

  const phone = BRAND.supportPhone || BRAND.phone || '';
  const whatsapp = (BRAND.supportWhatsapp || phone).replace(/[^\d+]/g, '');
  const waNumber = whatsapp.startsWith('0') ? `92${whatsapp.slice(1)}` : whatsapp.replace(/^\+/, '');
  const email = BRAND.supportEmail || '';

  const details = [
    `School: ${school || '-'}`,
    `User: ${user.full_name} (${user.role.replace(/_/g, ' ')})`,
    `App: ${BRAND.productName} v${version ? version.appVersion : '?'} (db ${version ? version.schemaVersion : '?'})`,
    `Page: ${window.location.pathname}`
  ].join('\n');
  const message = `${issue.trim() || 'Describe the problem here'}\n\n---\n${details}`;

  async function copyDetails() {
    try { await navigator.clipboard.writeText(message); toast.success('Copied — paste it in your message to support'); } catch { toast.error('Could not copy. Select the text and copy it.'); }
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h2>Help & Support</h2>
          <p style={{ margin: 0 }}>Facing a problem in the software? Reach {BRAND.name} support — we'll help you sort it out.</p>
        </div>
      </div>

      <div className="support-grid">
        {phone && (
          <a className="support-card s-call" href={`tel:${phone.replace(/\s+/g, '')}`}>
            <span className="support-icon"><DashIcon name="phone" size={26} /></span>
            <span className="support-label">Call us</span>
            <b>{phone}</b>
          </a>
        )}
        {waNumber && (
          <a className="support-card s-wa" href={`https://wa.me/${waNumber}?text=${encodeURIComponent(message)}`} target="_blank" rel="noreferrer">
            <span className="support-icon"><DashIcon name="chat" size={26} /></span>
            <span className="support-label">WhatsApp</span>
            <b>{BRAND.supportWhatsapp || phone}</b>
          </a>
        )}
        {email && (
          <a className="support-card s-mail" href={`mailto:${email}?subject=${encodeURIComponent(`Support request — ${school || BRAND.productName}`)}&body=${encodeURIComponent(message)}`}>
            <span className="support-icon"><DashIcon name="mail" size={26} /></span>
            <span className="support-label">Email</span>
            <b>{email}</b>
          </a>
        )}
        <div className="support-card s-hours">
          <span className="support-icon"><DashIcon name="clock" size={26} /></span>
          <span className="support-label">Support hours</span>
          <b>{BRAND.supportHours || 'Mon – Sat, 9:00 AM – 6:00 PM'}</b>
        </div>
      </div>

      <div className="grid two-col">
        <div className="card">
          <h3>Report a problem</h3>
          <p className="muted">Write what happened, then send it by WhatsApp or email. Your school name, app version and the page you were on are added automatically so we can help faster.</p>
          <div className="field"><label>What went wrong?</label>
            <textarea rows={5} placeholder="e.g. When I print the fee challan for Class 5, the amount shows 0." value={issue} onChange={(e) => setIssue(e.target.value)} />
          </div>
          <div className="row">
            {waNumber && <a className="btn" href={`https://wa.me/${waNumber}?text=${encodeURIComponent(message)}`} target="_blank" rel="noreferrer">Send on WhatsApp</a>}
            {email && <a className="btn btn-secondary" href={`mailto:${email}?subject=${encodeURIComponent(`Support request — ${school || BRAND.productName}`)}&body=${encodeURIComponent(message)}`}>Send by Email</a>}
            <button type="button" className="btn-ghost" onClick={copyDetails}>Copy</button>
          </div>
        </div>
        <div className="card">
          <h3>Before you call</h3>
          <ul className="support-tips">
            <li>Note the <b>page</b> and the <b>steps</b> that cause the problem.</li>
            <li>A screenshot helps a lot — press <b>Win + Shift + S</b> and send it on WhatsApp.</li>
            <li>For data problems, take a backup first: <b>System → Backup &amp; Restore</b>.</li>
            <li>License questions: keep your <b>Device ID</b> ready (shown on the activation screen).</li>
          </ul>
          <div className="divider" />
          <div className="muted" style={{ fontSize: '0.82rem', whiteSpace: 'pre-line' }}>{details}</div>
        </div>
      </div>
    </div>
  );
}
