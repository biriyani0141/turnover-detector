"""回転率異常銘柄のウォッチリスト管理。data/watchlist.json に永続化する。"""

from __future__ import annotations
import json
import datetime
import os

WATCHLIST_PATH = os.path.join(os.path.dirname(__file__), "data", "watchlist.json")


def load_watchlist() -> dict:
    if not os.path.exists(WATCHLIST_PATH):
        return {}
    with open(WATCHLIST_PATH, encoding="utf-8") as f:
        return json.load(f)


def format_watchlist_text(watchlist: dict) -> str:
    """ウォッチリストをテキスト表形式に整形して返す。"""
    today = datetime.date.today().isoformat()
    header = (
        f"回転率異常ウォッチリスト  {today}\n"
        + "=" * 96 + "\n"
        + f"{'コード':<6}  {'銘柄名':<18}  {'初登場日':<10}  "
          f"{'初株価':>8}  {'現株価':>8}  {'株価変化':>7}  "
          f"{'初時総(億)':>10}  {'現時総(億)':>10}  {'5%超':>4}  {'10%超':>5}\n"
        + "-" * 96
    )
    entries = sorted(
        watchlist.items(),
        key=lambda kv: (-kv[1].get("count_10pct", 0), -kv[1].get("count_5pct", 0)),
    )
    lines = [header]
    for code, e in entries:
        fp = e.get("first_price")
        lp = e.get("last_price")
        fm = e.get("first_mktcap")
        lm = e.get("last_mktcap")
        price_chg = f"{(lp - fp) / fp * 100:+.1f}%" if fp and lp else "-"
        lines.append(
            f"{code:<6}  {e['name'][:16]:<18}  {e.get('first_date', '-'):<10}  "
            f"{(f'{fp:,.0f}' if fp else '-'):>8}  "
            f"{(f'{lp:,.0f}' if lp else '-'):>8}  "
            f"{price_chg:>7}  "
            f"{(f'{fm/1e8:,.0f}' if fm else '-'):>10}  "
            f"{(f'{lm/1e8:,.0f}' if lm else '-'):>10}  "
            f"{e.get('count_5pct', 0):>4}  "
            f"{e.get('count_10pct', 0):>5}"
        )
    return "\n".join(lines)


def update_watchlist(stocks) -> dict:
    """回転率5%以上の銘柄をウォッチリストに追記/更新してdictを返す。"""
    wl = load_watchlist()
    today = datetime.date.today().isoformat()

    for s in stocks:
        tr = s.turnover_ratio
        if not tr or tr < 0.05:
            continue

        if s.code not in wl:
            wl[s.code] = {
                "name": s.name,
                "first_date": today,
                "first_price": s.price,
                "first_mktcap": s.mktcap,
                "count_5pct": 0,
                "count_10pct": 0,
            }

        e = wl[s.code]
        e["name"] = s.name
        e["last_date"] = today
        e["last_price"] = s.price
        e["last_mktcap"] = s.mktcap
        e["count_5pct"] = e.get("count_5pct", 0) + 1
        if tr >= 0.10:
            e["count_10pct"] = e.get("count_10pct", 0) + 1

    os.makedirs(os.path.dirname(WATCHLIST_PATH), exist_ok=True)
    with open(WATCHLIST_PATH, "w", encoding="utf-8") as f:
        json.dump(wl, f, ensure_ascii=False, indent=2)
    return wl
