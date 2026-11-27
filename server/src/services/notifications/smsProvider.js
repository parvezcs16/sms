// SMS via Twilio's REST API. Uses the global fetch available in Node 22+, no SDK needed.
// (WhatsApp is handled separately by whatsappService.js via the free Baileys library —
// no paid API needed for that channel.)
const config = require('../../config');

async function sendSms(to, body) {
  if (!config.twilio.sid || !config.twilio.token || !config.twilio.fromSms) {
    return { status: 'simulated', error: 'SMS not configured (set TWILIO_* in .env)' };
  }
  const url = `https://api.twilio.com/2010-04-01/Accounts/${config.twilio.sid}/Messages.json`;
  const auth = Buffer.from(`${config.twilio.sid}:${config.twilio.token}`).toString('base64');
  const params = new URLSearchParams({ To: to, From: config.twilio.fromSms, Body: body });
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: params
    });
    if (!resp.ok) {
      const errText = await resp.text();
      return { status: 'failed', error: `Twilio error ${resp.status}: ${errText.slice(0, 200)}` };
    }
    return { status: 'sent' };
  } catch (err) {
    return { status: 'failed', error: err.message };
  }
}

module.exports = { sendSms, isConfigured: () => Boolean(config.twilio.sid && config.twilio.fromSms) };
