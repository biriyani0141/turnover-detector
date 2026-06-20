"use client";
import { useEffect, useState, useMemo } from "react";
import { StockRow, StockRowHeader } from "../_components/StockRow";

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

const WIN_OPTIONS = [25, 50, 100, 200] as const;
type Win = (typeof WIN_OPTIONS)[number];

const CAP_FILTERS = [
  { label: "100↓", key: "le100" },
  { label: "300↓", key: "le300" },
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

  return (
    <div style={{ backgroundColor: "#17171a", minHeight: "100vh", paddingTop: 12, paddingBottom: 12 }}>
      <p className="text-xs mb-3" style={{ color: "#71717A", paddingLeft: 16, paddingRight: 16 }}>
        {meta?.date}
      </p>

      {/* 窓切替 */}
      <div style={{ display: "flex", gap: 8, marginBottom: 12, paddingLeft: 16, paddingRight: 16 }}>
        {WIN_OPTIONS.map((w) => (
          <button
            key={w}
            onClick={() => setWin(w)}
            style={{
              flex: 1,
              padding: "9px 0",
              borderRadius: 9999,
              fontFamily: "ui-monospace, monospace",
              fontVariantNumeric: "tabular-nums",
              fontSize: 14,
              transition: "background 0.15s, color 0.15s, border-color 0.15s",
              background: win === w ? "#3c4043" : "#282a2d",
              border: `1px solid ${win === w ? "#5f6368" : "#3c4043"}`,
              color: win === w ? "#e8eaed" : "#8e8e93",
              fontWeight: win === w ? 600 : 500,
            }}
          >
            {w}
          </button>
        ))}
      </div>

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

      {/* リスト */}
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
            occLeft={(r as any)[`turnover_${win}`] ?? 0}
            occRight={(r as any)[`stophigh_${win}`] ?? 0}
            isEven={i % 2 === 1}
          />
        ))}
      </div>

      {/* 除外銘柄注記 */}
      {excluded.length > 0 && (
        <div className="mt-8 pt-4" style={{ borderTop: "1px solid #1F1F23" }}>
          <p className="text-xs font-medium mb-1" style={{ color: "#71717A" }}>
            除外銘柄（手動）
          </p>
          <p className="text-[10px] mb-2" style={{ color: "#52525B" }}>
            以下は構造的ノイズとして一覧から除外中
          </p>
          {excluded.map((e) => (
            <div key={e.code} className="text-[10px] leading-5" style={{ color: "#52525B" }}>
              {e.code} {e.name} ― {e.reason}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
