const GAS_URL = 'https://script.google.com/macros/s/__GAS_ID__/exec';
const LS_KEY = 'ig_k___ACCOUNT__';
const LEGACY_LS_KEY = '__ACCOUNT___k'; // 旧形式のキー（<id>_k）。新キーが無ければ読み替えて移す（既に開いている端末の鍵を消さないため）
const KEY = readKey();
// キーは ?k=（#k= も可）で受け取り localStorage に保存（URLには残す: iOSのホーム画面版はSafariとlocalStorageが別なので、キー付きURLを登録させる）。無ければ保存済みを使う
function readKey() {
  const m = location.search.match(/[?&]k=([^&]*)/) || location.hash.match(/[#&]k=([^&]*)/);
  const found = !!m;
  const raw = m ? safeDecode(m[1]) : null;
  let k = null;
  try {
    if (found) {
      k = raw;
      if (!k) return null;
      localStorage.setItem(LS_KEY, k);
    } else {
      k = localStorage.getItem(LS_KEY);
      if (!k && (k = localStorage.getItem(LEGACY_LS_KEY))) localStorage.setItem(LS_KEY, k);
    }
  } catch (e) { if (found) k = raw; }
  return k;
}
function safeDecode(s) { try { return decodeURIComponent(s); } catch (e) { return null; } }
function dataUrl(part) { return GAS_URL + '?k=' + encodeURIComponent(KEY) + '&format=json' + (part ? '&part=' + part : ''); }
// GASからJSONを取得。キー不正は forbidden
async function fetchData(url) {
  const pre = window.__pre && window.__pre.url === url ? window.__pre : null;
  if (pre) window.__pre = null;
  const text = await (pre ? pre.p : fetch(url, { cache: 'no-store' }).then(res => res.text()));
  if (/^403 forbidden/.test(text)) { const e = new Error('forbidden'); e.forbidden = true; throw e; }
  return JSON.parse(text);
}
const WD = ['日','月','火','水','木','金','土'];
const CIRC = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳';
const state = { data:null, captions:null, tab:'stories', period:'30', reelSort:'new', feedSort:'new' };
const PERIOD_LABEL = { '7':'直近7日', '30':'直近30日', 'all':'全期間' };
const BURST_GAP_MIN = 60; // 前の投稿からこの分数以内なら同じ連投とみなす

function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function n(v) { return Number(v || 0).toLocaleString('ja-JP'); }
function pct(a, b) { return b > 0 ? (a / b * 100).toFixed(1) + '%' : '—'; }
function num(v) { return (Number(v) || 0); }
// 'yyyy/MM/dd HH:mm'(JST) → epoch ms
function ts(s) { const m = String(s).match(/(\d+)\/(\d+)\/(\d+) (\d+):(\d+)/); return m ? Date.UTC(+m[1], m[2]-1, +m[3], m[4]-9, +m[5]) : 0; }
function md(s) { const m = String(s).match(/(\d+)\/(\d+)\/(\d+)/); return +m[2] + '/' + +m[3]; }
function dayLabel(s) { const m = String(s).match(/(\d+)\/(\d+)\/(\d+)/); const w = new Date(Date.UTC(+m[1], m[2]-1, +m[3])).getUTCDay(); return +m[2] + '/' + +m[3] + '(' + WD[w] + ')'; }
function hm(s) { return String(s).slice(11); }
function inPeriod(items) {
  if (state.period === 'all') return items.slice();
  const cut = Date.now() - Number(state.period) * 86400000;
  return items.filter(x => ts(x.postedAt) >= cut);
}
function recent30(items) { const cut = Date.now() - 30 * 86400000; return items.filter(x => ts(x.postedAt) >= cut); }
function avg(arr, f) { return arr.length ? arr.reduce((s, x) => s + f(x), 0) / arr.length : 0; }
// Driveサムネの表示幅を差し替え（sz=w400 → w240 等）
function sz(src, w) { return String(src).replace(/([?&]sz=)w\d+/, '$1w' + w); }
function thumbHtml(src, w, h) {
  return src ? '<img class="thumb" loading="lazy" decoding="async" width="' + w + '" height="' + h + '" referrerpolicy="no-referrer" src="' + esc(sz(src, 240)) + '" alt="" onerror="this.outerHTML=\'<div class=&quot;ph&quot;>画像なし</div>\'">'
             : '<div class="ph">画像なし</div>';
}

// 伸びた判定（gas/dashboard.js と同じ基準・直近30日平均）
const FIRE = { avgX: 1.5, repeat: 1.5, shares: 1, profPct: 1.0, savePct: 1.0, reachRate: 0.6, likeX: 1.5, comments: 1, need: 2 };
const FIRE_NOTE = {
  stories: '視聴' + FIRE.avgX + '倍・リピート率' + FIRE.repeat + '以上・シェア' + FIRE.shares + '以上・プロフ遷移率' + FIRE.profPct + '%以上',
  reels: '視聴' + FIRE.avgX + '倍・保存率' + FIRE.savePct + '%以上・シェア' + FIRE.shares + '以上・リーチ率' + FIRE.reachRate + '以上',
  feeds: 'リーチ' + FIRE.avgX + '倍・いいね率が平均の' + FIRE.likeX + '倍・保存率' + FIRE.savePct + '%以上・コメント' + FIRE.comments + '以上'
};
function fireNote(kind) { return '<p class="note">🔥＝直近30日の平均と比べて、' + FIRE_NOTE[kind] + 'のうち' + FIRE.need + 'つ以上</p>'; }
// 説明文はヘッダー下の「数字の見方」（折りたたみ）に入れる。一覧の上には出さない
function setLegend(html) { document.getElementById('legend-dyn').innerHTML = html; }
function markFire(d) {
  const s30 = recent30(d.stories);
  const sAvgViews = avg(s30, x => x.views);
  d.stories.forEach(s => {
    const c = [sAvgViews > 0 && s.views / sAvgViews >= FIRE.avgX,
               s.reach > 0 && s.views / s.reach >= FIRE.repeat,
               s.shares >= FIRE.shares,
               s.reach > 0 && s.profileVisits / s.reach * 100 >= FIRE.profPct];
    s.fire = c.filter(Boolean).length >= FIRE.need;
  });
  const r30 = recent30(d.reels);
  const rAvgViews = avg(r30, x => x.views);
  d.reels.forEach(r => {
    const c = [rAvgViews > 0 && r.views / rAvgViews >= FIRE.avgX,
               r.reach > 0 && r.saved / r.reach * 100 >= FIRE.savePct,
               r.shares >= FIRE.shares,
               r.views > 0 && r.reach / r.views >= FIRE.reachRate];
    r.fire = c.filter(Boolean).length >= FIRE.need;
  });
  const f30 = recent30(d.feeds);
  const fAvgReach = avg(f30, x => x.reach);
  const fAvgLike = avg(f30, x => x.reach > 0 ? x.likes / x.reach : 0);
  d.feeds.forEach(f => {
    const likeRate = f.reach > 0 ? f.likes / f.reach : 0;
    const c = [fAvgReach > 0 && f.reach / fAvgReach >= FIRE.avgX,
               fAvgLike > 0 && likeRate / fAvgLike >= FIRE.likeX,
               f.reach > 0 && f.saved / f.reach * 100 >= FIRE.savePct,
               f.comments >= FIRE.comments];
    f.fire = c.filter(Boolean).length >= FIRE.need;
  });
}

async function load() {
  state.data = null;
  state.captions = null;
  document.getElementById('main').innerHTML = '<div class="state">読み込み中…</div>';
  if (!KEY) return showKeyError();
  try {
    render(await fetchData(dataUrl()));
    loadCaptions();
  } catch (err) {
    if (err.forbidden) showKeyError();
    else showError(err);
  }
}
// キャプション全文は描画後に裏で取得し、開いている詳細シートがあれば差し替える
function loadCaptions() {
  fetchData(dataUrl('captions')).then(c => {
    state.captions = c;
    const el = document.getElementById('capFull');
    if (el) el.innerHTML = capHtml(el.dataset.kind, el.dataset.id);
  }, () => {
    state.captions = false;
    const el = document.getElementById('capFull');
    if (el) el.innerHTML = capHtml(el.dataset.kind, el.dataset.id);
  });
}
function render(d) {
  markFire(d);
  state.data = d;
  const u = d.builtAt ? md(d.builtAt) + ' ' + hm(d.builtAt) : '—';
  document.getElementById('meta').textContent = '更新 ' + u + ' ・ フォロワー ' + (d.followers == null ? '—' : n(d.followers));
  draw();
}
function showError(err) {
  document.getElementById('meta').textContent = '読み込みに失敗しました';
  document.getElementById('main').innerHTML = '<div class="state">データを読み込めませんでした（' + esc(err && err.message ? err.message : err) + '）<br><button type="button" id="retry">もう一度読み込む</button></div>';
  document.getElementById('retry').onclick = load;
}
function showKeyError() {
  document.getElementById('meta').textContent = '読み込みに失敗しました';
  document.getElementById('main').innerHTML = '<div class="state">このURLでは開けませんでした。たまごから届いたリンクをもう一度開いてください。ホーム画面に追加するときは、そのリンクを開いた画面から追加してください</div>';
}

function syncControls() {
  document.querySelectorAll('#period button').forEach(b => b.setAttribute('aria-pressed', b.dataset.p === state.period));
  document.querySelectorAll('nav.tabs button').forEach(b => b.setAttribute('aria-selected', b.dataset.t === state.tab));
}
function emptyHtml(total) {
  return '<div class="state">この期間の投稿はありません。<span class="nw">『全部』にすると ' + n(total) + '件</span>' +
    (state.period !== 'all' && total > 0 ? '<br><button type="button" data-act="all">全部を表示する</button>' : '') + '</div>';
}
function draw() {
  syncControls();
  const d = state.data; if (!d) return;
  const main = document.getElementById('main');
  if (state.tab === 'stories') main.innerHTML = drawStories(d);
  else if (state.tab === 'reels') main.innerHTML = drawList(d.reels, 'reels');
  else main.innerHTML = drawList(d.feeds, 'feeds');
}

function drawStories(d) {
  const items = inPeriod(d.stories);
  setLegend(fireNote('stories') + '<p class="note">継続率＝連投（前の投稿から' + BURST_GAP_MIN + '分以内）の1本目を見た人のうち、そのストーリーまで見た人の割合。間が空いた投稿には出ません</p>');
  if (!items.length) return emptyHtml(d.stories.length);
  const groups = {};
  items.forEach(s => { const k = s.postedAt.slice(0, 10); (groups[k] = groups[k] || []).push(s); });
  const days = Object.keys(groups).sort().reverse();
  let h = '<div class="count">' + n(items.length) + '本・' + days.length + '日（' + PERIOD_LABEL[state.period] + '）</div>';
  days.forEach(k => {
    const list = groups[k].sort((a, b) => ts(a.postedAt) - ts(b.postedAt));
    const first = list[0].reach;
    const bursts = [];
    list.forEach((s, i) => {
      if (i === 0 || ts(s.postedAt) - ts(list[i - 1].postedAt) > BURST_GAP_MIN * 60000) bursts.push([]);
      s._b = bursts[bursts.length - 1]; s._b.push(s);
    });
    const lb = bursts.filter(b => b.length > 1).pop();
    const rep = list.reduce((s, x) => s + x.replies, 0), prof = list.reduce((s, x) => s + x.profileVisits, 0);
    h += '<section class="day"><h2>' + dayLabel(k) + '・' + list.length + '本</h2>' +
      '<div class="sum"><span>閲覧率 ' + (d.followers ? pct(first, d.followers) : '—') + '</span>' + (lb ? ' ・ <span>継続率（連投' + lb.length + '本の最後） ' + pct(lb[lb.length - 1].reach, lb[0].reach) + '</span>' : '') + ' ・ <span>返信数 ' + n(rep) + '</span> ・ <span>プロフ ' + n(prof) + '</span></div><div class="strip">';
    list.forEach((s, i) => {
      const no = i < 20 ? CIRC[i] : String(i + 1);
      h += '<div class="story' + (i > 0 && s._b[0] === s ? ' gs' : '') + '"><button type="button" class="th" data-story="' + esc(s.id) + '" aria-label="' + (i + 1) + '本目の詳細を見る">' +
        thumbHtml(s.thumb, 120, 213) + '<span class="num">' + no + (s.fire ? ' 🔥' : '') + '</span></button>' +
        '<table class="mini"><tr><td><span class="l">閲覧率</span><span class="v">' + (d.followers ? pct(s.reach, d.followers) : '—') + '</span></td>' +
        '<td><span class="l">視聴数</span><span class="v">' + n(s.views) + '</span></td></tr>' +
        '<tr><td><span class="l">継続率</span><span class="v">' + (s._b.length < 2 ? '—' : s._b[0] === s ? '100%' : pct(s.reach, s._b[0].reach)) + '</span></td>' +
        '<td><span class="l">返信数</span><span class="v">' + n(s.replies) + '</span></td></tr>' +
        '<tr><td><span class="l">次へ</span><span class="v">' + n(s.navigation) + '</span></td>' +
        '<td><span class="l">プロフ</span><span class="v">' + n(s.profileVisits) + '</span></td></tr></table></div>';
    });
    h += '</div></section>';
  });
  return h;
}

function capLine(c) {
  const first = String(c || '').split(/\r?\n/)[0].trim();
  if (!first) return '（キャプションなし）';
  const cs = Array.from(first);
  return cs.length > 40 ? cs.slice(0, 40).join('') + '…' : first;
}
const SORTS = {
  reels: [['new','新しい順'],['views','再生数'],['saved','保存数'],['saveRate','保存率']],
  feeds: [['new','新しい順'],['reach','リーチ'],['saved','保存'],['likes','いいね']]
};
function drawList(all, kind) {
  const items = inPeriod(all);
  const cur = kind === 'reels' ? state.reelSort : state.feedSort;
  let h = '<div class="seg sort" role="group" aria-label="並び替え"><span class="lbl">並び替え</span>' + SORTS[kind].map(s =>
    '<button type="button" data-sort="' + s[0] + '" aria-pressed="' + (s[0] === cur) + '">' + s[1] + '</button>').join('') + '</div>';
  setLegend(fireNote(kind));
  if (!items.length) return h + emptyHtml(all.length);
  const key = {
    new: x => ts(x.postedAt), views: x => x.views, saved: x => x.saved, likes: x => x.likes, reach: x => x.reach,
    saveRate: x => x.reach > 0 ? x.saved / x.reach : 0
  }[cur];
  items.sort((a, b) => key(b) - key(a));
  const fires = items.filter(x => x.fire).length;
  h += '<div class="count">' + n(items.length) + '本（' + PERIOD_LABEL[state.period] + '）・ 🔥伸び ' + fires + '本</div><div>';
  items.forEach(x => {
    const mets = kind === 'reels'
      ? ['再生 ' + n(x.views), '保存 ' + n(x.saved), '保存率 ' + pct(x.saved, x.reach), 'リーチ率 ' + (x.views > 0 ? (x.reach / x.views).toFixed(2) : '—'), 'シェア ' + n(x.shares)]
      : ['いいね ' + n(x.likes), 'コメント ' + n(x.comments), '保存 ' + n(x.saved), 'リーチ ' + n(x.reach), '反応率 ' + pct(x.likes + x.comments + x.saved, x.reach)];
    h += '<button type="button" class="row' + (kind === 'feeds' ? ' feed' : '') + '" data-' + (kind === 'reels' ? 'reel' : 'feed') + '="' + esc(x.id) + '">' +
      thumbHtml(x.thumb, 72, kind === 'feeds' ? 90 : 128) + '<div class="body"><div class="cap">' + esc(capLine(x.captionHead)) + '</div>' +
      '<div class="date">' + esc(x.postedAt) + '</div><div class="mets">' +
      mets.map(m => '<span>' + m + '</span>').join(' ・ ') + (x.fire ? ' <span class="fire">🔥伸び</span>' : '') + '</div></div></button>';
  });
  return h + '</div>';
}

// ボトムシート
function kv(pairs) { return '<div class="kv">' + pairs.map(p => '<div><span>' + p[0] + '</span><span>' + p[1] + '</span></div>').join('') + '</div>'; }
function openSheet(title, inner) {
  const root = document.getElementById('sheetRoot');
  root.innerHTML = '<div class="overlay" id="ov"><div class="sheet" role="dialog" aria-modal="true" aria-label="' + esc(title) + '">' +
    '<div class="top"><b>' + esc(title) + '</b><button type="button" class="close" id="closeSheet">閉じる</button></div>' + inner + '</div></div>';
  document.getElementById('ov').addEventListener('click', e => { if (e.target.id === 'ov') closeSheet(); });
  document.getElementById('closeSheet').onclick = closeSheet;
  document.body.style.overflow = 'hidden';
}
function closeSheet() { document.getElementById('sheetRoot').innerHTML = ''; document.body.style.overflow = ''; }
function viewers(x) {
  let t;
  if (x.followers == null || x.nonFollowers == null) t = '—（取得待ち）';
  else {
    const tot = x.followers + x.nonFollowers;
    t = 'フォロワー ' + n(x.followers) + '（' + (tot > 0 ? Math.round(x.followers / tot * 100) + '%' : '—') + '）／以外 ' + n(x.nonFollowers);
    const sub = [];
    if (x.femalePct != null) sub.push('女性 ' + x.femalePct + '%');
    if (x.topAge) sub.push(x.topAge + ' が最多');
    if (sub.length) t += '\n' + sub.join('・');
  }
  return '<h3>閲覧者</h3><p class="full">' + esc(t) + '</p>';
}
function bigThumb(src) {
  return src ? '<img class="big" decoding="async" referrerpolicy="no-referrer" src="' + esc(sz(src, 800)) + '" alt="" onerror="this.outerHTML=\'<div class=&quot;ph bigph&quot;>画像なし</div>\'">' : '<div class="ph bigph">画像なし</div>';
}
function showStory(id) {
  const d = state.data, s = d.stories.find(x => x.id === id); if (!s) return;
  openSheet(dayLabel(s.postedAt) + ' ' + hm(s.postedAt) + (s.fire ? ' 🔥' : ''),
    bigThumb(s.thumb) + kv([['リーチ', n(s.reach)], ['視聴数', n(s.views)], ['返信数', n(s.replies)], ['シェア', n(s.shares)],
      ['次へ', n(s.navigation)], ['プロフ', n(s.profileVisits)], ['閲覧率', d.followers ? pct(s.reach, d.followers) : '—'],
      ['リピート率', s.reach > 0 ? (s.views / s.reach).toFixed(2) : '—']]) + viewers(s) +
    capBlock('stories', s.id, '画像内テキスト'));
}
function showReel(id) {
  const r = state.data.reels.find(x => x.id === id); if (!r) return;
  openSheet(r.postedAt + (r.fire ? ' 🔥伸び' : ''),
    kv([['再生', n(r.views)], ['リーチ', n(r.reach)], ['いいね', n(r.likes)], ['コメント', n(r.comments)], ['保存', n(r.saved)],
      ['シェア', n(r.shares)], ['保存率', pct(r.saved, r.reach)], ['リーチ率', r.views > 0 ? (r.reach / r.views).toFixed(2) : '—'],
      ['平均視聴', r.avgWatchSec == null ? '—' : n(r.avgWatchSec) + '秒']]) + viewers(r) +
    (/^https:\/\//i.test(r.videoUrl) ? '<a class="link" href="' + esc(r.videoUrl) + '" target="_blank" rel="noopener">Driveで動画を見る</a>' : '') +
    capBlock('reels', r.id, 'キャプション'));
}
function showFeed(id) {
  const f = state.data.feeds.find(x => x.id === id); if (!f) return;
  openSheet(f.postedAt + (f.fire ? ' 🔥伸び' : ''),
    bigThumb(f.thumb) + kv([['いいね', n(f.likes)], ['コメント', n(f.comments)], ['保存', n(f.saved)], ['リーチ', n(f.reach)],
      ['視聴', n(f.views)], ['反応率', pct(f.likes + f.comments + f.saved, f.reach)], ['いいね率', pct(f.likes, f.reach)], ['保存率', pct(f.saved, f.reach)]]) + viewers(f) +
    capBlock('feeds', f.id, 'キャプション'));
}

function capHtml(kind, id) {
  const full = state.captions ? state.captions[kind][id] : null;
  if (state.captions) return full ? esc(full) : '（なし）';
  const head = (state.data[kind].find(x => x.id === id) || {}).captionHead || '';
  if (state.captions === false) return head ? esc(head) : '（なし）';
  return (head ? esc(head) + '\n' : '') + '全文を読み込み中…';
}
function capBlock(kind, id, title) {
  return '<h3>' + title + '</h3><p class="full" id="capFull" data-kind="' + kind + '" data-id="' + esc(id) + '">' + capHtml(kind, id) + '</p>';
}

document.addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.p) { state.period = b.dataset.p; draw(); }
  else if (b.dataset.t) { state.tab = b.dataset.t; draw(); window.scrollTo(0, 0); }
  else if (b.dataset.sort) { if (state.tab === 'reels') state.reelSort = b.dataset.sort; else state.feedSort = b.dataset.sort; draw(); }
  else if (b.dataset.act === 'all') { state.period = 'all'; draw(); }
  else if (b.dataset.story) showStory(b.dataset.story);
  else if (b.dataset.reel) showReel(b.dataset.reel);
  else if (b.dataset.feed) showFeed(b.dataset.feed);
});
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeSheet(); });
syncControls();
load();
// 以前の版が入れた Service Worker とキャッシュは、古い画面を居座らせる原因になるので消す
if ('serviceWorker' in navigator) navigator.serviceWorker.getRegistrations().then(rs => rs.forEach(r => r.unregister())).catch(() => {});
if ('caches' in window) caches.keys().then(ks => ks.forEach(k => caches.delete(k))).catch(() => {});
