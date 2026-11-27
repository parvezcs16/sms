// Shows an uploaded photo, or the person's initial when there isn't one.
export default function Avatar({ photo, name = '', size = 36 }) {
  const style = { width: size, height: size, fontSize: Math.max(12, size * 0.4) };
  if (photo) {
    return <img className="avatar" src={`/uploads/${encodeURIComponent(photo)}`} alt={name} style={style} />;
  }
  return <span className="avatar avatar-fallback" style={style}>{(name || '?').trim().charAt(0).toUpperCase()}</span>;
}
