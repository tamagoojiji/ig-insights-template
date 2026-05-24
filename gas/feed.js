/**
 * フィード+リール取得・書き込み
 */

const MAX_EXECUTION_MS = 300000; // 5分（6分制限の余裕）
let executionStart_ = null;

function getExecutionStart_() {
  if (!executionStart_) executionStart_ = Date.now();
  return executionStart_;
}

function isTimeUp_() {
  return (Date.now() - getExecutionStart_()) > MAX_EXECUTION_MS;
}

/**
 * 履歴シートからメディアID→最終取得時刻マップを構築
 * 取得時刻は Date オブジェクトとして保存されている前提
 */
function getLastFetchMap_(historySheet) {
  const map = new Map();
  if (!historySheet || historySheet.getLastRow() < 2) return map;
  const data = historySheet.getRange(2, 2, historySheet.getLastRow() - 1, 2).getValues();
  data.forEach(row => {
    const id = String(row[0]);
    const raw = row[1];
    const t = raw instanceof Date ? raw : new Date(raw);
    if (!id || !t || isNaN(t.getTime())) return;
    const existing = map.get(id);
    if (!existing || t > existing) map.set(id, t);
  });
  return map;
}

/**
 * 投稿からの経過時間に応じて取得すべきかを判定
 * - 0〜24h: 毎回取得
 * - 1〜7日: 6時間ごと
 * - 7日〜: 24時間ごと
 */
function shouldRefetch_(now, postedAt, lastFetch) {
  if (!lastFetch) return true;
  const ageMs = now - postedAt;
  const dayMs = 86400000;
  let minIntervalMs;
  if (ageMs < dayMs) minIntervalMs = 0;
  else if (ageMs < 7 * dayMs) minIntervalMs = 6 * 3600 * 1000;
  else minIntervalMs = dayMs;
  return (now - lastFetch) >= minIntervalMs;
}

/**
 * フィード投稿を取得してシートに書き込み
 */
function fetchAndWriteFeed() {
  getExecutionStart_();
  const allMedia = fetchAllMedia();

  const feedItems = allMedia.filter(m => m.media_type === 'IMAGE' || m.media_type === 'CAROUSEL_ALBUM');
  const reelItems = allMedia.filter(m => m.media_type === 'VIDEO');

  const feedCount = writeFeedToSheet(feedItems);
  const reelCount = writeReelsToSheet(reelItems);

  return { feed: feedCount, reels: reelCount };
}

/**
 * フィード投稿をシートに書き込み
 */
function writeFeedToSheet(items) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  ensureMetaHistoryColumns_(ss);
  const sheet = getOrCreateSheet('📸 フィード');
  const historySheet = getOrCreateSheet('📸 フィード履歴');

  if (sheet.getLastRow() === 0) setupFeedHeader(sheet);
  if (historySheet.getLastRow() === 0) setupFeedHistoryHeader(historySheet);

  const idCol = findColumn_(sheet, 'メディアID');
  const updateStartCol = findColumn_(sheet, 'いいね数');
  if (idCol < 1 || updateStartCol < 1) {
    Logger.log('フィード: 必須ヘッダー（メディアID/いいね数）が見つかりません');
    return 0;
  }

  // 既存行マップ
  const existingMap = new Map();
  if (sheet.getLastRow() >= 2) {
    const ids = sheet.getRange(2, idCol, sheet.getLastRow() - 1, 1).getValues();
    ids.forEach((row, i) => {
      if (row[0]) existingMap.set(String(row[0]), i + 2);
    });
  }
  const lastFetchMap = getLastFetchMap_(historySheet);

  const now = new Date();
  const historyRows = [];
  let newCount = 0;
  let updateCount = 0;
  let skipCount = 0;
  let timedOut = false;

  for (const item of items) {
    if (isTimeUp_()) { timedOut = true; break; }

    const isExisting = existingMap.has(String(item.id));
    const postedAt = new Date(item.timestamp);

    if (isExisting) {
      const lastFetch = lastFetchMap.get(String(item.id));
      if (!shouldRefetch_(now, postedAt, lastFetch)) {
        skipCount++;
        continue;
      }
    }

    const insights = fetchMediaInsights(item.id, item.media_type);
    const reach = insights.reach || 0;
    const views = insights.views || 0;
    const likes = item.like_count || 0;
    const comments = item.comments_count || 0;
    const saved = insights.saved || 0;
    const engagement = insights.total_interactions || (likes + comments + saved);
    const engagementRate = reach > 0 ? ((engagement / reach) * 100).toFixed(1) + '%' : '0%';
    const elapsedMin = Math.round((now - postedAt) / 60000);

    // 新規時のみ画像をDriveに保存（共有変数として保持）
    let driveUrl = '';
    if (!isExisting) {
      const imageUrl = (item.media_type === 'VIDEO' && item.thumbnail_url)
        ? item.thumbnail_url
        : (item.media_url || item.thumbnail_url);
      if (imageUrl && !isTimeUp_()) {
        driveUrl = saveImageToDrive(imageUrl, item.id, item.timestamp, 'feed') || '';
      }
    }

    historyRows.push([
      formatTimestamp(item.timestamp),
      String(item.id),
      now,
      elapsedMin,
      likes, comments, saved, reach, views, engagement,
      item.caption || '',
      driveUrl,
      'autoFetch'
    ]);

    if (isExisting) {
      const rowIndex = existingMap.get(String(item.id));
      sheet.getRange(rowIndex, updateStartCol, 1, 6).setValues([[likes, comments, saved, reach, views, engagementRate]]);
      updateCount++;
    } else {
      const valueMap = {
        '投稿日時': formatTimestamp(item.timestamp),
        'サムネイル': driveUrl ? `=IMAGE("${driveUrl}")` : '',
        'タイプ': item.media_type,
        'キャプション': item.caption || '',
        'いいね数': likes, 'コメント数': comments, '保存数': saved,
        'リーチ': reach, '視聴数': views, 'エンゲージメント率': engagementRate,
        'メディアID': item.id
      };
      const newRow = buildRowFromMap_(sheet, valueMap);
      const startRow = sheet.getLastRow() + 1;
      sheet.getRange(startRow, 1, 1, newRow.length).setValues([newRow]);
      setThumbnailRowHeight(sheet, startRow, 1);
      newCount++;
    }
  }

  if (historyRows.length > 0) {
    const startRow = historySheet.getLastRow() + 1;
    historySheet.getRange(startRow, 1, historyRows.length, 13).setValues(historyRows);
  }

  if (!timedOut && sheet.getLastRow() > 2) {
    sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).sort({ column: 1, ascending: false });
  }

  Logger.log(`フィード: 新規${newCount} / 更新${updateCount} / スキップ${skipCount}${timedOut ? ' / 時間制限' : ''}`);
  return newCount + updateCount;
}

/**
 * リール投稿をシートに書き込み
 */
function writeReelsToSheet(items) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  ensureMetaHistoryColumns_(ss);
  const sheet = getOrCreateSheet('🎬 リール');
  const historySheet = getOrCreateSheet('🎬 リール履歴');

  if (sheet.getLastRow() === 0) setupReelHeader(sheet);
  if (historySheet.getLastRow() === 0) setupReelHistoryHeader(historySheet);

  const idCol = findColumn_(sheet, 'メディアID');
  const updateStartCol = findColumn_(sheet, '視聴数');
  if (idCol < 1 || updateStartCol < 1) {
    Logger.log('リール: 必須ヘッダー（メディアID/視聴数）が見つかりません');
    return 0;
  }

  const existingMap = new Map();
  if (sheet.getLastRow() >= 2) {
    const ids = sheet.getRange(2, idCol, sheet.getLastRow() - 1, 1).getValues();
    ids.forEach((row, i) => {
      if (row[0]) existingMap.set(String(row[0]), i + 2);
    });
  }
  const lastFetchMap = getLastFetchMap_(historySheet);

  const now = new Date();
  const historyRows = [];
  let newCount = 0;
  let updateCount = 0;
  let skipCount = 0;
  let timedOut = false;

  for (const item of items) {
    if (isTimeUp_()) { timedOut = true; break; }

    const isExisting = existingMap.has(String(item.id));
    const postedAt = new Date(item.timestamp);

    if (isExisting) {
      const lastFetch = lastFetchMap.get(String(item.id));
      if (!shouldRefetch_(now, postedAt, lastFetch)) {
        skipCount++;
        continue;
      }
    }

    const insights = fetchMediaInsights(item.id, 'REELS');
    const views = insights.views || 0;
    const likes = item.like_count || 0;
    const comments = item.comments_count || 0;
    const saved = insights.saved || 0;
    const reach = insights.reach || 0;
    const shares = insights.shares || 0;
    const totalInteractions = insights.total_interactions || (likes + comments + saved + shares);
    const engagementRate = reach > 0 ? ((totalInteractions / reach) * 100).toFixed(1) + '%' : '0%';
    const elapsedMin = Math.round((now - postedAt) / 60000);

    // 新規時のみDrive保存
    let driveUrl = '';
    if (!isExisting) {
      const imageUrl = item.thumbnail_url || item.media_url;
      if (imageUrl && !isTimeUp_()) {
        driveUrl = saveImageToDrive(imageUrl, item.id, item.timestamp, 'reels') || '';
      }
    }

    historyRows.push([
      formatTimestamp(item.timestamp),
      String(item.id),
      now,
      elapsedMin,
      views, likes, comments, saved, reach, shares, totalInteractions,
      item.caption || '',
      driveUrl,
      'autoFetch'
    ]);

    if (isExisting) {
      const rowIndex = existingMap.get(String(item.id));
      sheet.getRange(rowIndex, updateStartCol, 1, 7).setValues([[views, likes, comments, saved, reach, shares, engagementRate]]);
      updateCount++;
    } else {
      const valueMap = {
        '投稿日時': formatTimestamp(item.timestamp),
        'サムネイル': driveUrl ? `=IMAGE("${driveUrl}")` : '',
        'キャプション': item.caption || '',
        '視聴数': views, 'いいね数': likes, 'コメント数': comments, '保存数': saved,
        'リーチ': reach, 'シェア数': shares, 'エンゲージメント率': engagementRate,
        'メディアID': item.id
      };
      const newRow = buildRowFromMap_(sheet, valueMap);
      const startRow = sheet.getLastRow() + 1;
      sheet.getRange(startRow, 1, 1, newRow.length).setValues([newRow]);
      setThumbnailRowHeight(sheet, startRow, 1);
      newCount++;
    }
  }

  if (historyRows.length > 0) {
    const startRow = historySheet.getLastRow() + 1;
    historySheet.getRange(startRow, 1, historyRows.length, 14).setValues(historyRows);
  }

  if (!timedOut && sheet.getLastRow() > 2) {
    sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).sort({ column: 1, ascending: false });
  }

  Logger.log(`リール: 新規${newCount} / 更新${updateCount} / スキップ${skipCount}${timedOut ? ' / 時間制限' : ''}`);
  return newCount + updateCount;
}
