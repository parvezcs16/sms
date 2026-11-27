import { BrandLogo, BrandSupport } from '../components/Brand';

const COPY = {
  hardware_mismatch: 'This installation no longer matches the licensed computer.',
  status_check_failed: "Could not verify this installation's license."
};

export default function LicenseLockedPage({ reason }) {
  return (
    <div className="login-shell">
      <div className="card login-card">
        <div style={{ textAlign: 'center', marginBottom: 8 }}>
          <BrandLogo width={220} />
        </div>
        <h2 style={{ color: 'var(--text)' }}>Application Locked</h2>
        <p style={{ color: 'var(--danger)' }}>{COPY[reason] || COPY.status_check_failed}</p>
        <p className="muted">Please contact support to resolve this.</p>
        <BrandSupport />
      </div>
    </div>
  );
}
