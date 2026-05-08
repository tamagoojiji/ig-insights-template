/**
 * スプレッドシート操作ユーティリティ
 */

/**
 * シートを取得（なければ作成）
 */
function getOrCreateSheet(name) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
  }
  return sheet;
}

/**
 * ヘッダー名から列番号（1始まり）を取得。見つからなければ -1
 */
function findColumn_(sheet, headerName) {
  const lastCol = sheet.getLastColumn();
  if (lastCol < 1) return -1;
  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  for (let i = 0; i < headers.length; i++) {
    if (String(headers[i]).trim() === headerName) return i + 1;
  }
  return -1;
}

/**
 * シートのヘッダー順に valueMap から値を並べた行配列を作成。
 * ヘッダーに存在しないキーは無視され、valueMap に無い列は空文字になる。
 */
function buildRowFromMap_(sheet, valueMap) {
  const lastCol = sheet.getLastColumn();
  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  return headers.map(h => {
    const key = String(h).trim();
    return Object.prototype.hasOwnProperty.call(valueMap, key) ? valueMap[key] : '';
  });
}

/**
 * シートに既存のメディアIDを取得（重複チェック用）
 */
function getExistingMediaIds(sheet, idColumn) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return new Set();

  const ids = sheet.getRange(2, idColumn, lastRow - 1, 1).getValues();
  return new Set(ids.flat().filter(Boolean).map(String));
}

/**
 * フィードシートのヘッダーを設定
 */
function setupFeedHeader(sheet) {
  const headers = [
    '投稿日時', 'サムネイル', 'タイプ', 'キャプション',
    'いいね数', 'コメント数', '保存数', 'リーチ',
    '視聴数', 'エンゲージメント率', 'メディアID'
  ];
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#4285F4').setFontColor('#FFFFFF');
  sheet.setColumnWidth(2, 120);
  sheet.setColumnWidth(4, 400);
  sheet.getRange(2, 4, sheet.getMaxRows() - 1, 1).setWrap(true).setVerticalAlignment('top');
  sheet.setColumnWidth(11, 1);
  sheet.getRange(1, 11, sheet.getMaxRows(), 1).setNumberFormat('@');
  sheet.setRowHeight(1, 30);
}

/**
 * リールシートのヘッダーを設定
 */
function setupReelHeader(sheet) {
  const headers = [
    '投稿日時', 'サムネイル', 'キャプション',
    '視聴数', 'いいね数', 'コメント数', '保存数',
    'リーチ', 'シェア数', 'エンゲージメント率', 'メディアID'
  ];
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#EA4335').setFontColor('#FFFFFF');
  sheet.setColumnWidth(2, 120);
  sheet.setColumnWidth(3, 400);
  sheet.getRange(2, 3, sheet.getMaxRows() - 1, 1).setWrap(true).setVerticalAlignment('top');
  sheet.setColumnWidth(11, 1);
  sheet.getRange(1, 11, sheet.getMaxRows(), 1).setNumberFormat('@');
  sheet.setRowHeight(1, 30);
}

/**
 * ストーリーズシートのヘッダーを設定
 */
function setupStoriesHeader(sheet) {
  const headers = [
    '投稿日時', 'サムネイル', 'メディアタイプ',
    'リーチ', '視聴数', '返信数',
    'シェア数', 'ナビゲーション', 'プロフィールアクセス', 'メディアID'
  ];
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#FBBC05').setFontColor('#333333');
  sheet.setColumnWidth(2, 120);
  sheet.setColumnWidth(10, 1);
  sheet.getRange(1, 10, sheet.getMaxRows(), 1).setNumberFormat('@');
  sheet.setRowHeight(1, 30);
}

/**
 * フィード履歴シートのヘッダーを設定
 */
function setupFeedHistoryHeader(sheet) {
  const headers = [
    '投稿日時', 'メディアID', '取得時刻', '経過分',
    'いいね数', 'コメント数', '保存数', 'リーチ', '視聴数', '総反応数'
  ];
  sheet.getRange(1, 1, 1, headers.length).setValues([headers])
    .setFontWeight('bold').setBackground('#1565C0').setFontColor('#FFFFFF');
  sheet.setColumnWidth(1, 140);
  sheet.setColumnWidth(2, 200);
  sheet.getRange(2, 2, sheet.getMaxRows() - 1, 1).setNumberFormat('@');
  sheet.getRange(2, 3, sheet.getMaxRows() - 1, 1).setNumberFormat('yyyy/MM/dd HH:mm');
  sheet.setFrozenRows(1);
  sheet.setRowHeight(1, 30);
}

/**
 * リール履歴シートのヘッダーを設定
 */
function setupReelHistoryHeader(sheet) {
  const headers = [
    '投稿日時', 'メディアID', '取得時刻', '経過分',
    '視聴数', 'いいね数', 'コメント数', '保存数', 'リーチ', 'シェア数', '総反応数'
  ];
  sheet.getRange(1, 1, 1, headers.length).setValues([headers])
    .setFontWeight('bold').setBackground('#C62828').setFontColor('#FFFFFF');
  sheet.setColumnWidth(1, 140);
  sheet.setColumnWidth(2, 200);
  sheet.getRange(2, 2, sheet.getMaxRows() - 1, 1).setNumberFormat('@');
  sheet.getRange(2, 3, sheet.getMaxRows() - 1, 1).setNumberFormat('yyyy/MM/dd HH:mm');
  sheet.setFrozenRows(1);
  sheet.setRowHeight(1, 30);
}

/**
 * ストーリーズ履歴シートのヘッダーを設定
 */
function setupStoriesHistoryHeader(sheet) {
  const headers = [
    '投稿日時', 'メディアID', '取得時刻', '経過分',
    'リーチ', '視聴数', '返信数', 'シェア数',
    'ナビゲーション', 'プロフィールアクセス'
  ];
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#FB8C00').setFontColor('#FFFFFF');
  sheet.setColumnWidth(1, 140);
  sheet.setColumnWidth(2, 200);
  sheet.getRange(1, 2, sheet.getMaxRows(), 1).setNumberFormat('@');
  sheet.setFrozenRows(1);
  sheet.setRowHeight(1, 30);
}

/**
 * 🏆 伸びた投稿シートのヘッダーを設定
 */
function setupTopStoriesHeader(sheet) {
  const headers = ['投稿日時', 'サムネ', '視聴数', '視聴倍率', 'リピート率', 'シェア', 'プロフ遷移率', '達成'];
  sheet.getRange(1, 1, 1, headers.length).setValues([headers])
    .setFontWeight('bold').setBackground('#F57C00').setFontColor('#FFFFFF');
  [120, 100, 80, 100, 100, 80, 110, 60].forEach((w, i) => sheet.setColumnWidth(i + 1, w));
  sheet.setFrozenRows(1);
  sheet.setRowHeight(1, 30);
}

/**
 * ⚡ 初速良好シートのヘッダーを設定
 */
function setupFastGrowthHeader(sheet) {
  const headers = ['投稿日時', '経過時間', '1h視聴', '現在視聴', '平均比', '予測最終視聴'];
  sheet.getRange(1, 1, 1, headers.length).setValues([headers])
    .setFontWeight('bold').setBackground('#E53935').setFontColor('#FFFFFF');
  [120, 80, 80, 90, 80, 110].forEach((w, i) => sheet.setColumnWidth(i + 1, w));
  sheet.setFrozenRows(1);
  sheet.setRowHeight(1, 30);
}

/**
 * 🏆 フィード伸びた投稿シートのヘッダーを設定
 */
function setupTopFeedHeader(sheet) {
  const headers = ['投稿日時', 'サムネ', 'リーチ', 'リーチ倍率', 'いいね率', '保存率', 'コメント', '達成'];
  sheet.getRange(1, 1, 1, headers.length).setValues([headers])
    .setFontWeight('bold').setBackground('#1976D2').setFontColor('#FFFFFF');
  [120, 100, 80, 100, 100, 100, 80, 60].forEach((w, i) => sheet.setColumnWidth(i + 1, w));
  sheet.setFrozenRows(1);
  sheet.setRowHeight(1, 30);
}

/**
 * 🏆 リール伸びた投稿シートのヘッダーを設定
 */
function setupTopReelHeader(sheet) {
  const headers = ['投稿日時', 'サムネ', '視聴数', '視聴倍率', '保存率', 'シェア', 'リーチ率', '達成'];
  sheet.getRange(1, 1, 1, headers.length).setValues([headers])
    .setFontWeight('bold').setBackground('#D32F2F').setFontColor('#FFFFFF');
  [120, 100, 90, 100, 100, 80, 100, 60].forEach((w, i) => sheet.setColumnWidth(i + 1, w));
  sheet.setFrozenRows(1);
  sheet.setRowHeight(1, 30);
}

/**
 * ⚡ フィード初速良好シートのヘッダーを設定
 */
function setupFeedFastGrowthHeader(sheet) {
  const headers = ['投稿日時', '経過時間', '6h反応', '現在反応', '平均比', '予測最終反応'];
  sheet.getRange(1, 1, 1, headers.length).setValues([headers])
    .setFontWeight('bold').setBackground('#1976D2').setFontColor('#FFFFFF');
  [120, 80, 80, 90, 80, 120].forEach((w, i) => sheet.setColumnWidth(i + 1, w));
  sheet.setFrozenRows(1);
  sheet.setRowHeight(1, 30);
}

/**
 * ⚡ リール初速良好シートのヘッダーを設定
 */
function setupReelFastGrowthHeader(sheet) {
  const headers = ['投稿日時', '経過時間', '6h視聴', '現在視聴', '平均比', '予測最終視聴'];
  sheet.getRange(1, 1, 1, headers.length).setValues([headers])
    .setFontWeight('bold').setBackground('#D32F2F').setFontColor('#FFFFFF');
  [120, 80, 80, 90, 80, 110].forEach((w, i) => sheet.setColumnWidth(i + 1, w));
  sheet.setFrozenRows(1);
  sheet.setRowHeight(1, 30);
}

/**
 * サムネイル行の高さを設定
 */
function setThumbnailRowHeight(sheet, startRow, count) {
  for (let i = 0; i < count; i++) {
    sheet.setRowHeight(startRow + i, 100);
  }
}


/**
 * ISO日時をJST表示用に変換
 */
function formatTimestamp(isoString) {
  if (!isoString) return '';
  const date = new Date(isoString);
  return Utilities.formatDate(date, 'Asia/Tokyo', 'yyyy/MM/dd HH:mm');
}
