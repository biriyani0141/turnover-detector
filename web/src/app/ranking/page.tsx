"use client";
import { useEffect, useMemo, useState } from "react";

type RankingRow = {
  code: string;
  name: string;
  market?: string;
  turnover_pct: number;
  mktcap: number;
  va: number;
  C: number;
  ret_1d: number | null;
  ret_5d: number | null;
  ret_1m: number | null;
  ret_3m: number | null;
  ret_1y: number | null;
};

type Appearance = {
  turnover_50?: number;
  stophigh_50?: number;
};

type RankingData = {
  _meta?: { date?: string; counts?: { all: number; standard: number; growth: number } };
  all: RankingRow[];
  standard: RankingRow[];
  growth: RankingRow[];
};

// J-Quantsのコードは末尾0付き5桁（例: 285A0）。表示は先頭4桁。
function displayCode(code: string): string {
  return code.slice(0, 4);
}

type SubTab = "all" | "standard" | "growth";

const SUB_TABS: { key: SubTab; label: string }[] = [
  { key: "all", label: "全体" },
  { key: "standard", label: "スタンダード" },
  { key: "growth", label: "グロース" },
];

type MktBracket = "all" | "le100" | "le300" | "le1000" | "gt1000";

const MKT_BRACKETS: { key: MktBracket; label: string }[] = [
  { key: "all", label: "全て" },
  { key: "le100", label: "100億↓" },
  { key: "le300", label: "300億↓" },
  { key: "le1000", label: "1000億↓" },
  { key: "gt1000", label: "1000億↑" },
];

function matchesMktBracket(mktcap: number, b: MktBracket): boolean {
  if (b === "all") return true;
  const oku = mktcap / 1e8;
  if (b === "le100") return oku <= 100;
  if (b === "le300") return oku <= 300;
  if (b === "le1000") return oku <= 1000;
  if (b === "gt1000") return oku > 1000;
  return true;
}

// データは生の日本語のまま保持。表示変換のみここで行う。
const MARKET_DISPLAY: Record<string, string> = {
  "プライム": "東証P",
  "スタンダード": "東証S",
  "グロース": "東証G",
};

function fmtMarket(market?: string): string {
  if (!market) return "—";
  return MARKET_DISPLAY[market] ?? market;
}

// 億単位の整数（カンマなし）。兆表記は使わない。
function fmtOku(yen: number | null | undefined): string {
  if (yen === null || yen === undefined) return "—";
  const oku = Math.round(yen / 1e8);
  return String(oku);
}

function fmtRet1d(v: number | null | undefined): { text: string; color: string } {
  if (v === null || v === undefined) return { text: "—", color: "#666" };
  const sign = v >= 0 ? "+" : "";
  return {
    text: `${sign}${v.toFixed(2)}%`,
    color: v >= 0 ? "#E03A2F" : "#1B8C7D",
  };
}

const monoFont = 'ui-monospace,"SF Mono",SFMono-Regular,Menlo,monospace';

// iPhone 15基準(390px)で横スクロールなしに収まることを目標にした列幅
const COL_WIDTH = {
  rank: "20px",
  code: "30px",
  name: "50px",
  market: "32px",
  price: "36px",
  ret1d: "40px",
  va: "38px",
  mktcap: "38px",
  turnover: "32px",
  occ: "24px",
} as const;

// 回転率の色分け（10%以上=赤、5%以上10%未満=オレンジ、5%未満=デフォルト）
function turnoverColor(v: number): string {
  if (v >= 10) return "#ef4444";
  if (v >= 5) return "#fb923c";
  return "#999";
}

const th: React.CSSProperties = {
  position: "sticky",
  top: 0,
  background: "#09090B",
  color: "#71717A",
  fontSize: 10,
  fontWeight: 700,
  fontFamily: monoFont,
  padding: "4px 2px",
  whiteSpace: "nowrap",
  borderBottom: "1px solid #1F1F23",
};

const td: React.CSSProperties = {
  fontSize: 11,
  fontFamily: monoFont,
  fontVariantNumeric: "tabular-nums",
  padding: "4px 2px",
  whiteSpace: "nowrap",
  borderBottom: "1px solid rgba(255,255,255,0.04)",
};

export default function RankingPage() {
  const [rankingData, setRankingData] = useState<RankingData | null>(null);
  const [appearanceByCode, setAppearanceByCode] = useState<Record<string, Appearance>>({});
  const [err, setErr] = useState<string | null>(null);
  const [subTab, setSubTab] = useState<SubTab>("all");
  const [filterTurnover5, setFilterTurnover5] = useState(false);
  const [filterRet10, setFilterRet10] = useState(false);
  const [mktBracket, setMktBracket] = useState<MktBracket>("all");

  useEffect(() => {
    Promise.all([
      fetch("/data/ranking.json").then((r) => {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      }),
      fetch("/data/appearance.json")
        .then((r) => (r.ok ? r.json() : { by_code: {} }))
        .catch(() => ({ by_code: {} })),
    ])
      .then(([rankingData, appearanceData]) => {
        setRankingData(rankingData as RankingData);
        setAppearanceByCode(appearanceData.by_code ?? {});
      })
      .catch((e) => setErr(String(e)));
  }, []);

  const meta = rankingData?._meta;

  const filteredRows = useMemo(() => {
    if (!rankingData) return null;
    const baseArray = rankingData[subTab];
    return baseArray.filter((r) => {
      if (filterTurnover5 && !(r.turnover_pct >= 5)) return false;
      if (filterRet10 && !(r.ret_1d !== null && r.ret_1d !== undefined && Math.abs(r.ret_1d) >= 10)) return false;
      if (!matchesMktBracket(r.mktcap, mktBracket)) return false;
      return true;
    });
  }, [rankingData, subTab, filterTurnover5, filterRet10, mktBracket]);

  if (err) return <pre className="p-4 text-red-400 bg-slate-900 min-h-screen">ERROR: {err}</pre>;
  if (!filteredRows) return <div className="p-4 bg-slate-900 text-gray-400 min-h-screen">loading...</div>;

  return (
    <div style={{ backgroundColor: "#17171a", minHeight: "100vh", paddingTop: 12, paddingBottom: 12 }}>
      <div style={{ paddingLeft: 16, paddingRight: 16, marginBottom: 12 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: "#fff", marginBottom: 4 }}>
          Volume Ranking
        </h1>
        <p style={{ fontSize: 12, color: "#71717A" }}>{meta?.date}</p>
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 12, paddingLeft: 16, paddingRight: 16 }}>
        {SUB_TABS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setSubTab(key)}
            style={{
              flex: 1,
              padding: "9px 0",
              borderRadius: 9999,
              fontFamily: monoFont,
              fontVariantNumeric: "tabular-nums",
              fontSize: 13,
              textAlign: "center",
              transition: "background 0.15s, color 0.15s, border-color 0.15s",
              background: subTab === key ? "#3c4043" : "#282a2d",
              border: `1px solid ${subTab === key ? "#5f6368" : "#3c4043"}`,
              color: subTab === key ? "#e8eaed" : "#8e8e93",
              fontWeight: subTab === key ? 600 : 500,
            }}
          >
            {label}
          </button>
        ))}
      </div>

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", paddingLeft: 16, paddingRight: 16, marginBottom: 8 }}>
        <button
          onClick={() => setFilterTurnover5((v) => !v)}
          style={{
            padding: "6px 10px", borderRadius: 9999, fontFamily: monoFont, fontVariantNumeric: "tabular-nums",
            fontSize: 12, border: `1px solid ${filterTurnover5 ? "#5f6368" : "#3c4043"}`,
            background: filterTurnover5 ? "#3c4043" : "#282a2d", color: filterTurnover5 ? "#e8eaed" : "#8e8e93",
            fontWeight: filterTurnover5 ? 600 : 500,
          }}
        >回転率5%↑</button>
        <button
          onClick={() => setFilterRet10((v) => !v)}
          style={{
            padding: "6px 10px", borderRadius: 9999, fontFamily: monoFont, fontVariantNumeric: "tabular-nums",
            fontSize: 12, border: `1px solid ${filterRet10 ? "#5f6368" : "#3c4043"}`,
            background: filterRet10 ? "#3c4043" : "#282a2d", color: filterRet10 ? "#e8eaed" : "#8e8e93",
            fontWeight: filterRet10 ? 600 : 500,
          }}
        >騰落率±10%</button>
      </div>

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", paddingLeft: 16, paddingRight: 16, marginBottom: 10 }}>
        {MKT_BRACKETS.map(({ key, label }) => {
          const active = mktBracket === key;
          return (
            <button
              key={key}
              onClick={() => setMktBracket(key)}
              style={{
                padding: "6px 10px", borderRadius: 9999, fontFamily: monoFont, fontVariantNumeric: "tabular-nums",
                fontSize: 12, border: `1px solid ${active ? "#5f6368" : "#3c4043"}`,
                background: active ? "#3c4043" : "#282a2d", color: active ? "#e8eaed" : "#8e8e93",
                fontWeight: active ? 600 : 500,
              }}
            >{label}</button>
          );
        })}
      </div>

      <div style={{ overflowX: "auto", paddingLeft: 16, paddingRight: 16 }}>
        <table style={{ borderCollapse: "collapse", width: "100%" }}>
          <thead>
            <tr>
              <th style={{ ...th, textAlign: "right", minWidth: COL_WIDTH.rank }}>順位</th>
              <th style={{ ...th, textAlign: "left", minWidth: COL_WIDTH.code }}>コード</th>
              <th style={{ ...th, textAlign: "left", minWidth: COL_WIDTH.name }}>銘柄名</th>
              <th style={{ ...th, textAlign: "left", minWidth: COL_WIDTH.market }}>市場</th>
              <th style={{ ...th, textAlign: "right", minWidth: COL_WIDTH.price }}>現在値</th>
              <th style={{ ...th, textAlign: "right", minWidth: COL_WIDTH.ret1d }}>前日比</th>
              <th style={{ ...th, textAlign: "right", minWidth: COL_WIDTH.va }}>売買代金(億)</th>
              <th style={{ ...th, textAlign: "right", minWidth: COL_WIDTH.mktcap }}>時価総額(億)</th>
              <th style={{ ...th, textAlign: "right", minWidth: COL_WIDTH.turnover }}>回転率%</th>
              <th style={{ ...th, textAlign: "right", minWidth: COL_WIDTH.occ }}>出現</th>
            </tr>
          </thead>
          <tbody>
            {filteredRows.map((r, i) => {
              const ret1d = fmtRet1d(r.ret_1d);
              const app = appearanceByCode[r.code];
              return (
                <tr key={r.code}>
                  <td style={{ ...td, textAlign: "right", color: "#71717A", minWidth: COL_WIDTH.rank }}>{i + 1}</td>
                  <td style={{ ...td, color: "#c8c8c8", minWidth: COL_WIDTH.code }}>{displayCode(r.code)}</td>
                  <td
                    style={{
                      ...td,
                      color: "#f5f5f5",
                      fontFamily: "inherit",
                      fontSize: 13,
                      maxWidth: COL_WIDTH.name,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {r.name}
                  </td>
                  <td style={{ ...td, color: "#9CA3AF", minWidth: COL_WIDTH.market }}>{fmtMarket(r.market)}</td>
                  <td style={{ ...td, textAlign: "right", color: "#999", minWidth: COL_WIDTH.price }}>
                    {r.C !== null && r.C !== undefined ? r.C.toLocaleString("ja-JP") : "—"}
                  </td>
                  <td style={{ ...td, textAlign: "right", color: ret1d.color, fontWeight: 600, minWidth: COL_WIDTH.ret1d }}>
                    {ret1d.text}
                  </td>
                  <td style={{ ...td, textAlign: "right", color: "#999", minWidth: COL_WIDTH.va }}>{fmtOku(r.va)}</td>
                  <td style={{ ...td, textAlign: "right", color: "#999", minWidth: COL_WIDTH.mktcap }}>{fmtOku(r.mktcap)}</td>
                  <td
                    style={{
                      ...td,
                      textAlign: "right",
                      color: turnoverColor(r.turnover_pct),
                      fontWeight: 600,
                      minWidth: COL_WIDTH.turnover,
                    }}
                  >
                    {r.turnover_pct.toFixed(1)}%
                  </td>
                  <td style={{ ...td, textAlign: "right", minWidth: COL_WIDTH.occ }}>
                    {app ? (
                      <>
                        <span style={{ color: "#777" }}>{app.turnover_50 ?? 0}:</span>
                        <span
                          style={{
                            color: (app.stophigh_50 ?? 0) >= 1 ? "#ffa500" : "#777",
                            fontWeight: (app.stophigh_50 ?? 0) >= 1 ? 700 : 400,
                          }}
                        >
                          {app.stophigh_50 ?? 0}
                        </span>
                      </>
                    ) : (
                      <span style={{ color: "#525252" }}>—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
