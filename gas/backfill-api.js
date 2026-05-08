/**
 * 過去全件取り込み（API）
 * - フィード/リールを paging.next で全件遡取得
 * - 5分制限到達時に BACKFILL_CURSOR (paging.next URL) を保存して中断
 * - 次回実行で続きから再開
 * - 完了時は BACKFILL_CURSOR を削除して Discord通知
 *
 * ストーリーズはAPI仕様上24時間以内のみ取得可。過去ストーリーズは
 * 「📦 Meta公式zipアップロード」メニューを使用してください。
 */

const BACKFILL_PROP_KEY = 'BACKFILL_CURSOR';
const BACKFILL_PROGRESS_KEY = 'BACKFILL_PROGRESS';

function backfillFromAPI() {
  const ui = SpreadsheetApp.getUi();

  try {
    assertConfigured();
  } catch (e) {
    ui.alert(e.message);
    return;
  }

  // ストーリーズはこの機能で取れない旨を明示（初回のみ）
  const props = PropertiesService.getScriptProperties();
  const cursor = props.getProperty(BACKFILL_PROP_KEY);
  if (!cursor) {
    const ans = ui.alert(
      '過去全件取り込み（API）',
      'フィード・リールを過去すべて遡って取得します。\n\n' +
      '⚠️ ストーリーズはAPI仕様上24時間以内のみ取得可能です。\n' +
      '過去のストーリーズを復元したい場合は、\n' +
      '「📦 Meta公式zipアップロード」を別途実行してください。\n\n' +
      '5分制限に達した場合は自動でカーソルを保存し、\n' +
      'もう一度このメニューを実行すると続きから再開します。\n\n' +
      '実行しますか？',
      ui.ButtonSet.OK_CANCEL
    );
    if (ans !== ui.Button.OK) return;
  }

  try {
    checkAndRefreshToken();
    ensureV22Migration_();

    getExecutionStart_();

    const result = backfillRunPaginated_(cursor);

    if (result.done) {
      props.deleteProperty(BACKFILL_PROP_KEY);
      const progress = JSON.parse(props.getProperty(BACKFILL_PROGRESS_KEY) || '{"feed":0,"reels":0}');
      progress.feed += result.feed;
      progress.reels += result.reels;
      props.deleteProperty(BACKFILL_PROGRESS_KEY);
      const msg = '✅ 過去全件取り込み完了\n\n' +
        '📸 フィード合計: ' + progress.feed + '件\n' +
        '🎬 リール合計: ' + progress.reels + '件';
      ui.alert(msg);
      try { notifyDiscord(msg, { kind: 'backfill_done', bypassCooldown: true }); } catch (_) {}
    } else {
      // 中断 → カーソル保存
      props.setProperty(BACKFILL_PROP_KEY, result.nextCursor);
      const progress = JSON.parse(props.getProperty(BACKFILL_PROGRESS_KEY) || '{"feed":0,"reels":0}');
      progress.feed += result.feed;
      progress.reels += result.reels;
      props.setProperty(BACKFILL_PROGRESS_KEY, JSON.stringify(progress));

      ui.alert(
        '⏸️ 5分制限に達したため中断しました\n\n' +
        '📸 フィード（今回）: ' + result.feed + '件\n' +
        '🎬 リール（今回）: ' + result.reels + '件\n' +
        '📊 累計: フィード ' + progress.feed + '件 / リール ' + progress.reels + '件\n\n' +
        'もう一度「📚 過去全件取り込み（API）」を実行すると続きから再開します。'
      );
    }
  } catch (e) {
    ui.alert('エラー: ' + e.message);
    Logger.log('backfillFromAPI error: ' + e.message + '\n' + e.stack);
    try { notifyDiscord('⚠️ 過去全件取り込みエラー: ' + e.message, { kind: 'backfill_error' }); } catch (_) {}
  }
}

/**
 * カーソルから取得を開始/再開し、5分制限まで処理する
 * @returns {{ done: boolean, nextCursor: string|null, feed: number, reels: number }}
 */
function backfillRunPaginated_(startCursor) {
  const userId = getConfig('IG_USER_ID');
  const token = getConfig('IG_ACCESS_TOKEN');
  const fields = 'id,media_type,media_url,thumbnail_url,timestamp,caption,like_count,comments_count,permalink';
  let url = startCursor || `https://graph.facebook.com/v22.0/${userId}/media?fields=${fields}&limit=50&access_token=${token}`;

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const feedSheet = ss.getSheetByName('📸 フィード') || getOrCreateSheet('📸 フィード');
  const feedHistorySheet = ss.getSheetByName('📸 フィード履歴') || getOrCreateSheet('📸 フィード履歴');
  const reelSheet = ss.getSheetByName('🎬 リール') || getOrCreateSheet('🎬 リール');
  const reelHistorySheet = ss.getSheetByName('🎬 リール履歴') || getOrCreateSheet('🎬 リール履歴');
  if (feedSheet.getLastRow() === 0) setupFeedHeader(feedSheet);
  if (feedHistorySheet.getLastRow() === 0) setupFeedHistoryHeader(feedHistorySheet);
  if (reelSheet.getLastRow() === 0) setupReelHeader(reelSheet);
  if (reelHistorySheet.getLastRow() === 0) setupReelHistoryHeader(reelHistorySheet);

  let feedCount = 0;
  let reelCount = 0;

  while (url) {
    if (isTimeUp_()) {
      return { done: false, nextCursor: url, feed: feedCount, reels: reelCount };
    }

    const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    const data = JSON.parse(res.getContentText());
    if (data.error) {
      throw new Error('Instagram API Error: ' + data.error.message);
    }

    const items = data.data || [];
    for (const m of items) {
      if (isTimeUp_()) {
        return { done: false, nextCursor: url, feed: feedCount, reels: reelCount };
      }
      try {
        const insights = fetchMediaInsights(m.id, m.media_type === 'VIDEO' ? 'REELS' : m.media_type);
        if (m.media_type === 'VIDEO') {
          appendReelRow_(reelSheet, reelHistorySheet, m, insights);
          reelCount++;
        } else {
          appendFeedRow_(feedSheet, feedHistorySheet, m, insights);
          feedCount++;
        }
      } catch (err) {
        Logger.log('backfill skip ' + m.id + ': ' + err.message);
      }
    }

    url = (data.paging && data.paging.next) ? data.paging.next : null;
    if (!url) {
      return { done: true, nextCursor: null, feed: feedCount, reels: reelCount };
    }
  }

  return { done: true, nextCursor: null, feed: feedCount, reels: reelCount };
}

/**
 * 1メディア分をシートに追記（既存IDなら何もしない）
 */
function appendFeedRow_(sheet, historySheet, m, insights) {
  const idCol = findColumn_(sheet, 'メディアID');
  if (idCol > 0 && sheet.getLastRow() >= 2) {
    const ids = sheet.getRange(2, idCol, sheet.getLastRow() - 1, 1).getValues().flat().map(String);
    if (ids.indexOf(String(m.id)) >= 0) return;
  }
  // feed.js 内の writeFeedRow_ 系を直接呼べる場合は流用、無ければ最低限の追記
  if (typeof writeFeedRowFromMedia_ === 'function') {
    writeFeedRowFromMedia_(sheet, historySheet, m, insights);
  } else {
    appendMinimalRow_(sheet, historySheet, m, insights, 'feed');
  }
}

function appendReelRow_(sheet, historySheet, m, insights) {
  const idCol = findColumn_(sheet, 'メディアID');
  if (idCol > 0 && sheet.getLastRow() >= 2) {
    const ids = sheet.getRange(2, idCol, sheet.getLastRow() - 1, 1).getValues().flat().map(String);
    if (ids.indexOf(String(m.id)) >= 0) return;
  }
  if (typeof writeReelRowFromMedia_ === 'function') {
    writeReelRowFromMedia_(sheet, historySheet, m, insights);
  } else {
    appendMinimalRow_(sheet, historySheet, m, insights, 'reel');
  }
}

/**
 * 既存ヘルパーが見つからない場合の最低限の追記
 * （ヘッダー名解決で各列に書き込む）
 */
function appendMinimalRow_(sheet, historySheet, m, insights, kind) {
  const colMap = {};
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  headers.forEach((h, i) => { if (h) colMap[String(h).trim()] = i + 1; });
  const row = sheet.getLastRow() + 1;
  const setCell = (col, val) => { if (colMap[col]) sheet.getRange(row, colMap[col]).setValue(val); };

  setCell('投稿日時', m.timestamp ? new Date(m.timestamp) : '');
  setCell('キャプション', m.caption || '');
  setCell('メディアID', m.id);
  setCell('リーチ', insights.reach || 0);
  setCell('視聴', insights.views || 0);
  setCell('いいね', m.like_count || 0);
  setCell('コメント', m.comments_count || 0);
  setCell('保存', insights.saved || 0);
  setCell('シェア', insights.shares || 0);
  setCell('総相互作用', insights.total_interactions || 0);
  if (kind === 'reel') setCell('平均視聴時間', insights.ig_reels_avg_watch_time || 0);

  // 履歴
  const histRow = historySheet.getLastRow() + 1;
  historySheet.getRange(histRow, 1, 1, 6).setValues([[
    m.timestamp ? new Date(m.timestamp) : '', m.id, new Date(),
    insights.reach || 0, insights.views || 0, insights.total_interactions || 0
  ]]);
}

/**
 * カーソルリセット（手動・トラブル時用）
 */
function resetBackfillCursor() {
  const ui = SpreadsheetApp.getUi();
  const ans = ui.alert(
    '取り込みカーソルをリセット',
    'BACKFILL_CURSOR と累積カウントをクリアします。\n' +
    '次回「📚 過去全件取り込み（API）」は最初のページから再走査します。\n\n' +
    '※ 既にシートに追加された行は削除されません（重複は appendXxxRow_ 側で防止済）。\n\n' +
    'リセットしますか？',
    ui.ButtonSet.OK_CANCEL
  );
  if (ans !== ui.Button.OK) return;
  const props = PropertiesService.getScriptProperties();
  props.deleteProperty(BACKFILL_PROP_KEY);
  props.deleteProperty(BACKFILL_PROGRESS_KEY);
  ui.alert('カーソルをリセットしました');
}
