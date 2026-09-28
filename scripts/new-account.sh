#!/bin/bash
# 新規アカウントの立ち上げ（人の作業＝Meta の秘密情報入力の手前まで自動）
#   1. 共通版 gas/ で新しいスプレッドシート＋bound GAS を作成（clasp create --type sheets）して push
#   2. Web App を初回デプロイ（clasp deploy。以後は clasp redeploy <GAS_DEPLOY_ID>）
#   3. <accounts-dir>/<id>.env を生成し、スプシ・GASエディタの URL と次にやることを表示
#   アクセスキーはここでは発行しない（新しい GAS は持ち主が Google の承認を済ませるまで Web App が「アクセスが拒否されました」を返す）。
#   人がスプシのメニューで承認を済ませた後に --bootstrap で ?bootstrap=1 を叩き、キーを Keychain ig-app-key-<id> へ保存する（画面に出さない）
# 使い方: scripts/new-account.sh --id <id> --title <表示名> --accounts-dir <ig-insights-accounts/accounts>
#                                [--business-id <id>] [--asset-id <id>] [--url-path </ig/<id>/>]
#         scripts/new-account.sh --bootstrap --account-file <accounts/<id>.env>
set -euo pipefail
usage() {
  echo "Usage: $0 --id <id> --title <表示名> --accounts-dir <path> [--business-id <id>] [--asset-id <id>] [--url-path </ig/<id>/>]" >&2
  echo "       $0 --bootstrap --account-file <accounts/<id>.env>" >&2
  exit 1
}

if [[ "${1:-}" == "--bootstrap" ]]; then
  shift
  ACCOUNT_REQUIRED=(ID GAS_DEPLOY_ID KEYCHAIN)
  . "$(dirname "$0")/_account.sh"
  [[ ${#EXTRA_ARGS[@]} -eq 0 ]] || usage
  if [[ ! "$GAS_DEPLOY_ID" =~ ^[A-Za-z0-9_-]+$ ]]; then
    echo "ERROR: GAS_DEPLOY_ID に英数字と _- 以外が含まれます" >&2
    exit 1
  fi
  if security find-generic-password -s "$KEYCHAIN" >/dev/null 2>&1; then
    echo "ERROR: Keychain に $KEYCHAIN が既にあります" >&2
    exit 1
  fi
  KEY=$(curl -sL "https://script.google.com/macros/s/$GAS_DEPLOY_ID/exec?bootstrap=1")
  if [[ ! "$KEY" =~ ^[0-9a-f]{64}$ ]]; then
    echo "ERROR: アクセスキーを発行できませんでした（応答 ${#KEY} 文字。already set＝11文字 / 未承認の「アクセスが拒否されました」など）" >&2
    exit 1
  fi
  # キーをコマンド引数に載せない（ps で見えないよう security -i の標準入力で渡す）
  if ! printf 'add-generic-password -a %s -s %s -w %s\n' "$USER" "$KEYCHAIN" "$KEY" | security -i >/dev/null \
     || ! security find-generic-password -s "$KEYCHAIN" >/dev/null 2>&1; then
    unset KEY
    echo "ERROR: Keychain $KEYCHAIN への保存に失敗しました（キーは GAS 側で発行済み。再発行は Script Properties の APP_ACCESS_KEY を消してから）" >&2
    exit 1
  fi
  unset KEY
  echo "アクセスキーを Keychain $KEYCHAIN に保存しました"
  exit 0
fi

ID="" TITLE="" ACCOUNTS_DIR="" BUSINESS_ID="" ASSET_ID="" URL_PATH=""
while [[ $# -gt 0 ]]; do
  [[ $# -ge 2 ]] || usage
  case "$1" in
    --id) ID="$2" ;;
    --title) TITLE="$2" ;;
    --accounts-dir) ACCOUNTS_DIR="$2" ;;
    --business-id) BUSINESS_ID="$2" ;;
    --asset-id) ASSET_ID="$2" ;;
    --url-path) URL_PATH="$2" ;;
    *) usage ;;
  esac
  shift 2
done
[[ -n "$ID" && -n "$TITLE" && -n "$ACCOUNTS_DIR" ]] || usage
if [[ ! "$ID" =~ ^[a-z0-9][a-z0-9-]*$ ]]; then
  echo "ERROR: id は英小文字・数字・ハイフンのみ: $ID" >&2
  exit 1
fi
if [[ "$TITLE" == *[\"\'\\\<\>\&\$\`]* || "$TITLE" == *[[:cntrl:]]* ]]; then
  echo "ERROR: --title に使えない文字（\" ' \\ < > & \$ \` 改行などの制御文字）があります" >&2
  exit 1
fi
URL_PATH="${URL_PATH:-/ig/$ID/}"
if [[ ! "$URL_PATH" =~ ^/[A-Za-z0-9/_-]*/$ ]]; then
  echo "ERROR: --url-path は /…/ の形（英数字・/_-）で指定してください: $URL_PATH" >&2
  exit 1
fi
for v in BUSINESS_ID ASSET_ID; do
  if [[ -n "${!v}" && ! "${!v}" =~ ^[0-9]+$ ]]; then
    echo "ERROR: $v は数字のみ: ${!v}" >&2
    exit 1
  fi
done
if [[ ! -d "$ACCOUNTS_DIR" ]]; then
  echo "ERROR: --accounts-dir がありません: $ACCOUNTS_DIR" >&2
  exit 1
fi
ENV_FILE="$(cd "$ACCOUNTS_DIR" && pwd)/$ID.env"
KEYCHAIN="ig-app-key-$ID"
if [[ -e "$ENV_FILE" ]]; then
  echo "ERROR: 既にあります: $ENV_FILE" >&2
  exit 1
fi
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

SCRIPT_ID="" SHEET_ID="" DEPLOY_ID=""
TMP=$(mktemp -d)
on_exit() {
  local rc=$?
  if [[ $rc -ne 0 ]]; then
    echo "ERROR: 途中で止まりました。作成済み: SHEET_ID=${SHEET_ID:-なし} GAS_SCRIPT_ID=${SCRIPT_ID:-なし} GAS_DEPLOY_ID=${DEPLOY_ID:-なし}" >&2
    if [[ -z "$SCRIPT_ID" && -f "$TMP/.clasp.json" ]]; then
      echo "clasp create で作成済み（.clasp.json）: $(cat "$TMP/.clasp.json")" >&2
    fi
  fi
  rm -rf "$TMP"
}
trap on_exit EXIT

# 1. スプシ＋bound GAS を作成（空ディレクトリで create し、生成された manifest を共通版で上書きしてから push）
(cd "$TMP" && clasp create --type sheets --title "${ID}_IG_insight" --rootDir .)
IDS=$(python3 - "$TMP/.clasp.json" <<'PY'
import json, sys
c = json.load(open(sys.argv[1]))
p = c.get('parentId')
p = p[0] if isinstance(p, list) else p
print(c['scriptId'], p or '')
PY
)
read -r SCRIPT_ID SHEET_ID <<<"$IDS"
if [[ ! "$SCRIPT_ID" =~ ^[A-Za-z0-9_-]+$ || ! "$SHEET_ID" =~ ^[A-Za-z0-9_-]+$ ]]; then
  echo "ERROR: .clasp.json から scriptId / parentId を読めませんでした" >&2
  exit 1
fi
rsync -a --exclude internal/ --exclude .clasp.json "$REPO_ROOT/gas/" "$TMP/"
(cd "$TMP" && clasp push -f)

# 2. Web App 初回デプロイ
DEPLOY_OUT=$(cd "$TMP" && clasp deploy -d "insights-app")
echo "$DEPLOY_OUT"
DEPLOY_ID=$(grep -oE 'AKfy[A-Za-z0-9_-]+' <<<"$DEPLOY_OUT" | head -1 || true)
if [[ -z "$DEPLOY_ID" ]]; then
  echo "ERROR: clasp deploy の出力からデプロイIDを読めませんでした" >&2
  exit 1
fi

# 3. accounts/<id>.env
cat > "$ENV_FILE" <<ENV
# $ID（Instagram）— 項目の説明は README.md。秘密値（アクセスキー等）は書かない
ID=$ID
TITLE="$TITLE"
GAS_SCRIPT_ID=$SCRIPT_ID
GAS_DEPLOY_ID=$DEPLOY_ID
SHEET_ID=$SHEET_ID
URL_PATH=$URL_PATH
BUSINESS_ID=$BUSINESS_ID
ASSET_ID=$ASSET_ID
KEYCHAIN=$KEYCHAIN
ENV

cat <<MSG

作成しました: $ENV_FILE
  スプシ:       https://docs.google.com/spreadsheets/d/$SHEET_ID/edit
  GASエディタ:  https://script.google.com/home/projects/$SCRIPT_ID/edit
  アクセスキー: 未発行（手順2で Keychain $KEYCHAIN へ）

次にやること:
  1.（人）スプシを開く → メニュー「📊 Instagram Insights」→「🔐 シークレット入力」（初回は Google の承認画面で「許可」）
         → FBアプリID／シークレット／短期トークン →「接続テスト」→「トリガーをインストール」
  2. scripts/new-account.sh --bootstrap --account-file $ENV_FILE
  3. manual/$ID/ を用意して scripts/deploy-web.sh --account-file $ENV_FILE
  4. BUSINESS_ID / ASSET_ID を入れて scripts/deploy-bsuite.sh --account-file $ENV_FILE
MSG
