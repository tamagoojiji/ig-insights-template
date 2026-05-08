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
 * ドライブファイルからIMAGE関数用URLを生成
 */
function getImageUrl(file) {
  const fileId = file.getId();
  return `https://drive.google.com/thumbnail?id=${fileId}&sz=w400`;
}
