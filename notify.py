"""Discord Webhook への通知（画像送信）。"""

from __future__ import annotations
import os
import json
import datetime
import tempfile
import requests
from detector import Signal, format_lines
from scraper import Stock


def post_to_discord(
    signals: list[Signal],
    webhook_url: str | None = None,
    stocks: list[Stock] | None = None,
    prev_data: dict[str, float] | None = None,
    watchlist: dict | None = None,
    std_stocks: list[Stock] | None = None,
    grt_stocks: list[Stock] | None = None,
    market_summary: dict | None = None,
) -> None:
    webhook_url = webhook_url or os.environ.get("DISCORD_WEBHOOK_URL")
    if not webhook_url:
        raise RuntimeError("DISCORD_WEBHOOK_URL が未設定です")

    from image_notify import (make_ranking_images, make_turnover_image,
                               make_std_grt_image)
    from market_data import (format_prime_summary_lines,
                              format_std_summary_lines, format_grt_summary_lines)
    from watchlist import format_watchlist_text

    src = stocks or [sg.stock for sg in signals]
    ms = market_summary or {}

    prime_summary = format_prime_summary_lines(ms) if ms else None
    std_summary   = format_std_summary_lines(ms) if ms else None
    grt_summary   = format_grt_summary_lines(ms) if ms else None

    ranking1_path, ranking2_path = make_ranking_images(src, prev_data=prev_data,
                                                        summary_lines=prime_summary)
    turnover_path = make_turnover_image(src, prev_data=prev_data)
    std_grt_path  = make_std_grt_image(std_stocks or [], grt_stocks or [],
                                        prev_data=prev_data,
                                        std_summary=std_summary, grt_summary=grt_summary)

    today = datetime.date.today().strftime("%Y/%m/%d")
    content = f"**売買代金×回転率  {today}**"

    files: list[tuple] = [
        ("files[0]", ("ranking_1-50.png", open(ranking1_path, "rb"), "image/png")),
    ]
    idx = 1
    if ranking2_path:
        files.append((f"files[{idx}]", ("ranking_51-100.png", open(ranking2_path, "rb"), "image/png")))
        idx += 1
    if turnover_path:
        files.append((f"files[{idx}]", ("turnover.png", open(turnover_path, "rb"), "image/png")))
        idx += 1
    if std_grt_path:
        files.append((f"files[{idx}]", ("ranking_std_grt.png", open(std_grt_path, "rb"), "image/png")))
        idx += 1
    if watchlist:
        txt = format_watchlist_text(watchlist)
        txt_path = os.path.join(tempfile.gettempdir(), "watchlist.txt")
        with open(txt_path, "w", encoding="utf-8") as f:
            f.write(txt)
        files.append((f"files[{idx}]", ("watchlist.txt", open(txt_path, "rb"), "text/plain")))
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
