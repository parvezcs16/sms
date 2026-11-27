// Issues a license key for a specific PC's Device ID. This is a fully local,
// offline tool — no server involved anywhere. The school reads their Device
// ID off the app's activation screen and sends it to you (WhatsApp/call/
// email); you run this; you send back the key it prints.
//
// Usage:
//   node scripts/generate-license.js issue "<School Name>" <DEVICE-ID>
//   node scripts/generate-license.js verify <DEVICE-ID> <KEY>
//   node scripts/generate-license.js list
//
// For a point-and-click version of "issue" + a trackable list, see
// scripts/license-admin-page.js (or double-click "Launch License Admin.bat").

const config = require('../server/src/config');
const { normalize, formatGroups, deriveLicenseKey, isValidKeyFormat } = require('../server/src/utils/licenseKey');
const registry = require('./lib/licenseRegistry');
const policy = require('./lib/licenseAdminPolicy');

function usage() {
  console.log(
    'Usage:\n' +
      '  node scripts/generate-license.js issue "<School Name>" <DEVICE-ID>\n' +
      '  node scripts/generate-license.js verify <DEVICE-ID> <KEY>\n' +
      '  node scripts/generate-license.js list'
  );
}

const [, , command, ...args] = process.argv;

if (command === 'issue') {
  const [schoolName, rawDeviceId] = args;
  if (!schoolName || !rawDeviceId) {
    console.error('Usage: node scripts/generate-license.js issue "<School Name>" <DEVICE-ID>');
    process.exit(1);
  }
  try {
    const { key, reused } = policy.issueKey({ schoolName, deviceId: rawDeviceId });
    console.log(`${reused ? 'Already issued' : 'Issued'} key for "${schoolName}" (device ${formatGroups(normalize(rawDeviceId), 4)}): ${key}`);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
} else if (command === 'verify') {
  const [rawDeviceId, rawKey] = args;
  if (!rawDeviceId || !rawKey) {
    console.error('Usage: node scripts/generate-license.js verify <DEVICE-ID> <KEY>');
    process.exit(1);
  }
  if (!isValidKeyFormat(rawKey)) {
    console.log('INVALID — not a well-formed 16-character key.');
    process.exit(1);
  }
  const deviceId = normalize(rawDeviceId);
  const expected = deriveLicenseKey(deviceId, config.license.signingSecret);
  const matches = normalize(rawKey) === expected;
  console.log(matches ? 'VALID — this key matches this Device ID.' : 'INVALID — this key does not match this Device ID.');
  process.exit(matches ? 0 : 1);
} else if (command === 'list') {
  const records = registry.readAll();
  if (records.length === 0) {
    console.log('No keys issued yet.');
  } else {
    for (const r of records) {
      const status = r.status === 'confirmed' ? `confirmed ${r.confirmedAt}` : 'issued (unconfirmed)';
      console.log(`${r.issuedAt}  ${r.schoolName}  device=${formatGroups(r.deviceId, 4)}  key=${r.key}  [${status}]`);
    }
  }
} else {
  usage();
  process.exit(command ? 1 : 0);
}
