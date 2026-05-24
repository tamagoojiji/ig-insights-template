#!/bin/bash
set -euo pipefail

# 全 active クライアントの GAS に clasp push する
#
# 使い方: ./scripts/push-all.sh
# script_id が空のクライアントはスキップして警告表示。

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REGISTRY="$REPO_ROOT/clients.yaml"

if [[ ! -f "$REGISTRY" ]]; then
  echo "ERROR: $REGISTRY not found" >&2
  exit 1
fi

ACTIVE_IDS=$(yq '.clients[] | select(.status == "active") | .id' "$REGISTRY")

if [[ -z "$ACTIVE_IDS" ]]; then
  echo "No active clients found." >&2
  exit 0
fi

FAILED=()
SKIPPED=()

while IFS= read -r CLIENT_ID; do
  SCRIPT_ID=$(yq ".clients[] | select(.id == \"$CLIENT_ID\") | .script_id" "$REGISTRY")
  if [[ -z "$SCRIPT_ID" || "$SCRIPT_ID" == "null" || "$SCRIPT_ID" == '""' ]]; then
    echo "[SKIP] $CLIENT_ID: script_id is empty"
    SKIPPED+=("$CLIENT_ID")
    continue
  fi

  if "$REPO_ROOT/scripts/push-to.sh" "$CLIENT_ID"; then
    :
  else
    echo "[FAIL] $CLIENT_ID"
    FAILED+=("$CLIENT_ID")
  fi
done <<< "$ACTIVE_IDS"

echo ""
echo "=== summary ==="
echo "succeeded: $(echo "$ACTIVE_IDS" | wc -l | tr -d ' ') - ${#SKIPPED[@]} skipped - ${#FAILED[@]} failed"
if [[ ${#SKIPPED[@]} -gt 0 ]]; then
  echo "skipped: ${SKIPPED[*]}"
fi
if [[ ${#FAILED[@]} -gt 0 ]]; then
  echo "failed: ${FAILED[*]}"
  exit 1
fi
