// 画像まとめ出力: グリッドレイアウト計算・チャンク分割・キャンバス合成の純粋関数群

// 生成側(ImageSummaryExport.tsx)と表示側(/export)で共有するBroadcastChannel名・メッセージ型。
export const EXPORT_CHANNEL_NAME = "image-summary-export";
export type ExportChannelMessage = {
  title: string;
  label: string;
  pages: Blob[];
};

// 固定: 横3列×縦5行・1枚あたり最大15銘柄。16件以上は15件ごとに複数枚へ分割する。
const GRID_COLS = 3;
const GRID_ROWS = 5;
export const CHUNK_SIZE = GRID_COLS * GRID_ROWS;

// キャプチャした各カード画像はグリッド配置時にこの倍率へ縮小する
// (個別画面と同一DOMをそのままキャプチャするため、文字サイズは画像全体を縮小することで釣り合いを取る)
const GRID_SCALE = 0.6;

export function chunkArray<T>(items: T[], size: number = CHUNK_SIZE): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

/** タブ種別ごとのファイル名接頭辞(例: "stophigh_summary", "turnover_summary")を渡す */
export function buildFilename(
  filenamePrefix: string,
  date: string | undefined,
  pageIndex: number,
  pageCount: number
): string {
  const d = (date ?? new Date().toISOString().slice(0, 10)).replace(/-/g, "");
  return pageCount > 1
    ? `${filenamePrefix}_${d}_${pageIndex + 1}of${pageCount}.png`
    : `${filenamePrefix}_${d}.png`;
}

/** タブ種別ごとのラベル(例: "S高", "回転率")を渡す */
export function buildSubtitle(
  date: string | undefined,
  totalCount: number,
  pageIndex: number,
  pageCount: number,
  label: string
): string {
  const base = `${date ?? ""} ${label} ${totalCount}件`.trim();
  return pageCount > 1 ? `${base} (${pageIndex + 1}/${pageCount})` : base;
}

const MARGIN = 24;
const GAP = 16;
const HEADER_H = 96;
const BG = "#F4F6FB";
const TITLE_COLOR = "#131722";
const SUBTITLE_COLOR = "#707A8A";
const TITLE_FONT = "700 28px 'Inter','Helvetica Neue','Noto Sans JP',Arial,sans-serif";
const SUBTITLE_FONT = "500 16px 'Inter','Helvetica Neue','Noto Sans JP',Arial,sans-serif";

/** キャプチャ済みカードキャンバス群を1枚のグリッド画像に合成する(固定3列×5行、各カードはGRID_SCALEに縮小) */
export function composeGrid(
  cards: HTMLCanvasElement[],
  header: { title: string; subtitle: string }
): HTMLCanvasElement {
  const cols = GRID_COLS;
  const rows = Math.max(1, Math.min(GRID_ROWS, Math.ceil(cards.length / cols)));
  const cardW = Math.round((cards[0]?.width ?? 0) * GRID_SCALE);
  const cardH = Math.round((cards[0]?.height ?? 0) * GRID_SCALE);

  const width = MARGIN * 2 + cols * cardW + (cols - 1) * GAP;
  const height = MARGIN * 2 + HEADER_H + rows * cardH + (rows - 1) * GAP;

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;

  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, width, height);

  ctx.textBaseline = "top";
  ctx.fillStyle = TITLE_COLOR;
  ctx.font = TITLE_FONT;
  ctx.fillText(header.title, MARGIN, MARGIN);

  ctx.fillStyle = SUBTITLE_COLOR;
  ctx.font = SUBTITLE_FONT;
  ctx.fillText(header.subtitle, MARGIN, MARGIN + 40);

  cards.forEach((card, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = MARGIN + col * (cardW + GAP);
    const y = MARGIN + HEADER_H + row * (cardH + GAP);
    ctx.drawImage(card, x, y, cardW, cardH);
  });

  return canvas;
}

export function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), "image/png"));
}
