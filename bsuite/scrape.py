"""Business Suite の投稿詳細から閲覧者内訳を取得して GAS に送る（1日1回）"""
import argparse
import json
import random
import re
import sys
import time
from datetime import datetime

import config
import gas_client

AGE_BANDS = ['13-17', '18-24', '25-34', '35-44', '45-54', '55-64', '65+']
_NUM = r'(\d[\d,]*(?:\.\d+)?万?)'
_BAND = r'(?:' + '|'.join(re.escape(b) for b in AGE_BANDS) + r')'
# 年齢ラベルの連なり（帯数は投稿で変わる。ストーリーは 25-34 始まりの5帯など）の直後に女性/男性行が続く表
_AGE_TABLE = re.compile(r'((?:' + _BAND + r'[ \t]+)*' + _BAND + r')[ \t]*\n(?=(?:女性|男性)[ \t])')


class HaltError(Exception):
    pass


# ---------- 純粋関数（テスト対象） ----------

def to_int(s):
    s = s.replace(',', '')
    if s.endswith('万'):
        return round(float(s[:-1]) * 10000)
    return int(float(s))


def parse_follow_split(text):
    """「フォロワー 6,123 … フォロワー以外 8,708」→ (6123, 8708)。取れなければ (None, None)"""
    m_non = re.search(r'フォロワー以外\s*' + _NUM, text)
    if not m_non:
        return None, None
    before = re.findall(r'フォロワー(?!以外)\s*' + _NUM, text[:m_non.start()])
    if not before:
        return None, None
    return to_int(before[-1]), to_int(m_non.group(1))


def parse_female_pct(text):
    m = re.search(r'女性\s*(\d+(?:\.\d+)?)\s*%', text)
    if not m:
        return None
    v = float(m.group(1))
    return int(v) if v.is_integer() else v


def _nums(s):
    return [float(x) for x in re.findall(r'\d+(?:\.\d+)?', s)]


def parse_top_age(text):
    """年齢×性別の表から最多の年齢帯。性別行があれば '35-44 (33%)'、無ければ帯名だけ、取れなければ ''"""
    for m in _AGE_TABLE.finditer(text):
        labels = re.findall(_BAND, m.group(1))
        totals = [0.0] * len(labels)
        for line in text[m.end():].split('\n')[:2]:
            row = re.match(r'(?:女性|男性)[ \t]+(.*)$', line)
            vals = _nums(row.group(1)) if row else []
            if len(vals) == len(labels):
                totals = [a + b for a, b in zip(totals, vals)]
        if any(totals):
            i = max(range(len(labels)), key=lambda k: totals[k])
            return f'{labels[i]} ({int(totals[i] + 0.5)}%)'
    vals = {}
    for b in AGE_BANDS:
        mb = re.search(re.escape(b) + r'\s+(\d+(?:\.\d+)?)\s*%', text)
        if mb:
            vals[b] = float(mb.group(1))
    return max(vals, key=vals.get) if vals else ''


def parse_detail(text):
    followers, non = parse_follow_split(text)
    if followers is None:
        return None
    return {
        'followers': followers,
        'nonFollowers': non,
        'femalePct': parse_female_pct(text),
        'topAge': parse_top_age(text),
    }


# ---------- ブラウザ操作 ----------

def check_halt(page):
    url = page.url
    if 'checkpoint' in url:
        raise HaltError('checkpoint')
    if 'login' in url:
        raise HaltError('login')
    for sel in ('input[name="email"]', 'input[name="pass"]'):
        if page.locator(sel).first.is_visible():
            raise HaltError('login_form')


def scrape_one(page, media_id, dump=False):
    page.goto(config.detail_url(media_id), wait_until='domcontentloaded', timeout=60000)
    check_halt(page)
    try:
        tab = page.get_by_role('tab', name='オーディエンス').first
        tab.wait_for(timeout=30000)
        tab.click()
        page.get_by_role('heading', name='フォロワー以外').first.wait_for(timeout=20000)
    except Exception:
        check_halt(page)
        raise
    text = page.inner_text('body')
    if dump:
        print(f'===== {media_id} =====\n{text}\n===== end =====', file=sys.stderr)
    result = parse_detail(text)
    if result is None:
        raise RuntimeError('フォロワー/フォロワー以外の数値が見つからない')
    return result


def write_halt(kind):
    config.STATE_DIR.mkdir(parents=True, exist_ok=True)
    config.HALT_FILE.write_text(f'{datetime.now().isoformat(timespec="seconds")} {kind}\n', encoding='utf-8')


def notify(message, dry_run):
    if dry_run:
        print(f'[dry-run] alert: {message}')
        return
    try:
        gas_client.alert(message)
    except Exception as e:
        print(f'alert 送信失敗: {e}', file=sys.stderr)


def resolve_targets(args):
    if not args.ids:
        return gas_client.fetch_targets()
    ids = [x.strip() for x in args.ids.split(',') if x.strip()]
    if args.kind:
        return [{'id': i, 'kind': args.kind} for i in ids]
    kmap = gas_client.kind_map(gas_client.fetch_app_data())
    targets = []
    for i in ids:
        if i in kmap:
            targets.append({'id': i, 'kind': kmap[i]})
        else:
            print(f'kind 不明のためスキップ: {i}', file=sys.stderr)
    return targets


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument('--dry-run', action='store_true')
    ap.add_argument('--ids')
    ap.add_argument('--kind', choices=['reel', 'feed', 'story'])
    ap.add_argument('--headed', action='store_true')
    ap.add_argument('--dump-text', action='store_true')
    args = ap.parse_args(argv)

    if config.HALT_FILE.exists():
        print(f'HALT中: {config.HALT_FILE} を消すまで実行しません')
        return 0
    if not config.STORAGE_STATE.exists():
        msg = f'🛑 Business Suite 巡回: storage_state.json が無い（{config.STORAGE_STATE}）。login.py でログインしてください'
        print(msg)
        notify(msg, args.dry_run)
        return 2

    targets = resolve_targets(args)
    results, failed = [], []

    from playwright.sync_api import sync_playwright
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=not args.headed)
        context = browser.new_context(storage_state=str(config.STORAGE_STATE), **config.context_options())
        page = context.new_page()
        try:
            for n, t in enumerate(targets):
                if n:
                    time.sleep(random.uniform(*config.WAIT_RANGE))
                try:
                    results.append(dict(t, **scrape_one(page, t['id'], args.dump_text)))
                except HaltError as h:
                    write_halt(h.args[0])
                    notify('🛑 Business Suite 巡回停止: 本人確認/ログイン要求を検知。state/HALT を消すまで再実行しません', args.dry_run)
                    print(f'HALT: {h.args[0]}')
                    return 2
                except Exception as e:
                    failed.append(t['id'])
                    print(f'失敗 {t["id"]}: {e}', file=sys.stderr)
        finally:
            context.close()
            browser.close()

    if args.dry_run:
        print(json.dumps(results, ensure_ascii=False, indent=2))
        sent = 'dry-run'
    elif results:
        sent = gas_client.post_results(results).get('updated')
    else:
        sent = 0
    if failed:
        notify(f'⚠️ Business Suite 巡回: 失敗 {len(failed)}件 {", ".join(failed)}', args.dry_run)
    print(f'取得 {len(results)}件 / 失敗 {len(failed)}件 / 送信 {sent}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
