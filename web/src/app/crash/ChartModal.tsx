"use client";
import { useEffect, useMemo, useState } from "react";
import ChartCard, { type ChartData, type ChartExtraMarker } from "@/components/ChartCard";
import type { CrashPhaseInfo } from "./CrashClient";

const monoFont = '"SF Mono",SFMono-Regular,ui-monospace,"Roboto Mono",Menlo,Consolas,monospace';
const PHASE_START_COLOR = "#E03A2F"; // 局面開始日: 目立つ赤系
const CRASH_TRIGGER_COLOR = "#F5A623"; // 暴落トリガー日(型A): オレンジ系

function buildPhaseMarkers(phase: CrashPhaseInfo | null): ChartExtraMarker[] {
  if (!phase) return [];
  const markers: ChartExtraMarker[] = [
    { date: phase.start, color: PHASE_START_COLOR, shape: "arrowDown", size: 1, text: "暴落開始" },
  ];
  for (const d of phase.crash_days ?? []) {
    markers.push({ date: d, color: CRASH_TRIGGER_COLOR, shape: "arrowDown", size: 0.6 });
  }
  return markers;
}

// 判断ログ(Phase4): フルスクリーンオーバーレイの実装は本リポジトリの
// ImageSummaryExport.tsx(ImageSummaryOverlay)の position:fixed; inset:0 方式を
// 踏襲した。同コンポーネントのコメントに「iOS Safariでの別タブ/BroadcastChannel/
// localStorageいずれの受け渡しも実機で問題が確認されたため、window.openを一切使わず
// 同一タブ内のオーバーレイで完結させる方式にした」とあり、iOS Safari対応実績がある
// パターンのため流用した(コンポーネント自体は画像結果表示専用の作りのため、
// パターンのみ踏襲し新規コンポーネントとして実装)。
export default function ChartModal({
  code, phase, onClose,
}: { code: string; phase: CrashPhaseInfo | null; onClose: () => void }) {
  // 判断ログ: DataTab(react-hooks/set-state-in-effect対策)と同じパターン。
  // effect本体でsetStateを同期的に呼ばず、fetchのthen/catch内に収める。
  // loadingは「fetch済みのcodeと表示対象のcodeが一致しているか」から導出する。
  const [fetchedCode, setFetchedCode] = useState<string | null>(null);
  const [data, setData] = useState<ChartData | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`/chart-data/${code}.json`)
      .then((r) => {
        if (!r.ok) throw new Error("not found");
        return r.json();
      })
      .then((d: ChartData) => {
        if (cancelled) return;
        setData(d);
        setError(false);
        setFetchedCode(code);
      })
      .catch(() => {
        if (cancelled) return;
        setData(null);
        setError(true);
        setFetchedCode(code);
      });
    return () => {
      cancelled = true;
    };
  }, [code]);

  const loading = fetchedCode !== code;

  const extraMarkers = useMemo(() => buildPhaseMarkers(phase), [phase]);

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.65)",
        zIndex: 500,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
        overflowY: "auto",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ width: "100%", maxWidth: 480 }}
      >
        {!loading && data ? (
          <ChartCard data={data} extraMarkers={extraMarkers} />
        ) : !loading && error ? (
          <div
            style={{
              height: 278,
              background: "#FFFFFF",
              border: "1px solid #DDE1EC",
              borderRadius: 4,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#9098A9",
              fontSize: 13,
              fontFamily: monoFont,
            }}
          >
            チャートデータなし
          </div>
        ) : (
          <div
            style={{
              height: 278,
              background: "#F4F6FB",
              border: "1px solid #DDE1EC",
              borderRadius: 4,
            }}
          />
        )}
      </div>
      <button
        type="button"
        onClick={onClose}
        aria-label="閉じる"
        style={{
          position: "fixed",
          top: 12,
          right: 12,
          zIndex: 501,
          width: 36,
          height: 36,
          borderRadius: "50%",
          border: "none",
          background: "#2c2c2e",
          color: "#e8eaed",
          fontSize: 18,
          lineHeight: "36px",
          textAlign: "center",
          cursor: "pointer",
          boxShadow: "0 2px 8px rgba(0,0,0,0.3)",
        }}
      >
        ×
      </button>
    </div>
  );
}
