const { getDb } = require('../db/connection');
const { getLocalStatus } = require('../services/license');

function requireLicense(req, res, next) {
  const status = getLocalStatus(getDb());
  if (status.state === 'active') return next();
  return res.status(403).json({ error: 'License not active', licenseState: status.state, reason: status.reason });
}

module.exports = { requireLicense };
