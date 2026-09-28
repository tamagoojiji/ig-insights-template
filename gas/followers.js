/**
 * フォロワー数推移の日次記録
 * VPS実装（follower_tracker.py）のGAS移植
 */

/**
 * 現在のフォロワー数を取得
 */
function fetchFollowersCount_() {
  const userId = getConfig('IG_USER_ID');
  if (!userId) throw new Error('ユーザーIDが未設定です');
  const data = igFetch('/' + userId, { fields: 'followers_count' });
  return Number(data.followers_count) || 0;
}

/**
 * 過去N日分のフォロワー増減（日次）を取得
 * 失敗時（新規アカウント・フォロワー100人未満等）は空配列を返す
 * @returns {Array<{value:number, end_time:string}>}
 */
function fetchFollowerDelta_(days) {
  days = days || 30;
  const userId = getConfig('IG_USER_ID');
  if (!userId) throw new Error('ユーザーIDが未設定です');
  const until = Math.floor(Date.now() / 1000);
  const since = until - days * 86400;
  try {
    const data = igFetch('/' + userId + '/insights', {
      metric: 'follower_count',
      period: 'day',
      since: since,
      until: until,
    });
    return data.data[0].values;
  } catch (e) {
    Logger.log('フォロワー増減取得エラー: ' + e.message);
    return [];
  }
}

/**
 * follower_count の end_time からインサイト日境界（アカウントTZの0時）を求める
 * @param {Array<{value:number, end_time:string}>} deltas fetchFollowerDelta_ の戻り値
 * @returns {{endMs:number, label:string}|null} endMs=境界epoch(ms) / label=その境界を終端とする日のラベル(yyyy/MM/dd)
 */
function followerDayBoundary_(deltas) {
  if (!deltas || !deltas.length) return null;
  const endMs = new Date(deltas[deltas.length - 1].end_time).getTime();
  if (isNaN(endMs)) return null;
  // シートの日付ラベルは end_time − 1日 を JST で表記したもの（buildFollowerHistory_ と同じ規約）
  const label = Utilities.formatDate(new Date(endMs - 86400000), 'Asia/Tokyo', 'yyyy/MM/dd');
  return { endMs: endMs, label: label };
}

/**
 * 指定日の「増加（フォロー数）／減少（フォロー解除数）」を取得する
 * follows_and_unfollows は metric_type=total_value のみ対応で、breakdown=follow_type で
 * フォロー / フォロー解除に分かれる（100フォロワー未満のアカウントでは返らない）。
 * 期間はアカウントTZの日境界（boundary）に揃え、完了済みの日だけ照会する
 * （未完了の日はレスポンスの breakdown が空で返るため）
 * @param {string} dateStr yyyy/MM/dd（シートの日付ラベル）
 * @param {{endMs:number, label:string}} boundary followerDayBoundary_ の戻り値
 * @returns {{gained:number, lost:number}|null} 取得できなければ null
 */
function fetchFollowGross_(dateStr, boundary) {
  if (!boundary) return null;
  const userId = getConfig('IG_USER_ID');
  if (!userId) throw new Error('ユーザーIDが未設定です');

  // dateStr と boundary.label の日数差から、その日の境界終端を求める
  const dayDiff = Math.round(
    (new Date(dateStr + ' 00:00:00').getTime() - new Date(boundary.label + ' 00:00:00').getTime()) / 86400000
  );
  const untilMs = boundary.endMs + dayDiff * 86400000;
  if (untilMs > Date.now()) return null; // その日はまだ完了していない

  try {
    const data = igFetch('/' + userId + '/insights', {
      metric: 'follows_and_unfollows',
      metric_type: 'total_value',
      period: 'day',
      breakdown: 'follow_type',
      since: Math.floor(untilMs / 1000) - 86400,
      until: Math.floor(untilMs / 1000),
    });
    return parseFollowGross_(data);
  } catch (e) {
    Logger.log('増加/減少取得エラー(' + dateStr + '): ' + e.message);
    return null;
  }
}

/**
 * follows_and_unfollows のレスポンスを {gained, lost} に変換する
 * dimension_values の想定: FOLLOWER=フォロー / UNFOLLOWER または NON_FOLLOWER=フォロー解除
 */
function parseFollowGross_(data) {
  const entry = data && data.data && data.data[0];
  const breakdowns = entry && entry.total_value && entry.total_value.breakdowns;
  if (!breakdowns || !breakdowns.length) return null;
  let gained = 0;
  let lost = 0;
  let matched = false;
  breakdowns.forEach(b => {
    (b.results || []).forEach(r => {
      const key = String((r.dimension_values || [])[0] || '').toUpperCase();
      const v = Number(r.value) || 0;
      if (key.indexOf('UNFOLLOW') >= 0 || key.indexOf('NON_FOLLOW') >= 0) { lost += v; matched = true; }
      else if (key.indexOf('FOLLOW') === 0) { gained += v; matched = true; }
    });
  });
  return matched ? { gained: gained, lost: lost } : null;
}

/**
 * 指定日の行に増加（D列）／減少（E列）を書き込む
 */
function writeFollowGrossForDate_(sheet, dateStr, boundary) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return null;
  const dates = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  let target = -1;
  for (let i = 0; i < dates.length; i++) {
    if (normalizeDateCell_(dates[i][0]) === dateStr) { target = i + 2; break; }
  }
  if (target < 0) return null;

  const gross = fetchFollowGross_(dateStr, boundary);
  if (!gross) return null;
  sheet.getRange(target, 4, 1, 2).setValues([[gross.gained, gross.lost]]);
  return gross;
}

/**
 * 新しい順に delta を逆算して、日付ごとの EOD フォロワー数を構築する
 * @returns {Array<{date:string, count:number, delta:number}>} 日付昇順
 */
function buildFollowerHistory_(current, deltas) {
  let running = current;
  const results = [];
  for (let i = deltas.length - 1; i >= 0; i--) {
    const entry = deltas[i];
    // end_time は計測期間の終端で表示日の翌日になりがちなため 1日引く
    const d = new Date(new Date(entry.end_time).getTime() - 86400 * 1000);
    const date = Utilities.formatDate(d, 'Asia/Tokyo', 'yyyy/MM/dd');
    const delta = Number(entry.value) || 0;
    results.push({ date: date, count: running, delta: delta });
    running -= delta;
  }
  results.reverse();
  return results;
}

/**
 * 日付セルを yyyy/MM/dd 文字列に正規化する
 * （A列が日付型化・ゼロ埋め無し表示になっても比較が壊れないように）
 */
function normalizeDateCell_(v) {
  if (v instanceof Date) {
    return Utilities.formatDate(v, 'Asia/Tokyo', 'yyyy/MM/dd');
  }
  const s = String(v).trim();
  const m = s.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
  if (!m) return s;
  const mm = ('0' + m[2]).slice(-2);
  const dd = ('0' + m[3]).slice(-2);
  return m[1] + '/' + mm + '/' + dd;
}

/**
 * 旧5列（日付/フォロワー数/増減/ソース/更新日時）のシートを
 * 7列（…/増減/増加/減少/ソース/更新日時）へ移行する（実行済みなら何もしない）
 */
function ensureFollowerSheetColumns_(sheet) {
  const width = Math.max(sheet.getLastColumn(), FOLLOWER_HEADERS.length);
  const header = sheet.getRange(1, 1, 1, width).getValues()[0].map(v => String(v).trim());
  if (header[3] === '増加' && header[4] === '減少') return;
  sheet.insertColumnsAfter(3, 2);
  setupFollowerHistoryHeader(sheet);
}

/**
 * 増減列（C列）を「その行のフォロワー数 − 前行のフォロワー数」で再計算する。
 * インサイトAPIの日次値に依存せず、実測のフォロワー数だけから求めるため
 * API側が 0 を返しても増減が 0 に潰れない（過去行の 0 もこれで自己修復される）。
 */
function recalcFollowerDeltas_(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 3) return;
  const counts = sheet.getRange(2, 2, lastRow - 1, 1).getValues();
  const deltas = sheet.getRange(2, 3, lastRow - 1, 1).getValues();
  for (let i = 1; i < counts.length; i++) {
    const cur = Number(counts[i][0]);
    const prev = Number(counts[i - 1][0]);
    if (counts[i][0] === '' || counts[i - 1][0] === '' || isNaN(cur) || isNaN(prev)) continue;
    deltas[i][0] = cur - prev;
  }
  sheet.getRange(2, 3, deltas.length, 1).setValues(deltas);
}

/**
 * フォロワー数を取得してシートに追記
 * @returns {{added:number, current:number, net:number, gross:({date:string, gained:number, lost:number}|null)}}
 */
function fetchAndWriteFollowers() {
  const current = fetchFollowersCount_();
  if (!current) {
    Logger.log('followers_count を取得できませんでした');
    return { added: 0, current: 0, net: 0 };
  }

  const deltas = fetchFollowerDelta_(30);
  const history = buildFollowerHistory_(current, deltas);

  const sheet = getOrCreateSheet('📊 フォロワー推移');
  if (sheet.getLastRow() === 0) setupFollowerHistoryHeader(sheet);
  ensureFollowerSheetColumns_(sheet);

  // 既存日付集合（日付型に変換されていても比較できるよう正規化して読む）
  const today = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy/MM/dd');
  const existing = new Set();
  let prevCount = null;
  let prevDate = '';
  const lastRow = sheet.getLastRow();
  if (lastRow >= 2) {
    const values = sheet.getRange(2, 1, lastRow - 1, 2).getValues();
    for (let i = 0; i < values.length; i++) {
      const dateStr = normalizeDateCell_(values[i][0]);
      if (!dateStr) continue;
      existing.add(dateStr);
      const c = Number(values[i][1]);
      if (dateStr < today && values[i][1] !== '' && !isNaN(c) && dateStr > prevDate) {
        prevDate = dateStr;
        prevCount = c;
      }
    }
  }

  // 今日の EOD 値として current を末尾に追加（API側に当日分がまだ無い場合のフォールバック）。
  // 増減は API 日次値ではなく「前回記録との差」＝実測から求める（API が 0 を返しても潰れない）
  if (!history.length || history[history.length - 1].date !== today) {
    history.push({ date: today, count: current, delta: prevCount === null ? 0 : current - prevCount });
  }

  const now = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy/MM/dd HH:mm');
  const rows = [];
  for (let i = 0; i < history.length; i++) {
    const item = history[i];
    if (existing.has(item.date)) continue;
    const source = item.date === today ? '現在値' : 'API逆算';
    rows.push([item.date, item.count, item.delta, '', '', source, now]);
  }

  if (rows.length) {
    sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, FOLLOWER_HEADERS.length).setValues(rows);
    if (sheet.getLastRow() >= 3) {
      sheet.getRange(2, 1, sheet.getLastRow() - 1, FOLLOWER_HEADERS.length).sort({ column: 1, ascending: true });
    }
  }

  // 増減はフォロワー数の差分で常に上書き（過去に 0 で記録された行もここで直る）
  recalcFollowerDeltas_(sheet);

  // 増加／減少（フォロー数・フォロー解除数）を記録する。
  // インサイト日境界（アカウントTZ）で完了済みの日だけ値が返るため、
  // 当日はスキップされることがあり、前日分は翌日の実行で確定値に埋まる
  const boundary = followerDayBoundary_(deltas);
  const grossToday = writeFollowGrossForDate_(sheet, today, boundary);
  const yesterday = Utilities.formatDate(new Date(Date.now() - 86400000), 'Asia/Tokyo', 'yyyy/MM/dd');
  const grossYesterday = writeFollowGrossForDate_(sheet, yesterday, boundary);
  // 通知用: 確定している直近日の値（当日が未確定なら前日）
  const gross = grossToday ? { date: today, gained: grossToday.gained, lost: grossToday.lost }
    : grossYesterday ? { date: yesterday, gained: grossYesterday.gained, lost: grossYesterday.lost }
    : null;

  let net;
  if (prevCount === null) {
    net = Math.max(0, history.length ? history[history.length - 1].delta : 0);
  } else {
    net = current - prevCount;
  }

  return { added: rows.length, current: current, net: net, gross: gross };
}

/**
 * 日次トリガーハンドラ
 * 同名トリガーの二重発火（別ユーザー所有トリガー等、ensureTriggers_ から見えないもの）でも
 * 通知が1日1回になるよう、Script Properties（スクリプト単位で全ユーザー共有）でガードする
 */
function recordFollowersJob() {
  const props = PropertiesService.getScriptProperties();
  const today = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy/MM/dd');
  const lock = LockService.getScriptLock();
  // ロックを取れない＝並行実行が処理中。setProperty 前の隙間をすり抜けて
  // 二重通知になるのを防ぐため、その回はスキップする
  if (!lock.tryLock(30000)) {
    Logger.log('recordFollowersJob: ロック取得失敗（並行実行が処理中のためスキップ）');
    return;
  }
  try {
    if (props.getProperty('FOLLOWERS_NOTIFIED_DATE') === today) {
      Logger.log('recordFollowersJob: 本日分は通知済みのためスキップ（トリガー二重発火）');
      return;
    }
    checkAndRefreshToken();
    const result = fetchAndWriteFollowers();
    const net = result.net;
    const grossText = result.gross ? '（' + result.gross.date.slice(5) + ' 増加' + result.gross.gained + ' / 減少' + result.gross.lost + '）' : '';
    notifyDiscord('📊 フォロワー: ' + (net >= 0 ? '+' + net : net) + '人' + grossText + '（現在' + result.current + '人）', { kind: 'followers_daily' });
    props.setProperty('FOLLOWERS_NOTIFIED_DATE', today);
  } catch (e) {
    Logger.log('recordFollowersJob エラー: ' + e.message + '\n' + e.stack);
    notifyDiscord('📊 フォロワー記録エラー: ' + e.message, { kind: 'followers_error', toError: true });
  } finally {
    try { lock.releaseLock(); } catch (_) {}
  }
}

/**
 * フォロワー数を記録（手動・メニュー用）
 */
function manualRecordFollowers() {
  const ui = SpreadsheetApp.getUi();
  try {
    checkAndRefreshToken();
    const result = fetchAndWriteFollowers();
    ui.alert(
      '記録完了！\n\n' +
      '👥 現在のフォロワー: ' + result.current + '人\n' +
      '📈 前回比: ' + result.net + '\n' +
      (result.gross ? '➕ 増加: ' + result.gross.gained + ' / ➖ 減少: ' + result.gross.lost + '（' + result.gross.date + '）\n' : '') +
      '📝 新規記録行: ' + result.added + '行'
    );
  } catch (e) {
    ui.alert('エラー: ' + e.message);
  }
}
