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

META_FILE  = Path(__file__).parent / "data" / "jquants" / "meta.json"
DAILY_DIR  = Path(__file__).parent / "data" / "jquants" / "daily"


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

    turnover_results.sort(key=lambda x: x["turnover_pct"], reverse=True)

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
    print(f"ranking.json 出力: {len(ranking)}件")


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
    turnover_200==0 かつ stophigh_200==0 の銘柄は除外（ノイズ軽減）。
    """
    POPULAR_FILE = APPEARANCE_FILE.parent / "popular.json"

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

    popular: list[dict] = []
    skipped = 0
    for code, entry in by_code.items():
        t200 = entry.get("turnover_200", 0)
        s200 = entry.get("stophigh_200", 0)
        if t200 == 0 and s200 == 0:
            skipped += 1
            continue

        stock = stocks.get(code, {})
        name = stock.get("name", "")

        c = daily.get(code, {}).get("C")
        adj_shares = get_adjusted_shares(code, date_str, stock, split_events)
        if c is not None and adj_shares is not None:
            try:
                mktcap_oku = round(float(c) * adj_shares / 1e8, 1)
            except (TypeError, ValueError):
                mktcap_oku = None
        else:
            mktcap_oku = None

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

    POPULAR_FILE.parent.mkdir(parents=True, exist_ok=True)
    POPULAR_FILE.write_text(
        json.dumps(output, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    file_kb = POPULAR_FILE.stat().st_size / 1024
    print(f"popular.json 出力: {len(popular)}銘柄 / 除外(全窓0): {skipped}銘柄 / {file_kb:.1f}KB")


if __name__ == "__main__":
    import sys
    split_events = build_split_events(sorted(DAILY_DIR.glob("*.json")))
    if len(sys.argv) > 1 and sys.argv[1] == "build_appearance":
        build_appearance_db(split_events)
    elif len(sys.argv) > 1 and sys.argv[1] == "build_ranking":
        build_ranking(split_events)
    elif len(sys.argv) > 1 and sys.argv[1] == "build_stophigh":
        build_stophigh()
    elif len(sys.argv) > 1 and sys.argv[1] == "build_window_scores":
        build_window_scores()
    elif len(sys.argv) > 1 and sys.argv[1] == "build_popular":
        build_popular(split_events)
    else:
        main(split_events)
