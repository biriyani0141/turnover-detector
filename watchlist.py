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
