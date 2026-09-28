#!/bin/bash
# 既存の ig-insights 系 GAS（古い派生版を含む）に、静的Webアプリ用の口（gas/webapp.js・gas/webapp-addon.js）だけを後付けする
#   1. GAS_SCRIPT_ID を一時ディレクトリへ clasp pull（本番の現行コードが土台。他のファイルには触らない）
#   2. webapp.js / webapp-addon.js を上書きコピー、appsscript.json に webapp 設定、CONFIG_KEYS に APP_ACCESS_KEY / APP_STORY_DAYS を追記
#   3. 依存関数（findColumn_ / getConfig / setConfig / notifyDiscord）が無ければ中止
#   4. clasp push -f → Web App が無ければ初回 clasp deploy、有れば clasp redeploy。env の GAS_DEPLOY_ID を更新
#   5. --keychain-bootstrap: ?bootstrap=1 でアクセスキーを発行して Keychain（env の KEYCHAIN）へ保存（既存キーは上書きしない）
#   6. Keychain にキーがあれば ?action=installWarm で表示用キャッシュの30分トリガーを入れ（既にあれば作らない）、
#      format=json&build=1 で表示用キャッシュを1回同期構築（1〜2分。応答は 404 になり得るが裏で完了する）してから、
#      format=json を取得して件数を表示（キーは表示しない。準備中・404 の間は10秒おきに最大4分待ち、超えたら失敗）
# 使い方: scripts/install-webapp.sh --account-file <accounts/<id>.env> [--keychain-bootstrap]
set -euo pipefail
ACCOUNT_REQUIRED=(ID GAS_SCRIPT_ID)
. "$(dirname "$0")/_account.sh"
BOOTSTRAP=0
for a in ${EXTRA_ARGS[@]+"${EXTRA_ARGS[@]}"}; do
  case "$a" in
    --keychain-bootstrap) BOOTSTRAP=1 ;;
    *) echo "ERROR: 不明な引数: $a" >&2; exit 1 ;;
  esac
done
if [[ ! "$GAS_SCRIPT_ID" =~ ^[A-Za-z0-9_-]+$ ]]; then
  echo "ERROR: GAS_SCRIPT_ID に英数字と _- 以外が含まれます" >&2
  exit 1
fi
if [[ $BOOTSTRAP -eq 1 && -z "${KEYCHAIN:-}" ]]; then
  echo "ERROR: --keychain-bootstrap には $ACCOUNT_FILE の KEYCHAIN が必要です" >&2
  exit 1
fi

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
echo "{\"scriptId\":\"$GAS_SCRIPT_ID\"}" > "$TMP/.clasp.json"

# 1. 本番を pull
(cd "$TMP" && clasp pull >/dev/null)
[[ -f "$TMP/appsscript.json" ]] || { echo "ERROR: clasp pull で appsscript.json を取得できませんでした" >&2; exit 1; }
echo "pulled: $(cd "$TMP" && ls | tr '\n' ' ')"

# 2. 後付けファイルとマニフェスト・CONFIG_KEYS
cp "$REPO_ROOT/gas/webapp.js" "$REPO_ROOT/gas/webapp-addon.js" "$TMP/"
python3 - "$TMP" <<'PY'
import json, os, re, sys
d = sys.argv[1]
p = os.path.join(d, 'appsscript.json')
m = json.load(open(p, encoding='utf-8'))
if 'webapp' not in m:
    m['webapp'] = {'executeAs': 'USER_DEPLOYING', 'access': 'ANYONE_ANONYMOUS'}
    open(p, 'w', encoding='utf-8').write(json.dumps(m, ensure_ascii=False, indent=2) + '\n')
    print('appsscript.json: webapp を追加')
else:
    print('appsscript.json: webapp は既存のまま ' + json.dumps(m['webapp']))

p = os.path.join(d, 'config.js')
s = open(p, encoding='utf-8').read() if os.path.exists(p) else ''
mt = re.search(r'(const\s+CONFIG_KEYS\s*=\s*\[)([^\]]*)\]', s)
if not mt:
    print('WARN: config.js に CONFIG_KEYS 配列が見つからないため追記しません（getConfig は任意キーを読めるので動作には影響なし）')
    sys.exit(0)
body = mt.group(2)
add = [k for k in ('APP_ACCESS_KEY', 'APP_STORY_DAYS') if not re.search(r"['\"]" + k + r"['\"]", body)]
if not add:
    print('config.js: CONFIG_KEYS は追記不要')
    sys.exit(0)
stripped = body.rstrip()
indent = (re.search(r'\n([ \t]*)[\'"]', body) or [None, '  '])[1]
sep = '' if stripped.endswith(',') or stripped.endswith('[') or not stripped.strip() else ','
new_body = stripped + sep + ''.join('\n' + indent + "'" + k + "'" + (',' if i < len(add) - 1 else '') for i, k in enumerate(add)) + '\n'
s = s[:mt.start(2)] + new_body + s[mt.end(2):]
open(p, 'w', encoding='utf-8').write(s)
print('config.js: CONFIG_KEYS に ' + ', '.join(add) + ' を追記')
PY

# 3. 依存関数チェック
MISSING=()
for f in findColumn_ getConfig setConfig notifyDiscord; do
  grep -qE "function[[:space:]]+$f[[:space:]]*\(" "$TMP"/*.js || MISSING+=("$f")
done
if [[ ${#MISSING[@]} -gt 0 ]]; then
  echo "ERROR: 既存 GAS に必要な関数がありません: ${MISSING[*]}（push していません）" >&2
  exit 1
fi
echo "依存関数: findColumn_ getConfig setConfig notifyDiscord あり"

# 4. 更新するデプロイを決めてから push → deploy / redeploy
DEPLOYS=$(cd "$TMP" && clasp list-deployments)
CANDS=$(awk '/^- AKfy[A-Za-z0-9_-]+ / && $3 != "@HEAD" {print $2}' <<<"$DEPLOYS")
DEPLOY_ID=""
if [[ -n "${GAS_DEPLOY_ID:-}" ]] && grep -qxF "$GAS_DEPLOY_ID" <<<"$CANDS"; then
  DEPLOY_ID="$GAS_DEPLOY_ID"
elif [[ $(grep -c . <<<"$CANDS" || true) -eq 1 ]]; then
  DEPLOY_ID="$CANDS"
elif [[ -n "$CANDS" ]]; then
  echo "ERROR: Web App デプロイが複数あり、env の GAS_DEPLOY_ID と一致するものがありません。どれを更新するか env に書いてから再実行:" >&2
  echo "$CANDS" >&2
  exit 1
fi
(cd "$TMP" && clasp push -f)
if [[ -z "$DEPLOY_ID" ]]; then
  OUT=$(cd "$TMP" && clasp deploy -d "insights-app")
  echo "$OUT"
  DEPLOY_ID=$(grep -oE 'AKfy[A-Za-z0-9_-]+' <<<"$OUT" | head -1 || true)
  [[ -n "$DEPLOY_ID" ]] || { echo "ERROR: clasp deploy の出力からデプロイIDを読めませんでした" >&2; exit 1; }
else
  (cd "$TMP" && clasp redeploy "$DEPLOY_ID")
fi
if grep -q '^GAS_DEPLOY_ID=' "$ACCOUNT_FILE"; then
  sed -i '' "s|^GAS_DEPLOY_ID=.*|GAS_DEPLOY_ID=$DEPLOY_ID|" "$ACCOUNT_FILE"
else
  echo "GAS_DEPLOY_ID=$DEPLOY_ID" >> "$ACCOUNT_FILE"
fi
echo "GAS_DEPLOY_ID=$DEPLOY_ID を $ACCOUNT_FILE に記録"
EXEC="https://script.google.com/macros/s/$DEPLOY_ID/exec"

# 5. アクセスキー発行（既存キーは上書きしない）
if [[ $BOOTSTRAP -eq 1 ]]; then
  if security find-generic-password -s "$KEYCHAIN" >/dev/null 2>&1; then
    echo "ERROR: Keychain に $KEYCHAIN が既にあります（上書きしません）" >&2
    exit 2
  fi
  KEY=$(curl -sL "$EXEC?bootstrap=1")
  if [[ ! "$KEY" =~ ^[0-9a-f]{64}$ ]]; then
    if [[ "$KEY" == "already set" ]]; then
      echo "ERROR: GAS 側に APP_ACCESS_KEY が既にあります（already set）。上書きしません" >&2
    elif [[ "$KEY" == *"<"* ]]; then
      echo "ERROR: HTML が返りました（未承認で「アクセスが拒否されました」等）。スプシのメニューで Google の承認を済ませてから再実行" >&2
    else
      echo "ERROR: アクセスキーを発行できませんでした（応答 ${#KEY} 文字）" >&2
    fi
    unset KEY
    exit 2
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
fi

# 6. キャッシュ温めトリガー＋動作確認（キーは curl の設定を標準入力で渡し、画面・引数に出さない）
exec_get() { # $1=クエリ（k= 以外） $2=出力先 [$3=最大秒・既定60] → HTTP コード等を表示
  { printf 'url = "%s?%s&k=' "$EXEC" "$1"; security find-generic-password -s "$KEYCHAIN" -w | tr -d '\n'; printf '"\n'; } \
    | curl -sL -K - --max-time "${3:-60}" -o "$2" -w '%{http_code} / %{size_download} bytes / %{time_total}s' || true
}
if [[ -n "${KEYCHAIN:-}" ]] && security find-generic-password -s "$KEYCHAIN" >/dev/null 2>&1; then
  # トリガー作成には script.scriptapp スコープが要る（スコープ追加は手動の再承認が要るので自動では足さない）
  if python3 -c 'import json,sys; s=json.load(open(sys.argv[1])).get("oauthScopes"); sys.exit(0 if s is None or "https://www.googleapis.com/auth/script.scriptapp" in s else 1)' "$TMP/appsscript.json"; then
    for i in 1 2 3; do # redeploy 直後の1回目は HTML（404）が返ることがある
      exec_get "action=installWarm" "$TMP/warm.txt" >/dev/null
      W=$(head -c 80 "$TMP/warm.txt")
      echo "installWarm: $W"
      [[ "$W" == "installed" || "$W" == "already installed" ]] && break
    done
    if [[ "$W" != "installed" && "$W" != "already installed" ]]; then
      echo "ERROR: キャッシュ温めトリガーを作れませんでした（上の応答を確認）" >&2
      exit 1
    fi
  else
    echo "WARN: appsscript.json の oauthScopes に script.scriptapp が無いため installWarm を省略（GAS エディタでスコープを足して再承認後に再実行）" >&2
  fi
  DEADLINE=$((SECONDS + 240)); READY=0
  echo "build=1: HTTP $(exec_get "format=json&build=1" "$TMP/app.json")"
  while [[ $SECONDS -lt $DEADLINE ]]; do
    LEFT=$((DEADLINE - SECONDS)); (( LEFT > 60 )) && LEFT=60
    R=$(exec_get "format=json" "$TMP/app.json" "$LEFT")
    echo "format=json: HTTP $R"
    if [[ "$R" == 200* ]] && grep -q '"updatedAt"' "$TMP/app.json" && ! grep -q '"building":true' "$TMP/app.json"; then READY=1; break; fi
    LEFT=$((DEADLINE - SECONDS)); (( LEFT > 10 )) && LEFT=10; (( LEFT > 0 )) && sleep "$LEFT"
  done
  if [[ $READY -ne 1 ]]; then
    echo "ERROR: 4分待っても表示用データを取得できませんでした（最後の応答: $(head -c 60 "$TMP/app.json")）" >&2
    exit 1
  fi
  python3 - "$TMP/app.json" <<'PY'
import json, sys
try:
    d = json.load(open(sys.argv[1], encoding='utf-8'))
except Exception:
    sys.exit('ERROR: JSON ではない応答: ' + open(sys.argv[1], encoding='utf-8', errors='replace').read()[:120])
print('stories=%d reels=%d feeds=%d followers=%s updatedAt=%s' % (len(d.get('stories', [])), len(d.get('reels', [])), len(d.get('feeds', [])), d.get('followers'), d.get('updatedAt')))
PY
else
  echo "（Keychain ${KEYCHAIN:-未設定} にキーが無いので installWarm と format=json の確認は省略）"
fi
