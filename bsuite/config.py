import os
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).with_name('.env'))


def _required(name):
    v = os.environ.get(name)
    if not v:
        raise SystemExit(f'環境変数 {name} が未設定です（.env または deploy-bsuite.sh が設定）')
    return v


ACCOUNT = _required('ACCOUNT')
BUSINESS_ID = _required('BUSINESS_ID')
ASSET_ID = _required('ASSET_ID')

STORY_DAYS = 7
POST_DAYS = 14
MAX_ITEMS = 30
WAIT_RANGE = (3, 8)
USER_AGENT = ('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
              '(KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36')
LOCALE = 'ja-JP'
TIMEZONE = 'Asia/Tokyo'
VIEWPORT = (1436, 840)
STATE_DIR = Path(os.environ.get('STATE_DIR') or './state')
STORAGE_STATE = STATE_DIR / 'storage_state.json'
HALT_FILE = STATE_DIR / 'HALT'


def detail_url(media_id):
    return ('https://business.facebook.com/latest/insights/object_insights/'
            f'?asset_id={ASSET_ID}&business_id={BUSINESS_ID}&content_id={media_id}')


def context_options():
    return {
        'user_agent': USER_AGENT,
        'locale': LOCALE,
        'timezone_id': TIMEZONE,
        'viewport': {'width': VIEWPORT[0], 'height': VIEWPORT[1]},
    }
