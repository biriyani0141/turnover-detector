"""売買代金履歴の保存・読み込み。data/ ディレクトリに日付ごとのJSONを保持する。"""

from __future__ import annotations
import json
import datetime
import os

DATA_DIR = os.path.join(os.path.dirname(__file__), "data")


def _prev_business_date(d: datetime.date) -> datetime.date:
    d -= datetime.timedelta(days=1)
    while d.weekday() >= 5:
        d -= datetime.timedelta(days=1)
    return d


def load_prev_data() -> dict[str, float]:
    """前営業日の売買代金データ {コード: 売買代金円} を返す。ファイルがなければ空dict。"""
    prev = _prev_business_date(datetime.date.today())
    path = os.path.join(DATA_DIR, f"{prev}.json")
    if not os.path.exists(path):
        return {}
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def save_today_data(stocks) -> str:
    """今日の売買代金をJSONに保存してパスを返す。"""
    os.makedirs(DATA_DIR, exist_ok=True)
    today = datetime.date.today().isoformat()
    path = os.path.join(DATA_DIR, f"{today}.json")
    data = {s.code: s.turnover for s in stocks if s.turnover is not None}
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    return path
