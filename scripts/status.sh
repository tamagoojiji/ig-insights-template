#!/bin/bash
set -euo pipefail

# 全クライアントの状態一覧を表示
#
# 使い方: ./scripts/status.sh

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REGISTRY="$REPO_ROOT/clients.yaml"

if [[ ! -f "$REGISTRY" ]]; then
  echo "ERROR: $REGISTRY not found" >&2
  exit 1
fi

printf "%-12s %-12s %-50s %s\n" "ID" "STATUS" "SCRIPT_ID" "NOTES"
printf "%-12s %-12s %-50s %s\n" "----" "------" "---------" "-----"

yq -o=json '.clients' "$REGISTRY" | jq -r '.[] | [
  .id,
  .status,
  (.script_id // ""),
  (if (.script_id // "") == "" then "(script_id 未設定)" elif (.sheet_id // "") == "" then "(sheet_id 未設定)" else (.notes // "") end)
] | @tsv' | while IFS=$'\t' read -r ID STATUS SCRIPT_ID NOTE; do
  if [[ -n "$SCRIPT_ID" && ${#SCRIPT_ID} -gt 46 ]]; then
    SCRIPT_ID="${SCRIPT_ID:0:43}..."
  fi
  printf "%-12s %-12s %-50s %s\n" "$ID" "$STATUS" "${SCRIPT_ID:-(未設定)}" "$NOTE"
done
