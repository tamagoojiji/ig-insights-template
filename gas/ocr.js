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
  const apiKey = getConfig('GEMINI_API_KEY');
  if (!apiKey) throw new Error('GEMINI_API_KEY が未設定です（GASスクリプトプロパティを確認）');
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

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${OCR_MODEL}:generateContent?key=${apiKey}`;
  const payload = {
    contents: [{
      parts: [
        { text: OCR_PROMPT },
        { inline_data: { mime_type: mimeType, data: base64 } }
      ]
    }],
    generationConfig: { temperature: 0, maxOutputTokens: 1024 }
  };

  const res = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  const code = res.getResponseCode();
  let data;
  try { data = JSON.parse(res.getContentText()); } catch (_) { data = {}; }
  if (code !== 200 || data.error) {
    throw new Error(`Gemini API: ${data.error?.message || 'HTTP ' + code}`);
  }

  const parts = (data.candidates && data.candidates[0]?.content?.parts) || [];
  return parts.map(p => p.text || '').join('').trim();
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
  PropertiesService.getScriptProperties().setProperty('OCR_AUTO_BATCH_SIZE', '100');
  ui.alert('🤖 自動OCRを開始しました\n\n5分おきに100件ずつ処理します。\n完了するか「自動OCR停止」で止まります。');
  autoOcrTick_();
}

/**
 * 自動OCR停止
 */
function stopAutoOcr() {
  stopAutoOcrSilent_();
  SpreadsheetApp.getUi().alert('🛑 自動OCRを停止しました');
}

function stopAutoOcrSilent_() {
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === 'autoOcrTick_') ScriptApp.deleteTrigger(t);
  });
}

/**
 * トリガーから呼ばれる本体（UI出さない）
 * 未処理行が無くなったら自動でトリガー削除
 */
function autoOcrTick_() {
  try {
    getExecutionStart_();
    const batchSize = parseInt(PropertiesService.getScriptProperties().getProperty('OCR_AUTO_BATCH_SIZE') || '100', 10);
    const summary = runStoriesOcrSilent_(batchSize);
    Logger.log(`autoOcrTick_: ${JSON.stringify(summary)}`);
    if (summary.remaining === 0) {
      stopAutoOcrSilent_();
      Logger.log('全件OCR完了 → 自動停止');
    }
  } catch (e) {
    Logger.log(`autoOcrTick_ エラー: ${e.message}\n${e.stack}`);
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
