#!/usr/bin/env python3
"""
過去ストーリーズ取り込み代行スクリプト（運営側）

利用者から受け取ったMeta公式zipを処理し、利用者のスプシ＋Drive画像フォルダに
運営の個人Googleアカウント（ADC）で書き込む。

利用者は事前にスプシ・Drive画像フォルダを運営のGoogleアカウントに「編集者」で共有する。

GAS側 `gas/meta-zip-import.js` の振る舞いを移植：
  - メディアID: meta_<timestamp>_<simpleHash-base36>
  - 動画→ffmpeg先頭フレーム抽出.jpg
  - mojibake復元（UTF-8をLatin-1誤読した文字列）
  - 重複検出（同IDスキップ）
  - 履歴シート＋メインシート両方に書き込み
  - 画像URL: https://drive.google.com/thumbnail?id=<id>&sz=w400

事前準備（初回1回）:
    gcloud auth application-default login \\
        --scopes=https://www.googleapis.com/auth/spreadsheets,\\
https://www.googleapis.com/auth/drive,\\
https://www.googleapis.com/auth/cloud-platform

使い方:
    python3 scripts/admin-import-stories.py \\
        --zips ~/Downloads/instagram-xxx-1.zip ~/Downloads/instagram-xxx-2.zip \\
        --sheet-url https://docs.google.com/spreadsheets/d/SPREADSHEET_ID/edit \\
        --drive-folder-url https://drive.google.com/drive/folders/FOLDER_ID \\
        [--dry-run]

要件:
    pip3 install google-api-python-client google-auth google-auth-httplib2
    ffmpeg（brew install ffmpeg）
    gcloud CLI（brew install --cask google-cloud-sdk）
"""

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
import zipfile
from pathlib import Path

try:
    import google.auth
    from google.auth.exceptions import DefaultCredentialsError
    from googleapiclient.discovery import build
    from googleapiclient.errors import HttpError
    from googleapiclient.http import MediaFileUpload
except ImportError:
    print("google-api-python-client がインストールされていません。", file=sys.stderr)
    print("pip3 install google-api-python-client google-auth google-auth-httplib2", file=sys.stderr)
    sys.exit(1)


SCOPES = [
    'https://www.googleapis.com/auth/spreadsheets',
    'https://www.googleapis.com/auth/drive',
]
STORIES_SHEET = '📖 ストーリーズ'
STORIES_HISTORY_SHEET = '📖 ストーリーズ履歴'


def log(msg):
    print(f"[admin-import] {msg}", flush=True)


def parse_id_from_url(url, kind):
    """スプシURL or DriveフォルダURLからIDを抽出"""
    m = re.search(r'/(?:d|folders)/([a-zA-Z0-9_-]+)', url)
    if not m:
        raise ValueError(f"{kind}のURLからID抽出に失敗: {url}")
    return m.group(1)


def simple_hash(s: str) -> int:
    """GAS side simpleHash_ port: ((h<<5)-h)+c with 32-bit signed semantics, then abs."""
    h = 0
    for ch in s:
        h = ((h << 5) - h) + ord(ch)
        h &= 0xFFFFFFFF
        if h >= 0x80000000:
            h -= 0x100000000
    return abs(h)


def to_base36(n):
    if n == 0:
        return '0'
    chars = '0123456789abcdefghijklmnopqrstuvwxyz'
    out = []
    while n:
        n, r = divmod(n, 36)
        out.append(chars[r])
    return ''.join(reversed(out))


def make_fake_id(timestamp, first_uri):
    return f"meta_{timestamp or 'unknown'}_{to_base36(simple_hash(first_uri))}"


def decode_mojibake(s):
    """GAS side decodeMojibake_ port: restore UTF-8 misread as Latin-1."""
    if not s:
        return ''
    if not isinstance(s, str):
        s = str(s)
    if not re.search(r'[\u00c0-\u00ff]', s):
        return s
    try:
        return s.encode('latin-1').decode('utf-8')
    except (UnicodeEncodeError, UnicodeDecodeError):
        return s


def extract_frame(mp4, jpg):
    try:
        subprocess.run(
            ['ffmpeg', '-y', '-loglevel', 'error',
             '-i', str(mp4), '-ss', '0.1', '-vframes', '1', '-q:v', '3', str(jpg)],
            check=True, stderr=subprocess.PIPE)
        return True
    except subprocess.CalledProcessError:
        return False
    except FileNotFoundError:
        log("ffmpeg が見つかりません。brew install ffmpeg")
        sys.exit(1)


def find_stories_json(work_dirs):
    candidates = [
        'your_instagram_activity/media/stories.json',
        'your_instagram_activity/content/stories.json',
    ]
    for d in work_dirs:
        for sub in candidates:
            p = d / sub
            if p.exists():
                return p
    return None


def find_media_file(work_dirs, uri):
    for d in work_dirs:
        p = d / uri
        if p.exists():
            return p
    return None


def upload_to_drive(drive_service, folder_id, local_file, fake_id):
    ext = local_file.suffix.lower().lstrip('.') or 'jpg'
    if ext not in ('jpg', 'jpeg', 'png'):
        ext = 'jpg'
    target_name = f"{fake_id}.{ext}"

    q = f"name='{target_name}' and '{folder_id}' in parents and trashed=false"
    res = drive_service.files().list(q=q, fields='files(id)').execute()
    if res.get('files'):
        file_id = res['files'][0]['id']
    else:
        meta = {'name': target_name, 'parents': [folder_id]}
        media = MediaFileUpload(str(local_file), resumable=False)
        f = drive_service.files().create(body=meta, media_body=media, fields='id').execute()
        file_id = f['id']
        try:
            drive_service.permissions().create(
                fileId=file_id,
                body={'role': 'reader', 'type': 'anyone'},
            ).execute()
        except HttpError:
            pass
    return f"https://drive.google.com/thumbnail?id={file_id}&sz=w400"


def get_existing_ids(sheets_service, spreadsheet_id, sheet_name, id_col_letter):
    try:
        range_ = f"'{sheet_name}'!{id_col_letter}2:{id_col_letter}"
        res = sheets_service.spreadsheets().values().get(
            spreadsheetId=spreadsheet_id, range=range_
        ).execute()
        rows = res.get('values', [])
        return set(str(r[0]) for r in rows if r and r[0])
    except HttpError as e:
        log(f"既存ID取得エラー ({sheet_name}): {e}")
        return set()


def append_rows(sheets_service, spreadsheet_id, sheet_name, rows):
    if not rows:
        return 0
    body = {'values': rows}
    sheets_service.spreadsheets().values().append(
        spreadsheetId=spreadsheet_id,
        range=f"'{sheet_name}'!A:Z",
        valueInputOption='USER_ENTERED',
        insertDataOption='INSERT_ROWS',
        body=body,
    ).execute()
    return len(rows)


def main():
    ap = argparse.ArgumentParser(description='過去ストーリーズ取り込み代行')
    ap.add_argument('--zips', nargs='+', required=True, help='Meta公式zipのパス（複数可）')
    ap.add_argument('--sheet-url', required=True, help='利用者スプシURL')
    ap.add_argument('--drive-folder-url', required=True, help='Drive画像フォルダURL')
    ap.add_argument('--dry-run', action='store_true', help='書き込まずシミュレーション')
    args = ap.parse_args()

    try:
        creds, _ = google.auth.default(scopes=SCOPES)
    except DefaultCredentialsError:
        log("ADC認証情報が見つかりません。以下を一度実行してください:")
        log("  gcloud auth application-default login \\")
        log("    --scopes=https://www.googleapis.com/auth/spreadsheets,"
            "https://www.googleapis.com/auth/drive,"
            "https://www.googleapis.com/auth/cloud-platform")
        return 1
    sheets = build('sheets', 'v4', credentials=creds, cache_discovery=False)
    drive = build('drive', 'v3', credentials=creds, cache_discovery=False)
    log("認証OK（ADC）")

    spreadsheet_id = parse_id_from_url(args.sheet_url, 'スプシ')
    folder_id = parse_id_from_url(args.drive_folder_url, 'Driveフォルダ')
    log(f"スプシID: {spreadsheet_id}")
    log(f"DriveフォルダID: {folder_id}")

    work_root = Path(tempfile.mkdtemp(prefix='admin-import-'))
    work_dirs = []
    try:
        for zp_arg in args.zips:
            zp = Path(zp_arg).expanduser()
            if not zp.exists():
                log(f"zip見つからず: {zp}")
                continue
            d = work_root / zp.stem
            d.mkdir()
            log(f"展開: {zp.name}")
            with zipfile.ZipFile(zp) as zf:
                zf.extractall(d)
            work_dirs.append(d)

        stories_json = find_stories_json(work_dirs)
        if not stories_json:
            log("stories.jsonが見つかりません")
            return 1
        log(f"stories.json: {stories_json}")
        data = json.loads(stories_json.read_text(encoding='utf-8'))
        items = data.get('ig_stories', [])
        log(f"ストーリー件数: {len(items)}")

        existing_main = get_existing_ids(sheets, spreadsheet_id, STORIES_SHEET, 'J')
        existing_history = get_existing_ids(sheets, spreadsheet_id, STORIES_HISTORY_SHEET, 'B')
        log(f"既存ID（メイン）: {len(existing_main)} / （履歴）: {len(existing_history)}")

        log("動画→jpg変換中...")
        video_count = 0
        for d in work_dirs:
            stories_media = d / 'media/stories'
            if not stories_media.exists():
                continue
            for vid in list(stories_media.rglob('*.mp4')) + list(stories_media.rglob('*.mov')):
                jpg = vid.with_suffix('.jpg')
                if jpg.exists():
                    continue
                if extract_frame(vid, jpg):
                    video_count += 1
        log(f"動画変換: {video_count}件")

        main_rows = []
        history_rows = []
        skipped = 0
        no_media = 0
        upload_failed = 0

        for i, item in enumerate(items):
            uri = item.get('uri', '')
            if not uri:
                no_media += 1
                continue
            ts = item.get('creation_timestamp')
            caption = decode_mojibake(item.get('title') or '')
            fake_id = make_fake_id(ts, uri)

            in_main = fake_id in existing_main
            in_history = fake_id in existing_history
            if in_main and in_history:
                skipped += 1
                continue

            search_uri = uri
            if uri.lower().endswith(('.mp4', '.mov')):
                search_uri = os.path.splitext(uri)[0] + '.jpg'
            media_file = find_media_file(work_dirs, search_uri) or find_media_file(work_dirs, uri)

            image_url = ''
            if media_file and not args.dry_run:
                try:
                    image_url = upload_to_drive(drive, folder_id, media_file, fake_id)
                except HttpError as e:
                    log(f"  Drive UP失敗 ({fake_id}): {e}")
                    upload_failed += 1

            ts_str = time.strftime('%Y/%m/%d %H:%M', time.localtime(ts)) if ts else ''
            media_type = 'VIDEO' if uri.lower().endswith(('.mp4', '.mov')) else 'IMAGE'
            thumb_formula = f'=IMAGE("{image_url}")' if image_url else ''

            if not in_main:
                main_rows.append([
                    ts_str, thumb_formula, media_type,
                    '', '', '', '', '', '',
                    fake_id,
                ])
                existing_main.add(fake_id)
            if not in_history:
                history_rows.append([
                    ts_str, fake_id, time.strftime('%Y/%m/%d %H:%M'),
                    '', '', '', '', '', '', '',
                ])
                existing_history.add(fake_id)

            if (i + 1) % 200 == 0:
                log(f"  処理: {i + 1}/{len(items)}")

        log(f"処理完了: 追加(メイン){len(main_rows)} / (履歴){len(history_rows)} "
            f"/ スキップ{skipped} / メディア無し{no_media} / UP失敗{upload_failed}")

        if args.dry_run:
            log("DRY RUN: シート書き込みスキップ")
        else:
            if main_rows:
                append_rows(sheets, spreadsheet_id, STORIES_SHEET, main_rows)
                log(f"  メインシート書き込み: {len(main_rows)}行")
            if history_rows:
                append_rows(sheets, spreadsheet_id, STORIES_HISTORY_SHEET, history_rows)
                log(f"  履歴シート書き込み: {len(history_rows)}行")

        log("完了")
        return 0
    finally:
        shutil.rmtree(work_root, ignore_errors=True)


if __name__ == '__main__':
    sys.exit(main())
