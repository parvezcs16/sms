// Who did something, for payment / approval trails: the user's full name and a
// designation to print beside it (e.g. "Ayesha Khan — Principal").
const ROLE_TITLES = {
  super_admin: 'Super Admin',
  principal: 'Principal',
  admin: 'Administrator',
  accountant: 'Accountant',
  teacher: 'Teacher',
  staff: 'Staff',
  parent: 'Parent',
  student: 'Student'
};

function userDesignation(db, userId) {
  const u = db.prepare('SELECT u.id, u.full_name, r.name AS role, u.designation FROM users u LEFT JOIN roles r ON r.id = u.role_id WHERE u.id = ?').get(userId);
  if (!u) return { name: 'Unknown', designation: '' };
  let designation = u.designation;
  if (!designation) {
    const t = db.prepare('SELECT designation FROM teachers WHERE user_id = ?').get(u.id);
    if (t && t.designation) designation = t.designation;
  }
  if (!designation) {
    try {
      const s = db.prepare('SELECT sc.name FROM staff st JOIN staff_categories sc ON sc.id = st.category_id WHERE st.user_id = ?').get(u.id);
      if (s && s.name) designation = s.name;
    } catch { /* staff tables missing on a very old database */ }
  }
  return { name: u.full_name, designation: designation || ROLE_TITLES[u.role] || u.role };
}

// "YYYY-MM-DD HH:MM:SS" in the school server's local time.
function localDateTimeStr(d = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

const PAYMENT_MODES = ['Cash', 'Online Transfer', 'Bank Deposit', 'Cheque', 'Card', 'Other'];

module.exports = { userDesignation, localDateTimeStr, ROLE_TITLES, PAYMENT_MODES };
