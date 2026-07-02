"""
kabutan.jp の日次「本日の【ストップ高／ストップ安】」記事から、
S高銘柄ごとの理由テキストをスクレイプする。

2段構え:
  1) https://s.kabutan.jp/market_news/?category_org_id=2 (材料カテゴリ)の
     直近フィードから当日の該当記事ID(/news/n.../)を特定
  2) https://s.kabutan.jp/news/marketnews/?b=<id> をパースし、
     div.monospaced 内の p.narrow を順に走査してS高銘柄一覧を抽出

kabutan.jp(PC版ドメイン)はAWS WAF Bot ControlにGitHub Actionsランナーの
IPがブロックされる(HTTP 405、Human Verificationページを返される)ことを
2026-07-02にCI実測で確認済みのため、ID解決も含め s.kabutan.jp のみで完結させる。

HTML構造はサイト改修で変わりうるので、想定と異なる箇所に当たったら
無言で skip せず、即エラーで気付けるようにする(理由データの欠落を
握りつぶさない)。今回は1ページ目(直近フィード)で見つからない場合も
ページネーションは行わずエラーにする(平日16:40/17:40 JST実行なら
記事発行(15:40頃)から1〜2h以内で1ページ目に収まることを実測確認済み)。

出力: data/jquants/stop-high-reasons.json に日付キーで追記していく。
  {"2026-07-02": {"265A0": {"status": "配分", "reason": "...", "orders": "..."}}}

コードキーは J-Quants LocalCode 形式(生コード+"0")に変換している。
ranking.json 等の既存データを全数チェックし、数字のみ/英字混在どちらの
コードも例外なく末尾"0"付き5文字形式であることを確認済み(りゅ確認済み、
2026-07-02)。
"""

import json
import re
import unicodedata
from pathlib import Path

import requests
from bs4 import BeautifulSoup

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) "
        "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 "
        "Mobile/15E148 Safari/604.1"
    ),
}

LIST_URL = "https://s.kabutan.jp/market_news/?category_org_id=2"
ARTICLE_URL = "https://s.kabutan.jp/news/marketnews/?b={article_id}"

OUT_FILE = Path(__file__).parent / "data" / "jquants" / "stop-high-reasons.json"

TITLE_PREFIX = "本日の【ストップ高／ストップ安】"
LIST_HEADER_MARK = "●ストップ高の銘柄一覧"
LIST_END_PREFIX = "以上、"

# 「配分」銘柄で、理由テキストと同じ行に注文情報が続けて書かれるケースがある
# (例: 「ネイス <589A> [東証Ｇ]　　　　配分　取引時間内に商い成立せず、9万5600株の買い注文を残す」)。
# 別行(継続行)に出るケースはコード無し行としてordersに入るが、
# 同一行に出るケースはこのパターンでreasonから分離してordersへ回す。
ORDER_INFO_RE = re.compile(r"取引時間内に商い成立せず、.*?(?:買い|売り)注文を残す")


class ScrapeError(RuntimeError):
    pass


def find_today_article_id(session: requests.Session) -> str:
    """材料カテゴリの直近フィード(1ページ目)から当日のS高/S安記事IDを特定する。"""
    r = session.get(LIST_URL, headers=HEADERS, timeout=10)
    r.raise_for_status()
    soup = BeautifulSoup(r.text, "html.parser")

    candidates: list[tuple[int, str]] = []
    for a in soup.select("a[href^='/news/n']"):
        title = a.get_text(strip=True)
        if not title.startswith(TITLE_PREFIX):
            continue
        if "引け" not in title:
            continue
        m = re.match(r"/news/(n\d+)/", a["href"])
        if not m:
            continue
        article_id = m.group(1)
        # n + YYYYMMDD + 連番。連番部分を数値化して最新判定に使う。
        sort_key = int(article_id[1:])
        candidates.append((sort_key, article_id))

    if not candidates:
        raise ScrapeError(
            f"{LIST_URL} の1ページ目に「本日の【ストップ高／ストップ安】...引け」"
            "に一致する記事が見つからない(ページネーション未対応)"
        )

    candidates.sort(key=lambda t: t[0])
    return candidates[-1][1]


def normalize_code(raw: str) -> str:
    """全角→半角正規化 + 大文字化。"""
    return unicodedata.normalize("NFKC", raw).upper()


def to_local_code(code: str) -> str:
    """kabutanの生コード(例: 265A / 5967)を J-Quants LocalCode形式に変換。"""
    return code + "0"


def parse_stophigh(html: str) -> dict[str, dict]:
    """S高銘柄一覧をパースして {local_code: {status, reason, orders}} を返す。"""
    soup = BeautifulSoup(html, "html.parser")
    container = soup.select_one("div.monospaced")
    if container is None:
        raise ScrapeError("div.monospaced が見つからない(サイト構造変更の疑い)")

    paragraphs = container.select("p")
    if not paragraphs:
        raise ScrapeError("div.monospaced 内に p タグが見つからない")

    state = "before"  # before -> header -> list -> done
    result: dict[str, dict] = {}
    current_key: str | None = None

    for p in paragraphs:
        text = p.get_text().strip()

        if state == "before":
            if text.startswith(LIST_HEADER_MARK):
                state = "header"
            continue

        if state == "header":
            # 「銘柄名　　現況　ニュース／主な株式テーマ」の列見出し行を読み飛ばす
            state = "list"
            continue

        if state == "list":
            if text.startswith(LIST_END_PREFIX):
                state = "done"
                break

            link = p.select_one("a.stockPopup")
            if link is None:
                # コード無し行 = 直前銘柄の補足(orders)
                if current_key is None:
                    raise ScrapeError(
                        f"先頭銘柄が確定する前に補足行が出現: {text!r}"
                    )
                prev = result[current_key]["orders"]
                result[current_key]["orders"] = (prev + " " + text).strip() if prev else text
                continue

            href = link.get("href", "")
            raw_code = href.strip("/").split("/")[-1]
            code = normalize_code(raw_code)
            local_code = to_local_code(code)

            marker = f"<{raw_code}>"
            if marker not in text:
                # 全角/半角ズレ等でマーカーが一致しない場合はエラーで気付けるようにする
                raise ScrapeError(f"コードマーカー{marker!r}が本文中に見つからない: {text!r}")
            name, _, rest = text.partition(marker)
            name = name.strip()

            m = re.match(r"\s*\[([^\]]*)\]\s*(.*)", rest, re.S)
            if not m:
                raise ScrapeError(f"市場区分の抽出に失敗: {rest!r}")
            _market, remainder = m.groups()  # 市場は除去(保持しない)

            status = None
            for s in ("配分", "一時"):
                if remainder.startswith(s):
                    status = s
                    remainder = remainder[len(s):]
                    break

            inline_order = ""
            order_match = ORDER_INFO_RE.search(remainder)
            if order_match:
                inline_order = order_match.group(0)
                remainder = (remainder[: order_match.start()] + remainder[order_match.end():])
            reason = remainder.strip(" 　")

            result[local_code] = {
                "name": name,
                "status": status,
                "reason": reason,
                "orders": inline_order,
            }
            current_key = local_code

    if state != "done":
        raise ScrapeError(
            f"「{LIST_END_PREFIX}」終端に到達せずパース終了(state={state})"
            "。サイト構造変更の疑い"
        )

    return result


def scrape(date_str: str | None = None) -> tuple[str, dict[str, dict]]:
    session = requests.Session()
    article_id = find_today_article_id(session)
    r = session.get(
        ARTICLE_URL.format(article_id=article_id), headers=HEADERS, timeout=10
    )
    r.raise_for_status()
    entries = parse_stophigh(r.text)

    # 記事IDの日付部分(YYYYMMDD)から日付キーを作る。date_str指定があればそちらを優先。
    m = re.match(r"n(\d{4})(\d{2})(\d{2})", article_id)
    if not m:
        raise ScrapeError(f"記事IDから日付を抽出できない: {article_id}")
    article_date = f"{m.group(1)}-{m.group(2)}-{m.group(3)}"
    date_key = date_str or article_date

    return date_key, entries


def save(date_key: str, entries: dict[str, dict]) -> None:
    data = {}
    if OUT_FILE.exists():
        data = json.loads(OUT_FILE.read_text(encoding="utf-8"))
    data[date_key] = entries
    OUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    OUT_FILE.write_text(
        json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8"
    )


if __name__ == "__main__":
    date_key, entries = scrape()
    print(f"{date_key}: {len(entries)}件")
    for code, e in entries.items():
        print(f"  {code} {e['name']} status={e['status']} reason={e['reason'][:30]} orders={e['orders'][:20]}")
    save(date_key, entries)
    print(f"保存先: {OUT_FILE}")
