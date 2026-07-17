"""
現局面(crash_state.jsonにキャッシュ済みの局面)の日次スナップショット
バックフィル + crash_index.json history配列生成(Discord依頼 2026-07-17)。

crash_screener.py の既存関数のみをimportして使用する。局面検出ロジック・
母集団選定・特徴量計算は一切変更しない(rebuild_crash_history.pyと同じ方針)。

対象日: 現在ACTIVEな局面のstart〜直近営業日の「全日」。
  母集団は「局面開始時に1回確定」の仕様通り、crash_state.jsonにキャッシュ済みの
  codes/base_dateをそのまま使う(日々recomputeしない)。
  各日の局面(phase.end/crash_days/index_max_dd等)は、日経指数を当日で打ち切って
  crash_screener.detect_all_crash_phases/classify_statusをそのまま再実行して求める。

判断ログ(2026-07-17, りゅ承認済み・局面全日を上書きする方針への変更):
  当初は「crash_watchlist_{date}.jsonが既存の日は再生成しない」非破壊方針だったが、
  検証で7銘柄(分割2/4/5/10倍)がローカル価格キャッシュとCI実行時点のキャッシュとで
  調整後株価が食い違うことが判明した。局面途中(7/14〜7/17)だけ古い調整基準のまま
  残すと、推移チャート・前日比デルタが局面内で価格基準の異なる不連続な値になり
  意味が壊れるため、局面全日をローカルの最新(統一済み)価格キャッシュで再生成・
  上書きする方針に変更した(りゅ承認)。crash_latest.json/crash_state.jsonには
  引き続き一切触れない(このスクリプトはcrash_watchlist_{date}.json/crash_index.json
  のみを対象とする)。

検証(緩和版、りゅ承認済み):
  直近の「stocks_stale=false」の実バッチ生成済み日を1件選び、独立再計算した結果を
  ライブ出力と突き合わせ、以下を全て満たすことを確認してから本処理に入る。
    1. 局面境界(phase dict全体)・母集団銘柄集合(コード集合として)が完全一致
    2. cum_excess_returnの不一致は事前特定した7銘柄(KNOWN_SPLIT_ADJUSTMENTS)のみに
       限定される(それ以外の銘柄で1件でも不一致ならエラー)
    3. その7銘柄それぞれについて、「ローカル価格キャッシュのphase.start前日終値を
       既知の分割比率で割り戻すと、ライブ出力のcum_excess_returnを許容誤差内で
       再現できる」ことをアサートする(比率で説明できない不一致は7銘柄でもエラー)
  いずれか1つでも満たさなければ中断する。

  再生成前に既存だった日(7/14〜7/17、および局面統合前の残留データだった7/10)は、
  上書き前後でtier(high/mid/low)が変わった銘柄をログに出す
  (7銘柄の調整改定がqcutの分位境界に波及し、他銘柄のtierが動く可能性があるため。
  りゅの指示により、これは検証失敗ではなく報告事項として扱う)。

実行方法:
  python scripts/backfill_active_phase_daily.py
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

# 判断ログ: 検証で実際に見つかった7銘柄と分割比率(local_price_at_day_before_start /
# real_price_at_day_before_start ≒ この比率)。値は診断スクリプトで実測済み
# (誤差0.01%未満で綺麗な整数比になることを確認済み)。この7件以外での不一致は
# 分割では説明できないため許容しない(=バグの可能性として検証を失敗させる)。
KNOWN_SPLIT_ADJUSTMENTS: dict[str, float] = {
    "58020": 4.0,
    "74090": 2.0,
    "58010": 10.0,
    "40990": 2.0,
    "72360": 10.0,
    "31100": 5.0,
    "70690": 2.0,
}
RATIO_TOLERANCE = 0.002  # cum_excess_return(比率換算後)の許容誤差


def build_phase_dict(phase: cs.CrashPhase, trading_days: pd.DatetimeIndex, day: pd.Timestamp) -> dict:
    """run_batch()のphase dict構築部分と同一のロジック(rebuild_crash_history.pyにも
    同型のコピーがある。値の算出式自体はコピペせずphaseの属性から機械的に組み立てる
    だけなのでズレようがない)。"""
    start_idx = trading_days.searchsorted(phase.start)
    day_index = trading_days.searchsorted(day) - start_idx + 1
    return {
        "start": phase.start.date().isoformat(),
        "end_reason": phase.end_reason,
        "crash_day_count": len(phase.crash_days),
        "crash_days": [d.date().isoformat() for d in phase.crash_days],
        "index_max_dd": None if phase.index_max_dd is None or pd.isna(phase.index_max_dd)
        else round(float(phase.index_max_dd), 4),
        "day_index": int(day_index),
    }


def build_snapshot_for_day(
    day: pd.Timestamp, index_df: pd.DataFrame, pop_codes: set[str], base_date: pd.Timestamp,
) -> dict | None:
    """day時点で打ち切った指数データを使い、ライブバッチと同一関数でその日のsnapshotを
    独立に組み立てる。局面がACTIVEでなくなっている(=想定外)場合はNoneを返す。"""
    truncated = index_df.loc[:day]
    trading_days = truncated.index
    episodes_upto = cs.detect_all_crash_phases(truncated, cs.PHASE_SEARCH_START)
    status, phase = cs.classify_status(episodes_upto, trading_days)
    if status != "ACTIVE" or phase is None:
        return None

    universe = cs.load_universe()
    pop_rows = universe[universe["code"].isin(pop_codes)].copy()
    date_str = day.date().isoformat()
    price_data = cs.load_price_data(pop_codes, cs._price_window_start(base_date), date_str)
    universe_returns = cs.compute_universe_returns(pop_rows, price_data, trading_days, base_date)

    raw_stocks = cs.build_watchlist_rows(universe_returns, price_data, truncated, phase, trading_days, base_date)
    pop_stats = cs.compute_population_stats(raw_stocks)

    return {
        "date": date_str,
        "generated_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "status": status,
        "phase": build_phase_dict(phase, trading_days, day),
        "stocks": raw_stocks,
        "data_date": date_str,
        "stocks_stale": False,
        "population_base_date": base_date.date().isoformat(),
        "population_stats": pop_stats,
        "backfilled": True,
    }


def _idx_cum_ret(index_df: pd.DataFrame, day_before_start: pd.Timestamp, phase_end: pd.Timestamp) -> float:
    close = index_df["Close"]
    return float(close.loc[phase_end] / close.loc[day_before_start] - 1)


def validate_against_existing(index_df: pd.DataFrame, pop_codes: set[str], base_date: pd.Timestamp) -> None:
    """緩和版検証(りゅ承認済み、モジュールdocstring参照)。"""
    candidates = []
    for p in sorted(cs.CRASH_DIR.glob("crash_watchlist_*.json")):
        try:
            data = json.loads(p.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            continue
        if data.get("status") == "ACTIVE" and data.get("stocks_stale") is False and not data.get("rebuilt") and not data.get("backfilled"):
            candidates.append(data)
    if not candidates:
        raise SystemExit("検証エラー: 検証対象にできる実バッチ生成済み(stocks_stale=false)のスナップショットが見つかりません。")
    real = max(candidates, key=lambda d: d["date"])
    day = pd.Timestamp(real["date"])
    print(f"--- 検証(緩和版): {real['date']} をライブ出力と独立再計算で突き合わせ ---")

    rebuilt = build_snapshot_for_day(day, index_df, pop_codes, base_date)
    if rebuilt is None:
        raise SystemExit(f"検証エラー: {real['date']} を独立再計算するとACTIVEになりません(想定外)。")

    # 条件1: 局面境界・母集団銘柄集合
    if rebuilt["phase"] != real["phase"]:
        raise SystemExit(f"検証失敗(条件1): phase不一致\n  real={real['phase']}\n  rebuilt={rebuilt['phase']}")
    real_codes = {s["code"] for s in real.get("stocks", [])}
    rebuilt_codes = {s["code"] for s in rebuilt["stocks"]}
    if real_codes != rebuilt_codes:
        raise SystemExit(
            f"検証失敗(条件1): 母集団の銘柄集合が不一致\n"
            f"  real only={real_codes - rebuilt_codes}\n  rebuilt only={rebuilt_codes - real_codes}"
        )
    print(f"  OK(条件1): 局面境界一致 / 母集団{len(real_codes)}銘柄で銘柄集合一致")

    # 条件2: cum_excess_return不一致は既知7銘柄のみに限定
    real_by_code = {s["code"]: s for s in real["stocks"]}
    rebuilt_by_code = {s["code"]: s for s in rebuilt["stocks"]}
    unexpected_mismatches = []
    actual_mismatched_codes = set()
    for code in real_codes:
        if real_by_code[code].get("cum_excess_return") != rebuilt_by_code[code].get("cum_excess_return"):
            actual_mismatched_codes.add(code)
            if code not in KNOWN_SPLIT_ADJUSTMENTS:
                unexpected_mismatches.append(code)
    if unexpected_mismatches:
        raise SystemExit(f"検証失敗(条件2): 既知7銘柄以外でcum_excess_return不一致: {unexpected_mismatches}")
    missing_expected = set(KNOWN_SPLIT_ADJUSTMENTS) - actual_mismatched_codes
    if missing_expected:
        print(f"  注意: 既知7銘柄のうち今回は不一致が出なかった銘柄(想定外だが検証失敗にはしない): {missing_expected}")
    print(f"  OK(条件2): cum_excess_return不一致は既知7銘柄の範囲内({sorted(actual_mismatched_codes)})")

    # 条件3: 既知7銘柄それぞれ、分割比率で説明できることをアサート
    phase_start = pd.Timestamp(real["phase"]["start"])
    day_before_start = index_df.loc[:phase_start].index[-2]
    idx_cum_ret = _idx_cum_ret(index_df, day_before_start, day)
    price_data = cs.load_price_data(set(KNOWN_SPLIT_ADJUSTMENTS), cs._price_window_start(base_date), real["date"])
    ratio_failures = []
    for code, ratio in KNOWN_SPLIT_ADJUSTMENTS.items():
        if code not in actual_mismatched_codes:
            continue
        df = price_data.get(code)
        if df is None or day_before_start not in df.index or day not in df.index:
            ratio_failures.append(f"{code}: 価格データ欠損")
            continue
        close = df["Close"]
        local_before = float(close.loc[day_before_start])
        local_end = float(close.loc[day])
        adjusted_before = local_before / ratio
        adjusted_excess = round((local_end / adjusted_before - 1) - idx_cum_ret, 4)
        real_excess = real_by_code[code]["cum_excess_return"]
        if abs(adjusted_excess - real_excess) > RATIO_TOLERANCE:
            ratio_failures.append(f"{code}: 比率{ratio}倍で調整しても不一致(real={real_excess}, 調整後={adjusted_excess})")
    if ratio_failures:
        raise SystemExit(f"検証失敗(条件3): 分割比率で説明できない銘柄がありました: {ratio_failures}")
    print(f"  OK(条件3): 既知7銘柄すべて分割比率(2/4/5/10倍)で説明可能と確認")

    print(f"--- 検証(緩和版)完了。局面全日の再生成・上書きに進みます ---")


def report_tier_moves(before_by_date: dict[str, dict], after_by_date: dict[str, dict]) -> None:
    """再生成前後でtierが変わった銘柄をログに出す(りゅ指示、検証失敗にはしない)。"""
    any_move = False
    for date_str, before_stocks in before_by_date.items():
        after_stocks = after_by_date.get(date_str)
        if after_stocks is None:
            continue
        before_by_code = {s["code"]: s.get("tier") for s in before_stocks}
        after_by_code = {s["code"]: s.get("tier") for s in after_stocks}
        moves = [
            (code, before_by_code[code], after_by_code[code])
            for code in before_by_code
            if code in after_by_code and before_by_code[code] != after_by_code[code]
        ]
        if moves:
            any_move = True
            print(f"  [{date_str}] tier変化 {len(moves)}件: {moves}")
    if not any_move:
        print("  tier変化: なし")


def main() -> None:
    cs.setup_logging()

    state = cs.load_state()
    cached_pop = state.get("population")
    phase_start_str = state.get("phase_start")
    if not (cached_pop and phase_start_str):
        raise SystemExit(
            "crash_state.jsonに現局面の母集団キャッシュがありません"
            "(ACTIVE局面が無い、またはライブバッチ未実行の可能性)。中断します。"
        )
    base_date = pd.Timestamp(cached_pop["base_date"])
    pop_codes = set(cached_pop["codes"])
    print(f"--- 対象局面: start={phase_start_str} / base_date={base_date.date()} / 母集団{len(pop_codes)}銘柄 ---")

    print("--- 日経225指数取得 ---")
    index_df = cs.fetch_index()
    trading_days = index_df.index

    validate_against_existing(index_df, pop_codes, base_date)

    print("--- 局面検出(全履歴、現在時点) ---")
    all_episodes = cs.detect_all_crash_phases(index_df, cs.PHASE_SEARCH_START)
    status, phase = cs.classify_status(all_episodes, trading_days)
    if status != "ACTIVE" or phase is None or phase.start.date().isoformat() != phase_start_str:
        raise SystemExit(
            f"crash_state.jsonのphase_start({phase_start_str})と、現在のdetect_all_crash_phases"
            f"の結果(status={status}, phase.start={phase.start.date() if phase else None})が"
            "一致しません。中断します。"
        )

    start_idx = trading_days.searchsorted(phase.start)
    target_days = list(trading_days[start_idx:])  # phase.start 〜 直近営業日(=今日)。局面全日が対象。

    tier_before: dict[str, dict] = {}
    tier_after: dict[str, dict] = {}

    generated: list[str] = []
    overwritten: list[str] = []
    for day in target_days:
        date_str = day.date().isoformat()
        compact = day.strftime("%Y%m%d")
        out_path = cs.CRASH_DIR / f"crash_watchlist_{compact}.json"

        existed_before = out_path.exists()
        if existed_before:
            try:
                old = json.loads(out_path.read_text(encoding="utf-8"))
                tier_before[date_str] = old.get("stocks", [])
            except (json.JSONDecodeError, OSError):
                pass

        print(f"{'再生成' if existed_before else '新規生成'}中: {date_str} ...")
        snapshot = build_snapshot_for_day(day, index_df, pop_codes, base_date)
        if snapshot is None:
            print(f"  SKIP: {date_str} を打ち切りで再計算するとACTIVEになりません(局面境界の可能性、要目視確認)")
            continue
        out_path.write_text(json.dumps(snapshot, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"  出力: {out_path.name} ({len(snapshot['stocks'])}銘柄)")
        tier_after[date_str] = snapshot["stocks"]
        (overwritten if existed_before else generated).append(date_str)

    # --- crash_index.json へのhistory反映(今回対象にした全日) ---
    print("--- crash_index.json history反映 ---")
    history_added: list[str] = []
    for day in target_days:
        date_str = day.date().isoformat()
        compact = day.strftime("%Y%m%d")
        out_path = cs.CRASH_DIR / f"crash_watchlist_{compact}.json"
        if not out_path.exists():
            continue
        snap = json.loads(out_path.read_text(encoding="utf-8"))
        cs._update_index(all_episodes, date_str, snap, index_df)
        history_added.append(date_str)

    print()
    print("--- tier変化レポート(再生成前後、既存だった日のみ) ---")
    report_tier_moves(tier_before, tier_after)

    print()
    print(f"=== 完了 === 新規生成: {len(generated)}件 {generated}")
    print(f"再生成(上書き): {len(overwritten)}件 {overwritten}")
    print(f"history反映: {len(history_added)}件")


if __name__ == "__main__":
    main()
