"use client";
import { useState, useMemo } from "react";
import { StockRow, StockRowHeader } from "../_components/StockRow";
import { PageHeader } from "../_components/PageHeader";
import { STATE_CONFIG, StateLabel, Row, classify } from "@/lib/classify";
import ExportMenu from "@/components/ExportMenu";

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
          "掲載銘柄について\n\n以下のいずれかの条件を満たす銘柄を掲載しています。\n\n" +
          "大型株 — 時価総額上位100銘柄のうち、1年リターン+100%以上の継続・押し目・調整局面にある銘柄。流動性が高く長期で追いやすい大型の強い銘柄を網羅します。\n\n" +
          "大相場 — 1年リターン+200%以上かつ直近50日の回転率上位5%以上が10日以上の銘柄（失速除く）。長期・中期トレンドが強く、売買も伴った本物の大相場銘柄です。\n\n" +
          "初動 — 直近5日で+15%以上かつ直前15日比で加速が確認された銘柄。出てきたばかりの動意株を逃さず拾います。\n\n" +
          "常連 — 直近50日の回転率上位5%以上が20日以上の銘柄（対象外除く）。継続的に売買が活発な定番銘柄です。\n\n" +
          "状態分類について\n\n直近50日間で売買が活況な銘柄（回転率5%以上）を、異なる時間軸の騰落率と突き合わせて状態分類しています。\n\n「継続／初動・再加速／短期押し目／調整／調整予備軍／中立帯／失速」などの状態に振り分け、押し目・拾い場の候補を状態別に並べています。"
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

      {/* チャート生成 */}
      {(() => {
        const exportCodes = [...sections.entries()]
          .filter(([label]) => label !== "対象外")
          .flatMap(([, rows]) => rows)
          .map((r) => r.code);
        return (
          <div style={{ marginBottom: 8, display: "flex", justifyContent: "flex-end", gap: 8, paddingLeft: 16, paddingRight: 16 }}>
            <ExportMenu codes={exportCodes} />
            <button
              type="button"
              onClick={() => {
                window.open(`/chart?codes=${exportCodes.join(",")}`, "_blank");
              }}
              style={{
                padding: "6px 14px",
                borderRadius: 6,
                fontSize: 12,
                fontWeight: 600,
                background: "#3c4043",
                border: "1px solid #5f6368",
                color: "#e8eaed",
                cursor: "pointer",
                fontFamily: "ui-monospace, monospace",
              }}
            >
              チャート生成
            </button>
          </div>
        );
      })()}

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
