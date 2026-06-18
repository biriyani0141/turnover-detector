"""
Discord trigger daemon
  !daikin → python main.py を実行（売買代金×回転率ランキング）
  !themes  → 米国テーマ4分類をテキストで送信
main.py 自体は一切変更しない。
"""
import os, sys, time, subprocess, datetime, requests
from pathlib import Path

# ---- 設定 ----
BOT_TOKEN    = os.environ.get("DISCORD_BOT_TOKEN", "")
WEBHOOK_URL  = os.environ.get("DISCORD_WEBHOOK_URL", "")
CHANNEL_ID   = "1485554568392740894"
MAIN_DIR     = Path(__file__).parent
POLL_SEC     = 30

API_HEADERS  = {"Authorization": f"Bot {BOT_TOKEN}"}


def _is_jp_business_day(d: datetime.date) -> bool:
    if d.weekday() >= 5:
        return False
    try:
        import jpholiday
        if jpholiday.is_holiday(d):
            return False
    except ImportError:
        pass
    if (d.month, d.day) in [(12, 31), (1, 1), (1, 2), (1, 3)]:
        return False
    return True


def _get_messages(after: str | None) -> list[dict]:
    params: dict = {"limit": 20}
    if after:
        params["after"] = after
    try:
        r = requests.get(
            f"https://discord.com/api/v10/channels/{CHANNEL_ID}/messages",
            headers=API_HEADERS,
            params=params,
            timeout=10,
        )
        if r.status_code == 200:
            return r.json()
        print(f"  [warn] Discord API {r.status_code}: {r.text[:100]}")
    except Exception as e:
        print(f"  [warn] poll error: {e}")
    return []


def _post_message(text: str) -> bool:
    """Botとしてチャンネルにテキストを投稿する。"""
    try:
        r = requests.post(
            f"https://discord.com/api/v10/channels/{CHANNEL_ID}/messages",
            headers={**API_HEADERS, "Content-Type": "application/json"},
            json={"content": text[:2000]},
            timeout=10,
        )
        return r.status_code in (200, 204)
    except Exception as e:
        print(f"  [warn] post error: {e}")
        return False


def _post_image(path: str, content: str = "") -> bool:
    """Bot API でチャンネルに画像（PNG）を投稿する。"""
    try:
        with open(path, "rb") as f:
            r = requests.post(
                f"https://discord.com/api/v10/channels/{CHANNEL_ID}/messages",
                headers=API_HEADERS,
                data={"payload_json": __import__("json").dumps({"content": content})},
                files=[("files[0]", (os.path.basename(path), f, "image/png"))],
                timeout=30,
            )
        print(f"  [post_image] {r.status_code}")
        return r.status_code in (200, 204)
    except Exception as e:
        print(f"  [warn] post_image error: {e}")
        return False


def _run_main() -> bool:
    env = os.environ.copy()
    env["DISCORD_WEBHOOK_URL"] = WEBHOOK_URL
    env["NOTIFY"]   = "discord"
    env["TOP_N"]    = "100"
    env["TOP_K"]    = "100"
    env["MARKET"]   = "tokyo"
    if not _is_jp_business_day(datetime.date.today()):
        env["FORCE_RUN"] = "1"

    result = subprocess.run(
        [sys.executable, "main.py"],
        cwd=str(MAIN_DIR),
        env=env,
    )
    return result.returncode == 0


def _run_themes() -> bool:
    try:
        import importlib
        sys.path.insert(0, str(MAIN_DIR))
        import themes_image  # type: ignore
        importlib.reload(themes_image)
        path, stock_date, _ = themes_image.get_themes_image()
        return _post_image(path, f"米テーマ動向 {stock_date}")
    except Exception as e:
        print(f"  [themes error] {e}")
        _post_message(f"⚠️ !themes エラー: {e}")
        return False


def _run_themes_all() -> bool:
    """4分類 + 1日ランク + 5日ランクの3枚をAPI 1回取得で送信。"""
    try:
        import importlib
        sys.path.insert(0, str(MAIN_DIR))
        import themes_image  # type: ignore
        importlib.reload(themes_image)
        p4c, p1d, p5d, stock_date, _ = themes_image.get_themes_all_images()
        ok1 = _post_image(p4c, f"米テーマ動向 {stock_date}")
        ok2 = _post_image(p1d, f"ランキング Top20（ソート: 1日）")
        ok3 = _post_image(p5d, f"ランキング Top20（ソート: 5日）")
        return ok1 and ok2 and ok3
    except Exception as e:
        print(f"  [themes_all error] {e}")
        _post_message(f"⚠️ !themes_all エラー: {e}")
        return False


def _run_themes_rank(period: str = "1d") -> bool:
    try:
        import importlib
        sys.path.insert(0, str(MAIN_DIR))
        import themes_image  # type: ignore
        importlib.reload(themes_image)
        path, stock_date, _ = themes_image.get_themes_rank_image(period)
        label = {"1d": "1日", "5d": "5日", "1m": "1ヶ月"}.get(period, period)
        return _post_image(path, f"米テーマ ランキング {stock_date}（ソート: {label}）")
    except Exception as e:
        print(f"  [themes_rank error] {e}")
        _post_message(f"⚠️ !themes_rank エラー: {e}")
        return False


def main() -> None:
    if not BOT_TOKEN:
        sys.exit("DISCORD_BOT_TOKEN が未設定")
    if not WEBHOOK_URL:
        sys.exit("DISCORD_WEBHOOK_URL が未設定")

    # 起動時点の最新IDを取得 → 既存メッセージに反応しない
    msgs = _get_messages(after=None)
    last_id: str | None = max((m["id"] for m in msgs), default=None) if msgs else None

    print(f"[discord_trigger] 起動 channel={CHANNEL_ID} コマンド: !daikin !themes !themes_all !themes_rank [5d|1m]  poll={POLL_SEC}s")

    while True:
        time.sleep(POLL_SEC)
        new_msgs = _get_messages(after=last_id)
        if not new_msgs:
            continue

        new_msgs.sort(key=lambda m: m["id"])   # 古い順
        last_id = new_msgs[-1]["id"]

        for msg in new_msgs:
            content = msg.get("content", "").strip()
            ts = datetime.datetime.now().strftime("%H:%M:%S")
            if content.lower() == "!daikin":
                print(f"[{ts}] !daikin 検出 → main.py 実行")
                ok = _run_main()
                print(f"  -> {'完了' if ok else 'エラー'}")
            elif content.lower() == "!themes_all":
                print(f"[{ts}] !themes_all 検出 → 3枚セット実行")
                ok = _run_themes_all()
                print(f"  -> {'完了' if ok else 'エラー'}")
            elif content.lower() == "!themes":
                print(f"[{ts}] !themes 検出 → テーマ分類実行")
                ok = _run_themes()
                print(f"  -> {'完了' if ok else 'エラー'}")
            elif content.lower().startswith("!themes_rank"):
                parts   = content.split()
                period  = parts[1].lower() if len(parts) > 1 else "1d"
                print(f"[{ts}] !themes_rank 検出 period={period} → ランキング実行")
                ok = _run_themes_rank(period)
                print(f"  -> {'完了' if ok else 'エラー'}")


if __name__ == "__main__":
    main()
