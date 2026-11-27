// The school's local calendar date (YYYY-MM-DD). toISOString() returns the UTC
// date, which for Pakistan (UTC+5) is still "yesterday" until 5 AM, so early
// attendance could be filed under the wrong day.
export function localDateStr(d = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
