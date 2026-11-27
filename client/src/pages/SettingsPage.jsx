import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useEffect, useRef, useState } from 'react';
import CloudBackupCard from '../components/CloudBackupCard';
import LanAccessCard, { DesktopConnectionCard } from '../components/LanAccessCard';
import { api, downloadFile } from '../api/client';
import { useToast } from '../context/ToastContext';
import { useAuth } from '../context/AuthContext';
import Badge from '../components/Badge';
import { BRAND } from '../brand';
import SchoolStamps from '../components/SchoolStamps';

// Settings sections (?tab=…). Change Password lives in My Profile.
const SECTIONS = [
  { id: 'branding', label: 'School Branding', icon: '🏫', hint: 'Name, logo, picture & stamps' },
  { id: 'attendance', label: 'Attendance QR', icon: '📱', hint: 'Mark attendance from phones' },
  { id: 'network', label: 'Multi-PC & Network', icon: '🖧', hint: 'Connect other computers' },
  { id: 'messaging', label: 'WhatsApp & Messaging', icon: '💬', hint: 'Auto-send vouchers & receipts' },
  { id: 'configuration', label: 'Configuration', icon: '🛠️', hint: 'Session, currency, library…' },
  { id: 'audit', label: 'Audit Log', icon: '🗂️', hint: 'Recent changes' }
];

function WhatsAppCard() {
  const toast = useToast();
  const [status, setStatus] = useState(null);
  const pollRef = useRef(null);

  async function loadStatus() {
    try {
      const data = await api.get('/settings/whatsapp/status');
      setStatus(data);
      return data;
    } catch {
      return null;
    }
  }

  useEffect(() => {
    loadStatus();
    pollRef.current = setInterval(async () => {
      const data = await loadStatus();
      if (data && data.status === 'connected') clearInterval(pollRef.current);
    }, 3000);
    return () => clearInterval(pollRef.current);
  }, []);

  async function connect() {
    try {
      await api.post('/settings/whatsapp/connect', {});
      toast.info('Connecting… scan the QR code with WhatsApp on your phone (Linked Devices → Link a Device).');
      clearInterval(pollRef.current);
      pollRef.current = setInterval(loadStatus, 2500);
    } catch (err) {
      toast.error(err.message);
    }
  }

  async function logout() {
    if (!window.confirm('Disconnect WhatsApp? You will need to scan the QR code again to reconnect.')) return;
    try {
      await api.post('/settings/whatsapp/logout', {});
      toast.success('WhatsApp disconnected');
      loadStatus();
    } catch (err) {
      toast.error(err.message);
    }
  }

  return (
    <div className="card">
      <h3>WhatsApp (free, direct — no share sheet)</h3>
      <p className="muted">Link one WhatsApp number to the app once by scanning a QR code, like WhatsApp Web. After that, fee vouchers, receipts and notices can be sent straight to any guardian's number.</p>
      {!status ? <p className="muted">Loading…</p> : (
        <>
          <p className="row"><b>Status:</b> <Badge variant={status.status === 'connected' ? 'success' : status.status === 'qr' ? 'warning' : 'muted'}>{status.status}</Badge></p>
          {status.detail && <p className="muted">{status.detail}</p>}
          {status.status === 'qr' && status.qrDataUrl && (
            <div style={{ textAlign: 'center' }}>
              <img src={status.qrDataUrl} alt="WhatsApp QR code" width={220} height={220} />
              <p className="muted">Open WhatsApp on your phone → Settings → Linked Devices → Link a Device</p>
            </div>
          )}
          <div className="row" style={{ marginTop: 10 }}>
            {status.status !== 'connected' && <button type="button" onClick={connect}>{status.status === 'connecting' || status.status === 'qr' ? 'Refresh QR' : 'Connect WhatsApp'}</button>}
            {status.status === 'connected' && <button type="button" className="btn-ghost" onClick={logout}>Disconnect</button>}
          </div>
        </>
      )}
    </div>
  );
}

// Two menu pages share this component: Settings (sectioned: branding & stamps,
// attendance QR, network, messaging, configuration, audit) and Backup & Restore (local + Google Drive backups).
export default function SettingsPage({ view = 'settings' }) {
  const location = useLocation();
  const navigate = useNavigate();
  useEffect(() => {
    // Old link: /settings#backup now has its own page.
    if (view === 'settings' && location.hash === '#backup') navigate('/backup', { replace: true });
  }, [location.hash, view]); // eslint-disable-line react-hooks/exhaustive-deps
  const isBackup = view === 'backup';
  const toast = useToast();
  const { user } = useAuth();
  const [settings, setSettings] = useState(null);
  const [backups, setBackups] = useState([]);
  const [auditLogs, setAuditLogs] = useState([]);
  const [params, setParams] = useSearchParams();
  const tab = SECTIONS.some((x) => x.id === params.get('tab')) ? params.get('tab') : 'branding';
  const setTab = (t) => setParams(t === 'branding' ? {} : { tab: t }, { replace: true });
  const [library, setLibrary] = useState(null);
  const [logoFile, setLogoFile] = useState(null);
  const [logoBust, setLogoBust] = useState(Date.now());
  const [pictureFile, setPictureFile] = useState(null);
  const [version, setVersion] = useState(null);

  async function loadAll() {
    setSettings(await api.get('/settings'));
    setBackups(await api.get('/settings/backups'));
    const logs = await api.get('/settings/audit-logs?limit=25');
    setAuditLogs(logs.rows);
    setVersion(await api.get('/settings/version'));
    api.get('/library/settings').then(setLibrary).catch(() => setLibrary(null));
  }
  useEffect(() => { loadAll(); }, []);

  // Each section saves only its own fields — never write back other settings
  // (backup, Google Drive, fees…) that may have changed since this page was opened.
  const saveKeys = (keys, message = 'Settings saved') => async (e) => {
    e.preventDefault();
    try {
      await api.put('/settings', Object.fromEntries(keys.filter((k) => settings[k] !== undefined).map((k) => [k, settings[k]])));
      toast.success(message);
    } catch (err) {
      toast.error(err.message);
    }
  };

  async function saveLibrary(e) {
    e.preventDefault();
    try {
      await api.put('/library/settings', { loan_days: Number(library.loan_days), fine_per_day: Number(library.fine_per_day) });
      toast.success('Library settings saved');
    } catch (err) {
      toast.error(err.message);
    }
  }

  async function uploadLogo(e) {
    e.preventDefault();
    if (!logoFile) return;
    const formData = new FormData();
    formData.append('logo', logoFile);
    try {
      await api.upload('/settings/logo', formData);
      toast.success('Logo updated — it will now appear on payslips, receipts, vouchers and notices');
      setLogoFile(null);
      setLogoBust(Date.now());
      loadAll();
    } catch (err) {
      toast.error(err.message);
    }
  }

  async function uploadPicture() {
    if (!pictureFile) return;
    const formData = new FormData();
    formData.append('picture', pictureFile);
    try {
      await api.upload('/settings/school-picture', formData);
      toast.success('School picture updated — it now shows on the dashboard');
      setPictureFile(null);
      setLogoBust(Date.now());
      loadAll();
    } catch (err) {
      toast.error(err.message);
    }
  }

  async function removePicture() {
    try {
      await api.del('/settings/school-picture');
      toast.success('School picture removed');
      loadAll();
    } catch (err) {
      toast.error(err.message);
    }
  }

  async function createBackup() {
    try {
      await api.post('/settings/backups', {});
      toast.success('Backup created');
      loadAll();
    } catch (err) {
      toast.error(err.message);
    }
  }

  async function restoreBackup(fileName) {
    if (!window.confirm(`Restore "${fileName}"?\n\nAll current data will be replaced by this backup. A safety copy of the current data is saved first, so this can be undone.`)) return;
    try {
      const result = await api.post(`/settings/backups/${encodeURIComponent(fileName)}/restore`, {});
      toast.success(result.message);
      setTimeout(() => window.location.reload(), 1800);
    } catch (err) {
      toast.error(err.message);
    }
  }

  const [externalFile, setExternalFile] = useState(null);
  const [externalBusy, setExternalBusy] = useState(false);
  const [downloadingFull, setDownloadingFull] = useState(false);

  async function downloadFullBackup() {
    setDownloadingFull(true);
    try {
      await downloadFile('/settings/backups/full.zip', `${BRAND.shortName}-full-backup.zip`);
      toast.success('Full backup downloaded — copy it to a USB drive, Google Drive or another PC for safe keeping');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setDownloadingFull(false);
    }
  }

  async function uploadExternal(restoreNow) {
    if (!externalFile) return;
    if (restoreNow && !window.confirm(`Restore from "${externalFile.name}"?\n\nAll current data will be replaced by this backup. A safety copy of the current data is saved first.`)) return;
    setExternalBusy(true);
    try {
      const fd = new FormData();
      fd.append('backup', externalFile);
      fd.append('restore', restoreNow ? 'true' : 'false');
      const result = await api.upload('/settings/backups/upload', fd);
      if (result.restored) {
        toast.success(result.message);
        setTimeout(() => window.location.reload(), 1800);
      } else {
        toast.success(`Backup checked and added to the list (${result.info.students} students, ${result.info.teachers} teachers${result.restoredUploads ? `, ${result.restoredUploads} photos/documents` : ''}). Click Restore on it when ready.`);
        setExternalFile(null);
        loadAll();
      }
    } catch (err) {
      toast.error(err.message);
    } finally {
      setExternalBusy(false);
    }
  }

  if (!settings) return <p className="muted">Loading…</p>;

  return (
    <div>
      <div className="page-header"><h2>{isBackup ? 'Backup & Restore' : 'Settings'}</h2></div>

      {!isBackup && (
      <div className="settings-layout">
        <nav className="settings-nav" aria-label="Settings sections">
          {SECTIONS.map((x) => (
            <button key={x.id} type="button" className={tab === x.id ? 'active' : ''} onClick={() => setTab(x.id)}>
              <span className="settings-nav-icon" aria-hidden="true">{x.icon}</span>
              <span><b>{x.label}</b><small>{x.hint}</small></span>
            </button>
          ))}
          <div className="settings-nav-note">🔑 To change your password, open <Link to="/profile">My Profile</Link>.</div>
        </nav>

        <div className="settings-content">
          {tab === 'branding' && (<>
            <div className="grid two-col">
              <div className="card">
                <h3>School details</h3>
                <p className="muted">Used as the letterhead on payslips, fee receipts, fee vouchers, certificates and printable notices.</p>
                <form onSubmit={saveKeys(['school_name', 'school_name_color', 'address', 'school_phone'], 'School details saved')}>
                  <div className="field"><label>School Name</label><input value={settings.school_name || ''} onChange={(e) => setSettings({ ...settings, school_name: e.target.value })} /></div>
                  <div className="field"><label>School Name colour</label>
                    <div className="row" style={{ margin: 0, alignItems: 'center' }}>
                      <input type="color" style={{ width: 48, height: 36, padding: 2 }} value={/^#[0-9a-f]{6}$/i.test(settings.school_name_color || '') ? settings.school_name_color : '#1d4ed8'} onChange={(e) => setSettings({ ...settings, school_name_color: e.target.value })} />
                      {['#1d4ed8', '#14307e', '#047857', '#b91c1c', '#7c3aed', '#b45309', '#111827'].map((c) => (
                        <button key={c} type="button" title={c} aria-label={`Use ${c}`} onClick={() => setSettings({ ...settings, school_name_color: c })}
                          style={{ width: 26, height: 26, minWidth: 0, padding: 0, borderRadius: '50%', background: c, border: settings.school_name_color === c ? '3px solid var(--text)' : '2px solid var(--border)' }} />
                      ))}
                      <span style={{ fontWeight: 800, fontSize: '1.05rem', color: /^#[0-9a-f]{6}$/i.test(settings.school_name_color || '') ? settings.school_name_color : '#1d4ed8' }}>{settings.school_name || 'School Name'}</span>
                    </div>
                    <span className="muted" style={{ fontSize: '0.78rem' }}>Used for the school name on the dashboard and on printed vouchers, receipts, result cards and reports.</span></div>
                  <div className="field"><label>Address</label><textarea value={settings.address || ''} onChange={(e) => setSettings({ ...settings, address: e.target.value })} /></div>
                  <div className="field"><label>Phone Number</label><input type="tel" placeholder="e.g. 0300-1234567, 042-35123456" value={settings.school_phone || ''} onChange={(e) => setSettings({ ...settings, school_phone: e.target.value })} />
                    <span className="muted" style={{ fontSize: '0.78rem' }}>Printed with the address under the school name on fee vouchers, receipts, payslips, result cards and reports.</span></div>
                  <button type="submit">Save Details</button>
                </form>
              </div>

              <div className="card">
                <h3>Logo &amp; school picture</h3>
                <label>School Logo</label>
                <div className="row">
                  {settings.school_logo && <img src={`/uploads/${settings.school_logo}?v=${logoBust}`} alt="School logo" width={56} height={56} style={{ objectFit: 'contain', borderRadius: 8, border: '1px solid var(--border)' }} />}
                  <input type="file" accept="image/*" onChange={(e) => setLogoFile(e.target.files[0])} />
                  <button type="button" className="btn-secondary" disabled={!logoFile} onClick={uploadLogo}>Upload</button>
                </div>

                <div className="divider" />
                <label>School Picture</label>
                <p className="muted" style={{ fontSize: '0.8rem' }}>A photo of your school building or campus. It is shown next to the school name on the dashboard. A wide (landscape) photo looks best.</p>
                {settings.school_picture && <img src={`/uploads/${settings.school_picture}?v=${logoBust}`} alt="School" className="school-picture-preview" />}
                <div className="row">
                  <input type="file" accept="image/*" onChange={(e) => setPictureFile(e.target.files[0])} />
                  <button type="button" className="btn-secondary" disabled={!pictureFile} onClick={uploadPicture}>Upload</button>
                  {settings.school_picture && <button type="button" className="btn-ghost" onClick={removePicture}>Remove</button>}
                </div>
              </div>
            </div>

            <div className="card">
              <h3>School Stamps</h3>
              <p className="muted">Upload a scan of your real stamp, or generate one here in a few clicks. Choose a different stamp for each kind of document.</p>
              <SchoolStamps schoolName={settings.school_name || BRAND.fullName} city={String(settings.address || '').split(/[,\n]/).map((x) => x.trim()).filter(Boolean).pop() || ''} />
            </div>
          </>)}

          {tab === 'attendance' && (
            <div className="grid two-col">
              <LanAccessCard />
              <div className="card">
                <h3>How it works</h3>
                <ol className="muted" style={{ paddingLeft: 18, lineHeight: 1.7 }}>
                  <li>Keep this PC on and connect the phone to the <b>same Wi-Fi</b>.</li>
                  <li>Scan the QR code with the phone camera; it opens the Attendance page.</li>
                  <li>Teachers sign in with their own account and mark their class.</li>
                  <li>Each student also has a personal QR code on their profile and ID card.</li>
                </ol>
                <p className="muted" style={{ fontSize: '0.8rem' }}>If the phone cannot open the link, allow the app through Windows Firewall in <button type="button" className="btn-link" onClick={() => setTab('network')}>Multi-PC &amp; Network</button>.</p>
              </div>
            </div>
          )}

          {tab === 'network' && (
            <div className="grid two-col">
              <DesktopConnectionCard />
            </div>
          )}

          {tab === 'messaging' && (
            <div className="grid two-col">
              <WhatsAppCard />
              <div className="card">
                <h3>Automatic Sending</h3>
                <p className="muted">When enabled, documents are emailed/WhatsApp'd/texted to the guardian on file automatically. A guardian phone number is used for both SMS and WhatsApp; set the default country code so local numbers (e.g. starting with 0) resolve correctly.</p>
                <form onSubmit={saveKeys(['default_country_code', 'auto_send_fee_vouchers', 'auto_send_fee_receipts'])}>
                  <div className="field"><label>Default Country Code (for local phone numbers)</label><input placeholder="e.g. 92 for Pakistan, 1 for USA" value={settings.default_country_code || ''} onChange={(e) => setSettings({ ...settings, default_country_code: e.target.value })} /></div>
                  <div className="field row">
                    <label style={{ margin: 0 }}><input type="checkbox" style={{ width: 'auto' }} checked={settings.auto_send_fee_vouchers === 'true'} onChange={(e) => setSettings({ ...settings, auto_send_fee_vouchers: String(e.target.checked) })} /> Auto-send fee vouchers when generated</label>
                  </div>
                  <div className="field row">
                    <label style={{ margin: 0 }}><input type="checkbox" style={{ width: 'auto' }} checked={settings.auto_send_fee_receipts === 'true'} onChange={(e) => setSettings({ ...settings, auto_send_fee_receipts: String(e.target.checked) })} /> Auto-send receipts when a payment is recorded</label>
                  </div>
                  <button type="submit">Save</button>
                </form>
              </div>
            </div>
          )}

          {tab === 'configuration' && (<>
            <div className="grid two-col">
              <div className="card">
                <h3>General</h3>
                <form onSubmit={saveKeys(['academic_year', 'currency', 'default_country_code'], 'Configuration saved')}>
                  <div className="form-grid">
                    <div className="field"><label>Academic Year / Session</label><input placeholder="e.g. 2026-2027" value={settings.academic_year || ''} onChange={(e) => setSettings({ ...settings, academic_year: e.target.value })} /></div>
                    <div className="field"><label>Currency</label><input placeholder="e.g. PKR" value={settings.currency || ''} onChange={(e) => setSettings({ ...settings, currency: e.target.value })} /></div>
                  </div>
                  <div className="field"><label>Default Country Code</label><input placeholder="e.g. 92" value={settings.default_country_code || ''} onChange={(e) => setSettings({ ...settings, default_country_code: e.target.value })} /></div>
                  <button type="submit">Save</button>
                </form>
              </div>
              {library && (
                <form className="card" onSubmit={saveLibrary}>
                  <h3>Library</h3>
                  <div className="form-grid">
                    <div className="field"><label>Loan period (days)</label><input type="number" min="1" value={library.loan_days} onChange={(e) => setLibrary({ ...library, loan_days: e.target.value })} /></div>
                    <div className="field"><label>Late fine per day</label><input type="number" min="0" value={library.fine_per_day} onChange={(e) => setLibrary({ ...library, fine_per_day: e.target.value })} /></div>
                  </div>
                  <button type="submit">Save</button>
                </form>
              )}
            </div>
            <div className="card">
              <h3>More configuration</h3>
              <p className="muted">These settings sit next to the work they affect:</p>
              <div className="config-links">
                <Link to="/fees?tab=auto"><b>💳 Fee automation &amp; vouchers</b><span>Monthly auto-invoices, due day, late fine, voucher note</span></Link>
                <Link to="/fees?tab=structures"><b>🧾 Fee structures</b><span>Class-wise fee heads and amounts</span></Link>
                <Link to="/results?tab=cards"><b>🏅 Grading rules</b><span>Grade scale and pass percentage (Grading Rules button)</span></Link>
                <Link to="/roles"><b>🛡️ Roles &amp; permissions</b><span>What each role can see and do</span></Link>
                <Link to="/backup"><b>💾 Backup &amp; restore</b><span>Automatic backups and Google Drive</span></Link>
              </div>
              {version && <p className="muted" style={{ fontSize: '0.8rem', marginBottom: 0 }}>Running v{version.appVersion} · database schema v{version.schemaVersion}</p>}
            </div>
          </>)}

          {tab === 'audit' && (
            <div className="card">
              <div className="page-header"><h3>Recent Audit Log</h3><div className="page-actions"><Link className="btn-ghost btn-sm" to="/audit-logs">Open full audit log →</Link></div></div>
              <div className="stack" style={{ maxHeight: 460, overflowY: 'auto' }}>
                {auditLogs.map((l) => (
                  <div key={l.id} className="row"><span className="muted">{new Date(l.created_at).toLocaleString()}</span><b>{l.username}</b><span>{l.action}</span><span className="muted">{l.entity_type}</span></div>
                ))}
                {auditLogs.length === 0 && <p className="muted">No activity yet.</p>}
              </div>
            </div>
          )}
        </div>
      </div>
      )}

      {isBackup && (<>
      <CloudBackupCard />

      <div className="card" id="backup">
        <div className="page-header">
          <h3>Backups &amp; Restore</h3>
          <div className="page-actions">
            <button type="button" className="btn-secondary" onClick={downloadFullBackup} disabled={downloadingFull}>{downloadingFull ? 'Preparing…' : 'Download Full Backup (.zip)'}</button>
            <button type="button" onClick={createBackup}>Create Backup Now</button>
          </div>
        </div>
        <p className="muted">
          All school data (database, uploaded documents, backups, logs) lives outside the installed program, at
          {' '}<code>%APPDATA%\school-management-system\</code> on this PC — installing an updated version of the
          app later never touches this folder.
          {version && <> Running <b>v{version.appVersion}</b> · database schema v{version.schemaVersion}.</>}
        </p>
        <table>
          <thead><tr><th>File</th><th>Size</th><th>Created</th><th></th></tr></thead>
          <tbody>
            {backups.map((b) => (
              <tr key={b.fileName}>
                <td>{b.fileName}</td><td>{(b.sizeBytes / 1024).toFixed(0)} KB</td><td>{new Date(b.createdAt).toLocaleString()}</td>
                <td className="row">
                  <button type="button" className="btn-ghost btn-sm" onClick={() => downloadFile(`/settings/backups/${b.fileName}/download`, b.fileName)}>Download</button>
                  {user.role === 'super_admin' && <button type="button" className="btn-ghost btn-sm" onClick={() => restoreBackup(b.fileName)}>Restore</button>}
                </td>
              </tr>
            ))}
            {backups.length === 0 && <tr><td colSpan={4} className="muted">No backups yet.</td></tr>}
          </tbody>
        </table>

        {user.role === 'super_admin' && (
          <div className="card" style={{ background: 'var(--bg)', marginTop: 16 }}>
            <h3>Restore from an external backup</h3>
            <p className="muted">
              Use a backup kept outside this PC — a USB drive, Google Drive, email, or a backup taken on another PC.
              Choose a <b>Full Backup .zip</b> (database + photos/documents) or a <b>.db</b> backup file.
              The file is checked first; your current data is always saved as a safety copy before restoring.
              This PC's license activation is kept.
            </p>
            <div className="row">
              <input type="file" accept=".zip,.db,.sqlite,.sqlite3" onChange={(e) => setExternalFile(e.target.files[0] || null)} style={{ maxWidth: 340 }} />
              <button type="button" className="btn-secondary" disabled={!externalFile || externalBusy} onClick={() => uploadExternal(false)}>Check &amp; Add to List</button>
              <button type="button" className="btn-danger" disabled={!externalFile || externalBusy} onClick={() => uploadExternal(true)}>{externalBusy ? 'Working…' : 'Restore Now'}</button>
            </div>
          </div>
        )}
      </div>
      </>)}

    </div>
  );
}
