"""
!themes コマンドハンドラ。
us-theme-tracker/us_themes_today.json を読んで classify_themes で4分類しテキスト返す。
main.py / notify.py 等の売買代金ロジックには一切触れない。
"""
from __future__ import annotations
import json, sys
from pathlib import Path

_UST = Path(r"C:\Users\ltaso\us-theme-tracker")
_MR  = Path(r"C:\Users\ltaso\market-report")
for _p in [str(_UST), str(_MR)]:
    if _p not in sys.path:
        sys.path.insert(0, _p)

from classify_themes import classify_themes  # type: ignore

BUCKET_ORDER = ["加速中", "継続強", "新規点火", "失速"]
JSON_PATH    = _UST / "us_themes_today.json"


def run_themes() -> str:
    if not JSON_PATH.exists():
        return "⚠️ us_themes_today.json が見つかりません。fetch_us_themes.py を先に実行してください。"

    with open(JSON_PATH, encoding="utf-8") as f:
        parsed = json.load(f)

    themes     = parsed["themes"]
    updated    = parsed.get("data_updated_at", "?")
    stock_date = parsed.get("latest_stock_date", "?")
    stale      = parsed.get("stale", False)

    classified, median_r1 = classify_themes(themes)

    buckets: dict[str, list] = {b: [] for b in BUCKET_ORDER}
    for t in classified:
        b = t.get("bucket")
        if b and b in buckets:
            buckets[b].append(t)

    lines = [f"**米国テーマ動向 {stock_date}**（中央値1日: {median_r1:+.2f}%）"]
    if stale:
        lines.append("⚠️ データが古い可能性あり")

    # ---- 大テーマ資金集中サマリー ----
    STRONG_BUCKETS = {"加速中", "継続強", "新規点火"}
    theme1_map: dict[str, list[str]] = {}
    for t in classified:
        if t.get("bucket") in STRONG_BUCKETS:
            th1  = t.get("theme1") or "その他"
            name = t.get("theme", "")
            theme1_map.setdefault(th1, []).append(name)

    concentrated = sorted(
        [(th1, names) for th1, names in theme1_map.items() if len(names) >= 2],
        key=lambda x: len(x[1]), reverse=True
    )
    if concentrated:
        lines.append("\n**【大テーマ資金集中】**")
        for th1, names in concentrated:
            sub = "/".join(n.replace(th1, "").strip(">： ") or n for n in names)
            lines.append(f"　{th1}: {len(names)}（{sub}）")

    for bucket in BUCKET_ORDER:
        items = sorted(buckets[bucket],
                       key=lambda x: x.get("return_1d") or 0, reverse=True)
        lines.append(f"\n【{bucket}】")
        if not items:
            lines.append("  該当なし")
            continue
        for t in items[:5]:
            r1   = t.get("return_1d")
            r5   = t.get("return_5d")
            r1m  = t.get("return_1m")
            r3m  = t.get("return_3m")
            r1y  = t.get("return_1y")
            movers = t.get("top_movers", [])[:3]
            mstr = " / ".join(
                f"{m['ticker']}({m.get('pct_1d', 0):+.1f}%)" for m in movers
            ) if movers else "-"
            r1s   = f"{r1:+.1f}%"   if r1  is not None else "-"
            r5s   = f"{r5:+.1f}%"   if r5  is not None else "-"
            r1ms  = f"{r1m:+.1f}%"  if r1m is not None else "-"
            r3ms  = f"{r3m:+.0f}%"  if r3m is not None else "-"
            r1ys  = f"{r1y:+.0f}%"  if r1y is not None else "-"
            overheat = " ⚠過熱圏" if (r1y is not None and r1y >= 100) else ""
            theme1 = t.get("theme1", "")
            name   = t.get("theme", "")
            label  = f"{theme1}>{name}" if theme1 else name
            lines.append(
                f"  {label}  "
                f"1日{r1s} 5日{r5s} 1ヶ月{r1ms} 3ヶ月{r3ms} 1年{r1ys}{overheat}"
                f"（牽引: {mstr}）"
            )

    lines.append(f"\n*data_updated_at: {updated}*")
    return "\n".join(lines)


_RANK_PERIOD_MAP = {
    "1d":  ("return_1d",  "1日"),
    "5d":  ("return_5d",  "5日"),
    "1m":  ("return_1m",  "1ヶ月"),
}


def run_themes_rank(period: str = "1d") -> str:
    if not JSON_PATH.exists():
        return "⚠️ us_themes_today.json が見つかりません。fetch_us_themes.py を先に実行してください。"

    key_str = period.lower().strip()
    if key_str not in _RANK_PERIOD_MAP:
        key_str = "1d"
    sort_key, sort_label = _RANK_PERIOD_MAP[key_str]

    with open(JSON_PATH, encoding="utf-8") as f:
        parsed = json.load(f)

    themes     = parsed["themes"]
    stock_date = parsed.get("latest_stock_date", "?")
    stale      = parsed.get("stale", False)

    ranked = sorted(
        [t for t in themes if t.get(sort_key) is not None],
        key=lambda x: x[sort_key],
        reverse=True,
    )[:20]

    lines = [f"**米テーマ騰落率ランキング Top20 {stock_date}（ソート: {sort_label}）**"]
    if stale:
        lines.append("⚠️ データが古い可能性あり")

    for i, t in enumerate(ranked, 1):
        r1   = t.get("return_1d")
        r5   = t.get("return_5d")
        r1m  = t.get("return_1m")
        r3m  = t.get("return_3m")
        r1y  = t.get("return_1y")
        movers = t.get("top_movers", [])[:3]
        mstr = " / ".join(
            f"{m['ticker']}({m.get('pct_1d', 0):+.1f}%)" for m in movers
        ) if movers else "-"
        r1s  = f"{r1:+.1f}%"  if r1  is not None else "-"
        r5s  = f"{r5:+.1f}%"  if r5  is not None else "-"
        r1ms = f"{r1m:+.1f}%" if r1m is not None else "-"
        r3ms = f"{r3m:+.0f}%" if r3m is not None else "-"
        r1ys = f"{r1y:+.0f}%" if r1y is not None else "-"
        overheat = " ⚠過熱圏" if (r1y is not None and r1y >= 100) else ""
        theme1 = t.get("theme1", "")
        name   = t.get("theme", "")
        label  = f"{theme1}>{name}" if theme1 else name
        lines.append(
            f"{i:2}. {label}  "
            f"1日{r1s} 5日{r5s} 1ヶ月{r1ms} 3ヶ月{r3ms} 1年{r1ys}{overheat}"
            f"（牽引: {mstr}）"
        )

    return "\n".join(lines)


if __name__ == "__main__":
    print(run_themes())
