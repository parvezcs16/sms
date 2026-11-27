// Builds a white-label Setup exe:  node scripts/package-brand.js <brand-id>
//
// Uses brands/<id>/brand.json (name, phone, appId, data folder, file names) and
// brands/<id>/assets/* (logo). The branded app gets its own appId, install folder
// and data folder, so it can sit next to a CHAND install on the same PC.
// Output: dist-electron/<id>/<fileSlug>-Setup-<version>.exe
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const id = process.argv[2];
if (!id) { console.error('Usage: node scripts/package-brand.js <brand-id>'); process.exit(1); }
const brandDir = path.join(root, 'brands', id);
const brand = JSON.parse(fs.readFileSync(path.join(brandDir, 'brand.json'), 'utf8'));
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

const electronBrand = path.join(root, 'electron', 'brand.json');
const electronLogo = path.join(root, 'electron', brand.logo);
const tmpConfig = path.join(root, `electron-builder.${id}.tmp.json`);
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const run = (cmd, extra = {}) => execSync(cmd, { cwd: root, stdio: 'inherit', env: { ...env, ...extra } });

try {
  console.log(`\n=== Building ${brand.productName} ${pkg.version} ===`);
  run('npm run build:client', { SMS_BRAND: id });
  run('npm run build:server');

  fs.writeFileSync(electronBrand, JSON.stringify(brand, null, 2));
  if (brand.logo !== 'chand-logo.png') fs.copyFileSync(path.join(brandDir, 'assets', brand.logo), electronLogo);

  const base = JSON.parse(fs.readFileSync(path.join(root, 'electron', 'builder.config.json'), 'utf8'));
  const config = {
    ...base,
    appId: brand.appId,
    productName: brand.productName,
    copyright: brand.fullName,
    directories: { ...base.directories, output: `dist-electron/${id}` },
    files: [...base.files, ...(brand.logo !== 'chand-logo.png' ? ['!electron/chand-logo.png'] : [])],
    extraMetadata: {
      ...base.extraMetadata,
      name: brand.packageName,
      productName: brand.productName,
      description: brand.fullName,
      author: brand.phone ? `${brand.name} (${brand.phone})` : brand.name
    },
    win: { ...base.win, target: [{ target: 'nsis', arch: ['x64'] }] },
    nsis: {
      ...base.nsis,
      shortcutName: brand.productName,
      artifactName: `${brand.fileSlug}-Setup-\${version}.\${ext}`
    }
  };
  delete config.portable;
  fs.writeFileSync(tmpConfig, JSON.stringify(config, null, 2));
  run(`npx electron-builder --config "${path.basename(tmpConfig)}"`);
  console.log(`\nDone: dist-electron/${id}/${brand.fileSlug}-Setup-${pkg.version}.exe`);
} finally {
  fs.rmSync(tmpConfig, { force: true });
  fs.rmSync(electronBrand, { force: true });
  if (brand.logo !== 'chand-logo.png') fs.rmSync(electronLogo, { force: true });
  // Put the default (CHAND) web build back so `npm start` / `npm run dist` aren't left branded.
  try { run('npm run build:client'); } catch { console.warn('Re-run `npm run build:client` to restore the CHAND web build.'); }
}
