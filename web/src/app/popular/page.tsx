"use client";
import { useEffect, useState, useMemo } from "react";

type Row = {
  code: string;
  name: string;
  mktcap_oku: number | null;
  first_date: string;
  ret_1d: number | null;
  ret_5d: number | null;
  ret_1m: number | null;
  ret_3m: number | null;
  [key: string]: any;
};

type Excluded = { code: string; name: string; reason: string };

const WIN_OPTIONS = [25, 50, 100, 200] as const;
type Win = (typeof WIN_OPTIONS)[number];

const CAP_FILTERS = [
  { label: "全部", key: "all" },
  { label: "100億以下", key: "le100" },
  { label: "300億以下", key: "le300" },
  { label: "1000億以下", key: "le1000" },
  { label: "2000億以下", key: "le2000" },
  { label: "2000億以上", key: "ge2000" },
] as const;
type CapFilter = (typeof CAP_FILTERS)[number]["key"];

function pct(v: number | null): string {
  return v === null || v === undefined ? "-" : v.toFixed(1) + "%";
}
function colorOf(v: number | null): string {
  if (v === null || v === undefined) return "text-gray-400";
  if (v > 0) return "text-green-600";
  if (v < 0) return "text-red-600";
  return "text-gray-600";
}
function fmtCap(v: number | null): string {
  if (v === null || v === undefined) return "-";
  return v.toLocaleString("ja-JP", { maximumFractionDigits: 0 }) + "億";
}
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

export default function PopularPage() {
  const [allData, setAllData] = useState<Row[] | null>(null);
  const [meta, setMeta] = useState<any>(null);
  const [excluded, setExcluded] = useState<Excluded[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [win, setWin] = useState<Win>(25);
  const [capFilter, setCapFilter] = useState<CapFilter>("all");

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
        .catch((e) => {
          console.error("excluded.json fetch failed:", e);
          return { excluded: [] };
        }),
    ])
      .then(([popularData, excludedData]) => {
        setMeta(popularData._meta);
        setAllData(popularData.popular);
        setExcluded(excludedData.excluded ?? []);
      })
      .catch((e) => setErr(String(e)));
  }, []);

  const rows = useMemo(() => {
    if (!allData) return null;
    const excludedCodes = new Set(excluded.map((e) => e.code));
    return allData
      .filter((r) => !excludedCodes.has(r.code))
      .filter((r) => applyCapFilter(r, capFilter))
      .sort((a, b) => (b[`turnover_${win}`] ?? 0) - (a[`turnover_${win}`] ?? 0))
      .slice(0, 50);
  }, [allData, excluded, win, capFilter]);

  if (err) return <pre className="p-4 text-red-600">ERROR: {err}</pre>;
  if (!rows) return <div className="p-4">loading...</div>;

  const headers = ["銘柄", "出現:S高", "1d", "5d", "1m", "3m", "時価総額"];

  return (
    <div className="p-3">
      <h1 className="text-base font-bold mb-1">人気継続（出現＋S高）</h1>
      <p className="text-xs text-gray-500 mb-3">{meta?.date} ／ 上位50件</p>

      {/* 窓切替 */}
      <div className="flex flex-wrap gap-1 mb-2">
        {WIN_OPTIONS.map((w) => (
          <button
            key={w}
            onClick={() => setWin(w)}
            className={`px-3 py-1 text-xs rounded border ${
              win === w
                ? "bg-gray-800 text-white border-gray-800"
                : "bg-white text-gray-600 border-gray-300"
            }`}
          >
            {w}日
          </button>
        ))}
      </div>

      {/* 時価総額フィルタ */}
      <div className="flex flex-wrap gap-1 mb-3">
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

      {/* テーブル */}
      <div className="overflow-x-auto">
        <table className="text-xs border-collapse w-full">
          <thead>
            <tr className="border-b border-gray-300 text-gray-600">
              {headers.map((h) => (
                <th
                  key={h}
                  className="px-2 py-1 text-right whitespace-nowrap first:text-left"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const t = (r as any)[`turnover_${win}`] ?? 0;
              const s = (r as any)[`stophigh_${win}`] ?? 0;
              return (
                <tr key={r.code} className="border-b border-gray-100">
                  <td className="px-2 py-1 text-left whitespace-nowrap">
                    <div className="font-medium">{r.name}</div>
                    <div className="text-[10px] text-gray-400">{r.code}</div>
                  </td>
                  <td className="px-2 py-1 text-right whitespace-nowrap">
                    <span>{t}:</span>
                    <span className={s >= 1 ? "text-orange-500 font-semibold" : ""}>
                      {s}
                    </span>
                  </td>
                  <td className={"px-2 py-1 text-right " + colorOf(r.ret_1d)}>{pct(r.ret_1d)}</td>
                  <td className={"px-2 py-1 text-right " + colorOf(r.ret_5d)}>{pct(r.ret_5d)}</td>
                  <td className={"px-2 py-1 text-right " + colorOf(r.ret_1m)}>{pct(r.ret_1m)}</td>
                  <td className={"px-2 py-1 text-right " + colorOf(r.ret_3m)}>{pct(r.ret_3m)}</td>
                  <td className="px-2 py-1 text-right whitespace-nowrap">{fmtCap(r.mktcap_oku)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* 除外銘柄注記 */}
      {excluded.length > 0 && (
        <div className="mt-8 pt-4 border-t border-gray-200">
          <p className="text-xs font-medium text-gray-500 mb-1">除外銘柄（手動）</p>
          <p className="text-[10px] text-gray-400 mb-2">以下は構造的ノイズとして一覧から除外中</p>
          {excluded.map((e) => (
            <div key={e.code} className="text-[10px] text-gray-400 leading-5">
              {e.code} {e.name} ― {e.reason}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
