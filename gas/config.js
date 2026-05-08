/**
 * Script Properties の読み書き・設定シートUI
 */

const CONFIG_KEYS = [
  'IG_ACCESS_TOKEN',
  'IG_USER_ID',
  'DRIVE_FOLDER_ID',
  'TOKEN_EXPIRY',
  'FB_APP_ID',
  'FB_APP_SECRET',
  'GEMINI_API_KEY',
  'WEBHOOK_URL',
  'BACKFILL_CURSOR'
];

function getConfig(key) {
  return PropertiesService.getScriptProperties().getProperty(key);
}

function setConfig(key, value) {
  PropertiesService.getScriptProperties().setProperty(key, value);
}

function getAllConfig() {
  const props = PropertiesService.getScriptProperties().getProperties();
  return CONFIG_KEYS.reduce((acc, key) => {
    acc[key] = props[key] || '';
    return acc;
  }, {});
}

/**
 * 設定シートからScript Propertiesに保存
 */
function saveSettingsFromSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('⚙️ 設定');
  if (!sheet) {
    SpreadsheetApp.getUi().alert('「⚙️ 設定」シートが見つかりません');
    return;
  }

  const mapping = [
    { row: 3, key: 'IG_ACCESS_TOKEN' },
    { row: 5, key: 'IG_USER_ID' },
    { row: 7, key: 'FB_APP_ID' },
    { row: 9, key: 'FB_APP_SECRET' },
    { row: 11, key: 'DRIVE_FOLDER_ID' },
    { row: 13, key: 'GEMINI_API_KEY' },
    { row: 15, key: 'WEBHOOK_URL' }
  ];

  const props = {};
  mapping.forEach(m => {
    const val = sheet.getRange(m.row, 2).getValue();
    if (val) props[m.key] = String(val).trim();
  });

  PropertiesService.getScriptProperties().setProperties(props);
  SpreadsheetApp.getUi().alert('設定を保存しました');
}

/**
 * 接続テスト
 */
function testConnection() {
  const token = getConfig('IG_ACCESS_TOKEN');
  const userId = getConfig('IG_USER_ID');

  if (!token || !userId) {
    SpreadsheetApp.getUi().alert('アクセストークンとユーザーIDを設定してください');
    return;
  }

  try {
    const url = `https://graph.facebook.com/v21.0/${userId}?fields=id,username,media_count&access_token=${token}`;
    const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    const data = JSON.parse(res.getContentText());

    if (data.error) {
      SpreadsheetApp.getUi().alert(`接続エラー: ${data.error.message}`);
      return;
    }

    // 接続成功 → 長期トークンに自動変換
    const longTokenResult = exchangeToLongLivedToken();

    SpreadsheetApp.getUi().alert(
      `接続成功！\n\nユーザー名: ${data.username}\n投稿数: ${data.media_count}` +
      (longTokenResult ? '\n\n✅ 長期トークンに変換しました（60日間有効）' : '\n\n⚠️ 長期トークンへの変換に失敗しました（アプリID/シークレットを確認してください）')
    );
  } catch (e) {
    SpreadsheetApp.getUi().alert(`エラー: ${e.message}`);
  }
}

/**
 * 短期トークンを長期トークンに変換
 */
function exchangeToLongLivedToken() {
  const token = getConfig('IG_ACCESS_TOKEN');
  const appId = getConfig('FB_APP_ID');
  const appSecret = getConfig('FB_APP_SECRET');

  if (!token || !appId || !appSecret) {
    Logger.log('長期トークン変換: アプリID/シークレットが未設定');
    return false;
  }

  try {
    const url = `https://graph.facebook.com/v21.0/oauth/access_token?grant_type=fb_exchange_token&client_id=${appId}&client_secret=${appSecret}&fb_exchange_token=${token}`;
    const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    const data = JSON.parse(res.getContentText());

    if (data.error) {
      Logger.log(`長期トークン変換エラー: ${data.error.message}`);
      return false;
    }

    if (data.access_token) {
      setConfig('IG_ACCESS_TOKEN', data.access_token);

      const expiry = new Date();
      expiry.setDate(expiry.getDate() + 60);
      setConfig('TOKEN_EXPIRY', Utilities.formatDate(expiry, 'Asia/Tokyo', 'yyyy/MM/dd'));
      updateExpiryOnSheet(expiry);

      Logger.log('長期トークンに変換成功');
      return true;
    }
  } catch (e) {
    Logger.log(`長期トークン変換例外: ${e.message}`);
  }
  return false;
}

/**
 * 設定シートを初期化
 */
function setupSettingsSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName('⚙️ 設定');
  if (!sheet) {
    sheet = ss.insertSheet('⚙️ 設定');
  }

  // clear 前に Script Properties から既存値を取得して復元用に保持
  const config = getAllConfig();

  sheet.clear();
  sheet.setColumnWidth(1, 250);
  sheet.setColumnWidth(2, 500);

  const labels = [
    ['📌 IGインサイト保存テンプレート 設定', ''],
    ['', ''],
    ['Instagram アクセストークン（短期/長期）', config.IG_ACCESS_TOKEN || ''],
    ['', ''],
    ['Instagram ユーザーID（接続テストで自動取得）', config.IG_USER_ID || ''],
    ['', ''],
    ['Facebook アプリID', config.FB_APP_ID || ''],
    ['', ''],
    ['Facebook アプリシークレット', config.FB_APP_SECRET || ''],
    ['', ''],
    ['Googleドライブ フォルダID（自動作成可）', config.DRIVE_FOLDER_ID || ''],
    ['', ''],
    ['Gemini APIキー（OCR用・任意）', config.GEMINI_API_KEY || ''],
    ['', ''],
    ['Discord Webhook URL（通知用・任意）', config.WEBHOOK_URL || ''],
    ['', ''],
    ['⚠️ トークン有効期限', config.TOKEN_EXPIRY || '（接続テストで自動設定されます）'],
    ['', ''],
    ['📋 使い方', ''],
    ['1. 上記の項目を入力（B列に貼り付け）', ''],
    ['2. メニュー → 📊 Instagram Insights → 💾 設定を保存', ''],
    ['3. メニュー → 🔗 接続テスト（→ 長期トークン化＋USER_ID自動取得）', ''],
    ['4. メニュー → 📁 Driveフォルダ準備', ''],
    ['5. メニュー → 📚 過去全件取り込み（API）', ''],
    ['6. メニュー → 📦 Meta公式zipアップロード（過去ストーリーズ用）', ''],
    ['7. メニュー → ⏰ トリガーをインストール', ''],
    ['', ''],
    ['📖 詳しい手順', 'https://tamagoojiji.github.io/ig-insights-template/setup-guide.html']
  ];

  sheet.getRange(1, 1, labels.length, 2).setValues(labels);
  sheet.getRange(1, 1).setFontSize(14).setFontWeight('bold');
  sheet.getRange(19, 1).setFontWeight('bold');

  // 入力セルの背景色
  [3, 5, 7, 9, 11, 13, 15].forEach(row => {
    sheet.getRange(row, 2).setBackground('#FFF9C4');
  });
}

/**
 * 必須設定が揃っているか検証（fail-fast）
 * トリガー設置・自動取得開始前にチェックする
 */
function assertConfigured() {
  const required = ['IG_ACCESS_TOKEN', 'IG_USER_ID', 'FB_APP_ID', 'FB_APP_SECRET'];
  const missing = required.filter(k => !getConfig(k));
  if (missing.length > 0) {
    throw new Error(
      '必須設定が未登録: ' + missing.join(', ') + '\n\n' +
      '⚙️ 設定シートにすべての項目を入力してから、\n' +
      '「💾 設定シートからPropertiesに保存」を実行してください。'
    );
  }
}
