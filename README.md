# 売買代金 × 回転率 異常検出ツール

東証の売買代金上位銘柄から「時価総額の割に過剰に売買されている」異常銘柄を毎営業日の夜に自動検出し、Discordに通知する。

## 検出ロジック

- 売買代金上位50銘柄を母集団とする
- **回転率 = 売買代金 ÷ 時価総額** を計算し、降順ソート
- 前日比率で上昇(🔺)/下落(🔻)を色分け
- 回転率が高い = 時価総額に対して商いが集中している = テーマ化・材料・仕手の初動サイン

> 当初は log-log 回帰の残差方式を検討したが、母集団が「売買代金上位50」に
> 絞られている時点で代金の幅が狭く、残差は単に時価総額の大小を拾うだけに
> なるため不採用。回転率そのものが最も意図に合うことをプロトタイプで検証済み。

## ファイル構成

```
turnover-detector/
├── scraper.py        # Yahoo!ファイナンスのスクレイピング(ランキング+個別ページ)
├── detector.py       # 回転率による異常検出
├── notify.py         # Discord通知
├── main.py           # エントリポイント(祝日スキップ含む)
├── requirements.txt
└── .github/workflows/detector.yml   # 平日19:30 JST 自動実行
```

## セットアップ手順

### 1. リポジトリを用意
GitHubで新規プライベートリポジトリを作り、このフォルダ一式を push する。

```bash
git init
git add .
git commit -m "init turnover detector"
git remote add origin <your-repo-url>
git push -u origin main
```

### 3. 通知先を設定

#### Discordの場合
1. Discordの通知したいチャンネル → 設定 → 連携サービス → ウェブフック → 新規
2. Webhook URL をコピー
3. リポジトリ → Settings → Secrets and variables → Actions → New repository secret
   - Name: `DISCORD_WEBHOOK_URL` / Value: コピーしたURL
4. `detector.yml` の `NOTIFY` を `"discord"` にする(既定)

#### LINEの場合
※ LINE Notify はサービス終了(2025/3/31)のため Messaging API を使う。
1. [LINE Developers](https://developers.line.biz/) でプロバイダー作成
2. Messaging API チャネルを作成 → チャネルアクセストークン(長期)を発行
3. 自分のLINEでその公式アカウントを友だち追加
4. 送信先の user ID を取得(Webhookイベントの `source.userId` 等)
5. GitHub Secrets に2つ登録:
   - `LINE_CHANNEL_TOKEN` = チャネルアクセストークン
   - `LINE_USER_ID` = 送信先user ID
6. `detector.yml` の `NOTIFY` を `"line"` に変更

### 4. 動作確認(手動実行)
リポジトリ → Actions → 「turnover-detector」→ Run workflow
- `force_run` に `1` を入れると土日でも実行できる(テスト用)

数分後にDiscordへ通知が来れば成功。

## 自動実行のタイミング

`.github/workflows/detector.yml` の cron で制御。
- `30 10 * * 1-5` = JST 19:30、平日のみ
- 祝日・年末年始は `main.py` の `is_jp_business_day()` がスキップ

時刻を変えたい場合は cron の `分 時`(UTC) を編集。JST = UTC+9。
例: JST 20:00 にしたいなら `00 11 * * 1-5`。

## 調整できるパラメータ(detector.yml の env)

| 変数 | 既定 | 説明 |
|------|------|------|
| `TOP_N` | 50 | 母集団の銘柄数(売買代金上位何件を見るか) |
| `TOP_K` | 15 | 通知する上位件数 |
| `MARKET` | tokyo | 対象市場。`all`/`tokyo`/`nagoya`/`sapporo`/`fukuoka` |

`detector.py` 内のしきい値:
- `FLAT_BAND`(既定1.0) … 前日比率がこの%以内なら横ばい(▪️)扱い
- `MIN_TURNOVER_RATIO`(既定0.05) … 回転率5%未満は通知から除外

## 注意点

- **スクレイピング先のHTML構造**はYahooの改修で変わりうる。通知が来なくなったら
  `scraper.py` のパース部(`_parse_ranking_table` / `fetch_mktcap`)を要確認。
  まず `python main.py` をローカルで実行し、取得件数・時価総額取得数を見るとよい。
- アクセスは1日1回・約50リクエスト。`SLEEP_BETWEEN`(既定1秒)で間隔を空けている。
  相手サーバーへの配慮として短くしすぎないこと。
- ローカルで試すには:
  ```bash
  pip install -r requirements.txt
  FORCE_RUN=1 python main.py        # Discord未設定ならコンソールに出力
  ```

## ロジックを拡張したくなったら

- 回転率に加えて出来高急増倍率を併用 → `scraper.py` に出来高列を足す
- 上昇組/下落組を別メッセージに分けて通知 → `notify.py` を分岐
- 履歴を残したい → 結果をCSV追記 or Supabaseに保存(以前の図鑑アプリと同構成)
