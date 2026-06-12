"""
Yahoo!ファイナンス 売買代金ランキングのスクレイパー。

2段構え:
  1) 売買代金上位ランキングページ -> トップN銘柄の
     順位/コード/銘柄名/市場/取引値/前日比率/売買代金 を取得
  2) 各銘柄の個別ページ -> 時価総額を取得

HTML構造はサイト改修で変わりうるので、パースは複数の手がかりで
緩めに行い、取れなかった項目は None のままにして後段で除外する。
"""

import re
import time
import requests
from bs4 import BeautifulSoup
from dataclasses import dataclass, field

RANKING_URL = "https://finance.yahoo.co.jp/stocks/ranking/tradingValueHigh"
QUOTE_URL = "https://finance.yahoo.co.jp/quote/{code}.T"

HEADERS = {
    # 通常ブラウザを装う。Yahooはbot検出が緩いが礼儀として付ける。
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
    ),
    "Accept-Language": "ja,en;q=0.8",
}

# 取得間隔(秒)。相手サーバーへの配慮。短くしすぎないこと。
SLEEP_BETWEEN = 1.0


@dataclass
class Stock:
    rank: int
    code: str
    name: str
    market: str = ""
    price: float | None = None          # 取引値(円)
    change_pct: float | None = None     # 前日比率(%)
    turnover: float | None = None       # 売買代金(円)
    mktcap: float | None = None         # 時価総額(円)

    @property
    def turnover_oku(self) -> float | None:
        return None if self.turnover is None else self.turnover / 1e8

    @property
    def mktcap_oku(self) -> float | None:
        return None if self.mktcap is None else self.mktcap / 1e8

    @property
    def turnover_ratio(self) -> float | None:
        """回転率 = 売買代金 / 時価総額。"""
        if not self.turnover or not self.mktcap:
            return None
        return self.turnover / self.mktcap


def _to_float(s: str) -> float | None:
    if s is None:
        return None
    s = s.replace(",", "").replace("+", "").replace("円", "").strip()
    s = s.replace("%", "")
    try:
        return float(s)
    except ValueError:
        return None


def fetch_ranking(top_n: int = 50, market: str = "tokyo",
                  session: requests.Session | None = None) -> list[Stock]:
    """売買代金上位ランキングを top_n 件取得する。

    market: 'all' | 'tokyo' | 'nagoya' | 'sapporo' | 'fukuoka'
    1ページ50件。top_n>50なら次ページもたどる。
    """
    sess = session or requests.Session()
    stocks: list[Stock] = []
    page = 1
    while len(stocks) < top_n:
        params = {"market": market, "page": page}
        r = sess.get(RANKING_URL, params=params, headers=HEADERS, timeout=20)
        r.raise_for_status()
        soup = BeautifulSoup(r.text, "html.parser")
        rows = _parse_ranking_table(soup, start_rank=len(stocks) + 1)
        if not rows:
            break
        stocks.extend(rows)
        page += 1
        if page > 5:  # 安全弁
            break
        time.sleep(SLEEP_BETWEEN)
    return stocks[:top_n]


def _parse_ranking_table(soup: BeautifulSoup, start_rank: int) -> list[Stock]:
    out: list[Stock] = []
    # ランキングテーブルの行を拾う。quoteリンクを含む行=銘柄行。
    for a in soup.select('a[href*="/quote/"]'):
        href = a.get("href", "")
        m = re.search(r"/quote/([0-9A-Z]+)\.T", href)
        if not m:
            continue
        # 掲示板リンク(/forum)などは除外
        if "/forum" in href or "/bbs" in href:
            continue
        code = m.group(1)
        name = a.get_text(strip=True)
        if not name:
            continue
        # 同じ行(tr)を起点に数値セルを集める
        tr = a.find_parent("tr")
        if tr is None:
            continue
        cells = [td.get_text(" ", strip=True) for td in tr.find_all(["td", "th"])]
        joined = " ".join(cells)

        market = ""
        mk = re.search(r"東証(PRM|STD|GRT|ETF|REIT|\w+)", joined)
        if mk:
            market = "東証" + mk.group(1)

        # 前日比率 (例: +1.59% / -2.11% / +7.64 % ← スペースあり形式も対応)
        change_pct = None
        cm = re.search(r"([+\-]?\d+\.\d+)\s*%", joined)
        if cm:
            change_pct = _to_float(cm.group(1))

        # 売買代金: 行内で最大の整数(円, カンマ区切り) を採用
        nums = [int(x.replace(",", "")) for x in re.findall(r"\d[\d,]{6,}", joined)]
        turnover = float(max(nums)) if nums else None

        # 取引値: コード直後に出る価格らしき数値(小数1桁 or 整数)
        price = None
        pm = re.search(r"([\d,]+(?:\.\d+)?)\s*\d{2}/\d{2}", joined)
        if pm:
            price = _to_float(pm.group(1))

        # 重複(同一コードが複数リンクで出る)を防ぐ
        if any(s.code == code for s in out):
            continue
        out.append(Stock(
            rank=start_rank + len(out),
            code=code, name=name, market=market,
            price=price, change_pct=change_pct, turnover=turnover,
        ))
    return out


def _fetch_quote_page(code: str,
                      session: requests.Session) -> tuple[float | None, float | None]:
    """個別銘柄ページを取得し (時価総額円, 現在値円) を返す。失敗は None。"""
    url = QUOTE_URL.format(code=code)
    try:
        r = session.get(url, headers=HEADERS, timeout=20)
        r.raise_for_status()
    except requests.RequestException:
        return None, None
    text = BeautifulSoup(r.text, "html.parser").get_text(" ", strip=True)

    # 時価総額: 『時価総額 X,XXX百万円』等の表記を円に正規化
    mktcap = None
    m = re.search(r"時価総額\D{0,6}([\d,\.]+)\s*(兆|億|百万)?\s*円?", text)
    if m:
        val = _to_float(m.group(1))
        if val is not None:
            unit = m.group(2)
            if unit == "兆":    mktcap = val * 1e12
            elif unit == "億":  mktcap = val * 1e8
            elif unit == "百万": mktcap = val * 1e6
            else:               mktcap = val

    # 現在値: 「数値 前日比」パターン (Yahoo個別ページ: 「81,200 前日比 +5,760」)
    price = None
    pm = re.search(r"([\d,]+\.?\d*)\s+前日比", text)
    if pm:
        candidate = _to_float(pm.group(1))
        if candidate and 1 <= candidate <= 5_000_000:
            price = candidate

    return mktcap, price


def fetch_mktcap(code: str, session: requests.Session | None = None) -> float | None:
    """個別銘柄ページから時価総額(円)を取得する。"""
    sess = session or requests.Session()
    mktcap, _ = _fetch_quote_page(code, sess)
    return mktcap


def enrich_with_mktcap(stocks: list[Stock],
                       session: requests.Session | None = None) -> list[Stock]:
    """各銘柄に時価総額と現在値を付与する(個別ページを順に叩く)。"""
    sess = session or requests.Session()
    for s in stocks:
        mktcap, price = _fetch_quote_page(s.code, sess)
        s.mktcap = mktcap
        if price is not None:
            s.price = price
        time.sleep(SLEEP_BETWEEN)
    return stocks


if __name__ == "__main__":
    sess = requests.Session()
    ranking = fetch_ranking(top_n=50, market="tokyo", session=sess)
    print(f"ランキング取得: {len(ranking)}件")
    enrich_with_mktcap(ranking, session=sess)
    for s in ranking[:10]:
        tr = s.turnover_ratio
        print(f"{s.rank:>2} {s.code} {s.name[:10]:<10} "
              f"代金={s.turnover_oku and round(s.turnover_oku)}億 "
              f"時総={s.mktcap_oku and round(s.mktcap_oku)}億 "
              f"回転率={tr and round(tr*100,1)}%")
