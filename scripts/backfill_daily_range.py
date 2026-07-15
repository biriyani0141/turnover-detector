"""
data/jquants/daily/ の指定範囲を J-Quants API から埋め戻すスクリプト
（Phase6タスク2b: 過去局面再構築に必要な日足キャッシュの拡張）。

jquants_backbone.py の既存関数(get_daily_all/save_quotes_to_daily_json/
is_valid_daily_file/get_api_key)のみを使用し、fetch本体のロジックは
複製・改変しない。main_full_fetch()と同じ形式・命名・格納場所・
レート制御(0.5〜1.0秒/リクエスト)を踏襲するが、対象範囲を
「today-365日」固定ではなく任意の開始日〜終了日で指定できるようにした点のみが違い。

既存ファイルは上書きしない(is_valid_daily_fileで判定、既存はスキップ)。
data/jquants/daily/ はリポジトリの.gitignoreで既に除外されているため、
本スクリプトの出力がgit管理下に入ることはない。

実行方法:
  python scripts/backfill_daily_range.py 2024-01-17 2025-06-16
"""
from __future__ import annotations

import datetime
import random
import sys
import time
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import jquants_backbone as jb  # noqa: E402


def main() -> None:
    if len(sys.argv) != 3:
        sys.exit("使い方: python scripts/backfill_daily_range.py <開始日YYYY-MM-DD> <終了日YYYY-MM-DD>")
    start = datetime.date.fromisoformat(sys.argv[1])
    end = datetime.date.fromisoformat(sys.argv[2])

    dates: list[str] = []
    d = start
    while d <= end:
        if d.weekday() < 5:
            dates.append(d.isoformat())
        d += datetime.timedelta(days=1)

    total = len(dates)
    print(f"=== backfill_daily_range 開始: {start.isoformat()} 〜 {end.isoformat()} ({total}平日候補) ===")

    try:
        api_key = jb.get_api_key()
        print(f"  API キー: SET (length={len(api_key)})")
    except Exception as e:
        print(f"  エラー: {e}")
        return

    saved_days = 0
    skipped_holiday = 0
    skipped_existing = 0
    error_days = 0

    for i, date in enumerate(dates, 1):
        if jb.is_valid_daily_file(jb.DATA_DIR / f"{date}.json"):
            print(f"[{i}/{total}] skip(既存) {date}")
            skipped_existing += 1
            continue
        print(f"[{i}/{total}] fetch {date}")

        try:
            quotes = jb.get_daily_all(api_key, date)
        except requests.exceptions.HTTPError as e:
            if e.response is not None and e.response.status_code in (401, 403):
                print(f"\n認証エラー ({e.response.status_code}): {e}")
                print("全日付共通エラーのため中断します。")
                return
            print(f"[{i}/{total}] {date}: HTTPエラー {e} → スキップ")
            error_days += 1
            time.sleep(0.5)
            continue
        except Exception as e:
            print(f"[{i}/{total}] {date}: エラー {e} → スキップ")
            error_days += 1
            time.sleep(0.5)
            continue

        if not quotes:
            print(f"[{i}/{total}] {date}: 休場(0件)スキップ")
            skipped_holiday += 1
            time.sleep(random.uniform(0.5, 1.0))
            continue

        try:
            saved = jb.save_quotes_to_daily_json(quotes)
        except Exception as e:
            print(f"[{i}/{total}] {date}: 保存エラー {e} → スキップ")
            error_days += 1
            time.sleep(random.uniform(0.5, 1.0))
            continue

        for save_date, n in saved.items():
            if n > 0:
                print(f"[{i}/{total}] {save_date}: 保存{n}件")
                saved_days += 1
            else:
                print(f"[{i}/{total}] {save_date}: スキップ（既存）")
                skipped_existing += 1

        time.sleep(random.uniform(0.5, 1.0))

    print("\n=== backfill_daily_range 完了 ===")
    print(f"  保存済み営業日数  : {saved_days}")
    print(f"  休場スキップ日数  : {skipped_holiday}")
    print(f"  既存スキップ日数  : {skipped_existing}")
    print(f"  エラースキップ日数: {error_days}")
    json_files = list(jb.DATA_DIR.glob("*.json"))
    print(f"  data/jquants/daily/ ファイル総数: {len(json_files)}")


if __name__ == "__main__":
    main()
