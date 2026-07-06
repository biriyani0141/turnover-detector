"use client";
import { useEffect, useRef, useState, useCallback } from "react";
import TurnoverCard, { type CardStock } from "../components/TurnoverCard";
import TurnoverCardList from "../components/TurnoverCardList";
import { Row, StateLabel, STATE_CONFIG, classify, computeMktcapRanks, computeGates } from "@/lib/classify";
import ExportMenu from "../components/ExportMenu";
import StopHighDetailSheet from "../components/StopHighDetailSheet";
import { useImageSummaryExport, ImageSummaryOverlay } from "../components/ImageSummaryExport";
import { useHeader } from "./_components/HeaderContext";

const LAZY_CHART = true;

// 信用区分の表示ラベルへのマッピング（page.tsxのcreditType join処理と同一内容）
const CREDIT_LABEL: Record<string, string> = {
  "貸借銘柄": "貸借",
  "制度信用銘柄": "信用",
  // "非制度信用銘柄" は表示しない
};

// jquants_ranking.py の DISCLOSURE_TITLE_EXCLUDE と同一内容(表示用に複製)
const DISCLOSURE_TITLE_EXCLUDE = [
  "第三者割当",
  "定款",
  "独立役員届出書",
  "新株予約権",
  "コーポレートガバナンスに関する報告書",
  "コーポレート・ガバナンスに関する報告書",
  "インタビュー",
  "支配株主等に関する事項について",
  "補足説明資料",
  "役員人事",
];

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

const PULLBACK_DESCRIPTION =
  "直近50日間で売買が活況な銘柄（回転率5%以上）を、異なる時間軸の騰落率と突き合わせて状態分類しています。\n\n「継続／初動・再加速／短期押し目／調整／調整予備軍／中立帯／失速」などの状態に振り分け、押し目・拾い場の候補を状態別に並べています。";

export default function PickupClient({
  rows,
  shRows,
  meta,
  excluded,
  pullbackSections,
  pullbackMeta,
  mode,
}: {
  rows: CardStock[];
  shRows: CardStock[];
  meta: { date?: string } | null;
  excluded: Excluded[];
  pullbackSections: Map<StateLabel, PullbackItem[]>;
  pullbackMeta: { date?: string } | null;
  /** グローバルナビの各カテゴリ("⭐Pickup"のチャート/"🚀S高"/"🔥回転率")に応じて呼び出し元(page.tsx)が固定で渡す。 */
  mode: "turnover" | "stophigh" | "pullback";
}) {
  const [pullbackDescOpen, setPullbackDescOpen] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);
  const [detailStock, setDetailStock] = useState<CardStock | null>(null);
  const imageSummary = useImageSummaryExport();

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
    const [cardsData, popularData, popularCardsData, stophighData, marginData] = await Promise.all([
      fetch(`/data/ranking_cards_${date}.json`).then((r) => r.json()),
      fetch(`/data/popular_${date}.json`).then((r) => r.json()),
      fetch(`/data/popular_cards_${date}.json`).then((r) => r.json()),
      fetch(`/data/stophigh_cards_${date}.json`).then((r) => r.json()),
      fetch("/data/margin_list.json")
        .then((r) => (r.ok ? r.json() : { stocks: {} }))
        .catch(() => ({ stocks: {} })),
    ]);

    const marginStocks: Record<string, string> = marginData.stocks ?? {};

    const newRows: CardStock[] = ((cardsData.ranking ?? []) as CardStock[])
      .filter((r) => !excl.has(r.code))
      .slice(0, 30)
      .map((r) => ({
        ...r,
        creditType: CREDIT_LABEL[marginStocks[r.code.slice(0, 4)]] ?? "-",
      }));

    const newShRows: CardStock[] = ((stophighData.ranking ?? []) as CardStock[]).map((r) => ({
      ...r,
      creditType: CREDIT_LABEL[marginStocks[r.code.slice(0, 4)]] ?? "-",
    }));

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
  const headerCount =
    mode === "turnover" ? "TOP30" : mode === "pullback" ? `${pullbackTotal}件` : `${displayRows.length}件`;

  const toggleDesc = useCallback(() => setPullbackDescOpen((o) => !o), []);

  const setHeader = useHeader();
  useEffect(() => {
    setHeader({
      date: headerDate,
      count: headerCount,
      dateSelector: { availableDates, selectedDate, onChange: setSelectedDate },
      descToggle:
        mode === "pullback"
          ? { open: pullbackDescOpen, onToggle: toggleDesc, description: PULLBACK_DESCRIPTION }
          : undefined,
    });
  }, [headerDate, headerCount, availableDates, selectedDate, mode, pullbackDescOpen, toggleDesc, setHeader]);

  return (
    <div className="p-3" style={{ backgroundColor: "#17171a", paddingTop: mode === "pullback" ? 0 : 4 }}>
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
            <ExportMenu
              codes={displayRows.map((r) => r.code)}
              onImageSummary={
                mode === "stophigh"
                  ? () => imageSummary.run(displayRows, headerDate, { title: "今日のストップ高", label: "S高" })
                  : mode === "turnover"
                    ? () => imageSummary.run(displayRows, headerDate, { title: "回転率TOP30", label: "回転率" })
                    : undefined
              }
            />
          </div>
          <TurnoverCardList
            stocks={displayRows}
            onCardClick={
              mode === "stophigh" || mode === "turnover" ? (stock) => setDetailStock(stock) : undefined
            }
          />

          {(mode === "stophigh" || mode === "turnover") && (
            <div className="mt-6 pt-4 border-t border-gray-200" style={{ marginBottom: "1cm" }}>
              <button
                type="button"
                onClick={() => setNotesOpen((o) => !o)}
                aria-expanded={notesOpen}
                className="text-xs font-medium text-gray-500"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  background: "transparent",
                  border: "none",
                  padding: 0,
                  cursor: "pointer",
                }}
              >
                <span
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: 16,
                    height: 16,
                    background: "#E5E7EB",
                    borderRadius: 3,
                    flexShrink: 0,
                  }}
                >
                  <svg
                    width="9"
                    height="9"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="#6B7280"
                    strokeWidth="3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    style={{
                      transform: notesOpen ? "rotate(90deg)" : "rotate(0deg)",
                      transition: "transform 0.15s",
                    }}
                  >
                    <polyline points="9 6 15 12 9 18" />
                  </svg>
                </span>
                <span>※ 注意事項</span>
              </button>
              {notesOpen && (
                <div className="mt-2">
                  <p className="text-[10px] text-gray-400 mb-1">
                    以下のキーワードを含む開示情報は、理由欄の開示情報表示から除外しています
                  </p>
                  <p className="text-[10px] text-gray-400 leading-5 mb-1">
                    {DISCLOSURE_TITLE_EXCLUDE.join(" / ")}
                  </p>
                  <p className="text-[10px] text-gray-400 leading-5 mb-3">
                    和文記事の英語重複版(タイトルに日本語を含まないもの)も除外しています
                  </p>
                  {excluded.length > 0 && (
                    <>
                      <p className="text-[10px] text-gray-400 mb-1">
                        除外銘柄（手動）: 以下は構造的ノイズとして一覧から除外中
                      </p>
                      {excluded.map((e) => (
                        <div key={e.code} className="text-[10px] text-gray-400 leading-5">
                          {e.code} {e.name} ― {e.reason}
                        </div>
                      ))}
                    </>
                  )}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {excluded.length > 0 && mode !== "stophigh" && mode !== "turnover" && (
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

      <StopHighDetailSheet stock={detailStock} onClose={() => setDetailStock(null)} />

      <ImageSummaryOverlay
        generating={imageSummary.generating}
        progress={imageSummary.progress}
        result={imageSummary.result}
        onClose={imageSummary.closeResult}
      />
    </div>
  );
}
