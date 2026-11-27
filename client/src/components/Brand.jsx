import { BRAND } from '../brand';

export function BrandMark({ size = 34 }) {
  return (
    <span className="brand-mark" style={{ width: size, height: size }}>
      <img src="/chand-emblem.png" alt="" />
    </span>
  );
}

export function BrandLogo({ width = 260 }) {
  return <img className="brand-logo" src={`/${BRAND.logo}`} alt={BRAND.fullName} style={{ width, maxWidth: '100%' }} />;
}

// Vendor support line (only for brands that set a phone number).
export function BrandSupport({ style }) {
  if (!BRAND.phone) return null;
  return (
    <p className="muted" style={{ textAlign: 'center', fontSize: '0.85rem', margin: '14px 0 0', ...style }}>
      {BRAND.name} · Support: <a href={`tel:${BRAND.phone.replace(/\s+/g, '')}`}>{BRAND.phone}</a>
    </p>
  );
}
