// Spreadsheet → text for the document agent. Office spreadsheets (.xlsx) are a
// ZIP of XML, so reading their raw bytes as UTF-8 produces garbage (the old
// behaviour, which made every spreadsheet defer to review). Parse the workbook
// and render each sheet as CSV-style text the agent can actually read.

import ExcelJS from "exceljs";

const SPREADSHEET_MIME = new Set([
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", // .xlsx
  "application/vnd.ms-excel", // .xls (legacy; exceljs reads xlsx — may fail, handled by caller)
]);

export function isSpreadsheet(mimeType: string | null, filename: string): boolean {
  const ext = filename.toLowerCase().split(".").pop() ?? "";
  return (!!mimeType && SPREADSHEET_MIME.has(mimeType)) || ext === "xlsx" || ext === "xls";
}

function formatCell(v: unknown): string {
  if (v == null) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    if ("result" in o) return formatCell(o.result); // formula / shared-formula → its result
    if ("text" in o) return String(o.text); // hyperlink
    if ("richText" in o && Array.isArray(o.richText)) {
      return (o.richText as Array<{ text?: string }>).map((r) => r.text ?? "").join("");
    }
    if ("error" in o) return String(o.error); // #DIV/0! etc.
    return "";
  }
  return String(v);
}

function csvCell(s: string): string {
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Render a workbook as labeled CSV text, one block per sheet. Caps total output
 * so a huge ledger can't blow the model's context window; truncation is marked.
 */
export async function spreadsheetToText(
  buffer: Buffer,
  filename: string,
  maxChars = 200_000,
): Promise<string> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ArrayBuffer);

  const blocks: string[] = [];
  wb.eachSheet((sheet) => {
    const rows: string[] = [];
    sheet.eachRow({ includeEmpty: false }, (row) => {
      const vals = (row.values as unknown[]).slice(1); // values[0] is a placeholder
      rows.push(vals.map((v) => csvCell(formatCell(v))).join(","));
    });
    blocks.push(`=== Sheet: ${sheet.name} (${rows.length} rows) ===\n${rows.join("\n")}`);
  });

  let text = `Spreadsheet "${filename}" — ${wb.worksheets.length} sheet(s), rendered as CSV per sheet:\n\n${blocks.join("\n\n")}`;
  if (text.length > maxChars) {
    text = text.slice(0, maxChars) + `\n\n[…truncated — spreadsheet exceeds ${maxChars} characters]`;
  }
  return text;
}
