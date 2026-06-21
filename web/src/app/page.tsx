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
  const [meta, setMeta] = useState<{ date?: string } | null>(null);
  const [excluded, setExcluded] = useState<Excluded[]>([]);
  const [err, setErr] = useState<string | null>(null);

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
        .catch((e) => {
          console.error("excluded.json fetch failed:", e);
          return { excluded: [] };
        }),
    ])
      .then(([cardsData, excludedData]) => {
        setMeta(cardsData._meta);
        const excludedCodes = new Set<string>(
          (excludedData.excluded ?? []).map((e: Excluded) => e.code)
        );
        setExcluded(excludedData.excluded ?? []);
        const filtered = (cardsData.ranking as CardStock[])
          .filter((r) => !excludedCodes.has(r.code))
          .slice(0, 30);
        setRows(filtered);
      })
      .catch((e) => setErr(String(e)));
  }, []);

  if (err) return <pre className="p-4 text-red-600">ERROR: {err}</pre>;
  if (!rows) return <div className="p-4">loading...</div>;

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
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span
            className="material-symbols-rounded"
            style={{
              fontSize: 18,
              color: "#131722",
              fontVariationSettings: "'FILL' 1,'wght' 500,'GRAD' 0,'opsz' 20",
              lineHeight: 1,
            }}
          >
            cycle
          </span>
          <span
            style={{
              fontSize: 15,
              fontWeight: 700,
              color: "#131722",
              letterSpacing: "-0.02em",
            }}
          >
            回転率
          </span>
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
          <span style={{ fontWeight: 600 }}>TOP30</span>
        </div>
      </div>

      <TurnoverCardList stocks={rows} />

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
