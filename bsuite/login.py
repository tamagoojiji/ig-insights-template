"""Mac で1回だけ実行。開いたブラウザで自分でログインすると storage_state.json を保存する"""
import os
import sys
import time

from playwright.sync_api import sync_playwright

import config

TIMEOUT_SEC = 600


def logged_in(url):
    return '/latest/home' in url or 'business_id=' in url


def main():
    config.STATE_DIR.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as p:
        # 永続プロファイルで起動: 手動で開いた別ウィンドウも同じコンテキストに入るので取りこぼさない
        context = p.chromium.launch_persistent_context(
            str(config.STATE_DIR / 'profile'), headless=False, **config.context_options())
        page = context.pages[0] if context.pages else context.new_page()
        page.goto('https://business.facebook.com/')
        print('開いたブラウザでログインしてください（最大10分待ちます）')
        deadline = time.time() + TIMEOUT_SEC
        while time.time() < deadline:
            if any(c['name'] == 'c_user' for c in context.cookies('https://business.facebook.com')):
                break
            if any(logged_in(pg.url) for pg in context.pages):
                break
            time.sleep(2)
        else:
            print('10分以内にログインを確認できませんでした。保存していません')
            context.close()
            return 1
        time.sleep(3)
        context.storage_state(path=str(config.STORAGE_STATE))
        os.chmod(config.STORAGE_STATE, 0o600)
        context.close()
    print(f'保存しました: {config.STORAGE_STATE}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
