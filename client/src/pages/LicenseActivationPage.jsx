import { useState } from 'react';
import { useLicense } from '../context/LicenseContext';
import { BrandLogo, BrandSupport } from '../components/Brand';

function formatKeyInput(value) {
  const cleaned = value.toUpperCase().replace(/[^0-9A-Z]/g, '').slice(0, 16);
  return cleaned.match(/.{1,4}/g)?.join('-') || cleaned;
}

export default function LicenseActivationPage() {
  const { status, activate } = useLicense();
  const [key, setKey] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  const deviceId = status?.deviceId || '';

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await activate(key);
    } catch (err) {
      setError(err.message || 'Activation failed');
    } finally {
      setLoading(false);
    }
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(deviceId);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard access can fail silently in some environments — the ID is still selectable text
    }
  }

  return (
    <div className="login-shell">
      <div className="card login-card">
        <div style={{ textAlign: 'center', marginBottom: 8 }}>
          <BrandLogo width={220} />
        </div>
        <p>This computer needs a license key to activate.</p>

        <div className="field">
          <label>Step 1 — Send us this computer's Device ID</label>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input
              value={deviceId}
              readOnly
              style={{ letterSpacing: '2px', fontFamily: 'monospace', textAlign: 'center' }}
            />
            <button type="button" onClick={handleCopy} style={{ whiteSpace: 'nowrap' }}>
              {copied ? 'Copied!' : 'Copy'}
            </button>
          </div>
          <p className="muted" style={{ marginTop: 6 }}>
            Share this code with your reseller/support (WhatsApp, phone, or email) — they'll send back a license
            key that only works on this computer.
          </p>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="field">
            <label>Step 2 — Enter the license key you received</label>
            <input
              value={key}
              onChange={(e) => setKey(formatKeyInput(e.target.value))}
              placeholder="XXXX-XXXX-XXXX-XXXX"
              autoFocus
              required
              style={{ letterSpacing: '2px', fontFamily: 'monospace', textAlign: 'center' }}
            />
          </div>
          {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}
          <button type="submit" disabled={loading} style={{ width: '100%' }}>
            {loading ? 'Activating…' : 'Activate'}
          </button>
        </form>
        <BrandSupport />
      </div>
    </div>
  );
}
