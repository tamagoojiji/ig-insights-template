# 運営向け：過去ストーリーズ取り込み代行 セットアップ

過去ストーリーズ取り込み代行スクリプト（`scripts/admin-import-stories.py`）を動かすために、運営の個人Googleアカウントで認証する設定。**運営側で初回1回だけ実施**する。

## 方針

サービスアカウント方式はやめて、運営の個人Googleアカウント（例: `tamagoojiji@gmail.com`）の認証を使う。

- 利用者は運営の個人アカウントにスプシ・Driveを「編集者」共有
- スクリプトは ADC（Application Default Credentials）で運営アカウントの権限を借りる
- GCPプロジェクト作成・APIライブラリ有効化・サービスアカウント・鍵JSON、全部不要

利用者のスプシは継続的に運用するので、運営側がアクセス権を持ち続ける前提（変更・修正・トラブル対応のため）。

## ⚠️ 本格運用前に必須：自前OAuthクライアントID作成

2026年5月時点で、`gcloud auth application-default login` のデフォルトクライアントIDから
`drive` / `spreadsheets` スコープへのアクセスが警告→今後ブロック予定。

実際にスクリプトを動かすには **自前のOAuthクライアントID** が必要：

1. GCPプロジェクト（例: `ig-insights-personal` または新規）を選択
2. APIs & Services → OAuth同意画面を構成（外部 / 自分のGmailをテストユーザーに追加）
3. APIs & Services → 認証情報 → 「OAuthクライアントIDを作成」→ アプリケーションの種類「**デスクトップアプリ**」
4. JSON をDL → `~/admin/oauth-client.json` 等に保存
5. Step 3 のコマンドに `--client-id-file=~/admin/oauth-client.json` を追加

参考: https://docs.cloud.google.com/docs/authentication/troubleshoot-adc#access_blocked_when_using_scopes

このセットアップは **最初のお客さんが来たタイミング** で実施でOK。タマゴさん自身の過去ストーリーズは
既存の GAS「📦 Meta公式zipアップロード」フロー（`scripts/process-ig-zip.py` で前処理）で取り込める。

---

## 所要時間：5分（OAuthクライアントID作成済み前提）

## Step 1：gcloud CLIをインストール

```bash
brew install --cask google-cloud-sdk
```

すでに入っていればスキップ。確認：

```bash
gcloud --version
```

## Step 2：Pythonクライアントライブラリのインストール

```bash
pip3 install google-api-python-client google-auth google-auth-httplib2
```

## Step 3：ADCで個人アカウント認証（初回1回）

```bash
gcloud auth application-default login \
  --client-id-file=~/admin/oauth-client.json \
  --scopes=https://www.googleapis.com/auth/spreadsheets,https://www.googleapis.com/auth/drive,https://www.googleapis.com/auth/cloud-platform
```

ブラウザが開く → 運営のGoogleアカウント（例: `tamagoojiji@gmail.com`）でログイン → 権限を許可。

完了すると `~/.config/gcloud/application_default_credentials.json` に保存される。

## Step 4：動作テスト

```bash
python3 -c "
import google.auth
from googleapiclient.discovery import build
creds, _ = google.auth.default(scopes=[
    'https://www.googleapis.com/auth/spreadsheets',
    'https://www.googleapis.com/auth/drive',
])
sheets = build('sheets', 'v4', credentials=creds, cache_discovery=False)
print('OK')
"
```

`OK` と出れば成功。

## 利用者への案内テンプレ（Discord）

```
過去ストーリーズ取り込み代行のため、以下の準備をお願いします:

1. スプシ(ig-insights-template)を開く → 右上「共有」
2. 以下のメアドを入力 → 「編集者」権限 → 「通知を送信しない」をチェック → 送信
   tamagoojiji@gmail.com

3. Drive上の画像保存フォルダにも同じメアドを「編集者」で共有
4. 完了したら、ギガファイル便URL+パスワード+スプシURL+DriveフォルダURLを送ってください
```

## 注意事項

- 運営の個人Googleアカウントが利用者のスプシ・Driveに編集者としてアクセスし続ける運用
- 個人アカウントの2段階認証は必須
- ADCトークンの保存先（`~/.config/gcloud/application_default_credentials.json`）は外部に漏らさない
- 認証をやり直したい場合：`gcloud auth application-default revoke` → Step 3を再実行
