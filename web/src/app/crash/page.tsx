import fs from "fs/promises";
import path from "path";
import type { Metadata } from "next";
import CrashClient, { type CrashSnapshot, type CrashIndex } from "./CrashClient";

// noindex: 仕様書「robots.txt / meta noindex も併用」に対応(ページ単位)。
// 一覧系クローラーによる間接的な露出も避ける。
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

async function readJson<T>(relPath: string): Promise<T | null> {
  const filePath = path.join(process.cwd(), "public", "data", "crash", relPath);
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export default async function CrashPage() {
  const snapshot = await readJson<CrashSnapshot>("crash_latest.json");
  const index = await readJson<CrashIndex>("crash_index.json");

  return <CrashClient initialSnapshot={snapshot} index={index} />;
}
