"use client";
import { useCallback, useState } from "react";
import { createRoot } from "react-dom/client";
import { snapdom } from "@zumer/snapdom";
import React from "react";
import TurnoverCard, { type CardStock } from "./TurnoverCard";
import { chunkArray, composeGrid, buildSubtitle, canvasToBlob } from "@/lib/cardGridExport";

const CARD_WIDTH = 380;
// メインカード(278px)+補足欄マージン(6px)+補足欄の最大高さ(本文ブロック:タグ+4行分で約91px、
// 開示情報ブロック:区切り線+5行分で約93px、開示情報がある場合は合計約184px)を上回る値。
// 補足欄の超過時の省略記号「…」はCSSのline-clampに任せず、TurnoverCard側で実DOM計測による
// 手動付与に切り替えている(snapdomキャプチャ時にline-clampの省略記号が描画されないことが
// あったため)。カード全体の高さ統一はこの外側ラッパーの固定height+overflow:hiddenのみで行う
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

export function useImageSummaryExport() {
  const [generating, setGenerating] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  const run = useCallback(
    async (stocks: CardStock[], date: string | undefined, options: ImageSummaryOptions) => {
      if (generating || stocks.length === 0) return;

      // ユーザー操作の同期コールスタック内でタブを1回だけ開く。複数ページ分もこの1つのタブに
      // 後からまとめて流し込むため、window.openはここで一度きりにする(iOS Safari等は非同期処理を
      // 挟んだ後のwindow.openや、同期スタック内であっても複数回のwindow.openを
      // ブロックすることがあるため)。
      const win = window.open("about:blank", "_blank");

      setGenerating(true);
      setProgress({ done: 0, total: stocks.length });
      try {
        const cardCanvases = await captureCards(stocks, (done, total) => setProgress({ done, total }));
        const chunks = chunkArray(cardCanvases);
        const urls: string[] = [];
        for (let i = 0; i < chunks.length; i++) {
          const composite = composeGrid(chunks[i], {
            title: options.title,
            subtitle: buildSubtitle(date, stocks.length, i, chunks.length, options.label),
          });
          const blob = await canvasToBlob(composite);
          if (blob) urls.push(URL.createObjectURL(blob));
        }

        if (win) {
          // 1枚のcanvasに合成連結せず、ページごとのblob URLをimgとして縦に並べるだけの軽量HTMLを
          // 書き込む。iOS Safariでの長押し保存はimg要素単位で効くため、ページごとに個別保存できる。
          // 既に開いてあるタブに書き込むためdocument.write方式を採用した(blob HTMLをlocationに
          // 代入する方式だと新規ナビゲーションが発生し、遷移先のタイミングによっては真っ白のまま
          // 表示が完了しない挙動を確認したため)。
          const imgTags = urls
            .map((url) => `<img src="${url}" style="display:block;width:100%;">`)
            .join("");
          win.document.open();
          win.document.write(
            `<!doctype html><html><head><meta charset="utf-8"><title>${options.title}</title>` +
              `<meta name="viewport" content="width=device-width,initial-scale=1"></head>` +
              `<body style="margin:0;background:#F4F6FB;">${imgTags}</body></html>`
          );
          win.document.close();
        }

        // 別タブ側の画像読み込みが終わる前にrevokeすると表示に失敗するため、猶予を持たせて解放する。
        for (const url of urls) {
          setTimeout(() => URL.revokeObjectURL(url), 60_000);
        }
      } finally {
        setGenerating(false);
        setProgress(null);
      }
    },
    [generating]
  );

  return { run, generating, progress };
}
