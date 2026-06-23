# CLAUDE.md — turnover-detector

このファイルはClaude Code起動時に自動で読み込まれる。
ここに書かれた**運用ルール**は全作業で常に優先される。
※ プロジェクト固有の設計判断（計算式・UI仕様等）はここに書かない。
それらは docs/decision-log.md と docs/architecture.md を参照する。

## プロジェクト概要

日本株の回転率分析・人気株探索ツール。

- backend: Python（J-Quants API V2）
- frontend: Next.js / Vercel
- 設計判断はユーザー（Claude App側）、実装はClaude Code。

## 役割分担

- Claude App = 設計・意思決定・アーキテクト
- Claude Code = 実装担当
- GitHub操作 = ユーザーが手動で行う

## 絶対ルール（違反禁止）

1. **無指示のgit操作を実行しない**。commit/push/branch/merge等は
   ユーザーが明示的に指示した時のみ。自律的なgit操作は禁止。
1. **指定されていないファイルを変更しない**。
1. **推測で実装しない**。不明点は実装前に確認する。

## 作業原則

- 実装前に対象ファイルを調査する。
- 不明点は推測で実装せず確認する。
- 指定されていないファイルは変更しない。
- 大規模変更は実装前に計画を提示する。
- バグ修正時は原因特定を優先し、場当たり修正を避ける。
- 長文プロンプトは文字数制限のため .txt ファイルで受け取る。

## 参照ドキュメント

- docs/state.md … 現在地と次の一手（存在する場合は実装前に確認）
- docs/decision-log.md … 過去の設計判断と理由（計算式・UI仕様等はここ）
- docs/architecture.md … 設計の不変ルール（あれば）

## commit / push ルール

以下の条件を**全て満たした場合のみ** commit/push を実行してよい。

### 条件
1. 指定されたファイルのみ変更していること
   （git status で指定外ファイルが staged に含まれていないこと）
2. 以下が全て成功していること
   - npm run lint
   - npm run typecheck（または tsc --noEmit）
   - npm run build
3. 変更内容の要約を出力していること
   - 変更/新規ファイル一覧
   - 何をどう変えたか（3行以内）
   - git status の全文
4. 上記3点をりゅに提示し、「pushしてよいですか？」と確認を取ること
   りゅの「OK」「いいよ」「go」等の承認があった場合のみ push する

### 禁止
- git add -A（ファイルは必ず明示的に1つずつ指定すること）
- 承認なしの push
- DISCORD_BOT_TOKEN / JQUANTS_API_KEY をコンソール出力すること（[redacted] 形式を使うこと）
