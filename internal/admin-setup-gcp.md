# 運営向け：GCPプロジェクト＆サービスアカウント セットアップ

過去ストーリーズ取り込み代行スクリプト（`scripts/admin-import-stories.py`）を動かすために必要な Google Cloud の初期設定。**運営側で初回1回だけ実施**する。

## ゴール

- GCP プロジェクト作成
- Google Sheets API / Google Drive API を有効化
- サービスアカウント（プログラム用Googleアカウント）を作成
- 鍵JSONをローカルに保存して認証可能にする

## 所要時間：10〜15分

## Step 1：GCPプロジェクト作成

1. https://console.cloud.google.com/ にアクセス（運営Googleアカウントでログイン）
2. 上部のプロジェクト選択メニュー → 「**新しいプロジェクト**」
3. プロジェクト名：`ig-insights-admin`（好きな名前でOK）
4. 「作成」をクリック → 数十秒待つ
5. 作成完了したら、上部メニューでそのプロジェクトを選択

## Step 2：APIを2つ有効化

1. 左メニュー → 「**APIとサービス**」→「ライブラリ」
2. 検索ボックスに「**Google Sheets API**」と入力 → 表示された結果をクリック → 「**有効にする**」
3. もう一度ライブラリに戻り、「**Google Drive API**」を検索 → 「有効にする」

## Step 3：サービスアカウント作成

1. 左メニュー →「**IAMと管理**」→「**サービスアカウント**」
2. 上部「**+ サービスアカウントを作成**」
3. 名前：`ig-insights-bot`（好きな名前でOK）
4. 「作成して続行」→ 役割は何も付与せず「続行」→「完了」
5. 一覧に追加されたサービスアカウントのメアド（例：`ig-insights-bot@ig-insights-admin.iam.gserviceaccount.com`）を**コピーしてメモ**
   - これを利用者にDiscordで伝える

## Step 4：鍵JSONを作成・DL

1. 一覧でサービスアカウント名（`ig-insights-bot@...`）をクリック
2. 上部タブ「**鍵**」→「**鍵を追加**」→「**新しい鍵を作成**」
3. 「**JSON**」を選択 → 「作成」
4. JSONファイルが自動でダウンロードされる
5. ローカルの安全な場所に保存：
   ```bash
   mkdir -p ~/admin
   mv ~/Downloads/ig-insights-admin-*.json ~/admin/ig-insights-sa.json
   chmod 600 ~/admin/ig-insights-sa.json
   ```

## Step 5：.gitignore に追加（必須）

リポジトリ直下の `.gitignore` に以下を追記：

```
# Service account keys (NEVER commit)
*-sa.json
service-account-*.json
admin/
```

リポジトリ内に鍵を置く運用なら絶対に必要。今回は `~/admin/` に置いたので影響なしだが、念のため追加しておく。

## Step 6：Pythonクライアントライブラリのインストール

```bash
pip3 install google-api-python-client google-auth-httplib2 google-auth-oauthlib
```

または `requirements.txt` に追加しておく：

```
google-api-python-client>=2.0.0
google-auth-httplib2>=0.1.0
google-auth-oauthlib>=1.0.0
```

## Step 7：動作テスト

```bash
python3 -c "
from google.oauth2 import service_account
from googleapiclient.discovery import build
creds = service_account.Credentials.from_service_account_file(
    '$HOME/admin/ig-insights-sa.json',
    scopes=['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive']
)
print('OK:', creds.service_account_email)
"
```

`OK: ig-insights-bot@...` と出れば成功。

## 利用者への案内テンプレ（Discord）

```
過去ストーリーズ取り込み代行のため、以下の準備をお願いします:

1. スプシ(ig-insights-template)を開く → 右上「共有」
2. 以下のメアドを入力 → 「編集者」権限 → 「通知を送信しない」をチェック → 送信
   ig-insights-bot@ig-insights-admin.iam.gserviceaccount.com

3. Drive上の画像保存フォルダにも同じメアドを「編集者」で共有
4. 完了したら、ギガファイル便URL+パスワード+スプシURL+DriveフォルダURLを送ってください
```

## 注意事項

- 鍵JSONは**運営しか持たない**。GitHubにpushしない・Slack等に貼らない
- 利用者には**メアドだけ**を伝える（鍵は絶対渡さない）
- サービスアカウントは「利用者のスプシ／Driveに編集者として招待される」という発想
- サービスアカウントの上限：1プロジェクトあたり100個まで（運営1個で全利用者をカバーできるので問題なし）
