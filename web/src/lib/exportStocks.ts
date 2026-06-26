export function to4digit(code: string): string {
  return code.slice(0, 4);
}

export function todayYMD(): string {
  return new Date().toISOString().slice(0, 10).replace(/-/g, "");
}

/** 重複除去・空除去・4桁化 */
export function sanitize4digit(rawCodes: string[]): string[] {
  return [...new Set(rawCodes.filter(Boolean).map(to4digit))];
}

export function buildSbiCsv(codes: string[]): string {
  return codes.map((c) => `'${c},,,,,,,----/--/--,`).join("\n");
}

export function buildRakutenCsv(codes: string[]): string {
  return codes.map((c) => `"${c}"`).join("\n");
}

export function buildTradingViewText(codes: string[]): string {
  return codes.join(",") + ",";
}

export function downloadCsv(content: string, filename: string): void {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
