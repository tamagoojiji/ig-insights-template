/**
 * IGインサイト保存テンプレート — runner本体
 * onOpen / メニュー定義は menu.js / トリガー管理は triggers.js
 */

/**
 * 全データ取得（手動実行）
 */
function manualFetchAll() {
  const ui = SpreadsheetApp.getUi();

  try {
    checkAndRefreshToken();
    ensureV22Migration_();

    const feedResult = fetchAndWriteFeed();
    let storyResult = { stories: 0 };
    if (!isTimeUp_()) {
      storyResult = fetchAndWriteStories();
    }
    if (!isTimeUp_()) {
      updateDashboard();
    }

    const timeUp = isTimeUp_();
    ui.alert(
      `取得${timeUp ? '（一部）' : ''}完了！\n\n` +
      `📸 フィード: ${feedResult.feed}件\n` +
      `🎬 リール: ${feedResult.reels}件\n` +
      `📖 ストーリーズ: ${storyResult.stories}件` +
      (timeUp ? '\n\n⚠️ 時間制限のため一部未取得です。\nもう一度実行すると続きを取得します。' : '')
    );
  } catch (e) {
    ui.alert(`エラーが発生しました: ${e.message}`);
    Logger.log(`manualFetchAll エラー: ${e.message}\n${e.stack}`);
  }
}

/**
 * フィード+リールのみ取得
 */
function manualFetchFeed() {
  try {
    checkAndRefreshToken();
    ensureV22Migration_();
    const result = fetchAndWriteFeed();
    if (!isTimeUp_()) updateDashboard();
    const timeUp = isTimeUp_();
    SpreadsheetApp.getUi().alert(
      `取得${timeUp ? '（一部）' : ''}完了！\n📸 フィード: ${result.feed}件\n🎬 リール: ${result.reels}件` +
      (timeUp ? '\n\n⚠️ 時間制限のため一部未処理。もう一度実行で続きを処理します。' : '')
    );
  } catch (e) {
    SpreadsheetApp.getUi().alert(`エラー: ${e.message}`);
  }
}

/**
 * ストーリーズのみ取得
 */
function manualFetchStories() {
  try {
    checkAndRefreshToken();
    ensureV22Migration_();
    const result = fetchAndWriteStories();
    if (!isTimeUp_()) updateDashboard();
    const timeUp = isTimeUp_();
    SpreadsheetApp.getUi().alert(
      `取得${timeUp ? '（一部）' : ''}完了！\n📖 ストーリーズ: ${result.stories}件` +
      (timeUp ? '\n\n⚠️ 時間制限のため一部未処理。もう一度実行で続きを処理します。' : '')
    );
  } catch (e) {
    SpreadsheetApp.getUi().alert(`エラー: ${e.message}`);
  }
}

/**
 * 自動取得（トリガーから呼ばれる）
 */
function autoFetch() {
  try {
    checkAndRefreshToken();
    ensureV22Migration_();

    fetchAndWriteFeed();
    if (!isTimeUp_()) {
      fetchAndWriteStories();
    }
    if (!isTimeUp_()) {
      updateDashboard();
    }

    Logger.log('自動取得完了' + (isTimeUp_() ? '（時間制限で一部スキップ）' : ''));
  } catch (e) {
    Logger.log(`autoFetch エラー: ${e.message}\n${e.stack}`);
  }
}

/**
 * 全シートを初期化
 */
function initializeAllSheets() {
  setupSettingsSheet();

  const feedSheet = getOrCreateSheet('📸 フィード');
  if (feedSheet.getLastRow() === 0) setupFeedHeader(feedSheet);

  const feedHistorySheet = getOrCreateSheet('📸 フィード履歴');
  if (feedHistorySheet.getLastRow() === 0) setupFeedHistoryHeader(feedHistorySheet);

  const reelSheet = getOrCreateSheet('🎬 リール');
  if (reelSheet.getLastRow() === 0) setupReelHeader(reelSheet);

  const reelHistorySheet = getOrCreateSheet('🎬 リール履歴');
  if (reelHistorySheet.getLastRow() === 0) setupReelHistoryHeader(reelHistorySheet);

  const storySheet = getOrCreateSheet('📖 ストーリーズ');
  if (storySheet.getLastRow() === 0) setupStoriesHeader(storySheet);

  const storyHistorySheet = getOrCreateSheet('📖 ストーリーズ履歴');
  if (storyHistorySheet.getLastRow() === 0) setupStoriesHistoryHeader(storyHistorySheet);

  const topStoriesSheet = getOrCreateSheet('🏆 伸びた投稿');
  if (topStoriesSheet.getLastRow() === 0) setupTopStoriesHeader(topStoriesSheet);

  const fastGrowthSheet = getOrCreateSheet('⚡ 初速良好');
  if (fastGrowthSheet.getLastRow() === 0) setupFastGrowthHeader(fastGrowthSheet);

  const topFeedSheet = getOrCreateSheet('🏆 フィード伸びた投稿');
  if (topFeedSheet.getLastRow() === 0) setupTopFeedHeader(topFeedSheet);

  const topReelSheet = getOrCreateSheet('🏆 リール伸びた投稿');
  if (topReelSheet.getLastRow() === 0) setupTopReelHeader(topReelSheet);

  const feedFastSheet = getOrCreateSheet('⚡ フィード初速良好');
  if (feedFastSheet.getLastRow() === 0) setupFeedFastGrowthHeader(feedFastSheet);

  const reelFastSheet = getOrCreateSheet('⚡ リール初速良好');
  if (reelFastSheet.getLastRow() === 0) setupReelFastGrowthHeader(reelFastSheet);

  getOrCreateSheet('📊 ダッシュボード');

  try {
    const token = getConfig('IG_ACCESS_TOKEN');
    const userId = getConfig('IG_USER_ID');
    const msg = (token && userId)
      ? '全シートの初期設定が完了しました！\n（設定値は保持されています）'
      : '全シートの初期設定が完了しました！\n「⚙️ 設定」シートにトークン等を入力してください。';
    SpreadsheetApp.getUi().alert(msg);
  } catch (e) {
    Logger.log('初期設定完了');
  }
}

/**
 * 既存のフィード・リール各行のキャプションを全文に書き直す
 * - フィード: D列（4列目）
 * - リール: C列（3列目）
 * - メディアIDが既存行にあるものだけ対象。Graph APIで全件取得して照合する
 */
function backfillFullCaptions() {
  const ui = SpreadsheetApp.getUi();
  try {
    checkAndRefreshToken();
    ensureV22Migration_();
    getExecutionStart_();

    const allMedia = fetchAllMedia(Infinity);
    const captionMap = new Map();
    allMedia.forEach(m => captionMap.set(String(m.id), m.caption || ''));

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const result = { feed: 0, reels: 0, missing: 0, schemaSkipped: [] };

    const feedSheet = ss.getSheetByName('📸 フィード');
    if (feedSheet && feedSheet.getLastRow() >= 2) {
      const capCol = findColumn_(feedSheet, 'キャプション');
      const idCol = findColumn_(feedSheet, 'メディアID');
      if (capCol > 0 && idCol > 0) {
        result.feed = backfillCaptionsForSheet_(feedSheet, capCol, idCol, captionMap, result);
      } else {
        result.schemaSkipped.push('📸 フィード');
      }
    }

    const reelSheet = ss.getSheetByName('🎬 リール');
    if (reelSheet && reelSheet.getLastRow() >= 2) {
      const capCol = findColumn_(reelSheet, 'キャプション');
      const idCol = findColumn_(reelSheet, 'メディアID');
      if (capCol > 0 && idCol > 0) {
        result.reels = backfillCaptionsForSheet_(reelSheet, capCol, idCol, captionMap, result);
      } else {
        result.schemaSkipped.push('🎬 リール');
      }
    }

    let msg = `キャプション全文化完了\n\n` +
      `📸 フィード: ${result.feed}件\n` +
      `🎬 リール: ${result.reels}件`;
    if (result.missing > 0) {
      msg += `\n\n⚠️ APIで取得できなかった行: ${result.missing}件（投稿が削除済の可能性）`;
    }
    if (result.schemaSkipped.length > 0) {
      msg += `\n\n⚠️ 列構成不一致でスキップ: ${result.schemaSkipped.join(', ')}`;
    }
    if (isTimeUp_()) {
      msg += `\n\n⚠️ 6分制限に達しました。もう一度実行すると残りを更新できます。`;
    }
    ui.alert(msg);
  } catch (e) {
    ui.alert(`エラー: ${e.message}`);
    Logger.log(`backfillFullCaptions エラー: ${e.message}\n${e.stack}`);
  }
}

function backfillCaptionsForSheet_(sheet, captionCol, idCol, captionMap, result) {
  const lastRow = sheet.getLastRow();
  const ids = sheet.getRange(2, idCol, lastRow - 1, 1).getValues();
  const captions = sheet.getRange(2, captionCol, lastRow - 1, 1).getValues();
  let updated = 0;
  for (let i = 0; i < ids.length; i++) {
    if (isTimeUp_()) break;
    const id = String(ids[i][0] || '');
    if (!id) continue;
    if (!captionMap.has(id)) {
      result.missing++;
      continue;
    }
    const fullCaption = captionMap.get(id);
    if (captions[i][0] !== fullCaption) {
      captions[i][0] = fullCaption;
      updated++;
    }
  }
  if (updated > 0) {
    sheet.getRange(2, captionCol, captions.length, 1).setValues(captions);
    sheet.getRange(2, captionCol, captions.length, 1).setWrap(true).setVerticalAlignment('top');
    sheet.setColumnWidth(captionCol, 400);
  }
  return updated;
}

/**
 * 【今回限り】v22メトリクス移行マイグレーション
 * 初回取得時に1回だけ既存データをクリアし、ヘッダーを新表記に更新する
 * SCHEMA_VERSION=v22 が設定されていたらスキップ
 */
function ensureV22Migration_() {
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty('SCHEMA_VERSION') === 'v22b') return;

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const targets = ['📸 フィード', '🎬 リール', '📖 ストーリーズ'];
  const results = [];

  targets.forEach(name => {
    const sheet = ss.getSheetByName(name);
    if (!sheet) return;
    const lastRow = sheet.getLastRow();
    if (lastRow > 1) {
      sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).clear();
      results.push(`${name}: ${lastRow - 1}件クリア`);
    }
  });

  const feedSheet = ss.getSheetByName('📸 フィード');
  if (feedSheet) setupFeedHeader(feedSheet);
  const reelSheet = ss.getSheetByName('🎬 リール');
  if (reelSheet) setupReelHeader(reelSheet);
  const storySheet = ss.getSheetByName('📖 ストーリーズ');
  if (storySheet) setupStoriesHeader(storySheet);

  props.setProperty('SCHEMA_VERSION', 'v22b');
  Logger.log('v22bマイグレーション実行: ' + (results.join(' / ') || 'クリア対象なし'));
}
