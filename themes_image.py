"""
themes_image.py  ―  米テーマ画像生成モジュール（image_notify.py から完全独立）

公開 API:
  fetch_raw()                        → raw API dict（失敗時は例外）
  is_fresh(raw)                      → bool（鮮度判定、FORCE_SEND なし）
  build_themes(raw)                  → (themes, stock_date, updated_at)
  classify(themes)                   → (classified, median_r1)
  make_4class_image(...)             → tmp PNG path
  make_4class_image_from_themes(...) → tmp PNG path（キャッシュフォールバック用）
  make_rank_image(...)               → tmp PNG path
  get_themes_image()                 → (path, stock_date, updated_at)
  get_themes_rank_image(period)      → (path, stock_date, updated_at)
"""
from __future__ import annotations
import os, datetime, statistics, tempfile, requests
from PIL import Image, ImageDraw, ImageFont

# ── API ───────────────────────────────────────────────────────────────────────
_API_URL = "https://stock-themes.com/api/theme-ranking?force_reload=1"
_API_HEADERS = {
    "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15",
    "Referer":    "https://stock-themes.com/",
    "Accept":     "application/json",
}
_PERIOD_MAP = {
    "1日": "return_1d", "5日": "return_5d", "10日": "return_10d",
    "1ヶ月": "return_1m", "2ヶ月": "return_2m", "3ヶ月": "return_3m",
    "半年": "return_6m", "1年": "return_1y",
}

# ── 分類パラメータ（classify_themes.py と同値） ───────────────────────────────
_P = {
    "r1_adj_strong": 1.5, "r1_raw_floor": 1.0, "r21_trend": 8.0,
    "r5_accel": 5.0,      "r5_fresh_max": 3.0, "r5_stall_max": 1.0,
    "r1_adj_weak": -1.0,
}
BUCKET_ORDER   = ["加速中", "継続強", "新規点火", "失速"]
MAX_PER_BUCKET = 5

# ── 配色 ──────────────────────────────────────────────────────────────────────
_C = dict(
    BG=(15,17,26), HDR_BG=(32,38,60), EVEN=(20,23,35), ODD=(26,30,44),
    TEXT=(205,210,228), HDR_TXT=(255,255,255), GRID=(38,44,66),
    TITLE=(120,165,255), DIM=(110,115,135),
    UP=(255,90,90), DOWN=(80,210,140), OVERHEAT=(255,178,68),
)
_BUCKET_COLOR = {
    "加速中":   ((30,100,60),  (180,255,180)),
    "継続強":   ((20,60,140),  (180,210,255)),
    "新規点火": ((110,70,0),   (255,210,120)),
    "失速":     ((110,20,20),  (255,160,160)),
}

# ── テーブル列 ────────────────────────────────────────────────────────────────
_COLS_4C = [
    ("大テーマ > テーマ", 250, "l"),
    ("1日%",  62, "r"), ("5日%",  62, "r"), ("1ヶ月%", 66, "r"),
    ("3ヶ月%", 66, "r"), ("1年%",  66, "r"), ("牽引",  155, "l"),
]
_COLS_RANK = [
    ("順",  36, "r"), ("大テーマ > テーマ", 245, "l"),
    ("1日%", 62, "r"), ("5日%",  62, "r"), ("1ヶ月%", 66, "r"),
    ("3ヶ月%", 66, "r"), ("1年%",  66, "r"), ("牽引",  140, "l"),
]
_RANK_SORT_MAP = {
    "1d": ("return_1d", "1日",   2),
    "5d": ("return_5d", "5日",   3),
    "1m": ("return_1m", "1ヶ月", 4),
}

ROW_H=27; HDR_H=32; TITLE_H=38; SEC_H=26; SUM_H=22; PAD=10; FS=13

# ── フォント ──────────────────────────────────────────────────────────────────
_FONT_CACHE: dict = {}

def _font():
    if FS not in _FONT_CACHE:
        for p in [
            "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
            "/usr/share/fonts/truetype/noto/NotoSansCJKjp-Regular.ttf",
            "/usr/share/fonts/noto-cjk/NotoSansCJKjp-Regular.otf",
            "C:/Windows/Fonts/meiryo.ttc",
            "C:/Windows/Fonts/msgothic.ttc",
            "C:/Windows/Fonts/YuGothM.ttc",
        ]:
            if os.path.exists(p):
                try:
                    _FONT_CACHE[FS] = ImageFont.truetype(p, FS)
                    break
                except Exception:
                    pass
        else:
            _FONT_CACHE[FS] = ImageFont.load_default()
    return _FONT_CACHE[FS]


# ── 描画ヘルパー ──────────────────────────────────────────────────────────────
def _tw(draw, text, fnt):
    try:    return int(draw.textlength(text, font=fnt))
    except: return len(text) * (FS // 2 + 2)

def _put(draw, text, x, cw, y, fnt, color, align):
    text = str(text)
    while len(text) > 1 and _tw(draw, text, fnt) > cw - 6:
        text = text[:-1]
    tw = _tw(draw, text, fnt)
    cy = y + max(0, (ROW_H - FS) // 2 - 1)
    if align == "r":
        draw.text((x + cw - tw - 4, cy), text, fill=color, font=fnt)
    else:
        draw.text((x + 4, cy), text, fill=color, font=fnt)

def _pct_c(v):
    if v is None or v == 0: return _C["DIM"]
    return _C["UP"] if v > 0 else _C["DOWN"]


# ── API ───────────────────────────────────────────────────────────────────────
def fetch_raw() -> dict:
    r = requests.get(_API_URL, headers=_API_HEADERS, timeout=30)
    r.raise_for_status()
    d = r.json()
    if not d.get("all_themes"):
        raise ValueError("all_themes が空")
    return d


def is_fresh(raw: dict) -> bool:
    """タイムスタンプ AND 1日非ゼロ率>50% の両方を確認。"""
    s = raw.get("last_update") or raw.get("data_updated_at", "")
    try:
        upd = datetime.datetime.strptime(str(s)[:19], "%Y-%m-%d %H:%M:%S")
        now = datetime.datetime.utcnow()
        ts_ok = (upd.date() == now.date() and upd.hour >= 20)
    except Exception:
        ts_ok = False
    all_t = [t for t in raw.get("all_themes", []) if t.get("related")]
    nonzero = sum(1 for t in all_t if t.get("1日") not in (None, 0.0, 0))
    data_ok = bool(all_t) and (nonzero / len(all_t) > 0.5)
    return ts_ok and data_ok


# ── データ変換 ────────────────────────────────────────────────────────────────
def _pct(v):
    return None if v is None else round(float(v) * 100, 2)


def build_themes(raw: dict) -> tuple[list[dict], str, str]:
    """raw API → (processed themes, stock_date, updated_at)"""
    seen: set[str] = set()
    result: list[dict] = []
    for t in raw.get("all_themes", []):
        slug = t.get("slug", "")
        if not t.get("related") or slug in seen:
            continue
        seen.add(slug)
        tp = t.get("tickerPerformances") or {}
        movers = sorted(
            [{"ticker": tk, "pct_1d": _pct(p.get("1日"))}
             for tk, p in tp.items() if p.get("1日") is not None],
            key=lambda x: x["pct_1d"], reverse=True,
        )
        entry: dict = {"theme": t.get("name", ""), "slug": slug, "theme1": t.get("theme1", "")}
        for jp, key in _PERIOD_MAP.items():
            v = _pct(t.get(jp))
            if v is not None:
                entry[key] = v
        entry["top_movers"] = movers[:3]
        result.append(entry)
    result.sort(key=lambda x: x.get("return_1d") or -9999, reverse=True)
    stock_date = raw.get("latest_stock_date", "?")
    updated_at = str(raw.get("last_update") or raw.get("data_updated_at", "?"))
    return result, stock_date, updated_at


# ── 分類 ──────────────────────────────────────────────────────────────────────
def _classify_one(r1, r1a, r5, r21) -> str | None:
    p = _P
    if (r1a >= p["r1_adj_strong"]) and (r1 >= p["r1_raw_floor"]):
        if r21 >= p["r21_trend"]:    return "継続強"
        if r5  >= p["r5_accel"]:     return "加速中"
        if r5  <  p["r5_fresh_max"]: return "新規点火"
        return None
    if (r21 >= p["r21_trend"] and r5 <= p["r5_stall_max"]
            and r1a <= p["r1_adj_weak"]):
        return "失速"
    return None


def classify(themes: list[dict]) -> tuple[list[dict], float]:
    r1s = [t["return_1d"] for t in themes if t.get("return_1d") is not None]
    med = statistics.median(r1s) if r1s else 0.0
    for t in themes:
        r1, r5, r21 = t.get("return_1d"), t.get("return_5d"), t.get("return_1m")
        if None in (r1, r5, r21):
            t["bucket"] = None
            continue
        t["bucket"] = _classify_one(r1, r1 - med, r5, r21)
    return themes, med


# ── 4分類画像 ─────────────────────────────────────────────────────────────────
def make_4class_image(classified: list[dict], median_r1: float,
                      stock_date: str, updated_at: str = "") -> str:
    cols = _COLS_4C
    fnt  = _font()
    W    = sum(c[1] for c in cols) + PAD * 2

    # バケット分類
    bkt: dict[str, list] = {b: [] for b in BUCKET_ORDER}
    for t in classified:
        b = t.get("bucket")
        if b in bkt:
            bkt[b].append(t)
    for b in bkt:
        bkt[b].sort(key=lambda x: x.get("return_1d") or 0, reverse=True)

    # 大テーマ資金集中サマリー
    STRONG = {"加速中", "継続強", "新規点火"}
    th1_map: dict[str, list] = {}
    for t in classified:
        if t.get("bucket") in STRONG:
            k = t.get("theme1") or "その他"
            th1_map.setdefault(k, []).append(t.get("theme", ""))
    conc = sorted([(k, v) for k, v in th1_map.items() if len(v) >= 2],
                  key=lambda x: len(x[1]), reverse=True)
    sumlines: list[tuple[str, tuple]] = []
    if conc:
        sumlines.append(("【大テーマ資金集中】", _C["TITLE"]))
        for k, names in conc[:8]:
            sub = "/".join(n.replace(k, "").strip(">： ") or n for n in names)
            sumlines.append((f"  {k}: {len(names)}件（{sub}）", _C["TEXT"]))

    n_rows = sum(max(1, min(MAX_PER_BUCKET, len(bkt[b]))) for b in BUCKET_ORDER)
    H = TITLE_H + len(sumlines) * SUM_H + HDR_H + len(BUCKET_ORDER) * SEC_H + n_rows * ROW_H + 8

    img  = Image.new("RGB", (W, H), _C["BG"])
    draw = ImageDraw.Draw(img)

    draw.text((PAD, 8),
              f"米テーマ動向  {stock_date}   中央値1日: {median_r1:+.2f}%",
              fill=_C["TITLE"], font=fnt)
    y = TITLE_H
    for text, color in sumlines:
        draw.text((PAD, y + 4), text, fill=color, font=fnt)
        y += SUM_H

    # 列ヘッダ
    draw.rectangle([0, y, W, y + HDR_H], fill=_C["HDR_BG"])
    x = PAD
    for label, cw, _ in cols:
        tw = _tw(draw, label, fnt)
        draw.text((x + max(0, (cw - tw) // 2), y + 8), label,
                  fill=_C["HDR_TXT"], font=fnt)
        x += cw
    draw.line([0, y + HDR_H - 1, W, y + HDR_H - 1], fill=_C["GRID"])
    y += HDR_H

    # バケット
    for bname in BUCKET_ORDER:
        bg, tc = _BUCKET_COLOR[bname]
        items   = bkt[bname][:MAX_PER_BUCKET]
        sec_txt = f"  【{bname}】  {len(items)}件" if items else f"  【{bname}】  該当なし"
        draw.rectangle([0, y, W, y + SEC_H], fill=bg)
        draw.text((PAD, y + 5), sec_txt, fill=tc, font=fnt)
        draw.line([0, y + SEC_H - 1, W, y + SEC_H - 1], fill=_C["GRID"])
        y += SEC_H

        if not items:
            draw.rectangle([0, y, W, y + ROW_H], fill=_C["EVEN"])
            draw.text((PAD + 4, y + 5), "  該当なし", fill=_C["DIM"], font=fnt)
            draw.line([0, y + ROW_H - 1, W, y + ROW_H - 1], fill=_C["GRID"])
            y += ROW_H
            continue

        for i, t in enumerate(items):
            row_bg = _C["EVEN"] if i % 2 == 0 else _C["ODD"]
            draw.rectangle([0, y, W, y + ROW_H], fill=row_bg)
            th1 = t.get("theme1", ""); nm = t.get("theme", "")
            lbl = f"{th1}>{nm}" if th1 else nm
            r1, r5, r1m, r3m, r1y = (
                t.get("return_1d"), t.get("return_5d"), t.get("return_1m"),
                t.get("return_3m"), t.get("return_1y"),
            )
            mstr   = " / ".join(m["ticker"] for m in t.get("top_movers", [])[:3]) or "-"
            r1y_c  = _C["OVERHEAT"] if (r1y is not None and r1y >= 100) else _pct_c(r1y)
            vc = [
                (lbl,                                        _C["TEXT"],  cols[0][2]),
                (f"{r1:+.1f}%"  if r1  is not None else "-", _pct_c(r1),  cols[1][2]),
                (f"{r5:+.1f}%"  if r5  is not None else "-", _pct_c(r5),  cols[2][2]),
                (f"{r1m:+.1f}%" if r1m is not None else "-", _pct_c(r1m), cols[3][2]),
                (f"{r3m:+.0f}%" if r3m is not None else "-", _pct_c(r3m), cols[4][2]),
                (f"{r1y:+.0f}%" if r1y is not None else "-", r1y_c,       cols[5][2]),
                (mstr,                                       _C["HDR_TXT"], cols[6][2]),
            ]
            x = PAD
            for (txt, clr, aln), (_, cw, _) in zip(vc, cols):
                _put(draw, txt, x, cw, y, fnt, clr, aln)
                x += cw
            draw.line([0, y + ROW_H - 1, W, y + ROW_H - 1], fill=_C["GRID"])
            y += ROW_H

    path = os.path.join(tempfile.gettempdir(), "themes_4class.png")
    img.save(path, "PNG")
    return path


def make_4class_image_from_themes(themes: list[dict],
                                   stock_date: str, updated_at: str = "") -> str:
    """キャッシュ済み themes からフォールバック画像を生成（send_themes_morning.py 用）。"""
    classified, median_r1 = classify(themes)
    return make_4class_image(classified, median_r1, stock_date, updated_at)


# ── ランキング画像 ────────────────────────────────────────────────────────────
def make_rank_image(themes: list[dict], period: str,
                    stock_date: str, updated_at: str = "") -> str:
    period = period.lower().strip()
    if period not in _RANK_SORT_MAP:
        period = "1d"
    sk, slabel, sidx = _RANK_SORT_MAP[period]
    cols = _COLS_RANK
    fnt  = _font()
    W    = sum(c[1] for c in cols) + PAD * 2

    ranked = sorted([t for t in themes if t.get(sk) is not None],
                    key=lambda x: x[sk], reverse=True)[:20]
    H = TITLE_H + HDR_H + len(ranked) * ROW_H + 8

    img  = Image.new("RGB", (W, H), _C["BG"])
    draw = ImageDraw.Draw(img)

    draw.text((PAD, 8),
              f"米テーマ 騰落率ランキング Top20  {stock_date}   ソート: {slabel}",
              fill=_C["TITLE"], font=fnt)
    y = TITLE_H

    # 列ヘッダ（ソート列を強調）
    draw.rectangle([0, y, W, y + HDR_H], fill=_C["HDR_BG"])
    x = PAD
    for i, (label, cw, _) in enumerate(cols):
        if i == sidx:
            draw.rectangle([x, y, x + cw, y + HDR_H], fill=(50, 80, 155))
        tw = _tw(draw, label, fnt)
        draw.text((x + max(0, (cw - tw) // 2), y + 8), label,
                  fill=_C["HDR_TXT"], font=fnt)
        x += cw
    draw.line([0, y + HDR_H - 1, W, y + HDR_H - 1], fill=_C["GRID"])
    y += HDR_H

    for i, t in enumerate(ranked, 1):
        row_bg = _C["EVEN"] if i % 2 == 0 else _C["ODD"]
        draw.rectangle([0, y, W, y + ROW_H], fill=row_bg)
        th1 = t.get("theme1", ""); nm = t.get("theme", "")
        lbl = f"{th1}>{nm}" if th1 else nm
        r1, r5, r1m, r3m, r1y = (
            t.get("return_1d"), t.get("return_5d"), t.get("return_1m"),
            t.get("return_3m"), t.get("return_1y"),
        )
        mstr  = " / ".join(m["ticker"] for m in t.get("top_movers", [])[:3]) or "-"
        r1y_c = _C["OVERHEAT"] if (r1y is not None and r1y >= 100) else _pct_c(r1y)
        vc = [
            (str(i),                                     _C["DIM"],   cols[0][2]),
            (lbl,                                        _C["TEXT"],  cols[1][2]),
            (f"{r1:+.1f}%"  if r1  is not None else "-", _pct_c(r1),  cols[2][2]),
            (f"{r5:+.1f}%"  if r5  is not None else "-", _pct_c(r5),  cols[3][2]),
            (f"{r1m:+.1f}%" if r1m is not None else "-", _pct_c(r1m), cols[4][2]),
            (f"{r3m:+.0f}%" if r3m is not None else "-", _pct_c(r3m), cols[5][2]),
            (f"{r1y:+.0f}%" if r1y is not None else "-", r1y_c,       cols[6][2]),
            (mstr,                                       _C["HDR_TXT"], cols[7][2]),
        ]
        x = PAD
        for (txt, clr, aln), (_, cw, _) in zip(vc, cols):
            _put(draw, txt, x, cw, y, fnt, clr, aln)
            x += cw
        draw.line([0, y + ROW_H - 1, W, y + ROW_H - 1], fill=_C["GRID"])
        y += ROW_H

    path = os.path.join(tempfile.gettempdir(), f"themes_rank_{period}.png")
    img.save(path, "PNG")
    return path


# ── ハイレベル（discord_trigger.py 用） ──────────────────────────────────────
def get_themes_image() -> tuple[str, str, str]:
    """API取得 → 分類 → 4分類画像。(path, stock_date, updated_at) を返す。"""
    raw = fetch_raw()
    themes, stock_date, updated_at = build_themes(raw)
    classified, median_r1 = classify(themes)
    path = make_4class_image(classified, median_r1, stock_date, updated_at)
    return path, stock_date, updated_at


def get_themes_rank_image(period: str = "1d") -> tuple[str, str, str]:
    """API取得 → ソート → ランキング画像。(path, stock_date, updated_at) を返す。"""
    raw = fetch_raw()
    themes, stock_date, updated_at = build_themes(raw)
    path = make_rank_image(themes, period, stock_date, updated_at)
    return path, stock_date, updated_at


def get_themes_all_images() -> tuple[str, str, str, str, str]:
    """API 1回取得 → 4分類 + 1日ランク + 5日ランク の3枚を生成。
    Returns (path_4class, path_rank_1d, path_rank_5d, stock_date, updated_at)
    """
    raw = fetch_raw()
    themes, stock_date, updated_at = build_themes(raw)
    classified, median_r1 = classify(themes)
    path_4c = make_4class_image(classified, median_r1, stock_date, updated_at)
    path_1d = make_rank_image(themes, "1d", stock_date, updated_at)
    path_5d = make_rank_image(themes, "5d", stock_date, updated_at)
    return path_4c, path_1d, path_5d, stock_date, updated_at
