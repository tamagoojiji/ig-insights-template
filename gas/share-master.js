// ==========
// マスタースプシを「リンクを知っている全員が閲覧可」に設定（/copy 用）
// クリエイター（配布元）が1回だけ実行する。実行後、購入者がコピーできるようになる。
// 利用者はこの関数を実行する必要なし。
// ==========

function makeMasterSheetPublic() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const file = DriveApp.getFileById(ss.getId());
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  const message = 'マスタースプシを「リンクを知っている全員が閲覧可」に設定しました\n\n' +
    'これで誰でも以下のURLからコピーできます:\n' +
    'https://docs.google.com/spreadsheets/d/' + ss.getId() + '/copy';
  console.log(message);
  try {
    SpreadsheetApp.getUi().alert(message);
  } catch (_) {
    // Apps Scriptエディタからの直接実行時は無視
  }
}

// ==========
// 【1回限り・マスター専用】マスタースプシの全データを削除する
// 配布前のクリーンアップ用。GASエディタから直接 resetMasterDataOnce を実行する（メニュー登録なし）
// scriptIdガードあり: コピー先（配布利用者の環境）では実行できない
// ==========

function resetMasterDataOnce() {
  const MASTER_SCRIPT_ID = '1sEfx6Lbc4_1efKbL2gL7cDNW8ONxObVLzNypOeLBTvsob_wnB2DsoAah';
  const ui = SpreadsheetApp.getUi();

  if (ScriptApp.getScriptId() !== MASTER_SCRIPT_ID) {
    ui.alert('この関数はマスタースプシ専用です。\n利用者のスプシでは実行できません。');
    return;
  }

  const res = ui.alert(
    '⚠️ マスター全データ削除',
    '⚙️ 設定 以外の全シートを削除し、Script Properties の全シークレットを削除します。\n本当に実行しますか？',
    ui.ButtonSet.YES_NO
  );
  if (res !== ui.Button.YES) return;

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const deleted = [];
  ss.getSheets().slice().forEach(sheet => {
    const name = sheet.getName();
    if (name === '⚙️ 設定') return;
    ss.deleteSheet(sheet);
    deleted.push(name);
  });

  const props = PropertiesService.getScriptProperties();
  const propCount = Object.keys(props.getProperties()).length;
  props.deleteAllProperties();

  try { setupSettingsSheet(); } catch (_) {}

  ui.alert(
    '✅ 削除完了\n\n【削除シート】\n' +
    (deleted.join('\n') || '対象なし') +
    '\n\n【Script Properties】\n' + propCount + '件削除' +
    '\n\n配布利用者は「🛠️ 初期設定（シート作成）」で必要シートを作成できます'
  );
}
