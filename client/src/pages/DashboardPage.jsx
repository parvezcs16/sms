import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import StatCard from '../components/StatCard';
import Badge from '../components/Badge';
import LanAccessCard from '../components/LanAccessCard';
import SelfCheckIn from '../components/SelfCheckIn';
import UpcomingPanel from '../components/UpcomingPanel';
import FinanceSummary from '../components/FinanceSummary';
import DashboardHero from '../components/DashboardHero';
import OutstandingModal from '../components/OutstandingModal';
import DashIcon from '../components/DashIcons';

const num = (n) => Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 0 });
const pct = (part, whole) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0);
const trendPct = (now, before) => (before > 0 ? Math.round(((now - before) / before) * 100) : null);
const short = (n) => {
  const v = Math.abs(Number(n || 0));
  if (v >= 1e7) return `${(n / 1e7).toFixed(1).replace(/\.0$/, '')}Cr`;
  if (v >= 1e5) return `${(n / 1e5).toFixed(1).replace(/\.0$/, '')}L`;
  if (v >= 1e3) return `${(n / 1e3).toFixed(0)}k`;
  return String(Math.round(n || 0));
};
// Server timestamps are UTC "YYYY-MM-DD HH:MM:SS".
const parseAt = (at) => new Date(/[TZ]/.test(at) ? at : `${String(at).replace(' ', 'T')}Z`);
function when(at) {
  const d = parseAt(at);
  if (Number.isNaN(d.getTime())) return '';
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const today = new Date();
  const yest = new Date(); yest.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return `Today ${time}`;
  if (d.toDateString() === yest.toDateString()) return `Yesterday ${time}`;
  return `${d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} ${time}`;
}

function Panel({ icon, title, action, children, className = '' }) {
  return (
    <div className={`card dash-panel ${className}`}>
      <div className="dash-panel-head">
        <span className="dash-panel-icon"><DashIcon name={icon} size={20} /></span>
        <h3>{title}</h3>
        <span className="spacer" />
        {action}
      </div>
      {children}
    </div>
  );
}

// ---- Attendance donut ----
const ATT = [['Present', '#1f9d63'], ['Absent', '#d9465f'], ['Late', '#e8922b'], ['Leave', '#3d7be0']];
function AttendanceDonut({ counts, total }) {
  const r = 52; const c = 2 * Math.PI * r;
  let offset = 0;
  const marked = ATT.reduce((s, [k]) => s + (counts[k] || 0), 0);
  return (
    <div className="att-donut-wrap">
      <svg viewBox="0 0 140 140" className="att-donut" role="img" aria-label={`${pct(counts.Present, marked)}% present`}>
        <circle cx="70" cy="70" r={r} fill="none" stroke="var(--border)" strokeWidth="18" />
        {marked > 0 && ATT.map(([k, color]) => {
          const len = ((counts[k] || 0) / marked) * c;
          const el = <circle key={k} cx="70" cy="70" r={r} fill="none" stroke={color} strokeWidth="18" strokeDasharray={`${len} ${c - len}`} strokeDashoffset={-offset} transform="rotate(-90 70 70)" />;
          offset += len;
          return el;
        })}
        <text x="70" y="68" textAnchor="middle" className="att-donut-big">{marked ? `${pct(counts.Present, marked)}%` : '—'}</text>
        <text x="70" y="88" textAnchor="middle" className="att-donut-small">{marked ? 'Present' : 'Not marked'}</text>
      </svg>
      <div className="att-legend">
        {ATT.map(([k, color]) => (
          <div key={k}><span className="dot" style={{ background: color }} />{k}<b>{num(counts[k])}</b></div>
        ))}
        <div className="muted" style={{ fontSize: '0.75rem', marginTop: 4 }}>{num(marked)} of {num(total)} students marked today</div>
      </div>
    </div>
  );
}

// ---- Monthly overview line chart ----
function MonthlyChart({ months }) {
  const W = 380; const H = 210; const L = 40; const B = 26; const T = 12; const Rp = 12;
  const outOf = (m) => m.expenses + m.salaries;
  const maxV = Math.max(1, ...months.map((m) => Math.max(m.fees, outOf(m))));
  const step = 10 ** Math.floor(Math.log10(maxV));
  const top = Math.ceil(maxV / step) * step;
  const x = (i) => L + (i * (W - L - Rp)) / Math.max(1, months.length - 1);
  const y = (v) => T + (1 - v / top) * (H - T - B);
  const line = (key) => months.map((m, i) => `${i ? 'L' : 'M'}${x(i)},${y(key(m))}`).join(' ');
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => top * f);
  const label = (ym) => new Date(`${ym}-01T00:00:00`).toLocaleDateString(undefined, { month: 'short' });
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="month-chart" role="img" aria-label="Fees collected and money spent, last 6 months">
      {ticks.map((t) => (
        <g key={t}>
          <line x1={L} x2={W - Rp} y1={y(t)} y2={y(t)} stroke="var(--border)" />
          <text x={L - 6} y={y(t) + 4} textAnchor="end" className="chart-axis">{short(t)}</text>
        </g>
      ))}
      {months.map((m, i) => <text key={m.month} x={x(i)} y={H - 6} textAnchor="middle" className="chart-axis">{label(m.month)}</text>)}
      <path d={line((m) => m.fees)} fill="none" stroke="#2f6fe4" strokeWidth="2.5" />
      <path d={line(outOf)} fill="none" stroke="#ef8a2f" strokeWidth="2.5" />
      {months.map((m, i) => (
        <g key={m.month}>
          <circle cx={x(i)} cy={y(m.fees)} r="4" fill="#2f6fe4"><title>{label(m.month)} fees: {num(m.fees)}</title></circle>
          <circle cx={x(i)} cy={y(outOf(m))} r="4" fill="#ef8a2f"><title>{label(m.month)} expenses + salaries: {num(outOf(m))}</title></circle>
        </g>
      ))}
    </svg>
  );
}

const ACTIVITY = {
  fee: { icon: 'money', cls: 'act-fee', text: (a) => <>Fee received from <b>{a.name}</b>{a.class_label ? ` (${a.class_label})` : ''}</> },
  student: { icon: 'userPlus', cls: 'act-student', text: (a) => <>New student registered: <b>{a.name}</b>{a.class_label ? ` (${a.class_label})` : ''}</> },
  attendance: { icon: 'check', cls: 'act-att', text: (a) => <>Attendance marked <b>({a.class_label})</b> · {a.amount} students</> },
  expense: { icon: 'expense', cls: 'act-exp', text: (a) => <>Expense recorded: <b>{a.name}</b>{a.class_label && a.class_label !== a.name ? ` · ${a.class_label}` : ''}</> }
};

const QUICK = [
  { to: '/students', label: 'Add Student', icon: 'userPlus', module: 'students', tone: 'q1' },
  { to: '/attendance', label: 'Take Attendance', icon: 'check', module: 'attendance', tone: 'q2' },
  { to: '/fees?tab=challans', label: 'Fee Challans', icon: 'receipt', module: 'fees', tone: 'q3' },
  { to: '/results?tab=marks', label: 'Enter Marks', icon: 'pen', module: 'results', tone: 'q4' },
  { to: '/expenses', label: 'Add Expense', icon: 'expense', module: 'expenses', tone: 'q5' },
  { to: '/communication', label: 'Send Notice', icon: 'megaphone', module: 'communication', tone: 'q6' },
  { to: '/reports', label: 'Print Reports', icon: 'printer', module: 'reports', tone: 'q7' },
  { to: '/backup', label: 'Backup Data', icon: 'database', module: 'settings', tone: 'q8' }
];

function QuickActions() {
  const { can } = useAuth();
  const items = QUICK.filter((q) => can(q.module, 'view')).slice(0, 6);
  if (!items.length) return null;
  return (
    <Panel icon="rocket" title="Quick Actions">
      <div className="quick-grid">
        {items.map((q) => (
          <Link key={q.to} to={q.to} className={`quick-btn ${q.tone}`}>
            <span className="quick-icon"><DashIcon name={q.icon} size={24} /></span>
            <span>{q.label}</span>
          </Link>
        ))}
      </div>
    </Panel>
  );
}

function AdminDashboard({ currency }) {
  const [data, setData] = useState(null);
  const [showOutstanding, setShowOutstanding] = useState(false);
  useEffect(() => { api.get('/dashboard/admin').then(setData).catch(() => {}); }, []);
  if (!data) return <p className="muted">Loading dashboard…</p>;

  const money = (n) => `${currency ? `${currency} ` : ''}${num(n)}`;
  const att = data.attendanceToday || {};
  const marked = data.markedToday || 0;
  const target = Math.max(data.feeBilledMonth || 0, data.feeCollectionMonth || 0);
  const collectedPct = target > 0 ? Math.min(100, Math.round((data.feeCollectionMonth / target) * 100)) : 0;
  const feeTrend = trendPct(data.feeCollectionMonth, data.feeCollectionLastMonthToDate);
  const showFees = data.feeCollectionMonth != null;

  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="kpi-grid">
        <StatCard tone="students" icon="students" label="Total Students" value={num(data.studentCount)} sub="active on roll" />
        <StatCard tone="teachers" icon="teacher" label="Total Teachers" value={num(data.teacherCount)} sub={data.pendingLeaves ? `${data.pendingLeaves} leave request${data.pendingLeaves === 1 ? '' : 's'} pending` : 'teaching staff'} />
        <StatCard tone="staff" icon="staff" label="Non-Teaching Staff" value={num(data.staffCount)} sub="support staff" />
        <StatCard tone="classes" icon="classes" label="Total Classes" value={num(data.classCount)} sub={`${num(data.sectionCount)} section${data.sectionCount === 1 ? '' : 's'}`} />
        <StatCard tone="present" icon="present" label="Today Present" value={num(att.Present)} sub={marked ? `${pct(att.Present, marked)}% of marked` : 'not marked yet'} />
        <StatCard tone="absent" icon="absent" label="Today Absent" value={num(att.Absent)} sub={marked ? `${pct(att.Absent, marked)}%${att.Late || att.Leave ? ` · ${att.Late || 0} late · ${att.Leave || 0} leave` : ''}` : 'not marked yet'} />
        {showFees && <StatCard tone="fees" icon="wallet" label="Collected This Month" value={money(data.feeCollectionMonth)} trend={feeTrend} sub={feeTrend == null ? `Today ${money(data.feeCollectionToday)}` : ' vs last month'} />}
        {showFees && <StatCard tone="outstanding" icon="alert" label="Outstanding Fees" value={money(data.pendingDues)} sub={`${num(data.pendingStudents)} student${data.pendingStudents === 1 ? '' : 's'} · tap for class-wise`}
          onClick={() => setShowOutstanding(true)} hint="Show class-wise outstanding" />}
      </div>

      <div className="dash-row three">
        <Panel icon="chart" title="Attendance Overview" action={<Link to="/attendance" className="dash-link">Open →</Link>}>
          <AttendanceDonut counts={att} total={data.studentCount} />
        </Panel>
        {showFees && <Panel icon="wallet" title="Fee Collection" action={<span className="dash-chip">This month</span>}>
          <div className="fee-big">{money(data.feeCollectionMonth)}</div>
          <div className="muted">of {money(target)} billed for this month</div>
          <div className="fee-progress"><span style={{ width: `${collectedPct}%` }} /></div>
          <div className="row" style={{ justifyContent: 'space-between', margin: 0 }}>
            <span>{feeTrend == null ? <span className="muted">Today: {money(data.feeCollectionToday)}</span>
              : <span className={feeTrend >= 0 ? 'trend-up' : 'trend-down'}>{feeTrend >= 0 ? '▲' : '▼'} {Math.abs(feeTrend)}% than last month</span>}</span>
            <b>{collectedPct}%</b>
          </div>
          <button type="button" className="btn-ghost btn-sm" style={{ marginTop: 10, paddingLeft: 0 }} onClick={() => setShowOutstanding(true)}>
            Outstanding {money(data.pendingDues)} — class-wise breakdown →
          </button>
        </Panel>}
        <Panel icon="calendar" title="Upcoming Exams" action={<Link to="/date-sheet" className="dash-link">View All →</Link>}>
          {data.upcomingExams.length === 0 ? <p className="muted">No upcoming exams on the date sheet.</p> : (
            <div className="exam-list">
              {data.upcomingExams.map((e) => {
                const d = new Date(`${e.scheduled_date}T00:00:00`);
                return (
                  <div key={e.id} className="exam-item">
                    <span className="exam-date"><small>{d.toLocaleDateString(undefined, { month: 'short' }).toUpperCase()}</small><b>{d.getDate()}</b></span>
                    <span><b>{e.title || e.subject_name}</b><span className="muted">{e.class_name ? `Class ${e.class_name}` : ''}{e.start_time ? ` · ${e.start_time}` : ''}</span></span>
                  </div>
                );
              })}
            </div>
          )}
        </Panel>
      </div>

      <div className="dash-row three">
        {data.monthly.length > 0 && <Panel icon="chart" title="Monthly Overview" action={<span className="dash-chip">6 months</span>}>
          <MonthlyChart months={data.monthly} />
          <span className="chart-legend" style={{ justifyContent: 'center', marginTop: 6 }}><span><i style={{ background: '#2f6fe4' }} />Fees collected</span><span><i style={{ background: '#ef8a2f' }} />Expenses + Salaries</span></span>
        </Panel>}
        <Panel icon="bolt" title="Recent Activities">
          {data.recentActivities.length === 0 ? <p className="muted">Nothing recorded yet.</p> : (
            <div className="act-list">
              {data.recentActivities.map((a) => {
                const meta = ACTIVITY[a.kind];
                return (
                  <div key={`${a.kind}-${a.id}-${a.at}`} className="act-item">
                    <span className={`act-icon ${meta.cls}`}><DashIcon name={meta.icon} size={16} /></span>
                    <span className="act-text">{meta.text(a)}</span>
                    <span className="act-meta">{(a.kind === 'fee' || a.kind === 'expense') && <b>{money(a.amount)}</b>}<small>{when(a.at)}</small></span>
                  </div>
                );
              })}
            </div>
          )}
        </Panel>
        <QuickActions />
      </div>

      {data.recentNotifications.length > 0 && (
        <Panel icon="megaphone" title="Recent Notices" action={<Link to="/communication" className="dash-link">All →</Link>}>
          <div className="stack" style={{ gap: 6 }}>
            {data.recentNotifications.map((n) => (
              <div key={n.id} className="row" style={{ margin: 0 }}><Badge>{n.category}</Badge><span>{n.title}</span></div>
            ))}
          </div>
        </Panel>
      )}

      {showFees && <FinanceSummary />}
      <LanAccessCard compact />
      {showOutstanding && <OutstandingModal currency={currency} onClose={() => setShowOutstanding(false)} />}
    </div>
  );
}

function TeacherDashboard() {
  const [data, setData] = useState(null);
  useEffect(() => { api.get('/dashboard/teacher').then(setData).catch(() => {}); }, []);
  if (!data) return <p className="muted">Loading dashboard…</p>;
  const status = data.myAttendanceStatus;

  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="kpi-grid">
        <StatCard tone="students" icon="calendar" label="Classes Today" value={data.todaysClasses.length} sub="on your timetable" />
        <StatCard tone="teachers" icon="book" label="Subjects Assigned" value={data.assignedSubjects.length} sub={data.assignedSubjects.map((s) => s.subject_name).slice(0, 3).join(', ') || '—'} />
        <StatCard tone="staff" icon="pen" label="Questions Authored" value={data.questionCount} sub="in the question bank" />
        <StatCard tone={status === 'Present' ? 'present' : status === 'Absent' ? 'absent' : 'classes'} icon="clock" label="My Attendance" value={status} sub="today" />
      </div>
      <div className="card">
        <div className="page-header"><h3>Today's Classes</h3><Link to="/attendance" className="btn btn-sm">Mark Attendance</Link></div>
        {data.todaysClasses.length === 0 ? <p className="muted">No classes scheduled today.</p> : (
          <table>
            <thead><tr><th>Period</th><th>Class</th><th>Subject</th><th>Room</th></tr></thead>
            <tbody>
              {data.todaysClasses.map((c) => (
                <tr key={c.id}><td>{c.period_name} ({c.start_time})</td><td>{c.class_name} - {c.section_name}</td><td>{c.subject_name}</td><td>{c.room_name || '-'}</td></tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <QuickActions />
    </div>
  );
}

function AccountantDashboard({ currency }) {
  const [data, setData] = useState(null);
  const [showOutstanding, setShowOutstanding] = useState(false);
  useEffect(() => { api.get('/dashboard/accountant').then(setData).catch(() => {}); }, []);
  if (!data) return <p className="muted">Loading dashboard…</p>;
  const money = (n) => `${currency ? `${currency} ` : ''}${num(n)}`;

  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="kpi-grid">
        <StatCard tone="fees" icon="wallet" label="Collected Today" value={money(data.feeCollectionToday)} sub="fee payments" />
        <StatCard tone="present" icon="money" label="Collected This Month" value={money(data.feeCollectionMonth)} sub={`Expenses ${money(data.expensesMonth)}`} />
        <StatCard tone="outstanding" icon="alert" label="Outstanding Fees" value={money(data.pendingFeesTotal)} sub={`${data.pendingFeesCount} invoices · tap for class-wise`}
          onClick={() => setShowOutstanding(true)} hint="Show class-wise outstanding" />
        <StatCard tone="staff" icon="receipt" label="Payroll This Month" value={money(data.payrollThisMonth.total)} sub={`${data.payrollThisMonth.c} salary slips`} />
      </div>
      <FinanceSummary />
      <QuickActions />
      {showOutstanding && <OutstandingModal currency={currency} onClose={() => setShowOutstanding(false)} />}
    </div>
  );
}

function ParentOrStudentDashboard() {
  return (
    <div className="card">
      <h3>Welcome</h3>
      <p>Use the navigation on the left to view attendance, fees and school notices.</p>
    </div>
  );
}

const AREA_LINKS = [
  ['students', '/students', 'Students'], ['teachers', '/teachers', 'Teachers'], ['staff', '/staff', 'Non-Teaching Staff'],
  ['academics', '/academics', 'Classes & Subjects'], ['timetable', '/timetable', 'Timetable'], ['attendance', '/attendance', 'Attendance'],
  ['exams', '/exams', 'Question Bank & Papers'], ['results', '/results', 'Marks & Results'], ['fees', '/fees', 'Fees & Accounts'], ['payroll', '/payroll', 'Payroll'],
  ['expenses', '/expenses', 'Daily Expenses'], ['communication', '/communication', 'Communication'], ['reports', '/reports', 'Reports'],
  ['users', '/users', 'User Accounts'], ['settings', '/settings', 'Settings & Backup']
];

// For roles without their own dashboard (e.g. a staff login given a few areas).
function MyAreas() {
  const { can } = useAuth();
  const mine = AREA_LINKS.filter(([m]) => can(m, 'view'));
  return (
    <div className="card">
      <h3>Your areas</h3>
      {mine.length === 0 ? (
        <p className="muted">You haven't been given access to any area yet. Ask an Admin, Principal or Super Admin.</p>
      ) : (
        <div className="row">
          {mine.map(([m, to, label]) => (
            <Link key={m} to={to} className="btn-secondary" style={{ padding: '10px 16px', borderRadius: 8 }}>
              {label}{!can(m, 'manage') && ' (view)'}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

export default function DashboardPage() {
  const { user, can } = useAuth();
  const [settings, setSettings] = useState(null);
  useEffect(() => { api.get('/settings').then(setSettings).catch(() => setSettings({})); }, []);
  const currency = (settings && settings.currency) || '';
  const hasOwnDashboard = ['super_admin', 'principal', 'admin', 'teacher', 'accountant', 'parent', 'student'].includes(user.role);
  return (
    <div>
      <DashboardHero settings={settings} />
      <SelfCheckIn />
      <UpcomingPanel />
      {['super_admin', 'principal', 'admin'].includes(user.role) && <AdminDashboard currency={currency} />}
      {user.role === 'teacher' && <TeacherDashboard />}
      {user.role === 'accountant' && <AccountantDashboard currency={currency} />}
      {['parent', 'student'].includes(user.role) && <ParentOrStudentDashboard />}
      {!hasOwnDashboard && <MyAreas />}
      {!hasOwnDashboard && ['fees', 'payroll', 'expenses'].some((m) => can(m, 'view')) && <FinanceSummary />}
    </div>
  );
}
