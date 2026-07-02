"""
一時デバッグ用スクリプト。CI環境でのみ実行し、原因特定後に削除する。
find_today_article_id() が CI で ScrapeError になる件の切り分け:
  1) status_code / len(text) でブロックされてないか
  2) div.sub_news_box が存在するか
  3) li a[href*='b=n'] の件数・タイトル一覧
は例外を投げず全部printする。
"""

import requests
from bs4 import BeautifulSoup

from kabutan_stophigh_reasons import HEADERS, LIST_URL, TITLE_PREFIX

session = requests.Session()
r = session.get(LIST_URL, headers=HEADERS, timeout=10)

print("=== status/len ===")
print("status_code:", r.status_code)
print("len(text):", len(r.text))
print("final url:", r.url)
print("content-type:", r.headers.get("Content-Type"))
print()
print("=== body head (2000 chars) ===")
print(r.text[:2000])
print()

soup = BeautifulSoup(r.text, "html.parser")
box = soup.select_one("div.sub_news_box")
print("=== div.sub_news_box ===")
print("found:", box is not None)

if box is not None:
    links = box.select("li a[href*='b=n']")
    print(f"li a[href*='b=n'] 件数: {len(links)}")
    print()
    print("=== 全タイトル一覧 ===")
    for a in links:
        title = a.get_text(strip=True)
        href = a.get("href", "")
        prefix_match = title.startswith(TITLE_PREFIX)
        has_close = "引け" in title
        print(f"  prefix_match={prefix_match} has_close={has_close} href={href!r} title={title!r}")
