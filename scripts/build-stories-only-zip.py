#!/usr/bin/env python3
"""
ストーリーズ専用zip作成スクリプト

複数のMeta公式エクスポート展開フォルダから「ストーリーズに必要なもの」だけを抽出し、
動画は先頭フレーム抽出で .jpg 化、1つの zip にまとめて出力する。

入力（既定）:
    ~/Downloads/instagram-*-rwjc1mJA/   (JSON入り)
    ~/Downloads/instagram-*-u4WdvuDZ/   (メディア入り)

出力:
    ~/processed/stories_only_<日付>.zip

要件:
    - Python 3.8+
    - ffmpeg (brew install ffmpeg)
"""

import datetime
import json
import os
import shutil
import subprocess
import sys
import zipfile
from pathlib import Path


SOURCES = [
    Path.home() / 'Downloads/instagram-tamago_usj_guide-2026-05-13-rwjc1mJA',
    Path.home() / 'Downloads/instagram-tamago_usj_guide-2026-05-13-u4WdvuDZ',
]

JSON_CANDIDATES = [
    'your_instagram_activity/media/stories.json',
    'your_instagram_activity/content/stories.json',
]


def log(msg: str) -> None:
    print(f"[stories-zip] {msg}", flush=True)


def find_stories_json():
    for src in SOURCES:
        for sub in JSON_CANDIDATES:
            p = src / sub
            if p.exists():
                return p
    return None


def extract_frame(mp4: Path, jpg: Path) -> bool:
    try:
        subprocess.run(
            ['ffmpeg', '-y', '-loglevel', 'error',
             '-i', str(mp4), '-ss', '0.1', '-vframes', '1', '-q:v', '3',
             str(jpg)],
            check=True, stderr=subprocess.PIPE)
        return True
    except subprocess.CalledProcessError:
        return False
    except FileNotFoundError:
        log("ffmpeg が見つかりません。brew install ffmpeg")
        sys.exit(1)


def rewrite_json_uris(json_path: Path) -> int:
    data = json.loads(json_path.read_text(encoding='utf-8'))
    count = 0

    def walk(obj):
        nonlocal count
        if isinstance(obj, dict):
            uri = obj.get('uri', '')
            if isinstance(uri, str) and uri.lower().endswith(('.mp4', '.mov')):
                obj['uri'] = os.path.splitext(uri)[0] + '.jpg'
                count += 1
            for v in obj.values():
                walk(v)
        elif isinstance(obj, list):
            for v in obj:
                walk(v)

    walk(data)
    json_path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding='utf-8')
    return count


def main() -> int:
    json_src = find_stories_json()
    if not json_src:
        log("stories.json が見つかりません")
        return 1
    log(f"metadata: {json_src}")

    out_dir = Path.home() / 'processed'
    out_dir.mkdir(exist_ok=True)
    work = out_dir / '.tmp_stories_only'
    if work.exists():
        shutil.rmtree(work)
    work.mkdir(parents=True)

    # 1. stories.json を新規構造で配置
    tgt_json = work / 'your_instagram_activity/media/stories.json'
    tgt_json.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy(json_src, tgt_json)

    # 2. media/stories/ を全ソースからマージ
    tgt_media = work / 'media/stories'
    tgt_media.mkdir(parents=True, exist_ok=True)
    total_copied = 0
    videos = []
    for src in SOURCES:
        s = src / 'media/stories'
        if not s.exists():
            continue
        log(f"merge: {s}")
        for f in s.rglob('*'):
            if not f.is_file():
                continue
            rel = f.relative_to(s)
            dst = tgt_media / rel
            if dst.exists():
                continue
            dst.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(f, dst)
            total_copied += 1
            if dst.suffix.lower() in ('.mp4', '.mov'):
                videos.append(dst)
    log(f"copied {total_copied} files (videos: {len(videos)})")

    # 3. 動画 → 先頭フレーム抽出 .jpg
    converted = failed = 0
    for i, mp4 in enumerate(videos, 1):
        jpg = mp4.with_suffix('.jpg')
        if jpg.exists():
            mp4.unlink()
            continue
        if extract_frame(mp4, jpg):
            mp4.unlink()
            converted += 1
        else:
            failed += 1
        if i % 100 == 0:
            log(f"  video progress: {i}/{len(videos)}")
    log(f"videos -> jpg: {converted}, failed: {failed}")

    # 4. JSON 内の .mp4 参照を .jpg に書き換え
    rewritten = rewrite_json_uris(tgt_json)
    log(f"json rewrite: {rewritten} entries")

    # 5. zip 化
    today = datetime.date.today().strftime('%Y-%m-%d')
    out_zip = out_dir / f'stories_only_{today}.zip'
    if out_zip.exists():
        out_zip.unlink()
    log(f"zipping -> {out_zip}")
    with zipfile.ZipFile(out_zip, 'w', zipfile.ZIP_DEFLATED, compresslevel=6) as zf:
        for f in work.rglob('*'):
            if f.is_file():
                zf.write(f, f.relative_to(work))
    shutil.rmtree(work)

    mb = out_zip.stat().st_size / 1024 / 1024
    log(f"done: {out_zip} ({mb:.1f} MB)")
    return 0


if __name__ == '__main__':
    sys.exit(main())
