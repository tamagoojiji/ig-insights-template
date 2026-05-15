/**
 * Meta公式「アカウントセンター→情報をダウンロード」zipの取り込み
 *
 * - HTMLダイアログでzip受け取り（base64） → Utilities.unzip で展開
 * - your_instagram_activity/content/posts_*.json / stories.json / reels.json をパース
 * - 既存メディアIDと突合、新規分は履歴シートに source='meta_zip' で挿入
 * - zip内 media/... 画像blobは Drive画像フォルダに保存
 *
 * 法的観点: Meta公式の正規エクスポート機能で取得した自分のデータの取り込みのみ。
 * スクレイピングや非正規ルートは一切使用しない。
 */

function openMetaZipDialog() {
  const html = HtmlService.createHtmlOutputFromFile('meta-zip-dialog')
    .setWidth(560)
    .setHeight(520);
  SpreadsheetApp.getUi().showModalDialog(html, '📦 Meta公式zipアップロード');
}

/**
 * ダイアログから呼ばれるサーバサイドハンドラ
 * @param {{ base64: string, fileName: string }} payload
 */
function importMetaZip(payload) {
  if (!payload || !payload.base64) {
    throw new Error('zipデータが渡されませんでした');
  }
  const bytes = Utilities.base64Decode(payload.base64);
  const blob = Utilities.newBlob(bytes, 'application/zip', payload.fileName || 'meta_export.zip');

  let files;
  try {
    files = Utilities.unzip(blob);
  } catch (e) {
    throw new Error('zip展開に失敗: ' + e.message);
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const summary = {
    feed_added: 0,
    reels_added: 0,
    stories_added: 0,
    images_saved: 0,
    skipped_existing: 0,
    skipped_no_id: 0,
  };

  // メディアファイルマップ（zip内パス → blob）
  const mediaMap = {};
  files.forEach(f => {
    const name = f.getName();
    if (name.indexOf('media/') === 0 || name.indexOf('your_instagram_activity/media/') === 0 || name.indexOf('media') >= 0) {
      mediaMap[name] = f;
    }
  });

  // JSON ファイルを振り分け
  files.forEach(f => {
    const name = f.getName();
    if (!name.endsWith('.json')) return;

    const lower = name.toLowerCase();
    let category = null;
    if (lower.indexOf('posts_') >= 0 || lower.endsWith('/posts.json') || lower === 'posts.json') category = 'feed';
    else if (lower.indexOf('reels.json') >= 0) category = 'reel';
    else if (lower.indexOf('stories.json') >= 0) category = 'story';
    if (!category) return;

    let json;
    try {
      json = JSON.parse(f.getDataAsString());
    } catch (e) {
      Logger.log('JSONパース失敗: ' + name + ' - ' + e.message);
      return;
    }

    const items = extractMetaItems_(json);
    items.forEach(item => insertMetaItem_(ss, category, item, mediaMap, summary));
  });

  const lines = [
    '📦 Meta zipインポート完了',
    '',
    '📸 フィード追加: ' + summary.feed_added + '件',
    '🎬 リール追加: ' + summary.reels_added + '件',
    '📖 ストーリーズ追加: ' + summary.stories_added + '件',
    '🖼 画像保存: ' + summary.images_saved + '件',
    '⏭ 既存スキップ: ' + summary.skipped_existing + '件',
  ];
  if (summary.skipped_no_id > 0) {
    lines.push('⚠️ ID欠損スキップ: ' + summary.skipped_no_id + '件');
  }
  const text = lines.join('\n');

  try { notifyDiscord(text, { kind: 'meta_zip_done', bypassCooldown: true }); } catch (_) {}

  return { ok: true, summary: text };
}

/**
 * Meta zip内の様々なJSON構造から投稿アイテム配列を抽出
 * フォーマットがバージョンで揺れるため柔軟に対応
 */
function extractMetaItems_(json) {
  if (Array.isArray(json)) return json;
  if (json && Array.isArray(json.ig_posts)) return json.ig_posts;
  if (json && Array.isArray(json.ig_reels_media)) return json.ig_reels_media;
  if (json && Array.isArray(json.ig_stories)) return json.ig_stories;
  // 単一オブジェクトのとき
  if (json && (json.media || json.uri || json.creation_timestamp)) return [json];
  return [];
}

function insertMetaItem_(ss, category, item, mediaMap, summary) {
  // メディア配列を平坦化して各画像/動画を1メディアIDとして扱う
  const mediaArr = Array.isArray(item.media) ? item.media : (item.uri ? [item] : []);
  if (mediaArr.length === 0) {
    summary.skipped_no_id++;
    return;
  }

  const ts = item.creation_timestamp || (mediaArr[0] && mediaArr[0].creation_timestamp);
  const caption = decodeMojibake_(
    (item.title || (mediaArr[0] && mediaArr[0].title) || '') + ''
  );

  // メディアID代用: meta_<timestamp>_<uri-hash>
  const fakeIdBase = 'meta_' + (ts || 'unknown') + '_';
  const firstUri = mediaArr[0].uri || '';
  const fakeId = fakeIdBase + simpleHash_(firstUri).toString(36);

  const sheetName = category === 'feed' ? '📸 フィード履歴' : (category === 'reel' ? '🎬 リール履歴' : '📖 ストーリーズ履歴');
  const sheet = ss.getSheetByName(sheetName) || getOrCreateSheet(sheetName);

  // 既存IDチェック
  const idCol = findColumn_(sheet, 'メディアID') || 2;
  if (sheet.getLastRow() >= 2) {
    const ids = sheet.getRange(2, idCol, sheet.getLastRow() - 1, 1).getValues().flat().map(String);
    if (ids.indexOf(fakeId) >= 0) {
      summary.skipped_existing++;
      return;
    }
  }

  // 画像保存
  const driveFolderId = getConfig('DRIVE_FOLDER_ID');
  let savedImageUrl = '';
  if (driveFolderId && mediaArr[0].uri) {
    const blob = mediaMap[mediaArr[0].uri];
    if (blob) {
      try {
        const subfolder = category === 'reel' ? 'reels' : (category === 'story' ? 'stories' : 'feed');
        savedImageUrl = saveBlobToDriveSubfolder_(driveFolderId, subfolder, fakeId, blob);
        summary.images_saved++;
      } catch (e) {
        Logger.log('画像保存失敗: ' + e.message);
      }
    }
  }

  const row = sheet.getLastRow() + 1;
  const tsDate = ts ? new Date(Number(ts) * 1000) : '';
  // 履歴シートヘッダ前提（投稿日時/メディアID/取得時刻/...）
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const colMap = {};
  headers.forEach((h, i) => { if (h) colMap[String(h).trim()] = i + 1; });
  const setCell = (col, val) => { if (colMap[col]) sheet.getRange(row, colMap[col]).setValue(val); };

  setCell('投稿日時', tsDate);
  setCell('メディアID', fakeId);
  setCell('取得時刻', new Date());
  setCell('キャプション', caption);
  setCell('画像URL', savedImageUrl);
  setCell('source', 'meta_zip');

  if (category === 'feed') summary.feed_added++;
  else if (category === 'reel') summary.reels_added++;
  else {
    summary.stories_added++;
    // 📖 ストーリーズ メインシートにも反映（既存はスキップ）
    insertMetaStoryToMainSheet_(ss, tsDate, fakeId, caption, savedImageUrl, mediaArr[0]);
  }
}

/**
 * Meta zip由来のストーリーをメインシート「📖 ストーリーズ」にも書き込む
 * 既存のメディアID一致 or 投稿日時一致（90秒以内）はスキップ
 */
function insertMetaStoryToMainSheet_(ss, tsDate, fakeId, caption, imageUrl, firstMedia) {
  let sheet = ss.getSheetByName('📖 ストーリーズ');
  if (!sheet) {
    sheet = ss.insertSheet('📖 ストーリーズ');
    setupStoriesHeader(sheet);
  }
  if (sheet.getLastRow() === 0) setupStoriesHeader(sheet);

  // 既存検出（ID or 投稿日時）
  let existingRow = 0;
  if (sheet.getLastRow() >= 2) {
    const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 10).getValues();
    const tsMs = tsDate instanceof Date ? tsDate.getTime() : null;
    for (let i = 0; i < data.length; i++) {
      const rowId = String(data[i][9] || '');
      const rowTs = data[i][0];
      if (rowId === fakeId) { existingRow = i + 2; break; }
      if (tsMs && rowTs instanceof Date && Math.abs(rowTs.getTime() - tsMs) < 90000) {
        existingRow = i + 2; break;
      }
    }
  }
  if (existingRow) return; // 既存スキップ

  const uri = (firstMedia && firstMedia.uri) || '';
  const isVideo = /\.(mp4|mov)$/i.test(uri);
  const mediaType = isVideo ? 'VIDEO' : 'IMAGE';
  const thumbFormula = imageUrl ? '=IMAGE("' + imageUrl.replace(/"/g, '') + '")' : '';

  const newRow = [
    tsDate, thumbFormula, mediaType,
    '', '', '', '', '', '', // メトリクス空欄（CSVで後埋め）
    fakeId
  ];
  const r = sheet.getLastRow() + 1;
  sheet.getRange(r, 1, 1, 10).setValues([newRow]);

  // キャプション → OCR列
  if (caption) {
    try {
      const ocrCol = ensureStoriesOcrColumn_(sheet);
      if (ocrCol > 0) sheet.getRange(r, ocrCol).setValue(caption);
    } catch (_) {}
  }
}

function saveBlobToDriveSubfolder_(folderId, subfolderName, fileBaseName, blob) {
  const root = DriveApp.getFolderById(folderId);
  let sub = null;
  const it = root.getFoldersByName(subfolderName);
  if (it.hasNext()) sub = it.next();
  else sub = root.createFolder(subfolderName);

  const ext = (blob.getContentType() && blob.getContentType().indexOf('video') >= 0) ? 'mp4' : 'jpg';
  const fileName = fileBaseName + '.' + ext;

  // 既存ファイルがあれば再利用（=IMAGE()用のサムネURLを返す）
  const existing = sub.getFilesByName(fileName);
  let file;
  if (existing.hasNext()) {
    file = existing.next();
  } else {
    file = sub.createFile(blob.setName(fileName));
  }
  try { file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch (_) {}
  return 'https://drive.google.com/thumbnail?id=' + file.getId() + '&sz=w400';
}

/**
 * Meta JSON の本文に頻発する mojibake (UTF-8 を Latin-1 として読んでしまった文字列) を復元
 * 例: "ã\u0083\u0086ã\u0082¹ã\u0083\u0088" → "テスト"
 */
function decodeMojibake_(s) {
  if (!s) return '';
  if (typeof s !== 'string') s = String(s);
  // すでに正しい日本語ならそのまま
  if (!/[\u00c0-\u00ff]/.test(s)) return s;
  try {
    const bytes = [];
    for (let i = 0; i < s.length; i++) bytes.push(s.charCodeAt(i) & 0xff);
    const blob = Utilities.newBlob(bytes);
    return blob.getDataAsString('UTF-8');
  } catch (e) {
    return s;
  }
}

function simpleHash_(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) - h) + str.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
}
