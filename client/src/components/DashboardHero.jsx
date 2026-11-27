import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { BRAND } from '../brand';
import { shortSchoolName } from '../utils/schoolName';
import { fmtDate } from '../utils/dateDisplay';

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

// Dashboard banner: school logo + school name (shortened when long) on the
// left, the school picture from Settings → School Branding on the right.
export default function DashboardHero({ settings }) {
  const { user, can } = useAuth();
  const fullName = (settings && settings.school_name) || BRAND.fullName;
  const shown = shortSchoolName(fullName);
  const logo = settings && settings.school_logo ? `/uploads/${encodeURIComponent(settings.school_logo)}` : '/chand-emblem.png';
  const picture = settings && settings.school_picture ? `/uploads/${encodeURIComponent(settings.school_picture)}` : '';
  const today = `${new Date().toLocaleDateString('en-GB', { weekday: 'long' })}, ${fmtDate(new Date())}`;

  return (
    <section className={`dash-hero${picture ? ' has-picture' : ''}`}>
      <div className="dash-hero-main">
        <span className="dash-hero-logo"><img src={logo} alt="" /></span>
        <div style={{ minWidth: 0 }}>
          <h2 className="dash-hero-name" title={fullName} style={settings && /^#[0-9a-f]{6}$/i.test(settings.school_name_color || '') ? { color: settings.school_name_color } : undefined}>{shown}</h2>
          {shown !== fullName && <div className="dash-hero-full">{fullName}</div>}
          <p className="dash-hero-sub">{greeting()}, {user.full_name.split(' ')[0]} · {today}</p>
        </div>
      </div>
      {picture ? (
        <div className="dash-hero-picture" style={{ backgroundImage: `url("${picture}")` }} role="img" aria-label={`${fullName} picture`} />
      ) : can('settings', 'manage') ? (
        <Link to="/settings" className="dash-hero-add">＋ Add school picture</Link>
      ) : null}
    </section>
  );
}
