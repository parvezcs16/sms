const fs = require('fs');
const path = require('path');
const config = require('../config');

const IMAGE_EXT = /\.(jpe?g|png|gif|webp)$/i;

function assertImage(file) {
  if (!file) return false;
  if (!IMAGE_EXT.test(file.originalname) || !/^image\//.test(file.mimetype || 'image/')) {
    try { fs.unlinkSync(file.path); } catch { /* ignore */ }
    return false;
  }
  return true;
}

function removeUpload(fileName) {
  if (!fileName) return;
  const full = path.join(config.uploadsDir, path.basename(fileName));
  try { if (fs.existsSync(full)) fs.unlinkSync(full); } catch { /* ignore */ }
}

module.exports = { assertImage, removeUpload };
