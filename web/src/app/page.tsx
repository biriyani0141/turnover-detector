import fs from "fs/promises";
import path from "path";
import PickupClient from "./PickupClient";
import type { CardStock } from "../components/TurnoverCard";
import { Row, StateLabel, STATE_CONFIG, classify, MIN_TURNOVER_50 } from "@/lib/classify";

type Excluded = {
  code: string;
  name: string;
  reason: string;
};

type PullbackItem = { row: Row; card: CardStock };

// 信用区分の表示ラベルへのマッピング（文字列完全一致）
const CREDIT_LABEL: Record<string, string> = {
  "貸借銘柄": "貸借",
  "制度信用銘柄": "信用",
  // "非制度信用銘柄" は表示しない
};

async function readJson<T>(relPath: string): Promise<T> {
  const filePath = path.join(process.cwd(), "public", relPath);
  const raw = await fs.readFile(filePath, "utf-8");
  return JSON.parse(raw) as T;
}

export default async function Home() {
  // ---- Volume% / Stop High 用データ（必須: ranking_cards.json） ----
  const cardsData = await readJson<{ _meta?: { date?: string }; ranking: CardStock[] }>(
    "data/ranking_cards.json"
  );

  let excluded: Excluded[] = [];
  try {
    const excludedData = await readJson<{ excluded?: Excluded[] }>("data/excluded.json");
    excluded = excludedData.excluded ?? [];
  } catch (e) {
    console.error("excluded.json read failed:", e);
  }

  let marginStocks: Record<string, string> = {};
  try {
    const marginData = await readJson<{ stocks?: Record<string, string> }>(
      "data/margin_list.json"
    );
    marginStocks = marginData.stocks ?? {};
  } catch (e) {
    console.error("margin_list.json read failed:", e);
  }

  let shRows: CardStock[] = [];
  try {
    const stophighData = await readJson<{ ranking?: CardStock[] }>("data/stophigh_cards.json");
    shRows = stophighData.ranking ?? [];
  } catch (e) {
    console.error("stophigh_cards.json read failed:", e);
  }

  const meta = cardsData._meta;
  const excludedCodes = new Set<string>(excluded.map((e) => e.code));
  const rows = cardsData.ranking
    .filter((r) => !excludedCodes.has(r.code))
    .slice(0, 30)
    .map((r) => ({
      ...r,
      // J-Quants側は5文字(例:35590)、JPX側は4文字(例:3559)のため先頭4文字でjoin
      // 数値変換は一切しない（文字列スライスのみ）
      creditType: CREDIT_LABEL[marginStocks[r.code.slice(0, 4)]] ?? "-",
    }));

  // ---- PickUp（pullback）用データ（必須: popular.json / popular_cards.json） ----
  const popularData = await readJson<{ _meta?: { date?: string }; popular: Row[] }>(
    "data/popular.json"
  );
  const popularCardsData = await readJson<{ ranking: CardStock[] }>("data/popular_cards.json");

  const pullbackMeta = popularData._meta ?? null;
  const cardByCode = new Map<string, CardStock>(
    popularCardsData.ranking.map((c) => [c.code, c])
  );

  const base = popularData.popular.filter(
    (r) =>
      !excludedCodes.has(r.code) &&
      r.turnover_50 >= MIN_TURNOVER_50 &&
      classify(r) !== "対象外"
  );

  const pullbackSections = new Map<StateLabel, PullbackItem[]>(
    STATE_CONFIG.map((s) => [s.label, []])
  );
  for (const row of base) {
    const card = cardByCode.get(row.code);
    if (!card) continue; // 生成漏れ（通常発生しない）
    pullbackSections.get(classify(row))!.push({ row, card });
  }
  for (const items of pullbackSections.values()) {
    items.sort((a, b) => (b.row.turnover_50 ?? 0) - (a.row.turnover_50 ?? 0));
  }

  return (
    <PickupClient
      rows={rows}
      shRows={shRows}
      meta={meta ?? null}
      excluded={excluded}
      pullbackSections={pullbackSections}
      pullbackMeta={pullbackMeta}
    />
  );
}
