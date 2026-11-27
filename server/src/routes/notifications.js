const express = require('express');
const { getDb } = require('../db/connection');
const asyncHandler = require('../utils/asyncHandler');
const { requireAuth, requireRole, ROLE_GROUPS } = require('../middleware/auth');
const { recordAudit } = require('../middleware/audit');
const { requireAccess, requireAccessAny, hasAccess, isManagement } = require('../middleware/permissions');
const { HttpError } = require('../middleware/errors');
const notificationService = require('../services/notifications/notificationService');
const emailProvider = require('../services/notifications/emailProvider');
const smsProvider = require('../services/notifications/smsProvider');
const whatsappService = require('../services/notifications/whatsappService');
const pdfService = require('../services/pdf');
const { getBranding } = require('../services/settings');

const router = express.Router();
router.use(requireAuth);

router.get('/channel-status', requireAccess('communication', 'view'), asyncHandler(async (req, res) => {
  res.json({
    email: emailProvider.isConfigured(),
    sms: smsProvider.isConfigured(),
    whatsapp: whatsappService.isConfigured()
  });
}));

router.get('/', asyncHandler(async (req, res) => {
  const db = getDb();
  const rows = db.prepare(
    `SELECT n.*, u.full_name AS created_by_name,
            (SELECT COUNT(*) FROM notification_recipients WHERE notification_id = n.id) AS recipient_count,
            (SELECT COUNT(*) FROM notification_recipients WHERE notification_id = n.id AND status = 'sent') AS sent_count
     FROM notifications n LEFT JOIN users u ON u.id = n.created_by
     ORDER BY n.created_at DESC LIMIT 100`
  ).all();
  res.json(rows);
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const db = getDb();
  const notification = db.prepare('SELECT * FROM notifications WHERE id = ?').get(req.params.id);
  if (!notification) throw new HttpError(404, 'Notification not found');
  const recipients = db.prepare('SELECT * FROM notification_recipients WHERE notification_id = ?').all(req.params.id);
  res.json({ ...notification, recipients });
}));

async function buildNoticePdf(db, notification) {
  const { schoolName, logoPath, stampPath } = getBranding(db, 'notices');
  return pdfService.noticePdf({
    schoolName, logoPath, stampPath,
    title: notification.title,
    category: notification.category,
    message: notification.message,
    createdAt: notification.created_at
  });
}

// Any notice can be downloaded/shared as a branded PDF (or converted to an
// image client-side) on demand, whether or not it was attached at send time.
router.get('/:id/pdf', asyncHandler(async (req, res) => {
  const db = getDb();
  const notification = db.prepare('SELECT * FROM notifications WHERE id = ?').get(req.params.id);
  if (!notification) throw new HttpError(404, 'Notification not found');
  const buffer = await buildNoticePdf(db, notification);
  pdfService.sendPdf(res, `notice-${req.params.id}.pdf`, buffer);
}));

router.post('/', requireAccess('communication', 'manage'), asyncHandler(async (req, res) => {
  const { title, message, category, audienceType, audienceRef, channels, attachPdf } = req.body;
  if (!title || !message || !audienceType || !Array.isArray(channels) || !channels.length) {
    throw new HttpError(400, 'title, message, audienceType and channels[] are required');
  }

  let attachment;
  if (attachPdf) {
    const db = getDb();
    const buffer = await buildNoticePdf(db, { title, message, category, created_at: new Date() });
    attachment = { buffer, fileName: `${title.replace(/[^a-z0-9]+/gi, '-').slice(0, 40)}.pdf`, mimetype: 'application/pdf' };
  }

  const result = await notificationService.sendNotification({
    title, message, category, audienceType, audienceRef, channels, createdBy: req.user.id, attachment
  });
  recordAudit(req, 'send_notification', 'notification', result.notificationId, { audienceType, channels });
  res.status(201).json(result);
}));

module.exports = router;
