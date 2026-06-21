"use client";
import { useEffect, useState, useMemo } from "react";
import { StockRow, StockRowHeader } from "../_components/StockRow";

// ─── 定数（判定ロジック・変更禁止） ───────────────────────────────────────────
const NEUTRAL_PCT = 2.0;
const MIN_TURNOVER_50 = 20;

// ─── 型 ──────────────────────────────────────────────────────────────────────
type Row = {
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

type StateLabel =
  | "調整"
  | "調整予備軍"
  | "短期押し目"
  | "加速中"
  | "中立帯"
  | "失速"
  | "対象外";

type Excluded = { code: string; name: string; reason: string };

// ─── 時価総額フィルタ ─────────────────────────────────────────────────────────
const CAP_FILTERS = [
  { label: "100↓", key: "le100"  },
  { label: "300↓", key: "le300"  },
  { label: "1000↓", key: "le1000" },
  { label: "1000↑", key: "ge1000" },
] as const;
type CapFilter = "all" | (typeof CAP_FILTERS)[number]["key"];

function applyCapFilter(row: Row, cap: CapFilter): boolean {
  if (cap === "all") return true;
  if (row.mktcap_oku === null) return false;
  if (cap === "le100")  return row.mktcap_oku <= 100;
  if (cap === "le300")  return row.mktcap_oku <= 300;
  if (cap === "le1000") return row.mktcap_oku <= 1000;
  if (cap === "ge1000") return row.mktcap_oku >= 1000;
  return true;
}

// ─── 状態セクション設定（ダーク用） ───────────────────────────────────────────
const STATE_CONFIG: {
  label: StateLabel;
  headerBg: string;
}[] = [
  { label: "加速中",    headerBg: "bg-emerald-700" },
  { label: "短期押し目", headerBg: "bg-teal-700"    },
  { label: "調整",      headerBg: "bg-blue-700"    },
  { label: "調整予備軍", headerBg: "bg-sky-700"     },
  { label: "中立帯",    headerBg: "bg-gray-700"    },
  { label: "失速",      headerBg: "bg-red-700"     },
];

// ─── 状態判定ロジック（変更禁止） ─────────────────────────────────────────────
function tri(v: number | null): "+" | "0" | "-" | null {
  if (v === null || v === undefined) return null;
  if (v >= NEUTRAL_PCT)  return "+";
  if (v <= -NEUTRAL_PCT) return "-";
  return "0";
}

function classify(r: Row): StateLabel {
  const s1y = tri(r.ret_1y);
  const s3m = tri(r.ret_3m);
  const s1m = tri(r.ret_1m);
  const s5d = tri(r.ret_5d);

  if (s1y === null || s3m === null || s1m === null || s5d === null) return "対象外";

  if (s1y === "+" && s3m === "+" && s1m === "-")                               return "調整";
  if (s1y === "+" && s3m === "+" && s1m === "0")                               return "調整予備軍";
  if (s1y === "+" && s3m === "+" && s1m === "+" && s5d === "-")                return "短期押し目";
  if (s1y === "+" && s3m === "+" && s1m === "+" && (s5d === "+" || s5d === "0")) return "加速中";
  if (s1y === "+" && s3m === "0")                                               return "中立帯";
  if (s1y === "+" && s3m === "-")                                               return "失速";

  return "対象外";
}

// ─── メインコンポーネント ─────────────────────────────────────────────────────
export default function PullbackPage() {
  const [allData, setAllData]             = useState<Row[] | null>(null);
  const [meta, setMeta]                   = useState<{ date: string } | null>(null);
  const [excludedCodes, setExcludedCodes] = useState<Set<string>>(new Set());
  const [err, setErr]                     = useState<string | null>(null);
  const [capFilter, setCapFilter]         = useState<CapFilter>("all");

  useEffect(() => {
    Promise.all([
      fetch("/data/popular.json").then((r) => {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      }),
      fetch("/data/excluded.json")
        .then((r) => {
          if (!r.ok) throw new Error("HTTP " + r.status);
          return r.json();
        })
        .catch(() => ({ excluded: [] })),
    ])
      .then(([popularData, excludedData]) => {
        setMeta(popularData._meta);
        setAllData(popularData.popular);
        setExcludedCodes(
          new Set((excludedData.excluded as Excluded[]).map((e) => e.code))
        );
      })
      .catch((e) => setErr(String(e)));
  }, []);

  // 母集団フィルタ＋状態分類（capFilter前）
  const classified = useMemo<Map<StateLabel, Row[]> | null>(() => {
    if (!allData) return null;

    const base = allData.filter(
      (r) => !excludedCodes.has(r.code) && r.turnover_50 >= MIN_TURNOVER_50
    );

    const labels: StateLabel[] = [
      ...STATE_CONFIG.map((s) => s.label),
      "対象外",
    ];
    const map = new Map<StateLabel, Row[]>(labels.map((l) => [l, []]));

    for (const row of base) {
      map.get(classify(row))!.push(row);
    }
    for (const rows of map.values()) {
      rows.sort((a, b) => (b.turnover_50 ?? 0) - (a.turnover_50 ?? 0));
    }
    return map;
  }, [allData, excludedCodes]);

  // capFilter を全セクション一括適用
  const sections = useMemo<Map<StateLabel, Row[]> | null>(() => {
    if (!classified) return null;
    const result = new Map<StateLabel, Row[]>();
    for (const [state, rows] of classified) {
      result.set(state, rows.filter((r) => applyCapFilter(r, capFilter)));
    }
    return result;
  }, [classified, capFilter]);

  if (err)       return <pre className="p-4 text-red-400 bg-slate-900 min-h-screen">ERROR: {err}</pre>;
  if (!sections) return <div className="p-4 bg-slate-900 text-gray-400 min-h-screen">loading...</div>;

  const offCount  = sections.get("対象外")?.length ?? 0;

  return (
    <div style={{ backgroundColor: "#17171a", minHeight: "100vh", paddingTop: 12, paddingBottom: 12 }}>
      <h1 className="text-sm font-bold mb-0.5 text-gray-100" style={{ paddingLeft: 16, paddingRight: 16 }}>pickup</h1>
      <p className="text-[10px] text-gray-500 mb-2" style={{ paddingLeft: 16, paddingRight: 16 }}>
        {meta?.date}
      </p>

      {/* 時価総額フィルタ */}
      <div style={{ display: "flex", gap: 6, marginBottom: 12, paddingLeft: 16, paddingRight: 16 }}>
        {CAP_FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setCapFilter(capFilter === f.key ? "all" : f.key)}
            style={{
              flex: 1,
              padding: "7px 0",
              borderRadius: 8,
              fontFamily: "ui-monospace, monospace",
              fontVariantNumeric: "tabular-nums",
              fontSize: 13,
              fontWeight: 600,
              transition: "background 0.15s, color 0.15s",
              background: capFilter === f.key ? "#fff" : "#2c2c2e",
              color: capFilter === f.key ? "#000" : "#8e8e93",
              border: "none",
            }}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* 状態セクション */}
      {STATE_CONFIG.map(({ label, headerBg }) => {
        const rows = sections.get(label) ?? [];
        if (rows.length === 0) return null;
        return (
          <div key={label} className="mb-4">
            {/* 色帯ヘッダ */}
            <div className={`py-1 ${headerBg} text-white text-xs font-bold flex items-center gap-2`} style={{ paddingLeft: 16, paddingRight: 16 }}>
              <span>{label}</span>
              <span className="font-normal text-[10px] opacity-80">{rows.length} 件</span>
            </div>
            {/* v3行 */}
            <div style={{ backgroundColor: "#17171a" }}>
              <StockRowHeader />
              {rows.map((r, i) => (
                <StockRow
                  key={r.code}
                  name={r.name}
                  code={r.code}
                  mktcap_oku={r.mktcap_oku}
                  close={r.close}
                  ret_1d={r.ret_1d}
                  ret_5d={r.ret_5d}
                  ret_1m={r.ret_1m}
                  ret_3m={r.ret_3m}
                  ret_1y={r.ret_1y}
                  occLeft={r.turnover_50}
                  occRight={0}
                  isEven={i % 2 === 1}
                />
              ))}
            </div>
          </div>
        );
      })}

      {/* 対象外 件数注記 */}
      <p className="text-[10px] text-gray-600 mt-1" style={{ paddingLeft: 16, paddingRight: 16 }}>
        対象外（中期データ不足等）: {offCount} 件
      </p>
    </div>
  );
}
