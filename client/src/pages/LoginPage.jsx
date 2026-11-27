import { useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { BrandLogo, BrandSupport } from '../components/Brand';

function safeTarget(value) {
  // Only ever redirect within this app.
  return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//') && !value.startsWith('/login') ? value : '/';
}

export default function LoginPage() {
  const { user, login } = useAuth();
  const location = useLocation();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const next = safeTarget(location.state?.from || new URLSearchParams(location.search).get('next'));
  if (user) return <Navigate to={next} replace />;

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(username, password);
    } catch (err) {
      setError(err.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-shell">
      <div className="card login-card">
        <div style={{ textAlign: 'center', marginBottom: 8 }}>
          <BrandLogo width={240} />
        </div>
        <p style={{ textAlign: 'center' }}>
          {next === '/attendance' ? 'Sign in to mark attendance.' : 'Sign in to manage your school.'}
        </p>
        <form onSubmit={handleSubmit}>
          <div className="field">
            <label>Username</label>
            <input value={username} onChange={(e) => setUsername(e.target.value)} autoFocus required autoCapitalize="none" autoCorrect="off" />
          </div>
          <div className="field">
            <label>Password</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </div>
          {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}
          <button type="submit" disabled={loading} style={{ width: '100%' }}>{loading ? 'Signing in…' : 'Sign in'}</button>
        </form>
        <BrandSupport />
      </div>
    </div>
  );
}
