// ─── 定数（判定ロジック・変更禁止） ───────────────────────────────────────────
export const NEUTRAL_PCT = 2.0;
export const MIN_TURNOVER_50 = 20;

// ─── 型 ──────────────────────────────────────────────────────────────────────
export type Row = {
  code: string;
  name: string;
  close: number | null;
  mktcap_oku: number | null;
  turnover_50: number;
  ret_1d: number | null;
  ret_5d: number | null;
  ret_1m: number | null;
  ret_3m: number | null;
  ret_1y: number | null;
};

export type StateLabel =
  | "調整"
  | "調整予備軍"
  | "短期押し目"
  | "継続"
  | "初動・再加速"
  | "中立帯"
  | "失速"
  | "対象外";

// ─── 状態セクション設定（ダーク用） ───────────────────────────────────────────
export const STATE_CONFIG: {
  label: StateLabel;
  headerBg: string;
}[] = [
  { label: "継続",        headerBg: "bg-emerald-700" },
  { label: "初動・再加速", headerBg: "bg-orange-600"  },
  { label: "短期押し目", headerBg: "bg-teal-700"    },
  { label: "調整",      headerBg: "bg-blue-700"    },
  { label: "調整予備軍", headerBg: "bg-sky-700"     },
  { label: "中立帯",    headerBg: "bg-gray-700"    },
  { label: "失速",      headerBg: "bg-red-700"     },
];

// ─── 状態判定ロジック（変更禁止） ─────────────────────────────────────────────
export function tri(v: number | null): "+" | "0" | "-" | null {
  if (v === null || v === undefined) return null;
  if (v >= NEUTRAL_PCT)  return "+";
  if (v <= -NEUTRAL_PCT) return "-";
  return "0";
}

// 手前15営業日リターン（20日前→5日前）と、直近5日の加速度
export function calcAccel(r: Row): number | null {
  if (r.ret_1m === null || r.ret_5d === null) return null;
  const mid15d = (1 + r.ret_1m / 100) / (1 + r.ret_5d / 100) - 1; // 比率（小数）
  const accel = r.ret_5d / 100 - mid15d; // 小数ベースで統一
  return accel * 100; // %に戻して返す
}

export function classify(r: Row): StateLabel {
  const s1y = tri(r.ret_1y);
  const s3m = tri(r.ret_3m);
  const s1m = tri(r.ret_1m);
  const s5d = tri(r.ret_5d);

  if (s1y === null || s3m === null || s1m === null || s5d === null) return "対象外";

  if (s1y === "+" && s3m === "+" && s1m === "-")                               return "調整";
  if (s1y === "+" && s3m === "+" && s1m === "0")                               return "調整予備軍";
  if (s1y === "+" && s3m === "+" && s1m === "+" && s5d === "-")                return "短期押し目";
  if (s1y === "+" && s3m === "+" && s1m === "+" && (s5d === "+" || s5d === "0")) {
    const accel = calcAccel(r);
    if (r.ret_5d !== null && r.ret_5d >= 15 && accel !== null && accel >= 5) {
      return "初動・再加速";
    }
    return "継続";
  }
  if (s1y === "+" && s3m === "0")                                               return "中立帯";
  if (s1y === "+" && s3m === "-")                                               return "失速";

  return "対象外";
}

// ─── 4ゲート判定（大型/大相場/初動/常連・OR結合） ─────────────────────────────
export const GATE_LABELS = ["大型", "大相場", "初動", "常連"] as const;
export type GateLabel = typeof GATE_LABELS[number];

// 渡された母集団（excluded適用後）内で mktcap_oku 降順にランク付けする（null は対象外）
export function computeMktcapRanks(rows: Row[]): Map<string, number> {
  const ranked = rows
    .filter((r): r is Row & { mktcap_oku: number } => r.mktcap_oku !== null)
    .slice()
    .sort((a, b) => b.mktcap_oku - a.mktcap_oku);
  const ranks = new Map<string, number>();
  ranked.forEach((r, i) => ranks.set(r.code, i + 1));
  return ranks;
}

// jquants_ranking.py の _pullback_gates() と同一ロジック
export function computeGates(r: Row, mktcapRank: number | null): GateLabel[] {
  const classification = classify(r);
  const ret1y = r.ret_1y ?? -Infinity;
  const gates: GateLabel[] = [];

  if (
    mktcapRank !== null &&
    mktcapRank <= 100 &&
    ret1y >= 100 &&
    ["継続", "短期押し目", "調整", "調整予備軍"].includes(classification)
  ) {
    gates.push("大型");
  }

  if (
    ret1y >= 200 &&
    classification !== "失速" &&
    classification !== "対象外" &&
    r.turnover_50 >= 10
  ) {
    gates.push("大相場");
  }

  if (classification === "初動・再加速") {
    gates.push("初動");
  }

  if (r.turnover_50 >= MIN_TURNOVER_50 && classification !== "対象外") {
    gates.push("常連");
  }

  return gates;
}
