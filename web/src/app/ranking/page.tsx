"use client";
import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "../_components/PageHeader";

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

type SubTab = "all" | "standard" | "growth";

const SUB_TABS: { key: SubTab; label: string }[] = [
  { key: "all", label: "全体" },
  { key: "standard", label: "スタンダード" },
  { key: "growth", label: "グロース" },
];

// データは生の日本語のまま保持。表示変換のみここで行う。
const MARKET_DISPLAY: Record<string, string> = {
  "プライム": "東証PR",
  "スタンダード": "東証STD",
  "グロース": "東証GRT",
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

const th: React.CSSProperties = {
  position: "sticky",
  top: 0,
  background: "#09090B",
  color: "#71717A",
  fontSize: 11,
  fontWeight: 700,
  fontFamily: monoFont,
  padding: "6px 8px",
  whiteSpace: "nowrap",
  borderBottom: "1px solid #1F1F23",
};

const td: React.CSSProperties = {
  fontSize: 12,
  fontFamily: monoFont,
  fontVariantNumeric: "tabular-nums",
  padding: "6px 8px",
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
    ])
      .then(([rankingData, appearanceData]) => {
        setMeta(rankingData._meta);
        setRows(rankingData.ranking as RankingRow[]);
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
      <PageHeader
        title="売買代金ランキング"
        date={meta?.date}
        description="ranking.json を売買代金上位順に表示しています。市場区分でサブタブを切り替えられます。"
      />

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
        <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 720 }}>
          <thead>
            <tr>
              <th style={{ ...th, textAlign: "right" }}>順位</th>
              <th style={{ ...th, textAlign: "left" }}>コード</th>
              <th style={{ ...th, textAlign: "left" }}>銘柄名</th>
              <th style={{ ...th, textAlign: "left" }}>市場</th>
              <th style={{ ...th, textAlign: "right" }}>現在値</th>
              <th style={{ ...th, textAlign: "right" }}>前日比</th>
              <th style={{ ...th, textAlign: "right" }}>売買代金(億)</th>
              <th style={{ ...th, textAlign: "right" }}>時価総額(億)</th>
              <th style={{ ...th, textAlign: "right" }}>回転率%</th>
              <th style={{ ...th, textAlign: "right" }}>出現</th>
            </tr>
          </thead>
          <tbody>
            {filteredRows.map((r, i) => {
              const ret1d = fmtRet1d(r.ret_1d);
              const app = appearanceByCode[r.code];
              return (
                <tr key={r.code}>
                  <td style={{ ...td, textAlign: "right", color: "#71717A" }}>{i + 1}</td>
                  <td style={{ ...td, color: "#c8c8c8" }}>{r.code}</td>
                  <td style={{ ...td, color: "#f5f5f5", fontFamily: "inherit" }}>{r.name}</td>
                  <td style={{ ...td, color: "#9CA3AF" }}>{fmtMarket(r.market)}</td>
                  <td style={{ ...td, textAlign: "right", color: "#999" }}>
                    {r.C !== null && r.C !== undefined ? r.C.toLocaleString("ja-JP") : "—"}
                  </td>
                  <td style={{ ...td, textAlign: "right", color: ret1d.color, fontWeight: 600 }}>
                    {ret1d.text}
                  </td>
                  <td style={{ ...td, textAlign: "right", color: "#999" }}>{fmtOku(r.va)}</td>
                  <td style={{ ...td, textAlign: "right", color: "#999" }}>{fmtOku(r.mktcap)}</td>
                  <td style={{ ...td, textAlign: "right", color: "#B5730F", fontWeight: 600 }}>
                    {r.turnover_pct.toFixed(1)}%
                  </td>
                  <td style={{ ...td, textAlign: "right" }}>
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
