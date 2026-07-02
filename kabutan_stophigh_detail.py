"""
S高カード用ポップアップの詳細データをkabutan.jpからスクレイプする(データ取得部分のみ)。

対象: data/jquants/stop-high-reasons.json の最新日付キーに含まれる銘柄のみ
(kabutan_stophigh_reasons.py 実行後に呼ぶ前提)。

3ページから取得:
  A: s.kabutan.jp/stocks/{code}/ → 会社名/コード/市場/業種/時価総額/発行済株式数
  B: s.kabutan.jp/stocks/{code}/historical_prices/margin/ → 週次信用買い残(直近8週)
     発行済株式数から買い残/発行済株式数の比率(%)を算出
  C: s.kabutan.jp/stocks/{code}/stockholders/ → data-value="0"パネル(最新期)の全株主

出力: data/jquants/stop-high-detail.json (日付キー > コードキー)
コードキーは kabutan_stophigh_reasons.py と同じ LocalCode 形式(生コード+"0")。
生コード(URL用)は local_code[:-1] で復元する(生コードは常に4文字という
既に確認済みの前提に基づく、to_local_code() の逆変換)。

未確定事項: UI仕様の「概要は2行+トグル展開」用の事業内容テキストの取得元が
未特定(/stocks/{code}/ と /stocks/{code}/finance/ を確認したが該当テキストが
見つからなかった。meta descriptionは定型SEO文言のみで概要文言としては使えない)。
overview_text は None のまま出力する。りゅに確認要。
"""

import json
import re
import time
from pathlib import Path

import requests
from bs4 import BeautifulSoup

from kabutan_stophigh_reasons import HEADERS

REASONS_FILE = Path(__file__).parent / "data" / "jquants" / "stop-high-reasons.json"
OUT_FILE = Path(__file__).parent / "data" / "jquants" / "stop-high-detail.json"

MARGIN_WEEKS = 16
SLEEP_BETWEEN_STOCKS = 1.0


class ScrapeError(RuntimeError):
    pass


def load_target_codes() -> tuple[str, list[str]]:
    if not REASONS_FILE.exists():
        raise ScrapeError(f"{REASONS_FILE} が存在しない(先にkabutan_stophigh_reasons.pyを実行すること)")
    data = json.loads(REASONS_FILE.read_text(encoding="utf-8"))
    if not data:
        raise ScrapeError(f"{REASONS_FILE} が空、対象日が特定できない")
    date_key = max(data.keys())
    local_codes = list(data[date_key].keys())
    return date_key, local_codes


def _find_label_value_text(soup: BeautifulSoup, label: str) -> str | None:
    """ラベルdiv(テキストが label と完全一致)の次のdiv兄弟要素のテキストを返す。
    時価総額/発行済株式数/概要 いずれもラベル+値のdiv2連構造だが、
    それぞれ別のテーブル(囲みdivのクラスが異なる)にあるため、
    クラス名に依存せずラベルテキストだけで探す。
    """
    for label_div in soup.find_all("div"):
        if label_div.get_text(strip=True) == label:
            value_div = label_div.find_next_sibling("div")
            if value_div is not None:
                return value_div.get_text(" ", strip=True)
    return None


def fetch_overview(session: requests.Session, raw_code: str) -> dict:
    url = f"https://s.kabutan.jp/stocks/{raw_code}/"
    r = session.get(url, headers=HEADERS, timeout=10)
    r.raise_for_status()
    soup = BeautifulSoup(r.text, "html.parser")

    header = soup.select_one("div.flex.justify-between.mx-2.mt-4")
    if header is None:
        raise ScrapeError(f"{url}: ヘッダー情報(コード/市場/業種)が見つからない")
    left_div, right_div = header.find_all("div", recursive=False)
    spans = left_div.find_all("span")
    if len(spans) < 2:
        raise ScrapeError(f"{url}: コード/市場のspanが想定数に足りない")
    market = spans[1].get_text(strip=True)
    sector_a = right_div.find("a")
    sector = sector_a.get_text(strip=True) if sector_a else None

    h1 = soup.find("h1")
    if h1 is None:
        raise ScrapeError(f"{url}: h1(会社名)が見つからない")
    span_text = h1.find("span").get_text(strip=True) if h1.find("span") else ""
    name = h1.get_text(strip=True)
    if span_text and name.endswith(span_text):
        name = name[: -len(span_text)].strip()

    market_cap = _find_label_value_text(soup, "時価総額")
    shares_outstanding_text = _find_label_value_text(soup, "発行済株式数")
    if shares_outstanding_text is None:
        raise ScrapeError(f"{url}: 発行済株式数が見つからない")
    shares_outstanding = int(re.sub(r"[^\d]", "", shares_outstanding_text) or 0)

    overview_text = _find_label_value_text(soup, "概要")
    if overview_text is None:
        raise ScrapeError(f"{url}: 概要(基本情報テーブル)が見つからない")

    return {
        "name": name,
        "market": market,
        "sector": sector,
        "market_cap": market_cap,
        "shares_outstanding": shares_outstanding,
        "overview_text": overview_text,
    }


def fetch_margin_weekly(session: requests.Session, raw_code: str, shares_outstanding: int) -> list[dict]:
    url = f"https://s.kabutan.jp/stocks/{raw_code}/historical_prices/margin/"
    r = session.get(url, headers=HEADERS, timeout=10)
    r.raise_for_status()
    soup = BeautifulSoup(r.text, "html.parser")

    heading = soup.find("h2", string=lambda s: bool(s) and "週次信用残" in s)
    if heading is None:
        raise ScrapeError(f"{url}: h2「週次信用残」が見つからない")
    table = heading.find_next("table")
    if table is None:
        raise ScrapeError(f"{url}: 週次信用残テーブルが見つからない")

    rows = []
    for tr in table.select("tbody tr")[:MARGIN_WEEKS]:
        cells = tr.find_all(["th", "td"])
        if len(cells) < 8:
            continue
        date_label = cells[0].get_text(strip=True)
        buy_balance_text = cells[6].get_text(strip=True)
        buy_balance = int(re.sub(r"[^\d]", "", buy_balance_text) or 0)
        pct_of_shares = (
            round(buy_balance / shares_outstanding * 100, 2) if shares_outstanding else None
        )
        rows.append(
            {
                "date": date_label,
                "buy_balance": buy_balance,
                "pct_of_shares": pct_of_shares,
            }
        )

    if not rows:
        raise ScrapeError(f"{url}: 週次信用残の行が1件も取れなかった")

    return rows


def fetch_stockholders(session: requests.Session, raw_code: str) -> list[dict]:
    url = f"https://s.kabutan.jp/stocks/{raw_code}/stockholders/"
    r = session.get(url, headers=HEADERS, timeout=10)
    r.raise_for_status()
    soup = BeautifulSoup(r.text, "html.parser")

    panel = soup.select_one('div[data-tabs-target="panel"][data-value="0"]')
    if panel is None:
        raise ScrapeError(f"{url}: 最新期の株主パネル(data-value=0)が見つからない")
    table = panel.find("table")
    if table is None:
        raise ScrapeError(f"{url}: 株主テーブルが見つからない")

    holders = []
    for tr in table.select("tbody tr"):
        name_a = tr.select_one("td a.link-primary")
        if name_a is None:
            continue
        name = name_a.get_text(strip=True)
        pct_div = tr.select_one("td div.ml-2")
        shares_div = tr.select_one("td div.text-right")
        pct_text = pct_div.get_text(strip=True) if pct_div else ""
        shares_text = shares_div.get_text(strip=True) if shares_div else ""
        pct = float(re.sub(r"[^\d.]", "", pct_text)) if pct_text else None
        shares = int(re.sub(r"[^\d]", "", shares_text)) if shares_text else None
        holders.append({"name": name, "pct": pct, "shares": shares})

    if not holders:
        raise ScrapeError(f"{url}: 株主が1件も取れなかった")

    return holders


def build_detail_for_code(session: requests.Session, local_code: str) -> dict:
    raw_code = local_code[:-1]
    overview = fetch_overview(session, raw_code)
    margin_weekly = fetch_margin_weekly(session, raw_code, overview["shares_outstanding"])
    stockholders = fetch_stockholders(session, raw_code)

    return {
        "code": raw_code,
        "name": overview["name"],
        "market": overview["market"],
        "sector": overview["sector"],
        "market_cap": overview["market_cap"],
        "shares_outstanding": overview["shares_outstanding"],
        "overview_text": overview["overview_text"],
        "margin_weekly": margin_weekly,
        "stockholders": stockholders,
    }


def scrape() -> tuple[str, dict[str, dict]]:
    date_key, local_codes = load_target_codes()
    session = requests.Session()
    result: dict[str, dict] = {}
    for i, local_code in enumerate(local_codes):
        result[local_code] = build_detail_for_code(session, local_code)
        if i < len(local_codes) - 1:
            time.sleep(SLEEP_BETWEEN_STOCKS)
    return date_key, result


def save(date_key: str, result: dict[str, dict]) -> None:
    data = {}
    if OUT_FILE.exists():
        data = json.loads(OUT_FILE.read_text(encoding="utf-8"))
    data[date_key] = result
    OUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    OUT_FILE.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


if __name__ == "__main__":
    date_key, result = scrape()
    print(f"{date_key}: {len(result)}件")
    for code, d in result.items():
        print(f"  {code} {d['name']} 時価総額={d['market_cap']} 発行済={d['shares_outstanding']} margin_weeks={len(d['margin_weekly'])} holders={len(d['stockholders'])}")
    save(date_key, result)
    print(f"保存先: {OUT_FILE}")
