"use client";
import { useEffect, useRef } from "react";
import { createChart, ColorType, CrosshairMode } from "lightweight-charts";

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
  candles: Candle[];
  volumes: Volume[];
};

const UP = "#E03A2F";
const DOWN = "#1B8C7D";

function fmtNum(n: number): string {
  return n % 1 === 0 ? n.toFixed(0) : n.toFixed(1);
}

function fmtPrice(p: number): string {
  return p >= 1000
    ? Math.round(p).toLocaleString("ja-JP")
    : fmtNum(p);
}

export default function TurnoverCard({ stock }: { stock: CardStock }) {
  const candleRef = useRef<HTMLDivElement>(null);
  const volRef = useRef<HTMLDivElement>(null);

  const isUp = stock.change >= 0;
  const color = isUp ? UP : DOWN;
  const sign = isUp ? "+" : "";

  useEffect(() => {
    if (!candleRef.current || !volRef.current) return;

    // ローソク足チャート用オプション（価格軸あり・小フォント）
    const candleChartOpts = {
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
        scaleMargins: { top: 0.1, bottom: 0.1 },
      },
      leftPriceScale: { visible: false },
      handleScroll: false,
      handleScale: false,
    };

    // 出来高チャート用オプション（価格軸非表示）
    const volChartOpts = {
      layout: {
        background: { type: ColorType.Solid, color: "#FFFFFF" },
        textColor: "transparent",
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: "#F0F3FA" },
        horzLines: { color: "#F0F3FA" },
      },
      crosshair: { mode: CrosshairMode.Normal },
      timeScale: { visible: false, borderVisible: false },
      rightPriceScale: { visible: false, borderVisible: false },
      leftPriceScale: { visible: false },
      handleScroll: false,
      handleScale: false,
    };

    const candleChart = createChart(candleRef.current, {
      ...candleChartOpts,
      width: candleRef.current.offsetWidth,
      height: candleRef.current.offsetHeight || 178,
    });
    const candleSeries = candleChart.addCandlestickSeries({
      upColor: UP,
      downColor: DOWN,
      borderUpColor: UP,
      borderDownColor: DOWN,
      wickUpColor: UP,
      wickDownColor: DOWN,
    });
    candleSeries.setData(stock.candles);

    // 直近50本を初期表示
    const total = stock.candles.length;
    const visibleFrom = Math.max(0, total - 50);
    candleChart.timeScale().setVisibleLogicalRange({ from: visibleFrom, to: total });

    const volChart = createChart(volRef.current, {
      ...volChartOpts,
      width: volRef.current.offsetWidth,
      height: volRef.current.offsetHeight || 60,
    });
    const volSeries = volChart.addHistogramSeries({
      priceFormat: { type: "volume" as const },
      priceScaleId: "",
    });
    volSeries.setData(
      stock.volumes.map((v) => ({
        time: v.time as `${number}-${number}-${number}`,
        value: v.value,
        color: "#5B8DEF99",
      }))
    );
    // 出来高も同じ範囲を表示
    volChart.timeScale().setVisibleLogicalRange({ from: visibleFrom, to: total });

    const ro = new ResizeObserver(() => {
      if (candleRef.current) {
        candleChart.applyOptions({
          width: candleRef.current.offsetWidth,
          height: candleRef.current.offsetHeight || 178,
        });
      }
      if (volRef.current) {
        volChart.applyOptions({
          width: volRef.current.offsetWidth,
          height: volRef.current.offsetHeight || 60,
        });
      }
    });
    ro.observe(candleRef.current);
    ro.observe(volRef.current);

    return () => {
      ro.disconnect();
      candleChart.remove();
      volChart.remove();
    };
  }, [stock]);

  const tags = [
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
        borderRadius: 12,
        marginBottom: 12,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        boxShadow: "0 1px 6px rgba(30,40,80,0.07)",
        fontFamily: "'Inter', 'Helvetica Neue', Arial, sans-serif",
      }}
    >
      {/* 情報エリア */}
      <div
        style={{
          flex: "0 0 auto",
          background: "#F4F6FB",
          padding: "9px 14px 7px",
          display: "flex",
          flexDirection: "column",
          gap: 4,
          borderBottom: "1px solid #DDE1EC",
        }}
      >
        {/* 行1: 銘柄名・コード・タグ */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            flexWrap: "wrap",
            lineHeight: 1,
          }}
        >
          <span
            style={{
              fontSize: 14,
              fontWeight: 700,
              color: "#131722",
              letterSpacing: "-0.01em",
            }}
          >
            {stock.name}
          </span>
          <span
            style={{
              fontSize: 10,
              fontWeight: 500,
              color: "#707A8A",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {stock.code.slice(0, 4)}
          </span>
          <div style={{ display: "flex", gap: 3, flexWrap: "wrap" }}>
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
        </div>

        {/* 行2: 株価・前日比 */}
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            gap: 8,
            lineHeight: 1,
            fontVariantNumeric: "tabular-nums",
            letterSpacing: "-0.02em",
          }}
        >
          <span style={{ fontSize: 18, fontWeight: 700, color }}>
            {fmtPrice(stock.price)}
          </span>
          <span
            style={{
              fontSize: 12,
              fontWeight: 600,
              color,
              letterSpacing: "-0.01em",
            }}
          >
            {sign}
            {fmtNum(stock.change)}{" "}
            ({sign}
            {stock.changePct.toFixed(2)}%)
          </span>
        </div>

        {/* 行3: 指標 */}
        <div style={{ display: "flex", gap: 18, lineHeight: 1 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <span
              style={{
                fontSize: 10,
                fontWeight: 500,
                color: "#707A8A",
                letterSpacing: "0.05em",
                textTransform: "uppercase",
              }}
            >
              回転率
            </span>
            <span
              style={{
                fontSize: 13,
                fontWeight: 700,
                color: "#B5730F",
                fontVariantNumeric: "tabular-nums",
                letterSpacing: "-0.02em",
              }}
            >
              {stock.turnover.toFixed(2)}%
            </span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <span
              style={{
                fontSize: 10,
                fontWeight: 500,
                color: "#707A8A",
                letterSpacing: "0.05em",
                textTransform: "uppercase",
              }}
            >
              時価総額
            </span>
            <span
              style={{
                fontSize: 13,
                fontWeight: 500,
                color: "#9098A9",
                fontVariantNumeric: "tabular-nums",
                letterSpacing: "-0.02em",
              }}
            >
              {stock.marketCap}
            </span>
          </div>
        </div>
      </div>

      {/* チャートエリア */}
      <div
        style={{
          flex: "1 1 0",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          pointerEvents: "none",
          userSelect: "none",
          background: "#FFFFFF",
        }}
      >
        <div ref={candleRef} style={{ flex: "0 0 178px", width: "100%" }} />
        <div ref={volRef} style={{ flex: "1 1 0", width: "100%" }} />
      </div>
    </div>
  );
}
