#!/bin/bash
# Business Suite 巡回コンテナを1アカウント分配置・起動する
#   VPS /opt/docker/ig-bsuite-<id>/ にコードと .env（アクセスキーは Mac Keychain から注入）を置き、
#   storage_state.json は --state <path> を送るか、無ければ既存の巡回コンテナのものをコピー（FB ログインは共有）、
#   /opt/docker/docker-compose.yml にサービス ig-bsuite-<id> を追記（あれば更新・事前にバックアップ）して起動する
# 使い方: scripts/deploy-bsuite.sh --account-file <accounts/<id>.env> [--state <storage_state.json>]
set -euo pipefail
ACCOUNT_REQUIRED=(ID GAS_DEPLOY_ID BUSINESS_ID ASSET_ID KEYCHAIN)
. "$(dirname "$0")/_account.sh"

STATE_SRC=""
set -- ${EXTRA_ARGS[@]+"${EXTRA_ARGS[@]}"}
while [[ $# -gt 0 ]]; do
  case "$1" in
    --state) STATE_SRC="${2:-}"; shift 2 ;;
    *) echo "ERROR: 不明な引数: $1" >&2; exit 1 ;;
  esac
done
if [[ -n "$STATE_SRC" && ! -f "$STATE_SRC" ]]; then
  echo "ERROR: --state のファイルがありません: $STATE_SRC" >&2
  exit 1
fi

SVC="ig-bsuite-$ID"
DIR="/opt/docker/$SVC"
KEY=$(security find-generic-password -s "$KEYCHAIN" -w)
# .env に生のまま書くので、引用・エスケープ不要な文字だけを許す（値は表示しない）
if [[ ! "$KEY" =~ ^[A-Za-z0-9._~-]+$ ]]; then
  echo "ERROR: Keychain $KEYCHAIN の値が空か、英数字と ._~- 以外を含みます" >&2
  exit 1
fi
for _v in GAS_DEPLOY_ID BUSINESS_ID ASSET_ID; do
  if [[ ! "${!_v}" =~ ^[A-Za-z0-9_-]+$ ]]; then
    echo "ERROR: $_v に英数字と _- 以外が含まれます" >&2
    exit 1
  fi
done

cd "$REPO_ROOT/bsuite"
ssh vps "mkdir -p '$DIR/state' '$DIR/logs'"
scp -q Dockerfile crontab requirements.txt ./*.py "vps:$DIR/"

# .env は標準入力で送る（キーをコマンドライン・ディスクに出さない）
printf 'GAS_EXEC_URL=https://script.google.com/macros/s/%s/exec\nAPP_ACCESS_KEY=%s\nACCOUNT=%s\nBUSINESS_ID=%s\nASSET_ID=%s\nSTATE_DIR=/app/state\n' \
  "$GAS_DEPLOY_ID" "$KEY" "$ID" "$BUSINESS_ID" "$ASSET_ID" | ssh vps "umask 077 && cat > '$DIR/.env'"
unset KEY

if [[ -n "$STATE_SRC" ]]; then
  scp -q "$STATE_SRC" "vps:$DIR/state/storage_state.json"
else
  ssh vps "set -e; T='$DIR/state/storage_state.json'
    if [ ! -f \"\$T\" ]; then
      SRC=\$(ls /opt/docker/ig-bsuite-*/state/storage_state.json 2>/dev/null | grep -v '^$DIR/' | head -1 || true)
      [ -n \"\$SRC\" ] || { echo 'ERROR: コピー元の storage_state.json がありません（--state で指定）' >&2; exit 1; }
      cp \"\$SRC\" \"\$T\"; echo \"storage_state: \$SRC からコピー\"
    fi"
fi
ssh vps "chmod 600 '$DIR/state/storage_state.json' '$DIR/.env'"

# compose へサービスを追記／更新（バックアップ → 編集 → config 検証。失敗なら戻す）
ssh vps "SVC='$SVC' python3 -" <<'PY'
import os, re, shutil, subprocess, sys, time
svc = os.environ['SVC']
path = '/opt/docker/docker-compose.yml'
src = open(path, encoding='utf-8').read()
block = f'''  {svc}:
    build: ./{svc}
    container_name: {svc}
    restart: unless-stopped
    env_file:
      - ./{svc}/.env
    volumes:
      - ./{svc}/.env:/app/.env:ro
      - ./{svc}/state:/app/state
      - ./{svc}/logs:/var/log
    environment:
      TZ: Asia/Tokyo
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "3"
'''
m = re.search(rf'^  {re.escape(svc)}:\n(?:(?:    .*|[ \t]*)\n)*', src, re.M)
if m:
    body = m.group(0).rstrip('\n') + '\n'
    if body == block:
        print(f'compose: {svc} は変更なし'); sys.exit(0)
    new = src[:m.start()] + block + '\n' + src[m.end():].lstrip('\n')
else:
    v = re.search(r'^volumes:', src, re.M)
    if v:
        new = src[:v.start()] + block + '\n' + src[v.start():]
    else:
        new = src.rstrip('\n') + '\n\n' + block
bak = f'{path}.bak-{svc}-{time.strftime("%Y%m%d-%H%M%S")}'
shutil.copy2(path, bak)
open(path, 'w', encoding='utf-8').write(new)
r = subprocess.run(['docker', 'compose', 'config', '-q'], cwd='/opt/docker', capture_output=True, text=True)
if r.returncode != 0:
    shutil.copy2(bak, path)
    sys.exit('compose: 検証失敗のため元に戻しました: ' + r.stderr[-500:])
print(f'compose: {svc} を{"更新" if m else "追記"}（バックアップ {bak}）')
PY

ssh vps "cd /opt/docker && docker compose up -d --build '$SVC'"
ssh vps "docker ps --filter name='^$SVC\$' --format '{{.Names}} {{.Status}}'"
