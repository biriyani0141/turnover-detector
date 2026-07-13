# -*- coding: utf-8 -*-
"""
crash_screener.py の局面検出が、検証リポジトリ(crash-relative-strength-screener)の
backtest.py で検出済みの既知局面リスト40件(fixtures/known_episodes.csv)と一致することを
確認するテスト。

仕様書「移植後、検証リポジトリの既知局面リスト40件と検出結果が一致することをテストで
確認する」に対応する。known_episodes.csv は2026-07-13時点の^N225データで生成されたもの
(crash-relative-strength-screener/episodes.csv からの複製)のため、本テストも
2026-07-14 00:00(exclusive)までのデータに固定してyfinance取得することで再現性を持たせる。
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
    判断ログ: 最終局面(40件目)は known_episodes.csv 生成時点(2026-07-13実行)でも
    right_censored=True(進行中)の局面であり、その終了日はyfinanceから当時何営業日分の
    データが取得できたかに依存する「常に動く」値である。本テスト実行時点でyfinance
    (Yahoo Finance)側のEOD反映が生成時点より遅れている/進んでいる場合、最終局面の
    end/end_reason/crash_day_count/index_max_dd が既知値と一致しないことがあるが、
    これはロジックの不一致ではなくデータ鮮度の違いによるもの(仕様書が想定する
    「バッチ実行時に取得できた最新営業日をデータ基準日とする」動作そのもの)。
    そのため最終局面のみ start の一致だけを厳密にチェックし、それ以外(1〜39件目、
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
