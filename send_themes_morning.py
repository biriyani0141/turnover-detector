"""
朝の米テーマ定時送信スクリプト（GitHub Actions 上で動作）

処理の流れ:
  1. 送信済みフラグ確認（同日2回防止）
  2. stock-themes API 取得（themes_image.fetch_raw）
  3. データ鮮度判定（UTC 20:00以降の更新 AND 1日非ゼロ>50%）
  4. 未更新 かつ 最終試行でなければ → スキップして次回リトライ
  5. 4分類画像を生成（themes_image.make_4class_image）し Discord Webhook で送信
  6. 送信済みフラグを data/ に記録

API取得・分類・画像生成ロジックは themes_image.py に一本化。
"""
from __future__ import annotations
import os, sys, json, datetime, requests
from pathlib import Path

# themes_image は同ディレクトリに置かれている
sys.path.insert(0, str(Path(__file__).parent))
import themes_image  # type: ignore

# ── 設定 ──────────────────────────────────────────────────────────────────────
WEBHOOK_URL = os.environ.get("DISCORD_WEBHOOK_URL", "")
FORCE_SEND  = os.environ.get("FORCE_SEND", "0") == "1"
DATA_DIR    = Path("data")


# ── 送信済みフラグ ────────────────────────────────────────────────────────────
def _jst_today() -> datetime.date:
    return (datetime.datetime.utcnow() + datetime.timedelta(hours=9)).date()

def _flag_path(d: datetime.date) -> Path:
    return DATA_DIR / f"themes_sent_{d}.flag"

def already_sent(d: datetime.date) -> bool:
    return _flag_path(d).exists()

def mark_sent(d: datetime.date, note: str = "") -> None:
    DATA_DIR.mkdir(exist_ok=True)
    _flag_path(d).write_text(
        f"sent_at: {datetime.datetime.utcnow().isoformat()}Z\n{note}\n",
        encoding="utf-8",
    )


# ── 鮮度判定（FORCE_SEND オーバーライド付き） ─────────────────────────────────
def is_fresh(raw: dict) -> bool:
    if FORCE_SEND:
        return True
    fresh = themes_image.is_fresh(raw)
    if not fresh:
        s = raw.get("last_update") or raw.get("data_updated_at", "?")
        print(f"  [鮮度NG] last_update={s}")
    return fresh


# ── 最終試行判定 ──────────────────────────────────────────────────────────────
def is_last_attempt() -> bool:
    """JST 7:30 = UTC 22:30 以降なら最終試行とみなす。"""
    if FORCE_SEND:
        return True
    t = datetime.datetime.utcnow()
    return t.hour > 22 or (t.hour == 22 and t.minute >= 30)


# ── キャッシュ（前営業日フォールバック用） ─────────────────────────────────────
CACHE_FILE = DATA_DIR / "themes_latest_valid.json"

def save_cache(themes: list[dict], stock_date: str, updated_at: str) -> None:
    DATA_DIR.mkdir(exist_ok=True)
    CACHE_FILE.write_text(
        json.dumps({"themes": themes, "stock_date": stock_date,
                    "updated_at": updated_at,
                    "saved_at": datetime.datetime.utcnow().isoformat()},
                   ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

def load_cache() -> dict | None:
    if not CACHE_FILE.exists():
        return None
    try:
        return json.loads(CACHE_FILE.read_text(encoding="utf-8"))
    except Exception:
        return None


# ── Discord 送信（Webhook + 複数画像） ───────────────────────────────────────
def send_discord_images(paths: list[str], content: str = "") -> bool:
    if not WEBHOOK_URL:
        print("DISCORD_WEBHOOK_URL 未設定")
        return False
    handles = []
    try:
        files = []
        for i, p in enumerate(paths):
            fh = open(p, "rb")
            handles.append(fh)
            files.append((f"files[{i}]", (f"themes_{i}.png", fh, "image/png")))
        r = requests.post(
            WEBHOOK_URL,
            data={"payload_json": json.dumps({"content": content})},
            files=files,
            timeout=30,
        )
        print(f"Discord: {r.status_code}")
        return r.status_code in (200, 204)
    except Exception as e:
        print(f"Discord 送信エラー: {e}")
        return False
    finally:
        for fh in handles:
            fh.close()


# ── main ──────────────────────────────────────────────────────────────────────
def main() -> int:
    jst_today = _jst_today()
    print(f"JST today: {jst_today}  UTC now: {datetime.datetime.utcnow().strftime('%H:%M')}")

    if already_sent(jst_today) and not FORCE_SEND:
        print(f"本日 ({jst_today}) は送信済み。スキップ。")
        return 0

    print("stock-themes API 取得中...")
    try:
        raw = themes_image.fetch_raw()
    except Exception as e:
        print(f"取得失敗: {e}")
        return 1

    fresh = is_fresh(raw)
    last  = is_last_attempt()
    print(f"is_fresh={fresh}  is_last_attempt={last}  FORCE_SEND={FORCE_SEND}")

    # 未更新 かつ 最終試行でない → スキップして次回リトライ
    if not fresh and not last and not FORCE_SEND:
        upd = raw.get("last_update") or raw.get("data_updated_at", "?")
        print(f"データ未更新 (last_update={upd})。10分後に再試行。")
        return 0

    # 未更新 かつ 最終試行（JST 7:30）→ キャッシュフォールバック
    if not fresh and last and not FORCE_SEND:
        cached = load_cache()
        if cached:
            print(f"最終試行: API未更新。キャッシュ（{cached.get('stock_date')}）を使用。")
            sd  = cached["stock_date"]
            uad = cached.get("updated_at", "")
            p4c = themes_image.make_4class_image_from_themes(cached["themes"], sd, uad)
            p1d = themes_image.make_rank_image(cached["themes"], "1d", sd, uad)
            p5d = themes_image.make_rank_image(cached["themes"], "5d", sd, uad)
            content = f"米テーマ動向 {sd} ※前営業日分"
            if send_discord_images([p4c, p1d, p5d], content):
                mark_sent(jst_today, "fallback_cache")
                print("キャッシュフォールバック送信完了")
                return 0
            return 1
        else:
            print("最終試行: API未更新 かつ キャッシュなし。本日の送信をスキップ。")
            mark_sent(jst_today, "skipped_no_data")
            return 0

    # 通常フロー: fresh=True（または FORCE_SEND）
    themes, stock_date, updated_at = themes_image.build_themes(raw)
    classified, median_r1 = themes_image.classify(themes)
    p4c = themes_image.make_4class_image(classified, median_r1, stock_date, updated_at)
    p1d = themes_image.make_rank_image(themes, "1d", stock_date, updated_at)
    p5d = themes_image.make_rank_image(themes, "5d", stock_date, updated_at)
    content = f"米テーマ動向 {stock_date}"

    print(f"送信: stock_date={stock_date}  updated_at={updated_at}")
    if send_discord_images([p4c, p1d, p5d], content):
        save_cache(themes, stock_date, updated_at)
        mark_sent(jst_today, f"stock_date={stock_date}\nupdated_at={updated_at}")
        print("送信完了・フラグ記録・キャッシュ更新")
        return 0
    else:
        print("送信失敗")
        return 1


if __name__ == "__main__":
    sys.exit(main())
