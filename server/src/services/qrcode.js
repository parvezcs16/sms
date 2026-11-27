const QRCode = require('qrcode');
const bwipjs = require('bwip-js');

async function studentQrDataUrl(studentCode) {
  return QRCode.toDataURL(studentCode, { margin: 1, width: 240 });
}

// Raw PNG buffer (rather than a data: URL) for embedding directly into a
// PDFKit document via doc.image(), e.g. on a printed ID card.
async function studentQrPngBuffer(studentCode) {
  return QRCode.toBuffer(studentCode, { margin: 1, width: 240 });
}

async function lanUrlQrDataUrl(url) {
  return QRCode.toDataURL(url, { margin: 1, width: 200 });
}

async function studentBarcodePngBuffer(studentCode) {
  return bwipjs.toBuffer({
    bcid: 'code128',
    text: studentCode,
    scale: 3,
    height: 12,
    includetext: true,
    textxalign: 'center'
  });
}

module.exports = { studentQrDataUrl, studentQrPngBuffer, lanUrlQrDataUrl, studentBarcodePngBuffer };
