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
    prev_data: dict[str, float] | None = None,
    watchlist: dict | None = None,
) -> None:
    webhook_url = webhook_url or os.environ.get("DISCORD_WEBHOOK_URL")
    if not webhook_url:
        raise RuntimeError("DISCORD_WEBHOOK_URL が未設定です")

    from image_notify import make_ranking_images, make_turnover_images, make_watchlist_image

    src = stocks or [sg.stock for sg in signals]
    ranking1_path, ranking2_path = make_ranking_images(src, prev_data=prev_data)
    turnover_paths = make_turnover_images(src, prev_data=prev_data)
    watchlist_path = make_watchlist_image(watchlist) if watchlist else None

    today = datetime.date.today().strftime("%Y/%m/%d")
    content = f"**売買代金×回転率  {today}**"

    files: list[tuple] = [
        ("files[0]", ("ranking_1-50.png", open(ranking1_path, "rb"), "image/png")),
    ]
    idx = 1
    if ranking2_path:
        files.append((f"files[{idx}]", ("ranking_51-100.png", open(ranking2_path, "rb"), "image/png")))
        idx += 1
    for label, path in turnover_paths.items():
        files.append((f"files[{idx}]", (f"turnover_{label}.png", open(path, "rb"), "image/png")))
        idx += 1
    if watchlist_path:
        files.append((f"files[{idx}]", ("watchlist.png", open(watchlist_path, "rb"), "image/png")))
        idx += 1

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
