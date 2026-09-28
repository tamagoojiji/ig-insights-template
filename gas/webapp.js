/**
 * スマホ閲覧用の静的アプリ（web/）向け JSON API と、Business Suite 巡回の書き込み口
 * アクセスは ?k=<APP_ACCESS_KEY> で保護。キーは Script Properties 管理。
 * 依存: findColumn_ / getConfig / setConfig / notifyDiscord（既存の GAS 側）、webapp-addon.js
 */

function doGet(e) {
  const params = (e && e.parameter) || {};
  const key = getConfig('APP_ACCESS_KEY');

  if (params.bootstrap === '1') {
    const lock = LockService.getScriptLock();
    if (!lock.tryLock(10000)) return ContentService.createTextOutput('busy');
    try {
      if (getConfig('APP_ACCESS_KEY')) return ContentService.createTextOutput('already set');
      const newKey = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
      setConfig('APP_ACCESS_KEY', newKey);
      return ContentService.createTextOutput(newKey);
    } finally {
      lock.releaseLock();
    }
  }

  if (!key || params.k !== key) {
    return ContentService.createTextOutput('403 forbidden');
  }

  if (params.action === 'installWarm') return ContentService.createTextOutput(appInstallWarm_());

  if (params.format === 'json' && params.part === 'captions') {
    return ContentService.createTextOutput(JSON.stringify(getCaptions(params.k)))
      .setMimeType(ContentService.MimeType.JSON);
  }

  if (params.format === 'json') {
    return ContentService.createTextOutput(JSON.stringify(getAppData(params.k)))
      .setMimeType(ContentService.MimeType.JSON);
  }

  return ContentService.createTextOutput('このURLは直接開けません。アプリのURLから開いてください');
}

function getAppData(key) {
  appCheckKey_(key);
  return appCacheGet_('data') || appBuild_().data;
}

/**
 * 詳細シート用の全文 { reels: {id: キャプション}, feeds: {id: キャプション}, stories: {id: 画像内テキスト} }
 * （getAppData の後に裏で取得）
 */
function getCaptions(key) {
  appCheckKey_(key);
  return appCacheGet_('caps') || appBuild_().caps;
}

function appCheckKey_(key) {
  const expected = getConfig('APP_ACCESS_KEY');
  if (!expected || key !== expected) throw new Error('forbidden');
}

// 一覧用の先頭行（最初の改行まで・最大60文字）
function appCaptionHead_(c) {
  return Array.from(String(c || '').split(/\r?\n/)[0].trim()).slice(0, 60).join(''); // 絵文字を割らない
}

/**
 * シートを1回読み、軽量データとキャプション全文を作ってキャッシュに入れる
 */
function appBuild_() {
  let gen = appCacheGen_();
  if (!gen) {
    gen = Utilities.getUuid();
    try { CacheService.getScriptCache().put('app:v3:gen', gen, 21600); } catch (e) {}
  }
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const tz = 'Asia/Tokyo';
  const now = Utilities.formatDate(new Date(), tz, 'yyyy/MM/dd HH:mm');
  const caps = { reels: {}, feeds: {}, stories: {} };
  // ストーリーズは直近 APP_STORY_DAYS 日（既定120）だけ返す（件数が多いアカウントでも重くしない）
  const storyDays = Number(getConfig('APP_STORY_DAYS')) || 120;
  const storySince = new Date(Date.now() - storyDays * 86400000);

  const data = {
    updatedAt: now,
    builtAt: now,
    followers: appReadFollowers_(ss.getSheetByName('📊 フォロワー推移')),
    stories: appReadRows_(ss.getSheetByName('📖 ストーリーズ'), tz, (g, base) => {
      const text = String(g('画像内テキスト') || '').trim();
      caps.stories[base.id] = (text === '[画像なし]' || text === '[エラー]') ? '' : text;
      return Object.assign(base, {
        type: String(g('メディアタイプ') || ''),
        reach: Number(g('リーチ')) || 0,
        views: Number(g('視聴数')) || 0,
        replies: Number(g('返信数')) || 0,
        shares: Number(g('シェア数')) || 0,
        navigation: Number(g('ナビゲーション')) || 0,
        profileVisits: Number(g('プロフィールアクセス')) || 0
      }, appBsuiteFields_(g));
    }, storySince),
    reels: appReadRows_(ss.getSheetByName('🎬 リール'), tz, (g, base) => {
      const avg = g('平均視聴時間');
      const caption = String(g('キャプション') || '');
      caps.reels[base.id] = caption;
      return Object.assign(base, {
        captionHead: appCaptionHead_(caption),
        views: Number(g('視聴数')) || 0,
        likes: Number(g('いいね数')) || 0,
        comments: Number(g('コメント数')) || 0,
        saved: Number(g('保存数')) || 0,
        reach: Number(g('リーチ')) || 0,
        shares: Number(g('シェア数')) || 0,
        videoUrl: String(g('動画URL') || ''),
        avgWatchSec: (avg === '' || avg === null || avg === undefined || isNaN(Number(avg))) ? null : Number(avg)
      }, appBsuiteFields_(g));
    }),
    feeds: appReadRows_(ss.getSheetByName('📸 フィード'), tz, (g, base) => Object.assign(base, {
      type: String(g('タイプ') || ''),
      captionHead: appCaptionHead_(caps.feeds[base.id] = String(g('キャプション') || '')),
      likes: Number(g('いいね数')) || 0,
      comments: Number(g('コメント数')) || 0,
      saved: Number(g('保存数')) || 0,
      reach: Number(g('リーチ')) || 0,
      views: Number(g('視聴数')) || 0
    }, appBsuiteFields_(g)))
  };

  // 構築中に appCacheClear_ が走った（世代が変わった）なら古い結果は登録しない
  if (appCacheGen_() === gen) {
    appCachePut_(Object.assign(appCacheEntries_('data', data, gen), appCacheEntries_('caps', caps, gen)));
    if (appCacheGen_() !== gen) appCacheClear_(); // 保存の直前に更新が入った場合は取り消す
  }
  return { data: data, caps: caps };
}

/**
 * ScriptCache に10分保持。1キー100KB制限のため JSON を分割して保存する
 * （30000文字＝UTF-8で最大90KB）。キー: app:v3:<name>:n（件数）/ app:v3:<name>:<i>
 */
const APP_CACHE_TTL_SEC = 2400; // 40分。自動取得(30分ごと)と巡回書き込みの直後に appBuild_ で作り直すので、通常は切れない
const APP_CACHE_CHUNK = 30000;

function appCacheGen_() {
  try { return CacheService.getScriptCache().get('app:v3:gen') || ''; } catch (e) { return ''; }
}

function appCacheEntries_(name, obj, gen) {
  const json = JSON.stringify(obj);
  const entries = {};
  let n = 0;
  for (let i = 0; i < json.length; n++) {
    let end = Math.min(i + APP_CACHE_CHUNK, json.length);
    const c = json.charCodeAt(end - 1);
    if (end < json.length && c >= 0xD800 && c <= 0xDBFF) end--; // サロゲートペアを割らない
    entries['app:v3:' + name + ':' + n] = json.slice(i, end);
    i = end;
  }
  entries['app:v3:' + name + ':n'] = String(n);
  entries['app:v3:' + name + ':g'] = gen;
  return entries;
}

// data と caps を1回の putAll で同じ世代として保存する
function appCachePut_(entries) {
  try {
    CacheService.getScriptCache().putAll(entries, APP_CACHE_TTL_SEC);
  } catch (e) {
    Logger.log('appCachePut_ 失敗: ' + e.message);
  }
}

// 欠け・世代不一致なら null（＝呼び出し側で再生成）
function appCacheGet_(name) {
  try {
    const cache = CacheService.getScriptCache();
    const n = Number(cache.get('app:v3:' + name + ':n'));
    if (!n) return null;
    const keys = [];
    for (let i = 0; i < n; i++) keys.push('app:v3:' + name + ':' + i);
    const got = cache.getAll(keys.concat(['app:v3:gen', 'app:v3:' + name + ':g']));
    if (!got['app:v3:gen'] || got['app:v3:gen'] !== got['app:v3:' + name + ':g']) return null;
    let json = '';
    for (let i = 0; i < n; i++) {
      const part = got[keys[i]];
      if (part == null) return null;
      json += part;
    }
    return JSON.parse(json);
  } catch (e) {
    Logger.log('appCacheGet_ 失敗: ' + e.message);
    return null;
  }
}

// シート更新後に呼ぶ（件数キーを消せば次回は再生成される）
function appCacheClear_() {
  try {
    const cache = CacheService.getScriptCache();
    cache.removeAll(['app:v3:data:n', 'app:v3:caps:n']);
    cache.put('app:v3:gen', Utilities.getUuid(), 21600);
  } catch (e) {
    Logger.log('appCacheClear_ 失敗: ' + e.message);
  }
}

function appBsuiteFields_(g) {
  const numOrNull = v => (v === '' || v === null || v === undefined || isNaN(Number(v))) ? null : Number(v);
  const age = String(g('主要年齢層') || '').trim();
  return {
    followers: numOrNull(g('フォロワー閲覧')),
    nonFollowers: numOrNull(g('フォロワー以外閲覧')),
    femalePct: numOrNull(g('女性比率')),
    topAge: age || null
  };
}

/**
 * Business Suite 巡回（bsuite/）からの書き込み口。
 * token=APP_ACCESS_KEY 必須。action=bsuite: 閲覧者内訳4列を更新 / action=bsuiteAlert: エラー通知を中継
 */
const BSUITE_SHEETS = { reel: '🎬 リール', feed: '📸 フィード', story: '📖 ストーリーズ' };

function doPost(e) {
  const params = (e && e.parameter) || {};
  let body = {};
  try {
    body = (e && e.postData && e.postData.contents) ? JSON.parse(e.postData.contents) : {};
  } catch (err) {
    body = {};
  }
  const key = getConfig('APP_ACCESS_KEY');
  const token = params.token || body.token;
  if (!key || token !== key) return ContentService.createTextOutput('403 forbidden');

  const action = params.action || body.action;
  if (action !== 'bsuite' && action !== 'bsuiteAlert') {
    return ContentService.createTextOutput('400 unknown action');
  }

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return ContentService.createTextOutput('busy');
  try {
    const result = action === 'bsuite' ? bsuiteWrite_(body.items || []) : bsuiteAlert_(body.message);
    if (action === 'bsuite') { appCacheClear_(); try { appBuild_(); } catch (e) { Logger.log('appBuild_ 失敗: ' + e.message); } }
    return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON);
  } finally {
    lock.releaseLock();
  }
}

function bsuiteWrite_(items) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const cache = {};
  let updated = 0;
  const notFound = [];

  items.forEach(it => {
    const id = String((it && it.id) || '').trim();
    const name = BSUITE_SHEETS[it && it.kind];
    if (!id || !name) { notFound.push(id); return; }

    if (!cache[name]) {
      const sheet = ss.getSheetByName(name);
      if (!sheet) { cache[name] = { sheet: null }; }
      else {
        ensureBsuiteColumns_(sheet);
        const lastCol = sheet.getLastColumn();
        const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(h => String(h).trim());
        const col = h => headers.indexOf(h) + 1;
        const idCol = col('メディアID');
        const rows = {};
        if (idCol > 0 && sheet.getLastRow() >= 2) {
          sheet.getRange(2, idCol, sheet.getLastRow() - 1, 1).getValues().forEach((v, i) => {
            const k = String(v[0]).trim();
            if (k && !(k in rows)) rows[k] = i + 2;
          });
        }
        cache[name] = {
          sheet: sheet,
          rows: rows,
          cols: [col('フォロワー閲覧'), col('フォロワー以外閲覧'), col('女性比率'), col('主要年齢層')]
        };
      }
    }

    const c = cache[name];
    const row = c.sheet ? c.rows[id] : 0;
    if (!row) { notFound.push(id); return; }
    const vals = [
      it.followers == null ? '' : Number(it.followers),
      it.nonFollowers == null ? '' : Number(it.nonFollowers),
      it.femalePct == null ? '' : Number(it.femalePct),
      it.topAge == null ? '' : String(it.topAge)
    ];
    c.cols.forEach((colNo, i) => c.sheet.getRange(row, colNo).setValue(vals[i]));
    updated++;
  });

  try { notifyDiscord('👥 閲覧者内訳: 更新 ' + updated + '件 / 未発見 ' + notFound.length + '件', { kind: 'bsuite', bypassCooldown: true }); } catch (e) { Logger.log('notifyDiscord 失敗: ' + e.message); }
  return { updated: updated, notFound: notFound };
}

function bsuiteAlert_(message) {
  try { notifyDiscord(String(message || '(no message)'), { toError: true, kind: 'bsuiteAlert', bypassCooldown: true }); } catch (e) { Logger.log('notifyDiscord 失敗: ' + e.message); }
  return { ok: true };
}

/**
 * ヘッダー1回・値・数式だけ読み、ヘッダー名で列を解決して行オブジェクト化する
 */
function appReadRows_(sheet, tz, build, since) {
  if (!sheet || sheet.getLastRow() < 2) return [];
  const lastCol = sheet.getLastColumn();
  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(h => String(h).trim());
  const colIdx = {};
  headers.forEach((h, i) => { if (h && !(h in colIdx)) colIdx[h] = i; });
  // since 指定時は投稿日時列だけ先に読み、対象行を含む範囲だけ読む
  let top = 2, n = sheet.getLastRow() - 1;
  if (since && '投稿日時' in colIdx) {
    const hit = [];
    sheet.getRange(2, colIdx['投稿日時'] + 1, n, 1).getValues().forEach((v, i) => {
      const d = appParseDate_(v[0]);
      if (d && d >= since) hit.push(i);
    });
    if (!hit.length) return [];
    top = 2 + hit[0];
    n = hit[hit.length - 1] - hit[0] + 1;
  }
  const values = sheet.getRange(top, 1, n, lastCol).getValues();
  const formulas = 'サムネイル' in colIdx ? sheet.getRange(top, colIdx['サムネイル'] + 1, n, 1).getFormulas() : null;

  const out = [];
  for (let r = 0; r < values.length; r++) {
    const row = values[r];
    const g = h => (h in colIdx ? row[colIdx[h]] : '');
    const id = String(g('メディアID') || '').trim();
    if (!id) continue;
    const postedAt = appParseDate_(g('投稿日時'));
    if (!postedAt) continue;
    if (since && postedAt < since) continue;
    const f = formulas ? formulas[r][0] : '';
    const m = f ? String(f).match(/IMAGE\(\s*"([^"]+)"/i) : null;
    out.push(build(g, {
      id: id,
      postedAt: Utilities.formatDate(postedAt, tz, 'yyyy/MM/dd HH:mm'),
      thumb: m ? m[1] : ''
    }));
  }
  return out;
}

function appParseDate_(v) {
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
  const s = String(v || '').trim();
  const m = s.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{2})/);
  if (!m) return null;
  // 文字列はJST（UTC+9）として解釈。2/31 等の自動補正された日付は捨てる
  const y = Number(m[1]), mo = Number(m[2]), da = Number(m[3]), h = Number(m[4]), mi = Number(m[5]);
  const d = new Date(Date.UTC(y, mo - 1, da, h - 9, mi));
  const j = new Date(d.getTime() + 9 * 3600000);
  if (isNaN(d.getTime()) || j.getUTCFullYear() !== y || j.getUTCMonth() !== mo - 1 || j.getUTCDate() !== da || j.getUTCHours() !== h) return null;
  return d;
}

function appReadFollowers_(sheet) {
  if (!sheet || sheet.getLastRow() < 2) return null;
  const col = findColumn_(sheet, 'フォロワー数');
  if (col < 1) return null;
  const vals = sheet.getRange(2, col, sheet.getLastRow() - 1, 1).getValues();
  for (let i = vals.length - 1; i >= 0; i--) {
    const v = vals[i][0];
    if (v !== '' && v !== null && !isNaN(Number(v))) return Number(v);
  }
  return null;
}
