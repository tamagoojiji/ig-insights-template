/**
 * webapp.js と一緒に後付けする列追加（scripts/install-webapp.sh で既存 GAS へコピーされる）
 */

/**
 * 「🎬 リール」シートに「平均視聴時間」列（秒）が無ければ末尾に追加。
 * 既存データ・既存の列番号に影響しない非破壊マイグレーション。
 */
function ensureReelAvgWatchColumn_(sheet) {
  if (!sheet || sheet.getLastColumn() === 0) return;
  if (findColumn_(sheet, '平均視聴時間') > 0) return;
  const newCol = sheet.getLastColumn() + 1;
  sheet.getRange(1, newCol).setValue('平均視聴時間')
    .setFontWeight('bold').setBackground('#EA4335').setFontColor('#FFFFFF');
}

/**
 * Business Suite 由来の閲覧者内訳4列が無ければ末尾に追加。
 * 既存データ・既存の列番号に影響しない非破壊マイグレーション。
 */
function ensureBsuiteColumns_(sheet) {
  if (!sheet || sheet.getLastColumn() === 0) return;
  ['フォロワー閲覧', 'フォロワー以外閲覧', '女性比率', '主要年齢層'].forEach(h => {
    if (findColumn_(sheet, h) > 0) return;
    const newCol = sheet.getLastColumn() + 1;
    sheet.getRange(1, newCol).setValue(h)
      .setFontWeight('bold').setBackground('#EA4335').setFontColor('#FFFFFF');
  });
}

/**
 * 表示用キャッシュを作り直す（30分ごとのトリガーから。autoFetch でキャッシュを温めない古い GAS 向け）
 */
function appCacheWarm() {
  appBuild_();
}

// ?action=installWarm（キー必須）: appCacheWarm の30分トリガーが無ければ作る
function appInstallWarm_() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return 'busy';
  try {
    if (ScriptApp.getProjectTriggers().some(t => t.getHandlerFunction() === 'appCacheWarm')) return 'already installed';
    ScriptApp.newTrigger('appCacheWarm').timeBased().everyMinutes(30).create();
    return 'installed';
  } finally {
    lock.releaseLock();
  }
}

// キャッシュが空のとき（web リクエストから）: 1回限りのトリガーで裏の構築を始めて { building: true } を返す。
// 構築は1〜2分かかり、web リクエスト内で回すと応答が 404 になるため。二重に始めないよう Lock＋印（10分）で守る
function appKickBuild_() {
  const lock = LockService.getScriptLock();
  if (lock.tryLock(5000)) {
    try {
      const cache = CacheService.getScriptCache();
      const pending = ScriptApp.getProjectTriggers().some(t => t.getHandlerFunction() === 'appCacheBuildOnce');
      if (!cache.get('app:v4:kick') && !pending) {
        ScriptApp.newTrigger('appCacheBuildOnce').timeBased().after(1000).create();
        cache.put('app:v4:kick', '1', 600);
      }
    } catch (e) {
      Logger.log('appKickBuild_ 失敗: ' + e.message);
    } finally {
      lock.releaseLock();
    }
  }
  return { building: true };
}

// appKickBuild_ が作った1回限りのトリガーから。自分のトリガーを消してから構築する
function appCacheBuildOnce() {
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === 'appCacheBuildOnce') ScriptApp.deleteTrigger(t);
  });
  try {
    appBuild_();
  } finally {
    CacheService.getScriptCache().remove('app:v4:kick');
  }
}

/**
 * アプリの「最新にする」（?action=refresh・キー必須）。押せるのは30分に1回（端末をまたいで Script Property APP_REFRESH_AT で管理）
 * 取り直しは1回限りのトリガー appRefreshOnce で裏で行い、ここはすぐ返す
 */
const APP_REFRESH_COOLDOWN_SEC = 1800;

function appRefresh_() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return { ok: false, reason: 'busy' };
  try {
    const now = Date.now();
    const last = Number(getConfig('APP_REFRESH_AT')) || 0;
    const nextAt = last + APP_REFRESH_COOLDOWN_SEC * 1000;
    if (now < nextAt) return { ok: false, reason: 'cooldown', nextAt: nextAt, remainingSec: Math.ceil((nextAt - now) / 1000) };
    // トリガーを作れてから押した時刻を保存する（作れなかったのに30分押せなくなるのを防ぐ）
    if (!ScriptApp.getProjectTriggers().some(t => t.getHandlerFunction() === 'appRefreshOnce')) {
      ScriptApp.newTrigger('appRefreshOnce').timeBased().after(1000).create();
    }
    setConfig('APP_REFRESH_AT', String(now));
    return { ok: true, startedAt: now, nextAt: now + APP_REFRESH_COOLDOWN_SEC * 1000 };
  } finally {
    lock.releaseLock();
  }
}

// appRefresh_ が作った1回限りのトリガーから。IG から取り直し（autoFetch があれば）→ 表示用データを作り直す
function appRefreshOnce() {
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === 'appRefreshOnce') ScriptApp.deleteTrigger(t);
  });
  const started = Date.now();
  try {
    if (typeof autoFetch === 'function') autoFetch();
  } catch (e) {
    Logger.log('appRefreshOnce: autoFetch 失敗: ' + e.message);
    try { notifyDiscord('⚠️ アプリの「最新にする」: 取り直しに失敗しました（' + e.message + '）', { toError: true, kind: 'appRefresh', bypassCooldown: true }); } catch (_) {}
  }
  try {
    // autoFetch 側で押した後に作り直し済みなら二重に作らない（キャッシュの指す先 = "<構築開始ms>:<分割数>"）
    const p = String(CacheService.getScriptCache().get('app:v4:data') || '').split(':');
    if (Number(p[0]) > started && Number(p[1]) > 0) return;
    // 作り直しは1〜2分かかる。取り直しで3分以上使っていたら、6分制限で止まらないよう別の実行（appCacheBuildOnce）で作り直す
    if (Date.now() - started > 180000) appKickBuild_();
    else appBuild_();
  } catch (e) {
    Logger.log('appRefreshOnce: appBuild_ 失敗: ' + e.message);
    try { notifyDiscord('⚠️ アプリの「最新にする」: 表示用データの作り直しに失敗しました（' + e.message + '）', { toError: true, kind: 'appRefresh', bypassCooldown: true }); } catch (_) {}
  }
}
