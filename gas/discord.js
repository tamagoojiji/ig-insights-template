// ==========
// Discord Webhook 通知（レート制限対策付き）
// WEBHOOK_URL（Script Properties）が未設定なら no-op
// ==========

const NOTIFY_COOLDOWN_MS = 5 * 60 * 1000;       // 種別ごと: 5分に1回まで
const RATE_LIMIT_PAUSE_MS = 30 * 60 * 1000;     // 429受信時: 30分全停止

const NOTIFY_PROP_LAST_PREFIX = 'NOTIFY_LAST_';
const NOTIFY_PROP_PAUSE_UNTIL = 'NOTIFY_PAUSE_UNTIL';

// 配布版テンプレ用の集約通知先（管理者=たまごのDiscord #ig-error-alerts）
// ERROR_WEBHOOK_URL（Script Properties）が未設定のときのフォールバック
// 漏洩時はDiscordでWebhookを削除→再発行→ここを差し替えで即無効化
const ERROR_WEBHOOK_FALLBACK = 'https://discord.com/api/webhooks/1506064587496231053/AgbevyjKNKelKfP3aqmYWzEiw787hewkpxppUfUVvojsfb1ZNK5k-oD2j14pbZnkizfS';

/**
 * Discord通知
 * @param {string} message - 送信するメッセージ
 * @param {object} [opts]
 * @param {string} [opts.kind] - 通知種別（クールダウン管理用）。同種は5分に1回のみ
 * @param {boolean} [opts.bypassCooldown=false] - true でクールダウンを無視
 * @param {boolean} [opts.toError=false] - true でエラー通知用Webhook（ERROR_WEBHOOK_URL）へ送信。未設定なら WEBHOOK_URL にフォールバック
 * @param {number} [opts.cooldownMs] - 種別クールダウンをこのミリ秒に上書き（未指定時は NOTIFY_COOLDOWN_MS）
 */
function notifyDiscord(message, opts) {
  opts = opts || {};
  const webhookUrl = opts.toError
    ? (getConfig('ERROR_WEBHOOK_URL') || ERROR_WEBHOOK_FALLBACK || getConfig('WEBHOOK_URL'))
    : getConfig('WEBHOOK_URL');
  if (!webhookUrl) {
    console.log('Discord Webhook 未設定（通知スキップ）');
    return;
  }

  const props = PropertiesService.getScriptProperties();

  // レート制限による一時停止チェック
  const pauseUntilStr = props.getProperty(NOTIFY_PROP_PAUSE_UNTIL);
  const pauseUntil = pauseUntilStr ? parseInt(pauseUntilStr, 10) : 0;
  if (pauseUntil > Date.now()) {
    const remainingMin = Math.ceil((pauseUntil - Date.now()) / 60000);
    console.log('Discord通知は一時停止中（残り ' + remainingMin + ' 分）: ' + message.slice(0, 60));
    return;
  }

  // 種別ごとのクールダウン
  const kind = opts.kind || 'default';
  const cooldownMs = (typeof opts.cooldownMs === 'number') ? opts.cooldownMs : NOTIFY_COOLDOWN_MS;
  const lastKey = NOTIFY_PROP_LAST_PREFIX + kind;
  if (!opts.bypassCooldown) {
    const lastStr = props.getProperty(lastKey);
    const last = lastStr ? parseInt(lastStr, 10) : 0;
    const elapsed = Date.now() - last;
    if (elapsed < cooldownMs) {
      const remainingSec = Math.ceil((cooldownMs - elapsed) / 1000);
      console.log('Discord通知クールダウン中（' + kind + '・残り ' + remainingSec + 's）: ' + message.slice(0, 60));
      return;
    }
  }

  try {
    const params = {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify({ content: message }),
      muteHttpExceptions: true,
    };
    let res = UrlFetchApp.fetch(webhookUrl, params);
    let code = res.getResponseCode();
    if (code === 429) {
      // Retry-After の指示時間だけ待って1回だけ再送（メッセージを捨てない）
      Utilities.sleep(retryAfterMs_(res));
      res = UrlFetchApp.fetch(webhookUrl, params);
      code = res.getResponseCode();
    }
    if (code === 429) {
      props.setProperty(NOTIFY_PROP_PAUSE_UNTIL, String(Date.now() + RATE_LIMIT_PAUSE_MS));
      console.warn('Discord 429 を受信（再送も429）。' + (RATE_LIMIT_PAUSE_MS / 60000) + ' 分間 全通知を停止します');
    } else if (code >= 400) {
      console.error('Discord通知失敗 ' + code + ': ' + res.getContentText().slice(0, 200));
    } else if (!opts.bypassCooldown) {
      // 送信できたときだけクールダウンを消費する（失敗した通知で次を塞がない）
      props.setProperty(lastKey, String(Date.now()));
    }
  } catch (e) {
    console.error('Discord通知エラー:', e);
  }
}

/** igFetchのエラー文字列がトークン失効(code:190 / code:102)かを判定する */
function isTokenExpiredError_(message) {
  return !!message && (message.indexOf('(code: 190)') !== -1 || message.indexOf('(code: 102)') !== -1);
}

/** トークン失効通知（復旧手順つき・6時間に1回） */
function notifyTokenExpired_(jobLabel, msg) {
  notifyDiscord(
    '🔑 ' + jobLabel + ': IGアクセストークンが失効しています。\n' + msg +
    '\n\n復旧手順: Graph API Explorer等で新しいアクセストークンを取得 → スプシのメニュー「🔐 シークレット入力」でトークンを更新 → 「🔗 接続テスト」を実行（長期トークン化）。\n※復旧までこの通知は6時間に1回のみ。',
    { kind: 'token_expired', toError: true, cooldownMs: 6 * 60 * 60 * 1000 }
  );
}

/**
 * 自動取得ジョブのエラー通知。トークン失効(code:190/102)は30分毎トリガーで
 * スパム化するため、復旧手順つきの通知に差し替えて6時間に1回へ抑制する。
 * @param {string} jobLabel - 例: 'autoFetch（30分毎の自動取得）'
 * @param {string} kind - 通常エラー時の通知種別
 * @param {Error} e
 */
function notifyFetchError_(jobLabel, kind, e) {
  const msg = (e && e.message) || String(e);
  if (isTokenExpiredError_(msg)) {
    notifyTokenExpired_(jobLabel, msg);
  } else {
    // 30分毎トリガーのため汎用エラーもスパム化する。停滞自体は日次のヘルスチェックが報告する
    notifyDiscord('🚨 ' + jobLabel + 'でエラー: ' + msg, {
      kind: kind, toError: true, cooldownMs: 6 * 60 * 60 * 1000
    });
  }
}

/**
 * 429レスポンスの Retry-After（ヘッダ秒 or ボディ retry_after 秒）から待機msを求める
 * 取得できなければ2秒。上限30秒（GAS実行時間を食い潰さないため）
 */
function retryAfterMs_(res) {
  let sec = 2;
  try {
    const headers = res.getHeaders();
    const h = headers['Retry-After'] || headers['retry-after'];
    if (h) sec = parseFloat(h) || sec;
    else sec = JSON.parse(res.getContentText()).retry_after || sec;
  } catch (_) {}
  return Math.min(Math.ceil(sec * 1000) + 500, 30000);
}

/**
 * クールダウン状態をリセット（管理用）
 */
function resetDiscordCooldown() {
  const props = PropertiesService.getScriptProperties();
  const all = props.getProperties();
  let count = 0;
  Object.keys(all).forEach(k => {
    if (k.indexOf(NOTIFY_PROP_LAST_PREFIX) === 0 || k === NOTIFY_PROP_PAUSE_UNTIL) {
      props.deleteProperty(k);
      count++;
    }
  });
  console.log('Discordクールダウン状態をリセットしました（' + count + '件）');
  try {
    SpreadsheetApp.getUi().alert('Discordクールダウン状態をリセット（' + count + '件）');
  } catch (_) {}
}
