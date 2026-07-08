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
  'ERROR_WEBHOOK_URL',
  'BACKFILL_CURSOR',
  'LAST_CSV_IMPORT_DATE',
  'LAST_AUTOFETCH_SUCCESS'
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
 * 値をマスク表示用に変換
 */
function maskValue_(v) {
  if (!v) return '(未設定)';
  if (v.length <= 8) return '****';
  return v.slice(0, 4) + '****' + v.slice(-4);
}

function formatCsvImportStatus_(dateStr) {
  if (!dateStr) return '⚠️ 未インポート';
  const last = new Date(dateStr);
  const days = Math.floor((Date.now() - last.getTime()) / 86400000);
  if (days >= 30) return '⚠️ ' + dateStr + ' (' + days + '日前) — 取り込み推奨';
  return dateStr + ' (' + days + '日前)';
}

/**
 * シークレットをダイアログで入力 → Script Properties に直接保存
 * スプシのセルを経由しないので、シート履歴・共有経路に残らない
 */
function promptAndSaveSecrets() {
  const ui = SpreadsheetApp.getUi();
  const items = [
    { key: 'FB_APP_ID', label: 'Facebook アプリID',
      desc: 'Meta開発者ダッシュボード「設定 → 基本設定」のアプリID（15〜17桁の数字）' },
    { key: 'FB_APP_SECRET', label: 'Facebook アプリシークレット',
      desc: '同画面の「アプリシークレット」（「表示」ボタン → FBパスワード入力で見える）' },
    { key: 'IG_ACCESS_TOKEN', label: 'Instagram アクセストークン',
      desc: 'Graph API Explorer で取得した短期/長期トークン' },
    { key: 'GEMINI_API_KEY', label: 'Gemini APIキー（任意・OCR用）',
      desc: 'ストーリーズ画像内テキストの自動OCRに使用。Google AI Studio (aistudio.google.com) → Get API key で取得した「AIza…」を貼付。空のままなら共有proxy経由でOCR（自分の無料枠を使う場合のみ入力）' },
    { key: 'WEBHOOK_URL', label: 'Discord Webhook URL（任意）',
      desc: 'Discord チャンネル設定 → 連携サービス → ウェブフック（不要なら空のままOK）' },
    { key: 'ERROR_WEBHOOK_URL', label: 'Discord エラー通知用 Webhook URL（任意）',
      desc: 'ヘルスチェック異常時の通知先（管理者専用チャンネル推奨）。未設定なら通常Webhookに送信' }
  ];

  let savedCount = 0;
  for (const item of items) {
    const current = getConfig(item.key);
    const res = ui.prompt(
      `🔐 ${item.label}`,
      `${item.desc}\n\n現在: ${maskValue_(current)}\n\n新しい値を貼り付けて「OK」。変更しない場合は空のまま「OK」。`,
      ui.ButtonSet.OK_CANCEL
    );
    const btn = res.getSelectedButton();
    if (btn === ui.Button.CANCEL || btn === ui.Button.CLOSE) break;
    const newVal = (res.getResponseText() || '').trim();
    if (newVal) {
      setConfig(item.key, newVal);
      savedCount++;
    }
  }

  // 設定シートのマスク表示を更新（既にあれば）
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    if (ss.getSheetByName('⚙️ 設定')) setupSettingsSheet();
  } catch (_) {}

  ui.alert(savedCount > 0 ? `✅ ${savedCount}件のシークレットを保存しました` : '変更はありませんでした');
}

/**
 * 旧フロー（互換用）：設定シートに値が貼られていた場合のみ Script Properties へ転送
 * 新フローでは promptAndSaveSecrets() を使用
 */
function saveSettingsFromSheet() {
  const ui = SpreadsheetApp.getUi();
  ui.alert(
    '⚠️ このメニューは廃止されました\n\n' +
    'シークレットは「🔐 シークレット入力」メニューから入力してください。\n' +
    'スプシのセルを経由しないため、シート履歴や共有時の漏洩リスクがなくなります。'
  );
}

/**
 * 接続テスト
 * - アクセストークン必須
 * - IG_USER_ID は未設定なら /me/accounts から自動取得・自動保存
 * - 短期トークンの場合は60日長期トークンに自動交換
 */
function testConnection() {
  const token = getConfig('IG_ACCESS_TOKEN');
  let userId = getConfig('IG_USER_ID');

  if (!token) {
    SpreadsheetApp.getUi().alert(
      'アクセストークンが未設定です\n\n' +
      'メニュー「🔐 シークレット入力」を実行してトークンを登録してください。'
    );
    return;
  }

  if (!userId) {
    try {
      userId = autoFetchIGUserId_(token);
      if (!userId) {
        SpreadsheetApp.getUi().alert(
          'Instagramユーザーアカウントが見つかりませんでした\n\n' +
          '・Facebookページに Instagram ビジネス/クリエイターアカウントが連携されているか\n' +
          '・アクセストークンに instagram_basic / pages_show_list / pages_read_engagement / business_management の権限が付いているか\n' +
          'を確認してください。'
        );
        return;
      }
      setConfig('IG_USER_ID', userId);
      try {
        const ss = SpreadsheetApp.getActiveSpreadsheet();
        const sheet = ss.getSheetByName('⚙️ 設定');
        if (sheet) {
          // ラベル検索で「Instagram ユーザーID」行を特定（固定行だと将来のレイアウト変更で壊れる）
          const labels = sheet.getRange(1, 1, sheet.getLastRow(), 1).getValues();
          for (let r = 0; r < labels.length; r++) {
            if (String(labels[r][0]).indexOf('Instagram ユーザーID') === 0) {
              sheet.getRange(r + 1, 2).setValue(userId);
              break;
            }
          }
        }
      } catch (_) {}
    } catch (e) {
      SpreadsheetApp.getUi().alert('IG_USER_ID自動取得エラー: ' + e.message);
      return;
    }
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
 * /me/accounts から Facebook ページを取得し、連携されている Instagram ビジネス/クリエイター
 * アカウントの ID を自動取得する
 */
function autoFetchIGUserId_(token) {
  const url = `https://graph.facebook.com/v21.0/me/accounts?fields=id,name,instagram_business_account&limit=50&access_token=${token}`;
  const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  const data = JSON.parse(res.getContentText());
  if (data.error) throw new Error(data.error.message);
  if (!data.data || data.data.length === 0) {
    throw new Error('Facebookページが1つも見つかりません。Meta Business Suite で IGビジネスアカウントを連携したFBページを作成してください。');
  }
  for (const page of data.data) {
    if (page.instagram_business_account && page.instagram_business_account.id) {
      Logger.log('IG_USER_ID 自動取得成功: page=' + page.name + ' ig_id=' + page.instagram_business_account.id);
      return page.instagram_business_account.id;
    }
  }
  return null;
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
 * 設定シートを初期化（表示専用・シークレットはマスク表示）
 * 値はすべて Script Properties に保存され、シートには貼り付けない
 */
function setupSettingsSheet() {
  // 旧 Gemini APIキーの残留を消去（Vertex proxy 経由化で不要）
  try { PropertiesService.getScriptProperties().deleteProperty('GEMINI_API_KEY'); } catch (_) {}
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName('⚙️ 設定');
  if (!sheet) {
    sheet = ss.insertSheet('⚙️ 設定');
  }

  const config = getAllConfig();

  sheet.clear();
  sheet.setColumnWidth(1, 280);
  sheet.setColumnWidth(2, 480);

  const labels = [
    ['📌 IGインサイト保存テンプレート 設定（表示専用）', ''],
    ['', ''],
    ['🔐 シークレット（メニュー「🔐 シークレット入力」から登録）', ''],
    ['Facebook アプリID', config.FB_APP_ID || '(未設定)'],
    ['Facebook アプリシークレット', maskValue_(config.FB_APP_SECRET)],
    ['Instagram アクセストークン', maskValue_(config.IG_ACCESS_TOKEN)],
    ['Gemini接続', 'Vertex proxy経由（キー設定不要）'],
    ['Discord Webhook URL（任意）', maskValue_(config.WEBHOOK_URL)],
    ['Discord エラー通知用 Webhook URL（任意）', maskValue_(config.ERROR_WEBHOOK_URL)],
    ['', ''],
    ['📦 自動設定される値', ''],
    ['Instagram ユーザーID', config.IG_USER_ID || '(接続テストで自動取得)'],
    ['Googleドライブ フォルダID', config.DRIVE_FOLDER_ID || '(📁 Driveフォルダ準備で自動作成)'],
    ['トークン有効期限', config.TOKEN_EXPIRY || '(接続テストで自動設定)'],
    ['ストーリーズCSV最終インポート', formatCsvImportStatus_(config.LAST_CSV_IMPORT_DATE)],
    ['', ''],
    ['📋 セットアップの流れ', ''],
    ['1. 🔐 シークレット入力（FBアプリID/SECRET、IGトークンなど）', ''],
    ['2. 🔗 接続テスト（→ 長期トークン化＋USER_ID自動取得）', ''],
    ['3. 📁 Drive画像保存フォルダを準備', ''],
    ['4. 📚 過去全件取り込み（API）', ''],
    ['5. 📦 Meta公式zipアップロード（過去ストーリーズ用）', ''],
    ['6. ⏰ トリガーをインストール', ''],
    ['', ''],
    ['📖 詳しい手順', 'https://tamagoojiji.github.io/ig-insights-template/setup-guide.html']
  ];

  sheet.getRange(1, 1, labels.length, 2).setValues(labels);
  sheet.getRange(1, 1).setFontSize(14).setFontWeight('bold');
  sheet.getRange(3, 1).setFontWeight('bold').setBackground('#FFF3E0');
  sheet.getRange(11, 1).setFontWeight('bold').setBackground('#E3F2FD');
  sheet.getRange(16, 1).setFontWeight('bold');
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
      'メニュー「🔐 シークレット入力」を実行して登録してください。'
    );
  }
}
