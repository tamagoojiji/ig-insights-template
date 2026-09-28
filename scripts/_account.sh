# 共通: --account-file <path> を解析して accounts/<id>.env を読み込む（source して使う）
# 呼び出し側で ACCOUNT_REQUIRED=(ID ...) を定義しておくと、未設定の項目でエラーにする
ACCOUNT_FILE=""
EXTRA_ARGS=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --account-file) ACCOUNT_FILE="${2:-}"; shift 2 ;;
    *) EXTRA_ARGS+=("$1"); shift ;;
  esac
done
if [[ -z "$ACCOUNT_FILE" || ! -f "$ACCOUNT_FILE" ]]; then
  echo "ERROR: --account-file <ig-insights-accounts/accounts/<id>.env> を指定してください" >&2
  exit 1
fi
ACCOUNT_FILE="$(cd "$(dirname "$ACCOUNT_FILE")" && pwd)/$(basename "$ACCOUNT_FILE")"
set -a
# shellcheck disable=SC1090
. "$ACCOUNT_FILE"
set +a
for _v in "${ACCOUNT_REQUIRED[@]}"; do
  if [[ -z "${!_v:-}" ]]; then
    echo "ERROR: $ACCOUNT_FILE に $_v がありません" >&2
    exit 1
  fi
done
if [[ ! "$ID" =~ ^[a-z0-9][a-z0-9-]*$ ]]; then
  echo "ERROR: ID は英小文字・数字・ハイフンのみ: $ID" >&2
  exit 1
fi
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
