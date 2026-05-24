#!/bin/bash
set -euo pipefail

# 新規クライアントを clients.yaml に対話的に追加
#
# 使い方: ./scripts/add-client.sh

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REGISTRY="$REPO_ROOT/clients.yaml"

if [[ ! -f "$REGISTRY" ]]; then
  echo "ERROR: $REGISTRY not found" >&2
  exit 1
fi

echo "=== 新規クライアント追加 ==="
read -rp "id (半角英数小文字、例: chiii): " ID
read -rp "name (表示名、例: chiii): " NAME
read -rp "script_id (空欄可、後で更新OK): " SCRIPT_ID
read -rp "sheet_id (空欄可、後で更新OK): " SHEET_ID
read -rp "role (役割の一言、例: punikoのIG Insights運用GAS): " ROLE
read -rp "notes (任意): " NOTES

EXISTS=$(yq ".clients[] | select(.id == \"$ID\") | .id" "$REGISTRY")
if [[ -n "$EXISTS" ]]; then
  echo "ERROR: id '$ID' already exists" >&2
  exit 1
fi

yq -i ".clients += [{
  \"id\": \"$ID\",
  \"name\": \"$NAME\",
  \"status\": \"active\",
  \"script_id\": \"$SCRIPT_ID\",
  \"sheet_id\": \"$SHEET_ID\",
  \"role\": \"$ROLE\",
  \"notes\": \"$NOTES\"
}]" "$REGISTRY"

echo ""
echo "追加しました:"
yq ".clients[] | select(.id == \"$ID\")" "$REGISTRY"
echo ""
echo "次のステップ:"
if [[ -z "$SCRIPT_ID" ]]; then
  echo "  1. GASプロジェクトを新規作成 → script_id を取得"
  echo "  2. clients.yaml の '$ID' の script_id を更新"
fi
echo "  - ./scripts/push-to.sh $ID でデプロイ可能"
