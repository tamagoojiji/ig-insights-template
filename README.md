# IGインサイト保存テンプレート

Instagram の全投稿（フィード・リール・ストーリーズ）とインサイト数値を、自分のGoogleスプレッドシート＋Googleドライブに自動蓄積する仕組み。**Google Apps Script版（GitHub不要・追加サーバー不要・完全BYO型）**。

- 公開サイト: https://tamagoojiji.github.io/ig-insights-template/
- セットアップ手順書: https://tamagoojiji.github.io/ig-insights-template/setup-guide.html

## なぜ必要か

Instagramアカウントが凍結・BAN・誤削除された瞬間、過去のインサイト数値（リーチ・保存・シェア・視聴・閲覧率…）と画像はすべて消滅する。Meta公式UIには再エクスポート機能がない。**自分のスプシに永続保存しておけば、アカウントが消えてもデータベースは残る**。

## 構成

```
docs/      公開LP・手順書・OAuth callback（GitHub Pages公開）
gas/       Apps Scriptコード（マスタースプシのApps Scriptに反映）
internal/  内部用ドキュメント（法的整理・配布チェックリスト等）
templates/ スプシテンプレ仕様書
scripts/   Pages反映スクリプト等
```

## 動作の仕組み

1. 利用者がマスタースプシをコピー → 自分のGoogleドライブに作成（Apps Scriptもコピーされる）
2. スプシのカスタムメニュー「📊 Instagram Insights」から:
   - 初回セットアップ（Meta App ID/Secret・短期トークン・Gemini API Key・Discord Webhook を設定シートに貼付）
   - 接続テスト（短期→60日長期トークンへ自動交換・IG_USER_ID 自動取得・Drive画像保存フォルダ自動作成）
   - トリガーをインストール（30分ごとの自動取得 + 週次のトークン更新）
3. メニュー「📚 過去全件取り込み（API）」で過去のフィード・リールを全件遡取得
4. メニュー「📦 Meta公式zipアップロード」で過去のストーリーズも含めて完全復元（Metaの「データダウンロード」機能の正規エクスポート）
5. 30分ごとに新規投稿のインサイトを自動収集・スプシに追記・画像をDriveに保存
6. ダッシュボードシートで伸びた投稿・初速良好・曜日×時間帯ヒートマップを自動可視化

## 取得対象

| 種別 | 取得指標 |
|---|---|
| フィード | views / reach / saved / shares / total_interactions / like_count / comments_count |
| リール | 上記 + ig_reels_avg_watch_time |
| ストーリーズ | views / reach / replies / shares / total_interactions / navigation / profile_visits / follows |

すべて **自分の** ビジネス/クリエイターアカウントに対する Instagram Graph API（Meta公式）経由で取得。

## 法的方針（BYO型）

各利用者が以下を**自分で**用意・管理する設計のため、配布元（クリエイター）はトークンや認証情報を一切預からない:

- Meta Developer アプリ（自分のMetaアカウントで作成）
- Instagram Graph API アクセストークン（自分のScript Properties内に保管）
- Google アカウント・スプシ・Driveフォルダ
- Gemini API キー（OCR用・任意）
- Discord Webhook URL（通知用）

スクレイピングは行わず、Meta公式 Graph API のみを使用。詳細は `internal/legal-notes.md` を参照。

## ライセンス

Personal use only. 商用配布や転売はお問い合わせください。

© 2026 BridgeSquare / @tamago_app
