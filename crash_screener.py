# -*- coding: utf-8 -*-
"""
暴落相対強度スクリーナー（強チェ統合版）

検証済みリポジトリ crash-relative-strength-screener の局面検出・特徴量ロジックを
強チェの日次バッチに統合する。役割は「暴落局面中の相対強度監視リスト生成」のみで、
予測評価・売買判断は行わない（表示ツールのためリーケージ対策は不要、全銘柄を
ありのまま表示する）。

定数・局面検出状態機械・特徴量/ラベル計算式は検証リポジトリの
screener.py / backtest.py と同一の値・同一のロジックを移植している
（ロジック再実装によるズレ禁止のため、可能な限り変更を加えていない）。
データソースのみ差し替え:
  - 日経225指数: yfinance ^N225（検証リポジトリと同じ）
  - 個別株OHLCV: data/jquants/daily/YYYY-MM-DD.json（強チェの既存蓄積、J-Quants V2）
  - 銘柄マスタ: data/jquants/meta.json（強チェの既存蓄積、J-Quants V2 listed_info相当）

判断ログ: 検証リポジトリの build_universe() は業種「医薬品」を除外していたが、
本仕様書は「医薬品を除外しない（表示対象に含める）」と明示しているため、
本モジュールの load_universe() では市場フィルタ(プライム/スタンダード/グロース)
のみを適用し、業種による除外は行わない。

出力:
  data/crash/crash_watchlist_{YYYYMMDD}.json  … 日次スナップショット（全日分保持）
  data/crash/crash_index.json                  … 局面一覧・日付一覧のインデックス
  data/crash/crash_latest.json                 … 最新スナップショットの複製
  crash_state.json（リポジトリ直下）            … IDLE/ACTIVE/COOLDOWN状態の永続化
"""
from __future__ import annotations

import argparse
import json
import logging
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import yfinance as yf

import crash_notify

# ============================================================
# 定数（検証リポジトリ screener.py / backtest.py と同一の値。変更していない）
# ============================================================
CRASH_DAY_THRESHOLD = -0.02      # 型A: 単日騰落率
DRAWDOWN_THRESHOLD = -0.08       # 型B: 累積DD
DRAWDOWN_LOOKBACK = 15           # 型B: DD到達猶予（営業日）
RECENT_HIGH_WINDOW = 20          # 直近高値の参照期間（営業日）
WINDOW_MAX_DAYS = 20             # 局面の最大長（営業日）
WINDOW_QUIET_DAYS = 3            # 終了条件: 新規トリガーなし連続日数
MERGE_GAP = 10                   # 局面統合: 終了判定後この営業日数以内の新規トリガーで延長統合
MIN_TOP_RET = 0.50               # 母集団の最低上昇率

INDEX_TICKER = "^N225"
PHASE_SEARCH_START = "2018-01-01"   # backtest.py の BACKTEST_SEARCH_START と同一
INDEX_FETCH_START = "2016-01-01"    # 型B判定(RECENT_HIGH_WINDOW/DRAWDOWN_LOOKBACK)の参照余裕分、探索開始日より前から取得

INCLUDE_MARKETS = {"プライム", "スタンダード", "グロース"}

# フロント[A]セクション判定用の閾値（仕様書: 「tier high × dist 15%以内」）
DIST_TO_HIGH_A_THRESHOLD = 0.15

REPO_ROOT = Path(__file__).parent
DATA_DIR = REPO_ROOT / "data"
DAILY_DIR = DATA_DIR / "jquants" / "daily"
META_PATH = DATA_DIR / "jquants" / "meta.json"
# 判断ログ: 出力先はリポジトリ直下data/ではなくweb/public/data/crash/にした。
# 理由: Vercelの本プロジェクトは「web/」をルートディレクトリとしてデプロイしており
# (web/.vercel/project.json)、既存のpopular.json等もすべてweb/public/data/配下に
# 置かれている。リポジトリ直下data/配下に置くとVercelのデプロイ物に含まれず、
# フロントエンドから参照できない。Basic認証で「素通りしない配置にする」仕様要件は
# middleware.tsのmatcherに/data/crash/を明示的に含めることで満たす(次項参照)。
CRASH_DIR = REPO_ROOT / "web" / "public" / "data" / "crash"
STATE_PATH = REPO_ROOT / "crash_state.json"

log = logging.getLogger("crash_screener")
log.setLevel(logging.INFO)


def setup_logging() -> None:
    if log.handlers:
        return
    log.addHandler(logging.StreamHandler(sys.stdout))
    log.propagate = False


DECISIONS: list[str] = []


def note_decision(msg: str) -> None:
    DECISIONS.append(msg)
    log.info("[判断ログ] %s", msg)


# ============================================================
# 共通関数（screener.pyと同一実装）
# ============================================================
def snap_to_trading_day(date, direction: str, trading_days: pd.DatetimeIndex) -> pd.Timestamp:
    """非取引日を最近接の取引日にスナップする。
    direction='forward' : date以降で最初の取引日
    direction='backward': date以前で最後の取引日
    """
    ts = pd.Timestamp(date)
    if direction == "forward":
        idx = trading_days.searchsorted(ts, side="left")
        if idx >= len(trading_days):
            return trading_days[-1]
        return trading_days[idx]
    elif direction == "backward":
        idx = trading_days.searchsorted(ts, side="right") - 1
        if idx < 0:
            return trading_days[0]
        return trading_days[idx]
    raise ValueError(f"unknown direction: {direction}")


def max_drawdown_high_low(high: pd.Series, low: pd.Series) -> float:
    if high.empty:
        return float("nan")
    running_peak = high.cummax()
    dd = low / running_peak - 1
    return dd.min()


def safe_qcut(series: pd.Series, labels: list[str]) -> pd.Series:
    """3分位分割する。母集団が小さい/値が重複しすぎてビンを作れない場合は
    分位不能として全てNaNを返す。"""
    try:
        return pd.qcut(series, len(labels), labels=labels, duplicates="drop")
    except (ValueError, IndexError):
        return pd.Series([np.nan] * len(series), index=series.index)


# ============================================================
# 1. 日経225指数取得（yfinance）
# ============================================================
def fetch_index(start: str = INDEX_FETCH_START, end: str | None = None) -> pd.DataFrame:
    """^N225 の日足を取得する。endを省略すると最新まで取得する。
    endを指定するとその日付(exclusive)までに固定でき、テストで再現性を持たせられる。"""
    kwargs = dict(start=start, auto_adjust=True, progress=False)
    if end is not None:
        kwargs["end"] = end
    df = yf.download(INDEX_TICKER, **kwargs)
    if isinstance(df.columns, pd.MultiIndex):
        df.columns = df.columns.droplevel(1)
    df = df.dropna(subset=["Close"])
    return df


# ============================================================
# 2. 局面検出（backtest.py の状態機械をそのまま移植）
# ============================================================
class CrashPhase:
    def __init__(self, start, end, crash_days, end_reason=None, extended=False, index_max_dd=None):
        self.start = start
        self.end = end
        self.crash_days = crash_days
        self.end_reason = end_reason
        self.extended = extended
        self.index_max_dd = index_max_dd


def compute_triggers(index_df: pd.DataFrame):
    trading_days = index_df.index
    close = index_df["Close"]
    open_ = index_df["Open"]
    high = index_df["High"]

    daily_ret = close.pct_change()
    type_a = (daily_ret <= CRASH_DAY_THRESHOLD) & (close < open_)

    type_b = pd.Series(False, index=trading_days)
    for i in range(len(trading_days)):
        if i < RECENT_HIGH_WINDOW - 1:
            continue
        window_high = high.iloc[i - RECENT_HIGH_WINDOW + 1:i + 1]
        high_pos = window_high.values.argmax()
        high_day_idx = i - RECENT_HIGH_WINDOW + 1 + high_pos
        if i - high_day_idx > DRAWDOWN_LOOKBACK:
            continue
        dd = close.iloc[i] / high.iloc[high_day_idx] - 1
        if dd <= DRAWDOWN_THRESHOLD:
            type_b.iloc[i] = True

    any_trigger = type_a | type_b
    return type_a, type_b, any_trigger


def _find_phase_end(start_idx, close, high, any_trigger, last_idx):
    """1局面の終了indexを状態機械で決定する。終了候補が出るたびに、
    候補+1〜+MERGE_GAP営業日以内に新規トリガーがあれば延長統合して走査を続ける。
    戻り値: (end_idx, end_reason, extended)
    end_reason=="データ末尾到達" は「まだ自然な終了条件に到達していない
    (=最新取引日時点で局面が進行中)」を意味し、当日ステータスをACTIVEと
    判定する材料に使う（classify_status参照）。
    """
    ref_high = high.iloc[max(0, start_idx - RECENT_HIGH_WINDOW):start_idx].max()
    i = start_idx
    quiet_count = 0
    extended = False
    hard_cap_idx = start_idx + WINDOW_MAX_DAYS - 1
    while True:
        if i > last_idx:
            return last_idx, "データ末尾到達", extended

        tentative = None
        reason = None
        if i > start_idx and close.iloc[i] >= ref_high:
            tentative, reason = i, "(i)高値回復"
        elif any_trigger.iloc[i]:
            quiet_count = 0
        else:
            quiet_count += 1
            if quiet_count >= WINDOW_QUIET_DAYS:
                tentative, reason = i, "(ii)新規トリガーなし3日"
            elif (not extended) and i >= hard_cap_idx:
                tentative, reason = i, "(iii)20営業日経過"

        if tentative is not None:
            lookahead_hi = min(tentative + MERGE_GAP, last_idx)
            merged = False
            if tentative + 1 <= lookahead_hi:
                window = any_trigger.iloc[tentative + 1:lookahead_hi + 1]
                if window.any():
                    merged = True
                    offset = int(np.argmax(window.values))
                    new_trigger_idx = tentative + 1 + offset
                    extended = True
                    quiet_count = 0
                    i = new_trigger_idx
            if merged:
                continue
            return tentative, reason, extended

        i += 1


def detect_all_crash_phases(index_df: pd.DataFrame, search_start_date: str) -> list[CrashPhase]:
    trading_days = index_df.index
    close = index_df["Close"]
    high = index_df["High"]
    type_a, type_b, any_trigger = compute_triggers(index_df)

    search_start = snap_to_trading_day(search_start_date, "forward", trading_days)
    search_start_idx = trading_days.searchsorted(search_start)
    last_idx = len(trading_days) - 1

    episodes: list[CrashPhase] = []
    i = search_start_idx
    while i <= last_idx:
        if not any_trigger.iloc[i]:
            i += 1
            continue
        start_idx = i
        end_idx, reason, extended = _find_phase_end(start_idx, close, high, any_trigger, last_idx)
        crash_days = [trading_days[j] for j in range(start_idx, end_idx + 1) if type_a.iloc[j]]
        idx_window = index_df.iloc[start_idx:end_idx + 1]
        idx_max_dd = max_drawdown_high_low(idx_window["High"], idx_window["Low"])

        phase = CrashPhase(trading_days[start_idx], trading_days[end_idx], crash_days,
                            end_reason=reason, extended=extended, index_max_dd=idx_max_dd)
        episodes.append(phase)
        i = end_idx + 1

    return episodes


def classify_status(episodes: list[CrashPhase], trading_days: pd.DatetimeIndex) -> tuple[str, CrashPhase | None]:
    """検出済み局面リストから当日時点のステータス(IDLE/ACTIVE/COOLDOWN)を判定する。
    判断ログ: 「ACTIVE中か」を判定する専用の状態機械は別途実装しない。
    detect_all_crash_phases (backtest.pyの_find_phase_end状態機械そのもの)を
    毎日、最新取引日までの指数データでフル再実行し、その結果だけから導出する
    (二重実装によるロジックのズレを避けるため。再実行コストは^N225単銘柄なので無視できる)。
    ACTIVE   : 最新局面の終了indexが最新取引日と一致し、終了理由が「データ末尾到達」
               (=自然な終了条件にまだ到達していない、局面が進行中)の場合。
    COOLDOWN : 最新局面が自然に終了済み(終了理由が(i)/(ii)/(iii))で、
               終了からMERGE_GAP営業日以内(再トリガーで統合され得る猶予期間)。
    IDLE     : 局面が一つもない、または最後の局面終了からMERGE_GAPを超えて経過。
    """
    if not episodes:
        return "IDLE", None
    last_idx = len(trading_days) - 1
    last = episodes[-1]
    end_idx = trading_days.searchsorted(last.end)
    if end_idx == last_idx and last.end_reason == "データ末尾到達":
        return "ACTIVE", last
    gap = last_idx - end_idx
    if gap <= MERGE_GAP:
        return "COOLDOWN", last
    return "IDLE", last


# ============================================================
# 3. 母集団生成（screener.py compute_universe_returns / build_population を移植。無変更）
# ============================================================
def compute_universe_returns(
    universe: pd.DataFrame, price_data: dict[str, pd.DataFrame], trading_days: pd.DatetimeIndex,
    base_date: pd.Timestamp,
) -> pd.DataFrame:
    """base_date は snap_to_trading_day 済みの取引日を渡すこと。"""
    first_of_year = snap_to_trading_day(f"{base_date.year}-01-01", "forward", trading_days)
    base_idx = trading_days.searchsorted(base_date)
    ref_120_idx = base_idx - 120
    ref_120_date = trading_days[ref_120_idx] if ref_120_idx >= 0 else None

    rows = []
    for _, r in universe.iterrows():
        code = r["code"]
        df = price_data.get(code)
        if df is None or df.empty:
            continue
        close = df["Close"]

        base_price = close.get(base_date)
        if base_price is None or pd.isna(base_price):
            near = close[close.index <= base_date]
            base_price = near.iloc[-1] if not near.empty else None
        if base_price is None or pd.isna(base_price):
            continue

        first_price = close.get(first_of_year)
        if first_price is None or pd.isna(first_price):
            near = close[close.index >= first_of_year]
            first_price = near.iloc[0] if not near.empty else None
        ytd_return = (base_price / first_price - 1) if first_price else np.nan

        ret_120d = np.nan
        if ref_120_date is not None and close.index.min() <= ref_120_date:
            p120 = close.get(ref_120_date)
            if p120 is None or pd.isna(p120):
                near = close[close.index <= ref_120_date]
                p120 = near.iloc[-1] if not near.empty else None
            if p120:
                ret_120d = base_price / p120 - 1

        if pd.isna(ret_120d):
            top_ret = ytd_return
        else:
            top_ret = max(ytd_return, ret_120d)

        rows.append({
            "code": code, "name": r["name"], "sector": r["sector"],
            "ytd_return": ytd_return, "ret_120d": ret_120d, "top_ret": top_ret,
        })

    return pd.DataFrame(rows)


def build_population(universe_returns: pd.DataFrame) -> pd.DataFrame:
    pop = universe_returns[universe_returns["top_ret"] >= MIN_TOP_RET].copy()
    log.info("母集団サイズ(top_ret>=%.2f): %d件", MIN_TOP_RET, len(pop))
    return pop.reset_index(drop=True)


# ============================================================
# 4. 特徴量（screener.py compute_features を移植。バックテスト専用列(excess_return_d{i}等)は
#    仕様書のライブ監視用フィールド一覧に含まれないため、後段で不使用のまま捨てる。
#    計算式自体は無変更）
# ============================================================
def compute_features(
    pop: pd.DataFrame, price_data: dict[str, pd.DataFrame], index_df: pd.DataFrame,
    phase: CrashPhase, trading_days: pd.DatetimeIndex, base_date: pd.Timestamp,
) -> pd.DataFrame:
    start_idx = trading_days.searchsorted(phase.start)
    day_before_start = trading_days[start_idx - 1]

    idx_close = index_df["Close"]
    idx_ret_at_bds = idx_close.loc[day_before_start]
    idx_ret_at_end = idx_close.loc[phase.end]
    idx_cum_ret = idx_ret_at_end / idx_ret_at_bds - 1

    daily_idx_ret = idx_close.pct_change()

    feature_rows = []
    excluded_codes = []

    for _, r in pop.iterrows():
        code = r["code"]
        df = price_data.get(code)
        if df is None or df.empty:
            excluded_codes.append(code)
            continue
        close = df["Close"]

        if day_before_start not in close.index or phase.end not in close.index:
            excluded_codes.append(code)
            continue

        stock_cum_ret = close.loc[phase.end] / close.loc[day_before_start] - 1
        cum_excess_return = stock_cum_ret - idx_cum_ret

        daily_stock_ret = close.pct_change()

        strong_day_count = 0
        for d in phase.crash_days:
            if d not in close.index or d not in daily_idx_ret.index:
                continue
            sret = daily_stock_ret.get(d, np.nan)
            iret = daily_idx_ret.get(d, np.nan)
            if pd.isna(sret) or pd.isna(iret):
                continue
            if sret > iret:
                strong_day_count += 1

        ma25 = close.rolling(25).mean()
        ma25_at_base = ma25.get(base_date, np.nan)
        close_at_base = close.get(base_date, np.nan)
        ma25_deviation = (close_at_base / ma25_at_base - 1) if (not pd.isna(ma25_at_base) and ma25_at_base) else np.nan

        high = df["High"]
        base_pos = close.index.searchsorted(base_date)
        lookback_start = max(0, base_pos - 251)
        window_52w = high.iloc[lookback_start:base_pos + 1]
        if not window_52w.empty:
            high_52w_pos = window_52w.values.argmax()
            days_from_52w_high = base_pos - (lookback_start + high_52w_pos)
        else:
            days_from_52w_high = np.nan

        feature_rows.append({
            "code": code,
            "cum_excess_return": cum_excess_return,
            "strong_day_count": strong_day_count,
            "ma25_deviation": ma25_deviation,
            "days_from_52w_high": days_from_52w_high,
        })

    if excluded_codes:
        log.warning("特徴量計算で除外(局面前後の価格データ欠損): %d件 %s",
                     len(excluded_codes), excluded_codes[:20])

    # 判断ログ: feature_rowsが0件(価格データ欠損等で全銘柄除外)の場合、
    # pd.DataFrame([])は列を一つも持たないため後続のmerge(on="code")がKeyErrorになる。
    # screener.py本体では想定されていなかった空集合ケースへの防御として、
    # 列名を明示したDataFrameを返すガードを追加した(計算式自体は無変更)。
    if not feature_rows:
        return pd.DataFrame(columns=["code", "cum_excess_return", "strong_day_count",
                                      "ma25_deviation", "days_from_52w_high", "tier"]), excluded_codes

    feat_df = pd.DataFrame(feature_rows)
    feat_df["tier"] = safe_qcut(feat_df["cum_excess_return"], ["low", "mid", "high"])
    return feat_df, excluded_codes


# ============================================================
# 5. pre_crash_high / already_recovered（screener.py compute_labels を移植。
#    フォワードラベル(is_winner等)は局面終了後の未来データが前提のため、
#    ACTIVE中(phase.end=当日)に呼ぶと degenerate な値(0/NaN)になるが、
#    pre_crash_high/already_recoveredの計算式自体には影響しないためそのまま流用する）
# ============================================================
def compute_pre_crash_high(
    pop: pd.DataFrame, price_data: dict[str, pd.DataFrame], phase: CrashPhase, trading_days: pd.DatetimeIndex
) -> pd.DataFrame:
    start_idx = trading_days.searchsorted(phase.start)
    pre_window = trading_days[max(0, start_idx - RECENT_HIGH_WINDOW):start_idx]

    rows = []
    for _, r in pop.iterrows():
        code = r["code"]
        df = price_data.get(code)
        if df is None or df.empty:
            continue
        high = df["High"]
        close = df["Close"]

        pre_high_vals = high.reindex(pre_window).dropna()
        if pre_high_vals.empty:
            continue
        pre_crash_high = pre_high_vals.max()

        during_window = high.loc[phase.start:phase.end]
        already_recovered = bool((during_window > pre_crash_high).any()) if not during_window.empty else False

        close_today = close.get(phase.end)
        if close_today is None or pd.isna(close_today):
            near = close[close.index <= phase.end]
            close_today = near.iloc[-1] if not near.empty else np.nan

        rows.append({
            "code": code,
            "pre_crash_high": pre_crash_high,
            "already_recovered": already_recovered,
            "close": close_today,
        })

    if not rows:
        return pd.DataFrame(columns=["code", "pre_crash_high", "already_recovered", "close"])
    return pd.DataFrame(rows)


# ============================================================
# 6. データソース: 銘柄マスタ・日足（強チェの既存蓄積を利用）
# ============================================================
def load_universe() -> pd.DataFrame:
    """data/jquants/meta.json の stocks からプライム/スタンダード/グロースの
    銘柄マスタを構築する（医薬品は除外しない。冒頭の判断ログ参照）。"""
    meta = json.loads(META_PATH.read_text(encoding="utf-8"))
    rows = []
    for code, s in meta.get("stocks", {}).items():
        if s.get("market") not in INCLUDE_MARKETS:
            continue
        rows.append({"code": code, "name": s.get("name", ""), "sector": s.get("sector33", "")})
    df = pd.DataFrame(rows)
    log.info("銘柄マスタ(プライム/スタンダード/グロース): %d件", len(df))
    return df


def load_price_data(codes: set[str], start_date: str, end_date: str) -> dict[str, pd.DataFrame]:
    """data/jquants/daily/YYYY-MM-DD.json を start_date〜end_date(共に文字列'YYYY-MM-DD'、
    両端含む)の範囲で走査し、銘柄コードごとに Open/High/Low/Close/Volume の
    日足DataFrameを組み立てる。調整済み値(AdjO/AdjH/AdjL/AdjC/AdjVo)を使用する
    (検証リポジトリのyfinance auto_adjust=Trueと対応させるため)。"""
    files = sorted(DAILY_DIR.glob("*.json"))
    records: dict[str, list[dict]] = {}
    for f in files:
        date_str = f.stem
        if date_str < start_date or date_str > end_date:
            continue
        try:
            day = json.loads(f.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            continue
        for code, rec in day.items():
            if code not in codes:
                continue
            c = rec.get("AdjC")
            if c is None:
                continue
            records.setdefault(code, []).append({
                "date": date_str,
                "Open": rec.get("AdjO"), "High": rec.get("AdjH"),
                "Low": rec.get("AdjL"), "Close": c, "Volume": rec.get("AdjVo"),
            })

    price_data: dict[str, pd.DataFrame] = {}
    for code, recs in records.items():
        df = pd.DataFrame(recs)
        df["date"] = pd.to_datetime(df["date"])
        df = df.set_index("date").sort_index()
        price_data[code] = df
    log.info("日足読み込み: %d銘柄 (%s〜%s)", len(price_data), start_date, end_date)
    return price_data


# ============================================================
# 7. 状態(crash_state.json)の読み書き
# ============================================================
def load_state() -> dict:
    if not STATE_PATH.exists():
        return {"status": "IDLE", "phase_start": None, "population": None}
    try:
        return json.loads(STATE_PATH.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        log.warning("crash_state.json 読込失敗。直近の正常コミットからの再構築が必要な可能性がある。IDLE状態から再開する。")
        return {"status": "IDLE", "phase_start": None, "population": None}


def save_state(state: dict) -> None:
    STATE_PATH.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")


# ============================================================
# 8. セクション分類（S/A/B/C/D、仕様書のページ①表示区分）
# ============================================================
def classify_section(tier: str, dist_to_high: float, already_recovered: bool) -> str:
    if already_recovered:
        return "S"
    if pd.isna(dist_to_high):
        near = False
    else:
        near = dist_to_high <= DIST_TO_HIGH_A_THRESHOLD
    if tier == "high":
        return "A" if near else "B"
    if tier == "mid":
        return "B" if near else "C"
    return "D"  # tier == "low" (NaN tierも含めて全表示のためD扱い)


# ============================================================
# 9. スナップショット組み立て
# ============================================================
def build_watchlist_rows(
    pop: pd.DataFrame, price_data: dict[str, pd.DataFrame], index_df: pd.DataFrame,
    phase: CrashPhase, trading_days: pd.DatetimeIndex, base_date: pd.Timestamp,
) -> list[dict]:
    features, _excluded = compute_features(pop, price_data, index_df, phase, trading_days, base_date)
    pre_high = compute_pre_crash_high(pop, price_data, phase, trading_days)

    detail = pop.merge(features, on="code", how="inner").merge(pre_high, on="code", how="inner")

    rows = []
    for _, r in detail.iterrows():
        close = r["close"]
        pre_crash_high = r["pre_crash_high"]
        dist_to_high = (pre_crash_high / close - 1) if (close and not pd.isna(close) and pre_crash_high) else np.nan
        tier = r["tier"] if not pd.isna(r["tier"]) else None
        section = classify_section(tier, dist_to_high, bool(r["already_recovered"]))
        rows.append({
            "code": r["code"],
            "name": r["name"],
            "sector": r["sector"],
            "close": None if pd.isna(close) else round(float(close), 2),
            "top_ret": None if pd.isna(r["top_ret"]) else round(float(r["top_ret"]), 4),
            "cum_excess_return": None if pd.isna(r["cum_excess_return"]) else round(float(r["cum_excess_return"]), 4),
            "tier": tier,
            "strong_day_count": int(r["strong_day_count"]),
            "dist_to_high": None if pd.isna(dist_to_high) else round(float(dist_to_high), 4),
            "already_recovered": bool(r["already_recovered"]),
            "ma25_deviation": None if pd.isna(r["ma25_deviation"]) else round(float(r["ma25_deviation"]), 4),
            "days_from_52w_high": None if pd.isna(r["days_from_52w_high"]) else int(r["days_from_52w_high"]),
            "pre_crash_high": None if pd.isna(pre_crash_high) else round(float(pre_crash_high), 2),
            "section": section,
        })
    # [S]→[A]→[B]→[C]→[D]、各区分内はcum_excess_return降順(強い順)
    section_order = {"S": 0, "A": 1, "B": 2, "C": 3, "D": 4}
    rows.sort(key=lambda x: (section_order[x["section"]], -(x["cum_excess_return"] or -999)))
    return rows


# ============================================================
# 10. メインバッチ
# ============================================================
def run_batch() -> dict:
    setup_logging()
    CRASH_DIR.mkdir(parents=True, exist_ok=True)

    log.info("--- 日経225指数取得 ---")
    index_df = fetch_index()
    trading_days = index_df.index
    today = trading_days[-1]
    today_str = today.date().isoformat()
    compact_date = today.strftime("%Y%m%d")
    log.info("指数データ最新: %s (%d営業日, %s〜)", today_str, len(index_df), trading_days[0].date())

    log.info("--- 局面検出(全履歴, %s〜) ---", PHASE_SEARCH_START)
    episodes = detect_all_crash_phases(index_df, PHASE_SEARCH_START)
    status, phase = classify_status(episodes, trading_days)
    log.info("当日ステータス: %s", status)

    state = load_state()
    prev_status = state.get("status", "IDLE")

    snapshot: dict = {
        "date": today_str,
        "status": status,
        "phase": None,
        "stocks": [],
    }

    if phase is not None:
        start_idx = trading_days.searchsorted(phase.start)
        day_index = trading_days.searchsorted(today) - start_idx + 1
        snapshot["phase"] = {
            "start": phase.start.date().isoformat(),
            "end_reason": phase.end_reason,
            "crash_day_count": len(phase.crash_days),
            "index_max_dd": None if phase.index_max_dd is None or pd.isna(phase.index_max_dd) else round(float(phase.index_max_dd), 4),
            "day_index": int(day_index),
        }

    if status == "ACTIVE":
        phase_start_str = phase.start.date().isoformat()
        cached_pop = state.get("population")
        if cached_pop and state.get("phase_start") == phase_start_str:
            log.info("母集団はキャッシュ済み(局面開始=%s)のものを再利用: %d銘柄", phase_start_str, len(cached_pop["codes"]))
            base_date = pd.Timestamp(cached_pop["base_date"])
            pop_codes = set(cached_pop["codes"])
            universe = load_universe()
            pop = universe[universe["code"].isin(pop_codes)].copy()
            # top_ret/ytd_return/ret_120dはbase_date時点で再計算(キャッシュしているのはcode一覧のみ)
            universe_returns = compute_universe_returns(pop, load_price_data(
                set(pop["code"]), _price_window_start(base_date), today_str
            ), trading_days, base_date)
            pop = universe_returns
        else:
            start_idx = trading_days.searchsorted(phase.start)
            base_date = trading_days[start_idx - 1]
            log.info("--- 新規局面。母集団を確定(BASE_DATE=%s) ---", base_date.date())
            universe = load_universe()
            price_data_for_pop = load_price_data(
                set(universe["code"]), _price_window_start(base_date), base_date.date().isoformat()
            )
            universe_returns = compute_universe_returns(universe, price_data_for_pop, trading_days, base_date)
            pop = build_population(universe_returns)
            state["population"] = {
                "base_date": base_date.date().isoformat(),
                "codes": pop["code"].tolist(),
            }
            state["phase_start"] = phase_start_str
            note_decision(
                f"局面開始{phase_start_str}を検知し、母集団(BASE_DATE={base_date.date()}時点top_ret>=0.50、"
                f"{len(pop)}銘柄)をcrash_state.jsonに確定・キャッシュした。仕様書「局面開始時に1回確定」に従い、"
                f"以後この局面が続く間は日々再計算しない。"
            )

        if pop.empty:
            log.warning("母集団0件。stocksは空のまま出力する。")
        else:
            price_data = load_price_data(
                set(pop["code"]), _price_window_start(base_date), today_str
            )
            snapshot["population_base_date"] = base_date.date().isoformat()
            snapshot["stocks"] = build_watchlist_rows(pop, price_data, index_df, phase, trading_days, base_date)
            log.info("watchlist行数: %d", len(snapshot["stocks"]))

    # --- 通知用の局面開始/終了エッジ検出 ---
    transition = None
    if prev_status != "ACTIVE" and status == "ACTIVE":
        transition = "start"
    elif prev_status == "ACTIVE" and status != "ACTIVE":
        transition = "end"

    # --- state更新 ---
    state["status"] = status
    if status != "ACTIVE":
        state["phase_start"] = None
        state["population"] = None
    save_state(state)

    # --- 出力 ---
    _write_snapshot(snapshot, compact_date)
    _update_index(episodes, today_str)

    # --- Discord通知(局面開始/終了) ---
    if transition == "start" and snapshot["phase"] is not None:
        top_a = [s for s in snapshot["stocks"] if s["section"] == "A"][:10]
        try:
            crash_notify.notify_phase_start(None, snapshot["phase"], top_a)
        except Exception as e:
            log.warning("局面開始通知の送信に失敗: %s", e)
    elif transition == "end" and snapshot["phase"] is not None:
        try:
            crash_notify.notify_phase_end(None, snapshot["phase"])
        except Exception as e:
            log.warning("局面終了通知の送信に失敗: %s", e)

    log.info("=== 完了 === ステータス=%s 局面遷移=%s", status, transition)
    print("\n=== 判断ログサマリ ===")
    if DECISIONS:
        for d in DECISIONS:
            print(f"- {d}")
    else:
        print("(なし)")

    return {"status": status, "transition": transition, "snapshot": snapshot}


def _price_window_start(base_date: pd.Timestamp) -> str:
    """top_ret(120営業日/年初来)・ma25・52週高値の参照に必要な過去データの
    読み込み開始日。base_dateから遡って十分な暦日バッファ(400日)を確保する。"""
    return (base_date - pd.Timedelta(days=400)).date().isoformat()


def _write_snapshot(snapshot: dict, compact_date: str) -> None:
    dated_path = CRASH_DIR / f"crash_watchlist_{compact_date}.json"
    dated_path.write_text(json.dumps(snapshot, ensure_ascii=False, indent=2), encoding="utf-8")
    latest_path = CRASH_DIR / "crash_latest.json"
    latest_path.write_text(json.dumps(snapshot, ensure_ascii=False, indent=2), encoding="utf-8")
    log.info("スナップショット出力: %s / crash_latest.json", dated_path.name)


def _update_index(episodes: list[CrashPhase], today_str: str) -> None:
    """dates は DateSelector.tsx(ISO 'YYYY-MM-DD'文字列比較)との互換のためISO形式で保持する。
    スナップショットファイル名自体は_write_snapshotが別途compact_date('YYYYMMDD')で命名する。"""
    index_path = CRASH_DIR / "crash_index.json"
    if index_path.exists():
        try:
            idx = json.loads(index_path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            idx = {"dates": [], "phases": []}
    else:
        idx = {"dates": [], "phases": []}

    if today_str not in idx["dates"]:
        idx["dates"].append(today_str)
        idx["dates"].sort()

    idx["phases"] = [
        {
            "start": ep.start.date().isoformat(),
            "end": ep.end.date().isoformat(),
            "end_reason": ep.end_reason,
            "crash_day_count": len(ep.crash_days),
            "index_max_dd": None if ep.index_max_dd is None or pd.isna(ep.index_max_dd) else round(float(ep.index_max_dd), 4),
        }
        for ep in episodes
    ]
    index_path.write_text(json.dumps(idx, ensure_ascii=False, indent=2), encoding="utf-8")
    log.info("crash_index.json 更新完了 (dates=%d件, phases=%d件)", len(idx["dates"]), len(idx["phases"]))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("command", nargs="?", default="run", choices=["run"])
    parser.parse_args()
    run_batch()


if __name__ == "__main__":
    main()
