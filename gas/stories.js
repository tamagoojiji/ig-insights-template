/**
 * ストーリーズ取得・書き込み
 */

/**
 * ストーリーズを取得してシートに書き込み
 */
function fetchAndWriteStories() {
  getExecutionStart_();

  const stories = fetchStories();

  if (stories.length === 0) {
    Logger.log('ストーリーズ: 公開中のストーリーなし');
    return { stories: 0 };
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  ensureMetaHistoryColumns_(ss);
  const sheet = getOrCreateSheet('📖 ストーリーズ');
  const historySheet = getOrCreateSheet('📖 ストーリーズ履歴');

  if (sheet.getLastRow() === 0) setupStoriesHeader(sheet);
  if (historySheet.getLastRow() === 0) setupStoriesHistoryHeader(historySheet);

  // 既存シートでB列（メディアID）が非表示幅のまま残っていたら自動で広げる
  if (historySheet.getColumnWidth(2) < 50) {
    historySheet.setColumnWidth(1, 140);
    historySheet.setColumnWidth(2, 200);
  }

  // 既存ストーリーの id→行番号 マップ
  const existingMap = new Map();
  if (sheet.getLastRow() >= 2) {
    const ids = sheet.getRange(2, 10, sheet.getLastRow() - 1, 1).getValues();
    ids.forEach((row, i) => {
      if (row[0]) existingMap.set(String(row[0]), i + 2);
    });
  }

  const now = new Date();
  const nowStr = Utilities.formatDate(now, 'Asia/Tokyo', 'yyyy/MM/dd HH:mm');
  const historyRows = [];
  let newCount = 0;
  let updateCount = 0;
  let timedOut = false;

  const flushHistory_ = () => {
    if (historyRows.length === 0) return;
    const startRow = historySheet.getLastRow() + 1;
    historySheet.getRange(startRow, 1, historyRows.length, 13).setValues(historyRows);
    historyRows.length = 0;
  };

  for (const story of stories) {
    if (isTimeUp_()) {
      timedOut = true;
      break;
    }

    const insights = fetchStoryInsights(story.id);
    const reach = insights.reach || 0;
    const views = insights.views || 0;
    const replies = insights.replies || 0;
    const shares = insights.shares || 0;
    const navigation = insights.navigation || 0;
    const profileVisits = insights.profile_visits || 0;

    const postDate = new Date(story.timestamp);
    const elapsedMin = Math.round((now - postDate) / 60000);

    // 画像保存: 新規行、または画像保存に失敗して空のまま残っている既存行が対象。
    // ストーリーがアクティブ（投稿から約24時間以内）なうちは media_url が有効なので、
    // 一時的な保存失敗を次回以降の取得で自動リトライし「[画像なし]」を解消する。
    const existingRow = existingMap.get(String(story.id));
    let recoveredExisting = false;
    if (existingRow) {
      const thumbCell = sheet.getRange(existingRow, 2);
      recoveredExisting = !thumbCell.getFormula() && !thumbCell.getValue();
    }
    let driveUrl = '';
    if (!existingRow || recoveredExisting) {
      const imageUrl = (story.media_type === 'VIDEO' && story.thumbnail_url)
        ? story.thumbnail_url
        : story.media_url;
      if (imageUrl && !isTimeUp_()) {
        driveUrl = saveImageToDrive(imageUrl, story.id, story.timestamp, 'stories') || '';
      }
    }

    historyRows.push([
      formatTimestamp(story.timestamp),
      String(story.id),
      nowStr,
      elapsedMin,
      reach, views, replies, shares, navigation, profileVisits,
      story.caption || '',
      driveUrl,
      'autoFetch'
    ]);

    if (existingRow) {
      sheet.getRange(existingRow, 4, 1, 6).setValues([[reach, views, replies, shares, navigation, profileVisits]]);
      updateCount++;

      // 今回画像を拾い直せた既存行はサムネイルを補完。OCRはその場で叩かず後段の
      // runStoriesOcrSilent_（429即中断＋次サイクル再試行）に一任する（救済時の即時OCRは
      // 無料枠の瞬間超過=429を招くため）。[画像なし] を消して未OCRに戻せば後段バッチが拾う。
      if (recoveredExisting && driveUrl) {
        sheet.getRange(existingRow, 2).setFormula(`=IMAGE("${driveUrl}")`);
        setThumbnailRowHeight(sheet, existingRow, 1);
        // 画像が復活したので [画像なし] センチネルだけ未OCRに戻し、後段バッチに再OCRさせる。
        // 既にOCR本文/説明文が入っている行や [エラー]（後段が拾う）は触らない＝既存データ保護。
        const ocrCol = ensureStoriesOcrColumn_(sheet);
        const ocrCell = sheet.getRange(existingRow, ocrCol);
        if (String(ocrCell.getValue()) === '[画像なし]') ocrCell.setValue('');
      }
    } else {
      const newRow = [
        formatTimestamp(story.timestamp),
        driveUrl ? `=IMAGE("${driveUrl}")` : '',
        story.media_type || 'IMAGE',
        reach, views, replies, shares, navigation, profileVisits,
        story.id
      ];
      const startRow = sheet.getLastRow() + 1;
      sheet.getRange(startRow, 1, 1, 10).setValues([newRow]);
      setThumbnailRowHeight(sheet, startRow, 1);
      copyCustomFormulasToNewRow_(sheet, startRow);

      // OCRはその場で叩かず後段 runStoriesOcrSilent_（429即中断＋次サイクル再試行）に一任する。
      // 画像なし行だけここで確定（OCR対象外）。画像ありはOCR列を空のままにして後段バッチに拾わせる。
      const ocrCol = ensureStoriesOcrColumn_(sheet);
      if (!driveUrl) {
        sheet.getRange(startRow, ocrCol).setValue('[画像なし]');
      }
      newCount++;
    }

    // 時間切れ直前に履歴を取りこぼさないよう、ストーリーごとに部分flushしたい場合は
    // ここで historyRows を flushHistory_() しても良いが、現状はループ終了後に一括で書く。
  }

  flushHistory_();

  if (!timedOut && sheet.getLastRow() > 2) {
    sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).sort({ column: 1, ascending: false });
  }

  Logger.log(`ストーリーズ: 新規${newCount}件 / 更新${updateCount}件 / 履歴${newCount + updateCount}行追記${timedOut ? ' / 時間制限で一部スキップ' : ''}`);
  return { stories: newCount + updateCount, timedOut };
}

/**
 * ユーザー追加列（K列以降）の数式を既存行から新規行にコピー
 * 閲覧率・リピート率などの手動追加数式を新規行にも自動展開するため
 */
function copyCustomFormulasToNewRow_(sheet, newRowIndex) {
  const lastCol = sheet.getLastColumn();
  if (lastCol <= 10) return;
  if (newRowIndex <= 2) return;

  const templateRow = newRowIndex - 1;
  const formulas = sheet.getRange(templateRow, 11, 1, lastCol - 10).getFormulasR1C1();
  const hasFormula = formulas[0].some(f => f);
  if (!hasFormula) return;

  sheet.getRange(newRowIndex, 11, 1, lastCol - 10).setFormulasR1C1(formulas);
}

/**
 * ストーリーズシートを分析用に整形
 * - K列「日付」（A列と重複）を削除
 * - 1行目＋A列を固定、メディアID列を非表示
 * - リーチ・視聴数・プロフィールアクセスをカラースケール
 * - 数値列にカンマ区切り、投稿日時で降順ソート、行バンディング
 */
function beautifyStoriesSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('📖 ストーリーズ');
  if (!sheet) {
    SpreadsheetApp.getUi().alert('📖 ストーリーズシートが見つかりません');
    return;
  }

  if (sheet.getLastColumn() >= 11) {
    const k1 = sheet.getRange(1, 11).getValue();
    if (k1 === '日付') sheet.deleteColumn(11);
  }

  sheet.setFrozenRows(1);
  sheet.setFrozenColumns(1);

  const widths = [140, 120, 90, 80, 80, 70, 70, 90, 120, 1];
  widths.forEach((w, i) => sheet.setColumnWidth(i + 1, w));

  const maxRows = sheet.getMaxRows();
  [4, 5, 6, 7, 8, 9].forEach(col => {
    sheet.getRange(2, col, maxRows - 1, 1).setNumberFormat('#,##0');
  });

  const metricCols = [
    { col: 4, min: '#FFFFFF', max: '#FB8C00' },
    { col: 5, min: '#FFFFFF', max: '#43A047' },
    { col: 9, min: '#FFFFFF', max: '#1E88E5' }
  ];
  const newRules = metricCols.map(m =>
    SpreadsheetApp.newConditionalFormatRule()
      .setGradientMinpointWithValue(m.min, SpreadsheetApp.InterpolationType.MIN, '')
      .setGradientMaxpointWithValue(m.max, SpreadsheetApp.InterpolationType.MAX, '')
      .setRanges([sheet.getRange(2, m.col, maxRows - 1, 1)])
      .build()
  );
  sheet.setConditionalFormatRules(newRules);

  sheet.getBandings().forEach(b => b.remove());
  const lastCol = sheet.getLastColumn();
  sheet.getRange(1, 1, maxRows, lastCol).applyRowBanding(
    SpreadsheetApp.BandingTheme.ORANGE, true, false
  );

  const lastRow = sheet.getLastRow();
  if (lastRow > 2) {
    sheet.getRange(2, 1, lastRow - 1, lastCol).sort({ column: 1, ascending: false });
  }

  SpreadsheetApp.getUi().alert('📖 ストーリーズシートを整形しました！\n\n・K列「日付」削除\n・1行目/A列を固定\n・リーチ/視聴数/プロフィールアクセスを色分け\n・数値にカンマ区切り\n・投稿日時で新しい順ソート');
}
