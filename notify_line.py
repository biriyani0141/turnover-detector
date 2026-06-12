"""LINE Messaging API への通知。

LINE Notify はサービス終了(2025/3/31)のため、Messaging API を使う。

事前準備:
  1) LINE Developers (https://developers.line.biz/) でプロバイダー作成
  2) Messaging API チャネルを作成
  3) チャネルアクセストークン(長期)を発行
  4) 送信先のuser IDを取得
     - 自分のLINEで公式アカウントを友だち追加
     - Webhookで届くイベントの source.userId、または
       管理画面のテスト送信機能などで確認
  5) GitHub Secrets に登録:
        LINE_CHANNEL_TOKEN  = チャネルアクセストークン
        LINE_USER_ID        = 送信先user ID
"""

import os
import datetime
import requests
from detector import Signal, format_lines

LINE_PUSH_URL = "https://api.line.me/v2/bot/message/push"


def post_to_line(signals: list[Signal],
                 token: str | None = None,
                 user_id: str | None = None) -> None:
    token = token or os.environ.get("LINE_CHANNEL_TOKEN")
    user_id = user_id or os.environ.get("LINE_USER_ID")
    if not token or not user_id:
        raise RuntimeError("LINE_CHANNEL_TOKEN / LINE_USER_ID が未設定です")

    today = datetime.date.today().strftime("%Y/%m/%d")
    if not signals:
        text = f"売買代金×回転率 異常検出 {today}\n該当銘柄なし"
    else:
        up = sum(1 for s in signals if s.direction == "up")
        down = sum(1 for s in signals if s.direction == "down")
        header = (f"売買代金×回転率 異常検出 {today}\n"
                  f"上位{len(signals)}銘柄 (🔺{up} / 🔻{down})\n")
        # LINEはコードブロック非対応なのでプレーンテキストで送る
        text = header + "\n".join(format_lines(signals))

    # LINEの1メッセージ上限は5000字。余裕はあるが安全に切る。
    text = text[:4900]

    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
    }
    payload = {
        "to": user_id,
        "messages": [{"type": "text", "text": text}],
    }
    resp = requests.post(LINE_PUSH_URL, headers=headers, json=payload, timeout=20)
    resp.raise_for_status()


def print_to_console(signals: list[Signal]) -> None:
    """トークン未設定時のフォールバック。"""
    for line in format_lines(signals):
        print(line)
