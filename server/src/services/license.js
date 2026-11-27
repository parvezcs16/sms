const crypto = require('crypto');
const config = require('../config');
const { getSetting, setSetting } = require('./settings');
const { normalize, deriveLicenseKey, isValidKeyFormat } = require('../utils/licenseKey');
const { getDeviceId, getFormattedDeviceId } = require('../utils/fingerprint');
const { HttpError } = require('../middleware/errors');

function keysMatch(a, b) {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB);
}

// The stored key is re-validated against THIS machine's current hardware on
// every call — there is no separately-stored "trusted" fingerprint to tamper
// with. Copying the data folder to a different PC, or hand-editing the stored
// key in sms.db, both fail the same way: the key no longer matches what this
// hardware derives to.
function getLocalStatus(db) {
  const storedKey = getSetting(db, 'license.key', '');
  if (!storedKey) {
    return { state: 'unactivated', deviceId: getFormattedDeviceId() };
  }

  const expectedKey = deriveLicenseKey(getDeviceId(), config.license.signingSecret);
  if (!keysMatch(storedKey, expectedKey)) {
    return { state: 'locked', reason: 'hardware_mismatch', deviceId: getFormattedDeviceId() };
  }

  return {
    state: 'active',
    activatedAt: getSetting(db, 'license.activatedAt', '')
  };
}

function activate(db, rawKeyInput) {
  if (!isValidKeyFormat(rawKeyInput)) {
    throw new HttpError(400, "That doesn't look like a valid license key. Double-check for typos.");
  }
  const normalizedKey = normalize(rawKeyInput);
  const expectedKey = deriveLicenseKey(getDeviceId(), config.license.signingSecret);

  if (!keysMatch(normalizedKey, expectedKey)) {
    throw new HttpError(400, "This key doesn't match this computer's Device ID. Double-check you sent the right Device ID and got a key back for it.");
  }

  setSetting(db, 'license.key', normalizedKey);
  setSetting(db, 'license.activatedAt', new Date().toISOString());
  return getLocalStatus(db);
}

module.exports = { getLocalStatus, activate };
