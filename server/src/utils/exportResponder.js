const pdfService = require('../services/pdf');
const excelService = require('../services/excel');

// Sends `rows` as JSON by default, as a PDF / Excel export when
// ?format=pdf|excel is set, or — with ?format=send&phone=…&email=… — sends the
// PDF to that WhatsApp number / email address.
async function respondWithFormat(req, res, { title, columns, rows, fileBase = 'report', subtitle }) {
  const format = req.query.format;
  if (format === 'pdf' || format === 'send') {
    const buffer = await pdfService.tableReportPdf({ title, columns, rows, subtitle });
    if (format === 'pdf') {
      pdfService.sendPdf(res, `${fileBase}.pdf`, buffer);
      return;
    }
    const phone = String(req.query.phone || '').trim();
    const email = String(req.query.email || '').trim();
    if (!phone && !email) {
      res.status(400).json({ error: 'Enter a WhatsApp number or an email address' });
      return;
    }
    const notificationService = require('../services/notifications/notificationService');
    const { recordAudit } = require('../middleware/audit');
    const channels = [phone && 'whatsapp', email && 'email'].filter(Boolean);
    const result = await notificationService.sendNotification({
      title,
      message: String(req.query.message || `${title} — attached.`).slice(0, 1000),
      category: 'Report',
      audienceType: 'Individual',
      audienceRef: JSON.stringify([{ name: req.query.name || 'Recipient', phone: phone || null, email: email || null }]),
      channels,
      createdBy: req.user && req.user.id,
      attachment: { buffer, fileName: `${fileBase}.pdf`, mimetype: 'application/pdf' }
    });
    recordAudit(req, 'send_report', 'report', null, { title, phone, email, summary: result.summary });
    res.json(result);
    return;
  }
  if (format === 'excel') {
    const buffer = await excelService.exportRowsToExcel({
      sheetName: title.replace(/[:\\/?*[\]]/g, ' ').slice(0, 30),
      columns: columns.map((c) => ({ header: c.label, key: c.key, width: 18 })),
      rows
    });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${fileBase}.xlsx"`);
    res.send(Buffer.from(buffer));
    return;
  }
  res.json(rows);
}

module.exports = { respondWithFormat };
