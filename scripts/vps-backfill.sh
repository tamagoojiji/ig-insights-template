#!/bin/bash
#
# VPS一時バックフィル: IG Graph API でフィード/リール全件+インサイトを取得し、
# JSON としてローカルに保存する。VPS 上には何も残さない（ssh ヒアドキュメントで
# 環境変数のみで一時実行・セッション終了時点で全消失）。
#
# 使い方:
#   1. scripts/vps-backfill.env.example をコピーして TOKEN と USER_ID を記入
#      cp scripts/vps-backfill.env.example scripts/vps-backfill.env
#   2. このスクリプト実行
#      bash scripts/vps-backfill.sh
#   3. 出力された JSON ファイルパスをコピー → pbcopy < /tmp/ig-backfill-xxx.json
#   4. スプシメニュー「📥 VPSバックフィルJSONをインポート」→ ペースト → インポート
#   5. 完了後にローカルJSONも削除
#      rm /tmp/ig-backfill-*.json scripts/vps-backfill.env
#
# 必要環境:
#   - ローカル: bash, ssh, jq（任意・件数表示のみ）
#   - VPS:     python3（標準ライブラリのみ使用）
#   - SSH接続: ~/.ssh/config に `Host vps` エイリアス、または引数で host 指定

set -e

ENV_FILE="${1:-$(dirname "$0")/vps-backfill.env}"
SSH_HOST="${SSH_HOST:-vps}"
OUT_FILE="${OUT_FILE:-/tmp/ig-backfill-$(date +%s).json}"

if [ ! -f "$ENV_FILE" ]; then
  echo "❌ ENVファイルが見つかりません: $ENV_FILE"
  echo "   cp scripts/vps-backfill.env.example scripts/vps-backfill.env"
  echo "   して TOKEN と USER_ID を記入してください。"
  exit 1
fi

# shellcheck disable=SC1090
source "$ENV_FILE"

if [ -z "${TOKEN:-}" ] || [ -z "${USER_ID:-}" ]; then
  echo "❌ TOKEN または USER_ID が未設定です（$ENV_FILE）"
  exit 1
fi

echo "🚀 VPSバックフィル開始..."
echo "   ssh host: $SSH_HOST"
echo "   out:     $OUT_FILE"
echo ""

# VPS 上で python3 を ssh ヒアドキュメントで一時実行
# - 環境変数 TOKEN/USER_ID は ssh プロセスのみで存在
# - スクリプト本体はファイルとして保存しない（標準入力経由）
# - 出力は stdout のみ（VPSにファイル書かない）
ssh "$SSH_HOST" "TOKEN='$TOKEN' USER_ID='$USER_ID' python3 - " > "$OUT_FILE" <<'PYEOF'
import os, json, sys, time, urllib.request, urllib.error

TOKEN = os.environ['TOKEN']
USER_ID = os.environ['USER_ID']
BASE = 'https://graph.facebook.com/v22.0'

def fetch(url, retries=3):
    last_err = None
    for i in range(retries):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'ig-insights-vps-backfill/1.0'})
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.loads(r.read().decode())
        except urllib.error.HTTPError as e:
            body = e.read().decode() if e.fp else ''
            try:
                err = json.loads(body)
                if err.get('error', {}).get('code') == 4 and i < retries - 1:
                    time.sleep(60 * (i + 1))
                    continue
            except Exception:
                pass
            last_err = f'HTTP {e.code}: {body[:200]}'
        except Exception as e:
            last_err = str(e)
            time.sleep(2 * (i + 1))
    raise RuntimeError(last_err or 'unknown error')

# Step 1: 全メディアを paging で取得
print('🔍 メディア一覧を取得中...', file=sys.stderr)
fields = 'id,media_type,media_url,thumbnail_url,timestamp,caption,like_count,comments_count,permalink'
url = f'{BASE}/{USER_ID}/media?fields={fields}&limit=100&access_token={TOKEN}'
all_media = []
page = 0
while url:
    page += 1
    data = fetch(url)
    if 'error' in data:
        print(json.dumps({'error': data['error']['message']}, ensure_ascii=False))
        sys.exit(1)
    items = data.get('data', [])
    all_media.extend(items)
    print(f'  page {page}: +{len(items)}件 (累計 {len(all_media)})', file=sys.stderr)
    url = data.get('paging', {}).get('next')

print(f'✅ メディア取得完了: {len(all_media)}件', file=sys.stderr)

# Step 2: 各メディアの insights を取得
print('🔍 インサイト取得中...', file=sys.stderr)
result = []
for i, m in enumerate(all_media):
    if i % 20 == 0:
        print(f'  {i}/{len(all_media)}...', file=sys.stderr)
    if m['media_type'] == 'VIDEO':
        metrics = 'views,reach,saved,shares,total_interactions,ig_reels_avg_watch_time'
    else:
        metrics = 'views,reach,saved,shares,total_interactions'
    iurl = f"{BASE}/{m['id']}/insights?metric={metrics}&access_token={TOKEN}"
    insights = {}
    try:
        idata = fetch(iurl)
        for it in idata.get('data', []):
            insights[it['name']] = it['values'][0]['value']
    except Exception as e:
        m['_insight_error'] = str(e)
    m['_insights'] = insights
    result.append(m)
    time.sleep(0.05)

print(f'✅ インサイト取得完了', file=sys.stderr)
print(json.dumps({'media': result, 'count': len(result), 'fetched_at': int(time.time())}, ensure_ascii=False))
PYEOF

# 結果ファイルの確認
if [ ! -s "$OUT_FILE" ]; then
  echo "❌ 出力ファイルが空です。SSH 接続またはAPI エラーの可能性。"
  exit 1
fi

# JSON 構造のチェック
if command -v jq >/dev/null 2>&1; then
  if jq -e '.error' "$OUT_FILE" >/dev/null 2>&1; then
    err=$(jq -r '.error' "$OUT_FILE")
    echo "❌ APIエラー: $err"
    exit 1
  fi
  count=$(jq -r '.count // 0' "$OUT_FILE")
  size=$(du -h "$OUT_FILE" | cut -f1)
  echo ""
  echo "✅ 完了: $count件 / $size"
else
  size=$(du -h "$OUT_FILE" | cut -f1)
  echo ""
  echo "✅ 完了: $size"
fi

echo ""
echo "📋 次の手順:"
echo "   1. クリップボードにコピー:"
echo "      pbcopy < $OUT_FILE"
echo "   2. スプシでメニュー「📊 Instagram Insights → 📥 VPSバックフィルJSONをインポート」"
echo "   3. ダイアログにペースト → 「インポート」"
echo "   4. 完了後、ローカル一時ファイルを削除:"
echo "      rm $OUT_FILE $ENV_FILE"
echo ""
echo "🔒 VPS には何も残っていません（ssh ヒアドキュメントで一時実行のみ）"
