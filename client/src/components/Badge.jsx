const VARIANT_MAP = {
  Active: 'success', Present: 'success', Paid: 'success', Approved: 'success', Sent: 'success',
  Inactive: 'muted', Archived: 'muted', Draft: 'muted',
  Pending: 'warning', Partial: 'warning', Late: 'warning', Leave: 'warning', simulated: 'warning',
  Absent: 'danger', Overdue: 'danger', Rejected: 'danger', failed: 'danger',
  Relieved: 'danger', Cancelled: 'muted', Voided: 'muted', Deleted: 'muted'
};

export default function Badge({ children, variant }) {
  const resolved = variant || VARIANT_MAP[children] || 'muted';
  return <span className={`badge badge-${resolved}`}>{children}</span>;
}
