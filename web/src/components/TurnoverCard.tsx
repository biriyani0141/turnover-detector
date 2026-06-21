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
  isLimitUp?: boolean;
  limitUpDates?: string[];
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
  const candleRef = useRef<HTMLDivElement>(null);
  const volRef = useRef<HTMLDivElement>(null);

  const isUp = stock.change >= 0;
  const color = isUp ? UP : DOWN;
  const sign = isUp ? "+" : "";
  const isLimitUp = stock.isLimitUp ?? false;
  const limitUpDates = stock.limitUpDates ?? [];
  const occCount = stock.occCount ?? 0;
  const stophighCount = stock.stophighCount ?? 0;

  useEffect(() => {
    if (!candleRef.current || !volRef.current) return;

    // ローソク足チャート用オプション
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

    // 出来高チャート用オプション
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
      height: candleRef.current.offsetHeight || 200,
    });

    // priceFormat で価格軸ラベルを整数表示
    const candleSeries = candleChart.addCandlestickSeries({
      upColor: UP,
      downColor: DOWN,
      borderUpColor: UP,
      borderDownColor: DOWN,
      wickUpColor: UP,
      wickDownColor: DOWN,
      priceFormat: { type: "price", precision: 0, minMove: 1 },
    });
    candleSeries.setData(stock.candles);

    // S高マーカー（☆）
    if (limitUpDates.length > 0) {
      const markers = limitUpDates
        .filter((d) => stock.candles.some((c) => c.time === d))
        .map((d) => ({
          time: d as `${number}-${number}-${number}`,
          position: "aboveBar" as const,
          color: "#F5A623",
          shape: "circle" as const,
          text: "★",
        }));
      if (markers.length > 0) candleSeries.setMarkers(markers);
    }

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
    const ma5 = candleChart.addLineSeries({
      color: "#2962FF",
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
    });
    ma5.setData(sma(5));
    const ma25 = candleChart.addLineSeries({
      color: "#22AB94",
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
    });
    ma25.setData(sma(25));
    const ma75 = candleChart.addLineSeries({
      color: "#9C27B0",
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
    });
    ma75.setData(sma(75));

    // 直近50本を初期表示
    const total = stock.candles.length;
    const visibleFrom = Math.max(0, total - 50);
    candleChart.timeScale().setVisibleLogicalRange({ from: visibleFrom, to: total });

    const volChart = createChart(volRef.current, {
      ...volChartOpts,
      width: volRef.current.offsetWidth,
      height: volRef.current.offsetHeight || 55,
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
    // 出来高バーを下端に貼り付ける（縮めたエリア内の下端）
    volSeries.priceScale().applyOptions({
      scaleMargins: { top: 0.05, bottom: 0 },
    });
    volChart.timeScale().setVisibleLogicalRange({ from: visibleFrom, to: total });

    const ro = new ResizeObserver(() => {
      if (candleRef.current) {
        candleChart.applyOptions({
          width: candleRef.current.offsetWidth,
          height: candleRef.current.offsetHeight || 200,
        });
      }
      if (volRef.current) {
        volChart.applyOptions({
          width: volRef.current.offsetWidth,
          height: volRef.current.offsetHeight || 55,
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
          flex: "0 0 112px",
          background: "#F4F6FB",
          padding: "8px 14px 8px",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          borderBottom: "1px solid #DDE1EC",
          overflow: "hidden",
        }}
      >
        {/* 行1: 銘柄名 + コード */}
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            gap: 6,
            overflow: "hidden",
          }}
        >
          <span
            style={{
              fontSize: 14,
              fontWeight: 700,
              color: "#131722",
              letterSpacing: "-0.01em",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              flex: "1 1 0",
              minWidth: 0,
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
              flexShrink: 0,
            }}
          >
            {stock.code.slice(0, 4)}
          </span>
        </div>

        {/* 行2: タグ（常に2行目固定） */}
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

        {/* 行3: 株価・前日比・S高バッジ */}
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            gap: 6,
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
            {fmtNum(stock.change)} ({sign}
            {stock.changePct.toFixed(2)}%)
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

        {/* 行4: 指標（回転率・時価総額・出現:S高） */}
        <div style={{ display: "flex", gap: 16, lineHeight: 1 }}>
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
        {/* ローソク足（主役：残り全高さ） */}
        <div ref={candleRef} style={{ flex: "1 1 0", width: "100%" }} />
        {/* 出来高（20〜25%に縮める：固定55px） */}
        <div ref={volRef} style={{ flex: "0 0 55px", width: "100%" }} />
      </div>
    </div>
  );
}
