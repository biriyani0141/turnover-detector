"use client";
import { useEffect, useLayoutEffect, useRef } from "react";
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

type DisclosureItem = { date: string; title: string };

type StopHighReason =
  | { kind: "today"; status: string | null; text: string; orders: string | null }
  | { kind: "streak"; streakDays: number; prevText: string };

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
  reason?: StopHighReason;
  disclosures?: DisclosureItem[];
  candles: Candle[];
  volumes: Volume[];
};

const UP = "#E03A2F";
const DOWN = "#1B8C7D";
// 日本語フォントを明示指定しないとhtml2canvasのCJKフォールバック描画が実ブラウザと異なる字形になる
// (StopHighDetailSheet.tsxのFONT定数と同じ構成に合わせる)
const CJK_FONT = "'Inter', 'Helvetica Neue', 'Noto Sans JP', 'Yu Gothic', 'Hiragino Sans', Arial, sans-serif";

function fmtNum(n: number): string {
  return n % 1 === 0 ? n.toFixed(0) : n.toFixed(1);
}

function fmtPrice(p: number): string {
  return p >= 1000 ? Math.round(p).toLocaleString("ja-JP") : fmtNum(p);
}

// S高理由のstatusタグ色。null(=引け相当)は赤「S高」、配分は緑、一時は既存のオレンジ維持。
function reasonStatusBadge(status: string | null): { bg: string; label: string } {
  if (status === "配分") return { bg: DOWN, label: "配分" };
  if (status === "一時") return { bg: "#F5A623", label: "一時" };
  if (status === null) return { bg: UP, label: "S高" };
  return { bg: "#F5A623", label: status };
}

function fmtCompactDate(dateTime: string): string {
  const [datePart, timePart] = dateTime.split(" ");
  const [, mm, dd] = datePart.split("-");
  const compact = `${parseInt(mm, 10)}/${parseInt(dd, 10)}`;
  return timePart ? `${compact} ${timePart}` : compact;
}

export default function TurnoverCard({
  stock,
  badge,
  compact,
}: {
  stock: CardStock;
  badge?: { text: string; bgClass: string };
  // 画像まとめ出力用: 補足欄をタグ+本文3行(超過は省略記号)に制限する
  compact?: boolean;
}) {
  const chartRef = useRef<HTMLDivElement>(null);

  const isUp = stock.change >= 0;
  const color = isUp ? UP : DOWN;
  const sign = isUp ? "+" : "";
  const isLimitUp = stock.isLimitUp ?? false;
  const touchedOnlyDates = stock.touchedOnlyDates ?? [];
  const closedDates = stock.closedLimitUpDates ?? [];
  const occCount = stock.occCount ?? 0;
  const stophighCount = stock.stophighCount ?? 0;
  const isMargin = stock.creditType === "貸借";

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
      height: chartRef.current.offsetHeight || 220,
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

    candleSeries.priceScale().applyOptions({
      scaleMargins: { top: 0.08, bottom: 0.08 },
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
          height: chartRef.current.offsetHeight || 220,
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
    <div style={{ marginBottom: 12 }}>
    <div
      style={{
        height: 278,
        background: "#FFFFFF",
        border: "1px solid #DDE1EC",
        borderRadius: 4,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        boxShadow: "0 1px 4px rgba(30,40,80,0.06)",
        fontFamily: CJK_FONT,
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
          {/* コード・市場タグ（コードタグは貸借区分で色分け） */}
          <div style={{ display: "flex", gap: 3, flexShrink: 0 }}>
            <span
              style={{
                fontSize: 9,
                fontWeight: 500,
                color: isMargin ? "#1E40AF" : "#707A8A",
                border: isMargin ? "1px solid rgba(30,64,175,0.25)" : "1px solid rgba(112,122,138,0.28)",
                borderRadius: 3,
                padding: "1px 4px",
                background: isMargin ? "#DBEAFE" : "rgba(112,122,138,0.06)",
                lineHeight: 1.4,
              }}
            >
              {stock.code.slice(0, 4)}
            </span>
            {stock.market && (
              <span
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
                {stock.market}
              </span>
            )}
          </div>

          {/* 株価 */}
          <span style={{ fontSize: 14, fontWeight: 700, color, letterSpacing: "-0.02em", flexShrink: 0 }}>
            {fmtPrice(stock.price)}
          </span>

          {/* 前日比 */}
          <span style={{ fontSize: 11, fontWeight: 600, color, letterSpacing: "-0.01em", flexShrink: 0 }}>
            {sign}{fmtNum(stock.change)} ({sign}{stock.changePct.toFixed(2)}%)
          </span>

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

    {/* S高理由コメント欄(出来高チャート下、reason・disclosuresどちらも無い銘柄は非表示) */}
    {(stock.reason || (stock.disclosures && stock.disclosures.length > 0)) && (
      <div
        style={{
          marginTop: 6,
          background: "#FFFFFF",
          border: "1px solid #DDE1EC",
          borderRadius: 4,
          padding: "8px 10px",
          boxShadow: "0 1px 4px rgba(30,40,80,0.06)",
          fontFamily: CJK_FONT,
        }}
      >
        {compact ? <CompactNoteContent stock={stock} /> : <NoteContent stock={stock} />}
      </div>
    )}
    </div>
  );
}

const NOTE_MAX_LINES = 4;
const NOTE_LINE_HEIGHT = 18; // fontSize 12 * lineHeight 1.5
const DISCLOSURE_MAX_LINES = 4;
const DISCLOSURE_LINE_HEIGHT = 15.75; // fontSize 10.5 * lineHeight 1.5

// 本文ブロック(タグ+本文+orders)と開示情報ブロックを、区切り線(border-top)を挟んで分けて表示する。
// タグは本文の先頭行に同居させ(個別画面NoteContentの「今日」パターンと同じ)、本文が長い場合は
// タグの右から回り込んで折り返す。ordersは個別画面と同じくグレー小サイズの別行として本文の下に置く。
// 本文ブロック(タグ行+本文+orders)は4行相当まで。本文は超過時に二分探索で文字を切り省略記号
// 「…」を付ける。ordersは全体がその4行枠に収まる場合のみ表示し、収まらなければ(部分表示や
// 省略記号なしで)丸ごと非表示にする。
//
// 開示情報ブロックは本文とは別に4行相当の枠を持つが、こちらも項目単位の全部/非表示切り替えのみ
// で、行の途中で途切れる項目があれば(文字を切って省略記号を付けず)その項目ごと非表示にする。
//
// 省略記号をCSSのwebkit-line-clampに任せず実DOM計測(scrollHeight)で手動計算しているのは、
// 画像まとめ出力に使うsnapdomのキャプチャ結果だけ省略記号が描画されない(文字が中途半端に
// 切れる)事象を実データで確認したため。
function CompactNoteContent({ stock }: { stock: CardStock }) {
  let badge: { bg: string; label: string } | null = null;
  let mainText = "";
  let mainColor = "#3A4050";
  let ordersText = "";

  if (stock.reason) {
    if (stock.reason.kind === "today") {
      badge = reasonStatusBadge(stock.reason.status);
      mainText = stock.reason.text;
      if (stock.reason.orders) ordersText = stock.reason.orders;
    } else {
      badge = { bg: "#8B0000", label: `連騰${stock.reason.streakDays}日目` };
      mainText = stock.reason.prevText;
      mainColor = "#9098A9";
    }
  }

  const reasonBlockRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);
  const ordersRef = useRef<HTMLDivElement>(null);

  // 計測結果をReactのstateに戻さず直接DOMへ書き込む。setStateで再レンダリングすると
  // react-hooks/set-state-in-effectのカスケード再レンダリング警告に抵触する上、
  // ここはReactが管理する子要素を持たない末端要素なので直接書き込んでも競合しない。
  useLayoutEffect(() => {
    const textEl = textRef.current;
    const ordersEl = ordersRef.current;
    const reasonBlock = reasonBlockRef.current;
    if (!textEl || !ordersEl || !reasonBlock) return;

    const maxHeight = NOTE_LINE_HEIGHT * NOTE_MAX_LINES + 1;

    if (!mainText) {
      textEl.replaceChildren();
    } else {
      const clone = document.createElement("span");
      clone.style.position = "absolute";
      clone.style.visibility = "hidden";
      clone.style.width = `${textEl.clientWidth}px`;
      clone.style.display = "block";
      clone.style.fontSize = "12px";
      clone.style.lineHeight = "1.5";
      textEl.parentElement?.appendChild(clone);

      let visibleText = mainText;
      clone.textContent = mainText;
      if (clone.scrollHeight > maxHeight) {
        let lo = 0;
        let hi = mainText.length;
        while (lo < hi) {
          const mid = Math.ceil((lo + hi) / 2);
          clone.textContent = mainText.slice(0, mid) + "…";
          if (clone.scrollHeight <= maxHeight) lo = mid;
          else hi = mid - 1;
        }
        visibleText = mainText.slice(0, lo) + (lo < mainText.length ? "…" : "");
      }
      clone.remove();
      textEl.textContent = visibleText;
    }

    // ordersは本文込みの合計高さが4行枠に収まる場合のみ全文表示し、収まらなければ丸ごと非表示。
    ordersEl.textContent = ordersText || "";
    if (ordersText && reasonBlock.scrollHeight > maxHeight) {
      ordersEl.replaceChildren();
    }
  }, [mainText, ordersText]);

  const disclosureRef = useRef<HTMLDivElement>(null);
  const disclosureItems = stock.disclosures ?? [];
  const disclosureKey = disclosureItems.map((d) => `${d.date}|${d.title}`).join("");

  useLayoutEffect(() => {
    const host = disclosureRef.current;
    if (!host) return;
    host.replaceChildren();
    if (disclosureItems.length === 0) return;

    const maxHeight = DISCLOSURE_LINE_HEIGHT * DISCLOSURE_MAX_LINES + 1;
    const measureHost = document.createElement("div");
    measureHost.style.position = "absolute";
    measureHost.style.visibility = "hidden";
    measureHost.style.width = `${host.clientWidth}px`;
    host.parentElement?.appendChild(measureHost);

    const makeItemEl = (item: DisclosureItem): HTMLDivElement => {
      const el = document.createElement("div");
      el.style.fontSize = "10.5px";
      el.style.color = "#9098A9";
      el.style.lineHeight = "1.5";
      const dateSpan = document.createElement("span");
      dateSpan.style.fontVariantNumeric = "tabular-nums";
      dateSpan.style.marginRight = "5px";
      dateSpan.textContent = fmtCompactDate(item.date);
      el.appendChild(dateSpan);
      el.appendChild(document.createTextNode(item.title));
      return el;
    };

    const kept: HTMLElement[] = [];
    for (const item of disclosureItems) {
      const el = makeItemEl(item);
      measureHost.appendChild(el);
      if (measureHost.scrollHeight > maxHeight) {
        measureHost.removeChild(el);
        break;
      }
      kept.push(el);
    }
    measureHost.remove();
    host.replaceChildren(...kept);
  }, [disclosureKey]);

  return (
    <div>
      <div
        ref={reasonBlockRef}
        style={{ maxHeight: NOTE_LINE_HEIGHT * NOTE_MAX_LINES + 1, overflow: "hidden" }}
      >
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: 6 }}>
          {badge && (
            <span
              style={{
                fontSize: 9,
                fontWeight: 700,
                color: "#FFFFFF",
                background: badge.bg,
                borderRadius: 3,
                padding: "1px 5px",
                flexShrink: 0,
              }}
            >
              {badge.label}
            </span>
          )}
          <span
            ref={textRef}
            style={{
              fontSize: 12,
              fontWeight: 500,
              color: mainColor,
              lineHeight: 1.5,
              flex: 1,
              minWidth: 0,
            }}
          />
        </div>
        <div ref={ordersRef} style={{ fontSize: 10.5, color: "#9098A9", lineHeight: 1.5, marginTop: 4 }} />
      </div>
      {disclosureItems.length > 0 && (
        <div
          ref={disclosureRef}
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 3,
            marginTop: 6,
            paddingTop: 6,
            borderTop: "1px solid #EEEEEE",
            maxHeight: DISCLOSURE_LINE_HEIGHT * DISCLOSURE_MAX_LINES + 1,
            overflow: "hidden",
          }}
        />
      )}
    </div>
  );
}

function NoteContent({ stock }: { stock: CardStock }) {
  return (
    <>
      {stock.reason && (
        <div style={{ marginBottom: stock.disclosures && stock.disclosures.length > 0 ? 6 : 0 }}>
          {stock.reason.kind === "today" ? (
            <>
              <div style={{ display: "flex", alignItems: "baseline", gap: 6, flexWrap: "wrap" }}>
                {(() => {
                  const badge = reasonStatusBadge(stock.reason.status);
                  return (
                    <span
                      style={{
                        fontSize: 9,
                        fontWeight: 700,
                        color: "#FFFFFF",
                        background: badge.bg,
                        borderRadius: 3,
                        padding: "1px 5px",
                        flexShrink: 0,
                      }}
                    >
                      {badge.label}
                    </span>
                  );
                })()}
                <span style={{ fontSize: 12, fontWeight: 500, color: "#3A4050", lineHeight: 1.5 }}>
                  {stock.reason.text}
                </span>
              </div>
              {stock.reason.orders && (
                <div style={{ fontSize: 10.5, color: "#9098A9", marginTop: 4, lineHeight: 1.5 }}>
                  {stock.reason.orders}
                </div>
              )}
            </>
          ) : (
            <div style={{ display: "flex", alignItems: "baseline", gap: 6, flexWrap: "wrap" }}>
              <span
                style={{
                  fontSize: 9,
                  fontWeight: 700,
                  color: "#FFFFFF",
                  background: "#8B0000",
                  borderRadius: 3,
                  padding: "1px 5px",
                  flexShrink: 0,
                }}
              >
                連騰{stock.reason.streakDays}日目
              </span>
              <span style={{ fontSize: 12, fontWeight: 500, color: "#9098A9", lineHeight: 1.5 }}>
                {stock.reason.prevText}
                <span style={{ fontSize: 10, color: "#B4B8C0", marginLeft: 4 }}>(前回理由)</span>
              </span>
            </div>
          )}
        </div>
      )}

      {stock.disclosures && stock.disclosures.length > 0 && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 3,
            paddingTop: stock.reason ? 6 : 0,
            borderTop: stock.reason ? "1px solid #EEEEEE" : "none",
          }}
        >
          {stock.disclosures.map((item, i) => (
            <div key={i} style={{ fontSize: 10.5, color: "#9098A9", lineHeight: 1.5 }}>
              <span style={{ fontVariantNumeric: "tabular-nums", fontSize: 10.5, color: "#9098A9", marginRight: 5 }}>
                {fmtCompactDate(item.date)}
              </span>
              {item.title}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
