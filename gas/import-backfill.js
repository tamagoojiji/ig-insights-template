/**
 * VPS一時バックフィルJSONインポート
 *
 * scripts/vps-backfill.sh が出力したJSONをスプシに一気に取り込む。
 * VPS は ssh ヒアドキュメントで一時実行されるだけで、何も残らない設計。
 */

function openBackfillJsonDialog() {
  const html = HtmlService.createHtmlOutputFromFile('import-backfill-dialog')
    .setWidth(720)
    .setHeight(560);
  SpreadsheetApp.getUi().showModalDialog(html, '📥 VPSバックフィルJSONをインポート');
}

/**
 * ダイアログから呼ばれるサーバサイドハンドラ
 * @param {string} jsonString - vps-backfill.sh の出力JSON文字列
 */
function importBackfillJson(jsonString) {
  if (!jsonString || jsonString.trim() === '') {
    throw new Error('JSONが空です');
  }
  let data;
  try {
    data = JSON.parse(jsonString);
  } catch (e) {
    throw new Error('JSONパース失敗: ' + e.message);
  }
  if (data.error) {
    throw new Error('VPS実行エラー: ' + data.error);
  }
  if (!data.media || !Array.isArray(data.media)) {
    throw new Error('media配列が見つかりません（期待形式: {"media":[...],"count":N}）');
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const feedSheet = ss.getSheetByName('📸 フィード') || getOrCreateSheet('📸 フィード');
  const feedHistorySheet = ss.getSheetByName('📸 フィード履歴') || getOrCreateSheet('📸 フィード履歴');
  const reelSheet = ss.getSheetByName('🎬 リール') || getOrCreateSheet('🎬 リール');
  const reelHistorySheet = ss.getSheetByName('🎬 リール履歴') || getOrCreateSheet('🎬 リール履歴');
  if (feedSheet.getLastRow() === 0) setupFeedHeader(feedSheet);
  if (feedHistorySheet.getLastRow() === 0) setupFeedHistoryHeader(feedHistorySheet);
  if (reelSheet.getLastRow() === 0) setupReelHeader(reelSheet);
  if (reelHistorySheet.getLastRow() === 0) setupReelHistoryHeader(reelHistorySheet);

  // 既存メディアIDセットを構築（重複防止）
  const existingFeedIds = collectExistingIds_(feedSheet);
  const existingReelIds = collectExistingIds_(reelSheet);

  const summary = { feed: 0, reels: 0, skipped: 0, errors: 0 };

  for (const m of data.media) {
    const insights = m._insights || {};
    try {
      if (m.media_type === 'VIDEO') {
        if (existingReelIds.has(String(m.id))) { summary.skipped++; continue; }
        appendMinimalRow_(reelSheet, reelHistorySheet, m, insights, 'reel');
        existingReelIds.add(String(m.id));
        summary.reels++;
      } else {
        if (existingFeedIds.has(String(m.id))) { summary.skipped++; continue; }
        appendMinimalRow_(feedSheet, feedHistorySheet, m, insights, 'feed');
        existingFeedIds.add(String(m.id));
        summary.feed++;
      }
    } catch (e) {
      summary.errors++;
      Logger.log('importBackfillJson skip ' + m.id + ': ' + e.message);
    }
  }

  const lines = [
    '📥 VPSバックフィルインポート完了',
    '',
    '📸 フィード追加: ' + summary.feed + '件',
    '🎬 リール追加: ' + summary.reels + '件',
    '⏭ 既存スキップ: ' + summary.skipped + '件',
  ];
  if (summary.errors > 0) {
    lines.push('⚠️ エラー: ' + summary.errors + '件（Loggerで詳細確認）');
  }
  const text = lines.join('\n');

  try { notifyDiscord(text, { kind: 'vps_import_done', bypassCooldown: true }); } catch (_) {}

  return { ok: true, summary: text };
}

function collectExistingIds_(sheet) {
  const set = new Set();
  if (!sheet || sheet.getLastRow() < 2) return set;
  const idCol = (typeof findColumn_ === 'function') ? findColumn_(sheet, 'メディアID') : 0;
  if (!idCol) return set;
  const ids = sheet.getRange(2, idCol, sheet.getLastRow() - 1, 1).getValues();
  ids.forEach(row => {
    const v = String(row[0] || '').trim();
    if (v) set.add(v);
  });
  return set;
}
