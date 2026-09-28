#!/bin/bash
# スマホ用Webアプリを1アカウント分配信する
#   web/ のプレースホルダ（__ACCOUNT__ / __TITLE__ / __GAS_ID__）を accounts/<id>.env の値で置換し、
#   取説（<accounts repo>/manual/<id>/取扱説明書（図解）.html）に「アプリに戻る」バーを足して manual.html にし、
#   VPS /opt/docker/ig-app/<id>/（nginx の /ig/<id>/）へ送って nginx をリロードする
# 使い方: scripts/deploy-web.sh --account-file ~/dev/sns/ig-insights-accounts/accounts/<id>.env
set -euo pipefail
ACCOUNT_REQUIRED=(ID TITLE GAS_DEPLOY_ID URL_PATH)
. "$(dirname "$0")/_account.sh"

# HTML・JS文字列・JSON にそのまま埋め込むので、エスケープが要る文字は受け付けない
if [[ "$TITLE" == *[\"\'\\\<\>\&]* || "$TITLE" == *[[:cntrl:]]* ]]; then
  echo "ERROR: TITLE に使えない文字（\" ' \\ < > & 改行などの制御文字）があります" >&2
  exit 1
fi
if [[ ! "$URL_PATH" =~ ^/[A-Za-z0-9/_-]*/$ ]]; then
  echo "ERROR: URL_PATH は /…/ の形（英数字・/_-）で指定してください: $URL_PATH" >&2
  exit 1
fi
if [[ ! "$GAS_DEPLOY_ID" =~ ^[A-Za-z0-9_-]+$ ]]; then
  echo "ERROR: GAS_DEPLOY_ID に英数字と _- 以外が含まれます" >&2
  exit 1
fi

# 取説の場所: account ファイルに MANUAL=<パス>（絶対 or account ファイルのディレクトリ基準）があればそれ、無ければ <accounts repo>/manual/<id>/
if [[ -n "${MANUAL:-}" ]]; then
  [[ "$MANUAL" = /* ]] && MANUAL_SRC="$MANUAL" || MANUAL_SRC="$(dirname "$ACCOUNT_FILE")/$MANUAL"
else
  MANUAL_SRC="$(dirname "$(dirname "$ACCOUNT_FILE")")/manual/$ID/取扱説明書（図解）.html"
fi
if [[ ! -f "$MANUAL_SRC" ]]; then
  echo "ERROR: 取説がありません: $MANUAL_SRC" >&2
  exit 1
fi

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
cd "$REPO_ROOT/web"
cp index.html app.js manifest.json sw.js icon-192.png icon-512.png "$TMP/"

python3 - "$TMP" "$MANUAL_SRC" <<'PY'
import os, re, sys
tmp, manual = sys.argv[1], sys.argv[2]
subs = {'__ACCOUNT__': os.environ['ID'], '__TITLE__': os.environ['TITLE'], '__GAS_ID__': os.environ['GAS_DEPLOY_ID']}
for name in ('index.html', 'app.js', 'manifest.json'):
    p = os.path.join(tmp, name)
    s = open(p, encoding='utf-8').read()
    for k, v in subs.items():
        s = s.replace(k, v)
    left = re.findall(r'__[A-Z][A-Z_]*__', s)
    if left:
        sys.exit(f'未置換のプレースホルダ {sorted(set(left))}: {name}')
    open(p, 'w', encoding='utf-8').write(s)

html = open(manual, encoding='utf-8').read()
bar = '''<style>
  body { padding-bottom: 72px; }
  .back-bar { position: fixed; left: 0; right: 0; bottom: 0; z-index: 1000; display: flex; align-items: center; justify-content: center; min-height: 56px; padding-bottom: env(safe-area-inset-bottom); background: #fff; border-top: 1px solid #e5e5e5; }
  .back-bar a { display: inline-flex; align-items: center; justify-content: center; min-height: 48px; padding: 0 28px; border-radius: 10px; background: #222; color: #fff; font-size: 16px; font-weight: 700; text-decoration: none; box-shadow: 0 2px 6px rgba(0,0,0,.18); }
</style>
<div class="back-bar"><a href="./" onclick="var r=document.referrer.split(/[?#]/)[0],b=location.href.split(/[?#]/)[0].replace(/[^\\/]*$/,'');if(history.length>1&&(r===b||r===b+'index.html')){history.back();return false}">アプリに戻る</a></div>
'''
if html.count('</body>') != 1:
    sys.exit('</body> が1つではありません: ' + manual)
i = html.rfind('</body>')
open(os.path.join(tmp, 'manual.html'), 'w', encoding='utf-8').write(html[:i] + bar + html[i:])
PY

DEST="/opt/docker/ig-app/$ID"
ssh vps "mkdir -p '$DEST'"
scp -q "$TMP"/* "vps:$DEST/"
ssh vps "docker exec nginx nginx -t && docker exec nginx nginx -s reload"

# 到達確認: /ig/<id>/ と URL_PATH（既存URL）の両方で、いま送った manifest.json が返ること
HOST="https://app.tamago-ai-world.com"
for P in "/ig/$ID/" "$URL_PATH"; do
  if ! curl -fsS "$HOST${P}manifest.json" | cmp -s - "$TMP/manifest.json"; then
    echo "ERROR: $HOST$P が今回の配信物を返していません（nginx の location / alias を確認）" >&2
    exit 1
  fi
  echo "ok: $HOST$P"
done
echo "deployed: $ID -> $DEST"
