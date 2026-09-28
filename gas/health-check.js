// ==========
// ヘルスチェック（毎日1回・トリガー消失/取得停止を検知）
// ERROR_WEBHOOK_URL（管理者専用チャンネル）に通知
// ==========

const HEALTH_STALE_HOURS = 2;
// 必須トリガーの定義源は triggers.js の TRIGGER_SPECS に一本化し、ここでは Object.keys() で導出する
// （二重定義による判定漏れを防ぐ）。healthCheck 自身も含まれるが、実行中は必ず存在するので誤検知しない。
// ※ トップレベルで導出すると GAS のファイル評価順により TRIGGER_SPECS 未定義になり得るため、
//   各関数の実行時に Object.keys(TRIGGER_SPECS) を評価する。

/**
 * トリガー存在＋最終autoFetch成功時刻をチェック
 * 異常があれば Discord（ERROR_WEBHOOK_URL）に通知
 */
function healthCheck() {
  try {
    // まず欠けたトリガーの自動復旧を試みる（手動再インストールを不要にする）
    const restored = ensureTriggers_();

    const triggers = ScriptApp.getProjectTriggers();
    const handlers = triggers.map(t => t.getHandlerFunction());
    const missing = Object.keys(TRIGGER_SPECS).filter(h => handlers.indexOf(h) < 0);

    const lastStr = getConfig('LAST_AUTOFETCH_SUCCESS');
    const lastMs = lastStr ? parseInt(lastStr, 10) : 0;
    const hoursSince = lastMs ? (Date.now() - lastMs) / 3600000 : null;

    const alerts = [];
    if (missing.length > 0) {
      alerts.push('・トリガー消失（自動復旧も失敗）: ' + missing.join(', '));
    }
    if (hoursSince === null) {
      alerts.push('・autoFetch成功記録なし（初回未実行 or 過去成功時刻ロスト）');
    } else if (hoursSince > HEALTH_STALE_HOURS) {
      alerts.push('・autoFetchが ' + Math.floor(hoursSince) + ' 時間取得していません');
    }

    if (alerts.length === 0) {
      // 消えていたトリガーを自動復旧できた場合のみ、非アラームで報告（手動操作は不要）
      if (restored.length > 0) {
        notifyDiscord(
          '🔧 消失した時間トリガーを自動復旧しました: ' + restored.join(', ') + '\n' +
          '手動の再インストールは不要です（autoFetch/healthCheck が自動修復）。',
          { kind: 'trigger_restored', toError: true }
        );
      }
      Logger.log('healthCheck OK（autoFetch ' + Math.floor(hoursSince) + 'h以内'
        + (restored.length ? ' / 自動復旧: ' + restored.join(',') : '') + '）');
      return;
    }

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    // 自動復旧できたトリガーは併記して「消えたが直した」ことを明示する
    const restoredLine = restored.length
      ? '\n✅ 自動復旧済み: ' + restored.join(', ') + '（手動操作は不要）'
      : '';
    // 手動インストールを促すのは復旧に失敗したトリガーが残っているときだけ。
    // stale（取得遅延）等は自動復旧済み or 次回 autoFetch で回復するので案内を変える。
    const action = missing.length > 0
      ? '対処: スプシメニュー「📊 Instagram Insights → ⏰ トリガーをインストール」を再実行してください。'
      : '対処: 次回 autoFetch（最大30分後）で取得が再開します。回復しない場合はトークン/設定を確認してください。';
    const message =
      '🚨 IGインサイト ヘルスチェック異常\n\n' +
      alerts.join('\n') + restoredLine + '\n\n' +
      action + '\n' +
      'スプシ: ' + ss.getUrl();

    notifyDiscord(message, {
      kind: 'health_check_alert',
      bypassCooldown: true,
      toError: true,
    });
    Logger.log('healthCheck 異常通知送信: ' + alerts.join(' / '));
  } catch (e) {
    Logger.log('healthCheck 例外: ' + e.message + '\n' + e.stack);
  }
}

/**
 * 手動実行用（メニューから呼ばれる）
 */
function healthCheckManual() {
  healthCheck();
  const lastStr = getConfig('LAST_AUTOFETCH_SUCCESS');
  const lastMs = lastStr ? parseInt(lastStr, 10) : 0;
  const lastFmt = lastMs
    ? Utilities.formatDate(new Date(lastMs), 'Asia/Tokyo', 'yyyy/MM/dd HH:mm')
    : '(記録なし)';
  const triggers = ScriptApp.getProjectTriggers();
  const handlers = triggers.map(t => t.getHandlerFunction());
  const missing = Object.keys(TRIGGER_SPECS).filter(h => handlers.indexOf(h) < 0);

  SpreadsheetApp.getUi().alert(
    'ヘルスチェック実行結果\n\n' +
    '・autoFetch最終成功: ' + lastFmt + '\n' +
    '・必須トリガー: ' + (missing.length === 0 ? '✅ すべて存在' : '⚠️ 消失=' + missing.join(',')) + '\n' +
    '・現在のトリガー数: ' + triggers.length + '件\n\n' +
    '異常があればエラー通知用Discordチャンネルに通知済みです。'
  );
}

/**
 * エラー用Discord Webhookの疎通テスト（デバッグ用）
 * ERROR_WEBHOOK_URL に直接POSTし、設定値・HTTPレスポンスをアラート表示する
 */
function testErrorWebhook() {
  const ui = SpreadsheetApp.getUi();
  const errorUrl = getConfig('ERROR_WEBHOOK_URL');
  const fallbackUrl = getConfig('WEBHOOK_URL');
  const useUrl = errorUrl || fallbackUrl;
  const source = errorUrl ? 'ERROR_WEBHOOK_URL' : (fallbackUrl ? 'WEBHOOK_URL（fallback）' : '(両方未設定)');

  if (!useUrl) {
    ui.alert('Webhook URL 未設定\n\nERROR_WEBHOOK_URL も WEBHOOK_URL も Script Properties に保存されていません。');
    return;
  }

  const expectedLength = 121;
  const lengthInfo = useUrl.length + (useUrl.length === expectedLength
    ? '（期待値一致）'
    : '（期待値=' + expectedLength + '・差分=' + (useUrl.length - expectedLength) + '）');

  let code = 0;
  let body = '';
  try {
    const res = UrlFetchApp.fetch(useUrl, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify({ content: '🧪 testErrorWebhook 疎通テスト（' + new Date().toISOString() + '）' }),
      muteHttpExceptions: true,
    });
    code = res.getResponseCode();
    body = res.getContentText().slice(0, 300);
  } catch (e) {
    body = '例外: ' + e.message;
  }

  console.log('testErrorWebhook 保存URL全文: ' + useUrl);
  console.log('testErrorWebhook 長さ: ' + useUrl.length);

  ui.alert(
    'Webhook疎通テスト結果\n\n' +
    '・使用URL種別: ' + source + '\n' +
    '・URL長さ: ' + lengthInfo + '\n' +
    '・URL全文:\n' + useUrl + '\n\n' +
    '・HTTPコード: ' + code + (code === 204 ? '（成功）' : '（失敗）') + '\n' +
    '・レスポンス本文: ' + (body || '(なし)')
  );
}
