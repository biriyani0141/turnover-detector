"use client";
import React, { useEffect, useMemo, useState } from "react";
import { useHeader } from "../_components/HeaderContext";

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
  section: "S" | "A" | "B" | "C" | "D";
  // tier(母集団内相対順位)とは独立の絶対強度フラグ。cum_excess_return > 0 で true。
  // tier・sectionの判定には使わない、表示専用の付加情報。
  absolute_positive: boolean;
};

export type CrashPhaseInfo = {
  start: string;
  end_reason: string | null;
  crash_day_count: number;
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

function fmtPct(v: number | null): string {
  if (v === null || v === undefined) return "—";
  const sign = v >= 0 ? "+" : "";
  return `${sign}${(v * 100).toFixed(1)}%`;
}

function pctColor(v: number | null): string {
  if (v === null || v === undefined) return TEXT_DEFAULT;
  return v >= 0 ? UP : DOWN;
}

function fmtPrice(v: number | null): string {
  if (v === null || v === undefined) return "—";
  return v.toLocaleString("ja-JP");
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
    "code", "name", "sector", "section", "tier", "absolute_positive", "close", "top_ret",
    "cum_excess_return", "strong_day_count", "dist_to_high", "already_recovered",
    "ma25_deviation", "days_from_52w_high", "pre_crash_high",
  ];
  const lines = [header.join(",")];
  for (const r of rows) {
    lines.push([
      displayCode(r.code), `"${r.name}"`, r.sector, r.section, r.tier ?? "", r.absolute_positive,
      r.close ?? "", r.top_ret ?? "", r.cum_excess_return ?? "", r.strong_day_count,
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

function StockRow({ r, onTap }: { r: CrashStock; onTap: (code: string) => void }) {
  return (
    <tr onClick={() => onTap(r.code)} style={{ cursor: "pointer" }}>
      <td style={{ ...tdName }}>{displayCode(r.code)}</td>
      <td style={{ ...tdName, overflow: "hidden", textOverflow: "ellipsis" }}>
        {r.name}
        {r.absolute_positive && <span style={{ color: "#ffa500", marginLeft: 3 }}>★</span>}
      </td>
      <td style={{ ...tdNum, textAlign: "right" }}>{fmtPrice(r.close)}</td>
      <td style={{ ...tdNum, textAlign: "right", color: pctColor(r.dist_to_high !== null ? -r.dist_to_high : null) }}>
        {fmtPct(r.dist_to_high)}
      </td>
      <td style={{ ...tdNum, textAlign: "right", color: pctColor(r.cum_excess_return) }}>
        {fmtPct(r.cum_excess_return)}
      </td>
      <td style={{ ...tdNum, textAlign: "right" }}>{r.strong_day_count}</td>
      <td style={{ ...tdNum, textAlign: "right" }}>{fmtPct(r.top_ret)}</td>
      <td style={{ ...tdNum, textAlign: "right", color: pctColor(r.ma25_deviation) }}>{fmtPct(r.ma25_deviation)}</td>
    </tr>
  );
}

const th: React.CSSProperties = {
  position: "sticky", top: 0, background: BASE_BG, color: "#8e8e93",
  fontSize: 10, fontWeight: 600, fontFamily: monoFont, padding: "4px 2px",
  whiteSpace: "nowrap", borderBottom: "1px solid #2a2d34", textAlign: "right",
};
const tdBase: React.CSSProperties = {
  fontSize: 11, fontFamily: monoFont, color: TEXT_DEFAULT, padding: "4px 2px",
  whiteSpace: "nowrap", borderBottom: "1px solid rgba(255,255,255,0.05)",
};
const tdName: React.CSSProperties = { ...tdBase, color: TEXT_NAME };
const tdNum: React.CSSProperties = { ...tdBase, fontVariantNumeric: "tabular-nums" };

function SummarySection({
  section, rows, onTap,
}: { section: CrashStock["section"]; rows: CrashStock[]; onTap: (code: string) => void }) {
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
      <div style={{ overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 480 }}>
          <thead>
            <tr>
              <th style={{ ...th, textAlign: "left" }}>コード</th>
              <th style={{ ...th, textAlign: "left" }}>銘柄</th>
              <th style={th}>終値</th>
              <th style={th}>距離</th>
              <th style={th}>超過収益</th>
              <th style={th}>強日数</th>
              <th style={th}>top_ret</th>
              <th style={th}>ma25乖離</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => <StockRow key={r.code} r={r} onTap={onTap} />)}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// データタブ: 仕様書「全列、ソート・フィルタ可」用の列定義
type SortKey = keyof Pick<CrashStock,
  "code" | "name" | "sector" | "close" | "top_ret" | "cum_excess_return" | "tier" |
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
  { key: "top_ret", label: "上昇率", align: "right" },
  { key: "cum_excess_return", label: "累積超過R", align: "right" },
  { key: "strong_day_count", label: "強日数", align: "right" },
  { key: "dist_to_high", label: "距離", align: "right" },
  { key: "already_recovered", label: "奪回済", align: "right" },
  { key: "ma25_deviation", label: "ma25乖離", align: "right" },
  { key: "days_from_52w_high", label: "52w高値日数", align: "right" },
  { key: "pre_crash_high", label: "pre_crash_high", align: "right" },
];

function cellValue(r: CrashStock, key: SortKey): string {
  const v = r[key];
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

function DataTab({ snapshot, index }: { snapshot: CrashSnapshot; index: CrashIndex | null }) {
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  // 判断ログ: react-hooks/set-state-in-effect(effect本体で同期的にsetStateを呼ぶことを
  // 禁止する新しいlintルール)対策として、setState呼び出しは全てfetchの.then/.catch内に
  // 収め、loadingは「選択中の日付とfetch済みの日付が一致しているか」から導出する
  // (専用のloading stateを持たない)。
  const [fetchedDate, setFetchedDate] = useState<string | null>(null);
  const [fetchedRows, setFetchedRows] = useState<CrashStock[] | null>(null);
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
        setFetchedDate(selectedDate);
      })
      .catch(() => {
        if (cancelled) return;
        setFetchedRows([]);
        setFetchedDate(selectedDate);
      });
    return () => { cancelled = true; };
  }, [selectedDate]);

  const loading = !!selectedDate && fetchedDate !== selectedDate;

  const sortedRows = useMemo(() => {
    const rows = !selectedDate ? snapshot.stocks : (fetchedDate === selectedDate ? (fetchedRows ?? []) : []);
    const copy = [...rows];
    copy.sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (av === null || av === undefined) return 1;
      if (bv === null || bv === undefined) return -1;
      if (av === bv) return 0;
      const cmp = av > bv ? 1 : -1;
      return sortAsc ? cmp : -cmp;
    });
    return copy;
  }, [selectedDate, snapshot.stocks, fetchedDate, fetchedRows, sortKey, sortAsc]);

  const dates = index?.dates ?? [];

  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 10, alignItems: "center", flexWrap: "wrap" }}>
        {dates.length > 1 && (
          <select
            value={selectedDate ?? dates[dates.length - 1]}
            onChange={(e) => {
              const v = e.target.value;
              setSelectedDate(v === dates[dates.length - 1] ? null : v);
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
              <tr key={r.code} onClick={() => openChart([r.code])} style={{ cursor: "pointer" }}>
                {DATA_COLUMNS.map((c) => (
                  <td
                    key={c.key}
                    style={{
                      ...tdBase,
                      textAlign: c.align,
                      color: c.key === "name" || c.key === "code" ? TEXT_NAME : TEXT_DEFAULT,
                    }}
                  >
                    {cellValue(r, c.key)}
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

export default function CrashClient({
  initialSnapshot, index,
}: { initialSnapshot: CrashSnapshot | null; index: CrashIndex | null }) {
  const [tab, setTab] = useState<"summary" | "data">("summary");
  const [descOpen, setDescOpen] = useState(false);
  const setHeader = useHeader();

  useEffect(() => {
    setHeader({
      date: initialSnapshot?.date,
      descToggle: { open: descOpen, onToggle: () => setDescOpen((o) => !o), description: CRASH_DESCRIPTION },
    });
  }, [initialSnapshot?.date, descOpen, setHeader]);

  // 判断ログ: Reactのフックはアーリーリターンより前に無条件で呼ぶ必要があるため、
  // useMemoSectionsはinitialSnapshotのnullチェックより先に(空配列fallbackで)呼ぶ。
  const bySection = useMemoSections(initialSnapshot?.stocks ?? []);

  if (!initialSnapshot) {
    return (
      <div style={{ background: BASE_BG, minHeight: "100vh", padding: 16, color: TEXT_DEFAULT, fontFamily: monoFont, fontSize: 13 }}>
        データがまだありません（初回バッチ未実行）。
      </div>
    );
  }

  return (
    <div style={{ backgroundColor: BASE_BG, minHeight: "100vh", paddingTop: 0, paddingBottom: 24, paddingLeft: 12, paddingRight: 12 }}>
      {/* 内部タブ(まとめ/データ) */}
      <div
        style={{
          display: "flex", gap: 2, marginBottom: 12, padding: 3,
          borderRadius: 9999, background: "#1c1c1f", border: "1px solid #2a2d34",
        }}
      >
        {([["summary", "まとめ"], ["data", "データ"]] as const).map(([key, label]) => {
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

      {tab === "summary" ? (
        initialSnapshot.status === "ACTIVE" ? (
          <>
            <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
              <button
                type="button"
                onClick={() => openChart(initialSnapshot.stocks.map((r) => r.code))}
                style={chipButtonStyle}
              >
                チャート生成
              </button>
            </div>
            {(["S", "A", "B", "C", "D"] as const).map((s) => (
              <SummarySection key={s} section={s} rows={bySection[s]} onTap={(code) => openChart([code])} />
            ))}
            {initialSnapshot.stocks.length === 0 && (
              <div style={{ fontFamily: monoFont, fontSize: 12, color: TEXT_DEFAULT }}>
                母集団0件、または特徴量計算対象がありません。
              </div>
            )}
          </>
        ) : (
          <div style={{ fontFamily: monoFont, fontSize: 12, color: TEXT_DEFAULT, padding: "8px 2px" }}>
            現在ACTIVEな局面はありません。過去局面の一覧・明細は「データ」タブから参照できます。
          </div>
        )
      ) : (
        <DataTab snapshot={initialSnapshot} index={index} />
      )}
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
