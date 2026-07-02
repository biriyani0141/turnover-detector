"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { CardStock } from "./TurnoverCard";

type MarginWeek = {
  date: string;
  close_price: number | null;
  buy_balance: number;
  pct_of_shares: number | null;
};
type Stockholder = { name: string; pct: number | null; shares: number | null };
type NewsItem = { date: string; title: string; tag: string; url: string };

export type StockDetail = {
  code: string;
  name: string;
  market: string;
  sector: string | null;
  market_cap: string | null;
  shares_outstanding: number;
  overview_text: string | null;
  themes: string[];
  margin_weekly: MarginWeek[];
  stockholders: Stockholder[];
  news: NewsItem[];
};

// ---- デザイントークン ----
// 上げ/下げ(前日比・週次増減)は既存アプリの慣習配色(上げ=赤/下げ=緑)を踏襲。
// ロイヤルブルーはグラフ・プログレスバー専用の単色アクセント。
// ステータス色(黄/赤バッジ)は固定、アクセントと混同しない。
const UP = "#E03A2F";
const DOWN = "#1B8C7D";
const ROYAL_BLUE = "#2E5EEA";
const ROYAL_BLUE_LIGHT = "#CBD8F5"; // 棒グラフを淡くして株価ラインと役割分離
const PRICE_LINE = "#F5A623"; // 株価ラインはアクセントのオレンジ系(棒=青と衝突しない)
const SKY_BLUE = "#6FA8FF";
const PALE_BLUE = "#B8D0FC";
const DONUT_REST = "#E7EBF1";
const WARNING = "#fab219";
const CRITICAL = "#d03b3b";
const INK = "#1F2937"; // 真っ黒ではなくチャコール
const MUTED = "#6B7280";
const FAINT = "#9CA3AF";
const UNIT_GRAY = "#B4B8C0";
const DIVIDER = "#EEEEEE";
const SHEET_BG = "#F0F1F3"; // ボトムシート全体のベース(はっきり分かる薄いグレー)
const CARD_BG = "#FFFFFF"; // 各ブロックの「座布団」カード

// 見出し/本文のウェイト階層(役割ごとに固定、3段階)
const W_REGULAR = 400; // 補助情報・本文
const W_MEDIUM = 500; // タグ・軽い強調
const W_BOLD = 700; // 見出し・強調テキスト
// 数値系(株価・%・出来高など)は tabular-nums + 700 で統一
// (800/900はフォントによっては太字フェイスが無く弱く見えることがあるため700に統一)
const W_NUM = 700;

const cardBlockStyle: React.CSSProperties = {
  background: CARD_BG,
  borderRadius: 12,
  padding: 16,
};

// 数字本体より小さく・薄いグレーの単位ラベル(「%」「万株」「億円」等)
function Unit({ children }: { children: React.ReactNode }) {
  return (
    <span style={{ fontSize: "0.68em", fontWeight: W_REGULAR, color: UNIT_GRAY, marginLeft: 1 }}>
      {children}
    </span>
  );
}

const FONT =
  "'Inter', 'Helvetica Neue', 'Noto Sans JP', 'Yu Gothic', 'Hiragino Sans', Arial, sans-serif";
const MONO_FONT = "'SF Mono', SFMono-Regular, ui-monospace, 'Roboto Mono', Menlo, Consolas, monospace";
const DRAG_CLOSE_THRESHOLD = 100;

const numStyle: React.CSSProperties = {
  fontFamily: MONO_FONT,
  fontWeight: W_NUM,
  fontVariantNumeric: "tabular-nums",
};

const themeTagStyle: React.CSSProperties = {
  fontSize: 10,
  fontWeight: W_MEDIUM,
  color: MUTED,
  border: "1px solid #E0E4EA",
  borderRadius: 9999,
  padding: "2px 9px",
  background: "transparent",
};

function fmtCompactShares(n: number): string {
  if (Math.abs(n) >= 10000) return `${(n / 10000).toFixed(1)}万`;
  return n.toLocaleString("ja-JP");
}

function fmtNum(n: number): string {
  return n % 1 === 0 ? n.toFixed(0) : n.toFixed(1);
}

function fmtPrice(p: number): string {
  return p >= 1000 ? Math.round(p).toLocaleString("ja-JP") : fmtNum(p);
}

function pctBadge(pct: number | null): { bg: string; fg: string; label: string } | null {
  if (pct === null) return null;
  if (pct >= 20) return { bg: CRITICAL, fg: "#FFFFFF", label: `信用残割合 ${pct.toFixed(1)}%` };
  if (pct >= 10) return { bg: WARNING, fg: "#3A2A00", label: `信用残割合 ${pct.toFixed(1)}%` };
  return { bg: "transparent", fg: FAINT, label: `信用残割合 ${pct.toFixed(1)}%` };
}

// ニュースのタグ種別ごとの色分け(kabutan側のnews_category-*と対応、種別ごとに固定色)
const NEWS_TAG_COLORS: Record<string, { bg: string; fg: string }> = {
  材料: { bg: "#FFF1DE", fg: "#B36B00" },
  開示: { bg: "#E8EDFC", fg: ROYAL_BLUE },
  テク: { bg: "#F1E9FB", fg: "#7C3AED" },
  決算: { bg: "#E6F5F1", fg: "#0F7A5C" },
};
const NEWS_TAG_FALLBACK = { bg: "#F0F1F3", fg: MUTED };

function newsTagStyle(tag: string): { bg: string; fg: string } {
  return NEWS_TAG_COLORS[tag] ?? NEWS_TAG_FALLBACK;
}

// ---- module-level cache: シート開閉のたびに再fetchしない ----
let dataCache: Record<string, Record<string, StockDetail>> | null = null;
let dataPromise: Promise<Record<string, Record<string, StockDetail>>> | null = null;

function loadDetailData(): Promise<Record<string, Record<string, StockDetail>>> {
  if (dataCache) return Promise.resolve(dataCache);
  if (!dataPromise) {
    dataPromise = fetch("/data/stop-high-detail.json")
      .then((r) => r.json())
      .then((data: Record<string, Record<string, StockDetail>>) => {
        dataCache = data;
        return data;
      });
  }
  return dataPromise;
}

const CHART_H = 108;
// Y軸ラベル(最大値・半分・0)の位置に正確に合わせたグリッド線
const GRID_LINE_FRACTIONS = [0, 0.5];

function MarginBarChart({ weeks }: { weeks: MarginWeek[] }) {
  // 古い→新しいの時系列に並べ替え(scraper側は新しい順)
  const chrono = [...weeks].reverse();
  const maxVal = Math.max(...chrono.map((w) => w.buy_balance), 1);

  const prices = chrono.map((w) => w.close_price).filter((p): p is number => p !== null);
  const hasPriceLine = prices.length >= 2;
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);
  const priceRange = maxPrice - minPrice || 1;
  const points = chrono
    .map((w, i) => {
      if (w.close_price === null) return null;
      const x = ((i + 0.5) / chrono.length) * 100;
      const y = 100 - ((w.close_price - minPrice) / priceRange) * 100;
      return `${x},${y}`;
    })
    .filter((p): p is string => p !== null)
    .join(" ");

  return (
    <div>
      <div style={{ display: "flex" }}>
        {/* Y軸ラベル(株数) */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            height: CHART_H,
            paddingRight: 4,
            paddingBottom: 8,
          }}
        >
          <span style={{ fontSize: 8, color: FAINT, fontFamily: MONO_FONT }}>
            {fmtCompactShares(maxVal)}
          </span>
          <span style={{ fontSize: 8, color: FAINT, fontFamily: MONO_FONT }}>
            {fmtCompactShares(maxVal / 2)}
          </span>
          <span style={{ fontSize: 8, color: FAINT, fontFamily: MONO_FONT }}>0</span>
        </div>

        <div style={{ position: "relative", flex: 1, height: CHART_H, padding: "0 2px" }}>
          {/* 補助グリッド線: Y軸ラベル(最大値・半分)の位置に正確に一致させる */}
          {GRID_LINE_FRACTIONS.map((f) => (
            <div
              key={f}
              style={{
                position: "absolute",
                left: 0,
                right: 0,
                top: `${f * 100}%`,
                borderTop: "1px solid #E8EAED",
              }}
            />
          ))}

          {/* 棒グラフ */}
          <div
            style={{
              position: "relative",
              display: "flex",
              alignItems: "flex-end",
              gap: 4,
              height: "100%",
            }}
          >
            {chrono.map((w, i) => {
              const isLatest = i === chrono.length - 1;
              const h = Math.max(2, (w.buy_balance / maxVal) * CHART_H - 8);
              return (
                <div
                  key={w.date}
                  style={{
                    flex: 1,
                    minWidth: 0,
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "flex-end",
                    height: "100%",
                  }}
                >
                  {isLatest && (
                    <span
                      style={{
                        fontSize: 9,
                        fontWeight: W_NUM,
                        fontFamily: MONO_FONT,
                        fontVariantNumeric: "tabular-nums",
                        color: INK,
                        whiteSpace: "nowrap",
                        marginBottom: 3,
                      }}
                    >
                      {fmtCompactShares(w.buy_balance)}
                    </span>
                  )}
                  <div
                    title={`${w.date}: ${w.buy_balance.toLocaleString("ja-JP")}株`}
                    style={{
                      width: "100%",
                      maxWidth: 16,
                      height: h,
                      background: isLatest ? ROYAL_BLUE : ROYAL_BLUE_LIGHT,
                      borderRadius: "2px 2px 0 0",
                    }}
                  />
                </div>
              );
            })}
          </div>

          {/* 株価ライン(細い折れ線を棒グラフに重ねる) */}
          {hasPriceLine && (
            <svg
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
              style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }}
            >
              <polyline
                points={points}
                fill="none"
                stroke={PRICE_LINE}
                strokeWidth={1.5}
                strokeOpacity={0.95}
                vectorEffect="non-scaling-stroke"
              />
            </svg>
          )}
        </div>
      </div>
      <div style={{ display: "flex", gap: 4, paddingLeft: 28, paddingTop: 2 }}>
        {chrono.map((w, i) => {
          const showLabel = i % 4 === 0 || i === chrono.length - 1;
          return (
            <span
              key={w.date}
              style={{
                flex: 1,
                minWidth: 0,
                textAlign: "center",
                fontSize: 8,
                color: FAINT,
                visibility: showLabel ? "visible" : "hidden",
              }}
            >
              {showLabel ? w.date : ""}
            </span>
          );
        })}
      </div>
    </div>
  );
}

const DONUT_COLORS = [ROYAL_BLUE, SKY_BLUE, PALE_BLUE];
const DONUT_R = 38;
const DONUT_STROKE = 11;
const DONUT_CIRC = 2 * Math.PI * DONUT_R;

function HolderDonut({ holders }: { holders: Stockholder[] }) {
  const top3 = holders.slice(0, 3);
  const top3Pct = top3.reduce((s, h) => s + (h.pct ?? 0), 0);
  const restPct = Math.max(0, 100 - top3Pct);

  const segments = [
    ...top3.map((h, i) => ({ pct: h.pct ?? 0, color: DONUT_COLORS[i] })),
    { pct: restPct, color: DONUT_REST },
  ];

  let offset = 0;

  return (
    <div style={{ position: "relative", width: 100, height: 100, flexShrink: 0 }}>
      <svg viewBox="0 0 100 100" width={100} height={100}>
        <g transform="rotate(-90 50 50)">
          {segments.map((seg, i) => {
            if (seg.pct <= 0) return null;
            const dash = (seg.pct / 100) * DONUT_CIRC;
            const el = (
              <circle
                key={i}
                cx={50}
                cy={50}
                r={DONUT_R}
                fill="none"
                stroke={seg.color}
                strokeWidth={DONUT_STROKE}
                strokeDasharray={`${dash} ${DONUT_CIRC - dash}`}
                strokeDashoffset={-offset}
              />
            );
            offset += dash;
            return el;
          })}
        </g>
      </svg>
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div style={{ fontSize: 9, fontWeight: W_REGULAR, color: MUTED, marginBottom: 2 }}>上位3名</div>
        <div style={{ ...numStyle, fontSize: 16, color: INK, letterSpacing: "-0.01em" }}>
          {top3Pct.toFixed(1)}
          <Unit>%</Unit>
        </div>
      </div>
    </div>
  );
}

function StockholderList({ holders }: { holders: Stockholder[] }) {
  return (
    <div style={{ display: "flex", gap: 16 }}>
      <HolderDonut holders={holders} />

      <div style={{ flex: 1, minWidth: 0, maxHeight: 220, overflowY: "auto" }}>
        {holders.map((h, i) => (
          <div
            key={`${h.name}-${i}`}
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "baseline",
              gap: 6,
              padding: "5px 0",
              borderBottom: i < holders.length - 1 ? `1px solid ${DIVIDER}` : "none",
            }}
          >
            <span
              style={{
                fontSize: 11,
                fontWeight: W_REGULAR,
                color: "#3A4050",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
                flex: 1,
                minWidth: 0,
              }}
            >
              <span style={{ fontWeight: 300, color: FAINT, marginRight: 4, fontSize: 10 }}>{i + 1}</span>
              {h.name}
            </span>
            <span
              style={{
                ...numStyle,
                fontSize: 11,
                color: INK,
                flexShrink: 0,
              }}
            >
              {h.pct !== null ? h.pct.toFixed(2) : "—"}
              <Unit>%</Unit>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function StopHighDetailSheet({
  stock,
  onClose,
}: {
  stock: CardStock | null;
  onClose: () => void;
}) {
  // stockがnullになった直後もスライドダウン中は最後の銘柄を表示し続ける
  // (effect内でsetStateせず、レンダー中の条件付き更新でReact推奨パターンに従う)
  const [displayStock, setDisplayStock] = useState<CardStock | null>(null);
  if (stock !== null && stock.code !== displayStock?.code) {
    setDisplayStock(stock);
  }

  const isOpen = stock !== null;
  const [dragY, setDragY] = useState(0);
  const [dragging, setDragging] = useState(false);
  const startYRef = useRef(0);

  useEffect(() => {
    if (!isOpen) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, [isOpen]);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    setDragging(true);
    startYRef.current = e.touches[0].clientY;
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    const delta = e.touches[0].clientY - startYRef.current;
    if (delta > 0) setDragY(delta);
  }, []);

  const handleTouchEnd = useCallback(() => {
    setDragging(false);
    if (dragY > DRAG_CLOSE_THRESHOLD) {
      onClose();
    }
    setDragY(0);
  }, [dragY, onClose]);

  if (displayStock === null) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 100,
        fontFamily: FONT,
        pointerEvents: isOpen ? "auto" : "none",
      }}
    >
      {/* 背景 */}
      <div
        onClick={onClose}
        style={{
          position: "absolute",
          inset: 0,
          background: "rgba(15,17,23,0.5)",
          opacity: isOpen ? 1 : 0,
          transition: "opacity 0.25s ease",
        }}
      />

      {/* シート本体 */}
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          maxHeight: "88vh",
          background: SHEET_BG,
          borderRadius: "20px 20px 0 0",
          boxShadow: "0 -4px 24px rgba(20,25,40,0.2)",
          display: "flex",
          flexDirection: "column",
          transform: isOpen ? `translateY(${dragY}px)` : "translateY(100%)",
          transition: dragging ? "none" : "transform 0.28s cubic-bezier(0.32,0.72,0,1)",
        }}
      >
        {/* ハンドル: ここを掴んでドラッグしたときだけ閉じる(本文スクロール中の誤爆を防ぐ) */}
        <div
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          style={{ display: "flex", justifyContent: "center", padding: "14px 0 10px", flexShrink: 0 }}
        >
          <div style={{ width: 36, height: 4, borderRadius: 2, background: "rgba(107,114,128,0.3)" }} />
        </div>

        <div style={{ overflowY: "auto", padding: "6px 18px 28px" }}>
          <SheetContent key={displayStock.code} stock={displayStock} />
        </div>
      </div>
    </div>
  );
}

function SheetContent({ stock }: { stock: CardStock }) {
  const [detail, setDetail] = useState<StockDetail | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [overviewOpen, setOverviewOpen] = useState(false);
  const [newsOpen, setNewsOpen] = useState(false);

  useEffect(() => {
    loadDetailData()
      .then((data) => {
        const dateKey = Object.keys(data).sort().pop();
        const found = dateKey ? data[dateKey]?.[stock.code] : undefined;
        if (found) setDetail(found);
        else setLoadError(true);
      })
      .catch(() => setLoadError(true));
  }, [stock.code]);

  const isUp = stock.change >= 0;
  const changeColor = isUp ? UP : DOWN;
  const sign = isUp ? "+" : "";

  // 出来高率(=当日出来高÷発行済株式数、stock.volumesの最終日を使用)は
  // ヘッダーでの表示位置が未定のため一旦保留。再度必要になったら
  // stock.volumes[stock.volumes.length-1].value / detail.shares_outstanding * 100 で算出する。

  if (!detail && !loadError) {
    return (
      <div style={{ padding: "48px 0", textAlign: "center", color: MUTED, fontSize: 13 }}>
        読み込み中…
      </div>
    );
  }

  if (loadError || !detail) {
    return (
      <div style={{ padding: "48px 0", textAlign: "center", color: MUTED, fontSize: 13 }}>
        データを取得できませんでした
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, paddingTop: 6, paddingBottom: 6 }}>
      {/* A: ヘッダー基本情報 */}
      <div style={cardBlockStyle}>
      {/* /chartページ ChartCard.tsx の「情報エリア（2行）」を移植(白カードに馴染むよう背景を白化・下端に区切り線) */}
      <div
        style={{
          borderBottom: `1px solid ${DIVIDER}`,
          paddingBottom: 10,
          marginBottom: 10,
          overflow: "hidden",
        }}
      >
        {/* 行1: 銘柄名 */}
        <div style={{ display: "flex", alignItems: "center", padding: "0 0 3px", gap: 6 }}>
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
            {detail.name}
          </span>
        </div>

        {/* 行2: コード・市場タグ → 株価 → 前日比 → S高バッジ → 指標2カラム(回転率/時価総額) */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: 0,
            fontVariantNumeric: "tabular-nums",
            overflow: "hidden",
          }}
        >
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

          <span style={{ fontSize: 14, fontWeight: 700, color: changeColor, letterSpacing: "-0.02em", flexShrink: 0 }}>
            {fmtPrice(stock.price)}
          </span>

          <span style={{ fontSize: 11, fontWeight: 600, color: changeColor, letterSpacing: "-0.01em", flexShrink: 0 }}>
            {sign}
            {fmtNum(stock.change)} ({sign}
            {stock.changePct.toFixed(2)}%)
          </span>

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

          <div style={{ flex: 1, minWidth: 4 }} />

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
          </div>
        </div>
      </div>

      {/* 概要 2行+トグル(情報エリアのすぐ下に続ける) */}
      {detail.overview_text && (
        <div style={{ marginTop: 0 }}>
          <p
            style={{
              fontSize: 12,
              fontWeight: W_REGULAR,
              lineHeight: 1.65,
              color: "#4B5060",
              margin: 0,
              display: overviewOpen ? "block" : "-webkit-box",
              WebkitLineClamp: overviewOpen ? undefined : 2,
              WebkitBoxOrient: overviewOpen ? undefined : "vertical",
              overflow: overviewOpen ? "visible" : "hidden",
            }}
          >
            {detail.overview_text}
          </p>
          <button
            type="button"
            onClick={() => setOverviewOpen((o) => !o)}
            style={{
              background: "none",
              border: "none",
              padding: 0,
              marginTop: 3,
              fontSize: 11,
              fontWeight: W_MEDIUM,
              color: ROYAL_BLUE,
              cursor: "pointer",
            }}
          >
            {overviewOpen ? "閉じる" : "もっと見る"}
          </button>
        </div>
      )}

      {/* 関連テーマ: 枠線無し、極薄い塗りのみ */}
      {detail.themes.length > 0 && (
        <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginTop: 10 }}>
          {detail.themes.map((t) => (
            <span key={t} style={themeTagStyle}>
              {t}
            </span>
          ))}
        </div>
      )}
      </div>

      {/* 直近ニュース(白カード、折りたたみ・デフォルト閉じ) */}
      {detail.news.length > 0 && (
        <div style={cardBlockStyle}>
          <button
            type="button"
            onClick={() => setNewsOpen((o) => !o)}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              width: "100%",
              background: "none",
              border: "none",
              padding: 0,
              cursor: "pointer",
              fontSize: 11,
              fontWeight: W_BOLD,
              color: MUTED,
              letterSpacing: "0.02em",
            }}
          >
            <span>直近ニュース</span>
            <span
              style={{
                fontSize: 9,
                color: FAINT,
                transform: newsOpen ? "rotate(180deg)" : "none",
                transition: "transform 0.15s",
              }}
            >
              ▼
            </span>
          </button>

          {newsOpen && (
            <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${DIVIDER}` }}>
              {detail.news.map((n, i) => {
                const tagStyle = newsTagStyle(n.tag);
                return (
                  <a
                    key={i}
                    href={n.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 2,
                      padding: "7px 0",
                      borderBottom: i < detail.news.length - 1 ? `1px solid ${DIVIDER}` : "none",
                      textDecoration: "none",
                      cursor: "pointer",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span
                        style={{
                          fontSize: 9,
                          fontWeight: W_MEDIUM,
                          color: tagStyle.fg,
                          background: tagStyle.bg,
                          borderRadius: 3,
                          padding: "1px 5px",
                          flexShrink: 0,
                        }}
                      >
                        {n.tag}
                      </span>
                      <span style={{ ...numStyle, fontSize: 10, color: FAINT }}>{n.date}</span>
                    </div>
                    <span style={{ fontSize: 12, fontWeight: W_REGULAR, color: "#3A4050", lineHeight: 1.5 }}>
                      {n.title}
                    </span>
                  </a>
                );
              })}
              <button
                type="button"
                onClick={() =>
                  window.open(`https://s.kabutan.jp/stocks/${stock.code.slice(0, 4)}/news/`, "_blank", "noopener,noreferrer")
                }
                style={{
                  background: "none",
                  border: "none",
                  padding: 0,
                  marginTop: 6,
                  fontSize: 11,
                  fontWeight: W_MEDIUM,
                  color: ROYAL_BLUE,
                  cursor: "pointer",
                }}
              >
                もっと見る
              </button>
            </div>
          )}
        </div>
      )}

      {/* B: 週次信用買い残(白カード) */}
      <div style={cardBlockStyle}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            paddingBottom: 8,
            marginBottom: 10,
            borderBottom: `1px solid ${DIVIDER}`,
          }}
        >
          <span style={{ fontSize: 11, fontWeight: W_BOLD, color: MUTED, letterSpacing: "0.02em" }}>
            信用残・{detail.margin_weekly.length}週
          </span>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {(() => {
              const chrono = [...detail.margin_weekly].reverse();
              const latest = chrono[chrono.length - 1];
              const prev = chrono.length >= 2 ? chrono[chrono.length - 2] : null;
              const delta = prev ? latest.buy_balance - prev.buy_balance : null;
              if (delta === null) return null;
              return (
                <span
                  style={{
                    ...numStyle,
                    fontSize: 10,
                    color: delta > 0 ? UP : delta < 0 ? DOWN : MUTED,
                    whiteSpace: "nowrap",
                  }}
                >
                  {delta > 0 ? "▲" : delta < 0 ? "▼" : "―"} 前週比 {delta > 0 ? "+" : ""}
                  {fmtCompactShares(delta)}株
                </span>
              );
            })()}
            {(() => {
              const latestPct = detail.margin_weekly[0]?.pct_of_shares ?? null;
              const badge = pctBadge(latestPct);
              if (!badge) return null;
              return (
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    color: badge.fg,
                    background: badge.bg,
                    border: badge.bg === "transparent" ? `1px solid ${DIVIDER}` : "none",
                    borderRadius: 4,
                    padding: "2px 7px",
                    whiteSpace: "nowrap",
                  }}
                >
                  {badge.label}
                </span>
              );
            })()}
          </div>
        </div>
        <MarginBarChart weeks={detail.margin_weekly} />
      </div>

      {/* C: 大株主(白カード) */}
      <div style={cardBlockStyle}>
        <div
          style={{
            fontSize: 11,
            fontWeight: W_BOLD,
            color: MUTED,
            letterSpacing: "0.02em",
            paddingBottom: 8,
            marginBottom: 10,
            borderBottom: `1px solid ${DIVIDER}`,
          }}
        >
          大株主
        </div>
        <StockholderList holders={detail.stockholders} />
      </div>
    </div>
  );
}
