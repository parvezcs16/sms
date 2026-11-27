const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { getDb } = require('../db/connection');
const config = require('../config');
const asyncHandler = require('../utils/asyncHandler');
const { requireAuth } = require('../middleware/auth');
const { recordAudit } = require('../middleware/audit');
const { HttpError } = require('../middleware/errors');
const { getEffectivePermissions, isManagement } = require('../middleware/permissions');
const fs = require('fs');
const path = require('path');
const { upload } = require('../middleware/upload');

const router = express.Router();

function toPublicUser(row) {
  const db = getDb();
  const permissions = getEffectivePermissions(db, { id: row.id, role: row.role });
  return {
    permissions,
    is_management: isManagement({ role: row.role }),
    id: row.id,
    username: row.username,
    role: row.role,
    full_name: row.full_name,
    email: row.email,
    phone: row.phone,
    photo: row.photo || null,
    must_change_password: Boolean(row.must_change_password),
    teacher_id: row.teacher_id || null,
    student_id: row.student_id || null,
    parent_id: row.parent_id || null,
    staff_id: row.staff_id || null
  };
}

router.post('/login', asyncHandler(async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) throw new HttpError(400, 'Username and password are required');
  const db = getDb();
  const row = db.prepare(
    `SELECT u.*, r.name AS role, t.id AS teacher_id, s.id AS student_id, p.id AS parent_id, stf.id AS staff_id
     FROM users u
     LEFT JOIN roles r ON r.id = u.role_id
     LEFT JOIN teachers t ON t.user_id = u.id
     LEFT JOIN students s ON s.user_id = u.id
     LEFT JOIN parents p ON p.user_id = u.id
     LEFT JOIN staff stf ON stf.user_id = u.id AND stf.archived = 0
     WHERE u.username = ?`
  ).get(username);

  if (!row || !row.is_active || row.archived_at) throw new HttpError(401, 'Invalid credentials');
  const valid = bcrypt.compareSync(password, row.password_hash);
  if (!valid) throw new HttpError(401, 'Invalid credentials');

  db.prepare('UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = ?').run(row.id);

  const tokenPayload = { id: row.id, username: row.username, role: row.role, full_name: row.full_name, teacher_id: row.teacher_id || null };
  const token = jwt.sign(tokenPayload, config.jwtSecret, { expiresIn: config.jwtExpiresIn });

  recordAudit({ user: tokenPayload, ip: req.ip }, 'login', 'user', row.id);
  res.json({ token, user: toPublicUser(row) });
}));

router.get('/me', requireAuth, asyncHandler(async (req, res) => {
  const db = getDb();
  const row = db.prepare(
    `SELECT u.*, r.name AS role, t.id AS teacher_id, s.id AS student_id, p.id AS parent_id, stf.id AS staff_id
     FROM users u
     LEFT JOIN roles r ON r.id = u.role_id
     LEFT JOIN teachers t ON t.user_id = u.id
     LEFT JOIN students s ON s.user_id = u.id
     LEFT JOIN parents p ON p.user_id = u.id
     LEFT JOIN staff stf ON stf.user_id = u.id AND stf.archived = 0
     WHERE u.id = ?`
  ).get(req.user.id);
  if (!row) throw new HttpError(404, 'User not found');
  res.json(toPublicUser(row));
}));

router.post('/change-password', requireAuth, asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!newPassword || newPassword.length < 6) throw new HttpError(400, 'New password must be at least 6 characters');
  const db = getDb();
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!bcrypt.compareSync(currentPassword || '', row.password_hash)) {
    throw new HttpError(401, 'Current password is incorrect');
  }
  const hash = bcrypt.hashSync(newPassword, 10);
  db.prepare('UPDATE users SET password_hash = ?, must_change_password = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(hash, req.user.id);
  recordAudit(req, 'change_password', 'user', req.user.id);
  res.json({ success: true });
}));

// ---- My profile: anyone signed in can change their own name, phone, email and photo ----
function removeUpload(file) {
  if (!file) return;
  const p = path.join(config.uploadsDir, path.basename(file));
  try { if (fs.existsSync(p)) fs.unlinkSync(p); } catch { /* in use / already gone */ }
}

router.put('/profile', requireAuth, asyncHandler(async (req, res) => {
  const db = getDb();
  const clean = (v, max) => String(v == null ? '' : v).trim().slice(0, max);
  const fullName = clean(req.body.full_name, 120);
  const phone = clean(req.body.phone, 40);
  const email = clean(req.body.email, 120);
  if (!fullName) throw new HttpError(400, 'Name is required');
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, 'Enter a valid email address');
  if (phone && !/^[0-9+()\-\s]{5,40}$/.test(phone)) throw new HttpError(400, 'Enter a valid phone number');
  db.prepare('UPDATE users SET full_name = ?, phone = ?, email = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .run(fullName, phone || null, email || null, req.user.id);
  recordAudit(req, 'update_profile', 'user', req.user.id, { full_name: fullName, phone, email });
  res.json({ success: true });
}));

router.post('/profile/photo', requireAuth, upload.single('photo'), asyncHandler(async (req, res) => {
  if (!req.file) throw new HttpError(400, 'Choose a photo to upload');
  if (!/\.(jpe?g|png|gif|webp)$/i.test(req.file.originalname)) {
    removeUpload(req.file.filename);
    throw new HttpError(400, 'Please choose an image (JPG, PNG, WEBP).');
  }
  const db = getDb();
  const prev = db.prepare('SELECT photo FROM users WHERE id = ?').get(req.user.id);
  db.prepare('UPDATE users SET photo = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(req.file.filename, req.user.id);
  if (prev && prev.photo) removeUpload(prev.photo);
  recordAudit(req, 'update_profile_photo', 'user', req.user.id);
  res.status(201).json({ photo: req.file.filename });
}));

router.delete('/profile/photo', requireAuth, asyncHandler(async (req, res) => {
  const db = getDb();
  const prev = db.prepare('SELECT photo FROM users WHERE id = ?').get(req.user.id);
  db.prepare('UPDATE users SET photo = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(req.user.id);
  if (prev && prev.photo) removeUpload(prev.photo);
  recordAudit(req, 'remove_profile_photo', 'user', req.user.id);
  res.json({ success: true });
}));

module.exports = router;
