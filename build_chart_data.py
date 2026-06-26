"""
chart-data JSON 生成スクリプト（凍結スキーマ・検証用）
既存の ranking 生成ロジック・既存ページには一切触れない別レーン。
出力先: web/public/chart-data/{code}.json （フラット配置）
"""
from __future__ import annotations
import json
from pathlib import Path

from jquants_ranking import (
    DAILY_DIR,
    META_FILE,
    APPEARANCE_FILE,
    _MARKET_NAME_MAP,
    build_split_events,
    get_adjusted_shares,
    _latest_daily_close,
)

CHART_DATA_DIR = Path(__file__).parent / "web" / "public" / "chart-data"
SCHEMA_VERSION = 2
ROWS_KEEP = 50
MA_WINDOW_EXTRA = 199  # ma200 の最古行が窓を満たすのに必要な先行本数
FETCH_WINDOW = ROWS_KEEP + MA_WINDOW_EXTRA  # 249


def _round_ma(values: list[float]) -> float:
    return round(sum(values) / len(values), 1)


def build_chart_data(code: str) -> dict:
    meta = json.loads(META_FILE.read_text(encoding="utf-8"))
    stocks: dict = meta["stocks"]
    stock = stocks.get(code)
    if stock is None:
        raise RuntimeError(f"meta.json に銘柄が見つかりません: {code}")

    by_date: dict[str, list[str]] = {}
    appearance_by_code: dict[str, dict] = {}
    if APPEARANCE_FILE.exists():
        app_data = json.loads(APPEARANCE_FILE.read_text(encoding="utf-8"))
        appearance_by_code = app_data.get("by_code", {})
        by_date = app_data.get("by_date", {})

    json_files = sorted(DAILY_DIR.glob("*.json"))
    split_events = build_split_events(json_files)

    fetch_files = json_files[-FETCH_WINDOW:] if len(json_files) >= FETCH_WINDOW else json_files

    daily_records: list[tuple[str, dict]] = []
    for path in fetch_files:
        data = json.loads(path.read_text(encoding="utf-8"))
        rec = data.get(code)
        if rec is not None:
            daily_records.append((path.stem, rec))

    if not daily_records:
        raise RuntimeError(f"日足データが見つかりません: {code}")

    closes_raw: list[float | None] = []
    for _, rec in daily_records:
        c = rec.get("C")
        closes_raw.append(float(c) if c not in (None, "") else None)

    rows: list[dict] = []
    for i, (date_str, rec) in enumerate(daily_records):
        o, h, l, c, vo = rec.get("O"), rec.get("H"), rec.get("L"), rec.get("C"), rec.get("Vo")
        if any(v is None or v == "" for v in [o, h, l, c, vo]):
            continue

        ma5 = None
        if i >= 4:
            window = closes_raw[i - 4:i + 1]
            if all(v is not None for v in window):
                ma5 = _round_ma(window)
        ma25 = None
        if i >= 24:
            window = closes_raw[i - 24:i + 1]
            if all(v is not None for v in window):
                ma25 = _round_ma(window)
        ma75 = None
        if i >= 74:
            window = closes_raw[i - 74:i + 1]
            if all(v is not None for v in window):
                ma75 = _round_ma(window)
        ma200 = None
        if i >= 199:
            window = closes_raw[i - 199:i + 1]
            if all(v is not None for v in window):
                ma200 = _round_ma(window)

        marks: list[str] = []
        if rec.get("UL") == "1":
            if float(h) > 0 and float(c) == float(h):
                marks.append("shc")
            else:
                marks.append("sht")

        va = rec.get("Va")
        shares_day = get_adjusted_shares(code, date_str, stock, split_events)
        if va not in (None, "") and shares_day:
            try:
                mktcap_day = float(c) * shares_day
                if mktcap_day:
                    turnover_day = float(va) / mktcap_day * 100
                    if turnover_day >= 5:
                        marks.append("turn5")
            except (TypeError, ValueError):
                pass

        if code in by_date.get(date_str, []):
            marks.append("appear")

        row = {
            "date": date_str,
            "o": round(float(o)),
            "h": round(float(h)),
            "l": round(float(l)),
            "c": round(float(c)),
            "v": round(float(vo)),
            "ma5": ma5,
            "ma25": ma25,
            "ma75": ma75,
            "ma200": ma200,
        }
        if marks:
            row["marks"] = marks
        rows.append(row)

    rows = rows[-ROWS_KEEP:]

    date_str, code_to_close, code_to_va = _latest_daily_close()
    c_latest = code_to_close.get(code)
    va_latest = code_to_va.get(code)
    shares_latest = get_adjusted_shares(code, date_str, stock, split_events)

    mktcap = round(c_latest * shares_latest) if (c_latest is not None and shares_latest) else None
    turnover_pct = round(va_latest / mktcap * 100, 1) if (va_latest is not None and mktcap) else None

    prev_close = rows[-2]["c"] if len(rows) >= 2 else None
    change = None
    change_pct = None
    if prev_close is not None and c_latest is not None:
        change = round(c_latest) - prev_close
        if prev_close:
            change_pct = round(change / prev_close * 100, 1)

    latest_raw = json.loads((DAILY_DIR / f"{date_str}.json").read_text(encoding="utf-8")).get(code, {})
    app_entry = appearance_by_code.get(code, {})

    market_raw = stock.get("market", "")
    market = _MARKET_NAME_MAP.get(market_raw, market_raw)

    header = {
        "price": round(c_latest) if c_latest is not None else None,
        "change": change,
        "changePct": change_pct,
        "isStopHigh": latest_raw.get("UL") == "1",
        "turnoverPct": turnover_pct,
        "marketCap": mktcap,
        "appearCount": int(app_entry.get("turnover_50", 0)),
        "stopHighCount": int(app_entry.get("stophigh_50", 0)),
    }

    return {
        "version": SCHEMA_VERSION,
        "code": code,
        "name": stock.get("name", ""),
        "market": market,
        "sector": stock.get("sector33", ""),
        "header": header,
        "rows": rows,
    }


def main(codes: list[str]) -> None:
    CHART_DATA_DIR.mkdir(parents=True, exist_ok=True)
    for code in codes:
        data = build_chart_data(code)
        out_path = CHART_DATA_DIR / f"{code}.json"
        out_path.write_text(
            json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        print(f"{code}.json 出力: rows={len(data['rows'])} -> {out_path}")


def _validate_sample(data: dict, code: str) -> None:
    assert data["version"] == SCHEMA_VERSION, f"version不一致: {data['version']}"
    rows = data["rows"]
    dates = [r["date"] for r in rows]
    assert dates == sorted(dates), "rows の日付が昇順でない"
    for r in rows:
        for key in ("ma5", "ma25", "ma75", "ma200"):
            v = r.get(key)
            if v is not None:
                assert v == round(v, 1), f"MA精度エラー {key}={v}"
    ma200_null = sum(1 for r in rows if r.get("ma200") is None)
    print(f"  サンプル検証OK: {code} rows={len(rows)} ma200_null={ma200_null}")


def build_all_chart_data() -> None:
    """
    母集団（turnover_200 > 0）全銘柄の chart-data v2 一括生成。
    data/jquants/daily/ 既存250ファイルのみ使用。APIコールなし。
    """
    import time as _time
    t0 = _time.time()

    # ── Step 1: 全 daily ファイルを1回だけロード → dict[code][date] = rec ──
    json_files = sorted(DAILY_DIR.glob("*.json"))
    if not json_files:
        print("エラー: daily ファイルが見つかりません")
        return

    print(f"Step1: {len(json_files)} 日分ロード中...")
    code_date_map: dict[str, dict[str, dict]] = {}
    split_events: dict[str, list[tuple[str, float]]] = {}

    for path in json_files:
        date_str = path.stem
        day_data = json.loads(path.read_text(encoding="utf-8"))
        for code, rec in day_data.items():
            if code not in code_date_map:
                code_date_map[code] = {}
            code_date_map[code][date_str] = rec
            adjf_raw = rec.get("AdjFactor")
            if adjf_raw is not None:
                try:
                    adjf = float(adjf_raw)
                except (TypeError, ValueError):
                    continue
                if adjf != 1.0:
                    split_events.setdefault(code, []).append((date_str, adjf))

    for code in split_events:
        split_events[code].sort()

    all_trading_days = [f.stem for f in json_files]
    print(f"  完了: 銘柄数={len(code_date_map)} 営業日数={len(all_trading_days)}")

    # ── Step 2: 母集団取得（turnover_200 > 0）─────────────────────────────
    print("Step2: 母集団取得...")
    if not APPEARANCE_FILE.exists():
        print("エラー: appearance.json が見つかりません")
        return

    app_data = json.loads(APPEARANCE_FILE.read_text(encoding="utf-8"))
    by_code_app: dict[str, dict] = app_data.get("by_code", {})
    by_date_app: dict[str, list[str]] = app_data.get("by_date", {})

    target_codes = [
        code for code, entry in by_code_app.items()
        if entry.get("turnover_200", 0) > 0
    ]
    print(f"  対象銘柄数={len(target_codes)}")

    # ── Step 3: 共通リソース準備 ────────────────────────────────────────────
    meta = json.loads(META_FILE.read_text(encoding="utf-8"))
    stocks: dict = meta["stocks"]

    date_latest = all_trading_days[-1]
    code_to_close: dict[str, float] = {}
    code_to_va: dict[str, float] = {}
    for code, recs in code_date_map.items():
        rec = recs.get(date_latest, {})
        c = rec.get("C")
        if c not in (None, ""):
            try:
                code_to_close[code] = float(c)
            except (TypeError, ValueError):
                pass
        va = rec.get("Va")
        if va not in (None, ""):
            try:
                code_to_va[code] = float(va)
            except (TypeError, ValueError):
                pass

    fetch_days = all_trading_days[-FETCH_WINDOW:]
    CHART_DATA_DIR.mkdir(parents=True, exist_ok=True)

    # ── Step 4: 銘柄ループ ───────────────────────────────────────────────────
    print("Step3: chart-data 生成中...")
    generated = 0
    skip_no_meta = 0
    skip_no_data = 0

    for code in target_codes:
        stock = stocks.get(code)
        if stock is None:
            skip_no_meta += 1
            continue

        code_recs = code_date_map.get(code, {})
        daily_records: list[tuple[str, dict]] = [
            (d, code_recs[d]) for d in fetch_days if d in code_recs
        ]
        if not daily_records:
            skip_no_data += 1
            continue

        closes_raw: list[float | None] = []
        for _, rec in daily_records:
            c = rec.get("C")
            closes_raw.append(float(c) if c not in (None, "") else None)

        rows: list[dict] = []
        for i, (d, rec) in enumerate(daily_records):
            o, h, l, c, vo = rec.get("O"), rec.get("H"), rec.get("L"), rec.get("C"), rec.get("Vo")
            if any(v is None or v == "" for v in [o, h, l, c, vo]):
                continue

            ma5 = ma25 = ma75 = ma200 = None
            if i >= 4:
                w = closes_raw[i - 4:i + 1]
                if all(v is not None for v in w):
                    ma5 = _round_ma(w)
            if i >= 24:
                w = closes_raw[i - 24:i + 1]
                if all(v is not None for v in w):
                    ma25 = _round_ma(w)
            if i >= 74:
                w = closes_raw[i - 74:i + 1]
                if all(v is not None for v in w):
                    ma75 = _round_ma(w)
            if i >= 199:
                w = closes_raw[i - 199:i + 1]
                if all(v is not None for v in w):
                    ma200 = _round_ma(w)

            marks: list[str] = []
            if rec.get("UL") == "1":
                if float(h) > 0 and float(c) == float(h):
                    marks.append("shc")
                else:
                    marks.append("sht")

            va_rec = rec.get("Va")
            shares_day = get_adjusted_shares(code, d, stock, split_events)
            if va_rec not in (None, "") and shares_day:
                try:
                    mktcap_day = float(c) * shares_day
                    if mktcap_day and float(va_rec) / mktcap_day * 100 >= 5:
                        marks.append("turn5")
                except (TypeError, ValueError):
                    pass

            if code in by_date_app.get(d, []):
                marks.append("appear")

            row: dict = {
                "date": d,
                "o": round(float(o)),
                "h": round(float(h)),
                "l": round(float(l)),
                "c": round(float(c)),
                "v": round(float(vo)),
                "ma5": ma5,
                "ma25": ma25,
                "ma75": ma75,
                "ma200": ma200,
            }
            if marks:
                row["marks"] = marks
            rows.append(row)

        rows = rows[-ROWS_KEEP:]
        if not rows:
            skip_no_data += 1
            continue

        c_latest = code_to_close.get(code)
        va_latest = code_to_va.get(code)
        shares_latest = get_adjusted_shares(code, date_latest, stock, split_events)

        mktcap = round(c_latest * shares_latest) if (c_latest is not None and shares_latest) else None
        turnover_pct = round(va_latest / mktcap * 100, 1) if (va_latest is not None and mktcap) else None

        prev_close = rows[-2]["c"] if len(rows) >= 2 else None
        change = change_pct = None
        if prev_close is not None and c_latest is not None:
            change = round(c_latest) - prev_close
            if prev_close:
                change_pct = round(change / prev_close * 100, 1)

        latest_rec = code_recs.get(date_latest, {})
        app_entry = by_code_app.get(code, {})
        market_raw = stock.get("market", "")
        market = _MARKET_NAME_MAP.get(market_raw, market_raw)

        chart_data = {
            "version": SCHEMA_VERSION,
            "code": code,
            "name": stock.get("name", ""),
            "market": market,
            "sector": stock.get("sector33", ""),
            "header": {
                "price": round(c_latest) if c_latest is not None else None,
                "change": change,
                "changePct": change_pct,
                "isStopHigh": latest_rec.get("UL") == "1",
                "turnoverPct": turnover_pct,
                "marketCap": mktcap,
                "appearCount": int(app_entry.get("turnover_50", 0)),
                "stopHighCount": int(app_entry.get("stophigh_50", 0)),
            },
            "rows": rows,
        }

        if generated == 0:
            _validate_sample(chart_data, code)

        out = CHART_DATA_DIR / f"{code}.json"
        out.write_text(json.dumps(chart_data, ensure_ascii=False, indent=2), encoding="utf-8")
        generated += 1

        if generated % 100 == 0:
            print(f"  {generated}件... ({_time.time() - t0:.0f}秒)")

    elapsed = _time.time() - t0
    print(f"\n=== build_all_chart_data 完了 ===")
    print(f"  生成: {generated}件")
    print(f"  スキップ: meta未登録={skip_no_meta} データ不足={skip_no_data}")
    print(f"  所要時間: {elapsed:.1f}秒")


if __name__ == "__main__":
    import sys
    if len(sys.argv) > 1 and sys.argv[1] == "--bulk":
        build_all_chart_data()
    else:
        main(["66130", "52530", "43160"])
