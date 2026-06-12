"""市場全体の売買代金データ取得・集計。

stock-marketdata.com からプライム/スタンダード/グロースの日次売買代金を取得し、
Yahoo Finance から日経平均の現在値を取得する。
"""

from __future__ import annotations
import re
import requests
from bs4 import BeautifulSoup
from scraper import HEADERS

MARKET_DATA_URL = "https://stock-marketdata.com/trading-value.html"
NIKKEI_URL      = "https://finance.yahoo.co.jp/quote/998407.O"


def _to_float(s: str) -> float | None:
    if s is None:
        return None
    s = s.replace(",", "").replace("+", "").replace("%", "").replace("−", "-").strip()
    try:
        return float(s)
    except ValueError:
        return None


def _fmt_oku(val_million: float | None) -> str:
    """百万円 → 億/兆表記に変換。"""
    if val_million is None:
        return "-"
    oku = val_million / 100
    if abs(oku) >= 10_000:
        return f"{oku / 10_000:.2f}兆"
    return f"{oku:,.0f}億"


def _fmt_diff_oku(val_million: float | None) -> str:
    """百万円の差分 → 符号付き億/兆表記。"""
    if val_million is None:
        return "-"
    oku = val_million / 100
    sign = "+" if oku >= 0 else ""
    if abs(oku) >= 10_000:
        return f"{sign}{oku / 10_000:.2f}兆"
    return f"{sign}{oku:,.0f}億"


def fetch_market_summary(session: requests.Session | None = None) -> dict:
    """
    市場別売買代金サマリーを返す。

    返り値の構造:
    {
      "prime":    {"value": float(百万円), "change": float, "change_pct": float,
                   "avg5": float, "avg5_diff": float, "avg5_ratio": float},
      "standard": {...同上...},
      "growth":   {...同上...},
      "nikkei":   {"price": float, "change": float, "change_pct": float},
    }
    値が取得できなかった場合は None。
    """
    sess = session or requests.Session()
    result: dict = {}

    # ---- stock-marketdata.com からの取得 ----
    try:
        r = sess.get(MARKET_DATA_URL, headers=HEADERS, timeout=15)
        r.raise_for_status()
        soup = BeautifulSoup(r.text, "html.parser")
        tables = soup.find_all("table")
        if tables:
            data_rows = []
            for tr in tables[0].find_all("tr"):
                cells = [td.get_text(strip=True) for td in tr.find_all(["td", "th"])]
                if cells and re.match(r"\d{4}/\d{2}/\d{2}", cells[0]):
                    data_rows.append(cells)

            if data_rows:
                today = data_rows[0]

                def _avg5(col_idx: int) -> float | None:
                    vals = [_to_float(row[col_idx]) for row in data_rows[:5]
                            if len(row) > col_idx and _to_float(row[col_idx]) is not None]
                    return sum(vals) / len(vals) if vals else None

                def _mkt(val_i, chg_i, pct_i, label):
                    val = _to_float(today[val_i]) if len(today) > val_i else None
                    chg = _to_float(today[chg_i]) if len(today) > chg_i else None
                    pct = _to_float(today[pct_i]) if len(today) > pct_i else None
                    avg5 = _avg5(val_i)
                    avg5_diff = (val - avg5) if val and avg5 else None
                    avg5_ratio = (avg5_diff / avg5 * 100) if avg5_diff and avg5 else None
                    return {"value": val, "change": chg, "change_pct": pct,
                            "avg5": avg5, "avg5_diff": avg5_diff, "avg5_ratio": avg5_ratio}

                # 列順: 日付(0), PRM(1,2,3), STD(4,5,6), GRT(7,8,9), NK(10,11,12)
                result["prime"]    = _mkt(1, 2, 3, "prime")
                result["standard"] = _mkt(4, 5, 6, "standard")
                result["growth"]   = _mkt(7, 8, 9, "growth")
    except Exception:
        pass

    # ---- Yahoo Finance から日経平均 ----
    try:
        r2 = sess.get(NIKKEI_URL, headers=HEADERS, timeout=15)
        r2.raise_for_status()
        text = BeautifulSoup(r2.text, "html.parser").get_text(" ", strip=True)
        pm = re.search(r"([\d,]+\.?\d*)\s+前日比", text)
        if pm:
            price = _to_float(pm.group(1))
            if price and 5_000 <= price <= 200_000:  # 合理的な日経平均レンジ
                cm = re.search(r"前日比\s+([+\-−]\d[\d,.]*)", text)
                change = _to_float(cm.group(1)) if cm else None
                pm2 = re.search(r"\(\s*([+\-−]?\d+\.?\d*)\s*%\s*\)", text)
                change_pct = _to_float(pm2.group(1)) if pm2 else None
                result["nikkei"] = {"price": price, "change": change, "change_pct": change_pct}
    except Exception:
        pass

    return result


def format_prime_summary_lines(ms: dict) -> list[tuple[str, str]]:
    """プライム用サマリーライン（メインランキング画像向け）を返す。"""
    from image_notify import C_DIM, C_TEXT
    lines = []

    nk = ms.get("nikkei")
    if nk and nk.get("price"):
        chg = nk.get("change")
        pct = nk.get("change_pct")
        nk_str = (
            f"日経平均  {nk['price']:,.2f}"
            + (f"  変動 {chg:+,.2f}" if chg is not None else "")
            + (f"  騰落率 {pct:+.2f}%" if pct is not None else "")
        )
        lines.append((nk_str, C_TEXT))

    pr = ms.get("prime")
    if pr and pr.get("value") is not None:
        v, c, p = pr["value"], pr["change"], pr["change_pct"]
        a5, a5d, a5r = pr["avg5"], pr["avg5_diff"], pr["avg5_ratio"]
        pr_str = (
            f"プライム  {_fmt_oku(v)}"
            + (f"  前日比 {_fmt_diff_oku(c)}({p:+.1f}%)" if c is not None and p is not None else "")
            + (f"  5日平均 {_fmt_oku(a5)}" if a5 else "")
            + (f"  5日比 {_fmt_diff_oku(a5d)}({a5r:+.1f}%)" if a5d is not None and a5r is not None else "")
        )
        lines.append((pr_str, C_DIM))

    return lines


def format_std_grt_summary_lines(ms: dict) -> list[tuple[str, str]]:
    """スタンダード/グロース用サマリーライン（STD/GRT画像向け）を返す。"""
    from image_notify import C_DIM
    lines = []
    for key, label in [("standard", "スタンダード"), ("growth", "グロース")]:
        mkt = ms.get(key)
        if not mkt or mkt.get("value") is None:
            continue
        v, c, p = mkt["value"], mkt["change"], mkt["change_pct"]
        a5, a5d, a5r = mkt["avg5"], mkt["avg5_diff"], mkt["avg5_ratio"]
        line = (
            f"{label}  {_fmt_oku(v)}"
            + (f"  前日比 {_fmt_diff_oku(c)}({p:+.1f}%)" if c is not None and p is not None else "")
            + (f"  5日平均 {_fmt_oku(a5)}" if a5 else "")
            + (f"  5日比 {_fmt_diff_oku(a5d)}({a5r:+.1f}%)" if a5d is not None and a5r is not None else "")
        )
        lines.append((line, C_DIM))
    return lines
