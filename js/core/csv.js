// Minimal, dependency-free CSV writer (RFC 4180): a field is quoted when it
// contains a comma, quote, or newline, and embedded quotes are doubled.
export function toCsv(rows, columns) {
  const cols = columns || (rows[0] ? Object.keys(rows[0]) : []);
  const esc = (v) => {
    const s = v == null ? '' : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = cols.map(esc).join(',');
  if (!rows.length) return head;
  const body = rows.map((r) => cols.map((c) => esc(r[c])).join(',')).join('\n');
  return `${head}\n${body}`;
}

// Minimal, dependency-free CSV reader (RFC 4180): handles quoted fields with
// embedded commas/newlines/doubled-quotes, a leading UTF-8 BOM, and CRLF or LF
// line endings. Returns an array of rows, each an array of string cells. Trailing
// blank lines are dropped. Used to read reports exported from other tools.
export function fromCsv(text) {
  const s = String(text).replace(/^﻿/, '');
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  let i = 0;
  const pushField = () => { row.push(field); field = ''; };
  const pushRow = () => { pushField(); rows.push(row); row = []; };
  while (i < s.length) {
    const c = s[i];
    if (quoted) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i += 2; continue; }
        quoted = false; i += 1; continue;
      }
      field += c; i += 1; continue;
    }
    if (c === '"') { quoted = true; i += 1; continue; }
    if (c === ',') { pushField(); i += 1; continue; }
    if (c === '\r') { i += 1; continue; }
    if (c === '\n') { pushRow(); i += 1; continue; }
    field += c; i += 1;
  }
  // Flush the final field/row unless the input ended exactly on a newline.
  if (field !== '' || row.length) pushRow();
  // Drop fully-empty trailing rows (e.g. a file ending with a blank line).
  return rows.filter((r) => r.length > 1 || (r.length === 1 && r[0] !== ''));
}
