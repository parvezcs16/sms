const { getDb } = require('../../db/connection');
const emailProvider = require('./emailProvider');
const smsProvider = require('./smsProvider');
const whatsappService = require('./whatsappService');
const { getSetting } = require('../settings');
const { mapWithConcurrency } = require('../../utils/concurrency');

// How many recipient sends run in parallel. Bounded (rather than unbounded
// Promise.all) so a notice to a few hundred parents doesn't hammer a single
// SMTP connection or WhatsApp socket all at once — but still much faster than
// the fully-sequential loop this replaced (which awaited every recipient x
// channel one at a time; a 200-parent notice could take minutes).
const SEND_CONCURRENCY = 5;

// audienceType: 'All' | 'Role' | 'Class' | 'Individual'
// audienceRef: role name / section id / comma-separated contact list, depending on audienceType
function resolveRecipients(db, audienceType, audienceRef) {
  if (audienceType === 'Role') {
    if (audienceRef === 'teacher') {
      return db.prepare(`SELECT full_name AS name, email, phone FROM teachers WHERE archived = 0 AND (email IS NOT NULL OR phone IS NOT NULL)`).all();
    }
    if (audienceRef === 'parent') {
      return db.prepare(`SELECT DISTINCT full_name AS name, email, phone FROM parents WHERE email IS NOT NULL OR phone IS NOT NULL`).all();
    }
    return db.prepare(
      `SELECT u.full_name AS name, u.email, u.phone FROM users u JOIN roles r ON r.id = u.role_id WHERE r.name = ? AND u.is_active = 1`
    ).all(audienceRef);
  }
  if (audienceType === 'Class') {
    return db.prepare(
      `SELECT DISTINCT p.full_name AS name, p.email, p.phone
       FROM students s JOIN parents p ON p.id = s.parent_id
       WHERE s.section_id = ? AND s.archived = 0`
    ).all(Number(audienceRef));
  }
  if (audienceType === 'Individual') {
    // audienceRef is JSON array of { name, email, phone }
    try {
      return JSON.parse(audienceRef);
    } catch {
      return [];
    }
  }
  // 'All': teachers + parents
  const teachers = db.prepare(`SELECT full_name AS name, email, phone FROM teachers WHERE archived = 0`).all();
  const parents = db.prepare(`SELECT DISTINCT full_name AS name, email, phone FROM parents`).all();
  return [...teachers, ...parents];
}

async function dispatchToChannel(channel, recipient, subject, message, attachment, countryCode) {
  if (channel === 'email' && recipient.email) {
    const result = await emailProvider.sendEmail(recipient.email, subject, message, attachment);
    return { address: recipient.email, ...result };
  }
  if (channel === 'sms' && recipient.phone) {
    const result = await smsProvider.sendSms(recipient.phone, message);
    return { address: recipient.phone, ...result };
  }
  if (channel === 'whatsapp' && recipient.phone) {
    const result = attachment
      ? await whatsappService.sendDocument(recipient.phone, { ...attachment, caption: message }, countryCode)
      : await whatsappService.sendText(recipient.phone, message, countryCode);
    return { address: recipient.phone, ...result };
  }
  return null;
}

// attachment (optional): { buffer, fileName, mimetype } — e.g. a fee voucher/receipt PDF,
// sent as an email attachment and as a WhatsApp document (with `message` as the caption).
async function sendNotification({ title, message, category, audienceType, audienceRef, channels, createdBy, attachment }) {
  const db = getDb();
  const countryCode = getSetting(db, 'default_country_code', '');
  const insertNotification = db.prepare(
    `INSERT INTO notifications (title, message, category, audience_type, audience_ref, created_by) VALUES (?, ?, ?, ?, ?, ?)`
  );
  const result = insertNotification.run(title, message, category || 'Announcement', audienceType, String(audienceRef ?? ''), createdBy || null);
  const notificationId = Number(result.lastInsertRowid);

  const recipients = resolveRecipients(db, audienceType, audienceRef);
  const insertRecipient = db.prepare(
    `INSERT INTO notification_recipients (notification_id, channel, address, status, sent_at, error) VALUES (?, ?, ?, ?, ?, ?)`
  );

  const summary = { total: 0, sent: 0, simulated: 0, failed: 0 };
  const jobs = recipients.flatMap((recipient) => channels.map((channel) => ({ recipient, channel })));

  const outcomes = await mapWithConcurrency(jobs, SEND_CONCURRENCY, ({ recipient, channel }) => (
    dispatchToChannel(channel, recipient, title, message, attachment, countryCode).then((outcome) => ({ outcome, channel }))
  ));

  // Recorded once all sends have settled, in a plain synchronous loop —
  // keeps the (fast, synchronous) node:sqlite writes out of the concurrent
  // async workers above, which only ever do network I/O.
  for (const { outcome, channel } of outcomes) {
    if (!outcome) continue;
    summary.total += 1;
    summary[outcome.status] = (summary[outcome.status] || 0) + 1;
    insertRecipient.run(
      notificationId,
      channel,
      outcome.address,
      outcome.status,
      outcome.status === 'sent' ? new Date().toISOString() : null,
      outcome.error || null
    );
  }

  return { notificationId, recipientCount: recipients.length, summary };
}

module.exports = { sendNotification, resolveRecipients };
