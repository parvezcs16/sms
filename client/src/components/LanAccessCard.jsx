import { useEffect, useState } from 'react';
import { api } from '../api/client';

// QR code + link that phones and other PCs use to reach this server. Lists
// every network adapter so the office can pick the right one if the default
// (best guess) isn't the school Wi-Fi.
export default function LanAccessCard({ compact = false }) {
  const [lan, setLan] = useState(null);
  const [index, setIndex] = useState(0);
  const [desktop, setDesktop] = useState(null);

  useEffect(() => {
    api.get('/settings/lan-info').then(setLan).catch(() => setLan({ options: [] }));
    if (window.smsDesktop) window.smsDesktop.getConnection().then(setDesktop).catch(() => {});
  }, []);

  if (!lan) return <div className="card"><p className="muted">Checking network…</p></div>;
  const options = lan.options || [];
  const chosen = options[index];
  const isClientPc = desktop && desktop.mode === 'client';

  return (
    <div className="card">
      <h3>Mobile Attendance (same Wi-Fi)</h3>
      {!chosen ? (
        <p className="muted">This PC isn't connected to a network. Connect it to the school Wi-Fi/LAN so phones can reach it.</p>
      ) : (
        <>
          <p className="muted">Teachers scan this with their phone camera (on the same Wi-Fi), sign in, and mark attendance. It is saved straight into this school's database.</p>
          <div className={compact ? 'lan-qr compact' : 'lan-qr'}>
            <img src={chosen.qrDataUrl} alt="Attendance QR code" />
            <div className="stack" style={{ gap: 6 }}>
              <code className="lan-url">{chosen.url}</code>
              {options.length > 1 && (
                <label className="muted" style={{ fontSize: '0.8rem' }}>
                  Network adapter
                  <select value={index} onChange={(e) => setIndex(Number(e.target.value))}>
                    {options.map((o, i) => (
                      <option key={o.url} value={i}>{o.adapter} — {o.address}{i === 0 ? ' (recommended)' : ''}</option>
                    ))}
                  </select>
                </label>
              )}
              {isClientPc && <p className="muted" style={{ fontSize: '0.8rem' }}>Note: this PC is connected to a main server PC — the QR code above points to the main server.</p>}
              {!compact && <p className="muted" style={{ fontSize: '0.8rem' }}>If phones can't open the link: make sure they're on the same Wi-Fi as the server PC, and allow the app through Windows Firewall (Settings → Multi-PC &amp; Network on the server PC).</p>}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export function DesktopConnectionCard() {
  const [conn, setConn] = useState(null);
  const [lan, setLan] = useState(null);
  const [fw, setFw] = useState('');

  useEffect(() => {
    if (window.smsDesktop) window.smsDesktop.getConnection().then(setConn).catch(() => {});
    api.get('/settings/lan-info').then(setLan).catch(() => {});
  }, []);

  if (!window.smsDesktop) {
    return (
      <div className="card">
        <h3>Multi-PC &amp; Network</h3>
        <p className="muted">Open the desktop app to change how this PC connects. Server address for other PCs: <code>{lan?.serverUrl || '—'}</code></p>
      </div>
    );
  }

  async function allowFirewall() {
    setFw('Waiting for Windows permission…');
    const r = await window.smsDesktop.allowFirewall();
    setFw(r.ok ? 'Done — phones and other PCs can now connect to this PC.' : r.error || 'Failed');
  }

  return (
    <div className="card">
      <h3>Multi-PC &amp; Network</h3>
      {conn && conn.mode === 'client' ? (
        <p>This PC is connected to the main server at <code>{conn.serverUrl}</code>. All data you see and enter is stored on that server PC.</p>
      ) : (
        <>
          <p>This PC is the <b>main server</b>: the school's data is stored here.</p>
          <p className="muted">To use the app on other office PCs with the <b>same data</b>, install it on each PC, open <b>Connection Settings</b> there (or press <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>K</kbd>), choose "Connect to the main server PC", and enter <code>{lan?.serverUrl || 'this PC\'s IP address'}</code> (or click "Find servers").</p>
          <p className="muted">Only <b>one</b> PC should be the main server. If several PCs each run as a server, each keeps its own separate data and nothing will sync between them.</p>
          <div className="row">
            <button type="button" className="btn-secondary" onClick={allowFirewall}>Allow through Windows Firewall</button>
            {fw && <span className="muted">{fw}</span>}
          </div>
        </>
      )}
      <div className="row" style={{ marginTop: 10 }}>
        <button type="button" onClick={() => window.smsDesktop.openConnectionSettings()}>Connection Settings…</button>
        {conn && <span className="muted">App version {conn.version}</span>}
      </div>
    </div>
  );
}
