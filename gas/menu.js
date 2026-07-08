// ==========
// カスタムメニュー定義
// onOpen で「📊 Instagram Insights」メニューを表示
// ==========

function onOpen() {
  SpreadsheetApp.getUi().createMenu('📊 Instagram Insights')
    .addItem('🔧 初回セットアップ（シート作成）', 'initializeAllSheets')
    .addItem('🔐 シークレット入力', 'promptAndSaveSecrets')
    .addItem('🔍 設定状況を確認', 'checkConfig')
    .addSeparator()
    .addItem('🔗 接続テスト（→長期トークン化＋USER_ID取得）', 'testConnection')
    .addItem('📁 Drive画像保存フォルダを準備', 'ensureDriveFolder')
    .addSeparator()
    .addItem('▶️ 全データ取得（手動）', 'manualFetchAll')
    .addItem('📸 フィード+リールのみ取得', 'manualFetchFeed')
    .addItem('📖 ストーリーズのみ取得', 'manualFetchStories')
    .addItem('🔍 ストーリーズOCR一括（エラー行も再処理）', 'runStoriesOcrAll')
    .addItem('🔢 ストーリーズOCRバッチ（件数指定）', 'runStoriesOcrBatch')
    .addItem('🤖 自動OCR開始（5分おき・完走で自動停止）', 'startAutoOcr')
    .addItem('🛑 自動OCR停止', 'stopAutoOcr')
    .addItem('📈 自動OCR進捗', 'showOcrProgress')
    .addSeparator()
    .addItem('📚 過去全件取り込み（API）', 'backfillFromAPI')
    .addItem('🔁 取り込みカーソルをリセット', 'resetBackfillCursor')
    .addItem('📦 Meta公式zipアップロード（全期間・画像+キャプション）', 'openMetaZipDialog')
    .addItem('📁 Meta公式データ取り込み（Driveフォルダ経由・大容量対応）', 'openMetaDriveDialog')
    .addItem('📷 履歴行に画像URL一括付与（Meta export経由・推奨）', 'openBindFromMetaExportDialog')
    .addItem('🔍 画像URI解決テスト（デバッグ）', 'debugMetaDriveUriResolution')
    .addItem('🔍 media構造ダンプ（デバッグ）', 'debugMetaDriveMediaTree')
    .addItem('🔍 画像URL列チェック（デバッグ）', 'debugCheckImageColumn')
    .addItem('🔍 TS照合検証（デバッグ）', 'debugTimestampMatch')
    .addItem('📤 Business Suite CSVインポート（ストーリーズ/フィード/リール自動判定）', 'openStoriesCsvDialog')
    .addSeparator()
    .addItem('📊 ダッシュボード更新', 'updateDashboard')
    .addItem('🎨 ストーリーズシート整形', 'beautifyStoriesSheet')
    .addItem('📝 既存キャプションを全文化', 'backfillFullCaptions')
    .addSeparator()
    .addItem('🔄 トークン手動更新', 'refreshTokenManual')
    .addItem('⏰ トリガーをインストール', 'installTriggers')
    .addItem('📋 トリガー一覧', 'listTriggers')
    .addItem('🗑 トリガーを削除', 'uninstallTriggers')
    .addItem('🩺 ヘルスチェック手動実行', 'healthCheckManual')
    .addItem('🧪 エラー用Webhook疎通テスト', 'testErrorWebhook')
    .addToUi();
}

/**
 * 設定状況を確認（マスク表示）
 */
function checkConfig() {
  const config = getAllConfig();
  const mask = (v) => {
    if (!v) return '(未設定)';
    if (v.length <= 8) return '****';
    return v.slice(0, 4) + '****' + v.slice(-4);
  };
  const lines = [
    'Instagram アクセストークン: ' + mask(config.IG_ACCESS_TOKEN),
    'Instagram ユーザーID: ' + (config.IG_USER_ID || '(未設定)'),
    'Facebook アプリID: ' + (config.FB_APP_ID || '(未設定)'),
    'Facebook アプリシークレット: ' + mask(config.FB_APP_SECRET),
    'Drive フォルダID: ' + (config.DRIVE_FOLDER_ID || '(未設定)'),
    'Gemini APIキー: ' + mask(config.GEMINI_API_KEY),
    'Discord Webhook URL: ' + mask(config.WEBHOOK_URL),
    'トークン有効期限: ' + (config.TOKEN_EXPIRY || '(未設定)')
  ];
  SpreadsheetApp.getUi().alert('現在の設定:\n\n' + lines.join('\n'));
}

/**
 * Drive画像保存フォルダを準備
 * - DRIVE_FOLDER_ID 未設定なら新規作成
 * - feed/reels/stories サブフォルダを必ず作る（drive.js 側で都度確認）
 */
function ensureDriveFolder() {
  let folderId = getConfig('DRIVE_FOLDER_ID');
  if (folderId) {
    try {
      const folder = DriveApp.getFolderById(folderId);
      SpreadsheetApp.getUi().alert(
        'Drive画像保存フォルダは既に設定済みです\n\n' +
        'フォルダ名: ' + folder.getName() + '\n' +
        'URL: ' + folder.getUrl()
      );
      return;
    } catch (e) {
      // フォルダIDが無効 → 新規作成へ
    }
  }
  const folder = DriveApp.createFolder('IGインサイト画像保存');
  setConfig('DRIVE_FOLDER_ID', folder.getId());
  SpreadsheetApp.getUi().alert(
    'Drive画像保存フォルダを作成しました\n\n' +
    'フォルダ名: ' + folder.getName() + '\n' +
    'URL: ' + folder.getUrl() + '\n\n' +
    '⚙️ 設定シートのフォルダID欄も更新されます。'
  );
  setupSettingsSheet();
}
