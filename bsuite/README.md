# bsuite — Business Suite 閲覧者内訳の自動取得

Meta Business Suite の投稿詳細（`content_id=<メディアID>`）から「フォロワー／フォロワー以外の閲覧数・女性比率・主要年齢層」を1日1回取得し、GAS Web App（`action=bsuite`）経由でスプシの4列に書き込む。

- 対象: ストーリーズ＝7日以内、リール／フィード＝14日以内、1回最大30件（新しい順）
- 本人確認・ログイン要求を検知したら `state/HALT` を作って停止し、Discord（ERROR_WEBHOOK_URL）へ通知。**自動再ログインはしない**
- 取れないもの: スキップ率・視聴維持率・閲覧者名簿（Business Suite に無い）

## 初回（Mac）
```
cd bsuite
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt && .venv/bin/playwright install chromium
cp .env.example .env   # GAS_EXEC_URL / APP_ACCESS_KEY / ACCOUNT / BUSINESS_ID / ASSET_ID を記入。Mac では STATE_DIR=./state
.venv/bin/python login.py          # 開いたブラウザで自分でログイン → state/storage_state.json（600）
.venv/bin/python scrape.py --dry-run --ids <メディアID>,<メディアID>   # 送信なしで確認
```
`login.py` が開くのは「Google Chrome for Testing」という別アプリ。**普段の Chrome でログインしても保存されない**。そのウィンドウ内でログインすると（`c_user` クッキーを検知して）自動で保存される。

## VPS 配置（アカウントごとに1コンテナ）
```
scripts/deploy-bsuite.sh --account-file <ig-insights-accounts>/accounts/<id>.env [--state <storage_state.json>]
```
`/opt/docker/ig-bsuite-<id>/` にコード・`.env`（GAS_EXEC_URL / APP_ACCESS_KEY / ACCOUNT / BUSINESS_ID / ASSET_ID / STATE_DIR）・`state/storage_state.json` を置き、compose のサービス `ig-bsuite-<id>` を追記（既にあれば更新）して起動する。FB ログインは共有できるので `--state` 省略時は既存の巡回コンテナの storage_state をコピーする。
```
ssh vps "docker exec ig-bsuite-<id> python scrape.py --dry-run --ids <メディアID>"   # 送信なしで確認
```
cron は毎日 04:40 JST。ログは `/opt/docker/ig-bsuite-<id>/logs/cron.log`。

## HALT（本人確認・ログイン要求で停止したとき）
1. スマホ等で Facebook の本人確認を済ませる
2. Mac で `login.py` をやり直し、`deploy-bsuite.sh --account-file ... --state state/storage_state.json` で VPS へ送る
3. `state/HALT` を削除（VPS: `rm /opt/docker/ig-bsuite-<id>/state/HALT`）
HALT がある間は毎回「HALT中」と出して何もしない（通知もしない）。

## Mac 退避（VPS で本人確認が続く場合）
`ssh vps docker stop ig-bsuite-<id>` のうえ、Mac の `bsuite/.env`（ACCOUNT / BUSINESS_ID / ASSET_ID 込み、`STATE_DIR=./state`）で `.venv/bin/python scrape.py` を launchd 等から毎日実行する。

## オプション
- `--dry-run` 送信・通知せず結果を JSON で表示
- `--ids a,b` 対象を指定（kind は GAS の json から引く。`--kind reel` で json 取得も省略）
- `--headed` ブラウザを表示して実行
