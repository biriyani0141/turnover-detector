// 画像まとめ出力: グリッドレイアウト計算・チャンク分割・キャンバス合成の純粋関数群

// 固定: 横3列×縦5行・1枚あたり最大15銘柄。16件以上は15件ごとに複数枚へ分割する。
const GRID_COLS = 3;
const GRID_ROWS = 5;
const CHUNK_SIZE = GRID_COLS * GRID_ROWS;

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

export function buildFilename(date: string | undefined, pageIndex: number, pageCount: number): string {
  const d = (date ?? new Date().toISOString().slice(0, 10)).replace(/-/g, "");
  return pageCount > 1
    ? `stophigh_summary_${d}_${pageIndex + 1}of${pageCount}.png`
    : `stophigh_summary_${d}.png`;
}

export function buildSubtitle(
  date: string | undefined,
  totalCount: number,
  pageIndex: number,
  pageCount: number
): string {
  const base = `${date ?? ""} S高 ${totalCount}件`.trim();
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

/**
 * キャプチャ済みカードキャンバス群を1枚のグリッド画像に合成する(固定3列×5行、各カードはGRID_SCALEに縮小)。
 * カードごとの実際の高さ(補足欄の内容量)は可変なので、各カードを引き伸ばさず自身の高さで描画し、
 * 行の高さはその行内で最も高いカードに合わせる(行内の空白は不可避だが、全カード共通の
 * 固定高さにする場合に比べて無駄な余白を大幅に減らせる)。
 */
export function composeGrid(
  cards: HTMLCanvasElement[],
  header: { title: string; subtitle: string }
): HTMLCanvasElement {
  const cols = GRID_COLS;
  const rows = Math.max(1, Math.min(GRID_ROWS, Math.ceil(cards.length / cols)));
  const cardW = Math.round((cards[0]?.width ?? 0) * GRID_SCALE);
  const scaledHeights = cards.map((c) => Math.round(c.height * GRID_SCALE));

  const rowHeights: number[] = [];
  for (let r = 0; r < rows; r++) {
    let maxH = 0;
    for (let c = 0; c < cols; c++) {
      const idx = r * cols + c;
      if (idx < scaledHeights.length) maxH = Math.max(maxH, scaledHeights[idx]);
    }
    rowHeights.push(maxH);
  }
  const cardsHeight = rowHeights.reduce((a, b) => a + b, 0) + (rows - 1) * GAP;

  const width = MARGIN * 2 + cols * cardW + (cols - 1) * GAP;
  const height = MARGIN * 2 + HEADER_H + cardsHeight;

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

  let rowY = MARGIN + HEADER_H;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const idx = r * cols + c;
      if (idx >= cards.length) continue;
      const x = MARGIN + c * (cardW + GAP);
      ctx.drawImage(cards[idx], x, rowY, cardW, scaledHeights[idx]);
    }
    rowY += rowHeights[r] + GAP;
  }

  return canvas;
}

export function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), "image/png"));
}
