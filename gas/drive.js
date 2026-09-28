/**
 * Googleドライブ画像保存
 */

/**
 * ドライブフォルダを取得（なければ作成）
 */
function getOrCreateDriveFolder(parentId, folderName) {
  const parent = DriveApp.getFolderById(parentId);
  const folders = parent.getFoldersByName(folderName);

  if (folders.hasNext()) {
    return folders.next();
  }
  return parent.createFolder(folderName);
}

/**
 * 画像をドライブに保存し、共有URLを返す
 */
function saveImageToDrive(imageUrl, mediaId, timestamp, subFolder) {
  const folderId = getConfig('DRIVE_FOLDER_ID');
  if (!folderId) {
    Logger.log('DRIVE_FOLDER_ID が未設定です。画像保存をスキップします。');
    return null;
  }

  try {
    const folder = getOrCreateDriveFolder(folderId, subFolder);

    // 日付をファイル名に使用
    const date = timestamp ? Utilities.formatDate(new Date(timestamp), 'Asia/Tokyo', 'yyyyMMdd') : 'nodate';
    const fileName = `${date}_${mediaId}.jpg`;

    // 既存ファイルチェック
    const existing = folder.getFilesByName(fileName);
    if (existing.hasNext()) {
      const file = existing.next();
      return getImageUrl(file);
    }

    // 画像を取得して保存
    const blob = UrlFetchApp.fetch(imageUrl).getBlob().setName(fileName);
    const file = folder.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

    return getImageUrl(file);
  } catch (e) {
    Logger.log(`画像保存エラー (${mediaId}): ${e.message}`);
    return null;
  }
}

/**
 * リール動画(mp4)をドライブに保存し、ファイルURLを返す
 * 保存先は REEL_VIDEO_FOLDER_ID の下の「名前つけ待ち」フォルダ。週1回まとめて中身に応じた
 * 名前を付けて親フォルダへ移す運用のため、自動保存分だけをここに隔離する。
 * 共有設定は触らない（親フォルダの権限を継承させる）。
 */
function saveVideoToDrive(videoUrl, mediaId, timestamp) {
  const folderId = getConfig('REEL_VIDEO_FOLDER_ID');
  if (!folderId) {
    Logger.log('REEL_VIDEO_FOLDER_ID が未設定です。動画保存をスキップします。');
    return null;
  }

  try {
    const folder = getOrCreateDriveFolder(folderId, REEL_VIDEO_INBOX);

    const date = timestamp ? Utilities.formatDate(new Date(timestamp), 'Asia/Tokyo', 'yyyyMMdd') : 'nodate';
    const fileName = `${date}_${mediaId}.mp4`;

    // 既存ファイルチェック（再ダウンロードしない）
    const existing = folder.getFilesByName(fileName);
    if (existing.hasNext()) {
      return existing.next().getUrl();
    }

    const res = UrlFetchApp.fetch(videoUrl, { muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) {
      Logger.log(`動画取得失敗 (${mediaId}): HTTP ${res.getResponseCode()}`);
      return null;
    }

    const blob = res.getBlob().setName(fileName);
    return folder.createFile(blob).getUrl();
  } catch (e) {
    // 50MB超（UrlFetchApp上限）・ドライブ容量超過・権限エラーはここに落ちる
    Logger.log(`動画保存エラー (${mediaId}): ${e.message}`);
    return null;
  }
}

/**
 * ドライブファイルからIMAGE関数用URLを生成
 */
function getImageUrl(file) {
  const fileId = file.getId();
  return `https://drive.google.com/thumbnail?id=${fileId}&sz=w400`;
}
