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

type MetaStock = {
  market?: string;
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

function matchesSubTab(market: string | undefined, tab: SubTab): boolean {
  if (tab === "all") {
    return !market || (market !== "その他" && market !== "TOKYO PRO MARKET");
  }
  if (tab === "standard") return market === "スタンダード";
  if (tab === "growth") return market === "グロース";
  return true;
}

// 1000億未満〜1兆未満: 整数（小数禁止）。1兆以上: 小数2桁の「X.XX兆」。
function fmtOku(yen: number | null | undefined): string {
  if (yen === null || yen === undefined) return "—";
  const oku = yen / 1e8;
  if (oku >= 10000) return (oku / 10000).toFixed(2) + "兆";
  return Math.round(oku).toLocaleString("ja-JP");
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
  const [rows, setRows] = useState<RankingRow[] | null>(null);
  const [appearanceByCode, setAppearanceByCode] = useState<Record<string, Appearance>>({});
  const [meta, setMeta] = useState<{ date?: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [subTab, setSubTab] = useState<SubTab>("all");

  useEffect(() => {
    Promise.all([
      fetch("/data/ranking.json").then((r) => {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      }),
      fetch("/data/appearance.json")
        .then((r) => (r.ok ? r.json() : { by_code: {} }))
        .catch(() => ({ by_code: {} })),
      fetch("/data/meta.json")
        .then((r) => (r.ok ? r.json() : { stocks: {} }))
        .catch(() => ({ stocks: {} })),
    ])
      .then(([rankingData, appearanceData, metaData]) => {
        setMeta(rankingData._meta);
        const metaStocks: Record<string, MetaStock> = metaData.stocks ?? {};
        // market 暫定対応: ranking.json側が空/未反映の場合のみ meta.json から補完
        const joined = (rankingData.ranking as RankingRow[]).map((r) => ({
          ...r,
          market: r.market || metaStocks[r.code]?.market || r.market,
        }));
        setRows(joined);
        setAppearanceByCode(appearanceData.by_code ?? {});
      })
      .catch((e) => setErr(String(e)));
  }, []);

  const filteredRows = useMemo(() => {
    if (!rows) return null;
    return rows.filter((r) => matchesSubTab(r.market, subTab));
  }, [rows, subTab]);

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
