"use client";
import { useEffect, useRef, useState } from "react";
import TurnoverCard, { type CardStock } from "./TurnoverCard";

const LAZY_CHART = true; // falseで全描画に切替（PickUpタブのLazyCardと同じ仕組み）

// ビューポートに入るまでチャート描画を遅延させるラッパー（TurnoverCard自体は無改修）
function LazyChart({
  stock,
  onCardClick,
}: {
  stock: CardStock;
  onCardClick?: (stock: CardStock) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(!LAZY_CHART);

  useEffect(() => {
    if (!LAZY_CHART || visible) return;
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "200px" }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [visible]);

  return (
    <div
      ref={ref}
      onClick={onCardClick ? () => onCardClick(stock) : undefined}
      style={onCardClick ? { cursor: "pointer" } : undefined}
    >
      {visible ? (
        <TurnoverCard stock={stock} />
      ) : (
        <div
          style={{
            height: 360,
            marginBottom: 12,
            background: "#F4F6FB",
            border: "1px solid #DDE1EC",
            borderRadius: 4,
          }}
        />
      )}
    </div>
  );
}

export default function TurnoverCardList({
  stocks,
  onCardClick,
}: {
  stocks: CardStock[];
  onCardClick?: (stock: CardStock) => void;
}) {
  return (
    <div>
      {stocks.map((s) => (
        <LazyChart key={s.code} stock={s} onCardClick={onCardClick} />
      ))}
    </div>
  );
}
