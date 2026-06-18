"use client";
import { useEffect, useState, useMemo } from "react";

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

// ─── 状態セクション設定（ダーク用） ───────────────────────────────────────────
const STATE_CONFIG: {
  label: StateLabel;
  headerBg: string;
}[] = [
  { label: "調整",      headerBg: "bg-blue-700"    },
  { label: "調整予備軍", headerBg: "bg-sky-700"     },
  { label: "短期押し目", headerBg: "bg-teal-700"    },
  { label: "加速中",    headerBg: "bg-emerald-700" },
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
  if (s1y === "+" && s3m === "-")                                               return "失速";

  return "対象外";
}

// ─── 表示ユーティリティ ───────────────────────────────────────────────────────
function pct(v: number | null): string {
  return v === null || v === undefined ? "-" : v.toFixed(1) + "%";
}

// 日本式：プラス=赤、マイナス=緑（暗背景向け明度）
function retColor(v: number | null): string {
  if (v === null || v === undefined) return "text-gray-500";
  if (v >= NEUTRAL_PCT)  return "text-red-400";
  if (v <= -NEUTRAL_PCT) return "text-green-400";
  return "text-gray-500";
}

// 株価：10000円以上は万表記でコンパクト化
function fmtClose(v: number | null): string {
  if (v === null || v === undefined) return "-";
  if (v >= 10000) return (v / 10000).toFixed(1) + "万";
  return Math.round(v).toLocaleString("ja-JP");
}

// 時価総額：億のみ表示（カンマなし）
function fmtCap(v: number | null): string {
  if (v === null || v === undefined) return "-";
  return Math.round(v).toLocaleString("ja-JP");
}

// 銘柄名短縮：HD化・G化・8文字超を省略
function shortName(name: string): string {
  let s = name
    .replace(/ホールディングス/g, "HD")
    .replace(/ホールディング/g, "HD")
    .replace(/グループ/g, "G");
  if (s.length > 9) s = s.slice(0, 8) + "…";
  return s;
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

  const totalBase = [...(classified?.values() ?? [])].flat().length;
  const offCount  = sections.get("対象外")?.length ?? 0;

  return (
    <div className="min-h-screen bg-slate-900 text-gray-100 p-2">
      <h1 className="text-sm font-bold mb-0.5 text-gray-100">押し目発見（状態別）</h1>
      <p className="text-[10px] text-gray-500 mb-2">
        {meta?.date}　母集団 {totalBase} 銘柄（t50≥20）
      </p>

      {/* 時価総額フィルタ */}
      <div className="flex flex-wrap gap-1 mb-3">
        {CAP_FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setCapFilter(f.key)}
            className={`px-2 py-0.5 text-[10px] rounded border ${
              capFilter === f.key
                ? "bg-blue-600 text-white border-blue-500"
                : "bg-slate-700 text-gray-300 border-slate-600"
            }`}
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
          <div key={label} className="mb-4 rounded overflow-hidden border border-slate-700">
            {/* 色帯ヘッダ */}
            <div className={`px-2 py-1 ${headerBg} text-white text-xs font-bold flex items-center gap-2`}>
              <span>{label}</span>
              <span className="font-normal text-[10px] opacity-80">{rows.length} 件</span>
            </div>
            {/* テーブル */}
            <div className="bg-slate-800">
              <table className="text-[11px] border-collapse w-full">
                <thead>
                  <tr className="border-b border-slate-700 text-gray-400">
                    <th className="px-1 py-0.5 text-left">銘柄</th>
                    <th className="px-1 py-0.5 text-right whitespace-nowrap">株価</th>
                    <th className="px-1 py-0.5 text-right">1d</th>
                    <th className="px-1 py-0.5 text-right">5d</th>
                    <th className="px-1 py-0.5 text-right">1m</th>
                    <th className="px-1 py-0.5 text-right">3m</th>
                    <th className="px-1 py-0.5 text-right">1y</th>
                    <th className="px-1 py-0.5 text-right whitespace-nowrap">億</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.code} className="border-b border-slate-700">
                      <td className="px-1 py-0.5 text-left">
                        <div className="text-gray-100 leading-tight">{shortName(r.name)}</div>
                        <div className="text-[9px] text-gray-500 leading-tight">{r.code}</div>
                      </td>
                      <td className="px-1 py-0.5 text-right whitespace-nowrap text-gray-200">
                        {fmtClose(r.close)}
                      </td>
                      <td className={"px-1 py-0.5 text-right whitespace-nowrap " + retColor(r.ret_1d)}>
                        {pct(r.ret_1d)}
                      </td>
                      <td className={"px-1 py-0.5 text-right whitespace-nowrap " + retColor(r.ret_5d)}>
                        {pct(r.ret_5d)}
                      </td>
                      <td className={"px-1 py-0.5 text-right whitespace-nowrap " + retColor(r.ret_1m)}>
                        {pct(r.ret_1m)}
                      </td>
                      <td className={"px-1 py-0.5 text-right whitespace-nowrap " + retColor(r.ret_3m)}>
                        {pct(r.ret_3m)}
                      </td>
                      <td className={"px-1 py-0.5 text-right whitespace-nowrap " + retColor(r.ret_1y)}>
                        {pct(r.ret_1y)}
                      </td>
                      <td className="px-1 py-0.5 text-right whitespace-nowrap text-gray-400">
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
      <p className="text-[10px] text-gray-600 mt-1">
        対象外（中期データ不足・中立帯等）: {offCount} 件
      </p>
    </div>
  );
}
