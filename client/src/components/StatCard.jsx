import DashIcon from './DashIcons';

// Plain tile by default. With `tone` it becomes a coloured KPI tile (each tone
// is a dark-to-light gradient, see .kpi-* in styles.css); `onClick` makes the
// whole tile a button (e.g. Outstanding opens its class-wise breakdown).
export default function StatCard({ label, value, sub, tone, icon, trend, onClick, hint }) {
  if (!tone) {
    return (
      <div className="card stat-tile">
        <span className="stat-label">{label}</span>
        <span className="stat-value">{value}</span>
        {sub ? <span className="stat-sub">{sub}</span> : null}
      </div>
    );
  }
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag type={onClick ? 'button' : undefined} className={`kpi kpi-${tone}${onClick ? ' kpi-click' : ''}`} onClick={onClick} title={hint}>
      {icon && <span className="kpi-icon"><DashIcon name={icon} size={26} /></span>}
      <span className="kpi-body">
        <span className="kpi-label">{label}</span>
        <span className="kpi-value">{value}</span>
        {(sub || trend) && (
          <span className="kpi-sub">
            {trend != null && <b className={trend >= 0 ? 'up' : 'down'}>{trend >= 0 ? '▲' : '▼'} {Math.abs(trend)}%</b>}
            {sub}
          </span>
        )}
      </span>
      {onClick && <span className="kpi-more" aria-hidden="true">›</span>}
    </Tag>
  );
}
