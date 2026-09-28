// ==========
// 時間トリガーのインストール・アンインストール
// ==========

// 'csvReminderJob' は新規作成しない（CSVリマインダー停止済み）が、
// 既存のライブトリガーを removeOurTriggers_/uninstallTriggers で回収できるよう handler 名だけ残す
// 'reelVideoBackfillTick_' は一時トリガー（完走で自己削除）。TRIGGER_SPECS に無いので
// ensureTriggers_ に復活させられることはないが、uninstallTriggers/installTriggers を実行すると
// 実行中のリール動画バックフィルも一緒に止まる（再開はメニューから）
const TRIGGER_HANDLERS = ['autoFetch', 'refreshTokenJob', 'autoOcrTick_', 'csvReminderJob', 'healthCheck', 'recordFollowersJob', 'reelVideoBackfillTick_', 'suggestReelNames'];

// 必須トリガーの生成仕様（installTriggers と ensureTriggers_ が共有する唯一の定義源）
// キー = ハンドラ名 / 値 = ClockTriggerBuilder を受けてスケジュールを適用し返す関数
const TRIGGER_SPECS = {
  autoFetch:          (c) => c.everyMinutes(30),
  refreshTokenJob:    (c) => c.everyWeeks(1).onWeekDay(ScriptApp.WeekDay.SUNDAY).atHour(9),
  healthCheck:        (c) => c.everyDays(1).atHour(9),
  recordFollowersJob: (c) => c.everyDays(1).atHour(23),
  suggestReelNames:   (c) => c.everyWeeks(1).onWeekDay(ScriptApp.WeekDay.MONDAY).atHour(10),
};

/**
 * TRIGGER_SPECS の定義に従って1つの時間主導トリガーを作成する
 */
function createTrigger_(name) {
  TRIGGER_SPECS[name](ScriptApp.newTrigger(name).timeBased()).create();
}

/**
 * 自動取得（30分ごと）+ トークン更新（毎週日曜9時）等のトリガーをインストール
 */
function installTriggers() {
  try {
    assertConfigured();
  } catch (e) {
    SpreadsheetApp.getUi().alert('インストールできません\n\n' + e.message);
    return;
  }

  removeOurTriggers_();
  Object.keys(TRIGGER_SPECS).forEach(createTrigger_);

  SpreadsheetApp.getUi().alert(
    'トリガーをインストールしました\n\n' +
    '・autoFetch: 30分ごと（インサイト自動取得）\n' +
    '・refreshTokenJob: 毎週日曜 9時（トークン更新）\n' +
    '・healthCheck: 毎日 9時（トリガー消失・取得停止の検知→エラー用Discord通知）\n' +
    '・recordFollowersJob: 毎日 23時台（フォロワー数記録）\n\n' +
    '※ 万一いずれかが消えても autoFetch が30分毎に自動で復旧します（手動の再インストールは不要）。'
  );
}

/**
 * 欠けている必須トリガーを自動で再作成する（自己修復）。
 * Google が時間主導トリガーを不定期に脱落させても、autoFetch(30分毎)/healthCheck から
 * 呼ばれて最大30分で無人復旧するため、手動の再インストールが不要になる。
 * 未設定時は何もしない（no-op）。
 * @returns {string[]} 復元したハンドラ名の配列
 */
function ensureTriggers_() {
  try {
    assertConfigured();
  } catch (e) {
    return []; // 必須設定が未登録なら復旧しない（installTriggers と同じガード）
  }

  // 存在確認→作成を直列化（autoFetch と healthCheck、あるいは長時間 autoFetch の
  // 重複起動が同時に走っても、同一ハンドラのトリガーを二重作成しないようロックする）。
  // ロックを取れない＝他実行が処理中なので、その回はスキップする（重複作成の防止が目的）。
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    Logger.log('ensureTriggers_ ロック取得失敗（他実行が処理中のためスキップ）');
    return [];
  }

  // 自己修復が失敗しても呼び出し元（autoFetch のデータ取得等）を絶対に壊さない
  try {
    // ロック取得後に必ず再読込し、ハンドラ名ごとにトリガーを集約する
    const byHandler = {};
    ScriptApp.getProjectTriggers().forEach(t => {
      const h = t.getHandlerFunction();
      (byHandler[h] = byHandler[h] || []).push(t);
    });

    // 過去の競合等で既に重複しているトリガーは余剰を削除（自己治癒）
    Object.keys(TRIGGER_SPECS).forEach(name => {
      const dups = byHandler[name] || [];
      for (let i = 1; i < dups.length; i++) {
        ScriptApp.deleteTrigger(dups[i]);
        Logger.log('ensureTriggers_ 重複トリガー削除: ' + name);
      }
    });

    // 不足しているハンドラだけ作成する
    const restored = [];
    Object.keys(TRIGGER_SPECS).forEach(name => {
      if ((byHandler[name] || []).length >= 1) return;
      try {
        createTrigger_(name);
        restored.push(name);
      } catch (e) {
        Logger.log('ensureTriggers_ 再作成失敗 ' + name + ': ' + e.message);
      }
    });
    if (restored.length) Logger.log('ensureTriggers_ 自動復旧: ' + restored.join(', '));
    return restored;
  } catch (e) {
    Logger.log('ensureTriggers_ 例外: ' + e.message);
    return [];
  } finally {
    lock.releaseLock();
  }
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
