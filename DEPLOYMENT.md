# Deployment & Maintenance Guide

This covers the full lifecycle: what to hand a school, where their data lives,
how to update a school's copy later without touching their data, and how to
keep improving the app safely over time.

---

## 1. What to deploy to a school

Build the installer (see [installation-guide.md](docs/installation-guide.md) if
you need to build from source):

```powershell
npm run package:win
```

This produces two files in `dist-electron/`:

| File | What it is | When to use it |
|---|---|---|
| `CHAND-School-Management-Setup-<version>.exe` | NSIS installer | **Recommended.** Adds Start Menu + Desktop shortcuts, lets the school choose the install folder, and is what you re-run for updates. |
| `SchoolManagementSystem-Portable-<version>.exe` | Single portable exe | No install step — good for a quick trial on a machine, or a USB-stick handoff. Data still persists per-Windows-user (see below), it just doesn't create shortcuts or register itself for uninstall. |

**Give the school just that one `.exe` file.** They don't need Node.js, the
source code, or anything else installed — everything the app needs (backend,
frontend, database engine) is bundled inside it.

### First run at a school
1. Run the installer (or the portable exe).
2. The app shows an activation screen first, displaying this PC's Device ID.
   Send it to yourself, issue a key (see §8), and enter it — the app won't
   proceed to login until this succeeds.
4. Log in with **admin / Admin@123**. The app forces a password change on
   first login — make sure whoever sets it up actually does this.
5. Settings → School Branding: set the real school name, address, and upload
   their logo. This immediately appears on every voucher/receipt/payslip/notice.
6. Settings → WhatsApp: scan the QR code with the school's WhatsApp number to
   enable direct WhatsApp sending (optional, free).
7. Either start entering real classes/teachers/students, or — for a demo/trial
   — run `node scripts/seed-demo-data.js` from a copy of the source repo
   pointed at their data directory (see §6) to populate realistic sample data.
8. Settings → Backups → "Create Backup Now" once real data exists, so there's
   a known-good starting backup.

---

## 2. Where a school's data lives

Everything specific to one school — database, uploaded documents, backups,
logs, the linked WhatsApp session — lives **outside the installed program**,
in the current Windows user's profile:

```
%APPDATA%\school-management-system\
├── sms.db                  ← the SQLite database (all school data)
├── sms.db-wal, sms.db-shm  ← SQLite write-ahead-log files (normal, not junk)
├── uploads\                ← student/teacher photos, documents, school logo
├── backups\                ← manual + restored backup copies of sms.db
├── logs\server.log         ← backend log, useful for troubleshooting
└── whatsapp-auth\          ← the linked WhatsApp session (re-scan QR if deleted)
```

(Full path is typically `C:\Users\<windows-username>\AppData\Roaming\school-management-system\`.)

**This is the only folder you need to back up or migrate.** The installed
program itself (in `Program Files` or wherever it was installed) is
disposable — it contains no school-specific data and can always be
reinstalled/updated from a fresh installer.

### Backing it up
- **From the app**: Settings → Backups → "Create Backup Now" (super_admin/
  admin/principal). This copies `sms.db` into the `backups\` subfolder with a
  timestamp, and it's downloadable from the same screen.
- **Manually / for off-site backup**: copy the whole
  `%APPDATA%\school-management-system\` folder (ideally while the app is
  closed, so no write is in progress) to a USB drive, network share, or cloud
  sync folder. Automate this with Windows Task Scheduler + a scheduled copy
  if you want off-machine backups without relying on someone clicking a button.
- **Restoring**: Settings → Backups → pick a backup → Restore (super_admin
  only). This replaces the live database with the backup and asks for an app
  restart. You can also just close the app and manually copy a backup file
  over `sms.db` yourself.

---

### Google Drive backup ("Connect Google account", like WhatsApp)

For schools to connect Google Drive with one click, the app needs its own Google
sign-in. You set it up **once** (free), and every installer you build includes it:

1. Open https://console.cloud.google.com, create a project (e.g. "CHAND School Management").
2. **APIs & Services → Library** → enable **Google Drive API**.
3. **APIs & Services → OAuth consent screen** → External. Use the app name "CHAND School Management", your support email and logo.
   Add the scope `.../auth/drive.file`. This scope only lets the app see the backup files it created, never the school's other files.
4. **Publish** the consent screen ("In production"). While it is in *Testing*, only the Google accounts you list as test users can connect, and
   their sign-in expires after 7 days. Because `drive.file` is not a restricted scope, no paid security review is needed.
5. **Credentials → Create credentials → OAuth client ID → Desktop app**, then click **Download JSON**.
6. Save that file as `google-oauth.json` in the project root (next to `package.json`). It is git-ignored.
7. Build as usual (`npm run package:win`). The build log prints `Google Drive sign-in: google-oauth.json included`.

At the school: Backup & Restore (in the menu) → **Connect Google account** (on the main/server PC) → pick the account → Allow.
The app then backs up daily, or weekly/monthly as chosen, at the set time. If the PC is off or offline at that time, the backup
runs and retries hourly once the PC is back. On a new PC: install, connect the same Google account, then **Restore from Google Drive…**.

Without `google-oauth.json`, schools can still use *Advanced → Google Drive for desktop folder*, or enter their own client ID.

## 3. Updating a school's copy without touching their data

This is the important one: **installing a newer version of the app never
touches `%APPDATA%\school-management-system\`.** The installer only replaces
the program files (the code); the data directory is a completely separate
location that Windows/Electron manage per-user, independent of the app version.

### The actual update process
1. On your dev machine, make your changes, bump the version in
   `package.json` (e.g. `1.0.0` → `1.1.0`) — this becomes the installer's
   filename and shows up in Settings.
2. If your changes need a schema change (new column, new table), add it as a
   new entry in `server/src/db/migrations.js` — **never** edit an existing
   `CREATE TABLE` statement in `server/src/db/schema.js` once a version has
   shipped (see §5, this is the part that actually guarantees safety).
3. `npm run package:win` to build the new installer.
4. Give the school the new `Setup <version>.exe` and have them run it — the
   NSIS installer detects the existing install and updates it in place.
5. On first launch after updating, the app automatically:
   - opens the school's **existing** `sms.db` (same file, same folder — untouched),
   - runs any new migrations from step 2 against it (additive only — new
     columns/tables, existing data untouched),
   - is otherwise just... the new version, working on their real data.
6. Confirm it worked: Settings shows the new `appVersion` and the current
   `schemaVersion` (count of applied migrations) — a quick way to verify an
   update actually landed and migrations applied.

Since 1.2.0 the app also **takes an automatic snapshot before upgrading**:
the first launch of a new version writes
`backups\pre-update-<old>-to-<new>-<timestamp>.db` before any migration runs,
and each migration commits atomically (all or nothing).

The data folder name is pinned in `electron/main.js` (`DATA_FOLDER_NAME`).
Never change it — Electron otherwise derives it from the product name, and
renaming the product (as happened with the CHAND rebrand) would point the app
at an empty folder.

No export/import, no "start fresh," no manual data copying. The school
opens the app and their students, fees, attendance history — everything —
is exactly as they left it, just running the updated code.

### If something goes wrong with an update
Because backups are just file copies, recovery is simple: close the app,
restore `sms.db` from the most recent backup in `backups\` (or a manual copy
you made before the update), and either stay on the old installer or fix
forward. This is also why step 6 above (take a backup right before a
scheduled update) is good practice, even though updates shouldn't need it.

---

## 4. Deploying to multiple schools

Each installation is fully independent — every school has its own
`%APPDATA%\school-management-system\` on their own PC, its own SQLite
database, its own WhatsApp link, its own backups. There is no shared server
or central database. This means:

- You can run the exact same installer at every school.
- One school's data volume or issues never affect another's.
- "Updating everyone" means distributing the new installer to each school
  individually (email, USB, shared drive, remote-support session — however
  you currently reach them) and having them run it. There's no automatic
  central rollout mechanism in this build; if you eventually need one,
  the natural next step is an auto-update check (Settings could ping a URL
  you control for "latest version" and prompt to download) — not built yet,
  but the version endpoint (`/api/settings/version`) is already there to
  build that against later.

---

## 5. Making schema changes safely (for future development)

`server/src/db/schema.js` uses `CREATE TABLE IF NOT EXISTS` — this only fires
for a table that doesn't exist yet. It will **not** retroactively add a new
column to a table an already-installed school already has. That's exactly
why `server/src/db/migrations.js` exists.

**Rule going forward: any change to the shape of an existing table goes in
`migrations.js`, not `schema.js`.**

```js
// server/src/db/migrations.js
const MIGRATIONS = [
  {
    id: 1,
    description: 'Add students.emergency_contact',
    run(db) { db.exec(`ALTER TABLE students ADD COLUMN emergency_contact TEXT`); }
  }
  // next one is id: 2, etc. — never renumber or edit a shipped migration.
];
```

- Only use additive SQL here (`ALTER TABLE ... ADD COLUMN`, `CREATE TABLE IF
  NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`). Never `DROP` a column/table that
  might hold real data.
- `schema.js` should only ever be edited to add a **brand-new** table (which
  is safe via `CREATE TABLE IF NOT EXISTS` for both fresh installs and
  upgrades) or a new index on an existing table.
- Every migration runs at most once per database — the app tracks applied
  migration ids in a `schema_migrations` table automatically.

---

## 6. Local development workflow

```powershell
npm run setup     # install dependencies (root + client)
npm run dev       # API on :3000, Vite dev server on :5173 with hot reload
node --test       # run the automated test suite
node scripts/seed-demo-data.js   # populate KG-XII classes, ~20 teachers, ~100 students
```

`scripts/seed-demo-data.js` is safe to run against a real `%APPDATA%` data
directory too (point `SMS_DATA_DIR` at it) if you want to demo the app to a
school using realistic-looking data before they enter their own — it won't
duplicate data on repeat runs.

---

## 7. Continuous improvement workflow

A lightweight process for shipping changes without risking any school's data:

1. **Branch and change.** Make the change in the source repo. If it touches
   the database shape, write a migration (§5) — don't skip this even for
   "just one column," since that's exactly what breaks upgrades silently.
2. **Test locally.**
   - `node --test` — the automated suite (auth, RBAC, attendance, fees, exams).
   - `npm run dev` and click through the actual change in the browser.
   - If you touched the schema, test the *upgrade* path specifically: seed a
     database with the *previous* migrations only, then run the app with your
     new migration and confirm existing rows survive and new columns populate
     sensibly (defaults, not crashes).
3. **Bump the version** in `package.json` (semantic-ish: patch for fixes,
   minor for new features, major for breaking changes to workflows).
4. **Build and smoke-test the actual installer**, not just dev mode —
   `npm run package:win`, then run the produced exe from a clean
   `%APPDATA%\school-management-system\` (rename/move the folder aside
   temporarily) to confirm first-run works, and separately test it against an
   *existing* data folder from an older version to confirm the upgrade path.
5. **Keep a changelog.** Add a dated entry (even a short one) to
   `CHANGELOG.md` (create it if it doesn't exist yet) — version number, what
   changed, whether a migration was added. This is what lets you (or anyone
   else) answer "what's different in v1.3.0?" six months from now.
6. **Ship.** Distribute the new installer to schools per §4. Ask at least one
   school to confirm the update landed cleanly (Settings shows the new
   version) before treating the rollout as done.
7. **Feedback loop.** Track issues/requests from schools somewhere durable
   (even a simple text file or spreadsheet is fine to start) so the next
   development pass has real priorities instead of guesses.

---

## 8. Licensing (per-school activation lock)

Every install requires a one-time 16-character license key
(`XXXX-XXXX-XXXX-XXXX`) that locks it to that one specific PC. **This is
entirely offline — there is no license server to host or maintain.**

**How it works:**
1. On first run, the app computes a **Device ID** (a short code derived from
   that PC's hardware — Windows machine GUID, hashed) and shows it on the
   activation screen.
2. The school reads/copies that Device ID and sends it to you however's
   convenient — WhatsApp, phone call, email.
3. You run `node scripts/generate-license.js issue "<School Name>" <DEVICE-ID>`
   on your own machine. This deterministically derives a 16-character key
   that is cryptographically tied to that exact Device ID (HMAC-SHA256 keyed
   by `config.license.signingSecret` in `server/src/config.js`) — no database,
   no network call, nothing to host.
4. You send the printed key back to the school; they enter it and the app
   activates.
5. On every subsequent launch, the app re-derives the expected key from its
   *current* hardware and compares it to what's stored — no internet needed,
   ever. A key issued for one Device ID mathematically cannot validate on a
   different PC's Device ID, so the same key can't be reused elsewhere, and
   copying the install/data folder to different hardware locks it immediately.

**Security note:** because verification has to work fully offline, the app
itself necessarily contains everything needed to check a key
(`config.license.signingSecret`). A sufficiently determined person could
extract that secret from the installed app and forge keys. This is a
deterrent against casual reuse (the same class of protection a Windows
product key offers), not unbreakable DRM — set expectations accordingly.
**Never change `signingSecret` once you've issued real keys** — every key
ever issued is derived from it, and changing it invalidates all of them.

**Issuing a key for a new school** — double-click **`Launch License Admin.bat`**
at the repo root (or `npm run license-admin`). It starts a small local web
page and opens it automatically at `http://localhost:4100` — this runs only
on your own machine (bind address `127.0.0.1`); the signing secret never
leaves the Node process or reaches the browser page. Fill in the school name
and the Device ID they sent you, click Generate, and it copies the key to
your clipboard, ready to send back. There's also a CLI if you prefer:
```powershell
node scripts/generate-license.js issue "Greenwood Public School" <DEVICE-ID-FROM-SCHOOL>
node scripts/generate-license.js verify <DEVICE-ID> <KEY>   # double-check a key before sending
node scripts/generate-license.js list                        # print the tracked list
```

**Tracking which schools you've issued keys to:** both the CLI and the web
page write to `licenses-issued.json` (gitignored, repo root) — one record per
key issued: school name, Device ID, key, and a status (`issued` or
`confirmed`). The web page lists every issued key in a table with a **Mark
Activated** button. There's no way to detect activation automatically — the
app never phones home by design — so this status is purely something you set
yourself once a school confirms it worked (a call, a WhatsApp reply, etc.).

**Moving a school to new hardware** (their PC died, they're upgrading, etc.):
there's nothing to "unbind" — just get the new PC's Device ID and issue it a
fresh key the same way. The old key simply won't validate on new hardware.

**Note:** license state (`license.key`, `license.activatedAt`) lives as rows
in `sms.db`'s existing `settings` table — it's part of the per-school
database, so restoring an old backup (§2) also restores whatever license
state was current at backup time.

---

### License Admin as a Windows exe
`npm run package:license-admin` builds `dist-license-admin/CHAND-License-Admin-<version>.exe`
— a single portable exe (no Node.js needed) with the same issue/track page in its own window.

- **Keep it to yourself.** It contains the signing secret; never give it to a school.
- Records are saved to `licenses-issued.json` **next to the exe** if one is there,
  otherwise to `%APPDATA%\CHAND License Admin\licenses-issued.json`.
- On first run it offers to import your existing `licenses-issued.json` (File →
  Import licenses file… / Ctrl+I any time later; duplicates are skipped).
- The `.bat` / `npm run license-admin` version still works and keeps using the
  repo-root `licenses-issued.json`.

---

## Quick reference

| Question | Answer |
|---|---|
| What do I give a school? | `CHAND-School-Management-Setup-<version>.exe` from `dist-electron/` |
| Several office PCs? | One PC = main server; others: Ctrl+Shift+K → Connect to the main server PC |
| Where's their data? | `%APPDATA%\school-management-system\` on their PC |
| Does updating wipe their data? | No — the installer only replaces program files, never the data folder |
| How do I change the database safely? | Add a migration in `server/src/db/migrations.js`, never edit shipped `schema.js` statements |
| How do I check what version a school is running? | Settings page shows `appVersion` and `schemaVersion` |
| How do I issue a school a license key? | Get their Device ID from the activation screen, then `node scripts/generate-license.js issue "<School Name>" <DEVICE-ID>` (§8) |
| How do I move a school to a new PC? | Get the new PC's Device ID and issue it a fresh key — nothing to unbind, no server involved (§8) |
| How do I back up a school's data? | Settings → Backups → Create Backup Now, or copy `%APPDATA%\school-management-system\` |
| Can I run this at many schools? | Yes — each install is fully independent, own DB, own backups |
