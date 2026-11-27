const crypto = require('crypto');

// Offline, device-locked license keys. There is no server anywhere in this
// scheme: a school's PC displays a short "Device ID" derived from its own
// hardware fingerprint (see utils/fingerprint.js); the developer runs
// scripts/generate-license.js with that Device ID to deterministically derive
// a matching 16-character key (HMAC-SHA256 keyed by config.license.signingSecret,
// truncated/encoded); the app re-derives the expected key from its own
// hardware on every launch and compares. A key generated for one Device ID
// will never match a different PC's Device ID.
//
// This means config.license.signingSecret IS the entire security boundary —
// it necessarily ships inside the installed app (offline verification can't
// work any other way), so it can in principle be extracted by a determined
// reverse-engineer and used to forge keys for arbitrary Device IDs. That's an
// accepted deterrent-not-DRM trade-off, the same class of limitation real
// Windows product keys have. Never regenerate this secret after issuing real
// keys — every previously issued key would stop validating.

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // Crockford base32, already excludes ambiguous I/L/O/U

function encodeBase32(buffer) {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

function normalize(input) {
  return String(input || '')
    .toUpperCase()
    .replace(/[\s-]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1');
}

function formatGroups(str, groupSize) {
  return str.match(new RegExp(`.{1,${groupSize}}`, 'g')).join('-');
}

// 7 bytes -> 12 base32 chars (56 bits), short enough to read aloud/share by phone or WhatsApp.
function deriveDeviceId(machineFingerprintHex) {
  const digest = crypto.createHash('sha256').update(machineFingerprintHex).digest();
  return encodeBase32(digest.subarray(0, 7));
}

// 10 bytes -> exactly 16 base32 chars (80 bits), the Windows-product-key-style format.
function deriveLicenseKey(deviceId, secret) {
  const digest = crypto.createHmac('sha256', secret).update(deviceId).digest();
  return encodeBase32(digest.subarray(0, 10));
}

function isValidKeyFormat(rawInput) {
  const normalized = normalize(rawInput);
  return normalized.length === 16 && [...normalized].every((c) => ALPHABET.includes(c));
}

module.exports = { ALPHABET, encodeBase32, normalize, formatGroups, deriveDeviceId, deriveLicenseKey, isValidKeyFormat };
