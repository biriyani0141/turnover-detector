"use client";
import { useEffect, useRef } from "react";
import {
  createChart,
  ColorType,
  CrosshairMode,
  CandlestickSeries,
  LineSeries,
  HistogramSeries,
  createSeriesMarkers,
  AutoscaleInfo,
} from "lightweight-charts";

type Candle = {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
};

type Volume = {
  time: string;
  value: number;
};

export type CardStock = {
  code: string;
  name: string;
  market: string;
  sector: string;
  creditType: string;
  price: number;
  change: number;
  changePct: number;
  marketCap: string;
  turnover: number;
  isLimitUp?: boolean;
  touchedOnlyDates?: string[];
  closedLimitUpDates?: string[];
  occCount?: number;
  stophighCount?: number;
  candles: Candle[];
  volumes: Volume[];
};

const UP = "#E03A2F";
const DOWN = "#1B8C7D";

function fmtNum(n: number): string {
  return n % 1 === 0 ? n.toFixed(0) : n.toFixed(1);
}

function fmtPrice(p: number): string {
  return p >= 1000 ? Math.round(p).toLocaleString("ja-JP") : fmtNum(p);
}

export default function TurnoverCard({ stock, badge }: { stock: CardStock; badge?: { text: string; bgClass: string } }) {
  const chartRef = useRef<HTMLDivElement>(null);

  const isUp = stock.change >= 0;
  const color = isUp ? UP : DOWN;
  const sign = isUp ? "+" : "";
  const isLimitUp = stock.isLimitUp ?? false;
  const touchedOnlyDates = stock.touchedOnlyDates ?? [];
  const closedDates = stock.closedLimitUpDates ?? [];
  const occCount = stock.occCount ?? 0;
  const stophighCount = stock.stophighCount ?? 0;

  useEffect(() => {
    if (!chartRef.current) return;

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
      },
      leftPriceScale: { visible: false },
      handleScroll: false,
      handleScale: false,
      width: chartRef.current.offsetWidth,
      height: chartRef.current.offsetHeight || 200,
    });

    // ローソク足シリーズ（価格軸：整数表示）
    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: UP,
      downColor: DOWN,
      borderUpColor: UP,
      borderDownColor: DOWN,
      wickUpColor: UP,
      wickDownColor: DOWN,
      priceFormat: { type: "price", precision: 0, minMove: 1 },
    });
    candleSeries.setData(stock.candles);

    // S高マーカー（方針A: text文字を主役・size:0でshape非表示）
    // ★ = 終値ストップ引け（closedLimitUpDates）
    // ● = ザラ場タッチのみ（touchedOnlyDates）
    const candleDateSet = new Set(stock.candles.map((c) => c.time));
    const markers = [
      ...closedDates
        .filter((d) => candleDateSet.has(d))
        .map((d) => ({
          time: d as `${number}-${number}-${number}`,
          position: "aboveBar" as const,
          color: "#F5A623",
          shape: "circle" as const,
          size: 0,
          text: "★",
        })),
      ...touchedOnlyDates
        .filter((d) => candleDateSet.has(d))
        .map((d) => ({
          time: d as `${number}-${number}-${number}`,
          position: "aboveBar" as const,
          color: "#F5A623",
          shape: "circle" as const,
          size: 0,
          text: "●",
        })),
    ].sort((a, b) => (a.time < b.time ? -1 : 1));

    if (markers.length > 0) createSeriesMarkers(candleSeries, markers);

    // 移動平均線（5日・25日・75日）
    function sma(period: number) {
      const out: { time: string; value: number }[] = [];
      for (let i = period - 1; i < stock.candles.length; i++) {
        const avg =
          stock.candles
            .slice(i - period + 1, i + 1)
            .reduce((s, c) => s + c.close, 0) / period;
        out.push({ time: stock.candles[i].time, value: avg });
      }
      return out;
    }
    // 直近50本の high/low でY軸をクランプ
    const total = stock.candles.length;
    const visibleFrom = Math.max(0, total - 50);
    const visibleCandles = stock.candles.slice(visibleFrom);
    const clampMax = Math.max(...visibleCandles.map(c => c.high));
    const clampMin = Math.min(...visibleCandles.map(c => c.low));
    const pad = (clampMax - clampMin) * 0.02;
    const scaleProvider = () => ({
      priceRange: { minValue: clampMin - pad, maxValue: clampMax + pad },
    });

    candleSeries.applyOptions({ autoscaleInfoProvider: scaleProvider });

    const ma5 = chart.addSeries(LineSeries, { color: "#2962FF", lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
    ma5.setData(sma(5));
    ma5.applyOptions({ autoscaleInfoProvider: scaleProvider });
    const ma25 = chart.addSeries(LineSeries, { color: "#22AB94", lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
    ma25.setData(sma(25));
    ma25.applyOptions({ autoscaleInfoProvider: scaleProvider });
    const ma75 = chart.addSeries(LineSeries, { color: "#9C27B0", lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
    ma75.setData(sma(75));
    ma75.applyOptions({ autoscaleInfoProvider: scaleProvider });

    // 出来高（別ペイン）
    const volSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" as const },
    }, 1);
    volSeries.setData(
      stock.volumes.map((v) => ({
        time: v.time as `${number}-${number}-${number}`,
        value: v.value,
        color: "#5B8DEF99",
      }))
    );
    volSeries.applyOptions({
      autoscaleInfoProvider: (original: () => AutoscaleInfo | null) => {
        const res = original();
        if (res !== null && res.priceRange !== null) res.priceRange.minValue = 0;
        return res;
      },
    });

    // ペイン高さ比率 4:1（メイン:出来高）
    const panes = chart.panes();
    if (panes.length >= 2) {
      panes[0].setStretchFactor(4);
      panes[1].setStretchFactor(1);
    }

    // 直近50本を初期表示
    chart.timeScale().setVisibleLogicalRange({ from: visibleFrom, to: total });

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
  }, [stock]);

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
            {stock.name}
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
            {[stock.code.slice(0, 4), stock.market].filter(Boolean).map((t) => (
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
            {fmtPrice(stock.price)}
          </span>

          {/* 前日比 */}
          <span style={{ fontSize: 11, fontWeight: 600, color, letterSpacing: "-0.01em", flexShrink: 0 }}>
            {sign}{fmtNum(stock.change)} ({sign}{stock.changePct.toFixed(2)}%)
          </span>

          {/* S高バッジ */}
          {isLimitUp && (
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
                {stock.turnover.toFixed(2)}%
              </span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 1 }}>
              <span style={{ fontSize: 9, color: "#9098A9", lineHeight: 1 }}>時価総額</span>
              <span style={{ fontSize: 11, fontWeight: 500, color: "#9098A9", letterSpacing: "-0.02em", lineHeight: 1 }}>
                {stock.marketCap}
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

      {/* チャートエリア（単一チャート・ローソク足+出来高統合） */}
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
