import { Link } from 'react-router-dom';

export default function NotFoundPage() {
  return (
    <div className="card">
      <h2>Page not found</h2>
      <p>The page you're looking for doesn't exist or you don't have access to it.</p>
      <Link to="/" className="btn">Back to Dashboard</Link>
    </div>
  );
}
