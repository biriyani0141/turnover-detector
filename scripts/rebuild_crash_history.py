"""
過去局面の銘柄別詳細(watchlist)一括再構築スクリプト（Phase6タスク2）

crash_screener.py の既存関数のみを import して使用する(ロジックの複製・改変はしない)。
局面検出ロジック・母集団選定・特徴量計算・セクション分類は一切変更しない。

対象: data/jquants/daily/ のキャッシュ範囲内で「base_dateの120営業日前まで
日足キャッシュが揃っている」ことが確認できた局面のみ(タスク0で確認済み)。

state(crash_state.json)・Discord通知(crash_notify)には一切触れない。
crash_latest.json(現在の最新スナップショット)も上書きしない
(_write_snapshotは呼ばず、日付別ファイルのみ自前で書き出す)。

出力: web/public/data/crash/crash_watchlist_{YYYYMMDD}.json
      (rebuilt: true を付与。既存フィールドとは衝突しない追加のみ)
      crash_index.json の dates に対象日付を追加(既存のphases一覧は
      _update_index()にそのまま全再計算させる。ロジック複製を避けるため)

実行方法:
  python scripts/rebuild_crash_history.py
"""
from __future__ import annotations

import datetime
import json
import sys
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import crash_screener as cs  # noqa: E402

# 判断ログ: タスク0(データカバレッジ確認)で「base_dateの120営業日前まで
# daily/キャッシュが揃っている」と確認できた局面のみ対象にする。
# 進行中局面(2026-06-23〜)は実バッチで既にcrash_watchlist_20260715.json等が
# 存在するため対象外(タスク0報告の通り)。
# Phase6タスク2b(daily埋め戻し)により2024-08/2025-04/2025-10/2025-11の
# 4局面も追加対象になった(2026-03/2026-06の2局面は前回実行で再構築済みのため
# ここでは対象外、再実行不要)。
TARGET_PHASES: list[tuple[str, str]] = [
    ("2024-07-12", "2024-08-09"),
    ("2025-02-28", "2025-04-21"),
    ("2025-10-14", "2025-10-20"),
    ("2025-11-05", "2025-11-27"),
]


def rebuild_one(phase: cs.CrashPhase, index_df: pd.DataFrame, trading_days: pd.DatetimeIndex,
                 all_episodes: list) -> dict:
    start_idx = trading_days.searchsorted(phase.start)
    base_date = trading_days[start_idx - 1]
    day_index = trading_days.searchsorted(phase.end) - start_idx + 1

    universe = cs.load_universe()
    price_data_for_pop = cs.load_price_data(
        set(universe["code"]), cs._price_window_start(base_date), base_date.date().isoformat()
    )
    universe_returns = cs.compute_universe_returns(universe, price_data_for_pop, trading_days, base_date)
    pop = cs.build_population(universe_returns)

    price_data = cs.load_price_data(
        set(pop["code"]), cs._price_window_start(base_date), phase.end.date().isoformat()
    )
    raw_stocks = cs.build_watchlist_rows(pop, price_data, index_df, phase, trading_days, base_date)
    pop_stats = cs.compute_population_stats(raw_stocks)

    # 判断ログ: statusは「その局面終了日時点で本来出力されていたはずの値」を
    # classify_status()にそのまま判定させる(独自ロジックを書かない)。対象局面は
    # 既に自然終了済みのため、当該日までのepisodesを渡せばCOOLDOWN/IDLE系になる。
    end_idx = trading_days.searchsorted(phase.end)
    trading_days_upto_end = trading_days[: end_idx + 1]
    episodes_upto_end = [e for e in all_episodes if trading_days.searchsorted(e.end) <= end_idx]
    status, _ = cs.classify_status(episodes_upto_end, trading_days_upto_end)

    snapshot = {
        "date": phase.end.date().isoformat(),
        "generated_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "status": status,
        "phase": {
            "start": phase.start.date().isoformat(),
            "end_reason": phase.end_reason,
            "crash_day_count": len(phase.crash_days),
            "crash_days": [d.date().isoformat() for d in phase.crash_days],
            "index_max_dd": None if phase.index_max_dd is None or pd.isna(phase.index_max_dd)
            else round(float(phase.index_max_dd), 4),
            "day_index": int(day_index),
        },
        "stocks": raw_stocks,
        "data_date": phase.end.date().isoformat(),
        "stocks_stale": False,
        "population_base_date": base_date.date().isoformat(),
        "population_stats": pop_stats,
        "rebuilt": True,
    }
    return snapshot


def main() -> None:
    cs.setup_logging()
    print("--- 日経225指数取得 ---")
    index_df = cs.fetch_index()
    trading_days = index_df.index

    print(f"--- 局面検出(全履歴, {cs.PHASE_SEARCH_START}〜) ---")
    all_episodes = cs.detect_all_crash_phases(index_df, cs.PHASE_SEARCH_START)

    phase_by_key = {
        (e.start.date().isoformat(), e.end.date().isoformat()): e for e in all_episodes
    }

    generated: list[str] = []
    skipped: list[str] = []
    for start_str, end_str in TARGET_PHASES:
        key = (start_str, end_str)
        phase = phase_by_key.get(key)
        if phase is None:
            print(f"SKIP: 局面が検出結果に見つかりません: {start_str}〜{end_str}")
            skipped.append(f"{start_str}〜{end_str}(局面未検出)")
            continue

        compact = end_str.replace("-", "")
        out_path = cs.CRASH_DIR / f"crash_watchlist_{compact}.json"
        if out_path.exists():
            existing = json.loads(out_path.read_text(encoding="utf-8"))
            if not existing.get("rebuilt"):
                print(f"SKIP: 実バッチ生成済みファイルが既に存在(上書きしない): {out_path.name}")
                skipped.append(f"{start_str}〜{end_str}(実バッチ済み)")
                continue

        print(f"再構築中: {start_str}〜{end_str} (base_date/価格データ読み込み中...)")
        snapshot = rebuild_one(phase, index_df, trading_days, all_episodes)

        cs.CRASH_DIR.mkdir(parents=True, exist_ok=True)
        out_path.write_text(json.dumps(snapshot, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"  出力: {out_path} (stocks={len(snapshot['stocks'])}件, status={snapshot['status']})")
        generated.append(end_str)

    for end_str in generated:
        cs._update_index(all_episodes, end_str)

    print()
    print(f"=== 完了 === 再構築: {len(generated)}件 {generated} / スキップ: {len(skipped)}件 {skipped}")


if __name__ == "__main__":
    main()
