# CHAND School Management System

A full-featured school CMS: student admissions, teacher records, timetable, Wi-Fi/LAN
mobile attendance (with automatic teacher attendance), a question bank + exam paper
generator (PDF/Word export), fees & receipts, payroll, notices (email/SMS/WhatsApp),
reports, role-based dashboards, backups, and audit logs. React + Vite frontend, Express
backend on Node's built-in `node:sqlite`, packaged as a Windows desktop app with Electron.

## Get the Windows app (fastest way to start using it)
Build the installer/portable exe yourself (see below), then either:
- Run **`CHAND-School-Management-Setup-<version>.exe`** from `dist-electron/` to install it, or
- Run **`CHAND-School-Management-Portable-<version>.exe`** directly — no install needed.

First login: **admin / Admin@123** (you'll be asked to set a new password).

## Run from source (development)
1. Install Node.js 22.5+ (needed for `node:sqlite`).
2. `npm run setup` (installs root + client dependencies).
3. `npm run dev` — starts the API on :3000 and the Vite dev server on :5173.
4. Open http://localhost:5173

To try it with sample data instead of an empty database: `node scripts/seed-demo-data.js`
(creates classes KG through XII with 1-2 sections each, ~20 teachers and ~100 students with
Pakistani names, a fee structure, and a few question-bank entries; safe to re-run).

## Build the Windows installer
```
npm run package:win
```
This builds the client, bundles the backend into a single file (`server-dist/`), and
runs electron-builder. Output lands in `dist-electron/`:
- `CHAND-School-Management-Setup-<version>.exe` — NSIS installer (desktop + Start Menu shortcuts)
- `CHAND-School-Management-Portable-<version>.exe` — single-file, no install required

App icon/logo sources: `build/icon.ico`, `build/icon.png`, `client/public/chand-*.png`
(generated from `build/chand-logo-source.jpg`).

## Mobile attendance over Wi-Fi
The desktop app binds to your PC's LAN address, not just localhost. On the Admin
dashboard (and Settings page) there's a QR code / URL — any teacher's phone on the same
Wi-Fi network can scan it to open a mobile-friendly attendance page, log in, and mark
attendance for the classes they're assigned to.

- Each row shows **Saved / Not saved / Waiting to sync**, and the Save button stays pinned
  to the bottom of the phone screen.
- Every submission is stored on the phone *before* it is sent. If Wi-Fi drops or the login
  expires, it stays queued and is sent automatically when the connection comes back
  (re-sending is safe — the server upserts per student per day).
- If phones can't open the link, allow the app through Windows Firewall on the server PC
  (Settings → Multi-PC & Network → "Allow through Windows Firewall"), and pick the right
  network adapter under the QR code if the PC has more than one.

## Using several PCs with the same data
Pick **one** PC as the main server (the default). On every other office PC, install the
app, press **Ctrl+Shift+K** (or Settings → Multi-PC & Network → Connection Settings),
choose "Connect to the main server PC", and click **Find servers** or type its address.
Those PCs then work on the main server's live database, so everything syncs instantly.
If every PC runs as its own server, each has a separate database and nothing syncs.

## Teacher attendance
Teachers are marked Present automatically when they submit class attendance. Principal,
Super Admin and Admin can also mark or override every teacher's attendance (Present /
Absent / Late / Leave) from Attendance → Teachers.

## School branding
Settings → School Branding lets an admin set the school name, address and upload a logo.
That name + logo appear as the letterhead on every generated PDF — fee vouchers, payment
receipts, payslips, exam papers and printable notices.

## Notifications
- **WhatsApp** — free and direct, via [Baileys](https://github.com/WhiskeySockets/Baileys)
  (the WhatsApp Web protocol). Link one WhatsApp number from Settings by scanning a QR
  code once, like linking WhatsApp Web; after that the server can message any guardian's
  number directly — no per-message app-opening, no share sheet, no paid API.
- **Email** — via SMTP. Set `SMTP_HOST`/`SMTP_USER`/`SMTP_PASS`/`SMTP_FROM` in a `.env`
  file next to `server-dist/server.js` (or `server/server.js` in dev).
- **SMS** — via Twilio. Set `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_SMS`.

Without SMTP/Twilio credentials configured, those two channels record messages as
"simulated" rather than silently failing, so the feature is fully testable before you
wire up a real provider — WhatsApp works for real as soon as it's linked, no credentials
needed.

Fee vouchers and receipts can be sent automatically (Settings → Automatic Sending) the
moment they're generated/paid, or sent on demand from the Fees/Payroll pages — each
delivery includes the branded PDF as a WhatsApp document / email attachment.

## Sharing documents as PDF or Image
Every generated document — fee vouchers, payslips, exam papers, notices/circulars — has
both a **PDF** and an **Image** button next to it (Fees, Payroll, Exams, Communication
pages). PDF downloads/shares the file as-is; Image renders it to a PNG entirely in the
browser (via `pdfjs-dist`, no server-side conversion) so it can be shared anywhere an
image is easier to use than a document. Where the platform supports it (e.g. Android
Chrome), clicking either button opens the native share sheet directly; otherwise it downloads.

## Correcting mistakes (everything is editable, nothing silently disappears)
- **Students, teachers, non-teaching staff, user accounts, classes/sections/subjects/rooms,
  timetable periods, questions, fee structures/heads, salary advances** — Edit buttons everywhere.
- **Invoices** — View / Edit: change fee lines, discounts, fine, period, due date. Payments can be
  corrected or voided (with a reason); an invoice with no payments can be cancelled (kept, not counted as dues).
- **Expenses** — Edit or Delete (with a reason). Deleted expenses stop counting in totals but stay under
  "Show deleted" and can be restored. Edited ones are tagged EDITED.
- **Payslips** — unpaid ones can be edited or deleted (advance recovery is given back); "Mark Unpaid" undoes a mistaken "Paid".
- **History** buttons show who changed what and when (old value → new value).
- **Relieve / Re-join** teachers and staff with dates; on re-join keep the same salary or set a new one.
- **Remove user** archives the account (can't sign in, can be restored).

## Backups outside the PC
Settings → Backups → **Download Full Backup (.zip)** saves the database plus all photos/documents —
keep it on a USB drive or Google Drive. **Restore from an external backup** accepts that .zip (or a .db),
checks it, saves a safety copy of the current data first, keeps this PC's license, and needs no restart.

## Tests
`npm test` runs an end-to-end suite (auth, RBAC, attendance, fees, exams) against a
throwaway database.

## Project layout
- `client/` — React frontend (Vite)
- `server/` — Express backend source (`server/src/routes`, `services`, `db`)
- `server-dist/` — bundled backend output (generated, not committed)
- `electron/` — desktop launcher (`main.js`) + `electron-builder` config
- `scripts/` — build/seed helper scripts
- `docs/` — schema, API reference, install guide, user manual
- `test/` — automated tests (`node --test`)

## Documentation
- **[Deployment & maintenance guide](DEPLOYMENT.md)** — what to give a school, where their
  data lives, how to update a school's copy later without touching their database, and the
  ongoing development workflow.
- [Database schema](docs/database-schema.sql)
- [API reference](docs/api-documentation.md)
- [Installation guide](docs/installation-guide.md)
- [User manual](docs/user-manual.md)
