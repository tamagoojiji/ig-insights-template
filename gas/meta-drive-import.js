/**
 * Meta公式エクスポート（展開済みフォルダ）の Driveフォルダ経由 取り込み
 *
 * 1GB級の大容量zip対応: ローカルでzipを展開→展開後フォルダをDriveにアップロード
 * → スプシメニューで Drive フォルダURL指定 → GASがフォルダ内を走査して取り込み
 *
 * 6分制限対策: PropertiesService にカーソルを保存し、続きから自動再開
 *
 * メディアファイル参照: 一括ロードせず、insertMetaItemDrive_ が必要なときだけ
 * Drive から blob を取得（lazy resolve）。サブフォルダ ID はキャッシュして
 * APIコールを節約する。
 */

const META_DRIVE_CURSOR_KEY = 'META_DRIVE_CURSOR';
const META_DRIVE_TIME_LIMIT_MS = 5 * 60 * 1000;  // 6分制限の安全マージンとして5分で打ち切り

function openMetaDriveDialog() {
  const html = HtmlService.createHtmlOutputFromFile('meta-drive-dialog')
    .setWidth(560)
    .setHeight(520);
  SpreadsheetApp.getUi().showModalDialog(html, '📁 Meta公式データ取り込み（Driveフォルダ経由）');
}

/**
 * ダイアログから呼ばれるサーバサイドハンドラ（初回 or 続行）
 * @param {{ folderUrls?: string|string[], folderUrl?: string, resume?: boolean }} payload
 *   - folderUrls: 複数行URL（newline/カンマ区切り）または配列。Metaが複数zipに分割した場合に対応
 *   - folderUrl: 後方互換用（単一URL）
 */
function importMetaFromDrive(payload) {
  payload = payload || {};
  const props = PropertiesService.getScriptProperties();
  let cursor = JSON.parse(props.getProperty(META_DRIVE_CURSOR_KEY) || 'null');

  // 初回 or 別フォルダ指定 → カーソル初期化
  if (!payload.resume || !cursor) {
    const folderIds = parseDriveFolderInput_(payload);
    if (folderIds.length === 0) throw new Error('DriveフォルダURLが指定されていません');

    const rootFolders = folderIds.map(id => DriveApp.getFolderById(id));
    const jsonQueue = indexJsonFilesRecursiveMulti_(rootFolders);
    if (jsonQueue.length === 0) {
      // 診断: 深さ4まで掘り下げ＋全 .json ファイル位置を列挙
      const diag = ['Metaの content JSON が見つかりません。診断:'];
      rootFolders.forEach((root, i) => {
        diag.push('');
        diag.push('[Folder ' + (i+1) + '] ' + root.getName());
        // 深さ4までフォルダ構造を表示
        dumpDriveTreeDiag_(root, '  ', diag, 4);
        // 加えて全 .json ファイルを再帰検索（最大20件）
        const jsonsFound = listAllJsonFilesInFolder_(root, 20);
        if (jsonsFound.length > 0) {
          diag.push('  📄 検出された .json ファイル:');
          jsonsFound.forEach(p => diag.push('    - ' + p));
        } else {
          diag.push('  📄 .json ファイル: なし');
        }
      });
      throw new Error(diag.join('\n'));
    }

    cursor = {
      folderIds: folderIds,   // 複数フォルダ対応
      jsonQueue: jsonQueue,
      currentJson: null,
      completedJsonIds: [],
      summary: {
        feed_added: 0,
        reels_added: 0,
        stories_added: 0,
        images_saved: 0,
        skipped_existing: 0,
        skipped_no_id: 0,
      }
    };
    props.setProperty(META_DRIVE_CURSOR_KEY, JSON.stringify(cursor));
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  // 取り込みに必要な列を履歴シートに保証
  ensureMetaHistoryColumns_(ss);

  // 後方互換: 旧カーソル（folderId 単数）も読み込める
  const folderIds = cursor.folderIds || (cursor.folderId ? [cursor.folderId] : []);
  const rootFolders = folderIds.map(id => DriveApp.getFolderById(id));
  // メディア解決: ファイル名で全Drive直下を索引化（pathマッチの不確実性を回避）
  // 初回起動時に数秒〜十数秒かかるが、以降の解決は O(1)
  Logger.log('メディアファイル名インデックス構築開始...');
  const filenameIndex = buildMediaFilenameIndex_(rootFolders);
  Logger.log('メディアファイル名インデックス完了: ' + Object.keys(filenameIndex).length + 'ファイル');
  // ファイルIDから直接 thumbnail URL を構築（Driveコピー不要・高速）
  const mediaResolver = makeFilenameImageUrlResolver_(filenameIndex);

  const startMs = Date.now();
  const isTimeUp = () => (Date.now() - startMs) > META_DRIVE_TIME_LIMIT_MS;

  // バッチI/O用の状態（カテゴリ別シート/IDキャッシュ/書き込みバッファ）
  // 1セルずつ setValue ではなく 100件まとめて setValues する
  const bufState = createMetaDriveBufferState_(ss);

  // items は カーソルに含めず、実行中だけメモリ保持（PropertiesService 9KB制限回避）
  let currentItems = null;

  // 再開時: currentJson があれば items を再ロードする
  if (cursor.currentJson && cursor.currentJson.fileId) {
    try {
      const file = DriveApp.getFileById(cursor.currentJson.fileId);
      const json = JSON.parse(file.getBlob().getDataAsString());
      currentItems = extractMetaItems_(json);
      // itemsCount を整合させる（後方互換用）
      if (!cursor.currentJson.itemsCount) cursor.currentJson.itemsCount = currentItems.length;
    } catch (e) {
      Logger.log('再開時JSON再ロード失敗: ' + cursor.currentJson.name + ' - ' + e.message);
      cursor.completedJsonIds.push(cursor.currentJson.fileId);
      cursor.currentJson = null;
      currentItems = null;
    }
  }

  while (!isTimeUp()) {
    // 次のJSONをロード
    if (!cursor.currentJson) {
      if (cursor.jsonQueue.length === 0) break;
      const job = cursor.jsonQueue.shift();
      let json;
      try {
        const file = DriveApp.getFileById(job.id);
        json = JSON.parse(file.getBlob().getDataAsString());
      } catch (e) {
        Logger.log('JSON読み込み失敗: ' + job.name + ' - ' + e.message);
        cursor.completedJsonIds.push(job.id);
        try { props.setProperty(META_DRIVE_CURSOR_KEY, JSON.stringify(cursor)); } catch (_) {}
        continue;
      }
      currentItems = extractMetaItems_(json);
      cursor.currentJson = {
        fileId: job.id,
        name: job.name,
        category: job.category,
        itemsCount: currentItems.length,   // items本体は保存しない（9KB制限対策）
        index: 0,
      };
    }

    // currentJson の items を処理（バッファに積む）
    const cur = cursor.currentJson;
    while (cur.index < cur.itemsCount && !isTimeUp()) {
      insertItemBuffered_(bufState, cur.category, currentItems[cur.index], mediaResolver, cursor.summary);
      cur.index++;
      // 200件処理ごとに flush + カーソル保存（書き込み確定 → 復帰しても整合）
      if (cur.index % 200 === 0) {
        flushAllBuffers_(bufState);
        try { props.setProperty(META_DRIVE_CURSOR_KEY, JSON.stringify(cursor)); } catch (e) {
          Logger.log('カーソル保存失敗（無視して続行）: ' + e.message);
        }
      }
    }

    if (cur.index >= cur.itemsCount) {
      flushAllBuffers_(bufState);  // JSON完了時に必ずflush
      cursor.completedJsonIds.push(cur.fileId);
      cursor.currentJson = null;
      currentItems = null;
    }
    try { props.setProperty(META_DRIVE_CURSOR_KEY, JSON.stringify(cursor)); } catch (e) {
      Logger.log('カーソル保存失敗（無視して続行）: ' + e.message);
    }
  }

  // 時間切れ/完了時に必ず flush（書き込み残しを確定）
  flushAllBuffers_(bufState);

  const done = cursor.jsonQueue.length === 0 && !cursor.currentJson;
  if (done) {
    props.deleteProperty(META_DRIVE_CURSOR_KEY);
  }

  const lines = [
    done ? '✅ Meta Drive取り込み完了' : '⏸ 5分時間制限で中断（続行ボタンで再開）',
    '',
    '📸 フィード追加: ' + cursor.summary.feed_added + '件',
    '🎬 リール追加: ' + cursor.summary.reels_added + '件',
    '📖 ストーリーズ追加: ' + cursor.summary.stories_added + '件',
    '🖼 画像保存: ' + cursor.summary.images_saved + '件',
    '⏭ 既存スキップ: ' + cursor.summary.skipped_existing + '件',
  ];
  if (cursor.summary.skipped_no_id > 0) lines.push('⚠️ ID欠損スキップ: ' + cursor.summary.skipped_no_id + '件');
  if (!done) {
    const remainingItems = cursor.currentJson ? ((cursor.currentJson.itemsCount || 0) - cursor.currentJson.index) : 0;
    lines.push('');
    lines.push('残JSON: ' + cursor.jsonQueue.length + 'ファイル / 現在JSON残: ' + remainingItems + '件');
  }
  const text = lines.join('\n');

  try { notifyDiscord(text, { kind: 'meta_drive_done', bypassCooldown: true }); } catch (_) {}

  return { ok: true, done: done, summary: text };
}

/**
 * Drive URL or フォルダID から フォルダID を抽出
 */
function extractDriveFolderId_(input) {
  if (!input) return '';
  input = String(input).trim();
  // URL パターン
  const m1 = input.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  if (m1) return m1[1];
  const m2 = input.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (m2) return m2[1];
  // 素のID
  if (/^[a-zA-Z0-9_-]{20,}$/.test(input)) return input;
  return '';
}

/**
 * payload から複数URLを解釈してフォルダIDの配列を返す
 * - folderUrls: 配列、改行区切り文字列、カンマ区切り文字列 のいずれか
 * - folderUrl: 後方互換用 単一URL
 */
function parseDriveFolderInput_(payload) {
  let raw = [];
  if (Array.isArray(payload.folderUrls)) {
    raw = payload.folderUrls;
  } else if (typeof payload.folderUrls === 'string') {
    raw = payload.folderUrls.split(/[\n,]+/);
  } else if (payload.folderUrl) {
    raw = [payload.folderUrl];
  }
  const ids = [];
  raw.map(s => String(s).trim()).filter(Boolean).forEach(url => {
    const id = extractDriveFolderId_(url);
    if (!id) throw new Error('DriveフォルダURL/IDを認識できません: ' + url);
    if (ids.indexOf(id) < 0) ids.push(id);  // 重複除去
  });
  return ids;
}

/**
 * フォルダ配下を再帰的に走査し、Meta content JSON を収集
 * 高速化: 大量の画像/動画ファイルが入るリーフフォルダ
 * （posts/reels/stories/archived_posts/recently_deleted/other）はサブツリーごとスキップ。
 * ※ "media" は Meta新フォーマットで `your_instagram_activity/media/posts_1.json` 等の
 *   コンテンツJSONを含むため、スキップしない（中のリーフだけスキップする）。
 * @return {Array<{id, name, category}>}
 */
function indexJsonFilesRecursive_(rootFolder) {
  const queue = [];
  const SKIP_SUBFOLDERS = new Set(['posts', 'reels', 'stories', 'archived_posts', 'recently_deleted', 'other']);
  walk(rootFolder, '');
  return queue;

  function walk(folder, path) {
    const files = folder.getFiles();
    while (files.hasNext()) {
      const f = files.next();
      const name = f.getName();
      if (!name.toLowerCase().endsWith('.json')) continue;
      const lower = name.toLowerCase();
      let category = null;
      if (lower.indexOf('posts_') >= 0 || lower === 'posts.json') category = 'feed';
      else if (lower.indexOf('reels.json') >= 0 || lower === 'reels.json') category = 'reel';
      else if (lower.indexOf('stories.json') >= 0 || lower === 'stories.json') category = 'story';
      if (!category) continue;
      queue.push({ id: f.getId(), name: path + name, category: category });
    }
    const subs = folder.getFolders();
    while (subs.hasNext()) {
      const sub = subs.next();
      const sName = sub.getName().toLowerCase();
      if (SKIP_SUBFOLDERS.has(sName)) continue;  // 画像格納フォルダはスキップ
      walk(sub, path + sub.getName() + '/');
    }
  }
}

/**
 * 複数 rootFolders を再帰走査して content JSON を集約
 */
function indexJsonFilesRecursiveMulti_(rootFolders) {
  const all = [];
  rootFolders.forEach((root, idx) => {
    const items = indexJsonFilesRecursive_(root);
    items.forEach(it => {
      it.rootIndex = idx;
      it.rootName = root.getName();
      all.push(it);
    });
  });
  return all;
}

/**
 * Drive API v3 でフォルダ配下を bfs リスト → ファイル名 → fileId Map を構築
 * パスマッチングの不確実性を回避し、ファイル名（basename）で一意検索する。
 * Meta export は基本ファイル名（FB Graph media ID + 拡張子）が大域一意なため、basename だけで衝突しない。
 *
 * 速度: DriveApp の再帰では数千件で数分かかるが、Drive API v3 の files.list（pageSize=1000）なら数十API呼び出しで完了。
 */
function buildMediaFilenameIndex_(rootFolders) {
  const index = {};
  const folderQueue = rootFolders.map(f => f.getId());
  while (folderQueue.length > 0) {
    const folderId = folderQueue.shift();
    const children = listFolderChildrenViaApi_(folderId);
    for (const child of children) {
      if (child.mimeType === 'application/vnd.google-apps.folder') {
        folderQueue.push(child.id);
      } else {
        if (child.name === '.DS_Store') continue;
        if (!index[child.name]) index[child.name] = child.id;
      }
    }
  }
  return index;
}

function listFolderChildrenViaApi_(folderId) {
  let all = [];
  let pageToken = null;
  do {
    const q = encodeURIComponent("'" + folderId + "' in parents and trashed = false");
    const fields = encodeURIComponent('files(id,name,mimeType),nextPageToken');
    let url = 'https://www.googleapis.com/drive/v3/files?q=' + q + '&fields=' + fields + '&pageSize=1000';
    if (pageToken) url += '&pageToken=' + encodeURIComponent(pageToken);
    const res = UrlFetchApp.fetch(url, {
      headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
      muteHttpExceptions: true,
    });
    const code = res.getResponseCode();
    if (code !== 200) {
      Logger.log('Drive API list失敗 ' + code + ': ' + res.getContentText().slice(0, 200));
      break;
    }
    const data = JSON.parse(res.getContentText());
    if (data.files) all = all.concat(data.files);
    pageToken = data.nextPageToken;
  } while (pageToken);
  return all;
}

/**
 * ファイル名（basename）で Drive 画像を引くリゾルバ（Blob返し・旧API）
 */
function makeFilenameMediaResolver_(filenameIndex) {
  return function(uri) {
    if (!uri) return null;
    const basename = uri.split('/').pop();
    const fileId = filenameIndex[basename];
    if (!fileId) return null;
    try { return DriveApp.getFileById(fileId).getBlob(); } catch (_) { return null; }
  };
}

/**
 * ファイル名から Drive thumbnail URL を直接返すリゾルバ
 * Driveコピーや setSharing を行わず、超高速。
 * 注: スプシ閲覧者は元ファイルへのアクセス権が必要（オーナー視点なら問題なし）。
 */
function makeFilenameImageUrlResolver_(filenameIndex) {
  return function(uri) {
    if (!uri) return '';
    const basename = uri.split('/').pop();
    const fileId = filenameIndex[basename];
    if (!fileId) return '';
    return 'https://drive.google.com/thumbnail?id=' + fileId + '&sz=w400';
  };
}

/**
 * 複数 rootFolders に対応した メディア lazy リゾルバ（旧path方式・後方互換）
 * URI 解釈バリアント:
 *  - URI そのまま
 *  - 先頭 'your_instagram_activity/' を strip
 *  - 先頭に 'your_instagram_activity/' を付与
 *  - URI先頭セグメントが root フォルダ名と一致するなら strip（例: rootが"media"でURI"media/posts/x"→"posts/x"）
 * すべての root に対して各バリアントを試す
 */
function makeDriveMediaResolverMulti_(rootFolders) {
  const caches = rootFolders.map(root => ({
    root: root,
    rootName: root.getName(),
    folderCache: { '': root }
  }));

  function getFolderByPath(cache, path) {
    if (cache.folderCache.hasOwnProperty(path)) return cache.folderCache[path];
    const parts = path.split('/').filter(Boolean);
    let cur = cache.root;
    for (const part of parts) {
      const it = cur.getFoldersByName(part);
      if (!it.hasNext()) { cache.folderCache[path] = null; return null; }
      cur = it.next();
    }
    cache.folderCache[path] = cur;
    return cur;
  }

  function tryFindInCache(cache, path) {
    const slashIdx = path.lastIndexOf('/');
    const folderPath = slashIdx >= 0 ? path.substring(0, slashIdx) : '';
    const fileName = slashIdx >= 0 ? path.substring(slashIdx + 1) : path;
    const folder = getFolderByPath(cache, folderPath);
    if (!folder) return null;
    const files = folder.getFilesByName(fileName);
    if (!files.hasNext()) return null;
    try { return files.next().getBlob(); } catch (_) { return null; }
  }

  function pathVariants(uri, rootName) {
    const variants = [uri];
    const STRIP = 'your_instagram_activity/';
    if (uri.indexOf(STRIP) === 0) variants.push(uri.substring(STRIP.length));
    variants.push(STRIP + uri);
    // root名先頭一致 strip（rootが標準media/などの場合）
    if (rootName) {
      const prefix = rootName + '/';
      if (uri.indexOf(prefix) === 0) variants.push(uri.substring(prefix.length));
    }
    return variants;
  }

  return function(uri) {
    if (!uri) return null;
    for (const cache of caches) {
      const variants = pathVariants(uri, cache.rootName);
      for (const v of variants) {
        const blob = tryFindInCache(cache, v);
        if (blob) return blob;
      }
    }
    return null;
  };
}

// 旧API（単一フォルダ）後方互換用ラッパー
function makeDriveMediaResolver_(rootFolder) {
  return makeDriveMediaResolverMulti_([rootFolder]);
}

/**
 * バッチI/O用の状態を生成
 * 各カテゴリの履歴シート + メインストーリーズシートのバッファを管理。
 * 1セル setValue ではなく setValues で一括書き込みする。
 */
function createMetaDriveBufferState_(ss) {
  return {
    ss: ss,
    buffers: {},                // category(feed/reel/story) -> {sheet, idMap, colMap, lastCol, rows: []}
    storiesMain: null,          // 📖 ストーリーズ メインシート用バッファ
  };
}

/**
 * Meta取り込みに必要な列（キャプション/画像URL/source）が
 * 各履歴シートに存在することを保証。無ければ末尾に追加。
 * 既存データに影響なし。
 */
function ensureMetaHistoryColumns_(ss) {
  const targets = ['📸 フィード履歴', '🎬 リール履歴', '📖 ストーリーズ履歴'];
  const required = ['キャプション', '画像URL', 'source'];
  targets.forEach(name => {
    const sheet = ss.getSheetByName(name);
    if (!sheet) return;
    const lastCol = sheet.getLastColumn();
    if (lastCol === 0) return;
    const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(h => String(h).trim());
    required.forEach(col => {
      if (headers.indexOf(col) >= 0) return;
      const newCol = sheet.getLastColumn() + 1;
      sheet.getRange(1, newCol).setValue(col)
        .setFontWeight('bold').setBackground('#1565C0').setFontColor('#FFFFFF');
      if (col === '画像URL') sheet.setColumnWidth(newCol, 240);
      else if (col === 'キャプション') sheet.setColumnWidth(newCol, 360);
      else sheet.setColumnWidth(newCol, 100);
    });
  });
}

function _initCategoryBuffer_(bufState, category) {
  if (bufState.buffers[category]) return bufState.buffers[category];
  const sheetName = category === 'feed' ? '📸 フィード履歴' : (category === 'reel' ? '🎬 リール履歴' : '📖 ストーリーズ履歴');
  const sheet = bufState.ss.getSheetByName(sheetName) || getOrCreateSheet(sheetName);
  const lastCol = sheet.getLastColumn() || 1;
  // ヘッダーから列マップを構築
  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  const colMap = {};
  headers.forEach((h, i) => { if (h) colMap[String(h).trim()] = i + 1; });

  // 既存IDをMapで保持: fakeId → { row: 行番号, hasImage: 画像URL有り? }
  const idMap = new Map();
  const idColIdx = colMap['メディアID'] || findColumn_(sheet, 'メディアID') || 2;
  const urlColIdx = colMap['画像URL'] || findColumn_(sheet, '画像URL') || 0;
  // 画像URL列のメモリキャッシュ（バッチ更新用）
  let urlColumn = null;
  if (sheet.getLastRow() >= 2) {
    const ids = sheet.getRange(2, idColIdx, sheet.getLastRow() - 1, 1).getValues();
    if (urlColIdx > 0) {
      urlColumn = sheet.getRange(2, urlColIdx, sheet.getLastRow() - 1, 1).getValues();
    }
    for (let i = 0; i < ids.length; i++) {
      const id = String(ids[i][0] || '');
      if (!id) continue;
      const hasImage = urlColumn ? !!String(urlColumn[i][0] || '').trim() : false;
      idMap.set(id, { row: i + 2, hasImage: hasImage, urlIdx: i });
    }
  }

  const buf = {
    sheet: sheet,
    idMap: idMap,
    colMap: colMap,
    lastCol: lastCol,
    urlColIdx: urlColIdx,
    urlColumn: urlColumn,
    urlColumnDirty: false,
    rows: [],
  };
  bufState.buffers[category] = buf;
  return buf;
}

function _initStoriesMainBuffer_(bufState) {
  if (bufState.storiesMain) return bufState.storiesMain;
  let sheet = bufState.ss.getSheetByName('📖 ストーリーズ');
  if (!sheet) {
    sheet = bufState.ss.insertSheet('📖 ストーリーズ');
    setupStoriesHeader(sheet);
  }
  if (sheet.getLastRow() === 0) setupStoriesHeader(sheet);
  const lastCol = sheet.getLastColumn() || 1;
  // 既存ID（J列=10列目相当）と既存日時を Set/Array にキャッシュ
  const idSet = new Set();
  const timestamps = [];  // {ts:number, row:number}
  let ocrCol = 0;
  try { ocrCol = ensureStoriesOcrColumn_(sheet); } catch (_) {}
  if (sheet.getLastRow() >= 2) {
    const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, Math.min(10, lastCol)).getValues();
    data.forEach((r, i) => {
      const id = String(r[9] || '');
      if (id) idSet.add(id);
      const ts = r[0];
      if (ts instanceof Date) timestamps.push(ts.getTime());
    });
  }
  bufState.storiesMain = {
    sheet: sheet,
    idSet: idSet,
    timestamps: timestamps,
    rows: [],          // [{rowArr, caption}]
    ocrCol: ocrCol,
  };
  return bufState.storiesMain;
}

function flushBuffer_(bufState, category) {
  const buf = bufState.buffers[category];
  if (!buf) return;
  // 新規行を append
  if (buf.rows.length > 0) {
    const startRow = buf.sheet.getLastRow() + 1;
    buf.sheet.getRange(startRow, 1, buf.rows.length, buf.lastCol).setValues(buf.rows);
    buf.rows = [];
  }
  // 既存行の画像URL更新（バッチ書き戻し）
  if (buf.urlColumnDirty && buf.urlColumn && buf.urlColIdx > 0) {
    buf.sheet.getRange(2, buf.urlColIdx, buf.urlColumn.length, 1).setValues(buf.urlColumn);
    buf.urlColumnDirty = false;
  }
}

function flushStoriesMainBuffer_(bufState) {
  const buf = bufState.storiesMain;
  if (!buf || buf.rows.length === 0) return;
  const startRow = buf.sheet.getLastRow() + 1;
  // メインシートは10列固定（日時/サムネ/タイプ/メトリクス6列/メディアID）
  const matrix = buf.rows.map(r => r.rowArr);
  buf.sheet.getRange(startRow, 1, matrix.length, 10).setValues(matrix);
  // OCR列（キャプション）を別途書き込み（任意・あれば）
  if (buf.ocrCol > 0) {
    const captions = buf.rows.map(r => [r.caption || '']);
    buf.sheet.getRange(startRow, buf.ocrCol, captions.length, 1).setValues(captions);
  }
  buf.rows = [];
}

function flushAllBuffers_(bufState) {
  flushBuffer_(bufState, 'feed');
  flushBuffer_(bufState, 'reel');
  flushBuffer_(bufState, 'story');
  flushStoriesMainBuffer_(bufState);
}

/**
 * バッチI/O版の Meta item 挿入
 * - 既存ID は Set でO(1)チェック
 * - 行データは buffer に積んで 100件まとめて setValues
 * - 同一実行内の重複も idSet で除外
 */
function insertItemBuffered_(bufState, category, item, mediaResolver, summary) {
  const mediaArr = Array.isArray(item.media) ? item.media : (item.uri ? [item] : []);
  if (mediaArr.length === 0) { summary.skipped_no_id++; return; }

  const ts = item.creation_timestamp || (mediaArr[0] && mediaArr[0].creation_timestamp);
  const caption = decodeMojibake_(
    (item.title || (mediaArr[0] && mediaArr[0].title) || '') + ''
  );

  const fakeIdBase = 'meta_' + (ts || 'unknown') + '_';
  const firstUri = mediaArr[0].uri || '';
  const fakeId = fakeIdBase + simpleHash_(firstUri).toString(36);

  const buf = _initCategoryBuffer_(bufState, category);
  const existing = buf.idMap.get(fakeId);

  // mediaResolver は URL を返す（空文字 or thumbnail URL）
  const imageUrl = firstUri ? mediaResolver(firstUri) : '';

  // 既存行: 画像URLが空なら埋めて返す
  if (existing) {
    summary.skipped_existing++;
    if (!existing.hasImage && buf.urlColIdx > 0 && imageUrl) {
      if (buf.urlColumn && existing.urlIdx >= 0) {
        buf.urlColumn[existing.urlIdx][0] = imageUrl;
        buf.urlColumnDirty = true;
        existing.hasImage = true;
        summary.images_saved++;
      }
    }
    return;
  }
  buf.idMap.set(fakeId, { row: -1, hasImage: false, urlIdx: -1 });  // 同一実行内の重複防止

  // 新規行: 画像URL（コピーせず元ファイルのthumbnail URLを使う）
  const savedImageUrl = imageUrl;
  if (savedImageUrl) summary.images_saved++;

  const tsDate = ts ? new Date(Number(ts) * 1000) : '';
  // 行データを構築
  const row = new Array(buf.lastCol).fill('');
  const setCol = (col, val) => { const c = buf.colMap[col]; if (c) row[c - 1] = val; };
  setCol('投稿日時', tsDate);
  setCol('メディアID', fakeId);
  setCol('取得時刻', new Date());
  setCol('キャプション', caption);
  setCol('画像URL', savedImageUrl);
  setCol('source', 'meta_drive');
  buf.rows.push(row);

  // バッファ満タンで自動flush（カテゴリ単位）
  if (buf.rows.length >= 100) flushBuffer_(bufState, category);

  if (category === 'feed') summary.feed_added++;
  else if (category === 'reel') summary.reels_added++;
  else {
    summary.stories_added++;
    addStoryToMainBuffer_(bufState, tsDate, fakeId, caption, savedImageUrl, mediaArr[0]);
  }
}

/**
 * ストーリーズメインシート（履歴シートとは別の運用集計シート）用のバッファ追加
 * 既存ID重複 / 90秒以内タイムスタンプ重複は除外
 */
function addStoryToMainBuffer_(bufState, tsDate, fakeId, caption, imageUrl, firstMedia) {
  const buf = _initStoriesMainBuffer_(bufState);
  if (buf.idSet.has(fakeId)) return;
  const tsMs = (tsDate instanceof Date) ? tsDate.getTime() : null;
  if (tsMs !== null) {
    for (let i = 0; i < buf.timestamps.length; i++) {
      if (Math.abs(buf.timestamps[i] - tsMs) < 90000) return;
    }
    buf.timestamps.push(tsMs);
  }
  buf.idSet.add(fakeId);

  const uri = (firstMedia && firstMedia.uri) || '';
  const isVideo = /\.(mp4|mov)$/i.test(uri);
  const mediaType = isVideo ? 'VIDEO' : 'IMAGE';
  const thumbFormula = imageUrl ? '=IMAGE("' + imageUrl.replace(/"/g, '') + '")' : '';

  const rowArr = [
    tsDate, thumbFormula, mediaType,
    '', '', '', '', '', '',   // メトリクス空欄（CSVで後埋め）
    fakeId
  ];
  buf.rows.push({ rowArr: rowArr, caption: caption });

  if (buf.rows.length >= 100) flushStoriesMainBuffer_(bufState);
}

/**
 * insertMetaItem_ の Drive版（mediaMap の代わりに resolver関数を受け取る）
 * 既存 insertMetaItem_ と挙動同等。media 解決のみ遅延化。
 * @deprecated 大量データには insertItemBuffered_ を使うこと（バッチI/O）
 */
function insertMetaItemDrive_(ss, category, item, mediaResolver, summary) {
  const mediaArr = Array.isArray(item.media) ? item.media : (item.uri ? [item] : []);
  if (mediaArr.length === 0) { summary.skipped_no_id++; return; }

  const ts = item.creation_timestamp || (mediaArr[0] && mediaArr[0].creation_timestamp);
  const caption = decodeMojibake_(
    (item.title || (mediaArr[0] && mediaArr[0].title) || '') + ''
  );

  const fakeIdBase = 'meta_' + (ts || 'unknown') + '_';
  const firstUri = mediaArr[0].uri || '';
  const fakeId = fakeIdBase + simpleHash_(firstUri).toString(36);

  const sheetName = category === 'feed' ? '📸 フィード履歴' : (category === 'reel' ? '🎬 リール履歴' : '📖 ストーリーズ履歴');
  const sheet = ss.getSheetByName(sheetName) || getOrCreateSheet(sheetName);

  const idCol = findColumn_(sheet, 'メディアID') || 2;
  if (sheet.getLastRow() >= 2) {
    const ids = sheet.getRange(2, idCol, sheet.getLastRow() - 1, 1).getValues().flat().map(String);
    if (ids.indexOf(fakeId) >= 0) { summary.skipped_existing++; return; }
  }

  const driveFolderId = getConfig('DRIVE_FOLDER_ID');
  let savedImageUrl = '';
  if (driveFolderId && mediaArr[0].uri) {
    const blob = mediaResolver(mediaArr[0].uri);
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
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const colMap = {};
  headers.forEach((h, i) => { if (h) colMap[String(h).trim()] = i + 1; });
  const setCell = (col, val) => { if (colMap[col]) sheet.getRange(row, colMap[col]).setValue(val); };

  setCell('投稿日時', tsDate);
  setCell('メディアID', fakeId);
  setCell('取得時刻', new Date());
  setCell('キャプション', caption);
  setCell('画像URL', savedImageUrl);
  setCell('source', 'meta_drive');

  if (category === 'feed') summary.feed_added++;
  else if (category === 'reel') summary.reels_added++;
  else {
    summary.stories_added++;
    insertMetaStoryToMainSheet_(ss, tsDate, fakeId, caption, savedImageUrl, mediaArr[0]);
  }
}

/**
 * 診断用: 深さ制限つきで folder ツリーをダンプ
 */
function dumpDriveTreeDiag_(folder, prefix, lines, depth) {
  if (depth <= 0) { lines.push(prefix + '...(省略)'); return; }
  try {
    const subs = folder.getFolders();
    let sc = 0;
    while (subs.hasNext() && sc < 15) {
      const sub = subs.next();
      lines.push(prefix + '📁 ' + sub.getName());
      // メディア系の大量フォルダは深堀しない
      const sName = sub.getName().toLowerCase();
      if (['posts','reels','stories','archived_posts','recently_deleted','other'].indexOf(sName) >= 0) {
        lines.push(prefix + '  ...(メディアフォルダなので省略)');
      } else {
        dumpDriveTreeDiag_(sub, prefix + '  ', lines, depth - 1);
      }
      sc++;
    }
  } catch (e) {
    lines.push(prefix + '⚠️ subfolders エラー: ' + e.message);
  }
}

/**
 * 診断用: フォルダ配下を再帰で全 .json ファイルを検索（メディア系フォルダは飛ばす）
 */
function listAllJsonFilesInFolder_(rootFolder, maxResults) {
  const found = [];
  walk(rootFolder, '', 0);
  return found;
  function walk(folder, path, depth) {
    if (depth > 6) return;
    if (found.length >= maxResults) return;
    try {
      const files = folder.getFiles();
      while (files.hasNext() && found.length < maxResults) {
        const f = files.next();
        if (f.getName().toLowerCase().endsWith('.json')) found.push(path + f.getName());
      }
      const subs = folder.getFolders();
      while (subs.hasNext() && found.length < maxResults) {
        const sub = subs.next();
        const sName = sub.getName().toLowerCase();
        if (['posts','reels','stories','archived_posts','recently_deleted','other'].indexOf(sName) >= 0) continue;
        walk(sub, path + sub.getName() + '/', depth + 1);
      }
    } catch (_) {}
  }
}

/**
 * デバッグ: media 配下の実際のフォルダ構造を覗く
 * （取り込み時の検索フォルダ media/posts/<年月>/ の中身が本当に存在するか確認）
 */
function debugMetaDriveMediaTree() {
  const ui = SpreadsheetApp.getUi();
  const res = ui.prompt('media構造ダンプ', 'mediaフォルダのURL（standaloneのほう）またはmediaを含むrootのURL', ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() !== ui.Button.OK) return;
  const id = extractDriveFolderId_(res.getResponseText());
  if (!id) { ui.alert('URLが不正'); return; }
  const root = DriveApp.getFolderById(id);

  const lines = ['【media構造ダンプ】 root=' + root.getName()];
  walk(root, '', 0);

  Logger.log(lines.join('\n'));
  ui.alert('media構造ダンプ', lines.join('\n').slice(0, 4500), ui.ButtonSet.OK);

  function walk(folder, path, depth) {
    if (depth > 3) return;
    const subs = folder.getFolders();
    let scount = 0;
    while (subs.hasNext() && scount < 10) {
      const sub = subs.next();
      lines.push(path + '📁 ' + sub.getName());
      walk(sub, path + '  ', depth + 1);
      scount++;
    }
    // 各フォルダで最初の3ファイルを表示
    const files = folder.getFiles();
    let fcount = 0;
    while (files.hasNext() && fcount < 3) {
      lines.push(path + '📄 ' + files.next().getName());
      fcount++;
    }
  }
}

/**
 * デバッグ: 取り込み済みフォルダの JSON から最初の3件のメディアURIをサンプル取得し、
 * リゾルバが実際にDriveから画像を見つけられるかをテスト表示する
 * メニュー「🔍 画像URI解決テスト」から呼ぶ
 */
function debugMetaDriveUriResolution() {
  const ui = SpreadsheetApp.getUi();
  const res = ui.prompt('画像URI解決テスト', 'DriveフォルダURLを改行区切りで貼り付け（最後の取り込みと同じやつ）', ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() !== ui.Button.OK) return;
  const text = res.getResponseText();
  const urls = text.split(/[\n,]+/).map(s => s.trim()).filter(Boolean);
  if (urls.length === 0) { ui.alert('URLが空です'); return; }

  const folderIds = urls.map(u => extractDriveFolderId_(u));
  const rootFolders = folderIds.map(id => DriveApp.getFolderById(id));
  const mediaResolver = makeDriveMediaResolverMulti_(rootFolders);
  const jsonQueue = indexJsonFilesRecursiveMulti_(rootFolders);
  if (jsonQueue.length === 0) { ui.alert('JSONが見つかりません'); return; }

  const lines = ['【URI解決テスト】'];
  const SAMPLES_PER_JSON = 3;

  jsonQueue.forEach(job => {
    lines.push('');
    lines.push('📄 ' + job.name + ' (' + job.category + ')');
    try {
      const file = DriveApp.getFileById(job.id);
      const json = JSON.parse(file.getBlob().getDataAsString());
      const items = extractMetaItems_(json);
      const sampleN = Math.min(SAMPLES_PER_JSON, items.length);
      lines.push('  items総数: ' + items.length + ' / サンプル: ' + sampleN + '件');

      for (let i = 0; i < sampleN; i++) {
        const item = items[i];
        const mediaArr = Array.isArray(item.media) ? item.media : (item.uri ? [item] : []);
        if (mediaArr.length === 0) {
          lines.push('  [' + i + '] media空（スキップ）');
          continue;
        }
        const uri = mediaArr[0].uri || '(URI空)';
        lines.push('  [' + i + '] URI: ' + uri);

        // バリアントごとに試して結果記録
        const root = rootFolders[0];   // 最初のroot基準
        const STRIP = 'your_instagram_activity/';
        const variants = [uri];
        if (uri.indexOf(STRIP) === 0) variants.push(uri.substring(STRIP.length));
        variants.push(STRIP + uri);
        if (root && uri.indexOf(root.getName() + '/') === 0) variants.push(uri.substring(root.getName().length + 1));

        variants.forEach(v => {
          lines.push('    試行: ' + v);
        });

        // 実リゾルバで blob 解決を試みる
        const blob = mediaResolver(uri);
        lines.push('    → 結果: ' + (blob ? '✅ 解決(' + blob.getContentType() + ', ' + blob.getBytes().length + ' bytes)' : '❌ 未解決'));
      }
    } catch (e) {
      lines.push('  ⚠️ エラー: ' + e.message);
    }
  });

  // 長いので Logger とアラート両方
  const text2 = lines.join('\n');
  Logger.log(text2);
  ui.alert('URI解決テスト結果（コンソールにも全文）', text2.slice(0, 4500), ui.ButtonSet.OK);
}

/**
 * Meta export経由で既存履歴行に画像URL+キャプションを付与
 * 過去のautoFetch行（source≠meta_drive, 画像URL空）を、Drive内のMeta exportから補完する。
 *
 * 仕組み:
 *  1. Driveの media/ 配下を ファイル名→fileId で索引化
 *  2. Meta export JSON から 実メディアID（ファイル名の数字部分）→キャプション マップを構築
 *  3. 履歴シートを走査して、メディアID で照合し、画像URLとキャプションを埋める
 *
 * 利点: Graph API不使用 → 削除済み投稿も復元可能、レート制限なし、数分で完了
 */
function openBindFromMetaExportDialog() {
  const ui = SpreadsheetApp.getUi();
  const res = ui.prompt(
    'Meta export経由で履歴行に画像URL付与',
    '同じMeta export（zip展開後の）DriveフォルダURLを改行区切りで貼り付け\n' +
    '（先のMeta公式データ取り込みで使ったURLと同じものを再入力）',
    ui.ButtonSet.OK_CANCEL
  );
  if (res.getSelectedButton() !== ui.Button.OK) return;
  bindFromMetaExport_(res.getResponseText());
}

function bindFromMetaExport_(urlsText) {
  const ui = SpreadsheetApp.getUi();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  ensureMetaHistoryColumns_(ss);

  const urls = (urlsText || '').split(/[\n,]+/).map(s => s.trim()).filter(Boolean);
  if (urls.length === 0) { ui.alert('URLが空です'); return; }
  const folderIds = urls.map(u => extractDriveFolderId_(u)).filter(Boolean);
  if (folderIds.length === 0) { ui.alert('有効なフォルダIDがありません'); return; }

  const rootFolders = folderIds.map(id => DriveApp.getFolderById(id));

  // 1. filenameIndex 構築（Drive API高速版）
  Logger.log('filenameIndex 構築中...');
  const filenameIndex = buildMediaFilenameIndex_(rootFolders);
  Logger.log('filenameIndex: ' + Object.keys(filenameIndex).length + ' ファイル');

  // 2. JSON 走査 → 投稿日時(unix秒) → {fileId, caption} マップ
  //    autoFetchとMeta exportでID体系が違うので、投稿日時を結合キーに使う
  Logger.log('timestampMap 構築中...');
  const jsonQueue = indexJsonFilesRecursiveMulti_(rootFolders);
  const tsMap = {};   // tsSec → { fileId, caption }
  let tsMapHits = 0;
  jsonQueue.forEach(job => {
    try {
      const file = DriveApp.getFileById(job.id);
      const json = JSON.parse(file.getBlob().getDataAsString());
      const items = extractMetaItems_(json);
      items.forEach(item => {
        const mediaArr = Array.isArray(item.media) ? item.media : (item.uri ? [item] : []);
        if (mediaArr.length === 0) return;
        const ts = item.creation_timestamp || (mediaArr[0] && mediaArr[0].creation_timestamp);
        if (!ts) return;
        const uri = mediaArr[0].uri || '';
        const basename = uri.split('/').pop();
        const fileId = filenameIndex[basename];
        if (!fileId) return;
        const cap = decodeMojibake_((item.title || (mediaArr[0] && mediaArr[0].title) || '') + '');
        const key = Number(ts);
        if (!tsMap[key]) {
          tsMap[key] = { fileId: fileId, caption: cap };
          tsMapHits++;
        }
      });
    } catch (e) {
      Logger.log('JSON読み込みエラー: ' + job.name + ' - ' + e.message);
    }
  });
  Logger.log('tsMap: ' + tsMapHits + 'エントリ');

  // 3. 履歴シート走査（投稿日時で照合）
  const targets = ['📸 フィード履歴', '🎬 リール履歴', '📖 ストーリーズ履歴'];
  const summary = { total: 0, filled_url: 0, filled_caption: 0, no_match: 0, already_filled: 0 };

  targets.forEach(name => {
    const sheet = ss.getSheetByName(name);
    if (!sheet) return;
    const lastCol = sheet.getLastColumn();
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) return;

    const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(h => String(h).trim());
    const tsCol = headers.indexOf('投稿日時') + 1;
    const urlCol = headers.indexOf('画像URL') + 1;
    const captionCol = headers.indexOf('キャプション') + 1;
    const sourceCol = headers.indexOf('source') + 1;
    if (tsCol === 0 || urlCol === 0) return;

    const data = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
    const newUrl = data.map(r => [r[urlCol - 1]]);
    const newCap = captionCol > 0 ? data.map(r => [r[captionCol - 1]]) : null;
    let modified = false;

    for (let i = 0; i < data.length; i++) {
      summary.total++;
      const tsVal = data[i][tsCol - 1];
      const existingUrl = String(data[i][urlCol - 1] || '').trim();
      const source = sourceCol > 0 ? String(data[i][sourceCol - 1] || '') : '';

      if (source === 'meta_drive') continue;
      if (existingUrl) { summary.already_filled++; continue; }

      let tsMs = null;
      if (tsVal instanceof Date) tsMs = tsVal.getTime();
      else if (tsVal) {
        const d = new Date(tsVal);
        if (!isNaN(d.getTime())) tsMs = d.getTime();
      }
      if (!tsMs) { summary.no_match++; continue; }
      const tsSec = Math.floor(tsMs / 1000);

      // ±5秒で照合（autoFetchの分単位丸めなどに対応）
      let hit = null;
      for (let delta = 0; delta <= 5 && !hit; delta++) {
        if (tsMap[tsSec + delta]) hit = tsMap[tsSec + delta];
        else if (delta > 0 && tsMap[tsSec - delta]) hit = tsMap[tsSec - delta];
      }
      if (!hit) {
        // 分単位丸めされている可能性（autoFetchが秒を捨てた等）→ 最大60秒まで広げて再試行
        for (let delta = 6; delta <= 60 && !hit; delta++) {
          if (tsMap[tsSec + delta]) hit = tsMap[tsSec + delta];
          else if (tsMap[tsSec - delta]) hit = tsMap[tsSec - delta];
        }
      }
      if (!hit) { summary.no_match++; continue; }

      newUrl[i][0] = 'https://drive.google.com/thumbnail?id=' + hit.fileId + '&sz=w400';
      summary.filled_url++;
      if (newCap && hit.caption && !String(data[i][captionCol - 1] || '').trim()) {
        newCap[i][0] = hit.caption;
        summary.filled_caption++;
      }
      modified = true;
    }

    if (modified) {
      sheet.getRange(2, urlCol, newUrl.length, 1).setValues(newUrl);
      if (newCap) sheet.getRange(2, captionCol, newCap.length, 1).setValues(newCap);
    }
  });

  ui.alert(
    '✅ Meta export経由（投稿日時照合）画像URL付与 完了\n\n' +
    '走査行数: ' + summary.total + '\n' +
    '画像URL付与: ' + summary.filled_url + '件\n' +
    'キャプション付与: ' + summary.filled_caption + '件\n' +
    '既に入っていた: ' + summary.already_filled + '件\n' +
    'マッチなし: ' + summary.no_match + '件\n' +
    '（マッチなし = Meta export範囲外の投稿 or 投稿日時情報なし）'
  );
}

/**
 * 既存行への画像URL一括付与（Graph API版・劣化版）
 * Meta export経由版を使ってください。これは Meta export を持たないユーザー向けの代替。
 * 履歴シートで画像URLが空の autoFetch行に対して、
 * Instagram Graph API から media_url/thumbnail_url を再取得 → Drive保存 → 画像URL列に書き込み
 *
 * - Graph APIレート制限を意識: 1件ごとに sleep。5分制限内で処理。
 * - カーソル方式で複数回続行可。
 * - source列が「meta_drive」の行はスキップ（既に処理済み）。
 */
const BIND_AUTOFETCH_CURSOR_KEY = 'BIND_AUTOFETCH_CURSOR';
const BIND_TIME_LIMIT_MS = 5 * 60 * 1000;

function openBindAutoFetchImagesDialog() {
  const ui = SpreadsheetApp.getUi();
  const res = ui.alert(
    '既存行への画像URL付与',
    'autoFetchで取り込んだ過去の履歴行のうち、画像URLが空のものを埋めます。\n\n' +
    '・対象: 各履歴シートで source≠meta_drive かつ 画像URL空の行\n' +
    '・処理: Instagram Graph APIから画像URL再取得→Drive保存→列更新\n' +
    '・5分で中断したら再実行で続きから処理\n\n実行しますか？',
    ui.ButtonSet.YES_NO
  );
  if (res !== ui.Button.YES) return;
  bindAutoFetchImagesRun_();
}

function bindAutoFetchImagesRun_() {
  const ui = SpreadsheetApp.getUi();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  ensureMetaHistoryColumns_(ss);

  const props = PropertiesService.getScriptProperties();
  const cursorStr = props.getProperty(BIND_AUTOFETCH_CURSOR_KEY);
  let cursor = cursorStr ? JSON.parse(cursorStr) : null;

  if (!cursor) {
    cursor = {
      currentSheetIdx: 0,
      currentRowIdx: 0,
      summary: { processed: 0, saved: 0, skipped_no_url: 0, errors: 0 },
    };
  }

  const targets = [
    { sheet: ss.getSheetByName('📸 フィード履歴'), subfolder: 'feed', mediaType: 'IMAGE' },
    { sheet: ss.getSheetByName('🎬 リール履歴'), subfolder: 'reels', mediaType: 'REELS' },
    { sheet: ss.getSheetByName('📖 ストーリーズ履歴'), subfolder: 'stories', mediaType: 'STORY' },
  ];

  const startMs = Date.now();
  const isTimeUp = () => (Date.now() - startMs) > BIND_TIME_LIMIT_MS;

  while (cursor.currentSheetIdx < targets.length) {
    if (isTimeUp()) break;
    const target = targets[cursor.currentSheetIdx];
    if (!target.sheet) { cursor.currentSheetIdx++; cursor.currentRowIdx = 0; continue; }

    const sheet = target.sheet;
    const lastCol = sheet.getLastColumn();
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) { cursor.currentSheetIdx++; cursor.currentRowIdx = 0; continue; }

    const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(h => String(h).trim());
    const idCol = headers.indexOf('メディアID') + 1;
    const urlCol = headers.indexOf('画像URL') + 1;
    const captionCol = headers.indexOf('キャプション') + 1;
    const sourceCol = headers.indexOf('source') + 1;

    if (idCol === 0 || urlCol === 0) {
      cursor.currentSheetIdx++; cursor.currentRowIdx = 0; continue;
    }

    // 必要列を一括ロード
    const data = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();

    while (cursor.currentRowIdx < data.length) {
      if (isTimeUp()) break;
      const row = data[cursor.currentRowIdx];
      const id = String(row[idCol - 1] || '');
      const existingUrl = String(row[urlCol - 1] || '').trim();
      const source = sourceCol > 0 ? String(row[sourceCol - 1] || '') : '';
      cursor.currentRowIdx++;
      cursor.summary.processed++;

      if (!id) continue;
      if (existingUrl) continue;
      if (source === 'meta_drive') continue;

      // Graph API で media 情報取得
      try {
        const url = `${IG_API_BASE}/${id}?fields=media_url,thumbnail_url,media_type,timestamp,caption`;
        const token = getConfig('IG_ACCESS_TOKEN');
        const res = UrlFetchApp.fetch(url + '&access_token=' + token, { muteHttpExceptions: true });
        const code = res.getResponseCode();
        if (code !== 200) {
          cursor.summary.skipped_no_url++;
          if (code === 400) Logger.log('Graph API 400 (削除済み投稿?): ' + id);
          continue;
        }
        const d = JSON.parse(res.getContentText());
        if (d.error) { cursor.summary.errors++; continue; }
        const imageUrl = (d.media_type === 'VIDEO' && d.thumbnail_url) ? d.thumbnail_url : (d.media_url || d.thumbnail_url);
        if (!imageUrl) { cursor.summary.skipped_no_url++; continue; }
        const driveUrl = saveImageToDrive(imageUrl, id, d.timestamp, target.subfolder) || '';
        if (driveUrl) {
          sheet.getRange(cursor.currentRowIdx + 1, urlCol).setValue(driveUrl);
          if (captionCol > 0 && d.caption) {
            sheet.getRange(cursor.currentRowIdx + 1, captionCol).setValue(d.caption);
          }
          cursor.summary.saved++;
        }
      } catch (e) {
        Logger.log('画像URL付与エラー id=' + id + ': ' + e.message);
        cursor.summary.errors++;
      }

      // 50件ごとにカーソル保存（中断対策）
      if (cursor.summary.processed % 50 === 0) {
        props.setProperty(BIND_AUTOFETCH_CURSOR_KEY, JSON.stringify(cursor));
      }
    }

    if (cursor.currentRowIdx >= data.length) {
      cursor.currentSheetIdx++;
      cursor.currentRowIdx = 0;
    }
  }

  const allDone = cursor.currentSheetIdx >= targets.length;
  if (allDone) {
    props.deleteProperty(BIND_AUTOFETCH_CURSOR_KEY);
  } else {
    props.setProperty(BIND_AUTOFETCH_CURSOR_KEY, JSON.stringify(cursor));
  }

  const s = cursor.summary;
  ui.alert(
    (allDone ? '✅ 完了' : '⏸ 中断（再実行で続行）') + '\n\n' +
    '処理: ' + s.processed + '件\n' +
    '画像URL付与成功: ' + s.saved + '件\n' +
    '画像URL取得不可: ' + s.skipped_no_url + '件\n' +
    'エラー: ' + s.errors + '件'
  );
}

function resetBindAutoFetchCursor() {
  PropertiesService.getScriptProperties().deleteProperty(BIND_AUTOFETCH_CURSOR_KEY);
  SpreadsheetApp.getUi().alert('画像URL付与カーソルをリセットしました');
}

/**
 * デバッグ: 投稿日時照合のミスマッチ原因を可視化
 */
function debugTimestampMatch() {
  const ui = SpreadsheetApp.getUi();
  const res = ui.prompt('TS照合検証', 'Meta export URL（改行区切り・取り込み時と同じ）', ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() !== ui.Button.OK) return;

  const urls = res.getResponseText().split(/[\n,]+/).map(s => s.trim()).filter(Boolean);
  const folderIds = urls.map(u => extractDriveFolderId_(u)).filter(Boolean);
  const rootFolders = folderIds.map(id => DriveApp.getFolderById(id));
  const filenameIndex = buildMediaFilenameIndex_(rootFolders);
  const jsonQueue = indexJsonFilesRecursiveMulti_(rootFolders);
  const tsMap = {};
  jsonQueue.forEach(job => {
    try {
      const file = DriveApp.getFileById(job.id);
      const json = JSON.parse(file.getBlob().getDataAsString());
      const items = extractMetaItems_(json);
      items.forEach(item => {
        const mediaArr = Array.isArray(item.media) ? item.media : (item.uri ? [item] : []);
        if (mediaArr.length === 0) return;
        const ts = item.creation_timestamp || (mediaArr[0] && mediaArr[0].creation_timestamp);
        if (!ts) return;
        const uri = mediaArr[0].uri || '';
        const basename = uri.split('/').pop();
        if (!filenameIndex[basename]) return;
        if (!tsMap[Number(ts)]) tsMap[Number(ts)] = true;
      });
    } catch (_) {}
  });

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('📖 ストーリーズ履歴');
  if (!sheet) { ui.alert('シート無し'); return; }
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(h => String(h).trim());
  const tsCol = headers.indexOf('投稿日時') + 1;
  const urlCol = headers.indexOf('画像URL') + 1;
  const sourceCol = headers.indexOf('source') + 1;

  const lastRow = sheet.getLastRow();
  const data = sheet.getRange(2, 1, Math.min(100, lastRow - 1), sheet.getLastColumn()).getValues();
  const samples = [];
  for (let i = 0; i < data.length && samples.length < 5; i++) {
    const url = String(data[i][urlCol - 1] || '');
    const src = sourceCol > 0 ? String(data[i][sourceCol - 1] || '') : '';
    if (url) continue;
    if (src === 'meta_drive') continue;
    samples.push({ row: i + 2, tsVal: data[i][tsCol - 1] });
  }

  const lines = [
    '【TS照合検証】',
    'tsMap総数: ' + Object.keys(tsMap).length,
    'tsMap先頭5: ' + Object.keys(tsMap).slice(0, 5).join(', '),
    ''
  ];

  // tsMap の範囲
  const sorted = Object.keys(tsMap).map(Number).sort((a, b) => a - b);
  if (sorted.length > 0) {
    const minD = new Date(sorted[0] * 1000);
    const maxD = new Date(sorted[sorted.length - 1] * 1000);
    lines.push('tsMap範囲: ' + Utilities.formatDate(minD, 'Asia/Tokyo', 'yyyy/MM/dd HH:mm:ss') +
               ' 〜 ' + Utilities.formatDate(maxD, 'Asia/Tokyo', 'yyyy/MM/dd HH:mm:ss'));
    lines.push('');
  }

  samples.forEach(s => {
    let tsMs = null;
    if (s.tsVal instanceof Date) tsMs = s.tsVal.getTime();
    else if (s.tsVal) {
      const d = new Date(s.tsVal);
      if (!isNaN(d.getTime())) tsMs = d.getTime();
    }
    const tsSec = tsMs ? Math.floor(tsMs / 1000) : null;
    lines.push('row=' + s.row + ' raw="' + s.tsVal + '" type=' + (typeof s.tsVal) +
               ' → tsSec=' + tsSec);

    if (tsSec !== null) {
      let hit = null;
      for (let delta = 0; delta <= 60 && !hit; delta++) {
        if (tsMap[tsSec + delta]) hit = tsSec + delta;
        else if (delta > 0 && tsMap[tsSec - delta]) hit = tsSec - delta;
      }
      lines.push('  ±60s照合: ' + (hit !== null ? '✅ ' + hit : '❌ none'));

      // 近傍tsMap値
      let nearestBefore = null, nearestAfter = null;
      for (const k of sorted) {
        if (k <= tsSec) nearestBefore = k;
        if (k >= tsSec && nearestAfter === null) { nearestAfter = k; break; }
      }
      lines.push('  近傍tsMap: before=' + nearestBefore + '(差' + (nearestBefore !== null ? tsSec - nearestBefore : '?') +
                 's) after=' + nearestAfter + '(差' + (nearestAfter !== null ? nearestAfter - tsSec : '?') + 's)');
    }
    lines.push('');
  });

  Logger.log(lines.join('\n'));
  ui.alert('TS照合検証', lines.join('\n').slice(0, 4500), ui.ButtonSet.OK);
}

/**
 * デバッグ: 履歴シートの画像URL列の状態を確認
 */
function debugCheckImageColumn() {
  const ui = SpreadsheetApp.getUi();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheetNames = ['📸 フィード履歴', '🎬 リール履歴', '📖 ストーリーズ履歴'];
  const lines = [];

  sheetNames.forEach(name => {
    const sheet = ss.getSheetByName(name);
    if (!sheet) { lines.push('❌ ' + name + ' シートなし'); return; }
    const lastCol = sheet.getLastColumn();
    const lastRow = sheet.getLastRow();
    const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(h => String(h).trim());
    const urlColIdx = headers.indexOf('画像URL') + 1;
    const captionColIdx = headers.indexOf('キャプション') + 1;
    const sourceColIdx = headers.indexOf('source') + 1;

    lines.push('=== ' + name + ' ===');
    lines.push('列数: ' + lastCol + ' / 行数: ' + lastRow);
    lines.push('ヘッダー: ' + headers.join(' | '));
    lines.push('画像URL列: ' + (urlColIdx || '見つからず'));
    lines.push('キャプション列: ' + (captionColIdx || '見つからず'));
    lines.push('source列: ' + (sourceColIdx || '見つからず'));

    if (urlColIdx > 0 && lastRow >= 2) {
      const sample = sheet.getRange(2, urlColIdx, Math.min(5, lastRow - 1), 1).getValues();
      lines.push('画像URLサンプル（先頭5行）:');
      sample.forEach((row, i) => {
        const v = row[0];
        lines.push('  行' + (i + 2) + ': ' + (v ? String(v).slice(0, 80) : '(空)'));
      });
      // 空でない件数を集計
      let nonEmpty = 0;
      const all = sheet.getRange(2, urlColIdx, lastRow - 1, 1).getValues();
      all.forEach(r => { if (String(r[0] || '').trim()) nonEmpty++; });
      lines.push('画像URL入っている行数: ' + nonEmpty + ' / ' + (lastRow - 1));
    }
    lines.push('');
  });

  Logger.log(lines.join('\n'));
  ui.alert('画像URL列デバッグ', lines.join('\n').slice(0, 4500), ui.ButtonSet.OK);
}

/**
 * カーソルリセット（途中で別フォルダに切り替えたいときの管理用）
 */
function resetMetaDriveCursor() {
  PropertiesService.getScriptProperties().deleteProperty(META_DRIVE_CURSOR_KEY);
  SpreadsheetApp.getUi().alert('Meta Drive取り込みカーソルをリセットしました');
}

/**
 * 現在の取り込み進捗を返す（ダイアログのポーリング用）
 * 別実行コンテキストから PropertiesService に書かれたカーソルを読み取り、
 * 進行中の処理の途中経過を可視化する
 */
function getMetaDriveProgress() {
  const cursor = JSON.parse(PropertiesService.getScriptProperties().getProperty(META_DRIVE_CURSOR_KEY) || 'null');
  if (!cursor) return { running: false };

  const completed = (cursor.completedJsonIds || []).length;
  const queued = (cursor.jsonQueue || []).length;
  const inProgress = cursor.currentJson ? 1 : 0;
  const totalJson = completed + queued + inProgress;

  return {
    running: true,
    totalJsonFiles: totalJson,
    completedJsonFiles: completed,
    queuedJsonFiles: queued,
    currentJsonName: cursor.currentJson ? cursor.currentJson.name : null,
    currentJsonIndex: cursor.currentJson ? cursor.currentJson.index : null,
    currentJsonTotal: cursor.currentJson ? (cursor.currentJson.itemsCount || cursor.currentJson.items && cursor.currentJson.items.length) : null,
    summary: cursor.summary || {},
  };
}
