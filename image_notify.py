"""売買代金ランキング・回転率ランキング・ウォッチリストをPNG画像で生成する。"""

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

HIGHLIGHT_RATIO = 0.10
ORANGE_RATIO    = 0.05
CHANGE_PCT_COL  = 5   # COLS 内の「前日比%」列インデックス

# ---- ランキングテーブル列定義 ----
COLS = [
    ("順位",         40, "r"),
    ("コード",       62, "l"),
    ("銘柄名",      148, "l"),
    ("市場",         56, "l"),
    ("現在値",       78, "r"),
    ("前日比%",      70, "r"),
    ("売買代金(億)", 102, "r"),
    ("代金前日比",    74, "r"),
    ("時価総額(億)", 108, "r"),
    ("回転率%",      70, "r"),
]

# ---- 市場別設定 ----
MARKET_ORDER = [
    ("東証PRM", "プライム"),
    ("東証STD", "スタンダード"),
    ("東証GRT", "グロース"),
]

ROW_H     = 27
HEADER_H  = 32
TITLE_H   = 38
PAD_X     = 10
FONT_SIZE = 13


def _find_font(size: int):
    candidates = [
        "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
        "/usr/share/fonts/truetype/noto/NotoSansCJKjp-Regular.ttf",
        "/usr/share/fonts/noto-cjk/NotoSansCJKjp-Regular.otf",
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
    while len(text) > 1 and _tw(draw, text, font) > col_w - 6:
        text = text[:-1]
    tw = _tw(draw, text, font)
    cell_y = y + max(0, (ROW_H - FONT_SIZE) // 2 - 1)
    if align == "r":
        draw.text((x + col_w - tw - 4, cell_y), text, fill=color, font=font)
    else:
        draw.text((x + 4, cell_y), text, fill=color, font=font)


def _stock_to_vals(s: Stock, rank: int, prev_turnover: float | None = None) -> dict:
    tr = s.turnover_ratio
    if prev_turnover and s.turnover and prev_turnover > 0:
        chg = (s.turnover - prev_turnover) / prev_turnover * 100
        turnover_chg_str = f"{chg:+.0f}%"
    else:
        turnover_chg_str = "-"
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
            turnover_chg_str,
            f"{s.mktcap_oku:,.0f}" if s.mktcap_oku else "-",
            f"{tr*100:.1f}%" if tr else "-",
        ],
    }


SUMMARY_LINE_H = 22  # サマリー行1行の高さ


def _draw_table(title: str, rows: list[dict], cols: list | None = None,
                summary_lines: list[tuple[str, str]] | None = None) -> Image.Image:
    _cols = cols if cols is not None else COLS
    font = _find_font(FONT_SIZE)
    n_summary = len(summary_lines) if summary_lines else 0
    total_w = sum(c[1] for c in _cols) + PAD_X * 2
    total_h = TITLE_H + n_summary * SUMMARY_LINE_H + HEADER_H + ROW_H * len(rows) + 6

    img = Image.new("RGB", (total_w, total_h), C_BG)
    draw = ImageDraw.Draw(img)

    draw.text((PAD_X, 8), title, fill=C_TITLE, font=font)
    y = TITLE_H

    # サマリー行（タイトルとヘッダーの間）
    if summary_lines:
        for s_text, s_color in summary_lines:
            draw.text((PAD_X, y + 4), s_text, fill=s_color, font=font)
            y += SUMMARY_LINE_H

    draw.rectangle([0, y, total_w, y + HEADER_H], fill=C_HEADER_BG)
    x = PAD_X
    for label, col_w, _ in _cols:
        tw = _tw(draw, label, font)
        draw.text((x + max(0, (col_w - tw) // 2), y + 8), label, fill=C_HEADER_TEXT, font=font)
        x += col_w
    draw.line([0, y + HEADER_H - 1, total_w, y + HEADER_H - 1], fill=C_GRID)
    y += HEADER_H

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
        for j, (_, col_w, align) in enumerate(_cols):
            if j == CHANGE_PCT_COL and cp is not None:
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


# ---- ランキング画像 ----

def _make_ranking_part(stocks: list[Stock], title: str,
                       prev_data: dict[str, float] | None, fname: str) -> str:
    rows = [
        _stock_to_vals(s, s.rank, prev_data.get(s.code) if prev_data else None)
        for s in stocks
    ]
    img = _draw_table(title, rows)
    path = os.path.join(tempfile.gettempdir(), fname)
    img.save(path, "PNG")
    return path


def make_ranking_images(stocks: list[Stock],
                        prev_data: dict[str, float] | None = None,
                        summary_lines: list[tuple[str, str]] | None = None) -> tuple[str, str | None]:
    today = datetime.date.today().strftime("%Y/%m/%d")
    legend = "赤=回転率10%超  橙=回転率5%超"

    def _part(part_stocks, label, fname):
        title = f"売買代金ランキング {label}  {today}    {legend}"
        rows = [
            _stock_to_vals(s, s.rank, prev_data.get(s.code) if prev_data else None)
            for s in part_stocks
        ]
        # サマリー行は1枚目のみに付ける
        sl = summary_lines if fname == "ranking_1.png" else None
        img = _draw_table(title, rows, summary_lines=sl)
        path = os.path.join(tempfile.gettempdir(), fname)
        img.save(path, "PNG")
        return path

    path1 = _part(stocks[:50], "1-50位", "ranking_1.png")
    path2 = _part(stocks[50:], "51-100位", "ranking_2.png") if len(stocks) > 50 else None
    return path1, path2


# ---- スタンダード/グロース 売買代金ランキング ----

def make_std_grt_image(std_stocks: list[Stock], grt_stocks: list[Stock],
                       prev_data: dict[str, float] | None = None,
                       summary_lines: list[tuple[str, str]] | None = None) -> str | None:
    """STD上位25位とGRT上位25位を1枚に縦積みした画像を生成してパスを返す。"""
    if not std_stocks and not grt_stocks:
        return None
    today = datetime.date.today().strftime("%Y/%m/%d")
    legend = "赤=回転率10%超  橙=回転率5%超"

    parts: list[Image.Image] = []
    if std_stocks:
        title = f"売買代金ランキング スタンダード上位25位  {today}    {legend}"
        rows = [_stock_to_vals(s, i + 1, prev_data.get(s.code) if prev_data else None)
                for i, s in enumerate(std_stocks)]
        parts.append(_draw_table(title, rows, summary_lines=summary_lines))
    if grt_stocks:
        title = f"売買代金ランキング グロース上位25位  {today}    {legend}"
        rows = [_stock_to_vals(s, i + 1, prev_data.get(s.code) if prev_data else None)
                for i, s in enumerate(grt_stocks)]
        # 2枚目にはサマリー行を付けない
        parts.append(_draw_table(title, rows))

    GAP = 6
    total_w = max(p.width for p in parts)
    total_h = sum(p.height for p in parts) + GAP * (len(parts) - 1)
    combined = Image.new("RGB", (total_w, total_h), C_BG)
    y = 0
    for p in parts:
        combined.paste(p, (0, y))
        y += p.height + GAP

    path = os.path.join(tempfile.gettempdir(), "ranking_std_grt.png")
    combined.save(path, "PNG")
    return path


# ---- 回転率画像（市場別1枚結合） ----

def make_turnover_image(stocks: list[Stock],
                        prev_data: dict[str, float] | None = None) -> str | None:
    """市場別（プライム/スタンダード/グロース）を1枚に縦積みした画像を生成してパスを返す。"""
    filtered = sorted(
        [s for s in stocks if s.turnover_ratio and s.turnover_ratio >= ORANGE_RATIO],
        key=lambda s: s.turnover_ratio,
        reverse=True,
    )
    if not filtered:
        return None
    today = datetime.date.today().strftime("%Y/%m/%d")
    legend = "赤=10%超  橙=5%超"

    parts: list[Image.Image] = []
    for market_code, label in MARKET_ORDER:
        market_stocks = [s for s in filtered if s.market == market_code]
        if not market_stocks:
            continue
        title = f"回転率ランキング {label}（5%以上）  {today}    {legend}"
        rows = [
            _stock_to_vals(s, i + 1, prev_data.get(s.code) if prev_data else None)
            for i, s in enumerate(market_stocks)
        ]
        parts.append(_draw_table(title, rows))

    if not parts:
        return None

    GAP = 6
    total_w = max(p.width for p in parts)
    total_h = sum(p.height for p in parts) + GAP * (len(parts) - 1)
    combined = Image.new("RGB", (total_w, total_h), C_BG)
    y = 0
    for p in parts:
        combined.paste(p, (0, y))
        y += p.height + GAP

    path = os.path.join(tempfile.gettempdir(), "turnover.png")
    combined.save(path, "PNG")
    return path
