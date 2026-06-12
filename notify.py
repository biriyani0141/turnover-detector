"""Discord Webhook への通知（画像送信）。"""

from __future__ import annotations
import os
import json
import datetime
import requests
from detector import Signal, format_lines
from scraper import Stock


def post_to_discord(
    signals: list[Signal],
    webhook_url: str | None = None,
    stocks: list[Stock] | None = None,
) -> None:
    webhook_url = webhook_url or os.environ.get("DISCORD_WEBHOOK_URL")
    if not webhook_url:
        raise RuntimeError("DISCORD_WEBHOOK_URL が未設定です")

    from image_notify import make_ranking_image, make_turnover_image

    src = stocks or [sg.stock for sg in signals]
    ranking_path = make_ranking_image(src)
    turnover_path = make_turnover_image(src)

    today = datetime.date.today().strftime("%Y/%m/%d")
    content = f"**売買代金×回転率  {today}**"

    files: list[tuple] = [
        ("files[0]", ("ranking.png", open(ranking_path, "rb"), "image/png")),
    ]
    if turnover_path:
        files.append(
            ("files[1]", ("turnover.png", open(turnover_path, "rb"), "image/png"))
        )

    resp = requests.post(
        webhook_url,
        data={"payload_json": json.dumps({"content": content})},
        files=files,
        timeout=60,
    )
    resp.raise_for_status()


def print_to_console(signals: list[Signal]) -> None:
    for line in format_lines(signals):
        print(line)
