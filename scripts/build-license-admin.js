// Builds the standalone "CHAND License Admin" exe's app folder:
// license-admin-app/ = one bundled main.js (express etc. inlined, so the exe
// needs no node_modules) + icon + a minimal package.json. electron-builder then
// packages that folder (see license-admin/builder.config.json).
const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const rootDir = path.join(__dirname, '..');
const appDir = path.join(rootDir, 'license-admin-app');
const rootPkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));

async function run() {
  fs.rmSync(appDir, { recursive: true, force: true });
  fs.mkdirSync(appDir, { recursive: true });

  await esbuild.build({
    entryPoints: [path.join(rootDir, 'license-admin', 'main.js')],
    outfile: path.join(appDir, 'main.js'),
    bundle: true,
    platform: 'node',
    target: 'node22',
    format: 'cjs',
    external: ['electron'],
    logLevel: 'info'
  });
  fs.copyFileSync(path.join(rootDir, 'license-admin', 'icon.png'), path.join(appDir, 'icon.png'));
  fs.writeFileSync(path.join(appDir, 'package.json'), JSON.stringify({
    name: 'chand-license-admin',
    productName: 'CHAND License Admin',
    version: rootPkg.version,
    description: 'CHAND License Admin',
    author: rootPkg.author,
    main: 'main.js'
  }, null, 2));
  console.log('License Admin app folder ready -> license-admin-app/');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
