// ==========
// Discord Webhook 通知（レート制限対策付き）
// WEBHOOK_URL（Script Properties）が未設定なら no-op
// ==========

const NOTIFY_COOLDOWN_MS = 5 * 60 * 1000;       // 種別ごと: 5分に1回まで
const RATE_LIMIT_PAUSE_MS = 30 * 60 * 1000;     // 429受信時: 30分全停止

const NOTIFY_PROP_LAST_PREFIX = 'NOTIFY_LAST_';
const NOTIFY_PROP_PAUSE_UNTIL = 'NOTIFY_PAUSE_UNTIL';

/**
 * Discord通知
 * @param {string} message - 送信するメッセージ
 * @param {object} [opts]
 * @param {string} [opts.kind] - 通知種別（クールダウン管理用）。同種は5分に1回のみ
 * @param {boolean} [opts.bypassCooldown=false] - true でクールダウンを無視
 */
function notifyDiscord(message, opts) {
  opts = opts || {};
  const webhookUrl = getConfig('WEBHOOK_URL');
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
  if (!opts.bypassCooldown) {
    const lastKey = NOTIFY_PROP_LAST_PREFIX + kind;
    const lastStr = props.getProperty(lastKey);
    const last = lastStr ? parseInt(lastStr, 10) : 0;
    const elapsed = Date.now() - last;
    if (elapsed < NOTIFY_COOLDOWN_MS) {
      const remainingSec = Math.ceil((NOTIFY_COOLDOWN_MS - elapsed) / 1000);
      console.log('Discord通知クールダウン中（' + kind + '・残り ' + remainingSec + 's）: ' + message.slice(0, 60));
      return;
    }
    props.setProperty(lastKey, String(Date.now()));
  }

  try {
    const res = UrlFetchApp.fetch(webhookUrl, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify({ content: message }),
      muteHttpExceptions: true,
    });
    const code = res.getResponseCode();
    if (code === 429) {
      props.setProperty(NOTIFY_PROP_PAUSE_UNTIL, String(Date.now() + RATE_LIMIT_PAUSE_MS));
      console.warn('Discord 429 を受信。' + (RATE_LIMIT_PAUSE_MS / 60000) + ' 分間 全通知を停止します');
    } else if (code >= 400) {
      console.error('Discord通知失敗 ' + code + ': ' + res.getContentText().slice(0, 200));
    }
  } catch (e) {
    console.error('Discord通知エラー:', e);
  }
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
