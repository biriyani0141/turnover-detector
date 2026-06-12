"""Discord Webhook への通知。"""

import os
import datetime
import requests
from detector import Signal, format_lines


def post_to_discord(signals: list[Signal], webhook_url: str | None = None) -> None:
    webhook_url = webhook_url or os.environ.get("DISCORD_WEBHOOK_URL")
    if not webhook_url:
        raise RuntimeError("DISCORD_WEBHOOK_URL が未設定です")

    today = datetime.date.today().strftime("%Y/%m/%d")
    if not signals:
        content = f"**売買代金×回転率 異常検出 {today}**\n該当銘柄なし"
    else:
        body = "\n".join(format_lines(signals))
        up = sum(1 for s in signals if s.direction == "up")
        down = sum(1 for s in signals if s.direction == "down")
        header = (f"**売買代金×回転率 異常検出 {today}**\n"
                  f"上位{len(signals)}銘柄 (🔺{up} / 🔻{down})\n")
        content = header + "```\n" + body + "\n```"

    # Discordの1メッセージ上限2000字に収める
    content = content[:1990]
    resp = requests.post(webhook_url, json={"content": content}, timeout=20)
    resp.raise_for_status()


def print_to_console(signals: list[Signal]) -> None:
    """Webhook未設定時のフォールバック(ログ確認用)。"""
    for line in format_lines(signals):
        print(line)
