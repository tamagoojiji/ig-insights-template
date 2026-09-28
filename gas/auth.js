/**
 * トークン管理・リフレッシュ
 * ※ トークン値はScript Propertiesに保存（ハードコードなし）
 */

/**
 * debug_token で「実際の」失効UNIX秒を取得する。
 * @param {string} token - 検査対象トークン
 * @param {string} appId
 * @param {string} appSecret
 * @return {number|null} expires_at（UNIX秒・0は無期限）。取得失敗時は null
 */
function fetchTokenRealExpiry_(token, appId, appSecret) {
  try {
    const url = `${IG_API_BASE}/debug_token?input_token=${encodeURIComponent(token)}&access_token=${encodeURIComponent(appId + '|' + appSecret)}`;
    const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    const data = JSON.parse(res.getContentText());
    if (data && data.error) {
      Logger.log('debug_token エラー: ' + JSON.stringify(data.error).slice(0, 200));
      return null;
    }
    const info = data && data.data;
    if (info && info.is_valid === false) {
      Logger.log('debug_token: トークンが無効(is_valid=false)です: ' + res.getContentText().slice(0, 200));
      return null;
    }
    const expiresAt = info && info.expires_at;
    if (typeof expiresAt === 'number') {
      // Pageトークン等は expires_at=0（無期限）でも data_access_expires_at で切れる。
      // 0のまま「無期限」にすると監視が止まるため、そちらを実失効として扱う
      const dataAccess = info.data_access_expires_at;
      if (expiresAt === 0 && typeof dataAccess === 'number' && dataAccess > 0) return dataAccess;
      return expiresAt;
    }
    Logger.log('debug_token: expires_at を取得できませんでした: ' + res.getContentText().slice(0, 200));
    return null;
  } catch (e) {
    Logger.log('debug_token 例外: ' + e.message);
    return null;
  }
}

/**
 * 長期トークン交換の共通コア（fb_exchange_token）
 * refreshLongLivedToken（週次更新・失敗通知あり）と
 * exchangeToLongLivedToken（接続テスト・失敗通知なし）の両方から使う。
 * @param {{notify?: boolean}} [opts] notify=true で失敗時にメール通知
 */
function fbExchangeLongLivedToken_(opts) {
  opts = opts || {};
  const currentToken = getConfig('IG_ACCESS_TOKEN');
  const appId = getConfig('FB_APP_ID');
  const appSecret = getConfig('FB_APP_SECRET');

  if (!currentToken || !appId || !appSecret) {
    Logger.log('長期トークン交換: 必要な設定が不足しています');
    return false;
  }

  try {
    const url = `https://graph.facebook.com/v21.0/oauth/access_token?grant_type=fb_exchange_token&client_id=${appId}&client_secret=${appSecret}&fb_exchange_token=${currentToken}`;
    const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    const data = JSON.parse(res.getContentText());

    if (data.error) {
      Logger.log(`長期トークン交換エラー: ${data.error.message}`);
      if (opts.notify) notifyRefreshError(data.error.message);
      return false;
    }

    if (data.access_token) {
      setConfig('IG_ACCESS_TOKEN', data.access_token);
      // 交換に成功したのでリフレッシュ抑制のクールダウンを解除する
      PropertiesService.getScriptProperties().deleteProperty('TOKEN_REFRESH_LAST_ATTEMPT');

      // 実失効日時を debug_token で確認して保存する。fb_exchange_token は
      // 再ログインが無いセッションだと寿命が延びないトークンを返すことがあり、
      // +60日の決め打ちでは実失効（2026-09-10の取得停止）を見逃すため。
      const expiresAt = fetchTokenRealExpiry_(data.access_token, appId, appSecret);
      if (expiresAt === null) {
        // debug_token 失敗時は将来日を上書きしない（失効済みを将来日で覆い隠さないため）
        Logger.log('debug_token取得失敗 — TOKEN_EXPIRYは現状維持: ' + (getConfig('TOKEN_EXPIRY') || '(未設定)'));
        return true;
      }

      let expiryLabel;
      if (expiresAt === 0) {
        expiryLabel = '無期限';
      } else {
        expiryLabel = Utilities.formatDate(new Date(expiresAt * 1000), 'Asia/Tokyo', 'yyyy/MM/dd HH:mm');
        const days = (expiresAt * 1000 - Date.now()) / (1000 * 60 * 60 * 24);
        // 週次更新なので、交換直後に14日未満＝寿命が延びていない（再ログインでの再発行が必要）。
        // 接続テスト経由（notify:false）はUIのアラートで実失効を出すので通知しない
        if (days < 14 && opts.notify) {
          try {
            notifyDiscord(
              '⚠️ IGトークンを交換しましたが寿命が延びていません（実失効: ' + expiryLabel + '）。\n' +
              'Graph API Explorer等で新しいトークンを取得し、「🔐 シークレット入力」→「🔗 接続テスト」を実行してください。',
              { kind: 'token_not_extended', toError: true, cooldownMs: 24 * 60 * 60 * 1000 }
            );
          } catch (_) {}
        }
      }
      setConfig('TOKEN_EXPIRY', expiryLabel);

      // 設定シートにも反映
      updateExpiryOnSheet();

      Logger.log('長期トークン交換成功（実失効: ' + expiryLabel + '）');
      return true;
    }
  } catch (e) {
    Logger.log(`長期トークン交換例外: ${e.message}`);
    if (opts.notify) notifyRefreshError(e.message);
    return false;
  }

  return false;
}

/**
 * 長期トークンをリフレッシュ（失敗時はメール通知あり）
 */
function refreshLongLivedToken() {
  return fbExchangeLongLivedToken_({ notify: true });
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

  if (expiryStr === '無期限') {
    Logger.log('TOKEN_EXPIRY は無期限 — チェック不要');
    return;
  }

  const expiry = new Date(expiryStr);
  if (isNaN(expiry.getTime())) {
    Logger.log('TOKEN_EXPIRY が不正な日付です: ' + expiryStr);
    return;
  }
  const now = new Date();
  const daysUntilExpiry = (expiry - now) / (1000 * 60 * 60 * 24);

  if (daysUntilExpiry <= 7) {
    // この関数は30分毎のautoFetchから呼ばれるため、失効後は交換失敗の通知・メールが
    // 30分毎にスパム化する。リフレッシュ試行自体を6時間に1回へ抑制する。
    const props = PropertiesService.getScriptProperties();
    const lastStr = props.getProperty('TOKEN_REFRESH_LAST_ATTEMPT');
    const last = lastStr ? parseInt(lastStr, 10) : 0;
    const REFRESH_COOLDOWN_MS = 6 * 60 * 60 * 1000;
    if (Date.now() - last < REFRESH_COOLDOWN_MS) {
      Logger.log(`トークン期限まで${Math.floor(daysUntilExpiry)}日 — リフレッシュ抑制中（6時間に1回）`);
      return;
    }
    Logger.log(`トークン期限まで${Math.floor(daysUntilExpiry)}日 — リフレッシュ実行`);
    props.setProperty('TOKEN_REFRESH_LAST_ATTEMPT', String(Date.now()));
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
