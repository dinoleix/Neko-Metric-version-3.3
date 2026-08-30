// ---------------------------------------------------------------------------
// Single-pass RFC-4180 CSV parser.
//
// Commas and newlines are separators only outside quotes, so quoted fields
// containing either (e.g. order instructions like "no boba\n") keep their row
// intact. Extracted from the Uploader so every importer parses identically —
// a second hand-rolled copy is how the two drift apart.
// ---------------------------------------------------------------------------

/** Raw records, header row included. Blank trailing lines are dropped. */
export function parseCsvRecords(text: string): string[][] {
  const records: string[][] = [];
  let field = '', record: string[] = [], inQuotes = false;

  const pushRecord = () => {
    record.push(field.trim());
    field = '';
    if (record.length > 1 || record[0] !== '') records.push(record);
    record = [];
  };

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } // escaped ""
        else inQuotes = false;
      } else field += char;
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      record.push(field.trim()); field = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i++; // CRLF
      pushRecord();
    } else field += char;
  }
  if (field !== '' || record.length) pushRecord();

  return records;
}
