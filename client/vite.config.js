import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const brandId = process.env.SMS_BRAND || 'chand';
const brandDir = path.join(here, '..', 'brands', brandId);
const brand = JSON.parse(fs.readFileSync(path.join(brandDir, 'brand.json'), 'utf8'));

// Swaps the product name into index.html / the PWA manifest and, for a
// non-default brand, adds its logo and drops the CHAND wordmark from dist.
function brandPlugin() {
  let outDir;
  return {
    name: 'sms-brand',
    configResolved(config) { outDir = path.resolve(config.root, config.build.outDir); },
    transformIndexHtml(html) {
      return html
        .replace(/CHAND School Management System/g, brand.fullName)
        .replace(/CHAND School Management/g, brand.productName)
        .replace(/CHAND SMS/g, `${brand.shortName} SMS`);
    },
    closeBundle() {
      if (!outDir || !fs.existsSync(outDir)) return;
      const manifest = path.join(outDir, 'manifest.webmanifest');
      if (fs.existsSync(manifest)) {
        const m = JSON.parse(fs.readFileSync(manifest, 'utf8'));
        m.name = brand.fullName;
        m.short_name = `${brand.shortName} SMS`;
        fs.writeFileSync(manifest, JSON.stringify(m, null, 2));
      }
      const assets = path.join(brandDir, 'assets');
      if (fs.existsSync(assets)) fs.cpSync(assets, outDir, { recursive: true });
      if (brandId !== 'chand') fs.rmSync(path.join(outDir, 'chand-logo.png'), { force: true });
    }
  };
}

export default defineConfig({
  plugins: [react(), brandPlugin()],
  define: { __BRAND__: JSON.stringify(brand) },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3000',
      '/uploads': 'http://localhost:3000'
    }
  }
});
