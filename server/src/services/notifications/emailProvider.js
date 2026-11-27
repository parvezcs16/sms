const nodemailer = require('nodemailer');
const config = require('../../config');

let transporter = null;
function getTransporter() {
  if (!config.smtp.host) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.port === 465,
      auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined
    });
  }
  return transporter;
}

async function sendEmail(to, subject, text, attachment) {
  const t = getTransporter();
  if (!t) {
    return { status: 'simulated', error: 'SMTP not configured (set SMTP_HOST in .env)' };
  }
  try {
    const mail = { from: config.smtp.from, to, subject, text };
    if (attachment) {
      mail.attachments = [{ filename: attachment.fileName, content: attachment.buffer, contentType: attachment.mimetype }];
    }
    await t.sendMail(mail);
    return { status: 'sent' };
  } catch (err) {
    return { status: 'failed', error: err.message };
  }
}

module.exports = { sendEmail, isConfigured: () => Boolean(config.smtp.host) };
