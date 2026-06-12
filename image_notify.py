"""売買代金ランキング・回転率ランキングをPNG画像で生成する。"""

from __future__ import annotations
import os
import datetime
import tempfile
from PIL import Image, ImageDraw, ImageFont

from scraper import Stock

# ---- カラーパレット ----
C_BG          = (15, 17, 26)
C_HEADER_BG   = (32, 38, 60)
C_ROW_EVEN    = (20, 23, 35)
C_ROW_ODD     = (26, 30, 44)
C_RED_BG      = (65, 12, 12)
C_ORANGE_BG   = (60, 36, 6)
C_TEXT        = (205, 210, 228)
C_HEADER_TEXT = (255, 255, 255)
C_RED_TEXT    = (255, 95, 95)
C_ORANGE_TEXT = (255, 178, 68)
C_GRID        = (38, 44, 66)
C_TITLE       = (120, 165, 255)
C_DIM         = (120, 125, 145)

HIGHLIGHT_RATIO  = 0.10
ORANGE_RATIO     = 0.05
CHANGE_PCT_COL   = 5  # COLS内の「前日比%」列インデックス

# ---- テーブル列定義 (ラベル, 幅px, 寄せ) ----
COLS = [
    ("順位",         40, "r"),
    ("コード",       62, "l"),
    ("銘柄名",      148, "l"),
    ("市場",         56, "l"),
    ("現在値",       78, "r"),
    ("前日比%",      70, "r"),
    ("売買代金(億)", 102, "r"),
    ("時価総額(億)", 108, "r"),
    ("回転率%",      70, "r"),
]

ROW_H     = 27
HEADER_H  = 32
TITLE_H   = 38
PAD_X     = 10
FONT_SIZE = 13


def _find_font(size: int):
    candidates = [
        # Ubuntu (GitHub Actions: apt install fonts-noto-cjk)
        "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
        "/usr/share/fonts/truetype/noto/NotoSansCJKjp-Regular.ttf",
        "/usr/share/fonts/noto-cjk/NotoSansCJKjp-Regular.otf",
        # Windows
        "C:/Windows/Fonts/meiryo.ttc",
        "C:/Windows/Fonts/msgothic.ttc",
        "C:/Windows/Fonts/YuGothM.ttc",
        "C:/Windows/Fonts/YuGothR.ttc",
    ]
    for p in candidates:
        if os.path.exists(p):
            try:
                return ImageFont.truetype(p, size)
            except Exception:
                pass
    return ImageFont.load_default()


def _tw(draw: ImageDraw.ImageDraw, text: str, font) -> int:
    try:
        return int(draw.textlength(text, font=font))
    except Exception:
        return len(text) * (FONT_SIZE // 2 + 2)


def _put(draw, text, x, col_w, y, font, color, align):
    text = str(text)
    # はみ出す場合は末尾を切る
    while len(text) > 1 and _tw(draw, text, font) > col_w - 6:
        text = text[:-1]
    tw = _tw(draw, text, font)
    cell_y = y + max(0, (ROW_H - FONT_SIZE) // 2 - 1)
    if align == "r":
        draw.text((x + col_w - tw - 4, cell_y), text, fill=color, font=font)
    else:
        draw.text((x + 4, cell_y), text, fill=color, font=font)


def _stock_to_vals(s: Stock, rank: int) -> dict:
    tr = s.turnover_ratio
    return {
        "tr": tr,
        "change_pct": s.change_pct,
        "vals": [
            str(rank),
            s.code,
            s.name[:13],
            s.market or "",
            f"{s.price:,.0f}" if s.price else "-",
            f"{s.change_pct:+.2f}%" if s.change_pct is not None else "-",
            f"{s.turnover_oku:,.0f}" if s.turnover_oku else "-",
            f"{s.mktcap_oku:,.0f}" if s.mktcap_oku else "-",
            f"{tr*100:.1f}%" if tr else "-",
        ],
    }


def _draw_table(title: str, rows: list[dict]) -> Image.Image:
    font = _find_font(FONT_SIZE)
    total_w = sum(c[1] for c in COLS) + PAD_X * 2
    total_h = TITLE_H + HEADER_H + ROW_H * len(rows) + 6

    img = Image.new("RGB", (total_w, total_h), C_BG)
    draw = ImageDraw.Draw(img)

    # タイトル
    draw.text((PAD_X, 8), title, fill=C_TITLE, font=font)
    y = TITLE_H

    # ヘッダー行
    draw.rectangle([0, y, total_w, y + HEADER_H], fill=C_HEADER_BG)
    x = PAD_X
    for label, col_w, _ in COLS:
        tw = _tw(draw, label, font)
        draw.text((x + max(0, (col_w - tw) // 2), y + 8), label, fill=C_HEADER_TEXT, font=font)
        x += col_w
    draw.line([0, y + HEADER_H - 1, total_w, y + HEADER_H - 1], fill=C_GRID)
    y += HEADER_H

    # データ行
    for i, row in enumerate(rows):
        tr = row["tr"] or 0
        cp = row.get("change_pct")
        highlighted = tr >= ORANGE_RATIO

        if tr >= HIGHLIGHT_RATIO:
            bg, tc = C_RED_BG, C_RED_TEXT
        elif tr >= ORANGE_RATIO:
            bg, tc = C_ORANGE_BG, C_ORANGE_TEXT
        else:
            bg = C_ROW_EVEN if i % 2 == 0 else C_ROW_ODD
            tc = C_TEXT

        draw.rectangle([0, y, total_w, y + ROW_H], fill=bg)
        x = PAD_X
        for j, (_, col_w, align) in enumerate(COLS):
            if j == CHANGE_PCT_COL and cp is not None:
                # 上昇=赤、下落=緑。強調行(赤/橙背景)では薄い色で視認性を確保
                if cp > 0:
                    cell_color = (255, 180, 180) if highlighted else (255, 90, 90)
                elif cp < 0:
                    cell_color = (130, 255, 190) if highlighted else (70, 210, 130)
                else:
                    cell_color = C_DIM
            else:
                cell_color = tc
            _put(draw, row["vals"][j], x, col_w, y, font, cell_color, align)
            x += col_w
        draw.line([0, y + ROW_H - 1, total_w, y + ROW_H - 1], fill=C_GRID)
        y += ROW_H

    return img


def make_ranking_image(stocks: list[Stock]) -> str:
    """売買代金ランキング順（全銘柄）の画像を生成し、パスを返す。"""
    today = datetime.date.today().strftime("%Y/%m/%d")
    title = f"売買代金ランキング  {today}    赤=回転率10%超  橙=回転率5%超"
    rows = [_stock_to_vals(s, s.rank) for s in stocks]
    img = _draw_table(title, rows)
    path = os.path.join(tempfile.gettempdir(), "ranking.png")
    img.save(path, "PNG")
    return path


def make_turnover_image(stocks: list[Stock]) -> str | None:
    """回転率5%以上を回転率順に並べた画像を生成し、パスを返す。なければ None。"""
    filtered = sorted(
        [s for s in stocks if s.turnover_ratio and s.turnover_ratio >= ORANGE_RATIO],
        key=lambda s: s.turnover_ratio,
        reverse=True,
    )
    if not filtered:
        return None
    today = datetime.date.today().strftime("%Y/%m/%d")
    title = f"回転率ランキング（5%以上）  {today}    赤=10%超  橙=5%超"
    rows = [_stock_to_vals(s, i + 1) for i, s in enumerate(filtered)]
    img = _draw_table(title, rows)
    path = os.path.join(tempfile.gettempdir(), "turnover.png")
    img.save(path, "PNG")
    return path
