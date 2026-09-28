// ==========
// 「名前つけ待ち」の動画に付ける名前をGeminiに推測させ、Discordへ通知する
//
// リネームはしない。サムネイル1枚からの推測は外すことがあり、名前が付いた状態で
// フォルダに残ると「処理済み」に見えて誤りに気づけなくなるため、案の提示だけに留める。
// 実際のリネームと親フォルダへの移動は人が週1回まとめて行う。
// ==========

// 1回の実行で名前案を出す本数。GeminiはストーリーズOCRと無料枠を共有するため少数に留める
const REEL_NAME_MAX_PER_RUN = 5;

const REEL_NAME_PROMPT =
  'これは折り紙や工作の作り方動画のサムネイルです。' +
  '何を作っているか（完成品）を、日本語の短い名詞だけで答えてください。' +
  '例: チューリップ / こいのぼり / 手裏剣 / サンタ。' +
  '折り紙以外（商品紹介、子どもの様子など）ならその内容を短く。' +
  '判断できない場合は「不明」とだけ答えてください。説明や記号は不要です。';

/**
 * 週1回、名前つけ待ちフォルダの中身に名前案を付けてDiscord通知する
 */
function suggestReelNames() {
  const folderId = getConfig('REEL_VIDEO_FOLDER_ID');
  if (!folderId) return;

  const subs = DriveApp.getFolderById(folderId).getFoldersByName(REEL_VIDEO_INBOX);
  if (!subs.hasNext()) return;
  const inbox = subs.next();

  // 対象を数え上げる（名前が入っていないものだけ）
  const targets = [];
  const files = inbox.getFiles();
  while (files.hasNext()) {
    const f = files.next();
    if (/^\d{8}_\d+\.mp4$/.test(f.getName())) targets.push(f);
  }
  if (!targets.length) return; // たまっていない週は通知しない

  // Geminiの無料枠を使い切らないよう1回あたりの推測は少数に絞る。
  // 残りは翌週に自然と持ち越される（処理するとフォルダから出ていくため）。
  const lines = [];
  let apiFailed = 0;
  for (let i = 0; i < targets.length && lines.length < REEL_NAME_MAX_PER_RUN; i++) {
    if (isTimeUp_() || apiFailed >= 2) break; // 枠切れが続くならその週は諦める
    const f = targets[i];
    try {
      const thumb = f.getThumbnail();
      if (!thumb) continue;
      lines.push(`・${f.getName()}\n　→「${guessNameFromImage_(thumb)}」かも`);
    } catch (e) {
      apiFailed++;
      Logger.log(`名前推測に失敗 (${f.getName()}): ${e.message}`);
    }
  }

  let msg = `🎬 名前つけ待ちに${targets.length}本たまっています\n`;
  if (lines.length) {
    msg += `\n${lines.join('\n')}\n\n合っていればこの名前でリネームして、親フォルダへ移してください。`;
    if (targets.length > lines.length) {
      msg += `\n（残り${targets.length - lines.length}本の名前案は来週お知らせします）`;
    }
  } else {
    msg += '\n※ 名前案は出せませんでした（Geminiの無料枠切れ等）。中身を見て付けてください。';
  }
  msg += `\n${inbox.getUrl()}`;
  Logger.log(msg);
  notifyDiscord(msg);
}

/**
 * 画像1枚から作っているものの名前をGeminiに推測させる。
 * OCRと同じ経路（自分のAPIキー→無ければ共有proxy）を使う。
 */
function guessNameFromImage_(blob) {
  const requestBody = {
    contents: [{
      parts: [
        { text: REEL_NAME_PROMPT },
        { inlineData: { mimeType: blob.getContentType() || 'image/jpeg', data: Utilities.base64Encode(blob.getBytes()) } }
      ]
    }],
    generationConfig: { temperature: 0, maxOutputTokens: 256 }
  };
  if (OCR_MODEL.indexOf('2.5') !== -1 && OCR_MODEL.indexOf('pro') === -1) {
    requestBody.generationConfig.thinkingConfig = { thinkingBudget: 0 };
  }

  const apiKey = getConfig('GEMINI_API_KEY');
  const text = apiKey
    ? geminiGenerateWithKey_(requestBody, OCR_MODEL, apiKey)
    : vertexGenerate_(requestBody, [OCR_MODEL]);
  return String(text || '').trim().replace(/[\r\n]+/g, ' ').slice(0, 30) || '不明';
}
