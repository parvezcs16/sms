const ExcelJS = require('exceljs');

// "Sr No" is a per-class running number (a formula) so the school can see how
// many students each class has in the file; it is ignored on import.
const STUDENT_IMPORT_COLUMNS = [
  { header: 'Sr No (in class)', key: 'sr_no', width: 9, ignore: true },
  { header: 'Full Name', key: 'full_name', width: 26 },
  { header: 'Gender', key: 'gender', width: 10 },
  { header: 'Date of Birth (DD-MM-YYYY)', key: 'date_of_birth', width: 16 },
  { header: 'Class', key: 'class_name', width: 12 },
  { header: 'Section', key: 'section_name', width: 9 },
  { header: 'Roll Number', key: 'roll_number', width: 9 },
  { header: 'Guardian Name', key: 'guardian_name', width: 22 },
  { header: 'Guardian Phone', key: 'guardian_phone', width: 16 },
  { header: 'Guardian Email', key: 'guardian_email', width: 24 },
  { header: 'Address', key: 'address', width: 30 }
];
const SAMPLE_PREFIX = 'Sample Student';
const TEMPLATE_ROWS = 1000;

const colLetter = (key) => String.fromCharCode(65 + STUDENT_IMPORT_COLUMNS.findIndex((c) => c.key === key));

// classes: [{ name, sections: [{ name, students }] }] — the school's real
// classes, used for the sample row, dropdowns and the checklist sheet.
async function buildStudentImportTemplate(classes = []) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Students', { views: [{ state: 'frozen', ySplit: 1 }] });
  sheet.columns = STUDENT_IMPORT_COLUMNS.map(({ header, key, width }) => ({ header, key, width }));
  const head = sheet.getRow(1);
  head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF14307E' } };
  head.alignment = { vertical: 'middle', wrapText: true };
  head.height = 32;
  ['full_name', 'class_name', 'section_name'].forEach((k) => { sheet.getCell(`${colLetter(k)}1`).value = `${sheet.getCell(`${colLetter(k)}1`).value} *`; });

  // Keep what people type as text: phone numbers keep their leading 0 and
  // dates are not turned into serial numbers.
  ['date_of_birth', 'guardian_phone', 'section_name'].forEach((k) => { sheet.getColumn(colLetter(k)).numFmt = '@'; });

  const first = classes.find((c) => c.sections.length) || { name: 'Class 1', sections: [{ name: 'A' }] };
  sheet.addRow({
    full_name: `${SAMPLE_PREFIX} (delete this row)`,
    gender: 'Male',
    date_of_birth: '16-02-2015',
    class_name: first.name,
    section_name: first.sections[0].name,
    roll_number: 1,
    guardian_name: 'Muhammad Asif',
    guardian_phone: '0300-1234567',
    guardian_email: 'parent@example.com',
    address: 'House 1, Street 2, City'
  });
  sheet.getRow(2).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF4C2' } };
  sheet.getRow(2).font = { italic: true };

  const S = colLetter('sr_no'); const N = colLetter('full_name'); const C = colLetter('class_name'); const G = colLetter('gender');
  const sectionNames = [...new Set(classes.flatMap((c) => c.sections.map((s) => s.name)))];
  for (let r = 2; r <= TEMPLATE_ROWS + 1; r += 1) {
    sheet.getCell(`${S}${r}`).value = { formula: `IF(${N}${r}="","",COUNTIF($${C}$2:${C}${r},${C}${r}))` };
    sheet.getCell(`${S}${r}`).font = { color: { argb: 'FF6B7280' } };
    if (classes.length) {
      sheet.getCell(`${C}${r}`).dataValidation = { type: 'list', allowBlank: true, showErrorMessage: false, formulae: [`'Classes & Sections'!$F$2:$F$${classes.length + 1}`] };
    }
    if (sectionNames.length) sheet.getCell(`${colLetter('section_name')}${r}`).dataValidation = { type: 'list', allowBlank: true, showErrorMessage: false, formulae: [`"${sectionNames.join(',')}"`] };
    sheet.getCell(`${G}${r}`).dataValidation = { type: 'list', allowBlank: true, showErrorMessage: false, formulae: ['"Male,Female"'] };
  }

  // Checklist: every class/section, how many are already in the system and
  // how many this file has — so no student is left out.
  const list = workbook.addWorksheet('Classes & Sections', { views: [{ state: 'frozen', ySplit: 1 }] });
  list.columns = [
    { header: 'Class', key: 'c', width: 14 }, { header: 'Section', key: 's', width: 10 },
    { header: 'Students already in system', key: 'n', width: 16 }, { header: 'Students in this file', key: 'f', width: 14 }
  ];
  list.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  list.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF14307E' } };
  list.getRow(1).alignment = { wrapText: true, vertical: 'middle' };
  list.getRow(1).height = 32;
  const Sec = colLetter('section_name');
  classes.forEach((c) => (c.sections.length ? c.sections : [{ name: '', students: 0 }]).forEach((s) => {
    const r = list.rowCount + 1;
    list.addRow({
      c: c.name, s: s.name, n: s.students || 0,
      f: { formula: `COUNTIFS(Students!$${C}$2:$${C}$${TEMPLATE_ROWS + 1},A${r},Students!$${Sec}$2:$${Sec}$${TEMPLATE_ROWS + 1},B${r})-COUNTIFS(Students!$${N}$2:$${N}$${TEMPLATE_ROWS + 1},"${SAMPLE_PREFIX}*",Students!$${C}$2:$${C}$${TEMPLATE_ROWS + 1},A${r},Students!$${Sec}$2:$${Sec}$${TEMPLATE_ROWS + 1},B${r})` }
    });
  }));

  // Unique class names for the Class dropdown.
  list.getColumn(6).width = 16;
  list.getCell('F1').value = 'Class list';
  list.getCell('F1').font = { bold: true, color: { argb: 'FF6B7280' } };
  classes.forEach((c, i) => { list.getCell(`F${i + 2}`).value = c.name; });

  const help = workbook.addWorksheet('How to fill');
  help.getColumn(1).width = 110;
  [
    'HOW TO FILL THE STUDENT IMPORT SHEET',
    '',
    '1. The yellow row on the "Students" sheet is a sample that the app accepts. Copy its style, then delete it (it is skipped automatically if left).',
    '2. Required: Full Name, Class and Section. Everything else is optional.',
    '3. Class must match a class in the app — pick it from the dropdown, or type it as shown on the "Classes & Sections" sheet. "1" is read as "Class 1".',
    '4. Date of Birth: DD-MM-YYYY (e.g. 16-02-2015). 16/02/2015 and 2015-02-16 also work.',
    '5. Gender: Male or Female.',
    '6. Guardian Phone: e.g. 0300-1234567. Brothers/sisters with the same guardian phone are linked to one guardian.',
    '7. "Sr No (in class)" counts automatically for each class. Check the "Classes & Sections" sheet to make sure every class has all its students.',
    '8. Students already in the app (same name, class/section and date of birth) are skipped, so re-uploading the same file is safe.'
  ].forEach((t, i) => { const row = help.addRow([t]); if (i === 0) row.font = { bold: true, size: 13 }; });

  return workbook.xlsx.writeBuffer();
}

// Any cell → plain string. Dates become YYYY-MM-DD; formula, hyperlink and
// rich-text cells give their visible text.
function cellText(v) {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? '' : v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    if (v.richText) return v.richText.map((p) => p.text).join('').trim();
    if (v.text !== undefined) return cellText(v.text);
    if (v.result !== undefined) return cellText(v.result);
    if (v.error) return '';
    return '';
  }
  return String(v).trim();
}

const normHeader = (h) => cellText(h).replace(/\*/g, '').replace(/\s+/g, ' ').trim().toLowerCase();

async function parseStudentImport(buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const sheet = workbook.getWorksheet('Students') || workbook.worksheets[0];
  const rows = [];
  const headerRow = sheet.getRow(1).values; // 1-indexed, index 0 empty
  const keyByColumn = {};
  STUDENT_IMPORT_COLUMNS.filter((c) => !c.ignore).forEach((col) => {
    const want = col.header.toLowerCase();
    const short = want.replace(/\s*\(.*\)$/, ''); // "date of birth"
    const colIndex = headerRow.findIndex((h) => h && (normHeader(h) === want || normHeader(h).replace(/\s*\(.*\)$/, '') === short));
    if (colIndex > -1) keyByColumn[colIndex] = col.key;
  });
  if (!Object.values(keyByColumn).includes('full_name')) {
    throw Object.assign(new Error('This file has no "Full Name" column — please use the downloaded template.'), { status: 400 });
  }

  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const values = row.values;
    const record = { row: rowNumber };
    Object.entries(keyByColumn).forEach(([colIndex, key]) => { record[key] = cellText(values[Number(colIndex)]); });
    if (record.full_name) rows.push(record);
  });
  return rows;
}

async function exportRowsToExcel({ sheetName, columns, rows }) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(sheetName);
  sheet.columns = columns;
  sheet.getRow(1).font = { bold: true };
  const { toDmy } = require('../utils/dmy');
  rows.forEach((row) => sheet.addRow(Object.fromEntries(Object.entries(row).map(([k, v]) => [k, typeof v === 'string' ? toDmy(v) : v]))));
  return workbook.xlsx.writeBuffer();
}

module.exports = { buildStudentImportTemplate, parseStudentImport, exportRowsToExcel, STUDENT_IMPORT_COLUMNS, SAMPLE_PREFIX };
