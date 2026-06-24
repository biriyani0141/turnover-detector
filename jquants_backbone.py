"""
J-Quants V2 API を使った日足差分蓄積モジュール（器の検証用）
既存ファイル（main.py 等）とは完全独立。
pandas / SQLite 不使用。標準ライブラリ + requests のみ。

V2 仕様:
  認証: x-api-key ヘッダーに API キーを渡す（リフレッシュトークンは廃止）
  銘柄一覧: GET /v2/equities/master
  日足:     GET /v2/equities/bars/daily  パラメータ: code(5桁) / from / to
"""
from __future__ import annotations
import os, json, datetime, time, random
import requests
from pathlib import Path

# ── 設定 ─────────────────────────────────────────────────────────────────────
BASE_URL = "https://api.jquants.com/v2"
DATA_DIR = Path(__file__).parent / "data" / "jquants" / "daily"


# ── 1. 認証（V2: API キー取得） ───────────────────────────────────────────────
def get_api_key() -> str:
    """
    環境変数 JQUANTS_API_KEY から API キーを返す。
    V2 では HTTP トークン交換は不要。キーをそのまま x-api-key に使う。
    """
    key = os.environ.get("JQUANTS_API_KEY")
    if not key:
        raise RuntimeError("JQUANTS_API_KEY が未設定")
    return key


def _headers(api_key: str) -> dict:
    return {"x-api-key": api_key}


# ── 2. 銘柄一覧取得 ───────────────────────────────────────────────────────────
def get_listed_info(api_key: str) -> list[dict]:
    """
    上場銘柄一覧を取得して返す。
    各要素: {Code, CoName, S33Nm(業種33業種名), MktNm(市場名), ...}
    """
    r = requests.get(
        f"{BASE_URL}/equities/master",
        headers=_headers(api_key),
        timeout=30,
    )
    r.raise_for_status()
    return r.json().get("data", [])


# ── 3. 日足取得 ───────────────────────────────────────────────────────────────
def _to5(code: str) -> str:
    """4桁コードを J-Quants の5桁形式（末尾0）に変換する。"""
    c = code.strip()
    return c if len(c) == 5 else c + "0"


def get_daily_quotes(
    api_key: str,
    code: str,
    date_from: str,
    date_to: str,
) -> list[dict]:
    """
    指定銘柄・期間の日足（四本値＋出来高）を取得して返す。
    code は 4桁・5桁どちらでも可。
    date_from / date_to は 'YYYY-MM-DD' 形式。
    """
    r = requests.get(
        f"{BASE_URL}/equities/bars/daily",
        headers=_headers(api_key),
        params={"code": _to5(code), "from": date_from, "to": date_to},
        timeout=30,
    )
    r.raise_for_status()
    return r.json().get("data", [])


# ── 3b. 全銘柄一括取得（code省略、ページネーション対応） ─────────────────────────
def get_daily_all(api_key: str, date: str) -> list[dict]:
    """
    code を指定せず date だけ渡して、その日の全銘柄を取得する。
    ページネーションがあれば全ページを取り切る。
    date は 'YYYY-MM-DD' 形式。
    """
    results: list[dict] = []
    params: dict = {"date": date}
    page_num = 0
    while True:
        r = requests.get(
            f"{BASE_URL}/equities/bars/daily",
            headers=_headers(api_key),
            params=params,
            timeout=30,
        )
        r.raise_for_status()
        body = r.json()
        page = body.get("data", [])
        results.extend(page)
        page_num += 1
        print(f"    ページ {page_num}: {len(page)} 件取得（累計 {len(results)} 件）")
        pkey = body.get("pagination_key")
        if not pkey:
            break
        params = {"date": date, "pagination_key": pkey}
    return results


# ── 4. 保存（日付別 JSON、冪等） ──────────────────────────────────────────────
def save_quotes_to_daily_json(quotes: list[dict]) -> dict[str, int]:
    """
    日足リストを data/jquants/daily/YYYY-MM-DD.json に保存。
    同じ日付ファイルが既存の場合はスキップ（冪等）。
    戻り値: {日付: 保存件数（0 = スキップ）}
    フィールド: V2 の O/H/L/C/Vo を open/high/low/close/volume に正規化して保存。
    """
    DATA_DIR.mkdir(parents=True, exist_ok=True)

    by_date: dict[str, dict[str, dict]] = {}
    for q in quotes:
        date = q.get("Date")
        code = q.get("Code")
        if not date or not code:
            continue
        # 全フィールドを保存（調整後株価・生値・volume をすべて含む）
        by_date.setdefault(date, {})[code] = dict(q)

    result: dict[str, int] = {}
    for date, stocks in sorted(by_date.items()):
        path = DATA_DIR / f"{date}.json"
        new_count = len(stocks)
        if path.exists():
            existing = json.loads(path.read_text(encoding="utf-8"))
            existing_count = len(existing)
            if existing_count >= new_count:
                print(f"  {date}: 既存{existing_count}件 / 新規{new_count}件 → スキップ")
                result[date] = 0
                continue
            else:
                print(f"  {date}: 既存{existing_count}件 / 新規{new_count}件 → 上書き")
        path.write_text(
            json.dumps(stocks, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        result[date] = new_count

    return result


# ── 5. 検証用 main ────────────────────────────────────────────────────────────
TEST_CODES = [
    "7203",  # トヨタ
    "6758",  # ソニーG
    "9984",  # ソフトバンクG
    "6861",  # キーエンス
    "8306",  # 三菱UFJ
    "8316",  # 三井住友FG
    "9432",  # NTT
    "6954",  # ファナック
    "7267",  # ホンダ
    "6501",  # 日立
    "4063",  # 信越化学
    "8035",  # 東京エレクトロン
    "6367",  # ダイキン
    "7751",  # キヤノン
    "9433",  # KDDI
    "6902",  # デンソー
    "7974",  # 任天堂
    "4519",  # 中外製薬
    "6594",  # ニデック
    "7832",  # バンダイナムコ
]


def main() -> None:
    today     = datetime.date.today()
    date_from = (today - datetime.timedelta(days=35)).isoformat()
    date_to   = today.isoformat()

    # ステップ1: 認証（V2 = キー取得のみ、HTTP 通信なし）
    print("=== ステップ1: 認証 ===")
    try:
        api_key = get_api_key()
        print(f"  API キー取得: 成功（length={len(api_key)}）")
    except Exception as e:
        print(f"  エラー: {e}")
        return

    # ステップ2: 銘柄一覧
    print("\n=== ステップ2: 銘柄一覧取得 ===")
    try:
        listed = get_listed_info(api_key)
        print(f"  銘柄数: {len(listed)} 件")
        if listed:
            s = listed[0]
            print(f"  サンプル（1件目）: コード={s.get('Code')} 銘柄名={s.get('CoName')} 業種={s.get('S33Nm')} 市場={s.get('MktNm')}")
    except Exception as e:
        print(f"  銘柄一覧取得エラー: {e}")

    # ステップ3: 少数銘柄の日足取得
    print(f"\n=== ステップ3: 日足取得（{len(TEST_CODES)}銘柄 / {date_from}〜{date_to}）===")
    all_quotes: list[dict] = []
    for code in TEST_CODES:
        try:
            quotes = get_daily_quotes(api_key, code, date_from, date_to)
            print(f"  {code}: {len(quotes)} 件")
            all_quotes.extend(quotes)
            time.sleep(0.2)
        except Exception as e:
            print(f"  {code} エラー: {e}")

    print(f"  合計取得: {len(all_quotes)} 件")

    # ステップ4: 保存
    print("\n=== ステップ4: 保存 ===")
    try:
        saved = save_quotes_to_daily_json(all_quotes)
        for date, n in sorted(saved.items()):
            status = f"{n}銘柄 保存" if n > 0 else "スキップ（既存）"
            print(f"  {date}: {status}")
    except Exception as e:
        print(f"  保存エラー: {e}")
        return

    # ステップ5: 保存確認（最新日付のサンプル表示）
    print("\n=== ステップ5: 保存確認 ===")
    json_files = sorted(DATA_DIR.glob("*.json"))
    if not json_files:
        print("  JSONファイルが見つかりません")
        return
    latest = json_files[-1]
    data   = json.loads(latest.read_text(encoding="utf-8"))
    print(f"  ファイル: {latest.name}  銘柄数: {len(data)}")
    sample_code = next(iter(data))
    print(f"  サンプル ({sample_code}): {data[sample_code]}")


def _last_business_day() -> str:
    """直近の営業日（土日を除いた昨日以前）を返す。"""
    d = datetime.date.today() - datetime.timedelta(days=1)
    while d.weekday() >= 5:
        d -= datetime.timedelta(days=1)
    return d.isoformat()


def main_verify_bulk() -> None:
    """
    Task B 検証: code省略・date指定で全銘柄一括取得できるか確認する。
    直近1営業日のみ。過去分は取得しない。
    """
    target_date = _last_business_day()
    print(f"=== Task B 検証: 全銘柄一括取得 (date={target_date}) ===")

    # 認証
    try:
        api_key = get_api_key()
        print(f"  API キー: SET (length={len(api_key)})")
    except Exception as e:
        print(f"  エラー: {e}")
        return

    # 全銘柄一括取得
    print(f"\n  [1] GET /v2/equities/bars/daily?date={target_date} (code省略)")
    try:
        quotes = get_daily_all(api_key, target_date)
    except Exception as e:
        print(f"  取得エラー: {e}")
        return

    print(f"\n  [2] 取得銘柄数: {len(quotes)} 件")

    if not quotes:
        print("  → 0件。データなし（休業日の可能性）")
        return

    # フィールド名列挙
    print("\n  [3] 1件目のフィールド名一覧:")
    sample = quotes[0]
    for k, v in sample.items():
        print(f"      {k}: {v}")

    # 調整後株価・生値・volume の有無チェック
    adj_fields  = [k for k in sample if "Adjustment" in k or "Adj" in k]
    raw_fields  = [k for k in sample if k in ("Open","High","Low","Close","O","H","L","C")]
    vol_fields  = [k for k in sample if "Volume" in k or "Vo" == k]
    print(f"\n  [4] 調整後フィールド: {adj_fields or '（なし）'}")
    print(f"       生値フィールド   : {raw_fields or '（なし）'}")
    print(f"       volume フィールド: {vol_fields or '（なし）'}")

    # 保存
    print(f"\n  [5] data/jquants/daily/{target_date}.json に保存...")
    try:
        saved = save_quotes_to_daily_json(quotes)
        for d, n in saved.items():
            if n > 0:
                print(f"      {d}: {n}銘柄 保存完了")
            else:
                print(f"      {d}: スキップ（既存ファイルあり）")
    except Exception as e:
        print(f"  保存エラー: {e}")


def main_full_fetch() -> None:
    """
    直近営業日から遡って1年分(約250営業日)の全銘柄日足を
    data/jquants/daily/YYYY-MM-DD.json に蓄積する。
    平日のみループ。祝日はデータ0件で自然スキップ。
    再実行時は既存ファイルをスキップするため冪等。
    """
    today = datetime.date.today()
    start = today - datetime.timedelta(days=365)

    # 直近営業日（当日含む平日）を基準に
    ref = today
    while ref.weekday() >= 5:
        ref -= datetime.timedelta(days=1)

    # 平日リストを降順（新しい日付から）で生成
    dates: list[str] = []
    d = ref
    while d >= start:
        if d.weekday() < 5:
            dates.append(d.isoformat())
        d -= datetime.timedelta(days=1)

    total = len(dates)
    print(f"=== full_fetch 開始: {ref.isoformat()} ← {start.isoformat()} ({total}平日候補) ===")

    try:
        api_key = get_api_key()
        print(f"  API キー: SET (length={len(api_key)})")
    except Exception as e:
        print(f"  エラー: {e}")
        return

    saved_days = 0
    skipped_holiday = 0
    skipped_existing = 0
    error_days = 0

    for i, date in enumerate(dates, 1):
        try:
            quotes = get_daily_all(api_key, date)
        except requests.exceptions.HTTPError as e:
            if e.response is not None and e.response.status_code in (401, 403):
                print(f"\n認証エラー ({e.response.status_code}): {e}")
                print("全日付共通エラーのため中断します。")
                return
            print(f"[{i}/{total}] {date}: HTTPエラー {e} → スキップ")
            error_days += 1
            time.sleep(0.5)
            continue
        except Exception as e:
            print(f"[{i}/{total}] {date}: エラー {e} → スキップ")
            error_days += 1
            time.sleep(0.5)
            continue

        if not quotes:
            print(f"[{i}/{total}] {date}: 休場(0件)スキップ")
            skipped_holiday += 1
            time.sleep(random.uniform(0.5, 1.0))
            continue

        try:
            saved = save_quotes_to_daily_json(quotes)
        except Exception as e:
            print(f"[{i}/{total}] {date}: 保存エラー {e} → スキップ")
            error_days += 1
            time.sleep(random.uniform(0.5, 1.0))
            continue

        for save_date, n in saved.items():
            if n > 0:
                print(f"[{i}/{total}] {save_date}: 保存{n}件")
                saved_days += 1
            else:
                print(f"[{i}/{total}] {save_date}: スキップ（既存）")
                skipped_existing += 1

        time.sleep(random.uniform(0.5, 1.0))

    print(f"\n=== full_fetch 完了 ===")
    print(f"  保存済み営業日数  : {saved_days}")
    print(f"  休場スキップ日数  : {skipped_holiday}")
    print(f"  既存スキップ日数  : {skipped_existing}")
    print(f"  エラースキップ日数: {error_days}")
    json_files = list(DATA_DIR.glob("*.json"))
    print(f"  data/jquants/daily/ ファイル総数: {len(json_files)}")


# ── 6. リターン計算 ───────────────────────────────────────────────────────────

RETURN_PERIODS = {"1d": 1, "5d": 5, "1m": 20, "3m": 60, "1y": 250}


def _sorted_dates() -> list[str]:
    """DATA_DIR の全日付を新しい順でリストとして返す。"""
    return sorted([p.stem for p in DATA_DIR.glob("*.json")], reverse=True)


def _load_adj_close(date: str) -> dict[str, float]:
    """{code: AdjC} を返す。ファイルなし or AdjC欠損はスキップ。"""
    path = DATA_DIR / f"{date}.json"
    if not path.exists():
        return {}
    data = json.loads(path.read_text(encoding="utf-8"))
    result: dict[str, float] = {}
    for code, rec in data.items():
        adj_c = rec.get("AdjC")
        if adj_c is not None:
            try:
                result[code] = float(adj_c)
            except (TypeError, ValueError):
                pass
    return result


def calc_returns() -> dict[str, dict]:
    """
    蓄積済み日足から全銘柄の 1d/5d/1m/3m/1y リターン(%)を計算して返す。
    戻り値: {コード: {"1d": float|None, "5d": float|None, "1m": ..., "3m": ..., "1y": ...}}
    - 基準日 = 最新日付。N営業日前 = 保存済み日付を新しい順にN個前。
    - データ不足・銘柄不存在の期間は None。エラーで落とさない。
    """
    dates = _sorted_dates()
    if not dates:
        raise RuntimeError("data/jquants/daily/ に日足ファイルがありません")

    base_date = dates[0]

    # 必要な6日付だけ特定して読み込む
    date_at: dict[int, str] = {}
    for n in RETURN_PERIODS.values():
        if n < len(dates):
            date_at[n] = dates[n]

    # 1y フォールバック: 250営業日前が蓄積範囲外なら最古日を代用
    if 250 not in date_at and len(dates) > 1:
        date_at[250] = dates[-1]
        print(f"1y参照日: {dates[-1]} (250営業日前が無いため最古日で代用)")

    adj_map: dict[str, dict[str, float]] = {base_date: _load_adj_close(base_date)}
    for date in date_at.values():
        if date not in adj_map:
            adj_map[date] = _load_adj_close(date)

    base_prices = adj_map[base_date]

    results: dict[str, dict] = {}
    for code, base_price in base_prices.items():
        row: dict[str, object] = {}
        for period, n in RETURN_PERIODS.items():
            past_date = date_at.get(n)
            if past_date is None:
                row[period] = None
                continue
            past_price = adj_map[past_date].get(code)
            if not past_price:
                row[period] = None
                continue
            row[period] = round((base_price / past_price - 1) * 100, 4)
        results[code] = row

    return results


def main_calc_returns() -> None:
    """calc_returns の検証: サマリー・サンプル・異常値チェック"""
    print("=== calc_returns 検証 ===")

    dates = _sorted_dates()
    print(f"\n蓄積済み日付数: {len(dates)}  基準日: {dates[0] if dates else 'なし'}")
    for period, n in RETURN_PERIODS.items():
        ref = dates[n] if n < len(dates) else "（範囲外）"
        print(f"  {period}({n}営業日前): {ref}")

    try:
        results = calc_returns()
    except Exception as e:
        import traceback
        traceback.print_exc()
        return

    total = len(results)
    print(f"\n対象銘柄数: {total}")

    periods = list(RETURN_PERIODS.keys())
    print("\n--- 各期間の計算結果 ---")
    for p in periods:
        none_n = sum(1 for v in results.values() if v[p] is None)
        print(f"  {p}: 計算済み={total - none_n}件  None={none_n}件")

    # サンプル銘柄（5桁コード）
    samples = [
        ("72030", "トヨタ"),
        ("67580", "ソニーG"),
        ("99840", "ソフトバンクG"),
        ("68610", "キーエンス"),
        ("83060", "三菱UFJ"),
    ]
    print("\n--- サンプル銘柄の5期間リターン ---")
    for code, name in samples:
        r = results.get(code)
        if r is None:
            print(f"  {code} ({name}): データなし（基準日に不存在）")
            continue
        vals = "  ".join(
            f"{p}={r[p]:+.2f}%" if r[p] is not None else f"{p}=None"
            for p in periods
        )
        print(f"  {code} ({name}): {vals}")

    # 異常値チェック（|1d| > 50%）
    extreme = [
        (code, r["1d"])
        for code, r in results.items()
        if r["1d"] is not None and abs(r["1d"]) > 50
    ]
    print(f"\n--- 異常値チェック |1d| > 50% ---")
    if extreme:
        print(f"  {len(extreme)}件:")
        for code, ret in sorted(extreme, key=lambda x: abs(x[1]), reverse=True)[:10]:
            print(f"    {code}: 1d={ret:+.2f}%")
    else:
        print("  なし（分割調整ミスなし）")


if __name__ == "__main__":
    import sys
    if len(sys.argv) > 1 and sys.argv[1] == "verify_bulk":
        main_verify_bulk()
    elif len(sys.argv) > 1 and sys.argv[1] == "full_fetch":
        main_full_fetch()
    elif len(sys.argv) > 1 and sys.argv[1] == "calc_returns":
        main_calc_returns()
    else:
        main()
