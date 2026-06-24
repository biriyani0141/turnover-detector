import fs from "fs/promises";
import path from "path";
import PopularList from "./PopularList";

type Row = {
  code: string;
  name: string;
  mktcap_oku: number | null;
  first_date: string;
  ret_1d: number | null;
  ret_5d: number | null;
  ret_1m: number | null;
  ret_3m: number | null;
  ret_1y: number | null;
  close: number | null;
  [key: string]: any;
};

type Excluded = { code: string; name: string; reason: string };

async function readJson<T>(relPath: string): Promise<T> {
  const filePath = path.join(process.cwd(), "public", relPath);
  const raw = await fs.readFile(filePath, "utf-8");
  return JSON.parse(raw) as T;
}

export default async function PopularPage() {
  const popularData = await readJson<{ _meta: any; popular: Row[] }>("data/popular.json");

  let excluded: Excluded[] = [];
  try {
    const excludedData = await readJson<{ excluded: Excluded[] }>("data/excluded.json");
    excluded = excludedData.excluded ?? [];
  } catch (e) {
    console.error("excluded.json read failed:", e);
  }

  const excludedCodes = new Set(excluded.map((e) => e.code));
  const allData = popularData.popular.filter((r) => !excludedCodes.has(r.code));

  return <PopularList allData={allData} meta={popularData._meta} excluded={excluded} />;
}
