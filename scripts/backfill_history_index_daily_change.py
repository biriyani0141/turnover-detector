"""
crash_index.json の history 配列に index_daily_change フィールドを一括バックフィルする
単発スクリプト(Discord依頼 2026-07-17、りゅ承認済み)。

crash_watchlist_{date}.json 等のstocks/snapshot類には一切触れない。
history配列の既存18件それぞれについて、crash_screener.compute_index_daily_change
(fetch_index()の実際のN225取引カレンダーベース、欠測日を挟んでも正しい前日比になる
実装。冒頭の判断ログ参照)を使って1フィールドだけ追記する。

実行方法:
  python scripts/backfill_history_index_daily_change.py
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import crash_screener as cs  # noqa: E402


def main() -> None:
    cs.setup_logging()
    index_path = cs.CRASH_DIR / "crash_index.json"
    idx = json.loads(index_path.read_text(encoding="utf-8"))
    history = idx.get("history", [])
    if not history:
        raise SystemExit("crash_index.jsonにhistory配列がありません。中断します。")

    print(f"--- 日経225指数取得 ---")
    index_df = cs.fetch_index()

    updated = []
    missing = []
    for h in history:
        change = cs.compute_index_daily_change(index_df, pd.Timestamp(h["date"]))
        h["index_daily_change"] = change
        if change is None:
            missing.append(h["date"])
        else:
            updated.append((h["date"], change))

    index_path.write_text(json.dumps(idx, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"=== 完了 === {len(history)}件中 算出成功{len(updated)}件 / 算出不能{len(missing)}件")
    for d, c in updated:
        print(f"  {d}: {c:+.4f}")
    if missing:
        print(f"  算出不能(index_df上に見つからない日、要確認): {missing}")


if __name__ == "__main__":
    main()
