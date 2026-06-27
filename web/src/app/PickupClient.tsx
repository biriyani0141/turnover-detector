"use client";
import { useEffect, useRef, useState, useCallback } from "react";
import TurnoverCard, { type CardStock } from "../components/TurnoverCard";
import TurnoverCardList from "../components/TurnoverCardList";
import { Row, StateLabel, STATE_CONFIG, classify, computeMktcapRanks, computeGates } from "@/lib/classify";
import ExportMenu from "../components/ExportMenu";

const LAZY_CHART = true;

type Excluded = {
  code: string;
  name: string;
  reason: string;
};

type PullbackItem = { row: Row; card: CardStock };

type DateData = {
  rows: CardStock[];
  shRows: CardStock[];
  meta: { date?: string } | null;
  pullbackSections: Map<StateLabel, PullbackItem[]>;
  pullbackMeta: { date?: string } | null;
};

function LazyCard({
  item,
  label,
  headerBg,
}: {
  item: PullbackItem;
  label: StateLabel;
  headerBg: string;
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
    <div ref={ref}>
      {visible ? (
        <TurnoverCard stock={item.card} badge={{ text: label, bgClass: headerBg }} />
      ) : (
        <div
          style={{
            height: 258,
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

function DateSelector({
  availableDates,
  selectedDate,
  onChange,
}: {
  availableDates: string[];
  selectedDate: string | null;
  onChange: (date: string | null) => void;
}) {
  if (availableDates.length < 2) return null;

  const latest = availableDates[availableDates.length - 1];
  const current = selectedDate ?? latest;
  const idx = availableDates.indexOf(current);
  if (idx === -1) return null;

  const isLatest = idx === availableDates.length - 1;
  const isEarliest = idx === 0;
  const label = current.slice(5).replace("-", "/");

  const btnStyle = (disabled: boolean): React.CSSProperties => ({
    padding: "0 6px",
    background: "transparent",
    border: "none",
    color: disabled ? "#3c3c3c" : "#707A8A",
    cursor: disabled ? "default" : "pointer",
    fontSize: 13,
    lineHeight: 1,
    userSelect: "none",
  });

  return (
    <div style={{ display: "flex", alignItems: "center", marginLeft: "auto" }}>
      <button
        type="button"
        disabled={isEarliest}
        onClick={() => {
          const prev = availableDates[idx - 1];
          onChange(prev === latest ? null : prev);
        }}
        style={btnStyle(isEarliest)}
      >
        ◀
      </button>
      <span
        style={{
          fontSize: 11,
          fontVariantNumeric: "tabular-nums",
          color: isLatest ? "#707A8A" : "#c8d0da",
          minWidth: 34,
          textAlign: "center",
          letterSpacing: "0.02em",
        }}
      >
        {label}
      </span>
      <button
        type="button"
        disabled={isLatest}
        onClick={() => {
          const next = availableDates[idx + 1];
          onChange(next === latest ? null : next);
        }}
        style={btnStyle(isLatest)}
      >
        ▶
      </button>
    </div>
  );
}

export default function PickupClient({
  rows,
  shRows,
  meta,
  excluded,
  pullbackSections,
  pullbackMeta,
}: {
  rows: CardStock[];
  shRows: CardStock[];
  meta: { date?: string } | null;
  excluded: Excluded[];
  pullbackSections: Map<StateLabel, PullbackItem[]>;
  pullbackMeta: { date?: string } | null;
}) {
  const [mode, setMode] = useState<"turnover" | "stophigh" | "pullback">("pullback");
  const [pullbackDescOpen, setPullbackDescOpen] = useState(false);

  // === 10日振り返り ===
  const [availableDates, setAvailableDates] = useState<string[]>([]);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  // override.date === selectedDate のときだけ override.data を使う
  const [override, setOverride] = useState<{ date: string; data: DateData } | null>(null);
  const cacheRef = useRef<Map<string, DateData>>(new Map());
  const excludedCodesRef = useRef(new Set(excluded.map((e) => e.code)));

  // mount: dates.json 取得 + URLパラメータ読み込み
  useEffect(() => {
    fetch("/data/dates.json")
      .then((r) => r.json())
      .then((d: { ranking?: string[] }) => {
        setAvailableDates(d.ranking ?? []);
      })
      .catch(() => {});

    const dateParam = new URLSearchParams(window.location.search).get("date");
    if (dateParam) queueMicrotask(() => setSelectedDate(dateParam));
  }, []);

  // 過去日フェッチ（すべてのsetStateを最初のawait後に実行し同期呼び出しを回避）
  const fetchDateData = useCallback(async (date: string) => {
    // キャッシュヒット: awaitで非同期にしてからsetState
    const cached = cacheRef.current.get(date);
    if (cached) {
      await Promise.resolve();
      setOverride({ date, data: cached });
      return;
    }

    const excl = excludedCodesRef.current;
    const [cardsData, popularData, popularCardsData, stophighData] = await Promise.all([
      fetch(`/data/ranking_cards_${date}.json`).then((r) => r.json()),
      fetch(`/data/popular_${date}.json`).then((r) => r.json()),
      fetch(`/data/popular_cards_${date}.json`).then((r) => r.json()),
      fetch(`/data/stophigh_cards_${date}.json`).then((r) => r.json()),
    ]);

    const newRows: CardStock[] = ((cardsData.ranking ?? []) as CardStock[])
      .filter((r) => !excl.has(r.code))
      .slice(0, 30);

    const newShRows: CardStock[] = stophighData.ranking ?? [];

    const population: Row[] = ((popularData.popular ?? []) as Row[]).filter(
      (r) => !excl.has(r.code)
    );
    const mktcapRanks = computeMktcapRanks(population);
    const base = population.filter(
      (r) => computeGates(r, mktcapRanks.get(r.code) ?? null).length > 0
    );
    const cardByCode = new Map<string, CardStock>(
      ((popularCardsData.ranking ?? []) as CardStock[]).map((c) => [c.code, c])
    );
    const newSections = new Map<StateLabel, PullbackItem[]>(
      STATE_CONFIG.map((s) => [s.label, [] as PullbackItem[]])
    );
    for (const row of base) {
      const card = cardByCode.get(row.code);
      if (!card) continue;
      newSections.get(classify(row))!.push({ row, card });
    }
    for (const items of newSections.values()) {
      items.sort((a, b) => (b.row.turnover_50 ?? 0) - (a.row.turnover_50 ?? 0));
    }

    const result: DateData = {
      rows: newRows,
      shRows: newShRows,
      meta: cardsData._meta ?? null,
      pullbackSections: newSections,
      pullbackMeta: popularData._meta ?? null,
    };
    cacheRef.current.set(date, result);
    setOverride({ date, data: result });
  }, []);

  // selectedDate 変化: URL更新 + フェッチ
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (selectedDate) {
      params.set("date", selectedDate);
    } else {
      params.delete("date");
    }
    const qs = params.toString();
    window.history.replaceState(null, "", qs ? `?${qs}` : window.location.pathname);

    if (selectedDate) {
      fetchDateData(selectedDate).catch(console.error);
    }
  }, [selectedDate, fetchDateData]);

  // overrideが現在の選択日に対応していればそちら、なければ props を使う
  const d = selectedDate && override?.date === selectedDate ? override.data : null;
  const activeRows = d ? d.rows : rows;
  const activeShRows = d ? d.shRows : shRows;
  const activeMeta = d ? d.meta : meta;
  const activePullbackSections = d ? d.pullbackSections : pullbackSections;
  const activePullbackMeta = d ? d.pullbackMeta : pullbackMeta;

  const displayRows = mode === "turnover" ? activeRows : mode === "stophigh" ? activeShRows ?? [] : [];
  const pullbackTotal = [...activePullbackSections.values()].reduce((sum, items) => sum + items.length, 0);
  const headerDate = mode === "pullback" ? activePullbackMeta?.date : activeMeta?.date;

  return (
    <div className="p-3">
      {/* ヘッダー */}
      <div
        style={{
          fontFamily: "'Inter', 'Helvetica Neue', Arial, sans-serif",
          marginBottom: 12,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            fontSize: 11,
            color: "#707A8A",
            fontVariantNumeric: "tabular-nums",
            letterSpacing: "0.01em",
            marginBottom: pullbackDescOpen ? 4 : 8,
          }}
        >
          {headerDate}
          <span style={{ margin: "0 4px" }}>·</span>
          <span style={{ fontWeight: 600 }}>
            {mode === "turnover"
              ? "TOP30"
              : mode === "pullback"
                ? `${pullbackTotal}件`
                : `${displayRows.length}件`}
          </span>
          {mode === "pullback" && (
            <button
              type="button"
              onClick={() => setPullbackDescOpen((o) => !o)}
              aria-expanded={pullbackDescOpen}
              aria-label="説明を表示"
              style={{
                padding: 2,
                marginLeft: 2,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: "transparent",
                border: "none",
                flexShrink: 0,
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="#707A8A">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 17h-2v-2h2v2zm2.07-7.75-.9.92C13.45 12.9 13 13.5 13 15h-2v-.5c0-1.1.45-2.1 1.17-2.83l1.24-1.26c.37-.36.59-.86.59-1.41 0-1.1-.9-2-2-2s-2 .9-2 2H8c0-2.21 1.79-4 4-4s4 1.79 4 4c0 .88-.36 1.68-.93 2.25z" />
              </svg>
            </button>
          )}
          <DateSelector
            availableDates={availableDates}
            selectedDate={selectedDate}
            onChange={setSelectedDate}
          />
        </div>
        {mode === "pullback" && pullbackDescOpen && (
          <p
            className="text-[11px] leading-5 whitespace-pre-line"
            style={{ color: "#9CA3AF", marginBottom: 8 }}
          >
            {
              "直近50日間で売買が活況な銘柄（回転率5%以上）を、異なる時間軸の騰落率と突き合わせて状態分類しています。\n\n「継続／初動・再加速／短期押し目／調整／調整予備軍／中立帯／失速」などの状態に振り分け、押し目・拾い場の候補を状態別に並べています。"
            }
          </p>
        )}
        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={() => setMode("pullback")}
            style={{
              flex: 1,
              padding: "9px 0",
              borderRadius: 9999,
              fontFamily: "ui-monospace, monospace",
              fontVariantNumeric: "tabular-nums",
              fontSize: 14,
              textAlign: "center",
              transition: "background 0.15s, color 0.15s, border-color 0.15s",
              background: mode === "pullback" ? "#3c4043" : "#282a2d",
              border: `1px solid ${mode === "pullback" ? "#5f6368" : "#3c4043"}`,
              color: mode === "pullback" ? "#e8eaed" : "#8e8e93",
              fontWeight: mode === "pullback" ? 600 : 500,
            }}
          >
            PickUP
          </button>
          <button
            onClick={() => setMode("turnover")}
            style={{
              flex: 1,
              padding: "9px 0",
              borderRadius: 9999,
              fontFamily: "ui-monospace, monospace",
              fontVariantNumeric: "tabular-nums",
              fontSize: 14,
              textAlign: "center",
              transition: "background 0.15s, color 0.15s, border-color 0.15s",
              background: mode === "turnover" ? "#3c4043" : "#282a2d",
              border: `1px solid ${mode === "turnover" ? "#5f6368" : "#3c4043"}`,
              color: mode === "turnover" ? "#e8eaed" : "#8e8e93",
              fontWeight: mode === "turnover" ? 600 : 500,
            }}
          >
            回転率
          </button>
          <button
            onClick={() => setMode("stophigh")}
            style={{
              flex: 1,
              padding: "9px 0",
              borderRadius: 9999,
              fontFamily: "ui-monospace, monospace",
              fontVariantNumeric: "tabular-nums",
              fontSize: 14,
              textAlign: "center",
              transition: "background 0.15s, color 0.15s, border-color 0.15s",
              background: mode === "stophigh" ? "#3c4043" : "#282a2d",
              border: `1px solid ${mode === "stophigh" ? "#5f6368" : "#3c4043"}`,
              color: mode === "stophigh" ? "#e8eaed" : "#8e8e93",
              fontWeight: mode === "stophigh" ? 600 : 500,
            }}
          >
            S高
          </button>
        </div>
      </div>

      {mode === "pullback" ? (
        <>
          {STATE_CONFIG.map(({ label, headerBg }) => {
            const items = activePullbackSections.get(label) ?? [];
            if (items.length === 0) return null;
            return (
              <div key={label} className="mb-4">
                <div
                  className={`py-1 ${headerBg} text-white text-xs font-bold flex items-center gap-2 rounded-t`}
                  style={{ paddingLeft: 10, paddingRight: 10 }}
                >
                  <span>{label}</span>
                  <span className="font-normal text-[10px] opacity-80">{items.length} 件</span>
                </div>
                {items.map((item) => (
                  <LazyCard key={item.row.code} item={item} label={label} headerBg={headerBg} />
                ))}
              </div>
            );
          })}
        </>
      ) : (
        <>
          <div style={{ marginBottom: 8, display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <ExportMenu codes={displayRows.map((r) => r.code)} />
          </div>
          <TurnoverCardList stocks={displayRows} />
        </>
      )}

      {excluded.length > 0 && (
        <div className="mt-8 pt-4 border-t border-gray-200">
          <p className="text-xs font-medium text-gray-500 mb-1">
            除外銘柄（手動）
          </p>
          <p className="text-[10px] text-gray-400 mb-2">
            以下は構造的ノイズとして一覧から除外中
          </p>
          {excluded.map((e) => (
            <div key={e.code} className="text-[10px] text-gray-400 leading-5">
              {e.code} {e.name} ― {e.reason}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
