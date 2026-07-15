"use client";
import React, { useEffect, useMemo, useState } from "react";
import { useHeader } from "../_components/HeaderContext";
import ChartModal from "./ChartModal";
import GlossaryModal from "./GlossaryModal";

export type CrashStock = {
  code: string;
  name: string;
  sector: string;
  close: number | null;
  top_ret: number | null;
  cum_excess_return: number | null;
  tier: "low" | "mid" | "high" | null;
  strong_day_count: number;
  dist_to_high: number | null;
  already_recovered: boolean;
  ma25_deviation: number | null;
  days_from_52w_high: number | null;
  pre_crash_high: number | null;
  market_cap: number | null;
  section: "S" | "A" | "B" | "C" | "D";
  // tier(母集団内相対順位)とは独立の絶対強度フラグ。cum_excess_return > 0 で true。
  // tier・sectionの判定には使わない、表示専用の付加情報。
  absolute_positive: boolean;
};

export type CrashPhaseInfo = {
  start: string;
  end_reason: string | null;
  crash_day_count: number;
  // 判断ログ(Phase4): crash_daysはPhase4のバックエンド追加分。移行期間中は
  // crash_screener.pyの旧出力(このフィールドが無いcrash_watchlist_*.json)が
  // 残り得るため、オプショナルにして未定義を許容する(消費側は`?? []`で対処)。
  crash_days?: string[];
  index_max_dd: number | null;
  day_index: number;
};

export type CrashPopulationStats = {
  n: number;
  positive_count: number;
  median_cum_excess_return: number | null;
};

export type CrashSnapshot = {
  date: string;
  status: "IDLE" | "ACTIVE" | "COOLDOWN";
  phase: CrashPhaseInfo | null;
  population_base_date?: string;
  population_stats?: CrashPopulationStats;
  stocks: CrashStock[];
};

export type CrashIndex = {
  dates: string[]; // ISO 'YYYY-MM-DD'
  phases: {
    start: string;
    end: string;
    end_reason: string | null;
    crash_day_count: number;
    index_max_dd: number | null;
  }[];
};

const CRASH_DESCRIPTION =
  "指数暴落局面中の相対強度監視リストです。予測評価・売買判断は行いません(判断は人間)。\n" +
  "・[S]局面中に既にpre_crash_highをブレイク済み\n" +
  "・[A]tier high かつ 高値までの距離15%以内(検証で最も奪回率が高かった枠)\n" +
  "・[B]tier high残り or tier mid かつ距離15%以内\n" +
  "・[C]tier mid残り　・[D]tier low(全表示)";

const monoFont = '"SF Mono",SFMono-Regular,ui-monospace,"Roboto Mono",Menlo,Consolas,monospace';
const BASE_BG = "#17171a";
const TEXT_DEFAULT = "#8a8a8e";
const TEXT_BRIGHT = "#e8eaed";
const TEXT_NAME = "#b0b0b0";
const UP = "#E03A2F";
const DOWN = "#1B8C7D";

const SECTION_LABEL: Record<CrashStock["section"], string> = {
  S: "[S] 既にブレイク済み",
  A: "[A] tier high × 距離15%以内",
  B: "[B] tier high残り / tier mid × 距離15%以内",
  C: "[C] tier mid残り",
  D: "[D] tier low",
};

const SECTION_COLOR: Record<CrashStock["section"], string> = {
  S: "#ffa500",
  A: "#e05555",
  B: "#cc8800",
  C: "#8a8a8e",
  D: "#6b6b70",
};

// 判断ログ(UI改修タスク3): Phase5時点の配色(#c9784f/#8a8a5a)は実機の暗い画面で
// 判別困難との指摘があったため、彩度・明度を上げた(high/midとも仕様書指定の
// 目安値をそのまま採用)。lowは既存のグレーを維持。ボーダー幅も3px→4pxに拡大。
const TIER_COLOR: Record<"high" | "mid" | "low", string> = {
  high: "#e8834a",
  mid: "#b0a94f",
  low: "#4a4d52",
};

// データタブのsection列ソート用カスタム順序(S→A→B→C→D)。まとめタブの表示順と揃える。
const SECTION_ORDER: Record<CrashStock["section"], number> = { S: 0, A: 1, B: 2, C: 3, D: 4 };

function tierColor(tier: CrashStock["tier"]): string {
  if (tier === "high") return TIER_COLOR.high;
  if (tier === "mid") return TIER_COLOR.mid;
  return TIER_COLOR.low; // "low" またはnull(NaN=D扱い)はlowと同じ扱い
}

// 業種(sector33)の短縮表示。長い業種名でも列幅を一定に保つため先頭3文字に切り詰める。
function shortSector(sector: string): string {
  return sector.length > 3 ? sector.slice(0, 3) : sector;
}

function toHalfWidth(s: string): string {
  return s.replace(/[０-９Ａ-Ｚａ-ｚ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
}

// 判断ログ(UI改修タスク8): 「コーポレーション」は「コープ」だと生協(生活協同組合)と
// 紛らわしいため、「株式会社」等と同様に除去する方針に統一した(表示のみ、データは不変)。
function shortenName(name: string): string {
  let s = toHalfWidth(name);
  s = s.replace(/株式会社/g, "").replace(/\(株\)/g, "");
  s = s.replace(/ホールディングス/g, "HD");
  s = s.replace(/グループ/g, "G");
  s = s.replace(/コーポレーション/g, "");
  return s.trim();
}

// 短縮後に同名衝突する場合、当該銘柄だけ非短縮(元の名前)に戻す。
// 衝突判定はcode単位で行う(同一銘柄が複数回現れることはない前提)。
function buildDisplayNames(stocks: CrashStock[]): Map<string, string> {
  const shortened = stocks.map((s) => ({ code: s.code, short: shortenName(s.name), original: s.name }));
  const counts = new Map<string, number>();
  for (const s of shortened) counts.set(s.short, (counts.get(s.short) ?? 0) + 1);
  const result = new Map<string, string>();
  for (const s of shortened) {
    result.set(s.code, (counts.get(s.short) ?? 0) > 1 ? s.original : s.short);
  }
  return result;
}

// 判断ログ(UI改修タスク6): strong_day_countがその局面の最大値(crash_day_count)に
// 一致する銘柄を最強調(赤太字)、最大値-1を中強調にする。crashDayCountが0/未取得の
// 場合は判定不能なので通常表示にフォールバックする。
function strongDayStyle(strong: number, crashDayCount: number | null | undefined): React.CSSProperties {
  if (!crashDayCount) return {};
  if (strong === crashDayCount) return { color: UP, fontWeight: 700 };
  if (strong === crashDayCount - 1) return { color: "#d98a4a", fontWeight: 600 };
  return {};
}

function fmtPct(v: number | null): string {
  if (v === null || v === undefined) return "—";
  const sign = v >= 0 ? "+" : "";
  return `${sign}${(v * 100).toFixed(1)}%`;
}

// 判断ログ(UI改修タスク2): 日本株慣習(プラス=赤系/マイナス=緑系)に統一し、
// 全ての符号付き数値列でこの関数をそのまま使う(列ごとの符号反転はしない)。
// 表示は小数第1位までの%(fmtPct)なので、四捨五入後に0.0%になる近傍
// (|v|<0.0005)はニュートラル色にする(色と表示テキストの符号が食い違うのを防ぐ)。
function pctColor(v: number | null): string {
  if (v === null || v === undefined) return TEXT_DEFAULT;
  if (Math.abs(v) < 0.0005) return TEXT_DEFAULT;
  return v >= 0 ? UP : DOWN;
}

function fmtPrice(v: number | null): string {
  if (v === null || v === undefined) return "—";
  return v.toLocaleString("ja-JP");
}

// 時価総額(円)を億円/兆円表示に変換。例: 1234億, 1.2兆
function fmtMarketCap(v: number | null): string {
  if (v === null || v === undefined) return "-";
  const oku = v / 100_000_000;
  if (oku >= 10000) return `${(oku / 10000).toFixed(1)}兆`;
  return `${Math.round(oku).toLocaleString("ja-JP")}億`;
}

// 時価総額フィルタの閾値定数(円単位)。後で調整できるようここにまとめる。
const MARKET_CAP_LARGE_MIN = 300_000_000_000; // 3000億
const MARKET_CAP_MID_MIN = 30_000_000_000; // 300億

const MARKET_CAP_FILTERS = {
  all: { label: "全て" },
  large: { label: "大型(3000億以上)" },
  mid: { label: "中型(300億〜3000億)" },
  small: { label: "小型(300億未満)" },
} as const;
type MarketCapFilterKey = keyof typeof MARKET_CAP_FILTERS;

// 判断ログ: 「全て」はmarket_cap=nullの銘柄も含む(絞り込みなし)。大型/中型/小型は
// nullを対象外にする(仕様書に規定なし。数値が無いものを特定区分に分類できないため)。
function matchesMarketCapFilter(mc: number | null, key: MarketCapFilterKey): boolean {
  if (key === "all") return true;
  if (mc === null || mc === undefined) return false;
  if (key === "large") return mc >= MARKET_CAP_LARGE_MIN;
  if (key === "mid") return mc >= MARKET_CAP_MID_MIN && mc < MARKET_CAP_LARGE_MIN;
  return mc < MARKET_CAP_MID_MIN; // small
}

// 大型耐性ピック抽出条件の定数(値の根拠を1行ずつ明記)
const MEGA_CAP_MIN = 300_000_000_000; // 3000億 = Phase1の時価総額フィルタ「大型」プリセットと整合
const STRONG_RATIO_MIN = 0.6; // strong_day_count/crash_day_count比率の閾値。局面の長さ(crash_day_count)に依存しない基準にするため比率で判定

function MegaCapPickBlock({
  stocks, crashDayCount, onTap, highlightSectors,
}: {
  stocks: CrashStock[]; crashDayCount: number; onTap: (code: string) => void;
  highlightSectors: Set<string>;
}) {
  const picks = useMemo(() => {
    // 判断ログ(UI改修タスク1): already_recovered===false条件を撤廃。
    // 局面終盤は奪回済み銘柄が主になる想定のため、sectionバッジ(S含む)で
    // 奪回状況を示しつつ枠自体には含める。
    const filtered = stocks.filter((s) =>
      s.market_cap !== null && s.market_cap >= MEGA_CAP_MIN &&
      s.strong_day_count / crashDayCount >= STRONG_RATIO_MIN
    );
    filtered.sort((a, b) => {
      if (b.strong_day_count !== a.strong_day_count) return b.strong_day_count - a.strong_day_count;
      return (b.market_cap ?? 0) - (a.market_cap ?? 0);
    });
    return filtered;
  }, [stocks, crashDayCount]);

  const nameMap = useMemo(() => buildDisplayNames(picks), [picks]);

  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontFamily: monoFont, fontSize: 12, fontWeight: 700, color: TEXT_BRIGHT, marginBottom: 2, paddingLeft: 2 }}>
        大型耐性ピック（{picks.length}）
      </div>
      <div style={{ fontFamily: monoFont, fontSize: 10, color: TEXT_DEFAULT, marginBottom: 6, paddingLeft: 2 }}>
        時価総額3000億以上・暴落日の6割以上で指数超え
      </div>
      {picks.length === 0 ? (
        <div style={{ fontFamily: monoFont, fontSize: 11, color: TEXT_DEFAULT, paddingLeft: 2 }}>該当なし</div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 480 }}>
            <thead>
              <tr>
                <th style={{ ...th, textAlign: "left" }}>コード</th>
                <th style={{ ...th, textAlign: "left" }}>銘柄</th>
                <th style={th}>時価総額</th>
                <th style={th}>強日数</th>
                <th style={th}>超過収益</th>
                <th style={{ ...th, textAlign: "left" }}>区分</th>
              </tr>
            </thead>
            <tbody>
              {picks.map((r) => (
                <tr
                  key={r.code}
                  onClick={() => onTap(r.code)}
                  style={{
                    cursor: "pointer",
                    background: highlightSectors.size > 0 && highlightSectors.has(r.sector) ? SECTOR_HIGHLIGHT_BG : undefined,
                  }}
                >
                  <td style={tdName}>{displayCode(r.code)}</td>
                  <td style={{ ...tdName, overflow: "hidden", textOverflow: "ellipsis" }}>{nameMap.get(r.code) ?? r.name}</td>
                  <td style={{ ...tdNum, textAlign: "right" }}>{fmtMarketCap(r.market_cap)}</td>
                  <td style={{ ...tdNum, textAlign: "right", ...strongDayStyle(r.strong_day_count, crashDayCount) }}>
                    {r.strong_day_count}/{crashDayCount}
                  </td>
                  <td style={{ ...tdNum, textAlign: "right", color: pctColor(r.cum_excess_return) }}>{fmtPct(r.cum_excess_return)}</td>
                  <td style={{ ...tdBase, color: SECTION_COLOR[r.section] }}>{r.section}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// 判断ログ(UI改修タスク9): ハイライトは「行背景をうっすら」方式を選んだ。
// テキスト色(業種名・銘柄名を赤系に)にすると、既存の損益色(赤=プラス)や
// tierボーダー(high=暖色)と同じ色相域を奪い合って紛らわしくなるため、
// 未使用の青系を背景に薄く敷く方式にして完全に別レイヤーとして共存させた。
const SECTOR_HIGHLIGHT_BG = "rgba(70,140,255,0.16)";
const SECTOR_HIGHLIGHT_BORDER = "#5b8cff";

function SectorHighlightControl({
  sectors, selected, onToggle,
}: { sectors: string[]; selected: Set<string>; onToggle: (sector: string) => void }) {
  if (sectors.length === 0) return null;
  return (
    <div style={{ display: "flex", gap: 6, marginBottom: 10, flexWrap: "wrap" }}>
      {sectors.map((sec) => {
        const active = selected.has(sec);
        return (
          <button
            key={sec}
            type="button"
            onClick={() => onToggle(sec)}
            style={{
              padding: "4px 8px", borderRadius: 9999, fontSize: 10, fontFamily: monoFont,
              border: active ? `1px solid ${SECTOR_HIGHLIGHT_BORDER}` : "1px solid #3a3d42",
              background: active ? "rgba(70,140,255,0.22)" : "transparent",
              color: active ? TEXT_BRIGHT : TEXT_DEFAULT, cursor: "pointer",
            }}
          >
            {sec}
          </button>
        );
      })}
    </div>
  );
}

function MarketCapFilterControl({
  value, onChange,
}: { value: MarketCapFilterKey; onChange: (v: MarketCapFilterKey) => void }) {
  return (
    <div style={{ display: "flex", gap: 6, marginBottom: 10, flexWrap: "wrap" }}>
      {(Object.keys(MARKET_CAP_FILTERS) as MarketCapFilterKey[]).map((key) => {
        const active = value === key;
        return (
          <button
            key={key}
            type="button"
            onClick={() => onChange(key)}
            style={{
              padding: "5px 10px", borderRadius: 9999, fontSize: 11, fontFamily: monoFont,
              border: active ? "1px solid #8a8a8e" : "1px solid #3a3d42",
              background: active ? "#3c4043" : "transparent",
              color: active ? TEXT_BRIGHT : TEXT_DEFAULT, cursor: "pointer",
            }}
          >
            {MARKET_CAP_FILTERS[key].label}
          </button>
        );
      })}
    </div>
  );
}

// J-QuantsのLocalCodeは5桁(4桁コード+末尾0埋め、新形式の英字混在コードも同様)。
// 表示はRankingTabs.tsx等の既存ページに合わせ4桁化する。データ結合・/chart?codes=への
// 引き渡しなど内部処理は5桁のまま(この関数は表示専用、呼び出し側で使い分けること)。
function displayCode(code: string): string {
  return code.slice(0, 4);
}

function openChart(codes: string[]) {
  if (codes.length === 0) return;
  window.open(`/chart?codes=${codes.join(",")}`, "_blank");
}

function toCsv(rows: CrashStock[]): string {
  const header = [
    "code", "name", "sector", "section", "tier", "absolute_positive", "close", "market_cap", "top_ret",
    "cum_excess_return", "strong_day_count", "dist_to_high", "already_recovered",
    "ma25_deviation", "days_from_52w_high", "pre_crash_high",
  ];
  const lines = [header.join(",")];
  for (const r of rows) {
    lines.push([
      displayCode(r.code), `"${r.name}"`, r.sector, r.section, r.tier ?? "", r.absolute_positive,
      r.close ?? "", r.market_cap ?? "", r.top_ret ?? "", r.cum_excess_return ?? "", r.strong_day_count,
      r.dist_to_high ?? "", r.already_recovered, r.ma25_deviation ?? "",
      r.days_from_52w_high ?? "", r.pre_crash_high ?? "",
    ].join(","));
  }
  return lines.join("\n");
}

function downloadCsv(rows: CrashStock[], filename: string) {
  const csv = toCsv(rows);
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function StatusBanner({ snapshot }: { snapshot: CrashSnapshot }) {
  const { status, phase, date, population_stats } = snapshot;
  const color = status === "ACTIVE" ? "#e05555" : status === "COOLDOWN" ? "#cc8800" : "#5f9e6e";
  const label = status === "ACTIVE" ? "ACTIVE" : status === "COOLDOWN" ? "COOLDOWN" : "IDLE";
  return (
    <div
      style={{
        borderRadius: 10,
        padding: "10px 12px",
        marginBottom: 12,
        background: "#1c1c1f",
        border: `1px solid ${color}55`,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ width: 8, height: 8, borderRadius: 9999, background: color }} />
        <span style={{ fontFamily: monoFont, fontSize: 13, fontWeight: 700, color: TEXT_BRIGHT }}>{label}</span>
        <span style={{ fontFamily: monoFont, fontSize: 11, color: TEXT_DEFAULT, marginLeft: "auto" }}>
          基準日 {date}
        </span>
      </div>
      {phase && (
        <div style={{ fontFamily: monoFont, fontSize: 11, color: TEXT_DEFAULT, marginTop: 6, lineHeight: 1.6 }}>
          局面{phase.day_index}日目（開始{phase.start}） / 暴落日数{phase.crash_day_count} / 指数DD
          <span style={{ color: pctColor(phase.index_max_dd) }}> {fmtPct(phase.index_max_dd)}</span>
          {status !== "ACTIVE" && phase.end_reason && <> / 終了理由: {phase.end_reason}</>}
        </div>
      )}
      {population_stats && (
        <div style={{ fontFamily: monoFont, fontSize: 11, color: TEXT_DEFAULT, marginTop: 4 }}>
          母集団{population_stats.n}銘柄中 指数超過プラス(★): {population_stats.positive_count}銘柄
          （中央値{fmtPct(population_stats.median_cum_excess_return)}）
        </div>
      )}
      {!phase && <div style={{ fontFamily: monoFont, fontSize: 11, color: TEXT_DEFAULT, marginTop: 6 }}>平常時</div>}
    </div>
  );
}

function StockRow({
  r, onTap, crashDayCount, displayName, highlighted,
}: {
  r: CrashStock; onTap: (code: string) => void; crashDayCount: number | null | undefined;
  displayName: string; highlighted: boolean;
}) {
  return (
    <tr
      onClick={() => onTap(r.code)}
      style={{ cursor: "pointer", background: highlighted ? SECTOR_HIGHLIGHT_BG : undefined }}
    >
      <td style={{ ...tdName, ...tdCode, borderLeft: `4px solid ${tierColor(r.tier)}` }}>{displayCode(r.code)}</td>
      <td style={{ ...tdName, ...tdNameCol }}>
        {displayName}
        {r.absolute_positive && <span style={{ color: "#ffa500", marginLeft: 3 }}>★</span>}
      </td>
      <td style={{ ...tdBase, ...tdSectorCol }}>{shortSector(r.sector)}</td>
      <td style={{ ...tdNum, ...tdExcessCol, textAlign: "right", color: pctColor(r.cum_excess_return) }}>
        {fmtPct(r.cum_excess_return)}
      </td>
      <td style={{ ...tdNum, ...tdStrongCol, textAlign: "right", ...strongDayStyle(r.strong_day_count, crashDayCount) }}>
        {r.strong_day_count}
      </td>
      <td style={{ ...tdNum, textAlign: "right", color: pctColor(r.dist_to_high) }}>
        {fmtPct(r.dist_to_high)}
      </td>
      <td style={{ ...tdNum, textAlign: "right" }}>{fmtMarketCap(r.market_cap)}</td>
      <td style={{ ...tdNum, textAlign: "right" }}>{fmtPrice(r.close)}</td>
      <td style={{ ...tdNum, textAlign: "right", color: pctColor(r.top_ret) }}>{fmtPct(r.top_ret)}</td>
    </tr>
  );
}

// 判断ログ(UI改修タスク4): 行が詰まりすぎとの指摘のため、上下paddingを
// 4px→6px(1.5倍)に拡大。左右は列幅がタイトなタスク5の要件があるため据え置き。
const th: React.CSSProperties = {
  position: "sticky", top: 0, background: BASE_BG, color: "#8e8e93",
  fontSize: 10, fontWeight: 600, fontFamily: monoFont, padding: "6px 2px",
  whiteSpace: "nowrap", borderBottom: "1px solid #2a2d34", textAlign: "right",
};
const tdBase: React.CSSProperties = {
  fontSize: 11, fontFamily: monoFont, color: TEXT_DEFAULT, padding: "6px 2px",
  whiteSpace: "nowrap", borderBottom: "1px solid rgba(255,255,255,0.05)",
};
const tdName: React.CSSProperties = { ...tdBase, color: TEXT_NAME };
const tdNum: React.CSSProperties = { ...tdBase, fontVariantNumeric: "tabular-nums" };

// 判断ログ(UI改修タスク5): まとめタブの新列順で「コード〜強日数」がモバイル
// 縦持ち1画面幅(390px)に収まることが必須要件のため、この5列だけ明示的に
// 幅を絞る。調整優先順(指示通り): 銘柄名の最大幅を詰める→業種を略称化→
// コード列を細くする、の順で効かせている(コード列の圧縮は最後の手段として
// 8pxのみに留めた)。
const tdCode: React.CSSProperties = { maxWidth: 34, overflow: "hidden", textOverflow: "ellipsis" };
const tdNameCol: React.CSSProperties = { maxWidth: 64, overflow: "hidden", textOverflow: "ellipsis" };
const tdSectorCol: React.CSSProperties = { maxWidth: 34, overflow: "hidden", textOverflow: "ellipsis" };
const tdExcessCol: React.CSSProperties = { maxWidth: 52 };
const tdStrongCol: React.CSSProperties = { maxWidth: 30 };

function SummarySection({
  section, rows, onTap, crashDayCount, nameMap, highlightSectors,
}: {
  section: CrashStock["section"]; rows: CrashStock[]; onTap: (code: string) => void;
  crashDayCount: number | null | undefined;
  nameMap: Map<string, string>; highlightSectors: Set<string>;
}) {
  if (rows.length === 0) return null;
  return (
    <div style={{ marginBottom: 14 }}>
      <div
        style={{
          fontFamily: monoFont, fontSize: 12, fontWeight: 700,
          color: SECTION_COLOR[section], marginBottom: 6, paddingLeft: 2,
        }}
      >
        {SECTION_LABEL[section]}（{rows.length}）
      </div>
      {/* 判断ログ(タスク5): tableにminWidthを固定せず、コード〜強日数の5列は
          明示的なmaxWidthで詰め、距離以降の4列は自然幅に任せる。これにより
          「コード〜強日数」が390px以内に収まれば横スクロール無しで見え、
          収まらない分(距離〜top_ret)だけ横スクロール対象になる。 */}
      <div style={{ overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse", width: "100%" }}>
          <thead>
            <tr>
              <th style={{ ...th, ...tdCode, textAlign: "left" }}>コード</th>
              <th style={{ ...th, ...tdNameCol, textAlign: "left" }}>銘柄</th>
              <th style={{ ...th, ...tdSectorCol, textAlign: "left" }}>業種</th>
              <th style={{ ...th, ...tdExcessCol }}>超過収益</th>
              <th style={{ ...th, ...tdStrongCol }}>強日数</th>
              <th style={th}>距離</th>
              <th style={th}>時価総額</th>
              <th style={th}>終値</th>
              <th style={th}>top_ret</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <StockRow
                key={r.code}
                r={r}
                onTap={onTap}
                crashDayCount={crashDayCount}
                displayName={nameMap.get(r.code) ?? r.name}
                highlighted={highlightSectors.size > 0 && highlightSectors.has(r.sector)}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// データタブ: 仕様書「全列、ソート・フィルタ可」用の列定義
type SortKey = keyof Pick<CrashStock,
  "code" | "name" | "sector" | "close" | "market_cap" | "top_ret" | "cum_excess_return" | "tier" |
  "strong_day_count" | "dist_to_high" | "already_recovered" | "ma25_deviation" |
  "days_from_52w_high" | "pre_crash_high" | "section" | "absolute_positive"
>;

const DATA_COLUMNS: { key: SortKey; label: string; align: "left" | "right" }[] = [
  { key: "code", label: "コード", align: "left" },
  { key: "name", label: "銘柄", align: "left" },
  { key: "sector", label: "業種", align: "left" },
  { key: "section", label: "区分", align: "left" },
  { key: "tier", label: "耐性", align: "left" },
  { key: "absolute_positive", label: "絶対★", align: "left" },
  { key: "close", label: "終値", align: "right" },
  { key: "market_cap", label: "時価総額", align: "right" },
  { key: "top_ret", label: "上昇率", align: "right" },
  { key: "cum_excess_return", label: "累積超過R", align: "right" },
  { key: "strong_day_count", label: "強日数", align: "right" },
  { key: "dist_to_high", label: "距離", align: "right" },
  { key: "already_recovered", label: "奪回済", align: "right" },
  { key: "ma25_deviation", label: "ma25乖離", align: "right" },
  { key: "days_from_52w_high", label: "52w高値日数", align: "right" },
  { key: "pre_crash_high", label: "pre_crash_high", align: "right" },
];

// 判断ログ(UI改修タスク2): データタブは元々符号付き列に色を付けていなかった。
// 「全数値列で一貫」の対象としてデータタブにも同じ色付けを適用する。
function dataCellExtraStyle(
  r: CrashStock, key: SortKey, crashDayCount: number | null | undefined
): React.CSSProperties {
  if (key === "top_ret" || key === "cum_excess_return" || key === "dist_to_high" || key === "ma25_deviation") {
    return { color: pctColor(r[key] as number | null) };
  }
  if (key === "strong_day_count") {
    return strongDayStyle(r.strong_day_count, crashDayCount);
  }
  return {};
}

function cellValue(r: CrashStock, key: SortKey): string {
  const v = r[key];
  if (key === "market_cap") return fmtMarketCap(v as number | null);
  if (v === null || v === undefined) return "—";
  if (key === "code") return displayCode(v as string);
  if (key === "already_recovered") return v ? "○" : "";
  if (key === "absolute_positive") return v ? "★" : "";
  if (key === "close" || key === "pre_crash_high") return fmtPrice(v as number);
  if (key === "top_ret" || key === "cum_excess_return" || key === "dist_to_high" || key === "ma25_deviation") {
    return fmtPct(v as number);
  }
  return String(v);
}

// 判断ログ(Phase6): 「進行中」局面の判定はend_reason==="データ末尾到達"で行う
// (classify_status()の定義そのもの。crash_index.jsonの最終局面のみこの値を取り得る)。
const ONGOING_END_REASON = "データ末尾到達";

function phaseDurationDays(start: string, end: string): number {
  const ms = new Date(`${end}T00:00:00Z`).getTime() - new Date(`${start}T00:00:00Z`).getTime();
  return Math.round(ms / 86_400_000) + 1;
}

function PhaseHistoryTab({
  index, onJumpToDate,
}: {
  index: CrashIndex | null;
  onJumpToDate: (date: string | null) => void;
}) {
  const phases = index?.phases ?? [];
  const dateSet = new Set(index?.dates ?? []);
  const latestDate = index?.dates?.[index.dates.length - 1] ?? null;
  // 新しい順(=配列を逆順)。進行中局面はcrash_index.json上も末尾(最新)にあるため、
  // 逆順にすれば自然に先頭に来る。
  const rows = [...phases].reverse();

  if (rows.length === 0) {
    return (
      <div style={{ fontFamily: monoFont, fontSize: 12, color: TEXT_DEFAULT, padding: "8px 2px" }}>
        局面履歴データがありません。
      </div>
    );
  }

  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 640 }}>
        <thead>
          <tr>
            <th style={{ ...th, textAlign: "left" }}>開始日</th>
            <th style={{ ...th, textAlign: "left" }}>終了日</th>
            <th style={th}>暴落日数</th>
            <th style={th}>指数最大DD</th>
            <th style={{ ...th, textAlign: "left" }}>終了理由</th>
            <th style={th}>期間日数</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => {
            const ongoing = p.end_reason === ONGOING_END_REASON;
            const hasSnapshot = dateSet.has(p.end);
            const tappable = hasSnapshot;
            return (
              <tr
                key={`${p.start}_${p.end}`}
                onClick={tappable ? () => onJumpToDate(p.end === latestDate ? null : p.end) : undefined}
                style={{
                  cursor: tappable ? "pointer" : "default",
                  opacity: tappable ? 1 : 0.45,
                }}
              >
                <td style={tdName}>{p.start}</td>
                <td style={tdName}>
                  {ongoing ? <span style={{ color: "#e05555", fontWeight: 700 }}>進行中</span> : p.end}
                </td>
                <td style={{ ...tdNum, textAlign: "right" }}>{p.crash_day_count}</td>
                <td style={{ ...tdNum, textAlign: "right", color: pctColor(p.index_max_dd) }}>
                  {fmtPct(p.index_max_dd)}
                </td>
                <td style={tdBase}>
                  {p.end_reason ?? "—"}
                  {!hasSnapshot && (
                    <span style={{ color: TEXT_DEFAULT, marginLeft: 6, fontSize: 10 }}>(詳細データなし)</span>
                  )}
                </td>
                <td style={{ ...tdNum, textAlign: "right" }}>{phaseDurationDays(p.start, p.end)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function DataTab({
  snapshot, index, marketCapFilter, onRowTap, onOpenGlossary, selectedDate, onSelectedDateChange,
}: {
  snapshot: CrashSnapshot; index: CrashIndex | null; marketCapFilter: MarketCapFilterKey;
  onRowTap: (code: string, phase: CrashPhaseInfo | null) => void;
  onOpenGlossary: () => void;
  // Phase6: 局面履歴タブからの日付ジャンプに対応するため、selectedDateはCrashClient側で制御する。
  selectedDate: string | null;
  onSelectedDateChange: (date: string | null) => void;
}) {
  // 判断ログ: react-hooks/set-state-in-effect(effect本体で同期的にsetStateを呼ぶことを
  // 禁止する新しいlintルール)対策として、setState呼び出しは全てfetchの.then/.catch内に
  // 収め、loadingは「選択中の日付とfetch済みの日付が一致しているか」から導出する
  // (専用のloading stateを持たない)。
  const [fetchedDate, setFetchedDate] = useState<string | null>(null);
  const [fetchedRows, setFetchedRows] = useState<CrashStock[] | null>(null);
  // Phase4: モーダルのマーカー注入用。表示中の日付に対応するphase(start/crash_days)を保持する。
  const [fetchedPhase, setFetchedPhase] = useState<CrashPhaseInfo | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("section");
  const [sortAsc, setSortAsc] = useState(true);

  useEffect(() => {
    if (!selectedDate) return;
    let cancelled = false;
    const compact = selectedDate.replace(/-/g, "");
    fetch(`/data/crash/crash_watchlist_${compact}.json`)
      .then((r) => r.json())
      .then((d: CrashSnapshot) => {
        if (cancelled) return;
        setFetchedRows(d.stocks ?? []);
        setFetchedPhase(d.phase ?? null);
        setFetchedDate(selectedDate);
      })
      .catch(() => {
        if (cancelled) return;
        setFetchedRows([]);
        setFetchedPhase(null);
        setFetchedDate(selectedDate);
      });
    return () => { cancelled = true; };
  }, [selectedDate]);

  // 表示中スナップショットのphase。過去日付セレクタで選択中ならそのスナップショットのphaseを使う。
  const currentPhase = !selectedDate ? snapshot.phase : (fetchedDate === selectedDate ? fetchedPhase : null);

  const loading = !!selectedDate && fetchedDate !== selectedDate;

  const sortedRows = useMemo(() => {
    const rows = !selectedDate ? snapshot.stocks : (fetchedDate === selectedDate ? (fetchedRows ?? []) : []);
    const copy = rows.filter((r) => matchesMarketCapFilter(r.market_cap, marketCapFilter));
    copy.sort((a, b) => {
      // 判断ログ(Phase5): section列は文字列アルファベット順(A<B<C<D<S)だと
      // まとめタブの表示順(S→A→B→C→D)と食い違うため、専用のカスタム順序を使う。
      // 同section内はソート方向(昇順/降順)によらず常にcum_excess_return降順に揃える
      // (まとめタブのbuild_watchlist_rowsソート仕様「各区分内はcum_excess_return降順」と一致させる)。
      if (sortKey === "section") {
        const ao = SECTION_ORDER[a.section];
        const bo = SECTION_ORDER[b.section];
        if (ao !== bo) {
          const cmp = ao - bo;
          return sortAsc ? cmp : -cmp;
        }
        const ace = a.cum_excess_return ?? -Infinity;
        const bce = b.cum_excess_return ?? -Infinity;
        return bce - ace;
      }
      const av = a[sortKey];
      const bv = b[sortKey];
      if (av === null || av === undefined) return 1;
      if (bv === null || bv === undefined) return -1;
      if (av === bv) return 0;
      const cmp = av > bv ? 1 : -1;
      return sortAsc ? cmp : -cmp;
    });
    return copy;
  }, [selectedDate, snapshot.stocks, fetchedDate, fetchedRows, sortKey, sortAsc, marketCapFilter]);

  const dates = index?.dates ?? [];

  const nameMap = useMemo(() => buildDisplayNames(sortedRows), [sortedRows]);

  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 10, alignItems: "center", flexWrap: "wrap" }}>
        {dates.length > 1 && (
          <select
            value={selectedDate ?? dates[dates.length - 1]}
            onChange={(e) => {
              const v = e.target.value;
              onSelectedDateChange(v === dates[dates.length - 1] ? null : v);
            }}
            style={{
              fontFamily: monoFont, fontSize: 12, background: "#2a2c2f", color: TEXT_BRIGHT,
              border: "1px solid #4a4d52", borderRadius: 6, padding: "4px 6px",
            }}
          >
            {dates.slice().reverse().map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
        )}
        <button
          type="button"
          onClick={() => downloadCsv(sortedRows, `crash_watchlist_${selectedDate ?? snapshot.date}.csv`)}
          style={chipButtonStyle}
        >
          CSVダウンロード
        </button>
        <button
          type="button"
          onClick={() => openChart(sortedRows.map((r) => r.code))}
          style={chipButtonStyle}
        >
          チャート生成
        </button>
        <button
          type="button"
          onClick={onOpenGlossary}
          aria-label="用語解説"
          style={glossaryButtonStyle}
        >
          ?
        </button>
        {loading && <span style={{ fontFamily: monoFont, fontSize: 11, color: TEXT_DEFAULT }}>読込中...</span>}
      </div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 920 }}>
          <thead>
            <tr>
              {DATA_COLUMNS.map((c) => (
                <th
                  key={c.key}
                  style={{ ...th, textAlign: c.align, cursor: "pointer" }}
                  onClick={() => {
                    if (sortKey === c.key) setSortAsc((v) => !v);
                    else { setSortKey(c.key); setSortAsc(true); }
                  }}
                >
                  {c.label}{sortKey === c.key ? (sortAsc ? " ▲" : " ▼") : ""}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sortedRows.map((r) => (
              <tr key={r.code} onClick={() => onRowTap(r.code, currentPhase)} style={{ cursor: "pointer" }}>
                {DATA_COLUMNS.map((c) => (
                  <td
                    key={c.key}
                    style={{
                      ...tdBase,
                      textAlign: c.align,
                      color: c.key === "name" || c.key === "code" ? TEXT_NAME : TEXT_DEFAULT,
                      ...(c.key === "code" ? { borderLeft: `4px solid ${tierColor(r.tier)}` } : {}),
                      ...dataCellExtraStyle(r, c.key, currentPhase?.crash_day_count),
                    }}
                  >
                    {c.key === "name" ? (nameMap.get(r.code) ?? r.name) : cellValue(r, c.key)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const chipButtonStyle: React.CSSProperties = {
  padding: "6px 12px", borderRadius: 6, fontSize: 12, fontWeight: 600,
  background: "#3c4043", border: "1px solid #5f6368", color: TEXT_BRIGHT,
  cursor: "pointer", fontFamily: monoFont,
};

const glossaryButtonStyle: React.CSSProperties = {
  width: 26, height: 26, borderRadius: 9999, fontSize: 12, fontWeight: 700,
  background: "transparent", border: "1px solid #5f6368", color: TEXT_DEFAULT,
  cursor: "pointer", fontFamily: monoFont, lineHeight: "24px", padding: 0,
};

export default function CrashClient({
  initialSnapshot, index,
}: { initialSnapshot: CrashSnapshot | null; index: CrashIndex | null }) {
  const [tab, setTab] = useState<"summary" | "data" | "history">("summary");
  // Phase6: 局面履歴タブからデータタブへの日付ジャンプのため、selectedDateをここへ引き上げる。
  const [dataTabDate, setDataTabDate] = useState<string | null>(null);
  const [descOpen, setDescOpen] = useState(false);
  const [marketCapFilter, setMarketCapFilter] = useState<MarketCapFilterKey>("all");
  const [modalTarget, setModalTarget] = useState<{ code: string; phase: CrashPhaseInfo | null } | null>(null);
  const [glossaryOpen, setGlossaryOpen] = useState(false);
  // UI改修タスク9: タブ切替では維持、リロードで消えてよいのでReact stateのみで保持する。
  const [highlightSectors, setHighlightSectors] = useState<Set<string>>(new Set());
  const setHeader = useHeader();

  useEffect(() => {
    setHeader({
      date: initialSnapshot?.date,
      descToggle: { open: descOpen, onToggle: () => setDescOpen((o) => !o), description: CRASH_DESCRIPTION },
    });
  }, [initialSnapshot?.date, descOpen, setHeader]);

  // 判断ログ: Reactのフックはアーリーリターンより前に無条件で呼ぶ必要があるため、
  // useMemoSectionsはinitialSnapshotのnullチェックより先に(空配列fallbackで)呼ぶ。
  const filteredStocks = useMemo(
    () => (initialSnapshot?.stocks ?? []).filter((s) => matchesMarketCapFilter(s.market_cap, marketCapFilter)),
    [initialSnapshot?.stocks, marketCapFilter]
  );
  const bySection = useMemoSections(filteredStocks);
  const nameMap = useMemo(() => buildDisplayNames(filteredStocks), [filteredStocks]);
  // UI改修タスク9: 選択肢は現スナップショットの全銘柄(市場総額フィルタ前)から集める。
  const sectorOptions = useMemo(() => {
    const set = new Set((initialSnapshot?.stocks ?? []).map((s) => s.sector).filter(Boolean));
    return Array.from(set).sort();
  }, [initialSnapshot?.stocks]);
  const toggleHighlightSector = (sector: string) => {
    setHighlightSectors((prev) => {
      const next = new Set(prev);
      if (next.has(sector)) next.delete(sector);
      else next.add(sector);
      return next;
    });
  };

  if (!initialSnapshot) {
    return (
      <div style={{ background: BASE_BG, minHeight: "100vh", padding: 16, color: TEXT_DEFAULT, fontFamily: monoFont, fontSize: 13 }}>
        データがまだありません（初回バッチ未実行）。
      </div>
    );
  }

  return (
    <div style={{ backgroundColor: BASE_BG, minHeight: "100vh", paddingTop: 0, paddingBottom: 24, paddingLeft: 12, paddingRight: 12 }}>
      {/* 内部タブ(まとめ/データ/局面履歴) */}
      <div
        style={{
          display: "flex", gap: 2, marginBottom: 12, padding: 3,
          borderRadius: 9999, background: "#1c1c1f", border: "1px solid #2a2d34",
        }}
      >
        {([["summary", "まとめ"], ["data", "データ"], ["history", "局面履歴"]] as const).map(([key, label]) => {
          const active = tab === key;
          return (
            <button
              key={key}
              onClick={() => setTab(key)}
              style={{
                flex: 1, padding: "8px 0", borderRadius: 9999, fontFamily: monoFont, fontSize: 13,
                textAlign: "center", border: "none", transition: "background 0.15s, color 0.15s",
                background: active ? "#46494d" : "transparent",
                boxShadow: active ? "0 1px 3px rgba(0,0,0,0.4)" : "none",
                color: active ? TEXT_BRIGHT : "#8e8e93", fontWeight: active ? 600 : 500,
              }}
            >
              {label}
            </button>
          );
        })}
      </div>

      <StatusBanner snapshot={initialSnapshot} />

      {tab !== "history" && <MarketCapFilterControl value={marketCapFilter} onChange={setMarketCapFilter} />}

      {tab === "summary" && (
        <SectorHighlightControl
          sectors={sectorOptions}
          selected={highlightSectors}
          onToggle={toggleHighlightSector}
        />
      )}

      {tab === "summary" ? (
        initialSnapshot.status === "ACTIVE" ? (
          <>
            <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <button
                type="button"
                onClick={() => setGlossaryOpen(true)}
                aria-label="用語解説"
                style={glossaryButtonStyle}
              >
                ?
              </button>
              <button
                type="button"
                onClick={() => openChart(filteredStocks.map((r) => r.code))}
                style={chipButtonStyle}
              >
                チャート生成
              </button>
            </div>
            {(initialSnapshot.phase?.crash_day_count ?? 0) > 0 && (
              <MegaCapPickBlock
                stocks={initialSnapshot.stocks}
                crashDayCount={initialSnapshot.phase!.crash_day_count}
                onTap={(code) => setModalTarget({ code, phase: initialSnapshot.phase })}
                highlightSectors={highlightSectors}
              />
            )}
            {(["S", "A", "B", "C", "D"] as const).map((s) => (
              <SummarySection
                key={s}
                section={s}
                rows={bySection[s]}
                onTap={(code) => setModalTarget({ code, phase: initialSnapshot.phase })}
                crashDayCount={initialSnapshot.phase?.crash_day_count}
                nameMap={nameMap}
                highlightSectors={highlightSectors}
              />
            ))}
            {initialSnapshot.stocks.length === 0 && (
              <div style={{ fontFamily: monoFont, fontSize: 12, color: TEXT_DEFAULT }}>
                母集団0件、または特徴量計算対象がありません。
              </div>
            )}
            {initialSnapshot.stocks.length > 0 && filteredStocks.length === 0 && (
              <div style={{ fontFamily: monoFont, fontSize: 12, color: TEXT_DEFAULT }}>
                時価総額フィルタに一致する銘柄がありません。
              </div>
            )}
          </>
        ) : (
          <div style={{ fontFamily: monoFont, fontSize: 12, color: TEXT_DEFAULT, padding: "8px 2px" }}>
            現在ACTIVEな局面はありません。過去局面の一覧・明細は「データ」タブから参照できます。
          </div>
        )
      ) : tab === "data" ? (
        <DataTab
          snapshot={initialSnapshot}
          index={index}
          marketCapFilter={marketCapFilter}
          onRowTap={(code, phase) => setModalTarget({ code, phase })}
          onOpenGlossary={() => setGlossaryOpen(true)}
          selectedDate={dataTabDate}
          onSelectedDateChange={setDataTabDate}
        />
      ) : (
        <PhaseHistoryTab
          index={index}
          onJumpToDate={(date) => {
            setDataTabDate(date);
            setTab("data");
          }}
        />
      )}

      {modalTarget && (
        <ChartModal
          code={modalTarget.code}
          phase={modalTarget.phase}
          onClose={() => setModalTarget(null)}
        />
      )}

      {glossaryOpen && <GlossaryModal onClose={() => setGlossaryOpen(false)} />}
    </div>
  );
}

function useMemoSections(stocks: CrashStock[]) {
  return useMemo(() => {
    const groups: Record<CrashStock["section"], CrashStock[]> = { S: [], A: [], B: [], C: [], D: [] };
    for (const s of stocks) groups[s.section].push(s);
    return groups;
  }, [stocks]);
}
