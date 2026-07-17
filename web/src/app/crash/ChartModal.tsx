"use client";
import { useEffect, useMemo, useState } from "react";
import ChartCard, { type ChartData, type ChartPhaseAnnotation } from "@/components/ChartCard";
import type { CrashPhaseInfo } from "./CrashClient";

const monoFont = '"SF Mono",SFMono-Regular,ui-monospace,"Roboto Mono",Menlo,Consolas,monospace';

// 判断ログ(crashチャートUI変更): 従来は局面開始日に赤矢印+「暴落開始」文字、
// 暴落日ごとにオレンジ矢印を立てていたが、矢印+文字はローソク足と重なり視認性が
// 悪かったため、開始日は赤の縦点線、暴落日は背景の薄いグレー帯に置き換えた
// (ChartCard.tsxのphaseAnnotation prop、実体はChartPhasePrimitive)。
function buildPhaseAnnotation(phase: CrashPhaseInfo | null): ChartPhaseAnnotation | undefined {
  if (!phase) return undefined;
  return { startDate: phase.start, bandDates: phase.crash_days ?? [] };
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

  const phaseAnnotation = useMemo(() => buildPhaseAnnotation(phase), [phase]);

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
          <ChartCard data={data} phaseAnnotation={phaseAnnotation} />
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
          // 判断ログ(タスク7): apple-mobile-web-app-capable + status-bar-style
          // black-translucent(layout.tsx)構成のPWAでは、ホーム画面起動時に
          // ステータスバー/ノッチ領域がWebコンテンツに重なり、top:12px固定の
          // ボタンがその下に隠れてタップ不能になる既知の問題がある。
          // env(safe-area-inset-top)で安全領域分オフセットする(非対応環境では
          // envが0扱いになりmax()で12pxにフォールバックするため無害)。
          top: "max(12px, env(safe-area-inset-top, 12px))",
          right: "max(12px, env(safe-area-inset-right, 12px))",
          zIndex: 501,
          width: 44,
          height: 44,
          borderRadius: "50%",
          border: "none",
          background: "#2c2c2e",
          color: "#e8eaed",
          fontSize: 20,
          lineHeight: "44px",
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
