import fs from "fs/promises";
import path from "path";
import PullbackList from "./PullbackList";
import { Row, computeMktcapRanks, computeGates } from "@/lib/classify";

type Excluded = { code: string; name: string; reason: string };

async function readJson<T>(relPath: string): Promise<T> {
  const filePath = path.join(process.cwd(), "public", relPath);
  const raw = await fs.readFile(filePath, "utf-8");
  return JSON.parse(raw) as T;
}

export default async function PullbackPage() {
  const popularData = await readJson<{ _meta: { date: string }; popular: Row[] }>(
    "data/popular.json"
  );

  let excluded: Excluded[] = [];
  try {
    const excludedData = await readJson<{ excluded: Excluded[] }>("data/excluded.json");
    excluded = excludedData.excluded ?? [];
  } catch (e) {
    console.error("excluded.json read failed:", e);
  }

  const excludedCodes = new Set(excluded.map((e) => e.code));
  const population = popularData.popular.filter((r) => !excludedCodes.has(r.code));
  const mktcapRanks = computeMktcapRanks(population);
  const base = population.filter(
    (r) => computeGates(r, mktcapRanks.get(r.code) ?? null).length > 0
  );

  return <PullbackList base={base} meta={popularData._meta} />;
}
