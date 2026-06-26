"use client";
import { useEffect, useRef, useState } from "react";
import ChartCard, { type ChartData } from "@/components/ChartCard";

function LazyChartCard({ code }: { code: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [data, setData] = useState<ChartData | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          observer.disconnect();
          fetch(`/chart-data/${code}.json`)
            .then(r => { if (!r.ok) throw new Error(); return r.json(); })
            .then((d: ChartData) => setData(d))
            .catch(() => setError(true));
        }
      },
      { rootMargin: "200px" }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [code]);

  return (
    <div ref={ref}>
      {data ? (
        <ChartCard data={data} />
      ) : error ? (
        <div
          style={{
            height: 360,
            marginBottom: 12,
            background: "#F4F6FB",
            border: "1px solid #DDE1EC",
            borderRadius: 4,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#9098A9",
            fontSize: 12,
          }}
        >
          {code} のデータが見つかりません
        </div>
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

export default function ChartPageClient({ codes }: { codes: string[] }) {
  if (codes.length === 0) {
    return (
      <div className="p-3" style={{ color: "#9098A9", fontSize: 14 }}>
        codes パラメータが指定されていません
      </div>
    );
  }

  return (
    <div className="p-3">
      {codes.map(code => (
        <LazyChartCard key={code} code={code} />
      ))}
    </div>
  );
}
