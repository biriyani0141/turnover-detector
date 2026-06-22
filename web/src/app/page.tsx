"use client";
import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import type { CardStock } from "../components/TurnoverCard";

const TurnoverCardList = dynamic(
  () => import("../components/TurnoverCardList"),
  { ssr: false }
);

type Excluded = {
  code: string;
  name: string;
  reason: string;
};

export default function Home() {
  const [rows, setRows] = useState<CardStock[] | null>(null);
  const [shRows, setShRows] = useState<CardStock[] | null>(null);
  const [meta, setMeta] = useState<{ date?: string } | null>(null);
  const [excluded, setExcluded] = useState<Excluded[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [mode, setMode] = useState<"turnover" | "stophigh">("turnover");

  // 信用区分の表示ラベルへのマッピング（文字列完全一致）
  const CREDIT_LABEL: Record<string, string> = {
    "貸借銘柄": "貸借",
    "制度信用銘柄": "信用",
    // "非制度信用銘柄" は表示しない
  };

  useEffect(() => {
    Promise.all([
      fetch("/data/ranking_cards.json").then((r) => {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      }),
      fetch("/data/excluded.json")
        .then((r) => {
          if (!r.ok) throw new Error("HTTP " + r.status);
          return r.json();
        })
        .catch(() => ({ excluded: [] })),
      fetch("/data/margin_list.json")
        .then((r) => (r.ok ? r.json() : { stocks: {} }))
        .catch(() => ({ stocks: {} })),
      fetch("/data/stophigh_cards.json")
        .then((r) => (r.ok ? r.json() : { ranking: [] }))
        .catch(() => ({ ranking: [] })),
    ])
      .then(([cardsData, excludedData, marginData, stophighData]) => {
        setMeta(cardsData._meta);
        const excludedCodes = new Set<string>(
          (excludedData.excluded ?? []).map((e: Excluded) => e.code)
        );
        setExcluded(excludedData.excluded ?? []);
        const marginStocks: Record<string, string> = marginData.stocks ?? {};
        const filtered = (cardsData.ranking as CardStock[])
          .filter((r) => !excludedCodes.has(r.code))
          .slice(0, 30)
          .map((r) => ({
            ...r,
            // J-Quants側は5文字(例:35590)、JPX側は4文字(例:3559)のため先頭4文字でjoin
            // 数値変換は一切しない（文字列スライスのみ）
            creditType: CREDIT_LABEL[marginStocks[r.code.slice(0, 4)]] ?? "-",
          }));
        setRows(filtered);
        setShRows((stophighData.ranking as CardStock[]) ?? []);
      })
      .catch((e) => setErr(String(e)));
  }, []);

  if (err) return <pre className="p-4 text-red-600">ERROR: {err}</pre>;
  if (!rows) return <div className="p-4">loading...</div>;

  const displayRows = mode === "turnover" ? rows : shRows ?? [];

  return (
    <div className="p-3">
      {/* ヘッダー */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 12,
          fontFamily: "'Inter', 'Helvetica Neue', Arial, sans-serif",
        }}
      >
        <div style={{ display: "flex", gap: 8, flex: 1, marginRight: 12 }}>
          <button
            onClick={() => setMode("turnover")}
            style={{
              flex: 1,
              padding: "9px 0",
              borderRadius: 9999,
              fontFamily: "ui-monospace, monospace",
              fontVariantNumeric: "tabular-nums",
              fontSize: 14,
              transition: "background 0.15s, color 0.15s, border-color 0.15s",
              background: mode === "turnover" ? "#3c4043" : "#282a2d",
              border: `1px solid ${mode === "turnover" ? "#5f6368" : "#3c4043"}`,
              color: mode === "turnover" ? "#e8eaed" : "#8e8e93",
              fontWeight: mode === "turnover" ? 600 : 500,
            }}
          >
            Volume%
          </button>
          <button
            onClick={() => setMode("stophigh")}
            style={{
              flex: 1,
              padding: "9px 0",
              borderRadius: 9999,
              fontFamily: "ui-monospace, monospace",
              fontVariantNumeric: "tabular-nums",
              fontSize: 14,
              transition: "background 0.15s, color 0.15s, border-color 0.15s",
              background: mode === "stophigh" ? "#3c4043" : "#282a2d",
              border: `1px solid ${mode === "stophigh" ? "#5f6368" : "#3c4043"}`,
              color: mode === "stophigh" ? "#e8eaed" : "#8e8e93",
              fontWeight: mode === "stophigh" ? 600 : 500,
            }}
          >
            Stop High
          </button>
        </div>
        <div
          style={{
            fontSize: 11,
            color: "#707A8A",
            fontVariantNumeric: "tabular-nums",
            letterSpacing: "0.01em",
          }}
        >
          {meta?.date}
          <span style={{ margin: "0 4px" }}>·</span>
          <span style={{ fontWeight: 600 }}>
            {mode === "turnover" ? "TOP30" : `${displayRows.length}件`}
          </span>
        </div>
      </div>

      <TurnoverCardList stocks={displayRows} />

      {excluded.length > 0 && (
        <div className="mt-8 pt-4 border-t border-gray-200">
          <p className="text-xs font-medium text-gray-500 mb-1">
            除外銘柄（手動）
          </p>
          <p className="text-[10px] text-gray-400 mb-2">
            以下は構造的ノイズとして一覧から除外中
          </p>
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
