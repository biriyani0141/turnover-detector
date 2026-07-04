"use client";
import { useCallback, useState } from "react";
import { createRoot } from "react-dom/client";
import { snapdom } from "@zumer/snapdom";
import React from "react";
import TurnoverCard, { type CardStock } from "./TurnoverCard";
import { chunkArray, composeGrid, buildSubtitle, buildFilename, canvasToBlob } from "@/lib/cardGridExport";

const CARD_WIDTH = 380;
// 補足欄(本文+開示情報)の高さはTurnoverCard側で内容に応じて自然に伸縮するため、ここは
// 上回りすぎないための安全上限(maxHeight)としてのみ使う。カードごとの実際の高さは内容に
// 応じて可変になり、グリッド合成側(composeGrid)で行ごとの最大高さに合わせて配置する。
const CARD_CLIP_HEIGHT = 480;

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
              style: { width: CARD_WIDTH, maxHeight: CARD_CLIP_HEIGHT, overflow: "hidden" },
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

function downloadCanvas(canvas: HTMLCanvasElement, filename: string): Promise<void> {
  return canvasToBlob(canvas).then((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  });
}

export function useImageSummaryExport() {
  const [generating, setGenerating] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  const run = useCallback(async (stocks: CardStock[], date: string | undefined) => {
    if (generating || stocks.length === 0) return;
    setGenerating(true);
    setProgress({ done: 0, total: stocks.length });
    try {
      const cardCanvases = await captureCards(stocks, (done, total) => setProgress({ done, total }));
      const chunks = chunkArray(cardCanvases);
      for (let i = 0; i < chunks.length; i++) {
        const composite = composeGrid(chunks[i], {
          title: "今日のストップ高",
          subtitle: buildSubtitle(date, stocks.length, i, chunks.length),
        });
        await downloadCanvas(composite, buildFilename(date, i, chunks.length));
      }
    } finally {
      setGenerating(false);
      setProgress(null);
    }
  }, [generating]);

  return { run, generating, progress };
}
