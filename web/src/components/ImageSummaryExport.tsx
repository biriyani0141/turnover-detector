"use client";
import { useCallback, useState } from "react";
import { createRoot } from "react-dom/client";
import { snapdom } from "@zumer/snapdom";
import React from "react";
import TurnoverCard, { type CardStock } from "./TurnoverCard";
import { chunkArray, composeGrid, buildSubtitle } from "@/lib/cardGridExport";

const CARD_WIDTH = 380;
// カード自然高(height指定なし時のoffsetHeight)をS高タブ9件・回転率タブTOP30件で実測した結果、
// 最大値はいずれもイノバセル/アイズ相当の421pxだった(本文ブロック+開示リストの上限DISCLOSURE_HEIGHT_CAP
// によって実質的な上限が揃うため、両タブで最大値が一致する)。この421pxに微小マージンを足した値を
// 全カード共通の固定高さとする(全カード統一のため、最も背の高いカードが見切れない下限に設定)。
// 補足欄の超過時の省略記号「…」はCSSのline-clampに任せず、TurnoverCard側で実DOM計測による
// 手動付与に切り替えている(snapdomキャプチャ時にline-clampの省略記号が描画されないことが
// あったため)。カード全体の高さ統一はこの外側ラッパーの固定height+overflow:hiddenのみで行う
const CARD_CLIP_HEIGHT = 430;

function waitTwoFrames(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

async function captureCards(
  stocks: CardStock[],
  onProgress?: (done: number, total: number) => void
): Promise<HTMLCanvasElement[]> {
  const host = document.createElement("div");
  host.style.position = "fixed";
  host.style.left = "-10000px";
  host.style.top = "0";
  host.style.width = `${CARD_WIDTH}px`;
  host.style.zIndex = "-1";
  document.body.appendChild(host);

  const root = createRoot(host);
  const refs: (HTMLDivElement | null)[] = new Array(stocks.length).fill(null);

  await new Promise<void>((resolve) => {
    root.render(
      React.createElement(
        React.Fragment,
        null,
        stocks.map((s, i) =>
          React.createElement(
            "div",
            {
              key: s.code,
              style: { width: CARD_WIDTH, height: CARD_CLIP_HEIGHT, overflow: "hidden" },
              ref: (el: HTMLDivElement | null) => {
                refs[i] = el;
              },
            },
            React.createElement(TurnoverCard, { stock: s, compact: true })
          )
        )
      )
    );
    waitTwoFrames().then(resolve);
  });

  const canvases: HTMLCanvasElement[] = [];
  for (let i = 0; i < refs.length; i++) {
    const el = refs[i];
    if (el) {
      // html2canvasはCJKテキストのベースライン計算が実ブラウザと異なりズレていたため、
      // SVG foreignObjectベース(実ブラウザのレンダリング結果をそのまま使う)のsnapdomに置き換え。
      // dprは実行環境のdevicePixelRatioに関係なく常に2倍出力になるようここで明示指定する
      // (toCanvas側のscaleオプションと二重にかけると4倍になってしまうため使わない)
      const result = await snapdom(el, { backgroundColor: "#FFFFFF", dpr: 2 });
      const canvas = await result.toCanvas();
      canvases.push(canvas);
    }
    onProgress?.(i + 1, refs.length);
  }

  root.unmount();
  document.body.removeChild(host);

  return canvases;
}

export type ImageSummaryOptions = {
  /** グリッド画像左上に表示するタイトル(例: "今日のストップ高", "回転率TOP30") */
  title: string;
  /** サブタイトルに使うタブ種別ラベル(例: "S高", "回転率") */
  label: string;
};

type ImageSummaryResult = {
  title: string;
  /** ページごとのblob URL。1枚に合成連結せず、各ページを独立したimgとして描画する(長押し保存可)。 */
  pages: string[];
};

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), "image/png"));
}

export function useImageSummaryExport() {
  const [generating, setGenerating] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = useState<ImageSummaryResult | null>(null);

  const run = useCallback(
    async (stocks: CardStock[], date: string | undefined, options: ImageSummaryOptions) => {
      if (generating || stocks.length === 0) return;

      // iOS Safariでの別タブ/BroadcastChannel/localStorageいずれの受け渡しも実機で問題が
      // 確認されたため、window.openを一切使わず同一タブ内のオーバーレイ(ImageSummaryOverlay)で
      // 完結させる方式にした。
      setGenerating(true);
      setProgress({ done: 0, total: stocks.length });
      try {
        const cardCanvases = await captureCards(stocks, (done, total) => setProgress({ done, total }));
        const chunks = chunkArray(cardCanvases);
        const pages: string[] = [];
        for (let i = 0; i < chunks.length; i++) {
          const composite = composeGrid(chunks[i], {
            title: options.title,
            subtitle: buildSubtitle(date, stocks.length, i, chunks.length, options.label),
          });
          const blob = await canvasToBlob(composite);
          if (blob) pages.push(URL.createObjectURL(blob));
        }
        setResult({ title: options.title, pages });
      } finally {
        setGenerating(false);
        setProgress(null);
      }
    },
    [generating]
  );

  const closeResult = useCallback(() => {
    setResult((prev) => {
      prev?.pages.forEach((url) => URL.revokeObjectURL(url));
      return null;
    });
  }, []);

  return { run, generating, progress, result, closeResult };
}

/** 出力中/出力結果を同一タブ内のフルスクリーンオーバーレイで表示する。PickupClient側で描画する。 */
export function ImageSummaryOverlay({
  generating,
  progress,
  result,
  onClose,
}: {
  generating: boolean;
  progress: { done: number; total: number } | null;
  result: { title: string; pages: string[] } | null;
  onClose: () => void;
}) {
  if (!generating && !result) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "#F4F6FB",
        zIndex: 400,
        overflowY: "auto",
      }}
    >
      {result && (
        <button
          type="button"
          onClick={onClose}
          aria-label="閉じる"
          style={{
            position: "fixed",
            top: 12,
            right: 12,
            zIndex: 401,
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
      )}

      {result ? (
        result.pages.map((url, i) => (
          <img
            key={url}
            src={url}
            alt={`${result.title} ${i + 1}`}
            style={{ display: "block", width: "100%" }}
          />
        ))
      ) : (
        <div
          style={{
            minHeight: "100vh",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontFamily: "ui-monospace, monospace",
            fontSize: 13,
            color: "#707A8A",
          }}
        >
          画像生成中… {progress ? `${progress.done}/${progress.total}` : ""}
        </div>
      )}
    </div>
  );
}
