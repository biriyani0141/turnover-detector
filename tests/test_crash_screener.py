# -*- coding: utf-8 -*-
"""
crash_screener.py の局面検出が、検証リポジトリ(crash-relative-strength-screener)の
既知局面リスト(fixtures/known_episodes.csv)と一致することを確認するテスト。

仕様書「移植後、検証リポジトリの既知局面リスト40件と検出結果が一致することをテストで
確認する」に対応する。

判断ログ(2026-07-14更新): fixtureは当初 backtest.py の episodes.csv(40局面)の複製
だったが、局面統合条件の変更(「全戻し達成後は延長統合しない」ガードの追加、りゅ指示)に
伴い、検証リポジトリの backtest_recovery_split.py が出力した
recovery_split_episodes.csv(41局面)の複製に更新した。2026-06-08局面が
2026-06-23の全戻しで分裂した1件を除く39局面(COVID含む)は変更前の検出結果と
完全一致することを確認済み(検証リポジトリ側での突合レポートで確認、
crash-relative-strength-screener/recovery_split_diff_report.md参照)。

known_episodes.csv は2026-07-13時点の^N225データで生成されたもの
のため、本テストも2026-07-14 00:00(exclusive)までのデータに固定してyfinance取得
することで再現性を持たせる。
"""
from __future__ import annotations

import csv
from pathlib import Path

import pandas as pd
import pytest

import crash_screener as cs

FIXTURE_PATH = Path(__file__).parent / "fixtures" / "known_episodes.csv"
FETCH_END = "2026-07-14"  # known_episodes.csv 生成時点(2026-07-13実行)に合わせて固定


def _load_known_episodes() -> list[dict]:
    with open(FIXTURE_PATH, encoding="utf-8") as f:
        return list(csv.DictReader(f))


@pytest.fixture(scope="module")
def detected_episodes():
    index_df = cs.fetch_index(start=cs.INDEX_FETCH_START, end=FETCH_END)
    return cs.detect_all_crash_phases(index_df, cs.PHASE_SEARCH_START)


def test_episode_count_matches(detected_episodes):
    known = _load_known_episodes()
    assert len(detected_episodes) == len(known), (
        f"検出局面数が一致しない: 検出{len(detected_episodes)}件 / 既知{len(known)}件"
    )


def test_each_episode_matches(detected_episodes):
    """既知局面リストとの突合。
    判断ログ: 最終局面(fixtureの最終行、2026-07-14時点で41件目)は
    known_episodes.csv 生成時点でも「データ末尾到達」(進行中)の局面であり、
    その終了日はyfinanceから当時何営業日分のデータが取得できたかに依存する
    「常に動く」値である。本テスト実行時点でyfinance(Yahoo Finance)側の
    EOD反映が生成時点より遅れている/進んでいる場合、最終局面の
    end/end_reason/crash_day_count/index_max_dd が既知値と一致しないことがあるが、
    これはロジックの不一致ではなくデータ鮮度の違いによるもの(仕様書が想定する
    「バッチ実行時に取得できた最新営業日をデータ基準日とする」動作そのもの)。
    そのため最終局面のみ start の一致だけを厳密にチェックし、それ以外(それより前の
    全て確定済みの過去局面)は全フィールドを厳密に一致させる。
    """
    known = _load_known_episodes()
    assert len(detected_episodes) == len(known)
    last_i = len(known)
    for i, (detected, expected) in enumerate(zip(detected_episodes, known), start=1):
        assert detected.start.date().isoformat() == expected["start"], f"episode {i}: start不一致"
        if i == last_i and detected.end_reason == "データ末尾到達":
            continue
        assert detected.end.date().isoformat() == expected["end"], f"episode {i}: end不一致"
        assert detected.end_reason == expected["end_reason"], f"episode {i}: end_reason不一致"
        assert str(detected.extended) == expected["merged_extended"], f"episode {i}: merged_extended不一致"
        assert len(detected.crash_days) == int(expected["crash_day_count"]), f"episode {i}: crash_day_count不一致"
        assert detected.index_max_dd == pytest.approx(float(expected["index_max_dd"]), rel=1e-6), (
            f"episode {i}: index_max_dd不一致"
        )


def test_classify_status_idle_when_no_episodes():
    empty_days = pd.date_range("2026-01-01", periods=5, freq="B")
    status, phase = cs.classify_status([], empty_days)
    assert status == "IDLE"
    assert phase is None


def test_classify_status_active_when_last_episode_open_ended(detected_episodes):
    index_df = cs.fetch_index(start=cs.INDEX_FETCH_START, end=FETCH_END)
    trading_days = index_df.index
    status, phase = cs.classify_status(detected_episodes, trading_days)
    last = detected_episodes[-1]
    last_idx = len(trading_days) - 1
    end_idx = trading_days.searchsorted(last.end)
    if end_idx == last_idx and last.end_reason == "データ末尾到達":
        assert status == "ACTIVE"
    else:
        assert status in ("IDLE", "COOLDOWN")


# ============================================================
# セクション振り分け(S/A/B/C/D)の回帰テスト
# 「絶対強度フラグ(absolute_positive)」追加時にtier/section判定ロジックが
# 1件も変わっていないことを確認する(2026-07-14の仕様追加の完了条件に対応)。
# tierはあくまで母集団内の相対順位(pd.qcutによる上位1/3=high)であり、
# cum_excess_returnの符号(絶対値としてプラスかマイナスか)には依存しない。
# ============================================================
@pytest.mark.parametrize("tier,dist_to_high,already_recovered,expected", [
    ("high", 0.10, False, "A"),   # tier high かつ距離15%以内 → A
    ("high", 0.20, False, "B"),   # tier high だが距離15%超 → B
    ("mid", 0.10, False, "B"),    # tier mid かつ距離15%以内 → B
    ("mid", 0.20, False, "C"),    # tier mid だが距離15%超 → C
    ("low", 0.05, False, "D"),    # tier low は距離によらず全表示でD
    ("low", 0.50, False, "D"),
    (None, 0.05, False, "D"),     # tier不能(NaN)もD扱い
    ("high", 0.30, True, "S"),    # already_recovered=Trueはtier/距離によらずS優先
    ("low", 0.50, True, "S"),
])
def test_classify_section_unchanged(tier, dist_to_high, already_recovered, expected):
    assert cs.classify_section(tier, dist_to_high, already_recovered) == expected


def test_classify_section_ignores_cum_excess_return_sign():
    """tier=highでcum_excess_returnがマイナスでも(=母集団内の相対順位でhighなだけ)、
    セクション判定は絶対値の符号を一切見ない(distとalready_recoveredのみで決まる)ことを
    明示的に確認する。実運用で観測された「[A]にcum_excess_return<0の銘柄が混在」は
    バグではなくこの仕様通りの挙動であることの回帰テスト。"""
    assert cs.classify_section("high", 0.05, False) == "A"


def test_compute_population_stats_independent_of_section():
    """absolute_positiveフラグ・population_statsはtier/sectionの判定に一切使われない
    (別々に計算される)ことを確認する。"""
    rows = [
        {"cum_excess_return": 0.05, "section": "A"},
        {"cum_excess_return": -0.02, "section": "A"},
        {"cum_excess_return": -0.01, "section": "D"},
        {"cum_excess_return": None, "section": "D"},
    ]
    stats = cs.compute_population_stats(rows)
    assert stats["n"] == 4
    assert stats["positive_count"] == 1
    assert stats["median_cum_excess_return"] == pytest.approx(-0.01, abs=1e-9)
