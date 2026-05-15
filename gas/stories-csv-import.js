/**
 * Meta Business Suite CSVインポート（ストーリーズ / リール / フィード自動振り分け）
 * - ヘッダー名でマッピング（CSVの列順変動に対応）
 * - 投稿タイプで自動判定: Instagramストーリーズ → ストーリーズ系、IGリール動画 → リール系、他 → フィード系
 * - 投稿IDで重複スキップ、投稿日時で Meta zip 由来行とマージ
 */

function openStoriesCsvDialog() {
  const html = HtmlService.createHtmlOutputFromFile('stories-csv-dialog')
    .setWidth(560).setHeight(540);
  SpreadsheetApp.getUi().showModalDialog(html, '📤 Business Suite CSVインポート');
}

/**
 * HTMLダイアログから呼ばれるエントリポイント
 * CSV の 投稿タイプ で自動判定して 3 系統（story / reel / feed）に振り分け
 */
function importStoriesFromCsvText(payload) {
  const csvText = payload && payload.csvText;
  if (!csvText) throw new Error('CSV本文が空です');

  const parsed = parseBusinessSuiteCsv_(csvText);
  if (parsed.rows.length === 0) throw new Error('CSV内にデータ行がありません');

  let result;
  if (parsed.kind === 'story') {
    result = applyStoryRows_(parsed.rows);
  } else if (parsed.kind === 'reel') {
    result = applyReelRows_(parsed.rows);
  } else {
    result = applyFeedRows_(parsed.rows);
  }

  setConfig('LAST_CSV_IMPORT_DATE', Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy/MM/dd'));
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    if (ss.getSheetByName('⚙️ 設定')) setupSettingsSheet();
  } catch (_) {}

  const kindLabel = parsed.kind === 'story' ? '📖 ストーリーズ' :
                    parsed.kind === 'reel' ? '🎬 リール' : '📸 フィード';
  const summary =
    '判定: ' + kindLabel + '（' + parsed.rows.length + '行）\n\n' +
    '✅ 新規追加: ' + result.added + ' 件\n' +
    '🔗 Meta zip行とマージ: ' + (result.merged || 0) + ' 件\n' +
    '⏭ 既存スキップ: ' + result.skipped + ' 件\n' +
    '💬 キャプション補完: ' + result.captionFilled + ' 件\n' +
    '📅 期間: ' + (result.firstDate || '-') + ' 〜 ' + (result.lastDate || '-');
  return { summary };
}

/**
 * CSV を生パースして共通フィールドを抽出
 */
function parseBusinessSuiteCsv_(csvText) {
  if (csvText.charCodeAt(0) === 0xFEFF) csvText = csvText.slice(1);
  csvText = csvText.replace(/\r\n?/g, '\n');

  const records = Utilities.parseCsv(csvText);
  if (records.length < 2) return { kind: 'feed', rows: [] };

  const header = records[0].map(s => String(s || '').trim().replace(/^\uFEFF/, ''));
  const idx = (name) => header.indexOf(name);

  const col = {
    id: idx('投稿ID'),
    publishedAt: idx('公開時間'),
    description: idx('説明'),
    duration: idx('時間(秒)'),
    postType: idx('投稿タイプ'),
    reach: idx('リーチ'),
    views: idx('ビュー'),
    likes: idx('いいね！の数'),
    shares: idx('シェア数'),
    comments: idx('コメント数'),
    saves: idx('保存数'),
    follows: idx('フォロー数'),
    replies: idx('返信'),
    navigation: idx('ナビゲーション'),
    profileVisits: idx('プロフィールへのアクセス'),
    stickerTaps: idx('スタンプのタップ')
  };

  if (col.id < 0 || col.publishedAt < 0) {
    throw new Error('必要な列（投稿ID / 公開時間）がCSVに見つかりません');
  }

  // 投稿タイプから kind を判定
  let kind = 'feed';
  if (col.postType >= 0) {
    for (let i = 1; i < records.length; i++) {
      const t = String(records[i][col.postType] || '');
      if (t.indexOf('ストーリーズ') >= 0 || t.toLowerCase().indexOf('stor') >= 0) { kind = 'story'; break; }
      if (t.indexOf('リール') >= 0 || t.toLowerCase().indexOf('reel') >= 0) { kind = 'reel'; break; }
      if (t.indexOf('投稿') >= 0 || t.toLowerCase().indexOf('post') >= 0 || t.indexOf('IG') >= 0) { kind = 'feed'; break; }
    }
  }

  const rows = [];
  for (let i = 1; i < records.length; i++) {
    const r = records[i];
    if (!r || !r[col.id]) continue;
    rows.push({
      id: String(r[col.id]).trim(),
      publishedAt: String(r[col.publishedAt] || '').trim(),
      description: col.description >= 0 ? String(r[col.description] || '').trim() : '',
      duration: toNum_(r[col.duration]),
      reach: toNum_(r[col.reach]),
      views: toNum_(r[col.views]),
      likes: toNum_(r[col.likes]),
      shares: toNum_(r[col.shares]),
      comments: toNum_(r[col.comments]),
      saves: toNum_(r[col.saves]),
      follows: toNum_(r[col.follows]),
      replies: toNum_(r[col.replies]),
      navigation: toNum_(r[col.navigation]),
      profileVisits: toNum_(r[col.profileVisits]),
      stickerTaps: toNum_(r[col.stickerTaps])
    });
  }
  return { kind, rows };
}

function toNum_(v) {
  if (v === undefined || v === null || v === '') return 0;
  const n = Number(String(v).replace(/,/g, ''));
  return isFinite(n) ? n : 0;
}

function parseUsDateTime_(s) {
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})/);
  if (!m) return null;
  return new Date(parseInt(m[3], 10), parseInt(m[1], 10) - 1, parseInt(m[2], 10),
    parseInt(m[4], 10), parseInt(m[5], 10));
}

function parseFlexibleDate_(v) {
  if (!v) return null;
  if (v instanceof Date) return v;
  const s = String(v).trim();
  const m1 = s.match(/^(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})\s+(\d{1,2}):(\d{2})/);
  if (m1) return new Date(+m1[1], +m1[2]-1, +m1[3], +m1[4], +m1[5]);
  return null;
}

/**
 * 履歴シート（idCol, tsCol固定）に対して ID→行 と 分単位TS→行 のマップを構築
 */
function buildIndexById_(sheet, idCol, tsCol) {
  const idToRow = new Map();
  const tsToRow = new Map();
  if (sheet.getLastRow() < 2) return { idToRow, tsToRow };
  const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, Math.max(idCol, tsCol)).getValues();
  data.forEach((r, i) => {
    const rowIdx = i + 2;
    const id = r[idCol - 1];
    const ts = r[tsCol - 1];
    if (id) idToRow.set(String(id), rowIdx);
    if (ts) {
      const date = (ts instanceof Date) ? ts : parseFlexibleDate_(ts);
      if (date) {
        const key = Math.round(date.getTime() / 60000);
        const isFakeId = id && String(id).indexOf('meta_') === 0;
        if (!tsToRow.has(key) || isFakeId) tsToRow.set(key, rowIdx);
      }
    }
  });
  return { idToRow, tsToRow };
}

/**
 * ストーリーズ取り込み（既存）
 */
function applyStoryRows_(rows) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const historySheet = ss.getSheetByName('📖 ストーリーズ履歴') || getOrCreateSheet('📖 ストーリーズ履歴');
  if (historySheet.getLastRow() === 0) setupStoriesHistoryHeader(historySheet);
  const histIdx = buildIndexById_(historySheet, 2, 1);

  const storiesSheet = ss.getSheetByName('📖 ストーリーズ');
  let storiesIdx = { idToRow: new Map(), tsToRow: new Map() };
  let ocrCol = 0;
  if (storiesSheet) {
    if (storiesSheet.getLastRow() === 0) setupStoriesHeader(storiesSheet);
    storiesIdx = buildIndexById_(storiesSheet, 10, 1);
    try { ocrCol = ensureStoriesOcrColumn_(storiesSheet); } catch (_) { ocrCol = 0; }
  }

  const now = new Date();
  const nowStr = Utilities.formatDate(now, 'Asia/Tokyo', 'yyyy/MM/dd HH:mm');
  const toAppendH = [];
  const toAppendM = [];
  let added = 0, skipped = 0, merged = 0, captionFilled = 0;
  let firstDate = null, lastDate = null;

  rows.forEach(r => {
    const publishedDate = parseUsDateTime_(r.publishedAt);
    const publishedStr = publishedDate ? Utilities.formatDate(publishedDate, 'Asia/Tokyo', 'yyyy/MM/dd HH:mm') : r.publishedAt;
    const elapsedMin = publishedDate ? Math.round((now - publishedDate) / 60000) : 0;
    const tsKey = publishedDate ? Math.round(publishedDate.getTime() / 60000) : null;
    if (publishedDate) {
      if (!firstDate || publishedDate < firstDate) firstDate = publishedDate;
      if (!lastDate || publishedDate > lastDate) lastDate = publishedDate;
    }

    if (histIdx.idToRow.has(r.id)) skipped++;
    else if (tsKey !== null && histIdx.tsToRow.has(tsKey)) {
      const row = histIdx.tsToRow.get(tsKey);
      historySheet.getRange(row, 2).setValue(r.id);
      historySheet.getRange(row, 3).setValue(nowStr);
      historySheet.getRange(row, 4).setValue(elapsedMin);
      historySheet.getRange(row, 5, 1, 6).setValues([[r.reach, r.views, r.replies, r.shares, r.navigation, r.profileVisits]]);
      histIdx.idToRow.set(r.id, row);
      histIdx.tsToRow.delete(tsKey);
      merged++;
    } else {
      toAppendH.push([publishedStr, r.id, nowStr, elapsedMin,
        r.reach, r.views, r.replies, r.shares, r.navigation, r.profileVisits]);
      histIdx.idToRow.set(r.id, -1);
      added++;
    }

    if (storiesSheet) {
      const target = storiesIdx.idToRow.get(r.id) || (tsKey !== null ? storiesIdx.tsToRow.get(tsKey) : null);
      if (target) {
        storiesSheet.getRange(target, 10).setValue(r.id);
        storiesSheet.getRange(target, 4, 1, 6).setValues([[r.reach, r.views, r.replies, r.shares, r.navigation, r.profileVisits]]);
        if (r.description && ocrCol > 0) {
          const cur = storiesSheet.getRange(target, ocrCol).getValue();
          if (!cur) { storiesSheet.getRange(target, ocrCol).setValue(r.description); captionFilled++; }
        }
      } else {
        toAppendM.push([publishedStr, '', 'IMAGE',
          r.reach, r.views, r.replies, r.shares, r.navigation, r.profileVisits, r.id]);
      }
    }
  });

  if (toAppendH.length > 0) historySheet.getRange(historySheet.getLastRow() + 1, 1, toAppendH.length, 10).setValues(toAppendH);
  if (toAppendM.length > 0 && storiesSheet) storiesSheet.getRange(storiesSheet.getLastRow() + 1, 1, toAppendM.length, 10).setValues(toAppendM);

  const fmt = (d) => d ? Utilities.formatDate(d, 'Asia/Tokyo', 'yyyy/MM/dd') : null;
  return { added, skipped, merged, captionFilled, firstDate: fmt(firstDate), lastDate: fmt(lastDate) };
}

/**
 * リール取り込み: 🎬 リール履歴 + 🎬 リール
 */
function applyReelRows_(rows) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const histSheet = ss.getSheetByName('🎬 リール履歴') || getOrCreateSheet('🎬 リール履歴');
  if (histSheet.getLastRow() === 0) setupReelHistoryHeader(histSheet);
  const histIdx = buildIndexById_(histSheet, 2, 1);

  const mainSheet = ss.getSheetByName('🎬 リール');
  let mainIdx = { idToRow: new Map(), tsToRow: new Map() };
  if (mainSheet) {
    if (mainSheet.getLastRow() === 0) setupReelHeader(mainSheet);
    mainIdx = buildIndexById_(mainSheet, 11, 1);
  }

  const now = new Date();
  const nowStr = Utilities.formatDate(now, 'Asia/Tokyo', 'yyyy/MM/dd HH:mm');
  const toAppendH = [];
  const toAppendM = [];
  let added = 0, skipped = 0, merged = 0, captionFilled = 0;
  let firstDate = null, lastDate = null;

  rows.forEach(r => {
    const publishedDate = parseUsDateTime_(r.publishedAt);
    const publishedStr = publishedDate ? Utilities.formatDate(publishedDate, 'Asia/Tokyo', 'yyyy/MM/dd HH:mm') : r.publishedAt;
    const elapsedMin = publishedDate ? Math.round((now - publishedDate) / 60000) : 0;
    const tsKey = publishedDate ? Math.round(publishedDate.getTime() / 60000) : null;
    const totalReactions = r.likes + r.comments + r.saves + r.shares;
    if (publishedDate) {
      if (!firstDate || publishedDate < firstDate) firstDate = publishedDate;
      if (!lastDate || publishedDate > lastDate) lastDate = publishedDate;
    }

    // 履歴: 投稿日時, メディアID, 取得時刻, 経過分, 視聴数, いいね数, コメント数, 保存数, リーチ, シェア数, 総反応数
    if (histIdx.idToRow.has(r.id)) skipped++;
    else if (tsKey !== null && histIdx.tsToRow.has(tsKey)) {
      const row = histIdx.tsToRow.get(tsKey);
      histSheet.getRange(row, 2).setValue(r.id);
      histSheet.getRange(row, 3).setValue(nowStr);
      histSheet.getRange(row, 4).setValue(elapsedMin);
      histSheet.getRange(row, 5, 1, 7).setValues([[r.views, r.likes, r.comments, r.saves, r.reach, r.shares, totalReactions]]);
      histIdx.idToRow.set(r.id, row);
      histIdx.tsToRow.delete(tsKey);
      merged++;
    } else {
      toAppendH.push([publishedStr, r.id, nowStr, elapsedMin,
        r.views, r.likes, r.comments, r.saves, r.reach, r.shares, totalReactions]);
      histIdx.idToRow.set(r.id, -1);
      added++;
    }

    // メイン: 投稿日時, サムネ, キャプション, 視聴数, いいね数, コメント数, 保存数, リーチ, シェア数, エンゲ率, メディアID
    if (mainSheet) {
      const target = mainIdx.idToRow.get(r.id) || (tsKey !== null ? mainIdx.tsToRow.get(tsKey) : null);
      const engRate = r.reach > 0 ? Math.round(totalReactions / r.reach * 10000) / 100 : 0;
      if (target) {
        mainSheet.getRange(target, 11).setValue(r.id);
        mainSheet.getRange(target, 4, 1, 7).setValues([[r.views, r.likes, r.comments, r.saves, r.reach, r.shares, engRate]]);
        if (r.description) {
          const cur = mainSheet.getRange(target, 3).getValue();
          if (!cur) { mainSheet.getRange(target, 3).setValue(r.description); captionFilled++; }
        }
      } else {
        toAppendM.push([publishedStr, '', r.description,
          r.views, r.likes, r.comments, r.saves, r.reach, r.shares, engRate, r.id]);
        if (r.description) captionFilled++;
      }
    }
  });

  if (toAppendH.length > 0) histSheet.getRange(histSheet.getLastRow() + 1, 1, toAppendH.length, 11).setValues(toAppendH);
  if (toAppendM.length > 0 && mainSheet) mainSheet.getRange(mainSheet.getLastRow() + 1, 1, toAppendM.length, 11).setValues(toAppendM);

  const fmt = (d) => d ? Utilities.formatDate(d, 'Asia/Tokyo', 'yyyy/MM/dd') : null;
  return { added, skipped, merged, captionFilled, firstDate: fmt(firstDate), lastDate: fmt(lastDate) };
}

/**
 * フィード取り込み: 📸 フィード履歴 + 📸 フィード
 */
function applyFeedRows_(rows) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const histSheet = ss.getSheetByName('📸 フィード履歴') || getOrCreateSheet('📸 フィード履歴');
  if (histSheet.getLastRow() === 0) setupFeedHistoryHeader(histSheet);
  const histIdx = buildIndexById_(histSheet, 2, 1);

  const mainSheet = ss.getSheetByName('📸 フィード');
  let mainIdx = { idToRow: new Map(), tsToRow: new Map() };
  if (mainSheet) {
    if (mainSheet.getLastRow() === 0) setupFeedHeader(mainSheet);
    mainIdx = buildIndexById_(mainSheet, 11, 1);
  }

  const now = new Date();
  const nowStr = Utilities.formatDate(now, 'Asia/Tokyo', 'yyyy/MM/dd HH:mm');
  const toAppendH = [];
  const toAppendM = [];
  let added = 0, skipped = 0, merged = 0, captionFilled = 0;
  let firstDate = null, lastDate = null;

  rows.forEach(r => {
    const publishedDate = parseUsDateTime_(r.publishedAt);
    const publishedStr = publishedDate ? Utilities.formatDate(publishedDate, 'Asia/Tokyo', 'yyyy/MM/dd HH:mm') : r.publishedAt;
    const elapsedMin = publishedDate ? Math.round((now - publishedDate) / 60000) : 0;
    const tsKey = publishedDate ? Math.round(publishedDate.getTime() / 60000) : null;
    const totalReactions = r.likes + r.comments + r.saves + r.shares;
    if (publishedDate) {
      if (!firstDate || publishedDate < firstDate) firstDate = publishedDate;
      if (!lastDate || publishedDate > lastDate) lastDate = publishedDate;
    }

    // 履歴: 投稿日時, メディアID, 取得時刻, 経過分, いいね数, コメント数, 保存数, リーチ, 視聴数, 総反応数
    if (histIdx.idToRow.has(r.id)) skipped++;
    else if (tsKey !== null && histIdx.tsToRow.has(tsKey)) {
      const row = histIdx.tsToRow.get(tsKey);
      histSheet.getRange(row, 2).setValue(r.id);
      histSheet.getRange(row, 3).setValue(nowStr);
      histSheet.getRange(row, 4).setValue(elapsedMin);
      histSheet.getRange(row, 5, 1, 6).setValues([[r.likes, r.comments, r.saves, r.reach, r.views, totalReactions]]);
      histIdx.idToRow.set(r.id, row);
      histIdx.tsToRow.delete(tsKey);
      merged++;
    } else {
      toAppendH.push([publishedStr, r.id, nowStr, elapsedMin,
        r.likes, r.comments, r.saves, r.reach, r.views, totalReactions]);
      histIdx.idToRow.set(r.id, -1);
      added++;
    }

    // メイン: 投稿日時, サムネ, タイプ, キャプション, いいね数, コメント数, 保存数, リーチ, 視聴数, エンゲ率, メディアID
    if (mainSheet) {
      const target = mainIdx.idToRow.get(r.id) || (tsKey !== null ? mainIdx.tsToRow.get(tsKey) : null);
      const engRate = r.reach > 0 ? Math.round(totalReactions / r.reach * 10000) / 100 : 0;
      const mediaType = r.duration > 0 ? 'VIDEO' : 'IMAGE';
      if (target) {
        mainSheet.getRange(target, 11).setValue(r.id);
        mainSheet.getRange(target, 5, 1, 6).setValues([[r.likes, r.comments, r.saves, r.reach, r.views, engRate]]);
        if (r.description) {
          const cur = mainSheet.getRange(target, 4).getValue();
          if (!cur) { mainSheet.getRange(target, 4).setValue(r.description); captionFilled++; }
        }
      } else {
        toAppendM.push([publishedStr, '', mediaType, r.description,
          r.likes, r.comments, r.saves, r.reach, r.views, engRate, r.id]);
        if (r.description) captionFilled++;
      }
    }
  });

  if (toAppendH.length > 0) histSheet.getRange(histSheet.getLastRow() + 1, 1, toAppendH.length, 10).setValues(toAppendH);
  if (toAppendM.length > 0 && mainSheet) mainSheet.getRange(mainSheet.getLastRow() + 1, 1, toAppendM.length, 11).setValues(toAppendM);

  const fmt = (d) => d ? Utilities.formatDate(d, 'Asia/Tokyo', 'yyyy/MM/dd') : null;
  return { added, skipped, merged, captionFilled, firstDate: fmt(firstDate), lastDate: fmt(lastDate) };
}

/**
 * 月次のCSVインポートリマインダー（毎月1日9時に発火）
 */
function csvReminderJob() {
  const lastImport = getConfig('LAST_CSV_IMPORT_DATE');
  let message;
  if (!lastImport) {
    message = '📅 **Business Suite CSVリマインダー**\n' +
      'まだCSVをインポートしていません。\n' +
      'Meta Business Suite からストーリーズ/フィード/リールのCSVをDLして、メニュー\n' +
      '`📊 Instagram Insights → 📤 Business Suite CSVインポート`\n' +
      'を実行してください。\n' +
      '→ https://business.facebook.com/latest/posts/';
  } else {
    const last = new Date(lastImport);
    const days = Math.floor((Date.now() - last.getTime()) / 86400000);
    if (days < 25) return;
    message = '📅 **Business Suite CSVリマインダー**\n' +
      '前回のCSVインポートから ' + days + ' 日経過しました。\n' +
      'Meta Business Suiteから最新分をDLしてアップしてください。\n' +
      '→ https://business.facebook.com/latest/posts/';
  }
  notifyDiscord(message, { kind: 'csv_reminder', bypassCooldown: true });
}

function checkCsvReminderOnOpen_() {
  const lastImport = getConfig('LAST_CSV_IMPORT_DATE');
  if (!lastImport) {
    SpreadsheetApp.getActiveSpreadsheet().toast(
      'Meta Business SuiteからCSV (ストーリーズ/フィード/リール) をDL → 📤 Business Suite CSVインポート を実行',
      '📅 CSV未取得', 10
    );
    return;
  }
  const last = new Date(lastImport);
  const days = Math.floor((Date.now() - last.getTime()) / 86400000);
  if (days >= 30) {
    SpreadsheetApp.getActiveSpreadsheet().toast(
      '前回のCSVインポートから ' + days + ' 日経過しています。最新分を取り込みましょう',
      '📅 CSVリマインダー', 10
    );
  }
}
