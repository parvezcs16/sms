const express = require('express');
const { requireLicense } = require('../middleware/license');

const router = express.Router();

router.use('/license', require('./license'));

// Google sends the browser back here after the school signs in to connect
// Google Drive backups (no app login on this request — it is checked by the
// one-time "state" value instead).
router.get('/gdrive/callback', async (req, res) => {
  const page = (title, msg) => `<!doctype html><meta charset="utf-8"><title>${title}</title><body style="font-family:Segoe UI,Arial;padding:40px;max-width:560px;margin:auto"><h2>${title}</h2><p>${msg}</p><p>You can close this tab and go back to CHAND School Management.</p></body>`;
  const esc = (t) => String(t).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
  try {
    const { account } = await require('../services/cloudBackup').handleCallback(req.query);
    res.send(page('Google Drive connected ✔', `Backups will be saved to ${account ? `<b>${esc(account)}</b>` : 'your Google account'} automatically. The first backup has started.`));
  } catch (err) {
    res.status(400).send(page('Could not connect Google Drive', esc(err.message)));
  }
});
router.use(requireLicense);

router.use('/auth', require('./auth'));
router.use('/users', require('./users'));
router.use('/academics', require('./academics'));
router.use('/teachers', require('./teachers'));
router.use('/staff', require('./staff'));
router.use('/expenses', require('./expenses'));
router.use('/students', require('./students'));
router.use('/parents', require('./parents'));
router.use('/timetable', require('./timetable'));
router.use('/attendance', require('./attendance'));
router.use('/exams', require('./exams'));
router.use('/results', require('./results'));
router.use('/admissions', require('./admissions'));
router.use('/homework', require('./homework'));
router.use('/datesheet', require('./datesheet'));
router.use('/library', require('./library'));
router.use('/transport', require('./transport'));
router.use('/inventory', require('./inventory'));
router.use('/events', require('./events'));
router.use('/accounts', require('./accounts'));
router.use('/fees', require('./fees'));
router.use('/payroll', require('./payroll'));
router.use('/notifications', require('./notifications'));
router.use('/reports', require('./reports'));
router.use('/dashboard', require('./dashboard'));
router.use('/certificates', require('./certificates'));
router.use('/settings', require('./settings'));
router.use('/history', require('./history'));

module.exports = router;
