// ==========
// IG長期トークン自動更新（週次トリガー）
// 失敗時は Discord 通知 + 例外throw
// ==========

function refreshTokenJob() {
  try {
    assertConfigured();
    const result = refreshLongLivedToken();
    if (result === false) {
      throw new Error('長期トークン更新に失敗しました');
    }
    notifyDiscord('✅ IGトークンを自動更新しました（次回 +60日有効）', { kind: 'refresh_success' });
    console.log('IGトークン更新成功');
  } catch (e) {
    const msg = e.message || String(e);
    try {
      notifyDiscord('⚠️ IGトークン自動更新失敗: ' + msg + '\n\n手動で「🔄 トークン手動更新」を実行してください。', { kind: 'refresh_failure' });
    } catch (_) {}
    console.error('IGトークン更新失敗:', msg);
    throw e;
  }
}

/**
 * トークン取り直し（手動）
 * 万が一更新失敗が続いた場合に手動で実行
 */
function refreshTokenManual() {
  try {
    refreshTokenJob();
    SpreadsheetApp.getUi().alert('トークン更新を手動実行しました。Discord通知をご確認ください。');
  } catch (e) {
    SpreadsheetApp.getUi().alert('トークン更新失敗: ' + e.message);
  }
}
