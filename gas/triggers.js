// ==========
// 時間トリガーのインストール・アンインストール
// ==========

// 'csvReminderJob' は新規作成しない（CSVリマインダー停止済み）が、
// 既存のライブトリガーを removeOurTriggers_/uninstallTriggers で回収できるよう handler 名だけ残す
const TRIGGER_HANDLERS = ['autoFetch', 'refreshTokenJob', 'autoOcrTick_', 'csvReminderJob', 'healthCheck'];

/**
 * 自動取得（30分ごと）+ トークン更新（毎週日曜9時）のトリガーをインストール
 */
function installTriggers() {
  try {
    assertConfigured();
  } catch (e) {
    SpreadsheetApp.getUi().alert('インストールできません\n\n' + e.message);
    return;
  }

  removeOurTriggers_();

  ScriptApp.newTrigger('autoFetch')
    .timeBased()
    .everyMinutes(30)
    .create();

  ScriptApp.newTrigger('refreshTokenJob')
    .timeBased()
    .everyWeeks(1)
    .onWeekDay(ScriptApp.WeekDay.SUNDAY)
    .atHour(9)
    .create();

  ScriptApp.newTrigger('healthCheck')
    .timeBased()
    .everyDays(1)
    .atHour(9)
    .create();

  SpreadsheetApp.getUi().alert(
    'トリガーをインストールしました\n\n' +
    '・autoFetch: 30分ごと（インサイト自動取得）\n' +
    '・refreshTokenJob: 毎週日曜 9時（トークン更新）\n' +
    '・healthCheck: 毎日 9時（トリガー消失・取得停止の検知→エラー用Discord通知）'
  );
}

/**
 * 全トリガー削除
 */
function uninstallTriggers() {
  const count = removeOurTriggers_();
  SpreadsheetApp.getUi().alert(count + '個のトリガーを削除しました');
}

/**
 * 現在のトリガー状況を表示
 */
function listTriggers() {
  const triggers = ScriptApp.getProjectTriggers();
  const lines = triggers.map(t => {
    return '・' + t.getHandlerFunction() + ' (id=' + t.getUniqueId() + ')';
  });
  SpreadsheetApp.getUi().alert(
    '現在のトリガー: ' + triggers.length + '件\n\n' +
    (lines.join('\n') || '(なし)')
  );
}

function removeOurTriggers_() {
  let count = 0;
  ScriptApp.getProjectTriggers().forEach(t => {
    if (TRIGGER_HANDLERS.indexOf(t.getHandlerFunction()) >= 0) {
      ScriptApp.deleteTrigger(t);
      count++;
    }
  });
  return count;
}
