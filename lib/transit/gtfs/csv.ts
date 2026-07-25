/**
 * Minimal RFC 4180 CSV parser for GTFS text files. GTFS files are plain
 * CSV with a header row; fields can be double-quoted and quoted fields
 * can contain commas, newlines, and escaped quotes ("") -- a naive
 * String.split(",") breaks on real-world feeds (agency/stop names with
 * commas are common), so this is a small hand-rolled parser rather than
 * a dependency, since GTFS CSV is simple enough not to need one.
 *
 * Returns an array of row objects keyed by the header column names,
 * matching GTFS's convention of arbitrary/extra columns being ignored by
 * consumers that don't need them.
 */
export function parseCsv(text: string): Array<Record<string, string>> {
  // Strip a UTF-8 BOM if present -- common in GTFS files exported from
  // Windows-authored tooling.
  const input = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;
  let i = 0;
  const len = input.length;

  while (i < len) {
    const ch = input[i];
    if (inQuotes) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (ch === ",") {
      row.push(field);
      field = "";
      i++;
      continue;
    }
    if (ch === "\r") {
      i++;
      continue;
    }
    if (ch === "\n") {
      row.push(field);
      rows.push(row);
      field = "";
      row = [];
      i++;
      continue;
    }
    field += ch;
    i++;
  }
  // Final field/row (files not ending in a trailing newline).
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  if (rows.length === 0) return [];
  const header = rows[0].map((h) => h.trim());
  const records: Array<Record<string, string>> = [];
  for (let r = 1; r < rows.length; r++) {
    const rawRow = rows[r];
    // Skip fully-blank trailing lines.
    if (rawRow.length === 1 && rawRow[0].trim() === "") continue;
    const record: Record<string, string> = {};
    for (let c = 0; c < header.length; c++) {
      record[header[c]] = (rawRow[c] ?? "").trim();
    }
    records.push(record);
  }
  return records;
}
