/**
 * Gemini Vision を使った画像OCR
 */

const OCR_MODEL = 'gemini-2.5-flash';
const OCR_PROMPT = '画像内に書かれているテキストを忠実に文字起こししてください。装飾文字や手書きも含めて全部。テキスト以外の説明・注釈・前置きは一切不要で、文字起こし結果のみを返答してください。改行は元の見た目どおりに保ってください。テキストが何も無い場合は空文字を返してください。';

/**
 * 画像URLからGemini Visionに渡してテキストを抽出
 * - Drive URL（?id=...）: DriveApp で取得
 * - 外部URL（https://...）: UrlFetchApp で直接取得
 */
function ocrImage_(imageUrl) {
  if (!imageUrl) throw new Error('画像URLが空です');

  let blob;
  const driveIdMatch = String(imageUrl).match(/drive\.google\.com.*[?&]id=([a-zA-Z0-9_-]+)/);
  if (driveIdMatch) {
    blob = DriveApp.getFileById(driveIdMatch[1]).getBlob();
  } else {
    const res = UrlFetchApp.fetch(imageUrl, { muteHttpExceptions: true });
    const code = res.getResponseCode();
    if (code !== 200) throw new Error(`画像取得失敗: HTTP ${code}`);
    blob = res.getBlob();
  }
  const mimeType = blob.getContentType() || 'image/jpeg';
  const base64 = Utilities.base64Encode(blob.getBytes());

  const requestBody = {
    contents: [{
      parts: [
        { text: OCR_PROMPT },
        { inlineData: { mimeType: mimeType, data: base64 } }
      ]
    }],
    generationConfig: { temperature: 0, maxOutputTokens: 1024 }
  };

  // 2.5 flash/lite は thinking 無効化（出力トークンを本文に使う）
  if (OCR_MODEL.indexOf('2.5') !== -1 && OCR_MODEL.indexOf('pro') === -1) {
    requestBody.generationConfig.thinkingConfig = { thinkingBudget: 0 };
  }

  // BYO: 利用者自身の Gemini APIキーがあれば自分の無料枠で直接叩く。
  // 無ければ共有 Vertex proxy にフォールバック。どちらも OCR_MODEL 単一で統一。
  const apiKey = getConfig('GEMINI_API_KEY');
  if (apiKey) {
    return geminiGenerateWithKey_(requestBody, OCR_MODEL, apiKey).trim();
  }
  return vertexGenerate_(requestBody, [OCR_MODEL]).trim();
}

/**
 * BYO: 利用者の Gemini APIキーで generativelanguage を直接呼ぶ。
 * APIキーは URL クエリではなくヘッダ(x-goog-api-key)で送る（アクセスログ露出回避）。
 */
function geminiGenerateWithKey_(requestBody, model, apiKey) {
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/' +
    model + ':generateContent';
  const res = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-goog-api-key': apiKey },
    payload: JSON.stringify(requestBody),
    muteHttpExceptions: true
  });
  const code = res.getResponseCode();
  const body = res.getContentText();
  if (code !== 200) {
    throw new Error('Gemini API error HTTP ' + code + ': ' + body.slice(0, 300));
  }
  const cand = (JSON.parse(body).candidates || [])[0];
  const parts = cand && cand.content && cand.content.parts;
  const finish = cand && cand.finishReason;
  const hasText = Array.isArray(parts) && parts.some((p) => typeof p.text === 'string');
  // 候補なし / textを持つpart無し（空配列含む） / SAFETY・MAX_TOKENS等の異常終了
  //  → 空文字で「処理済み」化せず例外にして再試行させる
  if (!cand || !hasText || (finish && finish !== 'STOP')) {
    throw new Error('Gemini OCR: 応答が正常終了しませんでした (' + (finish || 'no candidates') + ')');
  }
  // finishReason=STOP で text が空文字 = 文字なし画像。正常な空文字として許容
  return parts.map((p) => p.text || '').join('');
}

/**
 * =IMAGE("URL") 形式またはURL直接からURLを抽出
 */
function extractImageUrl_(formulaOrUrl) {
  if (!formulaOrUrl) return '';
  const s = String(formulaOrUrl);
  const m = s.match(/=IMAGE\(\s*["']([^"']+)["']/i);
  if (m) return m[1];
  if (/^https?:\/\//.test(s)) return s;
  return '';
}

/**
 * ストーリーズシートに「画像内テキスト」列を確保（無ければ末尾に追加）
 */
function ensureStoriesOcrColumn_(sheet) {
  const existing = findColumn_(sheet, '画像内テキスト');
  if (existing > 0) return existing;
  const newCol = sheet.getLastColumn() + 1;
  sheet.getRange(1, newCol).setValue('画像内テキスト')
    .setFontWeight('bold').setBackground('#34A853').setFontColor('#FFFFFF');
  sheet.setColumnWidth(newCol, 300);
  sheet.getRange(2, newCol, sheet.getMaxRows() - 1, 1).setWrap(true).setVerticalAlignment('top');
  return newCol;
}

/**
 * 【診断】ストーリーズシートのサムネイル列を最初の5行だけ確認
 */
function debugStoriesThumbnails() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('📖 ストーリーズ');
  if (!sheet) { SpreadsheetApp.getUi().alert('シートなし'); return; }
  const lastRow = sheet.getLastRow();
  const thumbCol = findColumn_(sheet, 'サムネイル');
  const idCol = findColumn_(sheet, 'メディアID');
  const sampleRows = Math.min(5, lastRow - 1);
  const formulas = sheet.getRange(2, thumbCol, sampleRows, 1).getFormulas();
  const values = sheet.getRange(2, thumbCol, sampleRows, 1).getValues();
  const ids = sheet.getRange(2, idCol, sampleRows, 1).getValues();
  let msg = `📖 ストーリーズ診断\n\nlastRow: ${lastRow}\nサムネイル列: ${thumbCol}\nメディアID列: ${idCol}\n\n`;
  for (let i = 0; i < sampleRows; i++) {
    msg += `\n[row ${i + 2}]\n  ID: ${ids[i][0] || '(空)'}\n  formula: ${formulas[i][0] || '(空)'}\n  value: ${String(values[i][0]).substring(0, 80) || '(空)'}\n`;
  }
  SpreadsheetApp.getUi().alert(msg);
}

/**
 * バッチサイズ指定でOCR実行（メニューから件数入力）
 */
function runStoriesOcrBatch() {
  const ui = SpreadsheetApp.getUi();
  const res = ui.prompt('ストーリーズOCR（バッチ実行）', '今回処理する最大件数を入力してください（例: 50）', ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() !== ui.Button.OK) return;
  const n = parseInt(res.getResponseText(), 10);
  if (!n || n < 1) { ui.alert('正の整数を入力してください'); return; }
  runStoriesOcr_(n);
}

/**
 * 既存ストーリーズの未OCR行を一括処理（5分制限まで）
 */
function runStoriesOcrAll() {
  runStoriesOcr_(Infinity);
}

/**
 * 自動OCR開始（5分おきに100件ずつ処理、完走したら自動停止）
 */
function startAutoOcr() {
  const ui = SpreadsheetApp.getUi();
  stopAutoOcrSilent_();
  ScriptApp.newTrigger('autoOcrTick_').timeBased().everyMinutes(5).create();
  const props = PropertiesService.getScriptProperties();
  props.setProperty('OCR_AUTO_BATCH_SIZE', '100');
  props.setProperty('OCR_AUTO_STARTED_AT', new Date().toISOString());
  props.setProperty('OCR_AUTO_TOTAL_PROCESSED', '0');
  props.setProperty('OCR_AUTO_TOTAL_FAILED', '0');
  props.deleteProperty('OCR_AUTO_LAST_TICK');
  props.deleteProperty('OCR_AUTO_LAST_REMAINING');
  props.deleteProperty('OCR_AUTO_STOPPED_AT');
  ui.alert('🤖 自動OCRを開始しました\n\n5分おきに100件ずつ処理します。\n完了するか「自動OCR停止」で止まります。\n\n📈 進捗はメニュー「📈 自動OCR進捗」で確認できます。');
  autoOcrTick_();
}

/**
 * 自動OCR停止
 */
function stopAutoOcr() {
  stopAutoOcrSilent_();
  PropertiesService.getScriptProperties().setProperty('OCR_AUTO_STOPPED_AT', new Date().toISOString());
  SpreadsheetApp.getUi().alert('🛑 自動OCRを停止しました');
}

function stopAutoOcrSilent_() {
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === 'autoOcrTick_') ScriptApp.deleteTrigger(t);
  });
}

/**
 * 自動OCRの進捗をアラート表示
 */
function showOcrProgress() {
  const ui = SpreadsheetApp.getUi();
  const props = PropertiesService.getScriptProperties();
  const triggerActive = ScriptApp.getProjectTriggers().some(t => t.getHandlerFunction() === 'autoOcrTick_');

  const startedAt = props.getProperty('OCR_AUTO_STARTED_AT');
  const stoppedAt = props.getProperty('OCR_AUTO_STOPPED_AT');
  const lastTick = props.getProperty('OCR_AUTO_LAST_TICK');
  const totalProcessed = parseInt(props.getProperty('OCR_AUTO_TOTAL_PROCESSED') || '0', 10);
  const totalFailed = parseInt(props.getProperty('OCR_AUTO_TOTAL_FAILED') || '0', 10);
  const lastRemaining = props.getProperty('OCR_AUTO_LAST_REMAINING');

  // 現時点での未処理行を即時カウント（処理本体に近い計算でズレを最小化）
  let liveRemaining = '(計算不可)';
  try {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('📖 ストーリーズ');
    if (sheet && sheet.getLastRow() >= 2) {
      const idCol = findColumn_(sheet, 'メディアID');
      const ocrCol = findColumn_(sheet, '画像内テキスト');
      if (idCol > 0 && ocrCol > 0) {
        const ids = sheet.getRange(2, idCol, sheet.getLastRow() - 1, 1).getValues();
        const ocrs = sheet.getRange(2, ocrCol, sheet.getLastRow() - 1, 1).getValues();
        let pending = 0;
        for (let i = 0; i < ids.length; i++) {
          if (!ids[i][0]) continue;
          if (!isOcrDone_(ocrs[i][0])) pending++;
        }
        liveRemaining = String(pending);
      }
    }
  } catch (e) {
    liveRemaining = '(エラー: ' + e.message + ')';
  }

  const fmt = (iso) => {
    if (!iso) return '(なし)';
    try { return Utilities.formatDate(new Date(iso), 'Asia/Tokyo', 'yyyy/MM/dd HH:mm:ss'); }
    catch (_) { return iso; }
  };

  const lines = [
    '📈 自動OCR進捗',
    '',
    'トリガー稼働中: ' + (triggerActive ? '✅ ON（5分おき）' : '⏹ OFF'),
    '',
    '開始時刻: ' + fmt(startedAt),
    '最終Tick: ' + fmt(lastTick),
    '停止時刻: ' + fmt(stoppedAt),
    '',
    '累計 処理成功: ' + totalProcessed + '件',
    '累計 失敗: ' + totalFailed + '件',
    '前回Tick残: ' + (lastRemaining == null ? '(未実行)' : lastRemaining + '件'),
    '現在の未処理: ' + liveRemaining + '件',
    '',
    triggerActive
      ? '次のTickまで最大5分。完了すると自動停止します。'
      : (liveRemaining !== '0' && liveRemaining !== '(計算不可)' && liveRemaining !== '(エラー: ' ? '⚠️ トリガーOFFですが未処理が残っています。再開するには「🤖 自動OCR開始」を押してください。' : '')
  ];
  ui.alert(lines.join('\n'));
}

/**
 * トリガーから呼ばれる本体（UI出さない）
 * 未処理行が無くなったら自動でトリガー削除
 */
function autoOcrTick_() {
  const props = PropertiesService.getScriptProperties();
  try {
    getExecutionStart_();
    const batchSize = parseInt(props.getProperty('OCR_AUTO_BATCH_SIZE') || '100', 10);
    const summary = runStoriesOcrSilent_(batchSize);
    Logger.log(`autoOcrTick_: ${JSON.stringify(summary)}`);

    const totalProcessed = parseInt(props.getProperty('OCR_AUTO_TOTAL_PROCESSED') || '0', 10) + summary.processed;
    const totalFailed = parseInt(props.getProperty('OCR_AUTO_TOTAL_FAILED') || '0', 10) + summary.failed;
    props.setProperty('OCR_AUTO_LAST_TICK', new Date().toISOString());
    props.setProperty('OCR_AUTO_TOTAL_PROCESSED', String(totalProcessed));
    props.setProperty('OCR_AUTO_TOTAL_FAILED', String(totalFailed));
    props.setProperty('OCR_AUTO_LAST_REMAINING', String(summary.remaining));

    if (summary.remaining === 0) {
      stopAutoOcrSilent_();
      props.setProperty('OCR_AUTO_STOPPED_AT', new Date().toISOString());
      Logger.log('全件OCR完了 → 自動停止');
      try {
        notifyDiscord(
          `🤖 自動OCR完了\n累計 処理: ${totalProcessed}件 / 失敗: ${totalFailed}件`,
          { kind: 'ocr_auto_done', bypassCooldown: true }
        );
      } catch (_) {}
    }
  } catch (e) {
    Logger.log(`autoOcrTick_ エラー: ${e.message}\n${e.stack}`);
    props.setProperty('OCR_AUTO_LAST_TICK', new Date().toISOString());
    props.setProperty('OCR_AUTO_LAST_ERROR', e.message);
  }
}

const OCR_EMPTY_SENTINEL = '[OCR_EMPTY]';

function isOcrDone_(cellValue) {
  if (!cellValue) return false;
  const s = String(cellValue);
  if (s.startsWith('[エラー]')) return false;
  return true; // テキスト / [OCR_EMPTY] / [画像なし] は完了扱い
}

/**
 * UI無しでOCR実行 (トリガー用)
 * remaining = 「次回再試行が必要な件数」（時間切れ未着手 + 今回エラー + maxItems到達でスキップ）
 */
function runStoriesOcrSilent_(maxItems) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('📖 ストーリーズ');
  if (!sheet) return { processed: 0, failed: 0, remaining: 0 };
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return { processed: 0, failed: 0, remaining: 0 };
  const thumbCol = findColumn_(sheet, 'サムネイル');
  const idCol = findColumn_(sheet, 'メディアID');
  if (thumbCol < 1 || idCol < 1) return { processed: 0, failed: 0, remaining: 0 };
  const ocrCol = ensureStoriesOcrColumn_(sheet);

  const ids = sheet.getRange(2, idCol, lastRow - 1, 1).getValues();
  const formulas = sheet.getRange(2, thumbCol, lastRow - 1, 1).getFormulas();
  const values = sheet.getRange(2, thumbCol, lastRow - 1, 1).getValues();
  const existing = sheet.getRange(2, ocrCol, lastRow - 1, 1).getValues();

  let processed = 0, failed = 0, remaining = 0;
  for (let i = 0; i < ids.length; i++) {
    if (!ids[i][0]) continue;
    if (isOcrDone_(existing[i][0])) continue;
    const raw = formulas[i][0] || values[i][0];
    if (!raw) {
      sheet.getRange(i + 2, ocrCol).setValue('[画像なし]'); // 永続的に完了扱い
      continue;
    }
    const imageUrl = extractImageUrl_(raw);
    if (!imageUrl) { failed++; remaining++; continue; }

    if (isTimeUp_() || processed >= maxItems) { remaining++; continue; }
    try {
      const text = ocrImage_(imageUrl);
      sheet.getRange(i + 2, ocrCol).setValue(text || OCR_EMPTY_SENTINEL);
      processed++;
    } catch (e) {
      sheet.getRange(i + 2, ocrCol).setValue(`[エラー] ${e.message}`);
      failed++;
      remaining++;
    }
  }
  return { processed, failed, remaining };
}

function runStoriesOcr_(maxItems) {
  const ui = SpreadsheetApp.getUi();
  try {
    getExecutionStart_();
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName('📖 ストーリーズ');
    if (!sheet) {
      ui.alert('📖 ストーリーズシートが見つかりません');
      return;
    }
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) {
      ui.alert('対象のストーリーがありません');
      return;
    }
    const thumbCol = findColumn_(sheet, 'サムネイル');
    const idCol = findColumn_(sheet, 'メディアID');
    if (thumbCol < 1 || idCol < 1) {
      ui.alert('サムネイル/メディアID列が見つかりません');
      return;
    }
    const ocrCol = ensureStoriesOcrColumn_(sheet);

    const ids = sheet.getRange(2, idCol, lastRow - 1, 1).getValues();
    const formulas = sheet.getRange(2, thumbCol, lastRow - 1, 1).getFormulas();
    const values = sheet.getRange(2, thumbCol, lastRow - 1, 1).getValues();
    const existing = sheet.getRange(2, ocrCol, lastRow - 1, 1).getValues();

    let processed = 0, skipped = 0, failed = 0, noImage = 0;
    let firstError = '';
    for (let i = 0; i < ids.length; i++) {
      if (isTimeUp_()) break;
      if (processed >= maxItems) break;
      if (!ids[i][0]) continue; // 空行スキップ
      if (isOcrDone_(existing[i][0])) { skipped++; continue; }
      const raw = formulas[i][0] || values[i][0];
      if (!raw) { noImage++; continue; }
      const imageUrl = extractImageUrl_(raw);
      if (!imageUrl) { failed++; continue; }
      try {
        const text = ocrImage_(imageUrl);
        sheet.getRange(i + 2, ocrCol).setValue(text || OCR_EMPTY_SENTINEL);
        processed++;
      } catch (e) {
        Logger.log(`OCRエラー row=${i + 2}: ${e.message}`);
        sheet.getRange(i + 2, ocrCol).setValue(`[エラー] ${e.message}`);
        if (!firstError) firstError = e.message;
        failed++;
      }
    }
    const timeUp = isTimeUp_();
    const reachedBatchLimit = processed >= maxItems && maxItems !== Infinity;
    ui.alert(
      `🔍 ストーリーズOCR${timeUp ? '（時間切れ）' : reachedBatchLimit ? '（バッチ完了）' : '完了'}\n\n` +
      `✅ 新規処理: ${processed}件\n` +
      `⏭ スキップ: ${skipped}件（処理済）\n` +
      `🖼 画像なし: ${noImage}件\n` +
      `❌ 失敗: ${failed}件` +
      (firstError ? `\n   最初のエラー例: ${firstError.substring(0, 200)}` : '') +
      (timeUp || reachedBatchLimit ? '\n\n⚠️ 続きはもう一度実行してください。' : '')
    );
  } catch (e) {
    ui.alert(`エラー: ${e.message}`);
    Logger.log(`runStoriesOcrAll: ${e.message}\n${e.stack}`);
  }
}
