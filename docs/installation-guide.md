# Installation Guide

## Option A — Just run the Windows app (recommended for school staff)
1. Get `School Management System Setup 1.0.0.exe` (installer) or
   `SchoolManagementSystem-Portable-1.0.0.exe` (no install needed) from `dist-electron/`
   (see "Building the Windows app" below if you don't have these yet).
2. Run it. The installer adds a desktop + Start Menu shortcut.
3. Log in with **admin / Admin@123** — you'll be asked to set a new password immediately.
4. Data is stored per-Windows-user under `%APPDATA%\school-management-system\` (database,
   uploaded documents, backups, logs) — nothing is written inside the install folder.

### Mobile attendance on the same Wi-Fi
Open the Admin dashboard or Settings page inside the app — it shows a QR code and URL
(e.g. `http://192.168.x.x:3000/attendance`). Any teacher on the same Wi-Fi network can
scan it on their phone, log in, and mark attendance for their assigned classes.

## Option B — Run from source (development)
### Prerequisites
- Node.js **22.5 or newer** (required for the built-in `node:sqlite` module).
- On Windows, if PowerShell blocks npm with a script-execution error, run once:
  ```powershell
  Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
  ```

### Install dependencies
```powershell
npm run setup
```
This installs the root dependencies (backend + Electron tooling) and the client's
dependencies in one step.

### Run it
```powershell
npm run dev
```
Starts the API on http://localhost:3000 and the Vite dev server on http://localhost:5173.
Open the Vite URL in your browser.

To explore with realistic sample data instead of an empty database:
```powershell
node scripts/seed-demo-data.js
```

### Run as the desktop app (dev mode)
```powershell
npm start
```
This bundles the backend and launches the Electron window, exactly like the packaged app.

## Building the Windows app
```powershell
npm run package:win
```
This runs, in order:
1. `client` production build (Vite) → `client/dist/`
2. Backend bundle (esbuild) → `server-dist/server.js` (single file, no node_modules needed at runtime)
3. `electron-builder` → `dist-electron/`
   - `School Management System Setup 1.0.0.exe` — NSIS installer
   - `SchoolManagementSystem-Portable-1.0.0.exe` — portable, single-file

Notes:
- The first build downloads Electron's binaries (~150MB) and NSIS tooling — this needs
  an internet connection once; afterwards they're cached.
- If code-signing tooling errors out on a machine without it configured, set
  `CSC_IDENTITY_AUTO_DISCOVERY=false` before running the command (the build is unsigned
  by default anyway — see "Optional: code-signing" below).

### Optional: code-signing
The build produces an **unsigned** executable. Windows SmartScreen may warn on first
run ("Windows protected your PC" → "More info" → "Run anyway"). To remove that warning
you'd need a code-signing certificate, which is outside the scope of this project.

## Configuring integrations (optional)
Create a `.env` file next to `server-dist/server.js` (packaged) or `server/server.js`
(dev) to enable real email/SMS/WhatsApp delivery. Without it, notifications still work
but are recorded as "simulated" rather than actually sent:
```
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=you@example.com
SMTP_PASS=your-app-password
SMTP_FROM="School Name <no-reply@example.com>"

TWILIO_ACCOUNT_SID=...
TWILIO_AUTH_TOKEN=...
TWILIO_FROM_SMS=+1...
TWILIO_FROM_WHATSAPP=+1...
```

## Backups
From Settings → Backups (super_admin/admin/principal), create a backup any time, or
download/restore previous ones. Backups are plain copies of the SQLite database file,
stored under `%APPDATA%\school-management-system\backups\`.

## Running tests
```powershell
npm test
```
Runs an end-to-end test suite (`node --test`) covering auth, RBAC, attendance,
fees, and exam paper generation against a throwaway database.
