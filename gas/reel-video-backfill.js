// ==========
// 過去リールの動画(mp4)一括保存
// 5分おきトリガーで続きを処理し、全行終わったら自分でトリガーを削除する（ocr.js の自動OCRと同じ方式）
//
// 進捗は行番号で持たない。autoFetch が完走のたびに「🎬 リール」シートを投稿日降順で
// ソートする（feed.js:301）ため、行番号カーソルは容易にズレる。代わりに毎tickで
// 「動画URLが空の行」を洗い直し、シート自体を進捗の唯一の記録とする。
// ==========

// 自動保存された動画の置き場。週1回ここを見て、中身に応じた名前を付けて親フォルダへ移す
const REEL_VIDEO_INBOX = '名前つけ待ち';

const REEL_VIDEO_TOTALS_KEY = 'REEL_VIDEO_BACKFILL_TOTALS';
const REEL_VIDEO_STARTED_KEY = 'REEL_VIDEO_BACKFILL_STARTED_AT';
const REEL_VIDEO_LAST_TICK_KEY = 'REEL_VIDEO_BACKFILL_LAST_TICK';
const REEL_VIDEO_RESULT_KEY = 'REEL_VIDEO_BACKFILL_RESULT';
const REEL_VIDEO_STOPPED_KEY = 'REEL_VIDEO_BACKFILL_STOPPED_AT';

/**
 * 一括保存を開始（5分おきに続きを処理し、完走したら自動停止）
 */
function startReelVideoBackfill() {
  const ui = SpreadsheetApp.getUi();

  if (!getConfig('REEL_VIDEO_FOLDER_ID')) {
    ui.alert(
      '❌ 動画の保存先フォルダが未設定です\n\n' +
      'メニュー「🎥 リール動画フォルダIDを設定」から、共有されたドライブフォルダのURLまたはIDを登録してください。'
    );
    return;
  }

  const res = ui.alert(
    '🎥 過去リールの動画(mp4)を一括保存',
    '「🎬 リール」シートのうち、動画URLが空の行の mp4 をドライブに保存します。\n\n' +
    '5分おきに自動で続きを処理し、全件終わったら自動で止まります。\n' +
    '⚠️ 1本あたり5〜30MBあるため、ドライブの空き容量にご注意ください。\n\n' +
    '開始しますか？',
    ui.ButtonSet.YES_NO
  );
  if (res !== ui.Button.YES) return;

  stopReelVideoBackfillSilent_();

  const props = PropertiesService.getScriptProperties();
  props.deleteProperty(REEL_VIDEO_TOTALS_KEY);
  props.deleteProperty(REEL_VIDEO_RESULT_KEY);
  props.deleteProperty(REEL_VIDEO_STOPPED_KEY);
  props.setProperty(REEL_VIDEO_STARTED_KEY, new Date().toISOString());

  ScriptApp.newTrigger('reelVideoBackfillTick_').timeBased().everyMinutes(5).create();

  ui.alert(
    '🎥 リール動画の一括保存を開始しました\n\n' +
    '5分おきに続きを処理します。\n' +
    '📈 進捗はメニュー「📈 リール動画保存の進捗」で確認できます。'
  );

  reelVideoBackfillTick_();
}

/**
 * トリガーから呼ばれる入口。mp4のダウンロードは1本あたり数秒かかり前回tickが延びやすいので、
 * ScriptLock で直列化して重複起動を防ぐ（同名ファイルの二重作成・進捗の上書き対策）。
 */
function reelVideoBackfillTick_() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) {
    Logger.log('リール動画保存: 他の実行が処理中のためこのtickはスキップ');
    return;
  }
  try {
    reelVideoBackfillRun_();
  } finally {
    lock.releaseLock();
  }
}

/**
 * 投稿日時からメディアを引き当てる。シートの分単位の表記（yyyy/MM/dd HH:mm）とAPIの秒付き
 * timestamp を突き合わせるため、前後1分も許容する。
 */
function resolveReelMedia_(byId, byMinute, mediaId, postedAt) {
  if (byId[mediaId]) return byId[mediaId];
  if (!postedAt) return null;
  const t = (postedAt instanceof Date) ? postedAt.getTime() : new Date(String(postedAt)).getTime();
  if (isNaN(t)) return null;
  const base = Math.floor(t / 60000);
  return byMinute[base] || byMinute[base - 1] || byMinute[base + 1] || null;
}

/**
 * 本体。動画URLが空の行だけ処理し、残りが無くなったら自分を止める。
 * Drive保存に失敗した行・APIに存在しない行は動画URLが空のまま残り、その回は「処理済み」として
 * 完了する（失敗のたびに止まらない）。空欄が残った場合はメニューから再実行すれば再試行される。
 */
function reelVideoBackfillRun_() {
  const props = PropertiesService.getScriptProperties();
  getExecutionStart_();
  props.setProperty(REEL_VIDEO_LAST_TICK_KEY, new Date().toISOString());

  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('🎬 リール');
  if (!sheet || sheet.getLastRow() < 2) {
    Logger.log('リール動画保存: 対象シートが空のため終了');
    finishReelVideoBackfill_(null);
    return;
  }
  ensureReelVideoColumn_(sheet);

  const idCol = findColumn_(sheet, 'メディアID');
  const videoCol = findColumn_(sheet, '動画URL');
  const tsCol = findColumn_(sheet, '投稿日時');
  if (idCol < 1 || videoCol < 1 || tsCol < 1) {
    Logger.log('リール動画保存: 必須列（メディアID/動画URL/投稿日時）が見つかりません');
    finishReelVideoBackfill_(null);
    return;
  }

  let totals = null;
  try {
    totals = JSON.parse(props.getProperty(REEL_VIDEO_TOTALS_KEY) || 'null');
  } catch (_) {
    totals = null;
  }
  if (!totals) totals = { saved: 0, errors: 0, notFound: 0, noUrl: 0 };
  if (totals.notFound === undefined) totals.notFound = 0;
  if (totals.noUrl === undefined) totals.noUrl = 0;

  // 未保存の行を毎tickで洗い直す（行番号は保持しない）
  const numRows = sheet.getLastRow() - 1;
  const ids = sheet.getRange(2, idCol, numRows, 1).getValues();
  const videos = sheet.getRange(2, videoCol, numRows, 1).getValues();
  const timestamps = sheet.getRange(2, tsCol, numRows, 1).getValues();
  const pending = [];
  for (let i = 0; i < numRows; i++) {
    const mediaId = String(ids[i][0] || '').trim();
    if (!mediaId) continue;
    if (String(videos[i][0] || '').trim()) continue;
    pending.push({ mediaId: mediaId, row: i + 2, postedAt: timestamps[i][0] });
  }

  if (pending.length === 0) {
    finishReelVideoBackfill_(totals);
    return;
  }

  // メディア一覧を1回だけ取得する。fetchAllMedia の fields には media_url が含まれる
  // （instagram.js:39）ため、1件ずつの個別GETは不要でAPI呼び出しも数回で済む。
  // シートのメディアIDには Business Suite CSV 由来の引けないIDが混ざる
  // （stories-csv-import.js:303 が CSV の投稿IDをメディアID列へ書く）ので、
  // ID照合に加えて投稿日時でも突き合わせる。
  let media = null;
  try {
    media = fetchAllMedia(Infinity);
  } catch (e) {
    Logger.log(`リール動画保存: メディア一覧の取得に失敗（次のtickで再試行）: ${e.message}`);
    props.setProperty(REEL_VIDEO_TOTALS_KEY, JSON.stringify(totals));
    return;
  }

  const byId = {};
  const byMinute = {};
  let withUrl = 0;
  media.forEach(m => {
    if (m.media_type !== 'VIDEO') return;
    if (m.media_url) withUrl++;
    byId[String(m.id)] = m;
    const t = new Date(m.timestamp).getTime();
    if (!isNaN(t)) byMinute[Math.floor(t / 60000)] = m;
  });
  Logger.log(`リール動画保存: API上の動画 ${Object.keys(byId).length}件（うち media_url あり ${withUrl}件）/ 未保存 ${pending.length}行`);

  let deferred = false;

  for (let i = 0; i < pending.length; i++) {
    if (isTimeUp_()) {
      props.setProperty(REEL_VIDEO_TOTALS_KEY, JSON.stringify(totals));
      Logger.log(`リール動画保存: 時間切れで中断（保存${totals.saved} 失敗${totals.errors} / 未処理${pending.length - i}）`);
      return; // 次のトリガーで続行
    }

    const mediaId = pending[i].mediaId;
    const row = pending[i].row;

    // 走査中に autoFetch がソートを走らせた可能性があるため、書き込み前に行の同一性を確認する
    const rowId = String(sheet.getRange(row, idCol).getValue() || '').trim();
    if (rowId !== mediaId) {
      Logger.log(`リール動画保存: 行がずれたため見送り (${mediaId})。次のtickで拾い直します`);
      deferred = true;
      continue;
    }

    try {
      const m = resolveReelMedia_(byId, byMinute, mediaId, pending[i].postedAt);

      if (!m) {
        // APIの一覧に無い＝削除済み・アーカイブ済みなど
        Logger.log(`リール動画保存: APIに該当メディアがありません (id=${mediaId} / 投稿日時=${pending[i].postedAt})`);
        totals.notFound++;
      } else if (!m.media_url) {
        // 投稿はAPI上に存在するが media_url が提供されない。個別GETしても HTTP200 で
        // media_url だけが欠ける（2026-08-12 実測）。音楽付きリールは著作権保護のため
        // Metaが動画URLを返さないとみられ、Graph API では回収できない。
        Logger.log(`リール動画保存: APIが動画URLを提供していません (id=${m.id} / 投稿日時=${pending[i].postedAt})`);
        totals.noUrl++;
      } else {
        // ファイル名には API 側の正しいメディアIDを使う
        const driveUrl = saveVideoToDrive(m.media_url, m.id, m.timestamp);
        if (!driveUrl) {
          totals.errors++;
        } else if (String(sheet.getRange(row, idCol).getValue() || '').trim() !== mediaId) {
          // ダウンロード中（数秒〜数十秒）に autoFetch がソートした場合、row は別メディアを指す。
          // 誤った行に書かず次tickへ回す。mp4 は保存済みなので、次tickは
          // saveVideoToDrive の既存ファイルチェックで即座に同じURLを引ける
          Logger.log(`リール動画保存: 保存中に行がずれたため書き込み見送り (${mediaId})。次のtickで反映します`);
          deferred = true;
        } else {
          sheet.getRange(row, videoCol).setValue(driveUrl);
          totals.saved++;
        }
      }
    } catch (e) {
      Logger.log(`リール動画保存エラー (${mediaId}): ${e.message}`);
      totals.errors++;
    }

    if ((i + 1) % 50 === 0) props.setProperty(REEL_VIDEO_TOTALS_KEY, JSON.stringify(totals));
  }

  if (deferred) {
    // 行ズレで見送った行が残っている → 完了扱いにせず次のtickへ
    props.setProperty(REEL_VIDEO_TOTALS_KEY, JSON.stringify(totals));
    return;
  }

  finishReelVideoBackfill_(totals);
}

/**
 * 完走時の後始末（トリガー削除・進捗削除・Discord通知）
 */
function finishReelVideoBackfill_(totals) {
  stopReelVideoBackfillSilent_();
  const props = PropertiesService.getScriptProperties();
  props.deleteProperty(REEL_VIDEO_TOTALS_KEY);
  if (!totals) return;

  props.setProperty(REEL_VIDEO_RESULT_KEY, JSON.stringify(totals));
  const notFound = totals.notFound || 0;
  const noUrl = totals.noUrl || 0;
  const msg = '🎥 リール動画(mp4)の一括保存が完了しました\n' +
    `保存: ${totals.saved}件 / 失敗: ${totals.errors}件 / 動画URL非提供: ${noUrl}件 / API上に無し: ${notFound}件` +
    (totals.errors > 0 ? '\n※ 失敗した行は動画URLが空のままです。メニューから再実行すると再試行します' : '') +
    (noUrl > 0 ? '\n※「動画URL非提供」は投稿自体はInstagramに残っているが、Graph APIが動画URLを返さないものです（音楽付きリール等）。再実行しても取得できないため、Meta公式のデータダウンロードから取り込む必要があります' : '') +
    (notFound > 0 ? '\n※「API上に無し」は削除済み・アーカイブ済みなどでInstagram側に残っていない投稿です' : '');
  Logger.log(msg);
  try {
    notifyDiscord(msg);
  } catch (e) {
    Logger.log(`Discord通知失敗: ${e.message}`);
  }
}

/**
 * 一括保存を手動停止
 */
function stopReelVideoBackfill() {
  stopReelVideoBackfillSilent_();
  PropertiesService.getScriptProperties().setProperty(REEL_VIDEO_STOPPED_KEY, new Date().toISOString());
  SpreadsheetApp.getUi().alert(
    '🛑 リール動画の一括保存を停止しました\n\n' +
    '再度「🎥 過去リールの動画(mp4)を一括保存」を実行すると、動画URLが空の行だけ処理を再開します。'
  );
}

function stopReelVideoBackfillSilent_() {
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === 'reelVideoBackfillTick_') ScriptApp.deleteTrigger(t);
  });
}

/**
 * 進捗をアラート表示
 */
function showReelVideoBackfillProgress() {
  const props = PropertiesService.getScriptProperties();
  const triggerActive = ScriptApp.getProjectTriggers().some(t => t.getHandlerFunction() === 'reelVideoBackfillTick_');

  let totals = null;
  try { totals = JSON.parse(props.getProperty(REEL_VIDEO_TOTALS_KEY) || 'null'); } catch (_) { totals = null; }
  let result = null;
  try { result = JSON.parse(props.getProperty(REEL_VIDEO_RESULT_KEY) || 'null'); } catch (_) { result = null; }

  // 現時点の未保存行を即時カウント
  let remaining = '(計算不可)';
  try {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('🎬 リール');
    if (sheet && sheet.getLastRow() >= 2) {
      const idCol = findColumn_(sheet, 'メディアID');
      const videoCol = findColumn_(sheet, '動画URL');
      if (idCol > 0 && videoCol > 0) {
        const ids = sheet.getRange(2, idCol, sheet.getLastRow() - 1, 1).getValues();
        const videos = sheet.getRange(2, videoCol, sheet.getLastRow() - 1, 1).getValues();
        let pending = 0;
        for (let i = 0; i < ids.length; i++) {
          if (ids[i][0] && !String(videos[i][0] || '').trim()) pending++;
        }
        remaining = String(pending);
      }
    }
  } catch (e) {
    remaining = '(エラー: ' + e.message + ')';
  }

  const fmt = (iso) => {
    if (!iso) return '(なし)';
    try { return Utilities.formatDate(new Date(iso), 'Asia/Tokyo', 'yyyy/MM/dd HH:mm:ss'); }
    catch (_) { return iso; }
  };

  const lines = [
    '📈 リール動画(mp4)保存の進捗',
    '',
    'トリガー稼働中: ' + (triggerActive ? '✅ ON（5分おき）' : '⏹ OFF'),
    '',
    '開始時刻: ' + fmt(props.getProperty(REEL_VIDEO_STARTED_KEY)),
    '最終Tick: ' + fmt(props.getProperty(REEL_VIDEO_LAST_TICK_KEY)),
    '停止時刻: ' + fmt(props.getProperty(REEL_VIDEO_STOPPED_KEY)),
    '',
    '未保存の残り行数: ' + remaining,
  ];

  if (totals) {
    lines.push('', `今回の実行: 保存${totals.saved} / 失敗${totals.errors} / 動画URL非提供${totals.noUrl || 0} / API上に無し${totals.notFound || 0}`);
  }
  if (result) {
    lines.push('', `前回の完了結果: 保存${result.saved} / 失敗${result.errors} / 動画URL非提供${result.noUrl || 0} / API上に無し${result.notFound || 0}`);
  }

  SpreadsheetApp.getUi().alert(lines.join('\n'));
}

/**
 * Driveの動画フォルダを走査し、「🎬 リール」シートの「動画URL」列を埋める。
 * Metaの公式エクスポートから手動アップロードしたmp4（YYYYMMDD_<mediaId>.mp4）を
 * シートに紐付けるための関数。APIは使わないので media_url 非提供のリールも埋まる。
 *
 * 突き合わせは ①メディアID ②投稿日（その日にDrive側が1件だけのときのみ）の順。
 * 同じ日に複数ある場合は取り違えを避けてスキップし、件数をログに残す。
 */
function linkReelVideosFromDrive() {
  const folderId = getConfig('REEL_VIDEO_FOLDER_ID');
  if (!folderId) {
    alertSafe_('❌ REEL_VIDEO_FOLDER_ID が未設定です');
    return;
  }

  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('🎬 リール');
  if (!sheet || sheet.getLastRow() < 2) {
    alertSafe_('🎬 リール シートにデータがありません');
    return;
  }
  ensureReelVideoColumn_(sheet);

  const idCol = findColumn_(sheet, 'メディアID');
  const videoCol = findColumn_(sheet, '動画URL');
  const tsCol = findColumn_(sheet, '投稿日時');
  if (idCol < 1 || videoCol < 1 || tsCol < 1) {
    alertSafe_('❌ 必須列（メディアID/動画URL/投稿日時）が見つかりません');
    return;
  }

  // Drive を走査してファイル名から索引を作る
  const byId = {};
  const byDate = {};
  let fileCount = 0;
  const scan = (folder) => {
    const files = folder.getFiles();
    while (files.hasNext()) {
      const f = files.next();
      const m = f.getName().match(/^(\d{8}|nodate)_(?:.*_)?(\d+)\.mp4$/);
      if (!m) continue;
      fileCount++;
      const url = f.getUrl();
      byId[m[2]] = url;
      if (m[1] !== 'nodate') {
        (byDate[m[1]] = byDate[m[1]] || []).push(url);
      }
    }
  };
  const root = DriveApp.getFolderById(folderId);
  scan(root);
  // 自動保存分は「名前つけ待ち」に入るので、そこも見る
  const subs = root.getFoldersByName(REEL_VIDEO_INBOX);
  if (subs.hasNext()) scan(subs.next());

  // シートを一括で読み、埋まっていない行だけ解決する
  const numRows = sheet.getLastRow() - 1;
  const ids = sheet.getRange(2, idCol, numRows, 1).getValues();
  const videos = sheet.getRange(2, videoCol, numRows, 1).getValues();
  const stamps = sheet.getRange(2, tsCol, numRows, 1).getValues();

  let byIdHit = 0, byDateHit = 0, ambiguous = 0, notFound = 0, already = 0;
  for (let i = 0; i < numRows; i++) {
    const mediaId = String(ids[i][0] || '').trim();
    if (!mediaId) continue;
    if (String(videos[i][0] || '').trim()) { already++; continue; }

    if (byId[mediaId]) {
      videos[i][0] = byId[mediaId];
      byIdHit++;
      continue;
    }

    const raw = stamps[i][0];
    const d = (raw instanceof Date) ? raw : new Date(String(raw));
    if (isNaN(d.getTime())) { notFound++; continue; }
    const key = Utilities.formatDate(d, 'Asia/Tokyo', 'yyyyMMdd');
    const cand = byDate[key];
    if (!cand) { notFound++; continue; }
    if (cand.length > 1) { ambiguous++; continue; }
    videos[i][0] = cand[0];
    byDateHit++;
  }

  sheet.getRange(2, videoCol, numRows, 1).setValues(videos);

  const msg =
    'Drive動画URLの紐付けが完了しました\n\n' +
    `Drive内の動画: ${fileCount}件\n` +
    `メディアIDで一致: ${byIdHit}件\n` +
    `投稿日で一致: ${byDateHit}件\n` +
    `同日に複数あり見送り: ${ambiguous}件\n` +
    `該当なし: ${notFound}件\n` +
    `すでに入力済み: ${already}件`;
  Logger.log(msg);
  alertSafe_('🔗 ' + msg);
  return msg;
}

/**
 * UIが使える文脈（スプレッドシートのメニュー）ならアラート、
 * GASエディタからの直接実行ならログに落とす。
 */
function alertSafe_(msg) {
  try {
    SpreadsheetApp.getUi().alert(msg);
  } catch (e) {
    Logger.log('(UIなし) ' + msg);
  }
}
