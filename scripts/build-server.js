// Bundles the Express backend into a single dependency-free CommonJS file.
//
// Why: the packaged Electron app spawns the server as a child process running
// Electron's Node runtime in "run as node" mode. That mode has proven unreliable
// resolving certain modern npm packages that use exports-only "package.json"
// fields (observed with express's qs -> side-channel -> get-proto -> dunder-proto
// chain) when spawned as a child of a running Electron GUI process, even though
// the exact same code runs fine under plain `node` or a directly-invoked
// `electron --run-as-node script.js`. Bundling removes all runtime node_modules
// resolution for third-party packages, sidestepping that class of bug entirely,
// and also drastically shrinks the packaged app.
const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const rootDir = path.join(__dirname, '..');
const outDir = path.join(rootDir, 'server-dist');
const outFile = path.join(outDir, 'server.js');

async function run() {
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });

  await esbuild.build({
    entryPoints: [path.join(rootDir, 'server', 'server.js')],
    outfile: outFile,
    bundle: true,
    platform: 'node',
    target: 'node22',
    format: 'cjs',
    external: ['node:sqlite'],
    logLevel: 'info'
  });

  // pdfkit reads its AFM font metrics + ICC profile from disk at runtime via
  // `__dirname`-relative paths. After bundling, __dirname points at outDir, so
  // copy pdfkit's data folder alongside the bundle at the path it expects.
  const pdfkitData = path.join(rootDir, 'node_modules', 'pdfkit', 'js', 'data');
  const outData = path.join(outDir, 'data');
  fs.cpSync(pdfkitData, outData, { recursive: true });

  // The app's own Google sign-in for Drive backups (see services/cloudBackup.js).
  const oauth = path.join(rootDir, 'google-oauth.json');
  if (fs.existsSync(oauth)) {
    fs.copyFileSync(oauth, path.join(outDir, 'google-oauth.json'));
    console.log('Google Drive sign-in: google-oauth.json included');
  } else {
    console.log('Google Drive sign-in: no google-oauth.json — schools will need "Google Drive for desktop" or their own client ID');
  }

  console.log(`Server bundled -> ${path.relative(rootDir, outFile)} (+ pdfkit data/)`);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
