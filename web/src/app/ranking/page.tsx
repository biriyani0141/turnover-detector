"use client";
import React, { useEffect, useMemo, useState } from "react";
import { Roboto_Mono } from "next/font/google";
import { PageHeader } from "../_components/PageHeader";

const robotoMono = Roboto_Mono({ weight: ["400", "700"], subsets: ["latin"] });

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

// ranking_cards.json / stophigh_cards.json 共通スキーマ
type CardRow = {
  code: string;
  name: string;
  price: number;
  changePct: number;
  marketCap: string;
  va: number;
  mktcap: number;
  turnover: number;
  occCount: number;
  stophighCount: number;
};

type CardData = {
  _meta?: { date?: string };
  ranking: CardRow[];
};

function displayCode(code: string): string {
  return code.slice(0, 4);
}

function abbreviateName(name: string): string {
  return name
    .replace(/ホールディングス/g, "HD")
    .replace(/ホールディング/g, "HD")
    .replace(/グループ/g, "G")
    .replace(/コーポレーション/g, "C")
    .replace(/インターナショナル/g, "Intl");
}

type SubTab = "prime" | "standard" | "growth";

const SUB_TABS: { key: SubTab; label: string }[] = [
  { key: "prime",    label: "プライム" },
  { key: "standard", label: "スタンダード" },
  { key: "growth",   label: "グロース" },
];

type MainTab = "volume" | "turnover" | "stophigh";

const MAIN_TABS: { key: MainTab; label: string }[] = [
  { key: "volume",   label: "売買代金" },
  { key: "turnover", label: "回転率" },
  { key: "stophigh", label: "S高" },
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

// 代金・時価: floor(value/1e8)、カンマあり整数
function fmtOku(yen: number | null | undefined): string {
  if (yen === null || yen === undefined) return "—";
  return Math.floor(yen / 1e8).toLocaleString("ja-JP");
}

// 現在値: カンマあり
function fmtPrice(v: number | null | undefined): string {
  if (v === null || v === undefined) return "—";
  return v.toLocaleString("ja-JP");
}

// 前日比: 符号付き小数1桁
function fmtRet1d(v: number | null | undefined): { text: string; color: string } {
  if (v === null || v === undefined) return { text: "—", color: "#555" };
  const sign = v >= 0 ? "+" : "";
  return {
    text: `${sign}${v.toFixed(1)}%`,
    color: v >= 0 ? "#C0392B" : "#16A085",
  };
}

const monoFont = '"SF Mono",SFMono-Regular,ui-monospace,"Roboto Mono",Menlo,Consolas,monospace';
const BASE_BG = "#17171a";
const TEXT_DEFAULT = "#8a8a8e";  // 全列共通グレー
const TEXT_BRIGHT = "#e8eaed";   // 出現欄用の高コントラスト色
const TEXT_NAME = "#b0b0b0";     // 銘柄名・コード用

// 回転率による行背景（ハイライトのみ。通常行は透明=BASE_BG）
function rowBg(turnover: number): string {
  if (turnover >= 10) return "rgba(220,20,60,0.20)";
  if (turnover >= 5)  return "rgba(255,165,0,0.20)";
  return "transparent";
}

// 列幅: 8列・padding 1px左右・合計360px（SE含む全機種OK）
const COL_WIDTH = {
  code:     28,
  name:     72,
  price:    42,
  ret1d:    42,
  va:       40,
  mktcap:   48,
  turnover: 28,
  occ:      30,
} as const;

const th: React.CSSProperties = {
  position: "sticky",
  top: 0,
  background: BASE_BG,
  color: "#8e8e93",
  fontSize: 10,
  fontWeight: 600,
  fontFamily: monoFont,
  fontVariantNumeric: "tabular-nums",
  letterSpacing: "-0.01em",
  padding: "4px 2px",
  whiteSpace: "nowrap",
  borderBottom: "1px solid #2a2d34",
};

const tdBase: React.CSSProperties = {
  fontSize: 11,
  fontFamily: monoFont,
  fontVariantNumeric: "tabular-nums",
  letterSpacing: "-0.015em",
  color: TEXT_DEFAULT,
  padding: "2px 2px",
  whiteSpace: "nowrap",
  borderBottom: "1px solid rgba(255,255,255,0.05)",
};

// 数値カラム（現在値/前日比/売買代金/時価総額/回転率）専用: 等幅フォント詰め
const tdNumber: React.CSSProperties = {
  ...tdBase,
  fontFamily: `${robotoMono.style.fontFamily}, monospace`,
  letterSpacing: "-0.05em",
  fontStretch: "condensed",
};

// 銘柄名・コード: 高コントラスト（明るすぎないトーン）
const tdName: React.CSSProperties = {
  ...tdBase,
  color: TEXT_NAME,
};

// 出現欄: 高コントラスト
const tdBright: React.CSSProperties = {
  ...tdBase,
  color: TEXT_BRIGHT,
};

function toggleChipStyle(active: boolean): React.CSSProperties {
  return {
    flex: 1,
    padding: "7px 0",
    borderRadius: 9999,
    fontFamily: monoFont,
    fontSize: 11,
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
    fontVariantNumeric: "tabular-nums",
    fontSize: 12,
    fontWeight: 600,
    textAlign: "center",
    transition: "background 0.15s, color 0.15s",
    background: active ? "#fff" : "#2c2c2e",
    color: active ? "#000" : "#8e8e93",
    border: "none",
  };
}

// テーブル描画用の正規化行（3データソース共通）
type DisplayRow = {
  code: string;
  name: string;
  priceText: string;
  changeText: string;
  changeColor: string;
  vaText: string | null;
  mktcapText: string;
  turnoverText: string;
  turnoverRaw: number;
  occurrence: React.ReactNode;
};

function rowFromRanking(r: RankingRow, app: Appearance | undefined): DisplayRow {
  const ret1d = fmtRet1d(r.ret_1d);
  return {
    code: r.code,
    name: r.name,
    priceText: fmtPrice(r.C),
    changeText: ret1d.text,
    changeColor: ret1d.color,
    vaText: fmtOku(r.va),
    mktcapText: fmtOku(r.mktcap),
    turnoverText: r.turnover_pct.toFixed(1),
    turnoverRaw: r.turnover_pct,
    occurrence: app ? (
      <>
        <span style={{ color: TEXT_BRIGHT }}>{app.turnover_50 ?? 0}:</span>
        <span style={{
          color: (app.stophigh_50 ?? 0) >= 1 ? "#ffa500" : TEXT_BRIGHT,
          fontWeight: (app.stophigh_50 ?? 0) >= 1 ? 700 : 400,
        }}>
          {app.stophigh_50 ?? 0}
        </span>
      </>
    ) : (
      <span style={{ color: TEXT_DEFAULT }}>—</span>
    ),
  };
}

function rowFromCard(r: CardRow): DisplayRow {
  const change = fmtRet1d(r.changePct);
  return {
    code: r.code,
    name: r.name,
    priceText: fmtPrice(r.price),
    changeText: change.text,
    changeColor: change.color,
    vaText: fmtOku(r.va),
    mktcapText: fmtOku(r.mktcap),
    turnoverText: r.turnover.toFixed(1),
    turnoverRaw: r.turnover,
    occurrence: <span style={{ color: TEXT_BRIGHT }}>{r.occCount}:{r.stophighCount}</span>,
  };
}

export default function RankingPage() {
  const [rankingData, setRankingData] = useState<RankingData | null>(null);
  const [appearanceByCode, setAppearanceByCode] = useState<Record<string, Appearance>>({});
  const [turnoverCards, setTurnoverCards] = useState<CardRow[] | null>(null);
  const [stophighCards, setStophighCards] = useState<CardRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [mainTab, setMainTab] = useState<MainTab>("volume");
  const [subTab, setSubTab] = useState<SubTab>("prime");
  const [filterTurnover5, setFilterTurnover5] = useState(false);
  const [retFilter, setRetFilter] = useState<"off" | "r5" | "r10">("off");
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
      fetch("/data/ranking_cards.json")
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
      fetch("/data/stophigh_cards.json")
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
    ])
      .then(([rd, appearanceData, turnoverData, stophighData]) => {
        setRankingData(rd as RankingData);
        setAppearanceByCode(appearanceData.by_code ?? {});
        setTurnoverCards((turnoverData as CardData | null)?.ranking ?? null);
        setStophighCards((stophighData as CardData | null)?.ranking ?? null);
      })
      .catch((e) => setErr(String(e)));
  }, []);

  const meta = rankingData?._meta;

  const filteredRows = useMemo(() => {
    if (!rankingData) return null;
    const baseArray = rankingData[subTab] ?? [];
    return baseArray.filter((r) => {
      if (filterTurnover5 && !(r.turnover_pct >= 5)) return false;
      if (retFilter !== "off") {
        const absRet = r.ret_1d !== null && r.ret_1d !== undefined ? Math.abs(r.ret_1d) : -1;
        const thr = retFilter === "r5" ? 5 : 10;
        if (!(absRet >= thr)) return false;
      }
      if (!matchesMktBracket(r.mktcap, mktBracket)) return false;
      return true;
    });
  }, [rankingData, subTab, filterTurnover5, retFilter, mktBracket]);

  const displayRows = useMemo<DisplayRow[] | null>(() => {
    if (mainTab === "volume") {
      if (!filteredRows) return null;
      return filteredRows.map((r) => rowFromRanking(r, appearanceByCode[r.code]));
    }
    if (mainTab === "turnover") {
      if (!turnoverCards) return null;
      return turnoverCards.map(rowFromCard);
    }
    if (!stophighCards) return null;
    return stophighCards.map(rowFromCard);
  }, [mainTab, filteredRows, turnoverCards, stophighCards, appearanceByCode]);

  const showVaColumn = true;
  const mktcapHeader = "時価(億)";

  if (err) return <pre style={{ background: BASE_BG, color: "#f87171", padding: 16, minHeight: "100vh" }}>ERROR: {err}</pre>;
  if (!displayRows) return <div style={{ background: BASE_BG, color: "#555", padding: 16, minHeight: "100vh" }}>loading...</div>;

  return (
    <div style={{ backgroundColor: BASE_BG, minHeight: "100vh", paddingTop: 12, paddingBottom: 12 }}>
      <PageHeader
        title="Volume Ranking"
        date={meta?.date}
        description={
          "売買代金・回転率・S高の上位銘柄を表示します。\n" +
          "・タブ「売買代金／回転率／S高」でランキング種別を切り替えます。\n" +
          "・売買代金タブのみ「プライム／スタンダード／グロース」市場タブと各種フィルターが使えます。\n" +
          "・回転率10%以上は赤帯、5%以上は橙帯で行をハイライトします。\n" +
          "・売買代金タブの「出現」欄：左=直近50日で回転率5%以上をつけた日数、右=その期間のS高回数。"
        }
      />

      {/* メインタブ（セグメンテッドコントロール） */}
      <div
        style={{
          display: "flex",
          gap: 2,
          marginBottom: 10,
          marginLeft: 16,
          marginRight: 16,
          padding: 3,
          borderRadius: 9999,
          background: "#1c1c1f",
          border: "1px solid #2a2d34",
        }}
      >
        {MAIN_TABS.map(({ key, label }) => {
          const active = mainTab === key;
          return (
            <button
              key={key}
              onClick={() => setMainTab(key)}
              style={{
                flex: 1,
                padding: "8px 0",
                borderRadius: 9999,
                fontFamily: monoFont,
                fontSize: 13,
                textAlign: "center",
                border: "none",
                transition: "background 0.15s, color 0.15s, box-shadow 0.15s",
                background: active ? "#46494d" : "transparent",
                boxShadow: active ? "0 1px 3px rgba(0,0,0,0.4)" : "none",
                color: active ? "#e8eaed" : "#8e8e93",
                fontWeight: active ? 600 : 500,
              }}
            >
              {label}
            </button>
          );
        })}
      </div>

      {mainTab === "volume" && (
        <>
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

          {/* フィルター上段：回転率・騰落率（騰落率±5/±10は相互排他） */}
          <div style={{ display: "flex", gap: 6, marginBottom: 8, paddingLeft: 16, paddingRight: 16 }}>
            <button onClick={() => setFilterTurnover5((v) => !v)} style={toggleChipStyle(filterTurnover5)}>
              回転率5%↑
            </button>
            <button onClick={() => setRetFilter((cur) => (cur === "r5" ? "off" : "r5"))} style={toggleChipStyle(retFilter === "r5")}>
              騰落±5%
            </button>
            <button onClick={() => setRetFilter((cur) => (cur === "r10" ? "off" : "r10"))} style={toggleChipStyle(retFilter === "r10")}>
              騰落±10%
            </button>
          </div>

          {/* フィルター下段：時価総額 */}
          <div style={{ display: "flex", gap: 6, marginBottom: 10, paddingLeft: 16, paddingRight: 16 }}>
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
        </>
      )}

      {/* テーブル */}
      <div style={{ paddingLeft: 4, paddingRight: 4 }}>
        <table style={{ borderCollapse: "collapse", width: "100%", tableLayout: "fixed" }}>
          <colgroup>
            <col style={{ width: COL_WIDTH.code }} />
            <col style={{ width: COL_WIDTH.name }} />
            <col style={{ width: COL_WIDTH.price }} />
            <col style={{ width: COL_WIDTH.ret1d }} />
            {showVaColumn && <col style={{ width: COL_WIDTH.va }} />}
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
              {showVaColumn && <th style={{ ...th, textAlign: "right" }}>代金(億)</th>}
              <th style={{ ...th, textAlign: "right" }}>{mktcapHeader}</th>
              <th style={{ ...th, textAlign: "right" }}>回転</th>
              <th style={{ ...th, textAlign: "right" }}>出現</th>
            </tr>
          </thead>
          <tbody>
            {displayRows.map((r, i) => {
              const bg = mainTab === "volume" ? rowBg(r.turnoverRaw) : "transparent";
              const rank = i + 1;
              const showDivider = rank > 1 && rank % 25 === 1;
              return (
                <React.Fragment key={r.code}>
                  {showDivider && (
                    <tr>
                      <td
                        colSpan={showVaColumn ? 8 : 7}
                        style={{
                          padding: "3px 0",
                          borderTop: "1px solid #333",
                          background: "transparent",
                        }}
                      />
                    </tr>
                  )}
                  <tr style={{ background: bg }}>
                    <td style={{ ...tdName }}>{displayCode(r.code)}</td>
                    <td style={{ ...tdName, overflow: "hidden", textOverflow: "ellipsis" }}>
                      {abbreviateName(r.name)}
                    </td>
                    <td style={{ ...tdNumber, textAlign: "right" }}>{r.priceText}</td>
                    <td style={{ ...tdNumber, textAlign: "right", color: r.changeColor }}>
                      {r.changeText}
                    </td>
                    {showVaColumn && (
                      <td style={{ ...tdNumber, textAlign: "right" }}>{r.vaText}</td>
                    )}
                    <td style={{ ...tdNumber, textAlign: "right" }}>{r.mktcapText}</td>
                    <td style={{ ...tdNumber, textAlign: "right" }}>{r.turnoverText}</td>
                    <td style={{ ...tdBright, textAlign: "right" }}>{r.occurrence}</td>
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
