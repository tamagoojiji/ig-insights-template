import os
from datetime import datetime, timedelta, timezone

import requests

import config  # noqa: F401  (.env 読み込み)

JST = timezone(timedelta(hours=9))
KINDS = (('stories', 'story'), ('reels', 'reel'), ('feeds', 'feed'))


def _url():
    return os.environ['GAS_EXEC_URL']


def _key():
    return os.environ['APP_ACCESS_KEY']


def fetch_app_data():
    r = requests.get(_url(), params={'k': _key(), 'format': 'json'}, timeout=120)
    r.raise_for_status()
    return r.json()


def _posted_at(s):
    return datetime.strptime(s, '%Y/%m/%d %H:%M').replace(tzinfo=JST)


def select_targets(data, now=None):
    now = now or datetime.now(JST)
    out = []
    for key, kind in KINDS:
        days = config.STORY_DAYS if kind == 'story' else config.POST_DAYS
        cut = now - timedelta(days=days)
        for row in data.get(key) or []:
            try:
                at = _posted_at(row['postedAt'])
            except (KeyError, ValueError):
                continue
            if at >= cut:
                out.append((at, {'id': str(row['id']), 'kind': kind}))
    out.sort(key=lambda x: x[0], reverse=True)
    return [t for _, t in out[:config.MAX_ITEMS]]


def kind_map(data):
    return {str(row['id']): kind for key, kind in KINDS for row in data.get(key) or []}


def fetch_targets():
    return select_targets(fetch_app_data())


def _post(action, body):
    # GAS /exec は 302 で結果URLへ飛ばす。requests は 302 を GET で追従するので結果が受け取れる
    r = requests.post(_url(), params={'action': action, 'token': _key()}, json=body, timeout=120)
    r.raise_for_status()
    return r.json()


def post_results(items):
    return _post('bsuite', {'items': items})


def alert(message):
    return _post('bsuiteAlert', {'message': message})
