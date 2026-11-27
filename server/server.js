const config = require('./src/config');
const { createApp } = require('./src/app');

function start() {
  const app = createApp();
  return new Promise((resolve, reject) => {
    const server = app.listen(config.port, config.host, () => {
      console.log(`API ready on http://${config.host}:${config.port}`);
      if (process.env.SMS_DISABLE_SCHEDULER !== '1') require('./src/services/scheduler').start();
      if (process.env.SMS_DISABLE_DISCOVERY !== '1') {
        const { startDiscoveryResponder } = require('./src/services/lan');
        const { getDb } = require('./src/db/connection');
        const { getSetting } = require('./src/services/settings');
        startDiscoveryResponder(() => getSetting(getDb(), 'school_name', ''));
      }
      resolve(server);
    });
    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        reject(new Error(`Port ${config.port} already in use`));
      } else {
        reject(err);
      }
    });
  });
}

if (require.main === module) {
  process.on('uncaughtException', (err) => {
    console.error('Uncaught exception:', err && err.stack ? err.stack : err);
    process.exit(1);
  });
  process.on('unhandledRejection', (reason) => {
    console.error('Unhandled rejection:', reason);
    process.exit(1);
  });

  start().catch((err) => {
    console.error('Failed to start server:', err && err.stack ? err.stack : err);
    process.exit(1);
  });
}

module.exports = { start, createApp: require('./src/app').createApp };
