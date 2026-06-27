"use client";
import { useEffect, useRef } from "react";
import {
  createChart,
  ColorType,
  CrosshairMode,
  AutoscaleInfo,
  type LineData,
  type WhitespaceData,
} from "lightweight-charts";

type ChartDataRow = {
  date: string;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
  ma5: number | null;
  ma25: number | null;
  ma75: number | null;
  ma200: number | null;
  marks?: string[];
};

type ChartDataHeader = {
  price: number | null;
  change: number | null;
  changePct: number | null;
  isStopHigh: boolean;
  turnoverPct: number | null;
  marketCap: number | null;
  appearCount: number;
  stopHighCount: number;
};

export type ChartData = {
  version: number;
  code: string;
  name: string;
  market: string;
  sector: string;
  header: ChartDataHeader;
  rows: ChartDataRow[];
};

const UP = "#E03A2F";
const DOWN = "#1B8C7D";

function fmtNum(n: number): string {
  return n % 1 === 0 ? n.toFixed(0) : n.toFixed(1);
}

function fmtPrice(p: number): string {
  return p >= 1000 ? Math.round(p).toLocaleString("ja-JP") : fmtNum(p);
}

function fmtMktcap(n: number): string {
  if (n >= 1e12) {
    return `${parseFloat((n / 1e12).toFixed(2))}兆円`;
  } else if (n >= 1e8) {
    return `${Math.round(n / 1e8)}億円`;
  } else {
    return `${Math.round(n / 1e4)}万円`;
  }
}

export default function ChartCard({ data, badge }: { data: ChartData; badge?: { text: string; bgClass: string } }) {
  const chartRef = useRef<HTMLDivElement>(null);

  const { header, code, name, market, sector } = data;
  const price = header.price;
  const change = header.change ?? 0;
  const changePct = header.changePct ?? 0;
  const isUp = change >= 0;
  const color = isUp ? UP : DOWN;
  const sign = isUp ? "+" : "";
  const isStopHigh = header.isStopHigh;
  const occCount = header.appearCount;
  const stophighCount = header.stopHighCount;

  useEffect(() => {
    if (!chartRef.current) return;
    const rs = data.rows;

    const chart = createChart(chartRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: "#FFFFFF" },
        textColor: "#9098A9",
        fontSize: 10,
        fontFamily: "'Inter', 'Helvetica Neue', Arial, sans-serif",
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: "#F0F3FA" },
        horzLines: { color: "#F0F3FA" },
      },
      crosshair: { mode: CrosshairMode.Normal },
      timeScale: { visible: false, borderVisible: false },
      rightPriceScale: {
        visible: true,
        borderVisible: false,
        scaleMargins: { top: 0.05, bottom: 0.22 },
      },
      leftPriceScale: { visible: false },
      handleScroll: false,
      handleScale: false,
      width: chartRef.current.offsetWidth,
      height: chartRef.current.offsetHeight || 200,
    });

    const candleSeries = chart.addCandlestickSeries({
      upColor: UP,
      downColor: DOWN,
      borderUpColor: UP,
      borderDownColor: DOWN,
      wickUpColor: UP,
      wickDownColor: DOWN,
      priceFormat: { type: "price", precision: 0, minMove: 1 },
    });
    candleSeries.setData(
      rs.map(r => ({
        time: r.date as `${number}-${number}-${number}`,
        open: r.o,
        high: r.h,
        low: r.l,
        close: r.c,
      }))
    );

    // S高マーカー（★=終値S高引け / ●=ザラ場タッチのみ）
    const candleDateSet = new Set(rs.map(r => r.date));
    const closedD = rs.filter(r => r.marks?.includes("shc")).map(r => r.date);
    const touchedD = rs.filter(r => r.marks?.includes("sht")).map(r => r.date);
    const markers = [
      ...closedD.filter(d => candleDateSet.has(d)).map(d => ({
        time: d as `${number}-${number}-${number}`,
        position: "aboveBar" as const,
        color: "#F5A623",
        shape: "circle" as const,
        size: 0,
        text: "★",
      })),
      ...touchedD.filter(d => candleDateSet.has(d)).map(d => ({
        time: d as `${number}-${number}-${number}`,
        position: "aboveBar" as const,
        color: "#F5A623",
        shape: "circle" as const,
        size: 0,
        text: "●",
      })),
    ].sort((a, b) => (a.time < b.time ? -1 : 1));
    if (markers.length > 0) candleSeries.setMarkers(markers);

    // MA line series（null行は whitespace data として渡す）
    function maData(key: "ma5" | "ma25" | "ma75" | "ma200"): (LineData | WhitespaceData)[] {
      return rs.map(r => {
        const val = r[key];
        const t = r.date as `${number}-${number}-${number}`;
        return val !== null ? { time: t, value: val } : { time: t };
      });
    }

    const ma5s = chart.addLineSeries({ color: "#2962FF", lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
    ma5s.setData(maData("ma5"));
    const ma25s = chart.addLineSeries({ color: "#22AB94", lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
    ma25s.setData(maData("ma25"));
    const ma75s = chart.addLineSeries({ color: "#9C27B0", lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
    ma75s.setData(maData("ma75"));
    const ma200s = chart.addLineSeries({ color: "#FF6D00", lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
    ma200s.setData(maData("ma200"));

    // 出来高（下20%）
    const volSeries = chart.addHistogramSeries({
      priceFormat: { type: "volume" as const },
      priceScaleId: "volume",
    });
    volSeries.setData(
      rs.map(r => ({
        time: r.date as `${number}-${number}-${number}`,
        value: r.v,
        color: "#5B8DEF99",
      }))
    );
    chart.priceScale("volume").applyOptions({
      scaleMargins: { top: 0.8, bottom: 0 },
    });
    volSeries.applyOptions({
      autoscaleInfoProvider: (original: () => AutoscaleInfo | null) => {
        const res = original();
        if (res !== null) res.priceRange.minValue = 0;
        return res;
      },
    });

    const total = rs.length;
    chart.timeScale().setVisibleLogicalRange({ from: Math.max(0, total - 50), to: total });

    const visible = rs.slice(Math.max(0, rs.length - 50));
    const max = Math.max(...visible.map(r => r.h));
    const min = Math.min(...visible.map(r => r.l));
    candleSeries.applyOptions({
      autoscaleInfoProvider: () => ({
        priceRange: { minValue: min, maxValue: max },
      }),
    });

    const ro = new ResizeObserver(() => {
      if (chartRef.current) {
        chart.applyOptions({
          width: chartRef.current.offsetWidth,
          height: chartRef.current.offsetHeight || 200,
        });
      }
    });
    ro.observe(chartRef.current);

    return () => {
      ro.disconnect();
      chart.remove();
    };
  }, [data]);

  return (
    <div
      style={{
        height: 258,
        background: "#FFFFFF",
        border: "1px solid #DDE1EC",
        borderRadius: 4,
        marginBottom: 12,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        boxShadow: "0 1px 4px rgba(30,40,80,0.06)",
        fontFamily: "'Inter', 'Helvetica Neue', Arial, sans-serif",
      }}
    >
      {/* 情報エリア（2行） */}
      <div
        style={{
          flex: "0 0 auto",
          background: "#F4F6FB",
          borderBottom: "1px solid #DDE1EC",
          overflow: "hidden",
        }}
      >
        {/* 行1: 銘柄名 + 状態バッジ */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            padding: "5px 10px 3px",
            gap: 6,
          }}
        >
          <span
            style={{
              fontSize: 16,
              fontWeight: 700,
              color: "#131722",
              letterSpacing: "-0.01em",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              flex: 1,
              minWidth: 0,
            }}
          >
            {name}
          </span>
          {badge && (
            <span
              className={badge.bgClass}
              style={{
                fontSize: 10,
                fontWeight: 700,
                color: "#fff",
                borderRadius: 4,
                padding: "2px 6px",
                flexShrink: 0,
              }}
            >
              {badge.text}
            </span>
          )}
        </div>

        {/* 行2: コード・市場タグ → 株価 → 前日比 → 指標3カラム */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "3px 10px 5px",
            fontVariantNumeric: "tabular-nums",
            overflow: "hidden",
          }}
        >
          {/* コード・市場タグ */}
          <div style={{ display: "flex", gap: 3, flexShrink: 0 }}>
            {[code.slice(0, 4), market].filter(Boolean).map((t) => (
              <span
                key={t}
                style={{
                  fontSize: 9,
                  fontWeight: 500,
                  color: "#707A8A",
                  border: "1px solid rgba(112,122,138,0.28)",
                  borderRadius: 3,
                  padding: "1px 4px",
                  background: "rgba(112,122,138,0.06)",
                  lineHeight: 1.4,
                }}
              >
                {t}
              </span>
            ))}
          </div>

          {/* 株価 */}
          <span style={{ fontSize: 14, fontWeight: 700, color, letterSpacing: "-0.02em", flexShrink: 0 }}>
            {price !== null ? fmtPrice(price) : "-"}
          </span>

          {/* 前日比 */}
          <span style={{ fontSize: 11, fontWeight: 600, color, letterSpacing: "-0.01em", flexShrink: 0 }}>
            {sign}{fmtNum(change)} ({sign}{changePct.toFixed(2)}%)
          </span>

          {/* S高バッジ */}
          {isStopHigh && (
            <span
              style={{
                fontSize: 9,
                fontWeight: 700,
                color: "#FFFFFF",
                background: "#E03A2F",
                borderRadius: 3,
                padding: "1px 4px",
                letterSpacing: "0.02em",
                flexShrink: 0,
              }}
            >
              S高
            </span>
          )}

          {/* スペーサー */}
          <div style={{ flex: 1, minWidth: 4 }} />

          {/* 右側指標3カラム */}
          <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 1 }}>
              <span style={{ fontSize: 9, color: "#9098A9", lineHeight: 1 }}>回転率</span>
              <span style={{ fontSize: 11, fontWeight: 700, color: "#f5a623", letterSpacing: "-0.02em", lineHeight: 1 }}>
                {header.turnoverPct !== null ? `${header.turnoverPct.toFixed(2)}%` : "-"}
              </span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 1 }}>
              <span style={{ fontSize: 9, color: "#9098A9", lineHeight: 1 }}>時価総額</span>
              <span style={{ fontSize: 11, fontWeight: 500, color: "#9098A9", letterSpacing: "-0.02em", lineHeight: 1 }}>
                {header.marketCap !== null ? fmtMktcap(header.marketCap) : "-"}
              </span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 1 }}>
              <span style={{ fontSize: 9, color: "#9098A9", lineHeight: 1 }}>出現:S高</span>
              <span style={{ fontSize: 11, fontWeight: 500, letterSpacing: "-0.02em", lineHeight: 1 }}>
                <span style={{ color: "#707A8A" }}>{occCount}:</span>
                <span style={{ color: stophighCount >= 1 ? "#F5A623" : "#707A8A", fontWeight: stophighCount >= 1 ? 700 : 500 }}>
                  {stophighCount}
                </span>
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* チャートエリア */}
      <div
        ref={chartRef}
        style={{
          flex: "1 1 0",
          overflow: "hidden",
          pointerEvents: "none",
          userSelect: "none",
        }}
      />
    </div>
  );
}
