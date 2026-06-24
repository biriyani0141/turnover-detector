"""
時価総額・回転率・多期間リターン・25日線乖離・出現履歴DB算出モジュール（本体A〜E）
pandas / SQLite 不使用。標準 json のみ。
元データファイル(backbone/meta/daily)への書き込み禁止。
"""
from __future__ import annotations
import json
import datetime
import shutil
from pathlib import Path
from jquants_backbone import calc_returns

APPEARANCE_FILE = Path(__file__).parent / "data" / "jquants" / "appearance.json"
RANKING_FILE    = Path(__file__).parent / "data" / "jquants" / "ranking.json"
RANKING_FILE_WEB = Path(__file__).parent / "web" / "public" / "data" / "ranking.json"

META_FILE  = Path(__file__).parent / "data" / "jquants" / "meta.json"
DAILY_DIR  = Path(__file__).parent / "data" / "jquants" / "daily"


def _to_ranking_row(r: dict) -> dict:
    return {
        "code":         r["code"],
        "name":         r["name"],
        "market":       r["market"],
        "turnover_pct": r["turnover_pct"],
        "mktcap":       r["mktcap"],
        "va":           r["va"],
        "C":            r["C"],
        "ret_1d":       r["1d"],
        "ret_5d":       r["5d"],
        "ret_1m":       r["1m"],
        "ret_3m":       r["3m"],
        "ret_1y":       r["1y"],
        "sma25_dev":    r["sma25_dev"],
    }


# ── shares 取得（A/B案共通エントリ） ────────────────────────────────────────────
def get_latest_shares(stock: dict, target_date: str | None = None) -> int | None:
    """
    target_date=None  → A案: shares配列の末尾 value（既存動作を維持）
    target_date指定   → B案: target_date以前で最大 date の value (as-of)
    """
    shares = stock.get("shares", [])
    if not shares:
        return None
    if target_date is None:
        return shares[-1]["value"]
    valid = [e for e in shares if e["date"] <= target_date]
    if not valid:
        return None
    return max(valid, key=lambda e: e["date"])["value"]


# ── 分割/併合イベントインデックス構築 ────────────────────────────────────────────
def build_split_events(daily_files: list[Path]) -> dict[str, list[tuple[str, float]]]:
    """
    全 daily ファイルから AdjustmentFactor != 1.0 の日をコード別に収集。
    戻り値: {code: [(date, adjf), ...]} 日付昇順。
    呼び出し元から daily_files を受け取ることで走査範囲を明示的に制御する。
    """
    events: dict[str, list[tuple[str, float]]] = {}
    for f in daily_files:
        date = f.stem
        data = json.loads(f.read_text(encoding="utf-8"))
        for code, rec in data.items():
            adjf_raw = rec.get("AdjFactor")
            if adjf_raw is None:
                continue
            try:
                adjf = float(adjf_raw)
            except (TypeError, ValueError):
                continue
            if adjf != 1.0:
                if code not in events:
                    events[code] = []
                events[code].append((date, adjf))
    for code in events:
        events[code].sort()
    return events


def get_adjusted_shares(
    code: str,
    as_of_date: str,
    stock: dict,
    split_events: dict[str, list[tuple[str, float]]],
) -> float | None:
    """
    shares配列の as_of_date 以前最新エントリを基点とし、
    その後に発生した分割/併合の累積補正係数を適用した発行済株数を返す。

    adjusted_shares = raw_shares / cum_factor
    （例: 5分割は AdjFactor=0.2 が1回 → cum_factor=0.2 → adjusted = raw × 5）
    併合(AdjFactor>1)や複数回分割も積で自然に処理される。

    戻り値 None のケース（mktcap は None として扱う）:
      - shares配列が空（IPO直後で株数データ未取得）
      - as_of_date 以前に shares エントリが存在しない
    """
    shares_arr = stock.get("shares", [])
    if not shares_arr:
        return None
    valid = [e for e in shares_arr if e["date"] <= as_of_date]
    if not valid:
        return None
    last_entry = max(valid, key=lambda e: e["date"])
    raw_shares: float = last_entry["value"]
    shares_asof: str = last_entry["date"]

    events = split_events.get(code, [])
    cum_factor = 1.0
    for date, adjf in events:
        if shares_asof < date <= as_of_date:
            cum_factor *= adjf

    if cum_factor == 0:
        return None
    return raw_shares / cum_factor


# ── 最新営業日の日足を Code→C / Code→Va マップとして読む ──────────────────────
def _latest_daily_close() -> tuple[str, dict[str, float], dict[str, float]]:
    """
    data/jquants/daily/ の最大日付ファイルを読み、
    (日付文字列, {Code: 生終値C}, {Code: Va売買代金}) を返す。
    """
    json_files = sorted(DAILY_DIR.glob("*.json"))
    if not json_files:
        raise RuntimeError(f"日足ファイルが見つかりません: {DAILY_DIR}")
    latest_path = json_files[-1]
    date_str = latest_path.stem

    raw = json.loads(latest_path.read_text(encoding="utf-8"))
    code_to_close: dict[str, float] = {}
    code_to_va: dict[str, float] = {}
    for code, rec in raw.items():
        c = rec.get("C")
        if c is not None:
            try:
                code_to_close[code] = float(c)
            except (TypeError, ValueError):
                pass
        va = rec.get("Va")
        if va is not None:
            try:
                code_to_va[code] = float(va)
            except (TypeError, ValueError):
                pass
    return date_str, code_to_close, code_to_va


# ── 25日線乖離（AdjCベース） ─────────────────────────────────────────────────────
def _calc_sma25_deviation(target_codes: set[str]) -> dict[str, float | None]:
    """
    直近25営業日の AdjC から SMA25 を算出し、乖離率% を返す。
    25日分データが揃わない銘柄は None。JOINはCode完全一致のみ。
    """
    json_files = sorted(DAILY_DIR.glob("*.json"))
    recent_files = json_files[-25:] if len(json_files) >= 25 else json_files

    adjc_series: dict[str, list[float]] = {code: [] for code in target_codes}
    for path in recent_files:
        data = json.loads(path.read_text(encoding="utf-8"))
        for code in target_codes:
            rec = data.get(code)
            if rec is None:
                continue
            adj_c = rec.get("AdjC")
            if adj_c is not None:
                try:
                    adjc_series[code].append(float(adj_c))
                except (TypeError, ValueError):
                    pass

    result: dict[str, float | None] = {}
    for code in target_codes:
        series = adjc_series[code]
        if len(series) < 25:
            result[code] = None
            continue
        sma25 = sum(series) / 25
        latest_adj_c = series[-1]
        if sma25 == 0:
            result[code] = None
            continue
        result[code] = round((latest_adj_c - sma25) / sma25 * 100, 2)

    return result


# ── メイン: 時価総額算出 + 検証出力 ─────────────────────────────────────────────
def main(split_events: dict[str, list[tuple[str, float]]]) -> None:
    # meta.json 読み込み
    if not META_FILE.exists():
        print(f"エラー: meta.json が見つかりません: {META_FILE}")
        raise SystemExit(1)
    meta = json.loads(META_FILE.read_text(encoding="utf-8"))
    stocks: dict[str, dict] = meta["stocks"]

    # 対象銘柄絞り込み: prodcat=="011" かつ shares 1件以上
    targets = {
        code: s
        for code, s in stocks.items()
        if s.get("prodcat") == "011" and s.get("shares")
    }
    print(f"対象銘柄（prodcat=011 かつ shares有り）: {len(targets)} 件")

    # 最新日足 読み込み
    date_str, code_to_close, code_to_va = _latest_daily_close()
    print(f"最新営業日: {date_str}  日足銘柄数: {len(code_to_close)} 件\n")

    # 時価総額計算
    results: list[dict] = []
    skip_no_close = 0

    for code, stock in targets.items():
        shares = get_adjusted_shares(code, date_str, stock, split_events)
        if shares is None:
            skip_no_close += 1
            continue

        c = code_to_close.get(code)
        if c is None:
            skip_no_close += 1
            continue

        mktcap = c * shares
        results.append({
            "code":   code,
            "name":   stock.get("name", ""),
            "C":      c,
            "shares": shares,
            "mktcap": mktcap,
            "va":     code_to_va.get(code),
        })

    # 降順ソート
    results.sort(key=lambda x: x["mktcap"], reverse=True)

    # ── 上位30件 出力 ─────────────────────────────────────────────────────────
    print("=" * 80)
    print(f"【時価総額 上位30件】基準日: {date_str}")
    print(f"{'順位':>4}  {'Code':>6}  {'名前':<20}  {'終値C':>10}  {'発行済株数':>16}  {'時価総額(億円)':>14}")
    print("-" * 80)
    for i, r in enumerate(results[:30], 1):
        mktcap_oku = r["mktcap"] / 1e8
        print(
            f"{i:>4}  {r['code']:>6}  {r['name']:<20}  "
            f"{r['C']:>10.1f}  {r['shares']:>16,}  {mktcap_oku:>14,.1f}"
        )

    # ── 指定有名銘柄 出力 ─────────────────────────────────────────────────────
    TARGET_CODES = [
        ("72030", "トヨタ"),
        ("99840", "SBG"),
        ("65010", "ソニーG/日立？"),
        ("83060", "三菱UFJ"),
        ("99830", "ファストリ"),
        ("63670", "ダイキン"),
        ("67580", "ソニーG"),
    ]
    # Codeをキーにした結果マップ
    result_map = {r["code"]: r for r in results}

    print()
    print("=" * 80)
    print("【指定有名銘柄の時価総額】")
    print(f"{'Code':>6}  {'指定名':>14}  {'登録名':<20}  {'終値C':>10}  {'発行済株数':>16}  {'時価総額(億円)':>14}")
    print("-" * 80)
    for code, label in TARGET_CODES:
        r = result_map.get(code)
        if r is None:
            # 日足にないか対象外
            stock = stocks.get(code)
            if stock is None:
                print(f"{code:>6}  {label:>14}  {'(meta未登録)':20}  {'---':>10}  {'---':>16}  {'---':>14}")
            else:
                print(f"{code:>6}  {label:>14}  {stock.get('name', ''):<20}  {'(日足なし)':>10}  {'---':>16}  {'---':>14}")
        else:
            mktcap_oku = r["mktcap"] / 1e8
            print(
                f"{r['code']:>6}  {label:>14}  {r['name']:<20}  "
                f"{r['C']:>10.1f}  {r['shares']:>16,}  {mktcap_oku:>14,.1f}"
            )

    # ── 本体B: 回転率計算 ──────────────────────────────────────────────────────
    turnover_results: list[dict] = []
    skip_turnover = 0

    for r in results:
        va = r.get("va")
        mktcap = r["mktcap"]
        if va is None or mktcap == 0:
            skip_turnover += 1
            continue
        turnover_pct = va / mktcap * 100
        turnover_results.append({**r, "turnover_pct": turnover_pct})

    # 回転率 降順ソート
    turnover_results.sort(key=lambda x: x["turnover_pct"], reverse=True)

    # a) 回転率 上位30件
    print()
    print("=" * 80)
    print(f"【回転率 上位30件】基準日: {date_str}  (回転率 = Va ÷ 時価総額 × 100)")
    print(f"{'順位':>4}  {'Code':>6}  {'名前':<20}  {'時価総額(億円)':>14}  {'Va(億円)':>12}  {'回転率%':>8}")
    print("-" * 80)
    for i, r in enumerate(turnover_results[:30], 1):
        mktcap_oku = r["mktcap"] / 1e8
        va_oku = r["va"] / 1e8
        print(
            f"{i:>4}  {r['code']:>6}  {r['name']:<20}  "
            f"{mktcap_oku:>14,.1f}  {va_oku:>12,.1f}  {r['turnover_pct']:>8.2f}"
        )

    # b) 時価総額 上位10件の回転率
    # results は時価総額降順。各銘柄を turnover_results から引く
    turnover_map = {r["code"]: r for r in turnover_results}
    print()
    print("=" * 80)
    print(f"【時価総額 上位10件の回転率】")
    print(f"{'順位':>4}  {'Code':>6}  {'名前':<20}  {'時価総額(億円)':>14}  {'Va(億円)':>12}  {'回転率%':>8}")
    print("-" * 80)
    for i, r in enumerate(results[:10], 1):
        tr = turnover_map.get(r["code"])
        mktcap_oku = r["mktcap"] / 1e8
        if tr is None:
            va_oku_str = "---"
            tpct_str = "---"
            print(f"{i:>4}  {r['code']:>6}  {r['name']:<20}  {mktcap_oku:>14,.1f}  {'---':>12}  {'---':>8}")
        else:
            va_oku = tr["va"] / 1e8
            print(
                f"{i:>4}  {r['code']:>6}  {r['name']:<20}  "
                f"{mktcap_oku:>14,.1f}  {va_oku:>12,.1f}  {tr['turnover_pct']:>8.2f}"
            )

    # c) 回転率100%超チェック
    over100 = [r for r in turnover_results if r["turnover_pct"] > 100]
    print()
    print("=" * 80)
    print(f"【回転率100%超 チェック】該当件数: {len(over100)} 件")
    if over100:
        print(f"{'順位':>4}  {'Code':>6}  {'名前':<20}  {'時価総額(億円)':>14}  {'Va(億円)':>12}  {'回転率%':>8}")
        print("-" * 80)
        for i, r in enumerate(over100[:10], 1):
            mktcap_oku = r["mktcap"] / 1e8
            va_oku = r["va"] / 1e8
            print(
                f"{i:>4}  {r['code']:>6}  {r['name']:<20}  "
                f"{mktcap_oku:>14,.1f}  {va_oku:>12,.1f}  {r['turnover_pct']:>8.2f}"
            )

    # ── 本体C: 多期間リターン結合 ────────────────────────────────────────────────
    print()
    print("=" * 80)
    print("【本体C: calc_returns() 呼び出し中...】")
    returns_all = calc_returns()  # 全銘柄一括・1回だけ
    print(f"calc_returns 完了: {len(returns_all)} 件\n")

    PERIODS = ["1d", "5d", "1m", "3m", "1y"]

    # turnover_results の各銘柄にリターンを結合
    for r in turnover_results:
        ret = returns_all.get(r["code"])
        if ret is None:
            for p in PERIODS:
                r[p] = None
        else:
            for p in PERIODS:
                r[p] = ret.get(p)

    # a) 回転率上位20件 + リターン
    def _fmt_ret(v) -> str:
        return f"{v:+.2f}" if v is not None else "-"

    print("=" * 80)
    print(f"【回転率上位20件 + リターン】基準日: {date_str}")
    print(f"{'順':>3}  {'Code':>6}  {'名前':<18}  {'時価総額億':>10}  {'回転率%':>7}  {'1d':>7}  {'5d':>7}  {'1m':>7}  {'3m':>7}  {'1y':>7}")
    print("-" * 100)
    for i, r in enumerate(turnover_results[:20], 1):
        mktcap_oku = r["mktcap"] / 1e8
        print(
            f"{i:>3}  {r['code']:>6}  {r['name']:<18}  "
            f"{mktcap_oku:>10,.1f}  {r['turnover_pct']:>7.2f}  "
            f"{_fmt_ret(r['1d']):>7}  {_fmt_ret(r['5d']):>7}  "
            f"{_fmt_ret(r['1m']):>7}  {_fmt_ret(r['3m']):>7}  {_fmt_ret(r['1y']):>7}"
        )

    # b) リターン結合統計
    print()
    print("=" * 80)
    print("【リターン結合統計】")
    joined = sum(1 for r in turnover_results if returns_all.get(r["code"]) is not None)
    print(f"回転率銘柄数: {len(turnover_results)}  リターン結合できた数: {joined}  結合なし: {len(turnover_results) - joined}")
    for p in PERIODS:
        none_n = sum(1 for r in turnover_results if r.get(p) is None)
        print(f"  {p}: None={none_n}件 / 有効={len(turnover_results) - none_n}件")

    # ── 本体D: 25日線乖離計算 ────────────────────────────────────────────────────
    print()
    print("=" * 80)
    print("【本体D: 25日線乖離(AdjCベース) 計算中...】")
    target_code_set = {r["code"] for r in turnover_results}
    sma25_dev = _calc_sma25_deviation(target_code_set)

    sma25_none = sum(1 for v in sma25_dev.values() if v is None)
    sma25_ok   = len(sma25_dev) - sma25_none
    print(f"乖離計算完了: {sma25_ok} 件 / None(25日未満): {sma25_none} 件\n")

    for r in turnover_results:
        r["sma25_dev"] = sma25_dev.get(r["code"])

    # ── STEP3: 最終一覧（回転率降順・上位50件） ──────────────────────────────────
    def _fmt(v, fmt="+.2f") -> str:
        return f"{v:{fmt}}" if v is not None else "-"

    print("=" * 100)
    print(f"【最終一覧】回転率降順 上位50件  基準日: {date_str}")
    hdr = (
        f"{'順':>3}  {'Code':>6}  {'名前':<16}  "
        f"{'時価総額億':>10}  {'Va億':>8}  {'回転率%':>7}  "
        f"{'1d':>6}  {'5d':>6}  {'1m':>6}  {'3m':>7}  {'1y':>7}  {'25日乖%':>7}"
    )
    print(hdr)
    print("-" * 100)
    for i, r in enumerate(turnover_results[:50], 1):
        mktcap_oku = r["mktcap"] / 1e8
        va_oku     = r["va"] / 1e8
        print(
            f"{i:>3}  {r['code']:>6}  {r['name']:<16}  "
            f"{mktcap_oku:>10,.1f}  {va_oku:>8,.1f}  {r['turnover_pct']:>7.2f}  "
            f"{_fmt(r['1d']):>6}  {_fmt(r['5d']):>6}  {_fmt(r['1m']):>6}  "
            f"{_fmt(r['3m']):>7}  {_fmt(r['1y']):>7}  {_fmt(r['sma25_dev']):>7}"
        )

    # ── サマリー ───────────────────────────────────────────────────────────────
    print()
    print("=" * 80)
    print(f"背骨にCode無しでskipした件数: {skip_no_close} 件")
    print(f"時価総額計算完了銘柄数: {len(results)} 件")
    print(f"回転率計算完了銘柄数: {len(turnover_results)} 件  (Va欠損/時価総額0でskip: {skip_turnover} 件)")
    print(f"25日乖離計算完了: {sma25_ok} 件 / None: {sma25_none} 件")


# ── 出現履歴DB構築 ──────────────────────────────────────────────────────────────
def build_appearance_db(split_events: dict[str, list[tuple[str, float]]]) -> None:
    """
    2025-06-20〜最新日の全営業日について日次回転率TOP100を再現計算し、
    data/jquants/appearance.json に保存する。
    """
    if not META_FILE.exists():
        print(f"エラー: meta.json が見つかりません: {META_FILE}")
        raise SystemExit(1)
    meta = json.loads(META_FILE.read_text(encoding="utf-8"))
    stocks: dict[str, dict] = meta["stocks"]

    START_DATE = "2025-06-20"
    json_files = sorted(DAILY_DIR.glob("*.json"))
    target_files = [f for f in json_files if f.stem >= START_DATE]
    if not target_files:
        print("エラー: 対象日付のファイルが見つかりません")
        raise SystemExit(1)

    print(f"対象日数: {len(target_files)}  ({target_files[0].stem} 〜 {target_files[-1].stem})")

    by_date: dict[str, list[str]] = {}
    by_code: dict[str, dict] = {}

    for i, path in enumerate(target_files, 1):
        date_str = path.stem
        try:
            daily = json.loads(path.read_text(encoding="utf-8"))
        except Exception as e:
            print(f"[{date_str}] 読み込みエラー: {e}")
            raise

        code_to_close: dict[str, float] = {}
        code_to_va: dict[str, float] = {}
        for code, rec in daily.items():
            c = rec.get("C")
            va = rec.get("Va")
            if c is not None:
                try:
                    code_to_close[code] = float(c)
                except (TypeError, ValueError):
                    pass
            if va is not None:
                try:
                    code_to_va[code] = float(va)
                except (TypeError, ValueError):
                    pass

        day_results: list[tuple[str, float]] = []
        for code, stock in stocks.items():
            if stock.get("prodcat") != "011":
                continue
            shares = get_adjusted_shares(code, date_str, stock, split_events)
            if shares is None:
                continue
            c = code_to_close.get(code)
            va = code_to_va.get(code)
            if c is None or va is None:
                continue
            mktcap = c * shares
            if mktcap == 0:
                continue
            day_results.append((code, va / mktcap * 100))

        day_results.sort(key=lambda x: x[1], reverse=True)
        top100 = [code for code, _ in day_results[:100]]
        by_date[date_str] = top100

        for code in top100:
            if code not in by_code:
                by_code[code] = {
                    "turnover_dates": [],
                    "volume_dates": [],
                    "stophigh_dates": [],
                    "first_date": "",
                    "score": 0,
                }
            by_code[code]["turnover_dates"].append(date_str)

        if i % 50 == 0:
            print(f"  進捗: {i}/{len(target_files)} 日付処理済")

    # first_date・score を確定
    for entry in by_code.values():
        dates = sorted(entry["turnover_dates"])
        entry["turnover_dates"] = dates
        entry["first_date"] = dates[0]
        entry["score"] = len(dates)

    output = {
        "_meta": {
            "generated": datetime.date.today().isoformat(),
            "date_range": [target_files[0].stem, target_files[-1].stem],
            "top_n": 100,
        },
        "by_date": by_date,
        "by_code": by_code,
    }

    APPEARANCE_FILE.write_text(
        json.dumps(output, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    file_kb = APPEARANCE_FILE.stat().st_size / 1024
    print(f"\n保存完了: {APPEARANCE_FILE}")
    print(f"ファイルサイズ: {file_kb:.1f} KB")
    print(f"日数: {len(by_date)}  ユニーク出現銘柄数: {len(by_code)}")

    # 人気スコア上位20件
    name_map = {code: s.get("name", "") for code, s in stocks.items()}
    top20 = sorted(by_code.items(), key=lambda x: x[1]["score"], reverse=True)[:20]
    print("\n【人気スコア上位20件】")
    print(f"{'順':>3}  {'Code':>6}  {'名前':<22}  {'score':>6}  {'first_date':>12}  最近出現日")
    print("-" * 75)
    for rank, (code, entry) in enumerate(top20, 1):
        last_date = entry["turnover_dates"][-1] if entry["turnover_dates"] else "-"
        print(
            f"{rank:>3}  {code:>6}  {name_map.get(code, ''):22}  "
            f"{entry['score']:>6}  {entry['first_date']:>12}  {last_date}"
        )

    # サンプル1銘柄 by_code 全体
    sample_code, sample_entry = top20[0]
    print(f"\n【サンプル by_code: {sample_code} {name_map.get(sample_code, '')}】")
    print(json.dumps(sample_entry, ensure_ascii=False, indent=2))


# ── ranking.json 生成 ────────────────────────────────────────────────────────
def build_ranking(split_events: dict[str, list[tuple[str, float]]]) -> None:
    """
    最新営業日の回転率上位100件を data/jquants/ranking.json に書き出す。
    """
    if not META_FILE.exists():
        print(f"エラー: meta.json が見つかりません: {META_FILE}")
        raise SystemExit(1)
    meta = json.loads(META_FILE.read_text(encoding="utf-8"))
    stocks: dict[str, dict] = meta["stocks"]

    targets = {
        code: s
        for code, s in stocks.items()
        if s.get("prodcat") == "011" and s.get("shares")
    }

    date_str, code_to_close, code_to_va = _latest_daily_close()

    results: list[dict] = []
    for code, stock in targets.items():
        shares = get_adjusted_shares(code, date_str, stock, split_events)
        if shares is None:
            continue
        c = code_to_close.get(code)
        if c is None:
            continue
        mktcap = c * shares
        results.append({
            "code":   code,
            "name":   stock.get("name", ""),
            "market": stock.get("market", ""),
            "C":      c,
            "shares": shares,
            "mktcap": mktcap,
            "va":     code_to_va.get(code),
        })

    turnover_results: list[dict] = []
    for r in results:
        va = r.get("va")
        mktcap = r["mktcap"]
        if va is None or mktcap == 0:
            continue
        turnover_pct = va / mktcap * 100
        turnover_results.append({**r, "turnover_pct": turnover_pct})

    turnover_results.sort(key=lambda x: x["va"] if x["va"] is not None else 0, reverse=True)

    PERIODS = ["1d", "5d", "1m", "3m", "1y"]
    returns_all = calc_returns()
    for r in turnover_results:
        ret = returns_all.get(r["code"])
        if ret is None:
            for p in PERIODS:
                r[p] = None
        else:
            for p in PERIODS:
                r[p] = ret.get(p)

    target_code_set = {r["code"] for r in turnover_results}
    sma25_dev = _calc_sma25_deviation(target_code_set)
    for r in turnover_results:
        r["sma25_dev"] = sma25_dev.get(r["code"])

    top100 = turnover_results[:100]
    ranking = [
        {
            "code":         r["code"],
            "name":         r["name"],
            "market":       r["market"],
            "turnover_pct": r["turnover_pct"],
            "mktcap":       r["mktcap"],
            "va":           r["va"],
            "C":            r["C"],
            "ret_1d":       r["1d"],
            "ret_5d":       r["5d"],
            "ret_1m":       r["1m"],
            "ret_3m":       r["3m"],
            "ret_1y":       r["1y"],
            "sma25_dev":    r["sma25_dev"],
        }
        for r in top100
    ]

    output = {
        "_meta": {
            "generated": datetime.datetime.now().isoformat(),
            "date":      date_str,
            "count":     len(ranking),
            "top_n":     100,
        },
        "ranking": ranking,
    }

    RANKING_FILE.parent.mkdir(parents=True, exist_ok=True)
    RANKING_FILE.write_text(
        json.dumps(output, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    RANKING_FILE_WEB.parent.mkdir(parents=True, exist_ok=True)
    RANKING_FILE_WEB.write_text(
        json.dumps(output, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(f"ranking.json 出力: {len(ranking)}件")


def build_ranking_by_market(split_events: dict[str, list[tuple[str, float]]]) -> None:
    """
    最新営業日の回転率上位100件を、全市場(all)/スタンダード(standard)/グロース(growth)の
    3キーで data/jquants/ranking.json に書き出す。
    """
    if not META_FILE.exists():
        print(f"エラー: meta.json が見つかりません: {META_FILE}")
        raise SystemExit(1)
    meta = json.loads(META_FILE.read_text(encoding="utf-8"))
    stocks: dict[str, dict] = meta["stocks"]

    targets = {
        code: s
        for code, s in stocks.items()
        if s.get("prodcat") == "011" and s.get("shares")
    }

    date_str, code_to_close, code_to_va = _latest_daily_close()

    results: list[dict] = []
    for code, stock in targets.items():
        shares = get_adjusted_shares(code, date_str, stock, split_events)
        if shares is None:
            continue
        c = code_to_close.get(code)
        if c is None:
            continue
        mktcap = c * shares
        results.append({
            "code":   code,
            "name":   stock.get("name", ""),
            "market": stock.get("market", ""),
            "C":      c,
            "shares": shares,
            "mktcap": mktcap,
            "va":     code_to_va.get(code),
        })

    turnover_results: list[dict] = []
    for r in results:
        va = r.get("va")
        mktcap = r["mktcap"]
        if va is None or mktcap == 0:
            continue
        turnover_pct = va / mktcap * 100
        turnover_results.append({**r, "turnover_pct": turnover_pct})

    turnover_results.sort(key=lambda x: x["va"] if x["va"] is not None else 0, reverse=True)

    PERIODS = ["1d", "5d", "1m", "3m", "1y"]
    returns_all = calc_returns()
    for r in turnover_results:
        ret = returns_all.get(r["code"])
        if ret is None:
            for p in PERIODS:
                r[p] = None
        else:
            for p in PERIODS:
                r[p] = ret.get(p)

    target_code_set = {r["code"] for r in turnover_results}
    sma25_dev = _calc_sma25_deviation(target_code_set)
    for r in turnover_results:
        r["sma25_dev"] = sma25_dev.get(r["code"])

    all_rows      = [_to_ranking_row(r) for r in turnover_results[:100]]
    standard_rows = [_to_ranking_row(r) for r in turnover_results if r["market"] == "スタンダード"][:100]
    growth_rows   = [_to_ranking_row(r) for r in turnover_results if r["market"] == "グロース"][:100]
    prime_rows    = [_to_ranking_row(r) for r in turnover_results if r["market"] == "プライム"][:100]

    output = {
        "_meta": {
            "generated": datetime.datetime.now().isoformat(),
            "date":      date_str,
            "top_n":     100,
            "counts": {
                "all":      len(all_rows),
                "prime":    len(prime_rows),
                "standard": len(standard_rows),
                "growth":   len(growth_rows),
            },
        },
        "all":      all_rows,
        "prime":    prime_rows,
        "standard": standard_rows,
        "growth":   growth_rows,
    }

    RANKING_FILE.parent.mkdir(parents=True, exist_ok=True)
    RANKING_FILE.write_text(
        json.dumps(output, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    RANKING_FILE_WEB.parent.mkdir(parents=True, exist_ok=True)
    RANKING_FILE_WEB.write_text(
        json.dumps(output, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(f"ranking.json 出力: all={len(all_rows)} standard={len(standard_rows)} growth={len(growth_rows)}")


# ── S高日付DB構築 ──────────────────────────────────────────────────────────────
def build_stophigh() -> None:
    """
    全daily を走査して UL='1' の日を集め、
    appearance.json の各銘柄の stophigh_dates[] を埋める。
    by_code に存在する銘柄のみ更新。既存の他フィールドは一切変更しない。
    """
    bak_path = APPEARANCE_FILE.parent / "appearance.json.bak"
    shutil.copy2(APPEARANCE_FILE, bak_path)
    print(f"バックアップ完了: {bak_path}")

    data = json.loads(APPEARANCE_FILE.read_text(encoding="utf-8"))
    by_code: dict[str, dict] = data["by_code"]
    date_range = data["_meta"]["date_range"]
    start_date, end_date = date_range[0], date_range[1]

    json_files = sorted(DAILY_DIR.glob("*.json"))
    target_files = [f for f in json_files if start_date <= f.stem <= end_date]
    print(f"対象daily: {len(target_files)} 日 ({start_date} 〜 {end_date})")

    # code -> S高日付リスト
    stophigh_map: dict[str, list[str]] = {}
    for path in target_files:
        date_str = path.stem
        daily = json.loads(path.read_text(encoding="utf-8"))
        for code, rec in daily.items():
            if rec.get("UL") == "1":
                stophigh_map.setdefault(code, []).append(date_str)

    # by_code に存在する銘柄のみ stophigh_dates を更新
    updated = 0
    for code, entry in by_code.items():
        dates = sorted(stophigh_map.get(code, []))
        entry["stophigh_dates"] = dates
        if dates:
            updated += 1

    APPEARANCE_FILE.write_text(
        json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(f"S高埋め完了: stophigh非空 {updated}銘柄 / 対象daily {len(target_files)}日")


# ── 窓スコア計算 ────────────────────────────────────────────────────────────────
def build_window_scores() -> None:
    """
    全営業日列を基準に直近25/50/100/200営業日窓を作り、
    各銘柄の turnover_dates / stophigh_dates が各窓に入る件数を追記する。
    既存フィールドは一切変更しない。
    """
    bak2_path = APPEARANCE_FILE.parent / "appearance.json.bak2"
    shutil.copy2(APPEARANCE_FILE, bak2_path)
    print(f"バックアップ完了: {bak2_path}")

    all_trading_days = sorted(f.stem for f in DAILY_DIR.glob("*.json"))
    total_days = len(all_trading_days)
    print(f"営業日列: {total_days}日 ({all_trading_days[0]} 〜 {all_trading_days[-1]})")

    # 新しい順に並べて各窓の日付 set を作る
    reversed_days = list(reversed(all_trading_days))
    WINDOWS = [25, 50, 100, 200]
    window_sets: dict[int, set[str]] = {}
    for n in WINDOWS:
        window_sets[n] = set(reversed_days[:n])

    data = json.loads(APPEARANCE_FILE.read_text(encoding="utf-8"))
    by_code: dict[str, dict] = data["by_code"]

    for entry in by_code.values():
        t_dates = set(entry.get("turnover_dates", []))
        s_dates = set(entry.get("stophigh_dates", []))
        for n in WINDOWS:
            ws = window_sets[n]
            entry[f"turnover_{n}"]  = len(t_dates & ws)
            entry[f"stophigh_{n}"] = len(s_dates & ws)

    APPEARANCE_FILE.write_text(
        json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(f"窓スコア計算完了: {len(by_code)}銘柄 / 窓=25,50,100,200 / 営業日列={total_days}日")


# ── 人気継続画面用軽量JSON生成 ──────────────────────────────────────────────────
def build_popular(split_events: dict[str, list[tuple[str, float]]]) -> None:
    """
    appearance.json の by_code から turnover/stophigh窓スコアを集め、
    銘柄名・時価総額を付与して data/jquants/popular.json を生成する。
    採用条件: turnover_200>0 OR stophigh_200>0 OR 時価総額ランク<=100。
    時価総額ランクは当日終値(raw close)×分割調整後株数の降順で全銘柄に付与する。
    """
    POPULAR_FILE     = APPEARANCE_FILE.parent / "popular.json"
    POPULAR_FILE_WEB = Path(__file__).parent / "web" / "public" / "data" / "popular.json"

    data = json.loads(APPEARANCE_FILE.read_text(encoding="utf-8"))
    by_code: dict[str, dict] = data["by_code"]

    meta = json.loads(META_FILE.read_text(encoding="utf-8"))
    stocks: dict[str, dict] = meta["stocks"]

    json_files = sorted(DAILY_DIR.glob("*.json"))
    if not json_files:
        raise RuntimeError(f"日足ファイルが見つかりません: {DAILY_DIR}")
    latest_path = json_files[-1]
    date_str = latest_path.stem
    daily = json.loads(latest_path.read_text(encoding="utf-8"))

    returns_all = calc_returns()

    # 時価総額ランクは上場銘柄全体(meta.stocks収録分)に付与する。
    # turnover/stophigh が一度もウィンドウ出現していない銘柄（by_code未収録、
    # 例: SBG等の超大型株で回転率%が常に低い銘柄）も候補に含めるため。
    # mktcap = 当日終値(raw close) × 分割調整後株数、code完全一致でjoin。
    mktcap_by_code: dict[str, float] = {}
    for code in stocks:
        stock = stocks[code]
        c = daily.get(code, {}).get("C")
        adj_shares = get_adjusted_shares(code, date_str, stock, split_events)
        if c is not None and adj_shares is not None:
            try:
                mktcap_by_code[code] = float(c) * adj_shares
            except (TypeError, ValueError):
                pass

    mktcap_rank: dict[str, int] = {
        code: i + 1
        for i, (code, _) in enumerate(
            sorted(mktcap_by_code.items(), key=lambda kv: kv[1], reverse=True)
        )
    }
    top100_codes = {code for code, rank in mktcap_rank.items() if rank <= 100}

    popular: list[dict] = []
    skipped = 0
    for code in by_code.keys() | top100_codes:
        entry = by_code.get(code, {})
        t200 = entry.get("turnover_200", 0)
        s200 = entry.get("stophigh_200", 0)
        rank = mktcap_rank.get(code)
        if t200 == 0 and s200 == 0 and (rank is None or rank > 100):
            skipped += 1
            continue

        stock = stocks.get(code, {})
        name = stock.get("name", "")

        c = daily.get(code, {}).get("C")
        mktcap = mktcap_by_code.get(code)
        mktcap_oku = round(mktcap / 1e8, 1) if mktcap is not None else None

        ret = returns_all.get(code)
        popular.append({
            "code":          code,
            "name":          name,
            "mktcap_oku":    mktcap_oku,
            "turnover_25":   entry.get("turnover_25",  0),
            "turnover_50":   entry.get("turnover_50",  0),
            "turnover_100":  entry.get("turnover_100", 0),
            "turnover_200":  entry.get("turnover_200", 0),
            "stophigh_25":   entry.get("stophigh_25",  0),
            "stophigh_50":   entry.get("stophigh_50",  0),
            "stophigh_100":  entry.get("stophigh_100", 0),
            "stophigh_200":  entry.get("stophigh_200", 0),
            "first_date":    entry.get("first_date",   ""),
            "ret_1d":        ret.get("1d") if ret else None,
            "ret_5d":        ret.get("5d") if ret else None,
            "ret_1m":        ret.get("1m") if ret else None,
            "ret_3m":        ret.get("3m") if ret else None,
            "ret_1y":        ret.get("1y") if ret else None,
            "close":         float(c) if c is not None else None,
        })

    popular.sort(key=lambda x: x["turnover_50"], reverse=True)

    output = {
        "_meta": {
            "generated": datetime.datetime.now().isoformat(),
            "date":      date_str,
            "count":     len(popular),
            "source":    "appearance.json",
        },
        "popular": popular,
    }

    json_str = json.dumps(output, ensure_ascii=False, indent=2)

    POPULAR_FILE.parent.mkdir(parents=True, exist_ok=True)
    POPULAR_FILE.write_text(json_str, encoding="utf-8")

    POPULAR_FILE_WEB.parent.mkdir(parents=True, exist_ok=True)
    POPULAR_FILE_WEB.write_text(json_str, encoding="utf-8")

    file_kb = POPULAR_FILE_WEB.stat().st_size / 1024
    print(f"popular.json 出力: {len(popular)}銘柄 / 除外(全窓0): {skipped}銘柄 / {file_kb:.1f}KB")
    print(f"  -> {POPULAR_FILE}")
    print(f"  -> {POPULAR_FILE_WEB}")


_MARKET_NAME_MAP = {
    "プライム": "東証P",
    "スタンダード": "東証S",
    "グロース": "東証G",
}

RANKING_CARDS_FILE_DATA = Path(__file__).parent / "data" / "jquants" / "ranking_cards.json"
RANKING_CARDS_FILE_WEB  = Path(__file__).parent / "web" / "public" / "data" / "ranking_cards.json"


def _format_mktcap(mktcap: float) -> str:
    if mktcap >= 1e12:
        s = f"{mktcap / 1e12:.2f}".rstrip("0").rstrip(".")
        return s + "兆円"
    elif mktcap >= 1e8:
        return f"{mktcap / 1e8:.0f}億円"
    else:
        return f"{mktcap / 1e4:.0f}万円"


def build_ranking_cards(split_events: dict[str, list[tuple[str, float]]]) -> None:
    """
    回転率上位100件のカード用JSONを生成する。
    candles / volumes に直近60営業日分の日足を含む。
    出力先: data/jquants/ranking_cards.json と web/public/data/ranking_cards.json
    """
    if not META_FILE.exists():
        print(f"エラー: meta.json が見つかりません: {META_FILE}")
        raise SystemExit(1)
    meta = json.loads(META_FILE.read_text(encoding="utf-8"))
    stocks_meta: dict[str, dict] = meta["stocks"]

    targets = {
        code: s
        for code, s in stocks_meta.items()
        if s.get("prodcat") == "011" and s.get("shares")
    }

    date_str, code_to_close, code_to_va = _latest_daily_close()

    # --- 回転率計算 ---
    results: list[dict] = []
    for code, stock in targets.items():
        shares = get_adjusted_shares(code, date_str, stock, split_events)
        if shares is None:
            continue
        c = code_to_close.get(code)
        if c is None:
            continue
        mktcap = c * shares
        va = code_to_va.get(code)
        if va is None or mktcap == 0:
            continue
        results.append({
            "code": code,
            "C": c,
            "mktcap": mktcap,
            "va": va,
            "turnover_pct": va / mktcap * 100,
            "_stock": stock,
        })

    results.sort(key=lambda x: x["turnover_pct"], reverse=True)

    returns_all = calc_returns()
    for r in results:
        ret = returns_all.get(r["code"])
        r["ret_1d"] = ret.get("1d") if ret else None

    top100 = results[:100]
    top_codes = {r["code"] for r in top100}

    # --- appearance.json から出現回数・S高回数を取得 ---
    appearance_by_code: dict[str, dict] = {}
    if APPEARANCE_FILE.exists():
        try:
            app_data = json.loads(APPEARANCE_FILE.read_text(encoding="utf-8"))
            appearance_by_code = app_data.get("by_code", {})
        except Exception:
            pass

    # --- 直近60営業日の日足収集 ---
    json_files = sorted(DAILY_DIR.glob("*.json"))
    recent_files = json_files[-60:] if len(json_files) >= 60 else json_files

    candles_map: dict[str, list] = {code: [] for code in top_codes}
    volumes_map: dict[str, list] = {code: [] for code in top_codes}
    limitup_touch_map: dict[str, list] = {code: [] for code in top_codes}  # ザラ場タッチのみ
    limitup_closed_map: dict[str, list] = {code: [] for code in top_codes}  # 終値ストップ引け

    for path in recent_files:
        day_date = path.stem
        data = json.loads(path.read_text(encoding="utf-8"))
        for code in top_codes:
            rec = data.get(code)
            if rec is None:
                continue
            # S高チェック（OHLCV欠損とは独立して実施）
            if rec.get("UL") == "1":
                try:
                    h_val = float(rec.get("H") or 0)
                    c_val = float(rec.get("C") or 0)
                except (TypeError, ValueError):
                    h_val, c_val = 0.0, 0.0
                if h_val > 0 and c_val == h_val:
                    limitup_closed_map[code].append(day_date)  # 終値=高値=ストップ引け
                else:
                    limitup_touch_map[code].append(day_date)   # ザラ場タッチのみ
            o, h, l, c, vo = rec.get("O"), rec.get("H"), rec.get("L"), rec.get("C"), rec.get("Vo")
            if any(v is None or v == "" for v in [o, h, l, c, vo]):
                continue
            try:
                candles_map[code].append({
                    "time": day_date,
                    "open": float(o),
                    "high": float(h),
                    "low": float(l),
                    "close": float(c),
                })
                volumes_map[code].append({
                    "time": day_date,
                    "value": float(vo),
                })
            except (TypeError, ValueError):
                pass

    # --- 出力データ構築 ---
    ranking_cards: list[dict] = []
    for r in top100:
        code = r["code"]
        stock = r["_stock"]
        c = r["C"]
        ret_1d = r["ret_1d"]
        mktcap = r["mktcap"]

        candles = candles_map.get(code, [])
        if len(candles) >= 2:
            change = round(candles[-1]["close"] - candles[-2]["close"])
            change_pct = round((change / candles[-2]["close"]) * 100, 2)
        else:
            change = 0
            change_pct = 0.0

        market_raw = stock.get("market", "")
        market = _MARKET_NAME_MAP.get(market_raw, market_raw)
        sector = stock.get("sector33", "")

        touch_dates = limitup_touch_map.get(code, [])
        closed_dates = limitup_closed_map.get(code, [])
        is_limit_up = date_str in touch_dates or date_str in closed_dates
        app_entry = appearance_by_code.get(code, {})

        ranking_cards.append({
            "code": code,
            "name": stock.get("name", ""),
            "market": market,
            "sector": sector,
            "creditType": "-",
            "price": c,
            "change": change,
            "changePct": change_pct,
            "marketCap": _format_mktcap(mktcap),
            "va": r["va"],
            "mktcap": mktcap,
            "turnover": round(r["turnover_pct"], 2),
            "isLimitUp": is_limit_up,
            "touchedOnlyDates": touch_dates,    # ザラ場タッチのみ（引け日は含まない）
            "closedLimitUpDates": closed_dates, # 終値ストップ引け
            "occCount": int(app_entry.get("turnover_50", 0)),   # 50日窓
            "stophighCount": int(app_entry.get("stophigh_50", 0)),  # 50日窓
            "candles": candles,
            "volumes": volumes_map.get(code, []),
        })

    output = {
        "_meta": {
            "generated": datetime.datetime.now().isoformat(),
            "date": date_str,
            "count": len(ranking_cards),
        },
        "ranking": ranking_cards,
    }

    json_str = json.dumps(output, ensure_ascii=False)

    RANKING_CARDS_FILE_DATA.parent.mkdir(parents=True, exist_ok=True)
    RANKING_CARDS_FILE_DATA.write_text(json_str, encoding="utf-8")

    RANKING_CARDS_FILE_WEB.parent.mkdir(parents=True, exist_ok=True)
    RANKING_CARDS_FILE_WEB.write_text(json_str, encoding="utf-8")

    file_kb = RANKING_CARDS_FILE_WEB.stat().st_size / 1024
    print(f"ranking_cards.json 出力: {len(ranking_cards)}件 / {file_kb:.1f}KB")
    print(f"  -> {RANKING_CARDS_FILE_DATA}")
    print(f"  -> {RANKING_CARDS_FILE_WEB}")


STOPHIGH_CARDS_FILE_WEB = Path(__file__).parent / "web" / "public" / "data" / "stophigh_cards.json"


def build_stophigh_cards(split_events: dict[str, list[tuple[str, float]]]) -> None:
    """
    当日S高銘柄（turnover上位100件の制約を受けない全件）のカード用JSONを生成する。
    フィールドスキーマ・データ源・計算式は build_ranking_cards() と同一。
    出力先: web/public/data/stophigh_cards.json のみ（既存ファイルには一切触れない）。
    """
    if not META_FILE.exists():
        print(f"エラー: meta.json が見つかりません: {META_FILE}")
        raise SystemExit(1)
    meta = json.loads(META_FILE.read_text(encoding="utf-8"))
    stocks_meta: dict[str, dict] = meta["stocks"]

    date_str, code_to_close, code_to_va = _latest_daily_close()

    latest_path = DAILY_DIR / f"{date_str}.json"
    latest_raw = json.loads(latest_path.read_text(encoding="utf-8"))

    # --- 当日S高銘柄を全件抽出（turnover順位の制約なし） ---
    stophigh_codes = {code for code, rec in latest_raw.items() if rec.get("UL") == "1"}

    # --- appearance.json から出現回数・S高回数を取得 ---
    appearance_by_code: dict[str, dict] = {}
    if APPEARANCE_FILE.exists():
        try:
            app_data = json.loads(APPEARANCE_FILE.read_text(encoding="utf-8"))
            appearance_by_code = app_data.get("by_code", {})
        except Exception:
            pass

    # --- 直近60営業日の日足収集 ---
    json_files = sorted(DAILY_DIR.glob("*.json"))
    recent_files = json_files[-60:] if len(json_files) >= 60 else json_files

    candles_map: dict[str, list] = {code: [] for code in stophigh_codes}
    volumes_map: dict[str, list] = {code: [] for code in stophigh_codes}
    limitup_touch_map: dict[str, list] = {code: [] for code in stophigh_codes}
    limitup_closed_map: dict[str, list] = {code: [] for code in stophigh_codes}

    for path in recent_files:
        day_date = path.stem
        data = json.loads(path.read_text(encoding="utf-8"))
        for code in stophigh_codes:
            rec = data.get(code)
            if rec is None:
                continue
            # S高チェック（OHLCV欠損とは独立して実施）
            if rec.get("UL") == "1":
                try:
                    h_val = float(rec.get("H") or 0)
                    c_val = float(rec.get("C") or 0)
                except (TypeError, ValueError):
                    h_val, c_val = 0.0, 0.0
                if h_val > 0 and c_val == h_val:
                    limitup_closed_map[code].append(day_date)  # 終値=高値=ストップ引け
                else:
                    limitup_touch_map[code].append(day_date)   # ザラ場タッチのみ
            o, h, l, c, vo = rec.get("O"), rec.get("H"), rec.get("L"), rec.get("C"), rec.get("Vo")
            if any(v is None or v == "" for v in [o, h, l, c, vo]):
                continue
            try:
                candles_map[code].append({
                    "time": day_date,
                    "open": float(o),
                    "high": float(h),
                    "low": float(l),
                    "close": float(c),
                })
                volumes_map[code].append({
                    "time": day_date,
                    "value": float(vo),
                })
            except (TypeError, ValueError):
                pass

    # --- 出力データ構築（証券コード昇順） ---
    stophigh_cards: list[dict] = []
    for code in sorted(stophigh_codes):
        stock = stocks_meta.get(code)
        if stock is None:
            continue
        shares = get_adjusted_shares(code, date_str, stock, split_events)
        if shares is None:
            continue
        c = code_to_close.get(code)
        if c is None:
            continue
        mktcap = c * shares
        va = code_to_va.get(code)
        if va is None or mktcap == 0:
            continue
        turnover_pct = va / mktcap * 100

        candles = candles_map.get(code, [])
        if len(candles) >= 2:
            change = round(candles[-1]["close"] - candles[-2]["close"])
            change_pct = round((change / candles[-2]["close"]) * 100, 2)
        else:
            change = 0
            change_pct = 0.0

        market_raw = stock.get("market", "")
        market = _MARKET_NAME_MAP.get(market_raw, market_raw)
        sector = stock.get("sector33", "")

        touch_dates = limitup_touch_map.get(code, [])
        closed_dates = limitup_closed_map.get(code, [])
        is_limit_up = date_str in touch_dates or date_str in closed_dates
        app_entry = appearance_by_code.get(code, {})

        stophigh_cards.append({
            "code": code,
            "name": stock.get("name", ""),
            "market": market,
            "sector": sector,
            "creditType": "-",
            "price": c,
            "change": change,
            "changePct": change_pct,
            "marketCap": _format_mktcap(mktcap),
            "va": va,
            "mktcap": mktcap,
            "turnover": round(turnover_pct, 2),
            "isLimitUp": is_limit_up,
            "touchedOnlyDates": touch_dates,    # ザラ場タッチのみ（引け日は含まない）
            "closedLimitUpDates": closed_dates, # 終値ストップ引け
            "occCount": int(app_entry.get("turnover_50", 0)),   # 50日窓
            "stophighCount": int(app_entry.get("stophigh_50", 0)),  # 50日窓
            "candles": candles,
            "volumes": volumes_map.get(code, []),
        })

    output = {
        "_meta": {
            "generated": datetime.datetime.now().isoformat(),
            "date": date_str,
            "count": len(stophigh_cards),
        },
        "ranking": stophigh_cards,
    }

    json_str = json.dumps(output, ensure_ascii=False)

    STOPHIGH_CARDS_FILE_WEB.parent.mkdir(parents=True, exist_ok=True)
    STOPHIGH_CARDS_FILE_WEB.write_text(json_str, encoding="utf-8")

    file_kb = STOPHIGH_CARDS_FILE_WEB.stat().st_size / 1024
    closed_n = sum(1 for card in stophigh_cards if date_str in card["closedLimitUpDates"])
    touch_n = sum(1 for card in stophigh_cards if date_str in card["touchedOnlyDates"])
    print(
        f"stophigh_cards.json 出力: {len(stophigh_cards)}件 "
        f"（終値S高引け:{closed_n} / ザラ場タッチのみ:{touch_n}） / {file_kb:.1f}KB"
    )
    print(f"  -> {STOPHIGH_CARDS_FILE_WEB}")


POPULAR_CARDS_FILE_DATA = Path(__file__).parent / "data" / "jquants" / "popular_cards.json"
POPULAR_CARDS_FILE_WEB  = Path(__file__).parent / "web" / "public" / "data" / "popular_cards.json"

# ─── 状態判定ロジック（web/src/lib/classify.ts と同一・変更禁止） ──────────────
_PULLBACK_NEUTRAL_PCT = 2.0
MIN_TURNOVER_50 = 20


def _pullback_tri(v: float | None) -> str | None:
    if v is None:
        return None
    if v >= _PULLBACK_NEUTRAL_PCT:
        return "+"
    if v <= -_PULLBACK_NEUTRAL_PCT:
        return "-"
    return "0"


def _pullback_calc_accel(ret_1m: float | None, ret_5d: float | None) -> float | None:
    if ret_1m is None or ret_5d is None:
        return None
    mid15d = (1 + ret_1m / 100) / (1 + ret_5d / 100) - 1
    accel = ret_5d / 100 - mid15d
    return accel * 100


def _pullback_classify(row: dict) -> str:
    s1y = _pullback_tri(row.get("ret_1y"))
    s3m = _pullback_tri(row.get("ret_3m"))
    s1m = _pullback_tri(row.get("ret_1m"))
    s5d = _pullback_tri(row.get("ret_5d"))

    if s1y is None or s3m is None or s1m is None or s5d is None:
        return "対象外"

    if s1y == "+" and s3m == "+" and s1m == "-":
        return "調整"
    if s1y == "+" and s3m == "+" and s1m == "0":
        return "調整予備軍"
    if s1y == "+" and s3m == "+" and s1m == "+" and s5d == "-":
        return "短期押し目"
    if s1y == "+" and s3m == "+" and s1m == "+" and s5d in ("+", "0"):
        accel = _pullback_calc_accel(row.get("ret_1m"), row.get("ret_5d"))
        ret_5d = row.get("ret_5d")
        if ret_5d is not None and ret_5d >= 15 and accel is not None and accel >= 5:
            return "初動・再加速"
        return "継続"
    if s1y == "+" and s3m == "0":
        return "中立帯"
    if s1y == "+" and s3m == "-":
        return "失速"

    return "対象外"


def build_popular_cards(split_events: dict[str, list[tuple[str, float]]]) -> None:
    """
    /pullback 表示対象銘柄（classify()!=対象外 かつ turnover_50>=20、除外銘柄を除く）の
    カード用JSONを生成する。フィールドスキーマ・データ源・計算式は build_stophigh_cards() と同一。
    対象銘柄の選定ロジックは web/src/lib/classify.ts および app/pullback/page.tsx の
    フィルタ条件と完全一致させる。
    出力先: data/jquants/popular_cards.json と web/public/data/popular_cards.json
    """
    POPULAR_FILE = APPEARANCE_FILE.parent / "popular.json"
    if not POPULAR_FILE.exists():
        print(f"エラー: popular.json が見つかりません: {POPULAR_FILE}")
        raise SystemExit(1)
    if not META_FILE.exists():
        print(f"エラー: meta.json が見つかりません: {META_FILE}")
        raise SystemExit(1)

    popular_data = json.loads(POPULAR_FILE.read_text(encoding="utf-8"))
    rows: list[dict] = popular_data["popular"]

    excluded_file = Path(__file__).parent / "web" / "public" / "data" / "excluded.json"
    excluded_codes: set[str] = set()
    if excluded_file.exists():
        try:
            excluded_codes = {
                e["code"] for e in json.loads(excluded_file.read_text(encoding="utf-8"))["excluded"]
            }
        except Exception:
            pass

    target_codes = {
        r["code"]
        for r in rows
        if r["code"] not in excluded_codes
        and r.get("turnover_50", 0) >= MIN_TURNOVER_50
        and _pullback_classify(r) != "対象外"
    }

    meta = json.loads(META_FILE.read_text(encoding="utf-8"))
    stocks_meta: dict[str, dict] = meta["stocks"]

    date_str, code_to_close, code_to_va = _latest_daily_close()

    # --- appearance.json から出現回数・S高回数を取得 ---
    appearance_by_code: dict[str, dict] = {}
    if APPEARANCE_FILE.exists():
        try:
            app_data = json.loads(APPEARANCE_FILE.read_text(encoding="utf-8"))
            appearance_by_code = app_data.get("by_code", {})
        except Exception:
            pass

    # --- 直近60営業日の日足収集 ---
    json_files = sorted(DAILY_DIR.glob("*.json"))
    recent_files = json_files[-60:] if len(json_files) >= 60 else json_files

    candles_map: dict[str, list] = {code: [] for code in target_codes}
    volumes_map: dict[str, list] = {code: [] for code in target_codes}
    limitup_touch_map: dict[str, list] = {code: [] for code in target_codes}
    limitup_closed_map: dict[str, list] = {code: [] for code in target_codes}

    for path in recent_files:
        day_date = path.stem
        data = json.loads(path.read_text(encoding="utf-8"))
        for code in target_codes:
            rec = data.get(code)
            if rec is None:
                continue
            if rec.get("UL") == "1":
                try:
                    h_val = float(rec.get("H") or 0)
                    c_val = float(rec.get("C") or 0)
                except (TypeError, ValueError):
                    h_val, c_val = 0.0, 0.0
                if h_val > 0 and c_val == h_val:
                    limitup_closed_map[code].append(day_date)
                else:
                    limitup_touch_map[code].append(day_date)
            o, h, l, c, vo = rec.get("O"), rec.get("H"), rec.get("L"), rec.get("C"), rec.get("Vo")
            if any(v is None or v == "" for v in [o, h, l, c, vo]):
                continue
            try:
                candles_map[code].append({
                    "time": day_date,
                    "open": float(o),
                    "high": float(h),
                    "low": float(l),
                    "close": float(c),
                })
                volumes_map[code].append({
                    "time": day_date,
                    "value": float(vo),
                })
            except (TypeError, ValueError):
                pass

    # --- 出力データ構築（回転率降順、popular.json と同じ並び） ---
    popular_cards: list[dict] = []
    for code in target_codes:
        stock = stocks_meta.get(code)
        if stock is None:
            continue
        shares = get_adjusted_shares(code, date_str, stock, split_events)
        if shares is None:
            continue
        c = code_to_close.get(code)
        if c is None:
            continue
        mktcap = c * shares
        va = code_to_va.get(code)
        if va is None or mktcap == 0:
            continue
        turnover_pct = va / mktcap * 100

        candles = candles_map.get(code, [])
        if len(candles) >= 2:
            change = round(candles[-1]["close"] - candles[-2]["close"])
            change_pct = round((change / candles[-2]["close"]) * 100, 2)
        else:
            change = 0
            change_pct = 0.0

        market_raw = stock.get("market", "")
        market = _MARKET_NAME_MAP.get(market_raw, market_raw)
        sector = stock.get("sector33", "")

        touch_dates = limitup_touch_map.get(code, [])
        closed_dates = limitup_closed_map.get(code, [])
        is_limit_up = date_str in touch_dates or date_str in closed_dates
        app_entry = appearance_by_code.get(code, {})

        popular_cards.append({
            "code": code,
            "name": stock.get("name", ""),
            "market": market,
            "sector": sector,
            "creditType": "-",
            "price": c,
            "change": change,
            "changePct": change_pct,
            "marketCap": _format_mktcap(mktcap),
            "va": va,
            "mktcap": mktcap,
            "turnover": round(turnover_pct, 2),
            "isLimitUp": is_limit_up,
            "touchedOnlyDates": touch_dates,
            "closedLimitUpDates": closed_dates,
            "occCount": int(app_entry.get("turnover_50", 0)),
            "stophighCount": int(app_entry.get("stophigh_50", 0)),
            "candles": candles,
            "volumes": volumes_map.get(code, []),
        })

    popular_cards.sort(key=lambda card: card["turnover"], reverse=True)

    output = {
        "_meta": {
            "generated": datetime.datetime.now().isoformat(),
            "date": date_str,
            "count": len(popular_cards),
        },
        "ranking": popular_cards,
    }

    json_str = json.dumps(output, ensure_ascii=False)

    POPULAR_CARDS_FILE_DATA.parent.mkdir(parents=True, exist_ok=True)
    POPULAR_CARDS_FILE_DATA.write_text(json_str, encoding="utf-8")

    POPULAR_CARDS_FILE_WEB.parent.mkdir(parents=True, exist_ok=True)
    POPULAR_CARDS_FILE_WEB.write_text(json_str, encoding="utf-8")

    file_kb = POPULAR_CARDS_FILE_WEB.stat().st_size / 1024
    print(f"popular_cards.json 出力: {len(popular_cards)}件 / {file_kb:.1f}KB")
    print(f"  -> {POPULAR_CARDS_FILE_DATA}")
    print(f"  -> {POPULAR_CARDS_FILE_WEB}")


if __name__ == "__main__":
    import sys
    split_events = build_split_events(sorted(DAILY_DIR.glob("*.json")))
    if len(sys.argv) > 1 and sys.argv[1] == "build_appearance":
        build_appearance_db(split_events)
    elif len(sys.argv) > 1 and sys.argv[1] == "build_ranking":
        build_ranking_by_market(split_events)
    elif len(sys.argv) > 1 and sys.argv[1] == "build_stophigh":
        build_stophigh()
    elif len(sys.argv) > 1 and sys.argv[1] == "build_window_scores":
        build_window_scores()
    elif len(sys.argv) > 1 and sys.argv[1] == "build_popular":
        build_popular(split_events)
    elif len(sys.argv) > 1 and sys.argv[1] == "build_ranking_cards":
        build_ranking_cards(split_events)
    elif len(sys.argv) > 1 and sys.argv[1] == "build_stophigh_cards":
        build_stophigh_cards(split_events)
    elif len(sys.argv) > 1 and sys.argv[1] == "build_popular_cards":
        build_popular_cards(split_events)
    else:
        main(split_events)
