// The school's local calendar date (YYYY-MM-DD) on the server PC. Using
// toISOString() gives the UTC date, which in Pakistan (UTC+5) is still the
// previous day until 5 AM — "today's attendance" would land on the wrong day.
function localDateStr(d = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// The SERVER PC's clock decides what "today" is. A phone whose clock or time
// zone is wrong would otherwise file attendance under tomorrow's date, where
// nobody on the office PCs ever sees it.
function assertAttendanceDate(date, HttpError) {
  if (!date || !DATE_RE.test(date)) throw new HttpError(400, 'attendance_date must be YYYY-MM-DD');
  const today = localDateStr();
  if (date > today) {
    throw new HttpError(400, `Attendance can't be marked for ${date} — today on the school server is ${today}. Please check the date (and this device's date/time settings).`);
  }
}

module.exports = { localDateStr, assertAttendanceDate, DATE_RE };
