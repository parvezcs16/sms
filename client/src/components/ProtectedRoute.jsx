import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

// roles: only these roles (used for the parent / student portals)
// module: needs at least view access to this area (or any of an array)
// allow: extra custom check, e.g. teachers marking their own classes
export default function ProtectedRoute({ roles, module, allow, children }) {
  const { user, loading, can } = useAuth();
  const location = useLocation();
  if (loading) return <div className="login-shell"><span className="muted">Loading…</span></div>;
  // Remember where the user was heading (e.g. /attendance from the phone QR
  // code) so login can send them straight back there.
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  if (roles && !roles.includes(user.role)) return <Navigate to="/" replace />;
  if (module) {
    const list = Array.isArray(module) ? module : [module];
    const ok = list.some((m) => can(m, 'view')) || (allow && allow(user));
    if (!ok) return <Navigate to="/" replace />;
  }
  return children;
}
