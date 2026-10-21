/**
 * CSV export with spreadsheet formula-injection protection.
 * Text starting with = + - @ tab or carriage return is prefixed with an apostrophe.
 */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let s = String(value);
  // Numbers keep their sign; any other value that renders formula-like text is neutralised.
  if (typeof value !== "number" && typeof value !== "bigint" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  if (/[",\n\r]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function toCsv(headers: string[], rows: unknown[][], meta: Array<[string, string]> = []): string {
  const lines: string[] = [];
  for (const [k, v] of meta) lines.push(`${csvCell("# " + k)},${csvCell(v)}`);
  lines.push(headers.map(csvCell).join(","));
  for (const r of rows) lines.push(r.map(csvCell).join(","));
  return lines.join("\r\n") + "\r\n";
}
