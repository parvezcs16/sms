// A tiny local web page for issuing license keys without typing CLI commands,
// and for tracking which schools you've issued keys to. Runs entirely on your
// own machine — nothing here talks to the internet.
//
// "Activated" here is something YOU mark by hand once a school confirms it
// worked — the app never phones home, so there's no way to detect activation
// automatically without breaking the fully-offline design.
//
// Usage: node scripts/license-admin-page.js  (or double-click the launcher)
// then open http://localhost:4100 — it opens itself automatically on Windows.

const http = require('http');
const { exec } = require('child_process');
const express = require('express');
const { formatGroups } = require('../server/src/utils/licenseKey');
const registry = require('./lib/licenseRegistry');
const policy = require('./lib/licenseAdminPolicy');


function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function renderRows(records) {
  if (records.length === 0) return '<tr><td colspan="5" class="muted">No keys issued yet.</td></tr>';
  return records
    .map(
      (r) => `<tr>
        <td>${escapeHtml(r.schoolName)}</td>
        <td class="mono">${formatGroups(r.deviceId, 4)}</td>
        <td class="mono">${r.key}</td>
        <td>${new Date(r.issuedAt).toLocaleDateString()}</td>
        <td>${
          r.status === 'confirmed'
            ? `<span class="badge ok">Activated</span>`
            : `<button class="confirm" data-id="${r.id}">Mark Activated</button>`
        }</td>
      </tr>`
    )
    .join('');
}

function renderPage() {
  const records = registry.readAll();
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>CHAND License Admin</title>
<style>
  body { font-family: system-ui, sans-serif; max-width: 760px; margin: 40px auto; padding: 0 20px; color: #1a1a1a; }
  h1 { font-size: 20px; }
  h2 { font-size: 15px; margin-top: 40px; }
  label { display: block; margin-top: 16px; font-weight: 600; font-size: 14px; }
  input { width: 100%; box-sizing: border-box; padding: 8px 10px; font-size: 15px; margin-top: 4px; border: 1px solid #ccc; border-radius: 6px; }
  button { margin-top: 20px; padding: 10px 16px; font-size: 15px; border: none; border-radius: 6px; background: #14307e; color: white; cursor: pointer; }
  button:hover { background: #0b1f4f; }
  .result { margin-top: 20px; padding: 14px; border-radius: 8px; font-family: monospace; font-size: 18px; text-align: center; letter-spacing: 2px; }
  .ok { background: #ecfdf5; border: 1px solid #10b981; color: #065f46; }
  .err { background: #fef2f2; border: 1px solid #ef4444; color: #991b1b; font-family: system-ui, sans-serif; letter-spacing: normal; font-size: 14px; text-align: left; }
  .muted { color: #666; font-size: 13px; }
  table { width: 100%; border-collapse: collapse; margin-top: 12px; font-size: 13px; }
  th, td { text-align: left; padding: 8px 6px; border-bottom: 1px solid #eee; }
  .mono { font-family: monospace; }
  .badge.ok { background: #ecfdf5; color: #065f46; border: 1px solid #10b981; padding: 3px 8px; border-radius: 999px; font-size: 12px; }
  .confirm { margin: 0; padding: 5px 10px; font-size: 12px; }
</style>
</head>
<body>
  <h1>CHAND School Management — Issue a License Key</h1>
  <p class="muted">Paste the Device ID the school sent you, name the school, and get a key back — nothing leaves this machine.</p>
  <form id="f">
    <label>School Name</label>
    <input name="schoolName" required autofocus>
    <label>Device ID</label>
    <input name="deviceId" required placeholder="XXXX-XXXX-XXXX">
    <button type="submit">Generate Key</button>
  </form>
  <div id="out"></div>

  <h2>Issued keys (${records.length})</h2>
  <table>
    <thead><tr><th>School</th><th>Device ID</th><th>Key</th><th>Issued</th><th>Status</th></tr></thead>
    <tbody id="rows">${renderRows(records)}</tbody>
  </table>

  <script>
    const form = document.getElementById('f');
    const out = document.getElementById('out');
    const rows = document.getElementById('rows');

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      out.innerHTML = '';
      const body = Object.fromEntries(new FormData(form));
      try {
        const res = await fetch('/issue', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed');
        out.innerHTML = '<div class="result ok">' + data.key + '</div>' +
          '<p class="muted">Copied to clipboard. Send this key back to the school.</p>';
        navigator.clipboard.writeText(data.key).catch(() => {});
        rows.innerHTML = data.rowsHtml;
        form.reset();
        form.schoolName.focus();
      } catch (err) {
        out.innerHTML = '<div class="result err">' + err.message + '</div>';
      }
    });

    rows.addEventListener('click', async (e) => {
      if (!e.target.classList.contains('confirm')) return;
      const id = e.target.dataset.id;
      e.target.disabled = true;
      const res = await fetch('/confirm/' + id, { method: 'POST' });
      const data = await res.json();
      if (res.ok) rows.innerHTML = data.rowsHtml;
    });
  </script>
</body>
</html>`;
}

function createAdminApp() {
  const app = express();
  app.use(express.json());

  app.get('/', (req, res) => {
    res.type('html').send(renderPage());
  });

  app.post('/issue', (req, res) => {
    try {
      const { key } = policy.issueKey(req.body || {});
      res.json({ key, rowsHtml: renderRows(registry.readAll()) });
    } catch (err) {
      res.status(err.status || 500).json({ error: err.message });
    }
  });

  app.post('/confirm/:id', (req, res) => {
    const record = registry.markConfirmed(req.params.id);
    if (!record) return res.status(404).json({ error: 'Not found' });
    res.json({ rowsHtml: renderRows(registry.readAll()) });
  });

  return app;
}

// Starts the page on 127.0.0.1 only (never reachable from the network).
// port 0 = pick any free port (used by the exe).
function startAdminServer(port = Number(process.env.PORT) || 4100) {
  return new Promise((resolve, reject) => {
    try {
      policy.assertAllowedPc();
    } catch (err) {
      reject(err);
      return;
    }
    const server = http.createServer(createAdminApp());
    server.on('error', reject);
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}

module.exports = { createAdminApp, startAdminServer };

if (require.main === module) {
  startAdminServer().then((server) => {
    const url = `http://localhost:${server.address().port}`;
    console.log(`License issuer running at ${url} (local machine only)`);
    if (process.platform === 'win32') exec(`start ${url}`);
  }).catch((err) => {
    console.error(err.code === 'EADDRINUSE' ? 'Port 4100 is already in use — is License Admin already open?' : err.message || err);
    process.exit(1);
  });
}
