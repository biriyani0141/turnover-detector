"""
J-Quants メタ情報構築モジュール
data/jquants/meta.json に銘柄ガワ情報と株式数を格納する。
pandas / SQLite 不使用。標準ライブラリ + requests のみ。
"""
from __future__ import annotations
import os
import json
import datetime
import time
import requests
from pathlib import Path

BASE_URL = "https://api.jquants.com/v2"
META_FILE = Path(__file__).parent / "data" / "jquants" / "meta.json"
DAILY_DIR = Path(__file__).parent / "data" / "jquants" / "daily"
SHARES_FIELD = "ShOutFY"


def _api_key() -> str:
    key = os.environ.get("JQUANTS_API_KEY")
    if not key:
        print("エラー: 環境変数 JQUANTS_API_KEY が未設定")
        raise SystemExit(1)
    return key


def _headers(api_key: str) -> dict:
    return {"x-api-key": api_key}


def fetch_listed_info(api_key: str) -> list[dict]:
    """GET /v2/equities/master (最新全銘柄) を全ページ取得して返す。"""
    results: list[dict] = []
    params: dict = {}
    while True:
        r = requests.get(
            f"{BASE_URL}/equities/master",
            headers=_headers(api_key),
            params=params,
            timeout=30,
        )
        r.raise_for_status()
        body = r.json()
        page = body.get("data", [])
        results.extend(page)
        pagination_key = body.get("pagination_key")
        if not pagination_key:
            break
        params = {"pagination_key": pagination_key}
    return results


def build_meta_step1() -> None:
    """STEP1: /listed/info で銘柄ガワを構築して meta.json に保存する。"""
    api_key = _api_key()

    print("=== /listed/info 取得中 ===")
    info_list = fetch_listed_info(api_key)
    if not info_list:
        print("エラー: /listed/info から0件しか取得できませんでした")
        raise SystemExit(1)

    print("\n--- 最初の1銘柄の生レスポンス ---")
    print(json.dumps(info_list[0], ensure_ascii=False, indent=2))

    # 確定マッピングフィールドが存在するか確認
    expected_fields = ["Code", "CoName", "S17Nm", "S33Nm", "MktNm", "ScaleCat", "ProdCat"]
    sample = info_list[0]
    missing = [f for f in expected_fields if f not in sample]
    if missing:
        print(f"\n【不一致】期待フィールドが存在しません: {missing}")
        print("実際のフィールド一覧:")
        for k in sample.keys():
            print(f"  {k}")
        print("マッピング不一致のため停止。")
        raise SystemExit(1)

    print("\nマッピングフィールド確認: OK")

    stocks: dict[str, dict] = {}
    for item in info_list:
        code = item.get("Code", "")
        if not code or len(code) != 5:
            continue
        stocks[code] = {
            "name": item.get("CoName", ""),
            "sector17": item.get("S17Nm", ""),
            "sector33": item.get("S33Nm", ""),
            "market": item.get("MktNm", ""),
            "scale": item.get("ScaleCat", ""),
            "prodcat": item.get("ProdCat", "unknown"),
            "shares": [],
        }

    META_FILE.parent.mkdir(parents=True, exist_ok=True)
    meta = {
        "_updated": datetime.date.today().isoformat(),
        "_shares_field": SHARES_FIELD,
        "stocks": stocks,
    }
    META_FILE.write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"\nlisted/info: {len(stocks)}件 格納")
    print(f"保存先: {META_FILE}")


def _daily_dates_last_year() -> list[str]:
    """蓄積済み日足ファイルから直近1年分の日付リスト(降順)を返す。"""
    if not DAILY_DIR.exists():
        return []
    cutoff = (datetime.date.today() - datetime.timedelta(days=366)).isoformat()
    dates = sorted(
        [p.stem for p in DAILY_DIR.glob("*.json") if p.stem >= cutoff],
        reverse=True,
    )
    return dates


def _fetch_summary_page(api_key: str, date: str, pagination_key: str | None = None) -> tuple[list[dict], str | None]:
    """fins/summary を1ページ分取得して (data, next_pagination_key) を返す。429は呼び出し元でリトライ。"""
    params: dict = {"date": date}
    if pagination_key:
        params["pagination_key"] = pagination_key
    r = requests.get(
        f"{BASE_URL}/fins/summary",
        headers={"x-api-key": api_key},
        params=params,
        timeout=30,
    )
    if r.status_code == 429:
        raise RuntimeError(f"429 Too Many Requests: {r.text}")
    r.raise_for_status()
    body = r.json()
    return body.get("data", []), body.get("pagination_key")


def _fetch_summary_all(api_key: str, date: str, sleep_sec: float = 0.5) -> list[dict]:
    """fins/summary を全ページ取得して返す。429は3回リトライ。"""
    results: list[dict] = []
    pagination_key: str | None = None
    retry_sleep = sleep_sec
    while True:
        for attempt in range(3):
            try:
                page, pagination_key = _fetch_summary_page(api_key, date, pagination_key)
                break
            except RuntimeError as e:
                if "429" in str(e) and attempt < 2:
                    retry_sleep *= 2
                    print(f"  429発生 sleep={retry_sleep:.1f}s でリトライ ({attempt+1}/3)")
                    time.sleep(retry_sleep)
                else:
                    print(f"  エラー全文: {e}")
                    raise
        results.extend(page)
        if not pagination_key:
            break
        time.sleep(sleep_sec)
    return results


def _save_meta(meta: dict) -> None:
    META_FILE.write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")


def _apply_records(stocks: dict, records: list[dict]) -> tuple[int, int, set]:
    """records を stocks の shares に反映する。(skip_shout, skip_code, filled_codes) を返す。"""
    skip_no_shout = 0
    skip_no_code = 0
    filled_codes: set[str] = set()

    for rec in records:
        code = rec.get("Code", "")
        shout = rec.get("ShOutFY", "")
        cur_per_en = rec.get("CurPerEn", "")

        if not shout:
            skip_no_shout += 1
            continue
        if code not in stocks:
            skip_no_code += 1
            continue

        entry = {"date": cur_per_en, "value": int(shout)}
        shares = stocks[code]["shares"]

        for j, s in enumerate(shares):
            if s["date"] == cur_per_en:
                shares[j] = entry
                break
        else:
            shares.append(entry)

        stocks[code]["shares"] = sorted(shares, key=lambda x: x["date"])
        filled_codes.add(code)

    return skip_no_shout, skip_no_code, filled_codes


def _load_meta() -> dict:
    if not META_FILE.exists():
        print("エラー: meta.json が存在しません。先に STEP1 を実行してください。")
        raise SystemExit(1)
    return json.loads(META_FILE.read_text(encoding="utf-8"))


def build_meta_full() -> None:
    """フル走査: fins/summary を直近1年分すべて走査して shares を充填する。"""
    api_key = _api_key()
    meta = _load_meta()
    meta["_shares_field"] = SHARES_FIELD
    stocks = meta["stocks"]

    dates = _daily_dates_last_year()
    if not dates:
        print("エラー: 蓄積済み日付が見つかりません。")
        raise SystemExit(1)

    print(f"=== フル走査: fins/summary 走査開始 ===")
    print(f"対象日付数: {len(dates)}  ({dates[-1]} 〜 {dates[0]})")

    total_calls = 0
    total_skip_shout = 0
    total_skip_code = 0
    all_filled: set[str] = set()
    all_fins_codes: set[str] = set()
    all_unknown_codes: set[str] = set()

    for i, date in enumerate(dates):
        try:
            records = _fetch_summary_all(api_key, date)
        except Exception as e:
            print(f"[{date}] 取得エラー — 全文: {e}")
            raise

        total_calls += 1
        for rec in records:
            c = rec.get("Code", "")
            all_fins_codes.add(c)
            if c not in stocks:
                all_unknown_codes.add(c)
        s, c, filled = _apply_records(stocks, records)
        total_skip_shout += s
        total_skip_code += c
        all_filled |= filled

        _save_meta(meta)
        time.sleep(0.5)

        if (i + 1) % 50 == 0:
            print(f"  進捗: {i+1}/{len(dates)} 日付処理済  充填銘柄数={len(all_filled)}")

    print(f"\n=== フル走査 完了 ===")
    print(f"処理日付数: {len(dates)}  総コール数: {total_calls}")
    print(f"shares が1件以上入った銘柄数: {len(all_filled)}")
    print(f"skip（ShOutFY欠損）: {total_skip_shout}件")
    print(f"skip（未登録Code）: {total_skip_code}件")

    unknown_pct = len(all_unknown_codes) / len(all_fins_codes) * 100 if all_fins_codes else 0
    print(f"\n=== 汚染ゼロ検証 ===")
    print(f"fins出現ユニークCode総数: {len(all_fins_codes)}")
    print(f"master未登録ユニークCode: {len(all_unknown_codes)}件 ({unknown_pct:.1f}%)")

    for code, name in [("25900", "ダイドーHD"), ("27500", "石光商事"), ("39100", "エムケイシステム"), ("41800", "Appier")]:
        s = stocks.get(code, {}).get("shares", [])
        print(f"\n{code} ({name}) shares ({len(s)}件):")
        for entry in s:
            print(f"  {entry}")

    for code, name in [("72030", "トヨタ"), ("99840", "SBG"), ("65010", "ソニーG")]:
        s = stocks.get(code, {}).get("shares", [])
        print(f"\n{code} ({name}) shares ({len(s)}件):")
        for entry in s[-5:]:
            print(f"  {entry}")


def build_meta_update() -> None:
    """差分更新: 最新1営業日の fins/summary だけ取得して shares に反映する。"""
    api_key = _api_key()
    meta = _load_meta()
    stocks = meta["stocks"]

    if not DAILY_DIR.exists():
        print("エラー: 蓄積済み日足ディレクトリが見つかりません。")
        raise SystemExit(1)

    all_dates = sorted([p.stem for p in DAILY_DIR.glob("*.json")], reverse=True)
    if not all_dates:
        print("エラー: 蓄積済み日付が見つかりません。")
        raise SystemExit(1)

    target_date = all_dates[0]
    print(f"=== 差分更新: 対象日付={target_date} ===")

    try:
        records = _fetch_summary_all(api_key, target_date)
    except Exception as e:
        print(f"[{target_date}] 取得エラー — 全文: {e}")
        raise

    skip_shout, skip_code, filled = _apply_records(stocks, records)

    meta["_updated"] = datetime.date.today().isoformat()
    _save_meta(meta)

    print(f"コール数: 1  反映件数: {len(filled)}")
    print(f"skip（ShOutFY欠損）: {skip_shout}件")
    print(f"skip（未登録Code）: {skip_code}件")
    print(f"_updated: {meta['_updated']}")


def build_meta_step4() -> None:
    """STEP4: ProdCat付与 + shares有り銘柄集計 + 未登録Code正体調査。"""
    api_key = _api_key()
    meta = _load_meta()
    stocks = meta["stocks"]

    # 1. equities/master から ProdCat を取得して付与
    print("=== STEP4: ProdCat付与 ===")
    master_list = fetch_listed_info(api_key)
    code_to_prodcat: dict[str, str] = {}
    code_to_name: dict[str, str] = {}
    for item in master_list:
        code = item.get("Code", "")
        if code:
            code_to_prodcat[code] = item.get("ProdCat", "unknown")
            code_to_name[code] = item.get("CoName", "")

    for code, stock in stocks.items():
        stock["prodcat"] = code_to_prodcat.get(code, "unknown")

    _save_meta(meta)
    print(f"prodcat 付与完了: {len(stocks)}件")

    # 2. shares有り銘柄を prodcat 別にカウント
    prodcat_label = {
        "011": "内国株券", "012": "優先出資証券", "013": "REIT", "014": "ETF",
        "021": "外国株券", "022": "外国REIT", "023": "外国ETF", "024": "外国株預託証券",
    }
    counts: dict[str, int] = {}
    total_with_shares = 0
    for stock in stocks.values():
        if stock.get("shares"):
            pc = stock.get("prodcat", "unknown")
            counts[pc] = counts.get(pc, 0) + 1
            total_with_shares += 1

    print("\n--- shares有り銘柄の prodcat 内訳 ---")
    for pc, cnt in sorted(counts.items()):
        label = prodcat_label.get(pc, pc)
        print(f"  {pc} {label}: {cnt}件")
    match = "一致" if total_with_shares == 3771 else f"不一致（期待3771）"
    print(f"  合計: {total_with_shares}件 → STEP2の3771と{match}")

    # 3. fins/summary 1年分を再走査して未登録Codeの正体を調査
    print("\n--- 未登録Code調査（fins/summary 再走査） ---")
    dates = _daily_dates_last_year()
    print(f"走査日付数: {len(dates)}")

    skip_total = 0
    unknown_codes: dict[str, int] = {}

    for i, date in enumerate(dates):
        try:
            records = _fetch_summary_all(api_key, date)
        except Exception as e:
            print(f"[{date}] 取得エラー — 全文: {e}")
            raise

        for rec in records:
            code = rec.get("Code", "")
            shout = rec.get("ShOutFY", "")
            if not shout:
                continue
            if code not in stocks:
                skip_total += 1
                unknown_codes[code] = unknown_codes.get(code, 0) + 1

        time.sleep(0.5)
        if (i + 1) % 50 == 0:
            print(f"  進捗: {i+1}/{len(dates)}")

    match_skip = "一致" if skip_total == 757 else f"不一致（期待757）"
    print(f"\n(a) 延べ skip レコード数: {skip_total}件 → STEP2の757と{match_skip}")
    print(f"(b) ユニーク未登録Code数: {len(unknown_codes)}件")
    print("\nユニーク未登録Code 先頭20件（Code / 名前 / 出現回数）:")
    for code in sorted(unknown_codes.keys())[:20]:
        name = code_to_name.get(code, "(masterに無し)")
        print(f"  {code}: {name}  (出現{unknown_codes[code]}回)")


def build_meta_step4b() -> None:
    """STEP4追加調査: 未登録239件の正体特定。meta.json変更なし。"""
    api_key = _api_key()
    meta = _load_meta()
    stocks = meta["stocks"]

    # fins/summary 再走査：未登録Codeのサンプルレコードを1件ずつ収集
    dates = _daily_dates_last_year()
    print(f"=== 未登録Code正体調査 ===")
    print(f"走査日付数: {len(dates)}")

    unknown_sample: dict[str, dict] = {}
    unknown_counts: dict[str, int] = {}

    for i, date in enumerate(dates):
        try:
            records = _fetch_summary_all(api_key, date)
        except Exception as e:
            print(f"[{date}] 取得エラー — 全文: {e}")
            raise

        for rec in records:
            code = rec.get("Code", "")
            shout = rec.get("ShOutFY", "")
            if not shout:
                continue
            if code not in stocks:
                unknown_counts[code] = unknown_counts.get(code, 0) + 1
                if code not in unknown_sample:
                    unknown_sample[code] = rec

        time.sleep(0.5)
        if (i + 1) % 50 == 0:
            print(f"  進捗: {i+1}/{len(dates)}  未登録Code累計={len(unknown_sample)}")

    print(f"\n未登録ユニークCode総数: {len(unknown_sample)}件")

    # master から名前マップを再取得（digit-shift 候補確認用）
    master_list = fetch_listed_info(api_key)
    master_by_code: dict[str, str] = {item.get("Code", ""): item.get("CoName", "") for item in master_list}

    # 先頭30件を出力
    sorted_codes = sorted(unknown_sample.keys())
    print("\n--- 先頭30件（Code / DocType / CurPerEn / 出現回数） ---")
    for code in sorted_codes[:30]:
        rec = unknown_sample[code]
        doc_type = rec.get("DocType", "")
        cur_per_en = rec.get("CurPerEn", "")
        cnt = unknown_counts.get(code, 0)
        print(f"  {code}: DocType={doc_type}  CurPerEn={cur_per_en}  出現{cnt}回")

    # DocType 分布
    doc_type_dist: dict[str, int] = {}
    for rec in unknown_sample.values():
        dt = rec.get("DocType", "")
        doc_type_dist[dt] = doc_type_dist.get(dt, 0) + 1
    print("\n--- DocType 分布（未登録Code 239件） ---")
    for dt, cnt in sorted(doc_type_dist.items(), key=lambda x: -x[1]):
        print(f"  {cnt}件: {dt}")

    # 桁ズレ突き合わせ検査
    digit_shift_hits: list[tuple[str, str, str]] = []
    for code in sorted_codes:
        # 末尾1文字削除（5→4桁）が stocks に 5桁化して存在するか
        root4 = code[:4]
        candidate5 = root4 + "0"
        if candidate5 in stocks and candidate5 != code:
            digit_shift_hits.append((code, candidate5, "先頭4桁+0"))
        # A→0 置換
        if "A" in code:
            alt = code.replace("A", "0")
            if alt in stocks:
                digit_shift_hits.append((code, alt, "A→0置換"))
        # 末尾の文字違いバリアント（末尾0→末尾0以外で stocks にあるか）
        for suffix in "123456789":
            alt = code[:4] + suffix
            if alt in stocks:
                digit_shift_hits.append((code, alt, f"末尾{suffix}違い"))
                break

    print(f"\n--- 桁ズレ / 表記ゆれで stocks に一致した件数: {len(digit_shift_hits)}件 ---")
    if digit_shift_hits:
        print("例（先頭10件）:")
        for fins_code, master_code, reason in digit_shift_hits[:10]:
            master_name = master_by_code.get(master_code, "")
            print(f"  fins={fins_code} → stocks={master_code} ({master_name}) [{reason}]")

    # DocType に REIT 文字列が含まれるか判定
    reit_kw = ["REIT", "reit"]
    infra_kw = ["Infrastructure", "Infra"]
    reit_count = sum(1 for rec in unknown_sample.values()
                     if any(kw in rec.get("DocType", "") for kw in reit_kw + infra_kw))
    other_count = len(unknown_sample) - reit_count
    print(f"\n--- DocTypeベース REIT/インフラ 該当数 ---")
    print(f"  REIT/Infrastructure含む: {reit_count}件")
    print(f"  その他: {other_count}件")


def build_meta_step4c() -> None:
    """STEP4最終検算: meta.json のみ参照。API不使用。変更なし。"""
    meta = _load_meta()
    stocks = meta["stocks"]

    # 1. prodcat 別 総数（母数）
    prodcat_total: dict[str, int] = {}
    for stock in stocks.values():
        pc = stock.get("prodcat", "unknown")
        prodcat_total[pc] = prodcat_total.get(pc, 0) + 1

    prodcat_label = {
        "011": "内国株券", "012": "優先出資証券", "013": "REIT", "014": "ETF",
        "021": "外国株券", "022": "外国REIT", "023": "外国ETF", "024": "外国株預託証券",
    }
    print("=== prodcat別 総数（母数）===")
    for pc, cnt in sorted(prodcat_total.items()):
        label = prodcat_label.get(pc, pc)
        print(f"  {pc} {label}: {cnt}件")
    print(f"  合計: {sum(prodcat_total.values())}件")

    # 2. 011内国株 shares有り/空 分類
    stocks_011 = {code: s for code, s in stocks.items() if s.get("prodcat") == "011"}
    has_shares = {code: s for code, s in stocks_011.items() if s.get("shares")}
    no_shares  = {code: s for code, s in stocks_011.items() if not s.get("shares")}

    print(f"\n=== 011内国株 shares有り/空 内訳 ===")
    print(f"  shares有り: {len(has_shares)}件")
    print(f"  shares空:   {len(no_shares)}件")
    print(f"  合計:       {len(stocks_011)}件 (prodcat011総数と一致: {len(stocks_011) == prodcat_total.get('011', 0)})")

    # 3. shares空011の先頭30件
    print(f"\n--- shares空の011銘柄 先頭30件（Code / name） ---")
    for code in sorted(no_shares.keys())[:30]:
        name = no_shares[code].get("name", "")
        market = no_shares[code].get("market", "")
        scale = no_shares[code].get("scale", "")
        print(f"  {code}: {name}  ({market} / {scale})")

    # 4. market別011総数 vs 東証公表値
    tse_official = {"プライム": 1840, "スタンダード": 1567, "グロース": 580}
    market_count: dict[str, int] = {}
    for s in stocks_011.values():
        mkt = s.get("market", "その他")
        market_count[mkt] = market_count.get(mkt, 0) + 1

    print(f"\n=== market別 011総数 vs 東証公表値 ===")
    for mkt in ["プライム", "スタンダード", "グロース"]:
        actual = market_count.get(mkt, 0)
        official = tse_official.get(mkt, 0)
        diff = actual - official
        print(f"  {mkt}: meta={actual}件  東証公表={official}件  差={diff:+d}件")
    for mkt, cnt in sorted(market_count.items()):
        if mkt not in tse_official:
            print(f"  {mkt}: meta={cnt}件  （東証公表値なし）")


def build_meta_step5_check() -> None:
    """STEP5事前確認: 英字入りの未登録Codeと旧コードの対応表を作成。meta.json変更なし。"""
    api_key = _api_key()
    meta = _load_meta()
    stocks = meta["stocks"]

    # fins/summary 再走査: 未登録 & ShOutFY有りのユニークCodeを収集
    dates = _daily_dates_last_year()
    print(f"=== STEP5事前確認: 英字コード照合 ===")
    print(f"走査日付数: {len(dates)}")

    unknown_codes: set[str] = set()
    for i, date in enumerate(dates):
        try:
            records = _fetch_summary_all(api_key, date)
        except Exception as e:
            print(f"[{date}] 取得エラー — 全文: {e}")
            raise
        for rec in records:
            code = rec.get("Code", "")
            if rec.get("ShOutFY") and code not in stocks:
                unknown_codes.add(code)
        time.sleep(0.5)
        if (i + 1) % 50 == 0:
            print(f"  進捗: {i+1}/{len(dates)}  累計未登録={len(unknown_codes)}")

    print(f"\n未登録ユニークCode総数: {len(unknown_codes)}件")

    # 英字(A-Z)を含むコードを抽出
    alpha_codes = sorted(c for c in unknown_codes if any(ch.isalpha() for ch in c))
    numeric_only = sorted(c for c in unknown_codes if not any(ch.isalpha() for ch in c))
    print(f"英字含む: {len(alpha_codes)}件  数字のみ: {len(numeric_only)}件")

    # master名前マップ取得
    master_list = fetch_listed_info(api_key)
    code_to_name: dict[str, str] = {item.get("Code", ""): item.get("CoName", "") for item in master_list}

    # 各英字コードについて複数の変換を試みる
    def candidates(code: str) -> list[tuple[str, str]]:
        result = []
        # (a) 全ての英字を0に置換
        a = "".join("0" if ch.isalpha() else ch for ch in code)
        result.append((a, "英字→0全置換"))
        # (b) 英字を除いて4桁取り出し→末尾0追加
        digits = "".join(ch for ch in code if ch.isdigit())
        b = (digits[:4] + "0")[:5]
        if b != a:
            result.append((b, "数字4桁+0"))
        # (c) 英字位置を削除して4桁→末尾0
        c = digits + "0"
        c = c[:5]
        if c != a and c != b:
            result.append((c, "数字詰め+0"))
        return result

    matched: list[tuple[str, str, str]] = []   # (new_code, old_code, method)
    unmatched: list[str] = []

    for code in alpha_codes:
        hit = None
        for cand, method in candidates(code):
            if cand in stocks:
                hit = (code, cand, method)
                break
        if hit:
            matched.append(hit)
        else:
            unmatched.append(code)

    print(f"\n--- 英字コード全リスト({len(alpha_codes)}件) ---")
    for code in alpha_codes:
        print(f"  {code}")

    print(f"\n--- 変換で一致した対応表({len(matched)}件) ---")
    print(f"{'fins新コード':<10}  {'旧コード':<10}  {'変換方法':<16}  銘柄名")
    for new, old, method in matched:
        name = code_to_name.get(old, stocks.get(old, {}).get("name", ""))
        print(f"  {new:<10}  {old:<10}  {method:<16}  {name}")

    print(f"\n--- 対応不明({len(unmatched)}件) ---")
    for code in unmatched:
        print(f"  {code}")


if __name__ == "__main__":
    import sys
    cmd = sys.argv[1] if len(sys.argv) > 1 else ""
    if cmd in ("", "full"):
        build_meta_full()
    elif cmd == "update":
        build_meta_update()
    elif cmd == "step1":
        build_meta_step1()
    elif cmd == "step4":
        build_meta_step4()
    elif cmd == "step4b":
        build_meta_step4b()
    elif cmd == "step4c":
        build_meta_step4c()
    elif cmd == "step5check":
        build_meta_step5_check()
    else:
        print(f"不明な引数: {cmd}")
        print("使い方: python jquants_meta.py [full|update|step1|step4|step4b|step4c|step5check]")
        raise SystemExit(1)
