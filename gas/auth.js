/**
 * トークン管理・リフレッシュ
 * ※ トークン値はScript Propertiesに保存（ハードコードなし）
 */

/**
 * 長期トークンをリフレッシュ
 */
function refreshLongLivedToken() {
  const currentToken = getConfig('IG_ACCESS_TOKEN');
  const appId = getConfig('FB_APP_ID');
  const appSecret = getConfig('FB_APP_SECRET');

  if (!currentToken || !appId || !appSecret) {
    Logger.log('トークンリフレッシュ: 必要な設定が不足しています');
    return false;
  }

  try {
    const url = `https://graph.facebook.com/v21.0/oauth/access_token?grant_type=fb_exchange_token&client_id=${appId}&client_secret=${appSecret}&fb_exchange_token=${currentToken}`;
    const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    const data = JSON.parse(res.getContentText());

    if (data.error) {
      Logger.log(`トークンリフレッシュエラー: ${data.error.message}`);
      notifyRefreshError(data.error.message);
      return false;
    }

    if (data.access_token) {
      setConfig('IG_ACCESS_TOKEN', data.access_token);

      // 有効期限を設定（60日後）
      const expiry = new Date();
      expiry.setDate(expiry.getDate() + 60);
      setConfig('TOKEN_EXPIRY', Utilities.formatDate(expiry, 'Asia/Tokyo', 'yyyy/MM/dd'));

      // 設定シートにも反映
      updateExpiryOnSheet(expiry);

      Logger.log('トークンリフレッシュ成功');
      return true;
    }
  } catch (e) {
    Logger.log(`トークンリフレッシュ例外: ${e.message}`);
    notifyRefreshError(e.message);
    return false;
  }

  return false;
}

/**
 * トークン期限チェック（7日前に自動リフレッシュ）
 */
function checkAndRefreshToken() {
  const expiryStr = getConfig('TOKEN_EXPIRY');
  if (!expiryStr) {
    Logger.log('TOKEN_EXPIRY が未設定です');
    return;
  }

  const expiry = new Date(expiryStr);
  const now = new Date();
  const daysUntilExpiry = (expiry - now) / (1000 * 60 * 60 * 24);

  if (daysUntilExpiry <= 7) {
    Logger.log(`トークン期限まで${Math.floor(daysUntilExpiry)}日 — リフレッシュ実行`);
    refreshLongLivedToken();
  } else {
    Logger.log(`トークン期限まで${Math.floor(daysUntilExpiry)}日 — OK`);
  }
}

/**
 * リフレッシュエラー通知（メールのみ）
 */
function notifyRefreshError(errorMessage) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  try {
    const email = Session.getEffectiveUser().getEmail();
    if (email) {
      MailApp.sendEmail(
        email,
        '⚠️ Instagram Insights: 認証エラー',
        `Instagram Insights Toolで認証エラーが発生しました。\n\nエラー: ${errorMessage}\n\nスプレッドシート: ${ss.getUrl()}\n\nMeta for Developersで再設定してください。`
      );
    }
  } catch (e) {
    Logger.log(`メール通知エラー: ${e.message}`);
  }
}

/**
 * 設定シートの有効期限表示を更新（シート全体を再描画）
 */
function updateExpiryOnSheet(_expiryDate) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    if (ss.getSheetByName('⚙️ 設定')) setupSettingsSheet();
  } catch (_) {}
}
