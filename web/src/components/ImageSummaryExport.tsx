"use client";
import { useCallback, useState } from "react";
import { createRoot } from "react-dom/client";
import { snapdom } from "@zumer/snapdom";
import React from "react";
import TurnoverCard, { type CardStock } from "./TurnoverCard";
import { chunkArray, composeGrid, buildSubtitle, EXPORT_STORAGE_KEY, type ExportPayload } from "@/lib/cardGridExport";

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

export function useImageSummaryExport() {
  const [generating, setGenerating] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  const run = useCallback(
    async (stocks: CardStock[], date: string | undefined, options: ImageSummaryOptions) => {
      if (generating || stocks.length === 0) return;

      // ユーザー操作の同期コールスタック内で専用Exportページ(/export)を1回だけ開く(iOS Safari等の
      // ポップアップブロック回避)。about:blankの空白タブが見える経路やdocument.write方式はやめ、
      // /export側が自前で「生成中…」を表示しつつ画像データの到着を待つ。
      window.open("/export", "_blank");

      setGenerating(true);
      setProgress({ done: 0, total: stocks.length });
      try {
        const cardCanvases = await captureCards(stocks, (done, total) => setProgress({ done, total }));
        const chunks = chunkArray(cardCanvases);
        // dataURL(base64)化したページ画像をlocalStorageへ書き込む方式。当初BroadcastChannelで
        // 受け渡していたが、iOS Safariで新規タブがバックグラウンド扱いの間はBroadcastChannel/
        // setIntervalが動かず、送ったメッセージを受け取れないまま止まる不具合が実機で確認された。
        // localStorageは書き込んだ時点で永続化されるため、/export側がどのタイミングで確認しても
        // (マウント時・visibilitychange時・storageイベント時のいずれでも)取りこぼさない。
        // S高1ページ/回転率2ページの実測でdataURL化後も5MB以内(最大約2.7MB)に収まることを
        // 確認済みのため、IndexedDBへの切り替えは行っていない。
        const pages: string[] = chunks.map((chunk, i) => {
          const composite = composeGrid(chunk, {
            title: options.title,
            subtitle: buildSubtitle(date, stocks.length, i, chunks.length, options.label),
          });
          return composite.toDataURL("image/png");
        });

        const payload: ExportPayload = { title: options.title, label: options.label, pages };
        localStorage.setItem(EXPORT_STORAGE_KEY, JSON.stringify(payload));
      } finally {
        setGenerating(false);
        setProgress(null);
      }
    },
    [generating]
  );

  return { run, generating, progress };
}
