// ==========
// 時間トリガーのインストール・アンインストール
// ==========

const TRIGGER_HANDLERS = ['autoFetch', 'refreshTokenJob', 'autoOcrTick_', 'csvReminderJob'];

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

  ScriptApp.newTrigger('csvReminderJob')
    .timeBased()
    .onMonthDay(1)
    .atHour(9)
    .create();

  SpreadsheetApp.getUi().alert(
    'トリガーをインストールしました\n\n' +
    '・autoFetch: 30分ごと（インサイト自動取得）\n' +
    '・refreshTokenJob: 毎週日曜 9時（トークン更新）\n' +
    '・csvReminderJob: 毎月1日 9時（ストーリーズCSV取込みリマインダー）'
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
