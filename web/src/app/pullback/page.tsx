"use client";
import { useEffect, useState, useMemo } from "react";

// ─── 定数 ────────────────────────────────────────────────────────────────────
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
  | "失速"
  | "対象外";

type Excluded = { code: string; name: string; reason: string };

// ─── 時価総額フィルタ ─────────────────────────────────────────────────────────
const CAP_FILTERS = [
  { label: "全部",       key: "all"    },
  { label: "100億以下",  key: "le100"  },
  { label: "300億以下",  key: "le300"  },
  { label: "1000億以下", key: "le1000" },
  { label: "2000億以下", key: "le2000" },
  { label: "2000億以上", key: "ge2000" },
] as const;
type CapFilter = (typeof CAP_FILTERS)[number]["key"];

function applyCapFilter(row: Row, cap: CapFilter): boolean {
  if (cap === "all") return true;
  if (row.mktcap_oku === null) return false;
  if (cap === "le100")  return row.mktcap_oku <= 100;
  if (cap === "le300")  return row.mktcap_oku <= 300;
  if (cap === "le1000") return row.mktcap_oku <= 1000;
  if (cap === "le2000") return row.mktcap_oku <= 2000;
  if (cap === "ge2000") return row.mktcap_oku >= 2000;
  return true;
}

// ─── 状態セクション設定 ──────────────────────────────────────────────────────
const STATE_CONFIG: {
  label: StateLabel;
  headerColor: string;
  borderColor: string;
  bgColor: string;
}[] = [
  { label: "調整",      headerColor: "text-blue-700",    borderColor: "border-blue-300",    bgColor: "bg-blue-50"    },
  { label: "調整予備軍", headerColor: "text-sky-700",     borderColor: "border-sky-300",     bgColor: "bg-sky-50"     },
  { label: "短期押し目", headerColor: "text-teal-700",    borderColor: "border-teal-300",    bgColor: "bg-teal-50"    },
  { label: "加速中",    headerColor: "text-emerald-700", borderColor: "border-emerald-300", bgColor: "bg-emerald-50" },
  { label: "失速",      headerColor: "text-red-700",     borderColor: "border-red-300",     bgColor: "bg-red-50"     },
];

// ─── 状態判定ロジック ─────────────────────────────────────────────────────────
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

  if (s1y === "+" && s3m === "+" && s1m === "-")                              return "調整";
  if (s1y === "+" && s3m === "+" && s1m === "0")                              return "調整予備軍";
  if (s1y === "+" && s3m === "+" && s1m === "+" && s5d === "-")               return "短期押し目";
  if (s1y === "+" && s3m === "+" && s1m === "+" && (s5d === "+" || s5d === "0")) return "加速中";
  if (s1y === "+" && s3m === "-")                                              return "失速";

  return "対象外";
}

// ─── 表示ユーティリティ ───────────────────────────────────────────────────────
function pct(v: number | null): string {
  return v === null || v === undefined ? "-" : v.toFixed(1) + "%";
}

// 日本式：プラス=赤、マイナス=緑、中立帯=グレー
function retColor(v: number | null): string {
  if (v === null || v === undefined) return "text-gray-400";
  if (v >= NEUTRAL_PCT)  return "text-red-600";
  if (v <= -NEUTRAL_PCT) return "text-green-600";
  return "text-gray-400";
}

function fmtClose(v: number | null): string {
  if (v === null || v === undefined) return "-";
  return v.toLocaleString("ja-JP");
}

function fmtCap(v: number | null): string {
  if (v === null || v === undefined) return "-";
  return v.toLocaleString("ja-JP", { maximumFractionDigits: 0 }) + "億";
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

  if (err)       return <pre className="p-4 text-red-600">ERROR: {err}</pre>;
  if (!sections) return <div className="p-4">loading...</div>;

  const totalBase = [...(classified?.values() ?? [])].flat().length;
  const offCount  = sections.get("対象外")?.length ?? 0;

  return (
    <div className="p-3">
      <h1 className="text-base font-bold mb-1">押し目発見（状態別）</h1>
      <p className="text-xs text-gray-500 mb-3">
        {meta?.date}　／　母集団 {totalBase} 銘柄（t50≥20）
      </p>

      {/* 時価総額フィルタ */}
      <div className="flex flex-wrap gap-1 mb-4">
        {CAP_FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setCapFilter(f.key)}
            className={`px-3 py-1 text-xs rounded border ${
              capFilter === f.key
                ? "bg-blue-600 text-white border-blue-600"
                : "bg-white text-gray-600 border-gray-300"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* 状態セクション */}
      {STATE_CONFIG.map(({ label, headerColor, borderColor, bgColor }) => {
        const rows = sections.get(label) ?? [];
        if (rows.length === 0) return null;
        return (
          <div key={label} className={`mb-5 rounded border ${borderColor} ${bgColor}`}>
            <div className={`px-3 py-2 font-bold text-sm ${headerColor}`}>
              {label}
              <span className="ml-2 font-normal text-xs text-gray-500">
                {rows.length} 件
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="text-xs border-collapse w-full">
                <thead>
                  <tr className="border-b border-gray-200 text-gray-500">
                    {["銘柄", "現在価格", "1d", "5d", "1m", "3m", "1y", "時価総額"].map(
                      (h) => (
                        <th
                          key={h}
                          className="px-2 py-1 text-right whitespace-nowrap first:text-left"
                        >
                          {h}
                        </th>
                      )
                    )}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.code} className="border-b border-gray-100">
                      <td className="px-2 py-1 text-left whitespace-nowrap">
                        <div className="font-medium">{r.name}</div>
                        <div className="text-[10px] text-gray-400">{r.code}</div>
                      </td>
                      <td className="px-2 py-1 text-right whitespace-nowrap">
                        {fmtClose(r.close)}
                      </td>
                      <td className={"px-2 py-1 text-right " + retColor(r.ret_1d)}>
                        {pct(r.ret_1d)}
                      </td>
                      <td className={"px-2 py-1 text-right " + retColor(r.ret_5d)}>
                        {pct(r.ret_5d)}
                      </td>
                      <td className={"px-2 py-1 text-right " + retColor(r.ret_1m)}>
                        {pct(r.ret_1m)}
                      </td>
                      <td className={"px-2 py-1 text-right " + retColor(r.ret_3m)}>
                        {pct(r.ret_3m)}
                      </td>
                      <td className={"px-2 py-1 text-right " + retColor(r.ret_1y)}>
                        {pct(r.ret_1y)}
                      </td>
                      <td className="px-2 py-1 text-right whitespace-nowrap">
                        {fmtCap(r.mktcap_oku)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}

      {/* 対象外 件数注記 */}
      <p className="text-[10px] text-gray-400 mt-2">
        対象外（中期データ不足・中立帯等）: {offCount} 件
      </p>
    </div>
  );
}
