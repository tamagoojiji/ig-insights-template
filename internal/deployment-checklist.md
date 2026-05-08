# 配布前チェックリスト（クリエイター側・1回のみ実行）

利用者へ販売開始する前に、クリエイター（@tamago_app）が以下を完了させる。

## 1. マスタースプシ作成

- [ ] 新規Googleスプシを作成（名前: `IGインサイト保存テンプレート（マスター）`）
- [ ] 拡張機能 → Apps Script でバインドスクリプト初期化
- [ ] `gas/.clasp.json` を新規作成し scriptId を記入（gitignore対象）
- [ ] `clasp push --force` で `gas/` 配下を全反映
- [ ] スプシを開いて「📊 Instagram Insights」メニューが表示されることを確認
- [ ] 「🔧 初回セットアップ（シート作成）」を実行 → 全シート生成
- [ ] テスター用Meta App + サブIGアカウントで end-to-end テスト
  - [ ] 設定シートに値貼付 → 「💾 設定保存」
  - [ ] 「🔗 接続テスト」で長期トークン化＆ USER_ID 自動取得を確認
  - [ ] 「📁 Drive画像保存フォルダを準備」でフォルダ自動作成確認
  - [ ] 「📸 フィード+リールのみ取得」でシート書込み確認
  - [ ] 「📖 ストーリーズのみ取得」で書込み確認
  - [ ] 「📚 過去全件取り込み（API）」で過去分取得確認
  - [ ] テスト用Meta zipを「📦 Meta公式zipアップロード」で取り込み確認
  - [ ] 「⏰ トリガーをインストール」で30分ごと/週次トリガー設置確認

## 2. テスト用シートをクリーンアップ

- [ ] 全行クリア（ヘッダー以外）
- [ ] Script Properties から全テスト用値を削除
- [ ] トリガーを全削除

## 3. マスタースプシ公開化

- [ ] Apps Scriptエディタで `makeMasterSheetPublic()` を実行
- [ ] 表示された /copy URL をブラウザで開いてコピーが成功することを確認

## 4. GitHub リポジトリ作成

- [ ] `gh repo create tamagoojiji/ig-insights-template --public --source ~/ig-insights-template --push`
- [ ] GitHub Pages を `docs/` フォルダで有効化
- [ ] `https://tamagoojiji.github.io/ig-insights-template/` で LP 表示確認
- [ ] auth-gate.js の Discord ログインフローが動くか確認（threads-schedulerのDiscordサーバ「購入者」ロールで通る前提）

## 5. 認証バックエンド連携確認

- [ ] threadsschedule-auth (VPS) の `/auth/discord` で `audience=ig-insights-template` が通るか確認
- [ ] 必要ならVPS側を更新（許可audience一覧に追加）
- [ ] forbidden.html へのリダイレクト動作確認

## 6. note・販売ページ作成

- [ ] note 記事ドラフト作成（threads-scheduler同様の構成）
- [ ] /copy URL を note の有料部に記載
- [ ] Discord勉強会の日程をスケジュール
- [ ] 先着20名キャンペーン枠の管理シート作成

## 7. リリース告知

- [ ] @tamago_app で Threads / X / Instagram で告知
- [ ] BridgeSquare LP に商品追加
- [ ] 既存 threads-scheduler 購入者に Discord で先行告知

## 注意事項

- マスタースプシのApps Scriptに**実トークン・実APIキーを残さない**こと（Script Propertiesも空のまま配布）
- スクショ撮影は別アカウントで実施（個人特定情報を含めない）
