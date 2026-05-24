#!/bin/bash
set -euo pipefail

# 単一クライアントの GAS に clasp push する
#
# 使い方: ./scripts/push-to.sh <client_id>
# 例:    ./scripts/push-to.sh chiii

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <client_id>" >&2
  echo "" >&2
  echo "Available clients:" >&2
  yq '.clients[] | "  - " + .id + " (" + .status + ")"' "$(dirname "$0")/../clients.yaml" >&2
  exit 1
fi

CLIENT_ID="$1"
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REGISTRY="$REPO_ROOT/clients.yaml"

if [[ ! -f "$REGISTRY" ]]; then
  echo "ERROR: $REGISTRY not found" >&2
  exit 1
fi

SCRIPT_ID=$(yq ".clients[] | select(.id == \"$CLIENT_ID\") | .script_id" "$REGISTRY")
STATUS=$(yq ".clients[] | select(.id == \"$CLIENT_ID\") | .status" "$REGISTRY")
NAME=$(yq ".clients[] | select(.id == \"$CLIENT_ID\") | .name" "$REGISTRY")

if [[ -z "$SCRIPT_ID" || "$SCRIPT_ID" == "null" ]]; then
  echo "ERROR: client '$CLIENT_ID' not found in $REGISTRY" >&2
  exit 1
fi

if [[ -z "$SCRIPT_ID" || "$SCRIPT_ID" == '""' ]]; then
  echo "ERROR: script_id is empty for '$CLIENT_ID'. Update clients.yaml first." >&2
  exit 1
fi

if [[ "$STATUS" != "active" ]]; then
  echo "WARNING: '$CLIENT_ID' status is '$STATUS' (not active). Continue? [y/N]"
  read -r ANSWER
  if [[ "$ANSWER" != "y" && "$ANSWER" != "Y" ]]; then
    echo "Aborted."
    exit 0
  fi
fi

CLASP_JSON="$REPO_ROOT/gas/.clasp.json"
echo "{\"scriptId\":\"$SCRIPT_ID\",\"rootDir\":\".\"}" > "$CLASP_JSON"

echo "=== push to $NAME ($CLIENT_ID) ==="
echo "scriptId: $SCRIPT_ID"
cd "$REPO_ROOT/gas"
clasp push --force
echo "=== done: $CLIENT_ID ==="
