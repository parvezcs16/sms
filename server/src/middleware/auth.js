const jwt = require('jsonwebtoken');
const config = require('../config');

function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Authentication required' });
  try {
    req.user = jwt.verify(token, config.jwtSecret);
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired session' });
  }
}

function requireRole(...roles) {
  return function roleGuard(req, res, next) {
    if (!req.user) return res.status(401).json({ error: 'Authentication required' });
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'You do not have permission to perform this action' });
    }
    next();
  };
}

// Convenience groups used across routes
const ROLE_GROUPS = {
  management: ['super_admin', 'principal', 'admin'],
  staffAdmin: ['super_admin', 'principal', 'admin', 'accountant'],
  all: ['super_admin', 'principal', 'admin', 'accountant', 'teacher', 'staff', 'parent', 'student']
};

module.exports = { requireAuth, requireRole, ROLE_GROUPS };
