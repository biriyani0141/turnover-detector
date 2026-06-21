"use client";
import { CSSProperties } from "react";

export interface StockRowProps {
  name: string;
  code: string;
  mktcap_oku: number | null;
  close: number | null;
  ret_1d: number | null;
  ret_5d: number | null;
  ret_1m: number | null;
  ret_3m: number | null;
  ret_1y: number | null;
  occLeft: number;
  occRight: number;
  isEven?: boolean;
}

function fmtCode(code: string): string {
  if (/^\d{5}$/.test(code) && code.endsWith("0")) return code.slice(0, 4);
  return code;
}

function fmtCap(v: number | null): string {
  if (v === null || v === undefined) return "";
  if (v >= 10000) return (v / 10000).toFixed(1) + "兆";
  return Math.round(v).toLocaleString("ja-JP") + "億";
}

function fmt(v: number | null): string {
  if (v === null || v === undefined) return "—";
  return Math.round(v) + "%";
}

function perfColor(v: number | null): string {
  if (v === null || v === undefined) return "#525252";
  const r = Math.round(v);
  if (r >= 100) return "#ffa500";
  if (r > 0) return "#ff6b6b";
  if (r < 0) return "#4ade80";
  return "#777";
}

const metaFont =
  '-apple-system,BlinkMacSystemFont,"Helvetica Neue","Segoe UI","Noto Sans JP",sans-serif';
const monoFont = 'ui-monospace,"SF Mono",SFMono-Regular,Menlo,monospace';

const rowGrid: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "6rem max-content 1fr",
  columnGap: 2,
  alignItems: "center",
  padding: "4px 16px",
  borderBottom: "1px solid rgba(255,255,255,0.04)",
};

export interface StockRowHeaderProps {
  sortKey?: string;
  sortDir?: "asc" | "desc";
  onSort?: (key: string) => void;
}

const PERIOD_COLS = [
  { label: "1d", key: "d1" },
  { label: "5d", key: "d5" },
  { label: "1m", key: "m1" },
  { label: "3m", key: "m3" },
  { label: "1y", key: "y1" },
] as const;

export function StockRowHeader({ sortKey, sortDir, onSort }: StockRowHeaderProps = {}) {
  const arrow = (key: string) => {
    if (sortKey !== key) return "";
    return sortDir === "desc" ? "▼" : "▲";
  };
  const col = (key: string): string => (sortKey === key ? "#f5f5f5" : "#525252");
  const ptr: CSSProperties = onSort ? { cursor: "pointer", userSelect: "none" } : {};

  return (
    <div style={{ ...rowGrid, paddingTop: 6, paddingBottom: 6 }}>
      <div
        style={{ fontSize: 11, fontWeight: 700, color: col("turnover"), fontFamily: monoFont, ...ptr }}
        onClick={() => onSort?.("turnover")}
      >
        銘柄{sortKey === "turnover" ? "▼" : ""}
      </div>
      <div style={{ display: "flex", width: "13rem" }}>
        {PERIOD_COLS.map(({ label, key }, i, arr) => (
          <div
            key={key}
            onClick={() => onSort?.(key)}
            style={{
              width: "2.6rem",
              textAlign: "right",
              paddingRight: 3,
              fontSize: 11,
              fontWeight: 700,
              fontFamily: monoFont,
              color: col(key),
              borderRight: i < arr.length - 1 ? "1px solid rgba(255,255,255,0.04)" : undefined,
              ...ptr,
            }}
          >
            {label}{arrow(key)}
          </div>
        ))}
      </div>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-end",
          fontSize: 11,
          fontWeight: 700,
          fontFamily: monoFont,
        }}
      >
        <span style={{ color: "#525252" }}>株価</span>
        <span
          style={{ color: col("occ"), ...ptr }}
          onClick={() => onSort?.("occ")}
        >
          出現{arrow("occ")}
        </span>
      </div>
    </div>
  );
}

export function StockRow({
  name,
  code,
  mktcap_oku,
  close,
  ret_1d,
  ret_5d,
  ret_1m,
  ret_3m,
  ret_1y,
  occLeft,
  occRight,
  isEven,
}: StockRowProps) {
  const perfs: (number | null)[] = [ret_1d, ret_5d, ret_1m, ret_3m, ret_1y];

  return (
    <div
      style={{
        ...rowGrid,
        backgroundColor: isEven ? "rgba(255,255,255,0.015)" : undefined,
      }}
    >
      {/* 左カラム */}
      <div style={{ overflow: "hidden" }}>
        <div
          style={{
            fontSize: 13,
            fontWeight: 700,
            color: "#f5f5f5",
            maxWidth: "6rem",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {name}
        </div>
        <div
          style={{
            fontFamily: metaFont,
            fontSize: 11,
            fontWeight: 400,
            letterSpacing: "-0.01em",
            color: "#777",
            WebkitFontSmoothing: "antialiased",
            whiteSpace: "nowrap",
          } as CSSProperties}
        >
          <span style={{ color: "#c8c8c8", fontWeight: 500 }}>{fmtCode(code)}</span>
          {mktcap_oku !== null && <> · {fmtCap(mktcap_oku)}</>}
        </div>
      </div>

      {/* 中央5連 */}
      <div style={{ display: "flex", width: "13rem" }}>
        {perfs.map((v, i) => (
          <div
            key={i}
            style={{
              width: "2.6rem",
              textAlign: "right",
              paddingRight: 3,
              fontSize: 11,
              fontWeight: 700,
              fontFamily: monoFont,
              fontVariantNumeric: "tabular-nums",
              color: perfColor(v),
              borderRight:
                i < perfs.length - 1
                  ? "1px solid rgba(255,255,255,0.04)"
                  : undefined,
            }}
          >
            {fmt(v)}
          </div>
        ))}
      </div>

      {/* 右カラム */}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
        <div
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: "#999",
            fontFamily: monoFont,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {close !== null ? close.toLocaleString("ja-JP") : "—"}
        </div>
        <div style={{ fontSize: 10, fontFamily: monoFont }}>
          <span style={{ color: "#777" }}>{occLeft}:</span>
          <span
            style={{
              color: occRight >= 1 ? "#ffa500" : "#777",
              fontWeight: occRight >= 1 ? 700 : 400,
            }}
          >
            {occRight}
          </span>
        </div>
      </div>
    </div>
  );
}
