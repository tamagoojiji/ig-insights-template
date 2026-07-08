/**
 * Vertex proxy 経由で Gemini を呼ぶ（GAS用 / 要件③）。各GASプロジェクトにコピーして使う。
 * proxy(実行SA vertex-invoker)が Vertex を叩くので、GAS側は OAuth スコープ追加・再認可・
 * GCPプロジェクト紐付け・スクリプトプロパティ設定すら不要（＝完全自律で移植できる）。
 *
 * 認証: ScriptApp.getOAuthToken()（既存スコープで取得・新スコープ不要）を Bearer で送り、
 *       proxy が tokeninfo で検証する。匿名アクセスは弾かれる。課金上限は $10 ガードが担保。
 *
 * 使い方（既存の generativelanguage 形式 requestBody をそのまま渡せる）:
 *   var requestBody = {
 *     contents: [...],
 *     systemInstruction: { parts: [{ text: '...' }] },   // 任意
 *     generationConfig: { temperature: 0.8, maxOutputTokens: 512 }
 *   };
 *   var text = vertexGenerate_(requestBody, ['gemini-2.5-flash', 'gemini-2.0-flash']);
 */
var VERTEX_PROXY_URL = 'https://asia-northeast1-claude-code-project-499703.cloudfunctions.net/vertex-proxy';

function vertexGenerate_(requestBody, models) {
  var res = UrlFetchApp.fetch(VERTEX_PROXY_URL, {
    method: 'post',
    contentType: 'application/json',
    headers: { 'Authorization': 'Bearer ' + ScriptApp.getOAuthToken() },
    payload: JSON.stringify({ models: models || null, request: requestBody }),
    muteHttpExceptions: true
  });
  var code = res.getResponseCode();
  if (code !== 200) {
    throw new Error('vertex-proxy error ' + code + ': ' + res.getContentText().slice(0, 300));
  }
  return JSON.parse(res.getContentText()).text;
}
