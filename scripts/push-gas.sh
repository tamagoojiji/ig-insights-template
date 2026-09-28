#!/bin/bash
# 共通版 gas/ を1アカウントの GAS へ push する（accounts/<id>.env の GAS_SCRIPT_ID から一時 .clasp.json を作る）
#   push 前に本番（エディタ）を clasp pull し、最後に commit した gas/（git HEAD）と比較して差分があれば中止する
#   （本番＝HEAD なら、エディタ直編集は無い。作業ツリーの未 commit の編集を push する）
#   --check: 差分確認だけして push しない
#   push 後の本番反映は別途 `clasp redeploy <GAS_DEPLOY_ID>`（新規 deploy は使わない）
# 使い方: scripts/push-gas.sh --account-file <accounts/<id>.env> [--check]
set -euo pipefail
ACCOUNT_REQUIRED=(ID GAS_SCRIPT_ID)
. "$(dirname "$0")/_account.sh"
CHECK=0
for a in ${EXTRA_ARGS[@]+"${EXTRA_ARGS[@]}"}; do
  case "$a" in
    --check) CHECK=1 ;;
    *) echo "ERROR: 不明な引数: $a" >&2; exit 1 ;;
  esac
done

if [[ ! "$GAS_SCRIPT_ID" =~ ^[A-Za-z0-9_-]+$ ]]; then
  echo "ERROR: GAS_SCRIPT_ID に英数字と _- 以外が含まれます" >&2
  exit 1
fi

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
CLASP_JSON="{\"scriptId\":\"$GAS_SCRIPT_ID\",\"rootDir\":\".\"}"

mkdir "$TMP/remote" "$TMP/head" "$TMP/local"
echo "$CLASP_JSON" > "$TMP/remote/.clasp.json"
(cd "$TMP/remote" && clasp pull >/dev/null)
git -C "$REPO_ROOT" archive HEAD gas | tar -x -C "$TMP/head"
rm -rf "$TMP/head/gas/internal"
if ! diff -r -q --exclude .clasp.json "$TMP/remote" "$TMP/head/gas"; then
  echo "ERROR: 本番（${ID}）と commit 済みの gas/ に差分があります。エディタ直編集の可能性があるので push を中止しました" >&2
  exit 1
fi
echo "本番（${ID}）と commit 済みの gas/ は一致"
rsync -a --exclude internal/ --exclude .clasp.json "$REPO_ROOT/gas/" "$TMP/local/"
[[ $CHECK -eq 1 ]] && exit 0

echo "$CLASP_JSON" > "$TMP/local/.clasp.json"
(cd "$TMP/local" && clasp push --force)
echo "pushed: ${ID}（本番反映は clasp redeploy ${GAS_DEPLOY_ID:-<GAS_DEPLOY_ID>}）"
