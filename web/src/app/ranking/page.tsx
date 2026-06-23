"use client";
import React, { useEffect, useMemo, useState } from "react";
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

type RankingData = {
  _meta?: { date?: string; counts?: { all: number; prime: number; standard: number; growth: number } };
  all: RankingRow[];
  prime: RankingRow[];
  standard: RankingRow[];
  growth: RankingRow[];
};

// J-Quantsのコードは末尾0付き5桁（例: 285A0）。表示は先頭4桁。
function displayCode(code: string): string {
  return code.slice(0, 4);
}

type SubTab = "prime" | "standard" | "growth";

const SUB_TABS: { key: SubTab; label: string }[] = [
  { key: "prime",    label: "プライム" },
  { key: "standard", label: "スタンダード" },
  { key: "growth",   label: "グロース" },
];

type MktBracket = "all" | "le100" | "le300" | "le1000" | "gt1000";

const MKT_BRACKETS: { key: MktBracket; label: string }[] = [
  { key: "le100",  label: "100↓" },
  { key: "le300",  label: "300↓" },
  { key: "le1000", label: "1000↓" },
  { key: "gt1000", label: "1000↑" },
];

function matchesMktBracket(mktcap: number, b: MktBracket): boolean {
  if (b === "all") return true;
  const oku = mktcap / 1e8;
  if (b === "le100")  return oku <= 100;
  if (b === "le300")  return oku <= 300;
  if (b === "le1000") return oku <= 1000;
  if (b === "gt1000") return oku > 1000;
  return true;
}

// 代金・時価総額: floor(value / 1e8) 億、カンマなし整数 + 億
function fmtHundredMillion(yen: number | null | undefined): string {
  if (yen === null || yen === undefined) return "—";
  return String(Math.floor(yen / 1e8)) + "億";
}

// 前日比: 符号付き小数1桁。色は日本式（＋赤／－緑）。
function fmtRet1d(v: number | null | undefined): { text: string; color: string } {
  if (v === null || v === undefined) return { text: "—", color: "#666" };
  const sign = v >= 0 ? "+" : "";
  return {
    text: `${sign}${v.toFixed(1)}%`,
    color: v >= 0 ? "#E0524A" : "#26A699",
  };
}

const monoFont = 'ui-monospace,"SF Mono",SFMono-Regular,Menlo,monospace';

// 8列構成（順位・市場削除）。合計360px、SE375も収まる。
const COL_WIDTH = {
  code:     30,
  name:     82,
  price:    46,
  ret1d:    40,
  va:       38,
  mktcap:   42,
  turnover: 32,
  occ:      26,
} as const;

// 回転率による文字色
function turnoverColor(v: number): string {
  if (v >= 10) return "#f87171";
  if (v >= 5)  return "#fb923c";
  return "#8a8a8e";
}

// 回転率による行背景帯（薄く）
function rowTint(v: number): string {
  if (v >= 10) return "rgba(248,113,113,0.10)";
  if (v >= 5)  return "rgba(251,146,60,0.10)";
  return "transparent";
}

const th: React.CSSProperties = {
  position: "sticky",
  top: 0,
  background: "#17171a",
  color: "#6b6b70",
  fontSize: 9,
  fontWeight: 600,
  fontFamily: monoFont,
  padding: "5px 1px",
  whiteSpace: "nowrap",
  borderBottom: "1px solid #2a2a2e",
};

const td: React.CSSProperties = {
  fontSize: 10,
  fontFamily: monoFont,
  fontVariantNumeric: "tabular-nums",
  padding: "5px 1px",
  whiteSpace: "nowrap",
  borderBottom: "1px solid rgba(255,255,255,0.035)",
};

function toggleChipStyle(active: boolean): React.CSSProperties {
  return {
    flex: 1,
    padding: "7px 0",
    borderRadius: 9999,
    fontFamily: monoFont,
    fontSize: 12,
    fontWeight: active ? 600 : 500,
    textAlign: "center",
    transition: "background 0.15s, color 0.15s, border-color 0.15s",
    background: active ? "#3c4043" : "#282a2d",
    border: `1px solid ${active ? "#5f6368" : "#3c4043"}`,
    color: active ? "#e8eaed" : "#8e8e93",
  };
}

function capChipStyle(active: boolean): React.CSSProperties {
  return {
    flex: 1,
    padding: "7px 0",
    borderRadius: 8,
    fontFamily: monoFont,
    fontSize: 12,
    fontWeight: 600,
    textAlign: "center",
    transition: "background 0.15s, color 0.15s",
    background: active ? "#fff" : "#2c2c2e",
    color: active ? "#000" : "#8e8e93",
    border: "none",
  };
}

export default function RankingPage() {
  const [rankingData, setRankingData] = useState<RankingData | null>(null);
  const [appearanceByCode, setAppearanceByCode] = useState<Record<string, Appearance>>({});
  const [err, setErr] = useState<string | null>(null);
  const [subTab, setSubTab] = useState<SubTab>("prime");
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
      .then(([rd, appearanceData]) => {
        setRankingData(rd as RankingData);
        setAppearanceByCode(appearanceData.by_code ?? {});
      })
      .catch((e) => setErr(String(e)));
  }, []);

  const meta = rankingData?._meta;

  const filteredRows = useMemo(() => {
    if (!rankingData) return null;
    const baseArray = rankingData[subTab] ?? [];
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
      <PageHeader
        title="Volume Ranking"
        date={meta?.date}
        description={
          "売買代金（va）の上位100銘柄を市場別に表示します。\n" +
          "・上部タブ「プライム／スタンダード／グロース」で市場を切り替えます（各市場の売買代金上位100銘柄）。\n" +
          "・「回転率5%↑」「騰落率±10%」は独立トグル、「100↓〜1000↑」は時価総額フィルター（億）です。すべてAND結合。\n" +
          "・代金・時価は億円単位。回転率10%以上は赤、5%以上は橙で行をハイライトします。\n" +
          "・「出現」欄：左=直近50日で回転率5%以上をつけた日数、右=その期間のS高回数。\n" +
          "・25位ごとに区切り線を表示しています。"
        }
      />

      {/* 市場サブタブ */}
      <div style={{ display: "flex", gap: 8, marginBottom: 10, paddingLeft: 16, paddingRight: 16 }}>
        {SUB_TABS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setSubTab(key)}
            style={{
              flex: 1,
              padding: "9px 0",
              borderRadius: 9999,
              fontFamily: monoFont,
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

      {/* フィルター上段：独立トグル */}
      <div style={{ display: "flex", gap: 8, marginBottom: 8, paddingLeft: 16, paddingRight: 16 }}>
        <button onClick={() => setFilterTurnover5((v) => !v)} style={toggleChipStyle(filterTurnover5)}>
          回転率5%↑
        </button>
        <button onClick={() => setFilterRet10((v) => !v)} style={toggleChipStyle(filterRet10)}>
          騰落率±10%
        </button>
      </div>

      {/* フィルター下段：時価総額ブラケット（再タップで解除） */}
      <div style={{ display: "flex", gap: 6, marginBottom: 12, paddingLeft: 16, paddingRight: 16 }}>
        {MKT_BRACKETS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setMktBracket((cur) => (cur === key ? "all" : key))}
            style={capChipStyle(mktBracket === key)}
          >
            {label}
          </button>
        ))}
      </div>

      {/* テーブル（8列・横はみ出しゼロ・25位区切り線） */}
      <div style={{ paddingLeft: 4, paddingRight: 4 }}>
        <table style={{ borderCollapse: "collapse", width: "100%", tableLayout: "fixed" }}>
          <colgroup>
            <col style={{ width: COL_WIDTH.code }} />
            <col style={{ width: COL_WIDTH.name }} />
            <col style={{ width: COL_WIDTH.price }} />
            <col style={{ width: COL_WIDTH.ret1d }} />
            <col style={{ width: COL_WIDTH.va }} />
            <col style={{ width: COL_WIDTH.mktcap }} />
            <col style={{ width: COL_WIDTH.turnover }} />
            <col style={{ width: COL_WIDTH.occ }} />
          </colgroup>
          <thead>
            <tr>
              <th style={{ ...th, textAlign: "left" }}>コード</th>
              <th style={{ ...th, textAlign: "left" }}>銘柄</th>
              <th style={{ ...th, textAlign: "right" }}>現在値</th>
              <th style={{ ...th, textAlign: "right" }}>前日比</th>
              <th style={{ ...th, textAlign: "right" }}>代金</th>
              <th style={{ ...th, textAlign: "right" }}>時価</th>
              <th style={{ ...th, textAlign: "right" }}>回転</th>
              <th style={{ ...th, textAlign: "right" }}>出現</th>
            </tr>
          </thead>
          <tbody>
            {filteredRows.map((r, i) => {
              const ret1d = fmtRet1d(r.ret_1d);
              const app = appearanceByCode[r.code];
              const tint = rowTint(r.turnover_pct);
              const rank = i + 1; // 表示順位（フィルタ後の連番）
              const showDivider = rank > 1 && rank % 25 === 1; // 26,51,76,101位の直前
              return (
                <React.Fragment key={r.code}>
                  {showDivider && (
                    <tr>
                      <td
                        colSpan={8}
                        style={{
                          padding: "4px 0",
                          borderTop: "2px solid rgba(255,255,255,0.18)",
                          background: "transparent",
                        }}
                      />
                    </tr>
                  )}
                  <tr style={{ background: tint }}>
                    <td style={{ ...td, color: "#c8c8c8" }}>{displayCode(r.code)}</td>
                    <td
                      style={{
                        ...td,
                        color: "#f0f0f0",
                        fontSize: 12,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {r.name}
                    </td>
                    <td style={{ ...td, textAlign: "right", color: "#b8b8b8" }}>
                      {r.C !== null && r.C !== undefined ? r.C.toLocaleString("ja-JP") : "—"}
                    </td>
                    <td style={{ ...td, textAlign: "right", color: ret1d.color, fontWeight: 600 }}>
                      {ret1d.text}
                    </td>
                    <td style={{ ...td, textAlign: "right", color: "#9a9a9e" }}>
                      {fmtHundredMillion(r.va)}
                    </td>
                    <td style={{ ...td, textAlign: "right", color: "#9a9a9e" }}>
                      {fmtHundredMillion(r.mktcap)}
                    </td>
                    <td style={{ ...td, textAlign: "right", color: turnoverColor(r.turnover_pct), fontWeight: 600 }}>
                      {r.turnover_pct.toFixed(1)}
                    </td>
                    <td style={{ ...td, textAlign: "right" }}>
                      {app ? (
                        <>
                          <span style={{ color: "#6b6b70" }}>{app.turnover_50 ?? 0}:</span>
                          <span
                            style={{
                              color: (app.stophigh_50 ?? 0) >= 1 ? "#ffa500" : "#6b6b70",
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
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
