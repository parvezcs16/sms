// Sends WhatsApp messages/documents directly to any number using Baileys — a free,
// open-source WhatsApp Web protocol client. No paid API, no per-message app-opening
// or share-sheet: the school links one WhatsApp number to the app once (by scanning a
// QR code, exactly like linking WhatsApp Web), and after that the server can message
// any number directly and silently.
const path = require('path');
const fs = require('fs');
const QRCode = require('qrcode');
const config = require('../../config');

let sock = null;
let status = 'disconnected'; // disconnected | connecting | qr | connected
let latestQr = null;
let statusDetail = '';
let connecting = null;

const authDir = path.join(config.dataDir, 'whatsapp-auth');

function normalizePhone(rawPhone, defaultCountryCode) {
  if (!rawPhone) return null;
  let digits = String(rawPhone).replace(/[^0-9]/g, '');
  if (!digits) return null;
  if (rawPhone.trim().startsWith('+')) return digits; // already has a country code
  if (digits.startsWith('00')) return digits.slice(2);
  if (digits.startsWith('0') && defaultCountryCode) return defaultCountryCode.replace(/[^0-9]/g, '') + digits.slice(1);
  return digits;
}

function toJid(phone) {
  return `${phone}@s.whatsapp.net`;
}

async function connect() {
  if (connecting) return connecting;
  connecting = (async () => {
    const baileys = require('@whiskeysockets/baileys');
    const { makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion, DisconnectReason } = baileys;
    const pino = require('pino');

    fs.mkdirSync(authDir, { recursive: true });
    const { state, saveCreds } = await useMultiFileAuthState(authDir);
    // Pin to the current WhatsApp Web protocol version — Baileys' hardcoded default
    // can lag behind and cause the handshake to hang silently instead of erroring.
    const { version } = await fetchLatestBaileysVersion().catch(() => ({ version: undefined }));

    status = 'connecting';
    statusDetail = '';
    sock = makeWASocket({
      auth: state,
      version,
      logger: pino({ level: 'silent' }),
      printQRInTerminal: false,
      browser: ['CHAND School Management', 'Chrome', '1.0']
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
      const { connection, lastDisconnect, qr } = update;
      if (qr) {
        latestQr = qr;
        status = 'qr';
      }
      if (connection === 'open') {
        status = 'connected';
        latestQr = null;
        statusDetail = '';
      }
      if (connection === 'close') {
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const loggedOut = statusCode === DisconnectReason.loggedOut;
        status = 'disconnected';
        latestQr = null;
        connecting = null;
        if (loggedOut) {
          statusDetail = 'Logged out. Scan the QR code again to reconnect.';
          fs.rmSync(authDir, { recursive: true, force: true });
        } else {
          statusDetail = 'Connection lost. Reconnecting…';
          connect().catch(() => {});
        }
      }
    });
  })();
  return connecting;
}

function getStatus() {
  return { status, detail: statusDetail };
}

async function getQrDataUrl() {
  if (!latestQr) return null;
  return QRCode.toDataURL(latestQr, { margin: 1, width: 260 });
}

async function logout() {
  if (sock) {
    try { await sock.logout(); } catch { /* already disconnected */ }
  }
  fs.rmSync(authDir, { recursive: true, force: true });
  sock = null;
  status = 'disconnected';
  latestQr = null;
  connecting = null;
}

function isConfigured() {
  return status === 'connected';
}

async function sendText(rawPhone, text, defaultCountryCode) {
  if (status !== 'connected' || !sock) return { status: 'simulated', error: 'WhatsApp is not connected (link it from Settings)' };
  const phone = normalizePhone(rawPhone, defaultCountryCode);
  if (!phone) return { status: 'failed', error: 'Invalid phone number' };
  try {
    await sock.sendMessage(toJid(phone), { text });
    return { status: 'sent' };
  } catch (err) {
    return { status: 'failed', error: err.message };
  }
}

async function sendDocument(rawPhone, { buffer, fileName, mimetype, caption }, defaultCountryCode) {
  if (status !== 'connected' || !sock) return { status: 'simulated', error: 'WhatsApp is not connected (link it from Settings)' };
  const phone = normalizePhone(rawPhone, defaultCountryCode);
  if (!phone) return { status: 'failed', error: 'Invalid phone number' };
  try {
    await sock.sendMessage(toJid(phone), { document: buffer, fileName, mimetype, caption });
    return { status: 'sent' };
  } catch (err) {
    return { status: 'failed', error: err.message };
  }
}

// WhatsApp groups the linked number is a member of (e.g. "Class 5-A Parents"),
// so the diary can be posted straight into a class group.
async function listGroups() {
  if (status !== 'connected' || !sock) throw new Error('WhatsApp is not linked — link the school number in Settings → WhatsApp first');
  const all = await sock.groupFetchAllParticipating();
  return Object.values(all || {}).map((g) => ({
    id: g.id,
    name: g.subject || g.id,
    members: Array.isArray(g.participants) ? g.participants.length : null,
    admins_only: Boolean(g.announce)
  })).sort((a, b) => a.name.localeCompare(b.name));
}

async function sendGroupText(groupId, text) {
  if (status !== 'connected' || !sock) return { status: 'simulated', error: 'WhatsApp is not connected (link it from Settings)' };
  if (!/^[\d-]+@g\.us$/.test(String(groupId || ''))) return { status: 'failed', error: 'Not a WhatsApp group' };
  try {
    await sock.sendMessage(groupId, { text });
    return { status: 'sent' };
  } catch (err) {
    return { status: 'failed', error: err.message };
  }
}

module.exports = { connect, logout, getStatus, getQrDataUrl, isConfigured, sendText, sendDocument, normalizePhone, listGroups, sendGroupText };
