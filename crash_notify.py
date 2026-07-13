# -*- coding: utf-8 -*-
"""
暴落相対強度スクリーナー: 局面開始/終了のDiscord通知。

判断ログ: 既存 notify.py / image_notify.py は売買代金ランキング用の画像生成
パイプライン(matplotlib等でPNGを合成)込みで、本機能の要件(テキスト+上位10銘柄)に
対して過剰なため流用しない。DISCORD_WEBHOOK_URLへのシンプルなJSON embed投稿を
新規に実装する（仕様書「通知（既存があれば流用、なければ省略可）」に従い、
webhook URL自体の環境変数名(DISCORD_WEBHOOK_URL)のみ既存notify.pyと合わせている）。
"""
from __future__ import annotations

import os
import requests


def notify_phase_start(
    webhook_url: str | None, phase: dict, top_a_stocks: list[dict],
    population_stats: dict | None = None,
) -> None:
    webhook_url = webhook_url or os.environ.get("DISCORD_WEBHOOK_URL")
    if not webhook_url:
        print("DISCORD_WEBHOOK_URL 未設定のため通知をスキップ")
        return

    lines = [f"**暴落局面 開始検知** ({phase.get('start')}〜)"]
    lines.append(f"暴落日数: {phase.get('crash_day_count')} / 指数DD: {_pct(phase.get('index_max_dd'))}")
    if population_stats:
        lines.append(_population_stats_line(population_stats))
    if top_a_stocks:
        lines.append("\n[A]セクション上位10銘柄:")
        for s in top_a_stocks[:10]:
            mark = "★" if s.get("absolute_positive") else ""
            lines.append(
                f"- {_display_code(s.get('code', ''))} {s.get('name')}{mark} "
                f"(超過収益{_pct(s.get('cum_excess_return'))} / 距離{_pct(s.get('dist_to_high'))})"
            )
    else:
        lines.append("\n[A]セクション該当銘柄なし")

    _post(webhook_url, "\n".join(lines))


def _population_stats_line(stats: dict) -> str:
    """判断ログ: tier(相対順位)とは別に「絶対的にも指数を上回っている銘柄がどれだけ
    いるか」を局面サマリーとして1行付加する。tier・セクション判定には影響しない
    表示専用の情報（全面安局面での過信を防ぐ目的）。"""
    n = stats.get("n", 0)
    positive = stats.get("positive_count", 0)
    median = stats.get("median_cum_excess_return")
    return f"母集団{n}銘柄中 指数超過プラス(★): {positive}銘柄 (中央値{_pct(median)})"


def notify_phase_end(webhook_url: str | None, phase: dict) -> None:
    webhook_url = webhook_url or os.environ.get("DISCORD_WEBHOOK_URL")
    if not webhook_url:
        print("DISCORD_WEBHOOK_URL 未設定のため通知をスキップ")
        return

    content = (
        f"**暴落局面 終了** ({phase.get('start')}〜)\n"
        f"暴落日数: {phase.get('crash_day_count')} / 指数DD: {_pct(phase.get('index_max_dd'))}"
    )
    _post(webhook_url, content)


def _pct(v) -> str:
    if v is None:
        return "—"
    return f"{v * 100:+.1f}%"


def _display_code(code: str) -> str:
    """J-QuantsのLocalCode(5桁、末尾0埋め)を表示用4桁に変換する。crash_screener.py側
    (JSON出力)は内部結合キーとして5桁のまま保持しているため、表示直前のこの関数でのみ変換する。"""
    return code[:4] if len(code) == 5 else code


def _post(webhook_url: str, content: str) -> None:
    resp = requests.post(webhook_url, json={"content": content}, timeout=30)
    resp.raise_for_status()
