const os = require('os');
const dgram = require('dgram');
const config = require('../config');

// Virtual adapters (Hyper-V/WSL, VirtualBox, VMware, VPNs, Bluetooth) also have
// IPv4 addresses, and phones on the school Wi-Fi can't reach any of them. The
// QR code used to point at whichever adapter Windows listed first, which on
// many PCs was one of these — so the phone page never reached this server.
const VIRTUAL_NAME = /(vethernet|virtualbox|vmware|vbox|hyper-v|wsl|docker|loopback|bluetooth|tailscale|zerotier|hamachi|vpn|tap-|tun)/i;

function scoreAddress(name, address) {
  let score = 0;
  if (VIRTUAL_NAME.test(name)) score -= 100;
  if (/^(wi-?fi|wlan|wireless)/i.test(name)) score += 20;
  if (/^(ethernet|eth|en)/i.test(name)) score += 15;
  if (address.startsWith('192.168.')) score += 10;
  else if (address.startsWith('10.')) score += 8;
  else if (/^172\.(1[6-9]|2\d|3[01])\./.test(address)) score += 4;
  if (address.startsWith('169.254.')) score -= 200; // no DHCP lease — unusable
  return score;
}

function getLanAddresses() {
  const interfaces = os.networkInterfaces();
  const list = [];
  Object.entries(interfaces).forEach(([name, entries]) => {
    (entries || []).forEach((entry) => {
      if (entry.family === 'IPv4' && !entry.internal) {
        list.push({ name, address: entry.address, score: scoreAddress(name, entry.address) });
      }
    });
  });
  return list.sort((a, b) => b.score - a.score);
}

const DISCOVERY_PORT = Number(process.env.SMS_DISCOVERY_PORT) || 41234;
const DISCOVERY_PROBE = 'CHAND_SMS_DISCOVER';

// Answers UDP broadcast probes from other PCs running in "client" mode, so they
// can find this server without anyone typing an IP address.
function startDiscoveryResponder(getSchoolName) {
  const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  socket.on('message', (msg, rinfo) => {
    if (msg.toString().trim() !== DISCOVERY_PROBE) return;
    const reply = JSON.stringify({
      app: 'chand-sms',
      port: config.port,
      version: config.appVersion,
      host: os.hostname(),
      schoolName: safe(getSchoolName),
      addresses: getLanAddresses().map((a) => a.address)
    });
    socket.send(reply, rinfo.port, rinfo.address);
  });
  socket.on('error', (err) => {
    console.error('LAN discovery responder disabled:', err.message);
    try { socket.close(); } catch { /* ignore */ }
  });
  socket.bind(DISCOVERY_PORT, '0.0.0.0');
  return socket;
}

function safe(fn) {
  try { return fn(); } catch { return ''; }
}

module.exports = { getLanAddresses, startDiscoveryResponder, DISCOVERY_PORT, DISCOVERY_PROBE };
