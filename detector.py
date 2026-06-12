"""
回転率による異常値検出ロジック。

確定方針(プロトタイプ検証済み):
  - 売買代金上位N銘柄を母集団とする
  - 回転率 = 売買代金 / 時価総額 で降順ソート
  - 前日比率で上昇/下落を色分け
  - 回帰残差方式は母集団が上位50に絞られている時点で機能しないため不採用
"""

from dataclasses import dataclass
from scraper import Stock


@dataclass
class Signal:
    stock: Stock
    turnover_ratio: float   # 回転率(小数, 0.44 = 44%)
    direction: str          # "up" | "down" | "flat"


# 上昇/下落の判定しきい値(前日比率%)。これ以内はflat扱い。
FLAT_BAND = 1.0
# 回転率の下限フィルタ(これ未満は通知から除外)。0で無効。
MIN_TURNOVER_RATIO = 0.05  # 5%


def detect(stocks: list[Stock],
           top_k: int = 15,
           min_ratio: float = MIN_TURNOVER_RATIO) -> list[Signal]:
    """回転率の高い順に異常銘柄を抽出する。"""
    signals: list[Signal] = []
    for s in stocks:
        tr = s.turnover_ratio
        if tr is None or tr < min_ratio:
            continue
        if s.change_pct is None:
            direction = "flat"
        elif s.change_pct >= FLAT_BAND:
            direction = "up"
        elif s.change_pct <= -FLAT_BAND:
            direction = "down"
        else:
            direction = "flat"
        signals.append(Signal(stock=s, turnover_ratio=tr, direction=direction))

    signals.sort(key=lambda x: x.turnover_ratio, reverse=True)
    return signals[:top_k]


def format_lines(signals: list[Signal]) -> list[str]:
    """通知用の整形済み行リストを返す。"""
    arrow = {"up": "🔺", "down": "🔻", "flat": "▪️"}
    lines = []
    for i, sg in enumerate(signals, 1):
        s = sg.stock
        chg = "" if s.change_pct is None else f"{s.change_pct:+.2f}%"
        lines.append(
            f"{i:>2}. {arrow[sg.direction]} {s.code} {s.name[:12]}  "
            f"回転率{sg.turnover_ratio*100:.0f}%  "
            f"代金{(s.turnover_oku or 0):,.0f}億  "
            f"時総{(s.mktcap_oku or 0):,.0f}億  {chg}"
        )
    return lines
