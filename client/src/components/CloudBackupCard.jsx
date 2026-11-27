import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { useToast } from '../context/ToastContext';
import { useAuth } from '../context/AuthContext';
import { fmtDateTime } from '../utils/payment';

const mb = (n) => `${(Number(n || 0) / 1048576).toFixed(1)} MB`;
const FREQ = [['daily', 'Daily'], ['weekly', 'Weekly'], ['monthly', 'Monthly'], ['manual', 'Only when I tap “Back up”']];
const onServerPc = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(window.location.hostname);

// Google Drive backup, set up like WhatsApp chat backup: connect a Google
// account once → backed up automatically → restore on any PC from that account.
// Plus the automatic daily backup on this PC.
export default function CloudBackupCard() {
  const toast = useToast();
  const { user } = useAuth();
  const [cfg, setCfg] = useState(null);
  const [draft, setDraft] = useState({});
  const [folders, setFolders] = useState([]);
  const [busy, setBusy] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const [driveList, setDriveList] = useState(null);
  const [restoring, setRestoring] = useState('');
  const [waiting, setWaiting] = useState(false);

  // While the school signs in to Google in the browser, check every few
  // seconds and show "Connected" as soon as it's done.
  useEffect(() => {
    if (!waiting) return undefined;
    const started = Date.now();
    const t = setInterval(async () => {
      try {
        const c = await api.get('/settings/cloud-backup');
        if (c.connected) {
          setWaiting(false);
          setCfg(c);
          toast.success(`Google Drive connected${c.account ? ` — ${c.account}` : ''}. The first backup has started.`);
          setTimeout(load, 8000);
        }
      } catch { /* keep waiting */ }
      if (Date.now() - started > 10 * 60000) setWaiting(false);
    }, 3000);
    return () => clearInterval(t);
  }, [waiting]); // eslint-disable-line react-hooks/exhaustive-deps

  async function load() {
    try {
      const c = await api.get('/settings/cloud-backup');
      setCfg(c);
      setDraft({ mode: c.mode, folder_path: c.folder_path, client_id: c.client_id, client_secret: '', frequency: c.frequency, time: c.time, keep: c.keep, local_auto: c.local_auto, local_time: c.local_time, local_keep: c.local_keep });
      return c;
    } catch (err) { toast.error(err.message); return null; }
  }
  useEffect(() => { load().then((c) => { if (c && !c.built_in && c.mode !== 'api') setAdvanced(Boolean(c.mode === 'folder' || c.client_id)); }); api.get('/settings/gdrive/folders').then(setFolders).catch(() => {}); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    // After signing in to Google in the browser, coming back here refreshes it.
    const onFocus = () => load();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (!cfg) return null;
  const set = (k, v) => setDraft({ ...draft, [k]: v });
  const usingApi = draft.mode === 'api' || (!draft.mode && cfg.can_connect);
  const ready = (cfg.mode === 'api' && cfg.connected) || (cfg.mode === 'folder' && cfg.folder_path);

  async function save(extra = {}, quiet = false) {
    try {
      const body = { ...draft, ...extra };
      if (!body.client_secret) delete body.client_secret;
      await api.put('/settings/cloud-backup', body);
      if (!quiet) toast.success('Backup settings saved');
      await load();
    } catch (err) { toast.error(err.message); }
  }
  async function connect() {
    if (!onServerPc) { toast.error('Open the app on the main (server) PC to connect Google Drive — Google sends the sign-in back to that PC.'); return; }
    if (!cfg.can_connect) {
      toast.error('Google sign-in is not activated in this copy of the app yet. Please contact your software provider, or use “Google Drive for desktop” under Advanced.');
      return;
    }
    try {
      await api.put('/settings/cloud-backup', { mode: 'api' });
      const { url } = await api.get('/settings/gdrive/auth-url');
      // Google only allows sign-in in a real web browser (not inside apps), so
      // this opens the PC's browser — the same way other desktop apps do it.
      window.open(url, '_blank', 'noopener');
      setWaiting(true);
    } catch (err) { toast.error(err.message); }
  }
  async function backupNow() {
    setBusy(true);
    try {
      const r = await api.post('/settings/gdrive/backup-now', {});
      toast.success(`Backed up to ${r.where} (${mb(r.size)})`);
    } catch (err) { toast.error(err.message); }
    setBusy(false);
    load();
  }
  async function disconnect() {
    if (!window.confirm('Disconnect this Google account? Automatic Drive backups stop. Backups already in Google Drive stay there and can be restored later.')) return;
    await api.post('/settings/gdrive/disconnect', {});
    setDriveList(null);
    load();
  }
  async function showDriveBackups() {
    try { setDriveList(await api.get('/settings/gdrive/backups')); } catch (err) { toast.error(err.message); }
  }
  async function restore(b) {
    if (!window.confirm(`Restore the backup from ${fmtDateTime(b.created)}?\n\nAll current data on this PC will be replaced by it. A safety copy of the current data is saved first, so this can be undone.`)) return;
    setRestoring(b.id);
    try {
      const r = await api.post('/settings/gdrive/restore', { id: b.id });
      toast.success(r.message);
      setTimeout(() => window.location.reload(), 2000);
    } catch (err) { toast.error(err.message); setRestoring(''); }
  }

  const last = cfg.last;
  const lastOk = cfg.last_ok;
  return (
    <div className="card" id="cloud-backup">
      <h3 style={{ marginBottom: 4 }}>☁ Google Drive Backup</h3>
      <p className="muted" style={{ marginTop: 0, fontSize: '0.85rem' }}>
        Works like WhatsApp backup: connect the school’s Google account once and all data (students, fees, results, photos…) is backed up to Google Drive automatically.
        If this PC is lost, damaged or replaced, install the app on a new PC, connect the same Google account and tap <b>Restore</b>.
      </p>

      <div style={{ background: 'var(--surface-2, rgba(127,127,127,0.07))', borderRadius: 10, padding: '12px 14px', margin: '8px 0 12px' }}>
        <div style={{ fontSize: '0.9rem' }}>
          <b>Last backup:</b> {lastOk ? `${fmtDateTime(lastOk.at)} · ${mb(lastOk.size)}` : 'never'}
        </div>
        {last && !last.ok && (
          <div style={{ fontSize: '0.85rem', color: 'var(--danger)', marginTop: 4 }}>Last try {fmtDateTime(last.at)} failed: {last.error}{cfg.frequency !== 'manual' ? ' — it will try again in an hour.' : ''}</div>
        )}
        <div className="row" style={{ marginTop: 10, marginBottom: 0 }}>
          <button type="button" className="btn-success" disabled={busy || !ready} onClick={backupNow}>{busy ? 'Backing up…' : 'Back up'}</button>
          {ready && <button type="button" className="btn-secondary" onClick={showDriveBackups}>Restore from Google Drive…</button>}
        </div>
      </div>

      {/* Google account */}
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontWeight: 600 }}>Google Account</div>
          <div className="muted" style={{ fontSize: '0.85rem' }}>
            {cfg.mode === 'api' && cfg.connected ? (cfg.account || 'Connected')
              : cfg.mode === 'folder' ? `Using Google Drive for desktop — ${cfg.folder_path || 'no folder chosen'}`
                : 'None — tap Connect'}
          </div>
        </div>
        {cfg.mode === 'api' && cfg.connected
          ? <div className="actions-cell"><button type="button" className="btn-ghost btn-sm" onClick={connect}>Change account</button><button type="button" className="btn-ghost btn-sm" onClick={disconnect}>Disconnect</button></div>
          : cfg.mode !== 'folder' && <button type="button" onClick={connect} disabled={waiting}>{waiting ? 'Waiting for Google sign-in…' : 'Connect Google account'}</button>}
      </div>
      {waiting && (
        <p className="muted" style={{ fontSize: '0.82rem' }}>
          A Google sign-in page has opened in your web browser. Choose an account, or sign in with the school’s email and password, then tap <b>Allow</b>. This screen updates by itself.{' '}
          <button type="button" className="btn-ghost btn-sm" onClick={() => setWaiting(false)}>Cancel</button>
        </p>
      )}
      {!onServerPc && usingApi && !cfg.connected && (
        <p className="muted" style={{ fontSize: '0.8rem' }}>Connecting must be done once on the main (server) PC. After that, backups run from there automatically.</p>
      )}

      {/* Frequency */}
      <div className="row filters" style={{ marginTop: 12 }}>
        <label style={{ margin: 0, fontWeight: 600 }}>Back up to Google Drive</label>
        <select value={draft.frequency} onChange={(e) => set('frequency', e.target.value)}>
          {FREQ.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        {draft.frequency !== 'manual' && <><span className="muted">at</span><input type="time" value={draft.time} onChange={(e) => set('time', e.target.value)} /></>}
        <span className="muted">keep the last</span>
        <input type="number" min="1" style={{ maxWidth: 80 }} value={draft.keep} onChange={(e) => set('keep', e.target.value)} />
        <span className="muted">backups in Drive</span>
      </div>
      <p className="muted" style={{ fontSize: '0.78rem', marginTop: 2 }}>If the PC is off or offline at that time, the backup runs as soon as it is back on — and retries every hour until it succeeds.</p>

      {driveList && (
        <div style={{ marginTop: 10 }}>
          <h4 style={{ margin: '6px 0' }}>Backups in Google Drive</h4>
          {driveList.length === 0 ? <p className="muted">No backups found in this Google account yet.</p> : (
            <div className="table-wrap"><table><thead><tr><th>Date</th><th>Size</th><th>File</th><th /></tr></thead><tbody>
              {driveList.map((b) => (
                <tr key={b.id}><td>{fmtDateTime(b.created)}</td><td>{mb(b.size)}</td><td className="muted" style={{ fontSize: '0.8rem' }}>{b.name}</td>
                  <td>{user.role === 'super_admin'
                    ? <button type="button" className="btn-ghost btn-sm" disabled={Boolean(restoring)} onClick={() => restore(b)}>{restoring === b.id ? 'Restoring…' : 'Restore'}</button>
                    : <span className="muted" style={{ fontSize: '0.78rem' }}>Super admin only</span>}</td></tr>
              ))}
            </tbody></table></div>
          )}
        </div>
      )}

      {/* Local */}
      <h4 style={{ margin: '16px 0 6px' }}>On this PC (local)</h4>
      <div className="row filters">
        <label className="row" style={{ margin: 0, gap: 6 }}><input type="checkbox" style={{ width: 'auto' }} checked={draft.local_auto} onChange={(e) => set('local_auto', e.target.checked)} /> Back up automatically every day at</label>
        <input type="time" value={draft.local_time} onChange={(e) => set('local_time', e.target.value)} />
        <span className="muted">keep the last</span>
        <input type="number" min="1" style={{ maxWidth: 80 }} value={draft.local_keep} onChange={(e) => set('local_keep', e.target.value)} />
        <span className="muted">daily backups</span>
      </div>
      <p className="muted" style={{ fontSize: '0.8rem', marginTop: 4 }}>Last automatic local backup: {cfg.last_local ? fmtDateTime(cfg.last_local) : 'not yet'}.</p>

      <div className="row" style={{ marginTop: 8 }}>
        <button type="button" onClick={() => save()}>Save Backup Settings</button>
        <button type="button" className="btn-ghost btn-sm" onClick={() => setAdvanced(!advanced)}>{advanced ? '▾' : '▸'} Advanced</button>
      </div>

      {advanced && (
        <div style={{ borderTop: '1px solid var(--border)', marginTop: 10, paddingTop: 10 }}>
          <div className="seg" style={{ marginBottom: 10 }}>
            {[['api', 'Google account (sign in)'], ['folder', 'Google Drive for desktop folder'], ['', 'Off']].map(([k, l]) => (
              <button key={k} type="button" className={draft.mode === k ? 'active' : ''} onClick={() => set('mode', k)}>{l}</button>
            ))}
          </div>
          {draft.mode === 'folder' && (
            <>
              <p className="muted" style={{ marginTop: 0, fontSize: '0.85rem' }}>Install <b>Google Drive for desktop</b> on this PC and sign in with the school's Google account. It shows up as a drive (e.g. <code>G:\My Drive</code>). Backups saved there are uploaded to Google Drive automatically.</p>
              <div className="field"><label>Google Drive folder on this PC</label>
                <input list="gdrive-folders" value={draft.folder_path || ''} placeholder="e.g. G:\My Drive" onChange={(e) => set('folder_path', e.target.value)} />
                <datalist id="gdrive-folders">{folders.map((f) => <option key={f} value={f} />)}</datalist>
                {folders.length > 0 && !draft.folder_path && <span className="muted" style={{ fontSize: '0.78rem' }}>Found: {folders.join(', ')}</span>}
              </div>
            </>
          )}
          {draft.mode === 'api' && (
            <p className="muted" style={{ marginTop: 0, fontSize: '0.82rem' }}>Sign in with the school’s Google account using <b>Connect Google account</b> above.</p>
          )}
          <button type="button" className="btn-secondary btn-sm" onClick={() => save({}, false)}>Save</button>
        </div>
      )}
    </div>
  );
}
