#!/usr/bin/env python3
"""
ig-insights コンシェルジュ処理スクリプト

Meta アカウントセンターから出力された Instagram データzipを受け取り、
動画(.mp4)を ffmpeg で先頭フレーム抽出して .jpg に変換、
JSON の uri を .mp4 → .jpg に書き換えて、新規 zip を出力する。

入力:  ~/Downloads/instagram-xxx.zip （Meta公式 Instagram データダウンロード）
出力:  ~/processed/<元のファイル名>_processed.zip

使い方:
    python3 scripts/process-ig-zip.py ~/Downloads/instagram-xxx.zip
    python3 scripts/process-ig-zip.py ~/Downloads/*.zip   # 複数まとめて処理可

要件:
    - macOS / Linux
    - ffmpeg がパスに通っていること（`brew install ffmpeg` でインストール）
    - Python 3.8+
"""

import json
import os
import shutil
import subprocess
import sys
import zipfile
from pathlib import Path
from typing import Iterable

VIDEO_EXTS = {'.mp4', '.mov'}
MEDIA_DIR_PATTERNS = ['media/stories', 'media/posts', 'media/reels', 'media/other', 'media/profile']
JSON_TARGETS = [
    'your_instagram_activity/content/stories.json',
    'your_instagram_activity/content/posts_1.json',
    'your_instagram_activity/content/reels.json',
    'your_instagram_activity/media/stories.json',
]


def log(msg: str) -> None:
    print(f"[ig-zip] {msg}", flush=True)


def find_videos(extract_root: Path) -> list[Path]:
    """展開zip内のすべての動画ファイルを返す"""
    videos = []
    for media_dir in MEDIA_DIR_PATTERNS:
        target = extract_root / media_dir
        if not target.exists():
            continue
        for f in target.rglob('*'):
            if f.is_file() and f.suffix.lower() in VIDEO_EXTS:
                videos.append(f)
    return videos


def extract_frame(mp4_path: Path, jpg_path: Path) -> bool:
    """ffmpeg で .mp4 の先頭フレームを .jpg に抽出"""
    try:
        subprocess.run(
            [
                'ffmpeg', '-y', '-loglevel', 'error',
                '-i', str(mp4_path),
                '-ss', '0.1', '-vframes', '1', '-q:v', '3',
                str(jpg_path),
            ],
            check=True,
            stderr=subprocess.PIPE,
        )
        return True
    except subprocess.CalledProcessError as e:
        log(f"  ⚠️ ffmpeg失敗: {mp4_path.name} ({e.stderr.decode()[:100] if e.stderr else 'no detail'})")
        return False
    except FileNotFoundError:
        log("❌ ffmpeg が見つかりません。`brew install ffmpeg` でインストールしてください")
        sys.exit(1)


def rewrite_json_uris(json_path: Path) -> int:
    """JSON 内の media.uri が .mp4 を指していたら .jpg に書き換え"""
    if not json_path.exists():
        return 0
    try:
        data = json.loads(json_path.read_text(encoding='utf-8'))
    except json.JSONDecodeError as e:
        log(f"  ⚠️ JSON パース失敗: {json_path.name} ({e})")
        return 0

    count = 0

    def rewrite_media_entry(media: dict) -> None:
        nonlocal count
        uri = media.get('uri', '')
        if uri.lower().endswith(('.mp4', '.mov')):
            new_uri = os.path.splitext(uri)[0] + '.jpg'
            media['uri'] = new_uri
            count += 1

    def walk(obj):
        if isinstance(obj, dict):
            if 'uri' in obj and isinstance(obj.get('uri'), str):
                rewrite_media_entry(obj)
            for v in obj.values():
                walk(v)
        elif isinstance(obj, list):
            for v in obj:
                walk(v)

    walk(data)

    if count > 0:
        json_path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding='utf-8')
    return count


def process_one_zip(zip_path: Path, output_dir: Path) -> dict:
    log(f"📦 処理開始: {zip_path.name} ({zip_path.stat().st_size / 1024 / 1024:.1f} MB)")
    work_dir = output_dir / f".tmp_{zip_path.stem}"
    if work_dir.exists():
        shutil.rmtree(work_dir)
    work_dir.mkdir(parents=True, exist_ok=True)

    # 1. zip 展開
    log("  📂 zip 展開中...")
    try:
        with zipfile.ZipFile(zip_path, 'r') as zf:
            zf.extractall(work_dir)
    except zipfile.BadZipFile:
        log(f"❌ 不正なzip: {zip_path}")
        shutil.rmtree(work_dir)
        return {'ok': False}

    # 2. 動画を発見して .jpg 抽出
    videos = find_videos(work_dir)
    log(f"  🎬 動画ファイル数: {len(videos)}")
    converted = 0
    failed = 0
    for i, mp4 in enumerate(videos, 1):
        jpg = mp4.with_suffix('.jpg')
        if jpg.exists():
            continue  # 既に静止画があればスキップ
        if extract_frame(mp4, jpg):
            converted += 1
            try:
                mp4.unlink()  # .mp4 削除して容量節約
            except OSError:
                pass
        else:
            failed += 1
        if i % 50 == 0:
            log(f"    進捗: {i}/{len(videos)} 変換完了")

    log(f"  ✅ 動画→JPG: {converted}件 / 失敗: {failed}件")

    # 3. JSON 内の .mp4 参照を .jpg に書き換え
    rewritten = 0
    for jp in JSON_TARGETS:
        rewritten += rewrite_json_uris(work_dir / jp)
    # also check posts_*.json patterns
    posts_dir = work_dir / 'your_instagram_activity/content'
    if posts_dir.exists():
        for jp in posts_dir.glob('posts_*.json'):
            rewritten += rewrite_json_uris(jp)
    log(f"  📝 JSON書き換え: {rewritten}箇所")

    # 4. 再 zip
    output_zip = output_dir / f"{zip_path.stem}_processed.zip"
    if output_zip.exists():
        output_zip.unlink()
    log("  📦 再zip中...")
    with zipfile.ZipFile(output_zip, 'w', zipfile.ZIP_DEFLATED) as zf:
        for root, _, files in os.walk(work_dir):
            for f in files:
                full = Path(root) / f
                arcname = full.relative_to(work_dir)
                zf.write(full, arcname)

    # 5. 一時フォルダ削除
    shutil.rmtree(work_dir)

    out_size_mb = output_zip.stat().st_size / 1024 / 1024
    log(f"  ✅ 完了: {output_zip} ({out_size_mb:.1f} MB)")
    return {
        'ok': True,
        'output': str(output_zip),
        'videos_converted': converted,
        'videos_failed': failed,
        'json_rewritten': rewritten,
        'size_mb': out_size_mb,
    }


def main(argv: list[str]) -> int:
    if len(argv) < 2:
        print(__doc__)
        return 1

    output_dir = Path.home() / 'processed'
    output_dir.mkdir(parents=True, exist_ok=True)

    results = []
    for arg in argv[1:]:
        zip_path = Path(arg).expanduser().resolve()
        if not zip_path.exists():
            log(f"❌ 見つからない: {zip_path}")
            continue
        if zip_path.suffix.lower() != '.zip':
            log(f"⚠️ zip ではない: {zip_path}")
            continue
        results.append(process_one_zip(zip_path, output_dir))

    log("")
    log("━━━━━━━━━━━━━━━━━━━━━━━━━━")
    log("📊 全体サマリ")
    log(f"  処理zip数: {len(results)}")
    total_conv = sum(r.get('videos_converted', 0) for r in results if r.get('ok'))
    total_fail = sum(r.get('videos_failed', 0) for r in results if r.get('ok'))
    log(f"  動画変換: {total_conv}件 / 失敗: {total_fail}件")
    log(f"  出力先: {output_dir}")
    for r in results:
        if r.get('ok'):
            log(f"    📦 {r['output']} ({r['size_mb']:.1f}MB)")
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
