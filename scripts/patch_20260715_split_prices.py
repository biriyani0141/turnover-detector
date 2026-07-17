"""
crash_watchlist_20260715.json の一点パッチ(Discord依頼 2026-07-17、りゅ承認済み)。

背景: backfill_active_phase_daily.py の検証で、既知7銘柄(株式分割2/4/5/10倍による
調整後株価の改定)がローカル価格キャッシュとCI実行時点のキャッシュで食い違うことが
判明し、局面全日をローカルの最新(統一)価格キャッシュで再生成・上書きした。
ただし2026-07-15だけは、日付を打ち切って独立に局面検出をやり直すと
「(ii)静穏3日AND安値未更新5日」でその日自体に自然終了したと誤判定され
(局面終了判定が最大10営業日先のトリガーを先読みする仕様のため、ちょうど
末尾の日に条件が乗ると先読みできない構造的な境界問題。実バッチ記録は
ACTIVE/データ末尾到達で、これが正)、backfill_active_phase_daily.pyは
この日をスキップし元ファイルを温存した。

りゅの指示: phase判定・局面メタ(start/end_reason/crash_day_count/crash_days/
index_max_dd/day_index)は実バッチ記録を正としてそのまま維持し、
既知7銘柄の価格由来フィールドだけ最新の統一価格キャッシュで差し替える。
tier(qcutによる母集団内相対順位)は7銘柄の値変更を反映して319銘柄全体で
再計算し(境界波及の可能性があるため)、section・population_statsも合わせて
再計算する。7銘柄以外の値・phaseメタは一切変更しない。

crash_screener.pyの既存関数のみを使用し、計算式は複製しない。
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import crash_screener as cs  # noqa: E402

TARGET_DATE = "2026-07-15"
KNOWN_SPLIT_CODES = {"58020", "74090", "58010", "40990", "72360", "31100", "70690"}


def main() -> None:
    cs.setup_logging()

    out_path = cs.CRASH_DIR / f"crash_watchlist_{TARGET_DATE.replace('-', '')}.json"
    real = json.loads(out_path.read_text(encoding="utf-8"))
    real_phase = real["phase"]
    print(f"--- 対象: {out_path.name} (phase維持: start={real_phase['start']} end_reason={real_phase['end_reason']}) ---")

    state = cs.load_state()
    cached_pop = state["population"]
    base_date = pd.Timestamp(cached_pop["base_date"])

    # phase判定・局面メタは実バッチ記録をそのまま使う(独自の再判定はしない)。
    synthetic_phase = cs.CrashPhase(
        start=pd.Timestamp(real_phase["start"]),
        end=pd.Timestamp(TARGET_DATE),
        crash_days=[pd.Timestamp(d) for d in real_phase.get("crash_days", [])],
        end_reason=real_phase["end_reason"],
        extended=False,
        index_max_dd=real_phase["index_max_dd"],
    )

    index_df = cs.fetch_index()
    truncated = index_df.loc[:TARGET_DATE]
    trading_days = truncated.index

    universe = cs.load_universe()
    pop_rows = universe[universe["code"].isin(KNOWN_SPLIT_CODES)].copy()
    price_data = cs.load_price_data(KNOWN_SPLIT_CODES, cs._price_window_start(base_date), TARGET_DATE)
    universe_returns = cs.compute_universe_returns(pop_rows, price_data, trading_days, base_date)

    patched_rows = cs.build_watchlist_rows(universe_returns, price_data, truncated, synthetic_phase, trading_days, base_date)
    patched_by_code = {r["code"]: r for r in patched_rows}
    missing = KNOWN_SPLIT_CODES - set(patched_by_code)
    if missing:
        raise SystemExit(f"エラー: 価格再計算で欠落した銘柄があります: {missing}")

    # tier/sectionは母集団全体の相対順位に依存するため、7銘柄だけ差し替えた後、
    # 319銘柄全体で再計算する(境界波及をログに残すため差し替え前のtierも保持)。
    stocks = [dict(s) for s in real["stocks"]]  # 変更しない312銘柄はそのままコピー
    tier_before = {s["code"]: s.get("tier") for s in stocks}

    for s in stocks:
        if s["code"] in patched_by_code:
            p = patched_by_code[s["code"]]
            for key in ("close", "market_cap", "top_ret", "cum_excess_return", "strong_day_count",
                        "dist_to_high", "already_recovered", "ma25_deviation", "days_from_52w_high",
                        "pre_crash_high", "absolute_positive"):
                s[key] = p[key]

    cum_excess_series = pd.Series(
        [s["cum_excess_return"] for s in stocks], index=[s["code"] for s in stocks]
    )
    tier_series = cs.safe_qcut(cum_excess_series, ["low", "mid", "high"])
    for s in stocks:
        tier_val = tier_series.get(s["code"])
        s["tier"] = None if pd.isna(tier_val) else str(tier_val)
        s["section"] = cs.classify_section(s["tier"], s["dist_to_high"], bool(s["already_recovered"]))

    section_order = {"S": 0, "A": 1, "B": 2, "C": 3, "D": 4}
    stocks.sort(key=lambda x: (section_order[x["section"]], -(x["cum_excess_return"] or -999)))

    tier_moves = [
        (code, tier_before[code], s["tier"])
        for s in stocks
        for code in [s["code"]]
        if tier_before[code] != s["tier"]
    ]

    real["stocks"] = stocks
    real["population_stats"] = cs.compute_population_stats(stocks)
    real["price_patched_codes"] = sorted(KNOWN_SPLIT_CODES)  # 判断ログ: どの銘柄を統一価格で差し替えたか記録として残す
    out_path.write_text(json.dumps(real, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"--- 完了: {out_path.name} を7銘柄の価格系フィールドのみ更新 ---")
    print(f"tier変化 {len(tier_moves)}件: {tier_moves}")
    print(f"population_stats(更新後): {real['population_stats']}")

    # crash_index.json のhistoryエントリもこの日の分だけ更新する
    all_episodes = cs.detect_all_crash_phases(index_df, cs.PHASE_SEARCH_START)
    cs._update_index(all_episodes, TARGET_DATE, real, index_df)
    print("crash_index.json history更新済み")


if __name__ == "__main__":
    main()
