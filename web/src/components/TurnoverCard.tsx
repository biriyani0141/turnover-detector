"use client";
import { useEffect, useRef } from "react";
import { createChart, ColorType, CrosshairMode, AutoscaleInfo } from "lightweight-charts";

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

export default function TurnoverCard({ stock }: { stock: CardStock }) {
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
        scaleMargins: { top: 0.1, bottom: 0.25 },
      },
      leftPriceScale: { visible: false },
      handleScroll: false,
      handleScale: false,
      width: chartRef.current.offsetWidth,
      height: chartRef.current.offsetHeight || 248,
    });

    // ローソク足シリーズ（価格軸：整数表示）
    const candleSeries = chart.addCandlestickSeries({
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

    if (markers.length > 0) candleSeries.setMarkers(markers);

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
    const ma5 = chart.addLineSeries({ color: "#2962FF", lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
    ma5.setData(sma(5));
    const ma25 = chart.addLineSeries({ color: "#22AB94", lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
    ma25.setData(sma(25));
    const ma75 = chart.addLineSeries({ color: "#9C27B0", lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
    ma75.setData(sma(75));

    // 出来高（同一チャート内オーバーレイ、下20%に配置）
    const volSeries = chart.addHistogramSeries({
      priceFormat: { type: "volume" as const },
      priceScaleId: "volume",
    });
    volSeries.setData(
      stock.volumes.map((v) => ({
        time: v.time as `${number}-${number}-${number}`,
        value: v.value,
        color: "#5B8DEF99",
      }))
    );
    chart.priceScale("volume").applyOptions({
      scaleMargins: { top: 0.8, bottom: 0 },
    });
    volSeries.applyOptions({
      autoscaleInfoProvider: (original: () => AutoscaleInfo | null) => {
        const res = original();
        if (res !== null) {
          res.priceRange.minValue = 0;
        }
        return res;
      },
    });

    // 直近50本を初期表示（全シリーズ共通の時間軸）
    const total = stock.candles.length;
    const visibleFrom = Math.max(0, total - 50);
    chart.timeScale().setVisibleLogicalRange({ from: visibleFrom, to: total });

    const ro = new ResizeObserver(() => {
      if (chartRef.current) {
        chart.applyOptions({
          width: chartRef.current.offsetWidth,
          height: chartRef.current.offsetHeight || 248,
        });
      }
    });
    ro.observe(chartRef.current);

    return () => {
      ro.disconnect();
      chart.remove();
    };
  }, [stock]);

  // タグ並び順: コード / 市場 / 信用or貸借 / 業種
  const tags = [
    stock.code.slice(0, 4),
    stock.market,
    stock.creditType !== "-" ? stock.creditType : null,
    stock.sector,
  ].filter(Boolean) as string[];

  return (
    <div
      style={{
        height: 360,
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
      {/* 情報エリア（固定高さ） */}
      <div
        style={{
          flex: "0 0 88px",
          background: "#F4F6FB",
          padding: "8px 14px",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          borderBottom: "1px solid #DDE1EC",
          overflow: "hidden",
        }}
      >
        {/* 行1: 銘柄名（単独・フル幅・ellipsis） */}
        <div
          style={{
            fontSize: 14,
            fontWeight: 700,
            color: "#131722",
            letterSpacing: "-0.01em",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {stock.name}
        </div>

        {/* 行2: コード/市場/信用/業種 タグ */}
        <div style={{ display: "flex", gap: 3, flexWrap: "wrap", lineHeight: 1 }}>
          {tags.map((t) => (
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
              }}
            >
              {t}
            </span>
          ))}
        </div>

        {/* 行3: 左=株価・前日比・S高バッジ／右=回転率・時価総額・出現:S高 */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 8 }}>
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              gap: 6,
              lineHeight: 1,
              fontVariantNumeric: "tabular-nums",
              letterSpacing: "-0.02em",
              flexShrink: 0,
            }}
          >
            <span style={{ fontSize: 18, fontWeight: 700, color }}>
              {fmtPrice(stock.price)}
            </span>
            <span style={{ fontSize: 12, fontWeight: 600, color, letterSpacing: "-0.01em" }}>
              {sign}{fmtNum(stock.change)} ({sign}{stock.changePct.toFixed(2)}%)
            </span>
            {isLimitUp && (
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  color: "#FFFFFF",
                  background: "#E03A2F",
                  borderRadius: 3,
                  padding: "1px 5px",
                  letterSpacing: "0.02em",
                }}
              >
                S高
              </span>
            )}
          </div>

          <div style={{ display: "flex", gap: 10, lineHeight: 1, flexShrink: 0 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <span style={{ fontSize: 9, fontWeight: 500, color: "#707A8A", letterSpacing: "0.04em", textTransform: "uppercase" }}>
                回転率
              </span>
              <span style={{ fontSize: 12, fontWeight: 700, color: "#B5730F", fontVariantNumeric: "tabular-nums", letterSpacing: "-0.02em" }}>
                {stock.turnover.toFixed(2)}%
              </span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <span style={{ fontSize: 9, fontWeight: 500, color: "#707A8A", letterSpacing: "0.04em", textTransform: "uppercase" }}>
                時価総額
              </span>
              <span style={{ fontSize: 12, fontWeight: 500, color: "#9098A9", fontVariantNumeric: "tabular-nums", letterSpacing: "-0.02em" }}>
                {stock.marketCap}
              </span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <span style={{ fontSize: 9, fontWeight: 500, color: "#707A8A", letterSpacing: "0.04em", textTransform: "uppercase" }}>
                出現:S高
              </span>
              <span style={{ fontSize: 12, fontWeight: 500, fontVariantNumeric: "tabular-nums", letterSpacing: "-0.02em" }}>
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
