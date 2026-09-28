#!/bin/bash
# 新規アカウントの立ち上げ（雛形。自動化は今後実装）
# 使い方: scripts/new-account.sh <id>
set -euo pipefail
if [[ $# -ne 1 || ! "$1" =~ ^[a-z0-9][a-z0-9-]*$ ]]; then
  echo "Usage: $0 <id>   （id は英小文字・数字・ハイフン）" >&2
  exit 1
fi
ID="$1"
cat <<MSG
[未実装] $ID の立ち上げ手順:
  1. Drive に空スプシを作成し、clasp create --type sheets --parentId <sheet_id> で bound GAS を作る
  2. scripts/push-gas.sh で共通版 gas/ を push、clasp deploy で Web App を初回作成（以後は redeploy）
  3. ?bootstrap=1 でアクセスキーを発行し Keychain（ig-app-key-${ID}）へ保存
  4. ig-insights-accounts/accounts/$ID.env を作成（accounts/example.env を参照）
  5. 人の作業: スプシのメニューで FBアプリID／シークレット／短期トークン → 接続テスト → トリガーをインストール。Business Suite の business_id / asset_id を env へ
  6. scripts/deploy-web.sh / scripts/deploy-bsuite.sh --account-file <env>
MSG
