"""
一時デバッグ用スクリプト。任意URLを叩いて WAF ブロックの有無を切り分ける。
原因特定後に削除する。

出力: status_code / <title> / len(text) / div.monospaced有無 /
      div.sub_news_box有無 / body内にWAF系文字列を含むか
"""

import argparse

import requests
from bs4 import BeautifulSoup

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) "
        "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 "
        "Mobile/15E148 Safari/604.1"
    ),
}

WAF_MARKERS = ("awswaf", "captcha.js", "Human Verification")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", required=True)
    args = parser.parse_args()

    r = requests.get(args.url, headers=HEADERS, timeout=10)

    soup = BeautifulSoup(r.text, "html.parser")
    title = soup.title.get_text(strip=True) if soup.title else None

    print("=== ", args.url, " ===")
    print("status_code:", r.status_code)
    print("<title>:", title)
    print("len(text):", len(r.text))
    print("div.monospaced found:", soup.select_one("div.monospaced") is not None)
    print("div.sub_news_box found:", soup.select_one("div.sub_news_box") is not None)
    for marker in WAF_MARKERS:
        print(f'contains "{marker}":', marker in r.text)


if __name__ == "__main__":
    main()
