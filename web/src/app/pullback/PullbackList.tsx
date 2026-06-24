"use client";
import { useState, useMemo } from "react";
import { StockRow, StockRowHeader } from "../_components/StockRow";
import { PageHeader } from "../_components/PageHeader";
import { STATE_CONFIG, StateLabel, Row, classify } from "@/lib/classify";

// ─── 時価総額フィルタ ─────────────────────────────────────────────────────────
const CAP_FILTERS = [
  { label: "100↓", key: "le100"  },
  { label: "300↓", key: "le300"  },
  { label: "1000↓", key: "le1000" },
  { label: "1000↑", key: "ge1000" },
] as const;
type CapFilter = "all" | (typeof CAP_FILTERS)[number]["key"];

function applyCapFilter(row: Row, cap: CapFilter): boolean {
  if (cap === "all") return true;
  if (row.mktcap_oku === null) return false;
  if (cap === "le100")  return row.mktcap_oku <= 100;
  if (cap === "le300")  return row.mktcap_oku <= 300;
  if (cap === "le1000") return row.mktcap_oku <= 1000;
  if (cap === "ge1000") return row.mktcap_oku >= 1000;
  return true;
}

// ─── メインコンポーネント ─────────────────────────────────────────────────────
export default function PullbackList({
  base,
  meta,
}: {
  base: Row[];
  meta: { date: string } | null;
}) {
  const [capFilter, setCapFilter] = useState<CapFilter>("all");

  // 状態分類（capFilter前）
  const classified = useMemo<Map<StateLabel, Row[]>>(() => {
    const labels: StateLabel[] = [
      ...STATE_CONFIG.map((s) => s.label),
      "対象外",
    ];
    const map = new Map<StateLabel, Row[]>(labels.map((l) => [l, []]));

    for (const row of base) {
      map.get(classify(row))!.push(row);
    }
    for (const rows of map.values()) {
      rows.sort((a, b) => (b.turnover_50 ?? 0) - (a.turnover_50 ?? 0));
    }
    return map;
  }, [base]);

  // capFilter を全セクション一括適用
  const sections = useMemo<Map<StateLabel, Row[]>>(() => {
    const result = new Map<StateLabel, Row[]>();
    for (const [state, rows] of classified) {
      result.set(state, rows.filter((r) => applyCapFilter(r, capFilter)));
    }
    return result;
  }, [classified, capFilter]);

  const offCount = sections.get("対象外")?.length ?? 0;

  return (
    <div style={{ backgroundColor: "#17171a", minHeight: "100vh", paddingTop: 12, paddingBottom: 12 }}>
      <PageHeader
        date={meta?.date}
        description={
          "直近50日間で売買が活況な銘柄（回転率5%以上）を、異なる時間軸の騰落率と突き合わせて状態分類しています。\n\n「継続／初動・再加速／短期押し目／調整／調整予備軍／中立帯／失速」などの状態に振り分け、押し目・拾い場の候補を状態別に並べています。"
        }
      />

      {/* 時価総額フィルタ */}
      <div style={{ display: "flex", gap: 6, marginBottom: 12, paddingLeft: 16, paddingRight: 16 }}>
        {CAP_FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setCapFilter(capFilter === f.key ? "all" : f.key)}
            style={{
              flex: 1,
              padding: "7px 0",
              borderRadius: 8,
              fontFamily: "ui-monospace, monospace",
              fontVariantNumeric: "tabular-nums",
              fontSize: 13,
              fontWeight: 600,
              transition: "background 0.15s, color 0.15s",
              background: capFilter === f.key ? "#fff" : "#2c2c2e",
              color: capFilter === f.key ? "#000" : "#8e8e93",
              border: "none",
            }}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* 状態セクション */}
      {STATE_CONFIG.map(({ label, headerBg }) => {
        const rows = sections.get(label) ?? [];
        if (rows.length === 0) return null;
        return (
          <div key={label} className="mb-4">
            {/* 色帯ヘッダ */}
            <div className={`py-1 ${headerBg} text-white text-xs font-bold flex items-center gap-2`} style={{ paddingLeft: 16, paddingRight: 16 }}>
              <span>{label}</span>
              <span className="font-normal text-[10px] opacity-80">{rows.length} 件</span>
            </div>
            {/* v3行 */}
            <div style={{ backgroundColor: "#17171a" }}>
              <StockRowHeader />
              {rows.map((r, i) => (
                <StockRow
                  key={r.code}
                  name={r.name}
                  code={r.code}
                  mktcap_oku={r.mktcap_oku}
                  close={r.close}
                  ret_1d={r.ret_1d}
                  ret_5d={r.ret_5d}
                  ret_1m={r.ret_1m}
                  ret_3m={r.ret_3m}
                  ret_1y={r.ret_1y}
                  occLeft={r.turnover_50}
                  occRight={0}
                  isEven={i % 2 === 1}
                />
              ))}
            </div>
          </div>
        );
      })}

      {/* 対象外 件数注記 */}
      <p className="text-[10px] text-gray-600 mt-1" style={{ paddingLeft: 16, paddingRight: 16 }}>
        対象外（中期データ不足等）: {offCount} 件
      </p>
    </div>
  );
}
