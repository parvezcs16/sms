// Product branding, chosen at build time (SMS_BRAND=<id>, see brands/<id>/brand.json
// and client/vite.config.js). The default build is CHAND.
/* global __BRAND__ */
export const BRAND = typeof __BRAND__ !== 'undefined' ? __BRAND__ : {
  id: 'chand',
  name: 'CHAND',
  shortName: 'CHAND',
  tagline: 'School Management',
  productName: 'CHAND School Management',
  fullName: 'CHAND School Management System',
  phone: '',
  supportPhone: '0300 0000000',
  supportWhatsapp: '0300 0000000',
  supportEmail: 'support@example.com',
  supportHours: 'Mon - Sat, 9:00 AM - 6:00 PM',
  fileSlug: 'CHAND-School-Management',
  logo: 'chand-logo.png'
};
