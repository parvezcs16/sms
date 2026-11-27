import { fmtDate } from '../utils/dateDisplay';
import { useEffect, useState } from 'react';
import { startDayWatcher, useSchoolDayTick } from '../utils/schoolDay';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import ThemeToggle from './ThemeToggle';
import { useAuth } from '../context/AuthContext';
import { api } from '../api/client';
import { BrandMark } from './Brand';
import { BRAND } from '../brand';
import Avatar from './Avatar';
import SelfCheckIn from './SelfCheckIn';


// Menu. module: needs view access to that area (or any of a list);
// teacher: also shown to teachers (for their own classes); roles: only these
// roles; all: everyone signed in. A link with ?tab= opens that tab.
const NAV = [
  { section: 'Overview', items: [
    { to: '/', label: 'Dashboard', icon: '🏠', all: true }
  ] },
  { section: 'Academics', items: [
    { to: '/students', label: 'Students', icon: '🎓', module: 'students' },
    { to: '/admissions', label: 'Admissions', icon: '📝', module: 'admissions' },
    { to: '/teachers', label: 'Teachers', icon: '🧑‍🏫', module: 'teachers' },
    { to: '/staff', label: 'Non-Teaching Staff', icon: '🧑‍🔧', module: 'staff' },
    { to: '/academics', label: 'Classes & Sections', icon: '🏫', module: 'academics' },
    { to: '/academics?tab=Subjects', label: 'Subjects', icon: '📘', module: 'academics' },
    { to: '/timetable', label: 'Timetable', icon: '🗓️', module: 'timetable', teacher: true },
    { to: '/attendance', label: 'Attendance', icon: '✅', module: 'attendance', teacher: true },
    { to: '/homework', label: 'Homework & Syllabus', icon: '📒', module: 'homework', teacher: true }
  ] },
  { section: 'Examinations', items: [
    { to: '/results?tab=exams', label: 'Examinations', icon: '🧾', module: 'results', teacher: true },
    { to: '/exams', label: 'Question Bank & Papers', icon: '❓', module: 'exams' },
    { to: '/date-sheet', label: 'Date Sheet', icon: '📅', module: ['results', 'exams'], teacher: true },
    { to: '/results?tab=marks', label: 'Marks Entry', icon: '✍️', module: 'results', teacher: true },
    { to: '/results?tab=cards', label: 'Results & Report Cards', icon: '🏅', module: 'results', teacher: true },
    { to: '/certificates', label: 'Certificates', icon: '📜', module: 'certificates' }
  ] },
  { section: 'Finance', items: [
    { to: '/fees', label: 'Fees & Accounts', icon: '💳', module: 'fees' },
    { to: '/fees?tab=challans', label: 'Fee Challans & Receipts', icon: '🧾', module: 'fees' },
    { to: '/payroll', label: 'Payroll', icon: '💰', module: 'payroll' },
    { to: '/expenses', label: 'Daily Expenses', icon: '🧮', module: 'expenses' },
    { to: '/accounts', label: 'Accounting & Reports', icon: '📒', module: ['accounts', 'fees', 'expenses', 'payroll'] }
  ] },
  { section: 'Management', items: [
    { to: '/library', label: 'Library', icon: '📚', module: 'library' },
    { to: '/transport', label: 'Transport', icon: '🚌', module: 'transport' },
    { to: '/inventory', label: 'Inventory', icon: '📦', module: 'inventory' },
    { to: '/communication', label: 'Communication', icon: '📣', module: 'communication' },
    { to: '/events', label: 'Events & Calendar', icon: '🎉', all: true }
  ] },
  { section: 'Reports', items: [
    { to: '/reports?group=students', label: 'Student Reports', icon: '📊', module: 'reports' },
    { to: '/reports?group=attendance', label: 'Attendance Reports', icon: '📈', module: 'reports' },
    { to: '/reports?group=finance', label: 'Financial Reports', icon: '💹', module: 'reports' },
    { to: '/reports?group=academic', label: 'Academic Reports', icon: '🎯', module: 'reports' }
  ] },
  { section: 'My Family', items: [
    { to: '/parent-portal', label: 'My Children', icon: '👨‍👩‍👧', roles: ['parent'] }
  ] },
  { section: 'My Records', items: [
    { to: '/student-portal', label: 'My Records', icon: '📚', roles: ['student'] }
  ] },
  { section: 'System', items: [
    { to: '/users', label: 'User Management', icon: '🔐', module: 'users' },
    { to: '/roles', label: 'Roles & Permissions', icon: '🛡️', module: 'users' },
    { to: '/backup', label: 'Backup & Restore', icon: '💾', module: 'settings' },
    { to: '/settings', label: 'Settings', icon: '⚙️', module: 'settings' },
    { to: '/audit-logs', label: 'Audit Logs', icon: '🗂️', module: 'settings' },
    { to: '/profile', label: 'My Profile', icon: '👤', all: true },
    { to: '/support', label: 'Help & Support', icon: '🛟', all: true }
  ] }
];

// Menu: Dashboard is a standalone link at the top (no section heading). The
// other sections work as an accordion: opening one closes the one that was
// open, so only one section is expanded at a time (Academics by default).
// The choice is remembered on this PC, and the section holding the page you
// are on opens by itself so the highlighted entry is always visible.
const STANDALONE = ['Overview'];
const DEFAULT_OPEN = 'Academics';
const NAV_STATE_KEY = 'chand.nav.accordion';
function readNavState() {
  try { return JSON.parse(window.localStorage.getItem(NAV_STATE_KEY) || 'null'); } catch { return null; }
}
function writeNavState(state) {
  try { window.localStorage.setItem(NAV_STATE_KEY, JSON.stringify(state)); } catch { /* private mode */ }
}

// The menu entry for the current page: path + ?query / #hash match first,
// then the plain path, then a parent path (e.g. /students/12 -> Students).
function activeTo(location) {
  const items = NAV.flatMap((sec) => sec.items);
  const withExtra = [location.pathname + location.search + location.hash, location.pathname + location.search, location.pathname + location.hash];
  if (location.search || location.hash) {
    const exact = items.find((i) => withExtra.includes(i.to));
    if (exact) return exact.to;
  }
  const plain = items.find((i) => i.to === location.pathname);
  if (plain) return plain.to;
  const prefix = items.find((i) => i.to !== '/' && location.pathname.startsWith(`${i.to.split(/[?#]/)[0]}/`));
  return prefix ? prefix.to : null;
}

export default function AppShell({ children }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout, can } = useAuth();
  const [query, setQuery] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => { setMenuOpen(false); }, [location.pathname]);
  const [results, setResults] = useState(null);
  useEffect(() => startDayWatcher(), []);
  const dayTick = useSchoolDayTick();
  const [openSection, setOpenSection] = useState(() => { const s = readNavState(); return s === null ? DEFAULT_OPEN : s; });

  const visibleSections = NAV
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => {
        if (item.roles) return item.roles.includes(user.role);
        if (item.all) return true;
        const mods = Array.isArray(item.module) ? item.module : [item.module];
        return mods.some((m) => can(m, 'view')) || (item.teacher && Boolean(user.teacher_id));
      })
    }))
    .filter((section) => section.items.length > 0);

  async function runSearch(value) {
    setQuery(value);
    if (!value.trim()) return setResults(null);
    try {
      const data = await api.get(`/dashboard/search?q=${encodeURIComponent(value)}`);
      setResults(data);
    } catch {
      setResults(null);
    }
  }

  function goToResult(type, id) {
    setQuery(''); setResults(null);
    if (type === 'students') navigate(`/students/${id}`);
    if (type === 'teachers') navigate(`/teachers/${id}`);
    if (type === 'staff') navigate('/staff');
    if (type === 'invoices') navigate('/fees');
  }

  const current = activeTo(location);
  const currentItem = NAV.flatMap((sec) => sec.items).find((i) => i.to === current && i.to !== '/');
  const currentSection = NAV.find((sec) => sec.items.some((i) => i.to === current))?.section;
  const isOpen = (name) => STANDALONE.includes(name) || openSection === name;
  function toggleSection(name) {
    const next = openSection === name ? '' : name;
    setOpenSection(next);
    writeNavState(next);
  }
  useEffect(() => {
    // Opening a page from elsewhere (dashboard link, search) shows its section.
    if (currentSection && !isOpen(currentSection)) {
      setOpenSection(currentSection);
      writeNavState(currentSection);
    }
  }, [currentSection]); // eslint-disable-line react-hooks/exhaustive-deps

  const isMobileAttendance = location.pathname === '/attendance' && window.innerWidth < 700;

  return (
    <div className={`app-shell ${isMobileAttendance ? 'mobile-optimized' : ''}`}>
      <aside className="sidebar">
        <div className="sidebar-brand">
          <BrandMark size={38} />
          <div>
            <h1>{BRAND.shortName}</h1>
            <span className="brand-sub">{BRAND.tagline}</span>
          </div>
        </div>
        <nav>
          {visibleSections.map((section) => {
            const fixed = STANDALONE.includes(section.section);
            const open = isOpen(section.section);
            const hasCurrent = section.section === currentSection;
            return (
              <div key={section.section} className={`nav-group${open ? '' : ' collapsed'}${fixed ? ' nav-standalone' : ''}`}>
                {fixed ? null : (
                  <button type="button" className={`nav-section-toggle${hasCurrent && !open ? ' has-current' : ''}`} aria-expanded={open} onClick={() => toggleSection(section.section)}>
                    <span>{section.section}</span>
                    <span className="nav-count">{open ? '' : section.items.length}</span>
                    <span className="nav-chevron" aria-hidden="true">›</span>
                  </button>
                )}
                <div className="nav-items">
                  {section.items.map((item) => (
                    <Link key={item.to} to={item.to} className={current === item.to ? 'active' : ''}>
                      <span>{item.icon}</span> {item.label}
                    </Link>
                  ))}
                </div>
              </div>
            );
          })}
        </nav>
        <div className="sidebar-footer">Signed in as {user.role.replace('_', ' ')}{!user.is_management && user.permissions && Object.values(user.permissions).some((v) => v !== 'none') ? ' · custom access' : ''}</div>
      </aside>
      <div>
        <header className="topbar">
          <div className="topbar-search">
            <input placeholder="Search students, teachers, invoices…" value={query} onChange={(e) => runSearch(e.target.value)} />
            {results && (
              <div className="card" style={{ position: 'absolute', top: 42, left: 0, right: 0, zIndex: 30, maxHeight: 320, overflowY: 'auto' }}>
                {['students', 'teachers', 'staff', 'invoices'].map((type) => (
                  results[type]?.length > 0 && (
                    <div key={type}>
                      <div className="nav-section-label">{type}</div>
                      {results[type].map((r) => (
                        <div key={r.id} className="row" style={{ padding: '6px 4px', cursor: 'pointer' }} onClick={() => goToResult(type, r.id)}>
                          {r.full_name || r.invoice_number}
                        </div>
                      ))}
                    </div>
                  )
                ))}
                {Object.values(results).every((arr) => arr.length === 0) && <div className="muted">No matches</div>}
              </div>
            )}
          </div>
          <div className="topbar-right">
            <button type="button" className="topbar-refresh" title="Reload — fetch the latest data" aria-label="Reload" onClick={() => window.location.reload()}>⟳<span className="hide-mobile"> Refresh</span></button>
            <span className="topbar-date" title="Today">📅 {new Date().toLocaleDateString('en-GB', { weekday: 'short' })} {fmtDate(new Date())}</span>
            <ThemeToggle />
            <div className="user-menu">
              <button type="button" className="user-chip" aria-haspopup="menu" aria-expanded={menuOpen} onClick={() => setMenuOpen(!menuOpen)}>
                <Avatar photo={user.photo} name={user.full_name} size={36} />
                <span className="user-chip-text">
                  <b>{user.full_name}</b>
                  <small>{user.role.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}</small>
                </span>
                <span className="user-chip-caret" aria-hidden="true">▾</span>
              </button>
              {menuOpen && (
                <>
                  <div className="user-menu-backdrop" onClick={() => setMenuOpen(false)} />
                  <div className="user-menu-pop card" role="menu">
                    <Link to="/profile" role="menuitem">👤 My Profile</Link>
                    <Link to="/support" role="menuitem">🛟 Help &amp; Support</Link>
                    <button type="button" role="menuitem" onClick={logout}>⏻ Log out</button>
                  </div>
                </>
              )}
            </div>
          </div>
        </header>
        <main className="main-content">
          {location.pathname !== '/' && <SelfCheckIn compact />}
          {currentItem && typeof currentItem.module === 'string' && can(currentItem.module, 'view') && !can(currentItem.module, 'manage') && !(currentItem.teacher && user.teacher_id) && (
            <div className="view-only-banner">👁 You have <b>view-only</b> access to {currentItem.label}. Ask an Admin, Principal or Super Admin if you need to make changes.</div>
          )}
          <div key={location.pathname === '/' ? `day-${dayTick}` : 'page'}>{children}</div>
        </main>
      </div>
    </div>
  );
}
