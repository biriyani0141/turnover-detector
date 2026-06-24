import fs from "fs/promises";
import path from "path";
import RankingTabs, { Appearance, CardRow, RankingData } from "./RankingTabs";

async function readJson<T>(relPath: string): Promise<T> {
  const filePath = path.join(process.cwd(), "public", relPath);
  const raw = await fs.readFile(filePath, "utf-8");
  return JSON.parse(raw) as T;
}

export default async function RankingPage() {
  const rankingData = await readJson<RankingData>("data/ranking.json");

  let appearanceByCode: Record<string, Appearance> = {};
  try {
    const appearanceData = await readJson<{ by_code?: Record<string, Appearance> }>(
      "data/appearance.json"
    );
    appearanceByCode = appearanceData.by_code ?? {};
  } catch (e) {
    console.error("appearance.json read failed:", e);
  }

  let turnoverCards: CardRow[] | null = null;
  try {
    const turnoverData = await readJson<{ ranking?: CardRow[] }>("data/ranking_cards.json");
    turnoverCards = turnoverData?.ranking ?? null;
  } catch (e) {
    console.error("ranking_cards.json read failed:", e);
  }

  let stophighCards: CardRow[] | null = null;
  try {
    const stophighData = await readJson<{ ranking?: CardRow[] }>("data/stophigh_cards.json");
    stophighCards = stophighData?.ranking ?? null;
  } catch (e) {
    console.error("stophigh_cards.json read failed:", e);
  }

  return (
    <RankingTabs
      rankingData={rankingData}
      appearanceByCode={appearanceByCode}
      turnoverCards={turnoverCards}
      stophighCards={stophighCards}
      meta={rankingData._meta}
    />
  );
}
