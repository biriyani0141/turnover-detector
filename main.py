"""
エントリポイント。GitHub Actionsから平日夜に呼ばれる。

流れ:
  1) 平日かつ日本の祝日でないか判定(土日祝はスキップ)
  2) 売買代金ランキング取得 -> 時価総額付与
  3) 回転率で異常検出
  4) Discord通知(未設定ならコンソール出力)

環境変数:
  NOTIFY               'discord'(既定) | 'line' | 'console'
  DISCORD_WEBHOOK_URL  Discord通知先
  LINE_CHANNEL_TOKEN   LINE Messaging APIトークン
  LINE_USER_ID         LINE送信先user ID
  TOP_N                母集団の銘柄数(既定50)
  TOP_K                通知する上位件数(既定15)
  MARKET               'tokyo'|'all' など(既定tokyo)
  FORCE_RUN            '1'なら土日祝でも実行(手動テスト用)
"""

import os
import sys
import datetime
import requests

from scraper import fetch_ranking, enrich_with_mktcap
from detector import detect
from notify import post_to_discord, print_to_console


def is_jp_business_day(d: datetime.date) -> bool:
    if d.weekday() >= 5:  # 土(5)日(6)
        return False
    try:
        import jpholiday
        if jpholiday.is_holiday(d):
            return False
    except ImportError:
        # jpholiday未導入でも動く。祝日は土日のみ判定にフォールバック。
        pass
    # 年末年始(12/31-1/3)は取引所休場
    if (d.month, d.day) in [(12, 31), (1, 1), (1, 2), (1, 3)]:
        return False
    return True


def main() -> int:
    today = datetime.date.today()
    force = os.environ.get("FORCE_RUN") == "1"
    if not force and not is_jp_business_day(today):
        print(f"{today} は非営業日。スキップします。")
        return 0

    top_n = int(os.environ.get("TOP_N", "50"))
    top_k = int(os.environ.get("TOP_K", "15"))
    market = os.environ.get("MARKET", "tokyo")

    sess = requests.Session()
    print(f"ランキング取得中 (market={market}, top_n={top_n}) ...")
    stocks = fetch_ranking(top_n=top_n, market=market, session=sess)
    print(f"  {len(stocks)}件取得")

    print("時価総額を付与中 (個別ページ) ...")
    enrich_with_mktcap(stocks, session=sess)
    have_cap = sum(1 for s in stocks if s.mktcap)
    print(f"  時価総額取得: {have_cap}/{len(stocks)}件")

    signals = detect(stocks, top_k=top_k)
    print(f"検出: {len(signals)}件")

    notify_to = os.environ.get("NOTIFY", "discord").lower()
    if notify_to == "line":
        from notify_line import post_to_line, print_to_console
        if os.environ.get("LINE_CHANNEL_TOKEN") and os.environ.get("LINE_USER_ID"):
            post_to_line(signals)
            print("LINEへ通知しました。")
        else:
            print("LINE設定が未完。コンソール出力:")
            print_to_console(signals)
    elif notify_to == "console":
        from notify import print_to_console
        print_to_console(signals)
    else:  # discord
        from notify import post_to_discord, print_to_console
        if os.environ.get("DISCORD_WEBHOOK_URL"):
            post_to_discord(signals)
            print("Discordへ通知しました。")
        else:
            print("DISCORD_WEBHOOK_URL未設定。コンソール出力:")
            print_to_console(signals)
    return 0


if __name__ == "__main__":
    sys.exit(main())
