"use client";
import { useEffect, useRef } from "react";
import {
  createChart,
  ColorType,
  CrosshairMode,
  LineSeries,
} from "lightweight-charts";
import type { CrashHistoryEntry } from "./CrashClient";

const monoFont = '"SF Mono",SFMono-Regular,ui-monospace,"Roboto Mono",Menlo,Consolas,monospace';
const BASE_BG = "#17171a";
const TEXT_DEFAULT = "#8a8a8e";
const TEXT_BRIGHT = "#e8eaed";

const STAR_COLOR = "#ffa500";
const PICK_COLOR = "#5B8DEF";
const DD_COLOR = "#E03A2F";

// 局面内推移チャート: ★数・大型耐性ピック数(左軸) / 指数DD%(右軸)。
// crash_index.jsonのhistory配列(ACTIVEだった日のみの軽量集計)をそのまま描画する。
// 局面検出・特徴量計算のロジックには一切関与しない、表示専用コンポーネント。
export default function PhaseHistoryChart({ entries }: { entries: CrashHistoryEntry[] }) {
  const chartRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!chartRef.current || entries.length === 0) return;
    const rows = entries; // 呼び出し側でdate昇順ソート済み

    const chart = createChart(chartRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: BASE_BG },
        textColor: TEXT_DEFAULT,
        fontSize: 10,
        fontFamily: monoFont,
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: "#232326" },
        horzLines: { color: "#232326" },
      },
      crosshair: { mode: CrosshairMode.Normal },
      timeScale: { borderVisible: false },
      rightPriceScale: { visible: true, borderVisible: false },
      leftPriceScale: { visible: true, borderVisible: false },
      handleScroll: false,
      handleScale: false,
      width: chartRef.current.offsetWidth,
      height: chartRef.current.offsetHeight || 180,
    });

    const starSeries = chart.addSeries(LineSeries, {
      color: STAR_COLOR, lineWidth: 2, priceScaleId: "left",
      priceFormat: { type: "price", precision: 0, minMove: 1 },
      lastValueVisible: true, title: "★数",
    });
    starSeries.setData(rows.map((r) => ({ time: r.date as `${number}-${number}-${number}`, value: r.star_count })));

    const pickSeries = chart.addSeries(LineSeries, {
      color: PICK_COLOR, lineWidth: 2, priceScaleId: "left",
      priceFormat: { type: "price", precision: 0, minMove: 1 },
      lastValueVisible: true, title: "大型耐性ピック数",
    });
    pickSeries.setData(rows.map((r) => ({ time: r.date as `${number}-${number}-${number}`, value: r.large_pick_count })));

    const ddSeries = chart.addSeries(LineSeries, {
      color: DD_COLOR, lineWidth: 2, priceScaleId: "right",
      priceFormat: { type: "percent", precision: 1 },
      lastValueVisible: true, title: "指数DD",
    });
    ddSeries.setData(
      rows
        .filter((r) => r.index_dd !== null)
        .map((r) => ({ time: r.date as `${number}-${number}-${number}`, value: (r.index_dd as number) * 100 }))
    );

    chart.priceScale("left").applyOptions({ scaleMargins: { top: 0.15, bottom: 0.15 } });
    chart.priceScale("right").applyOptions({ scaleMargins: { top: 0.15, bottom: 0.15 } });
    chart.timeScale().fitContent();

    const ro = new ResizeObserver(() => {
      if (chartRef.current) {
        chart.applyOptions({
          width: chartRef.current.offsetWidth,
          height: chartRef.current.offsetHeight || 180,
        });
      }
    });
    ro.observe(chartRef.current);

    return () => {
      ro.disconnect();
      chart.remove();
    };
  }, [entries]);

  if (entries.length === 0) {
    return (
      <div style={{ fontFamily: monoFont, fontSize: 12, color: TEXT_DEFAULT, padding: "8px 2px" }}>
        推移データがありません。
      </div>
    );
  }

  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: "flex", gap: 10, marginBottom: 4, fontFamily: monoFont, fontSize: 10, color: TEXT_BRIGHT }}>
        <span><span style={{ color: STAR_COLOR }}>■</span> ★数</span>
        <span><span style={{ color: PICK_COLOR }}>■</span> 大型耐性ピック数</span>
        <span><span style={{ color: DD_COLOR }}>■</span> 指数DD(右軸)</span>
      </div>
      <div
        ref={chartRef}
        style={{
          height: 180, background: BASE_BG, border: "1px solid #2a2d34", borderRadius: 6,
          overflow: "hidden",
        }}
      />
    </div>
  );
}
