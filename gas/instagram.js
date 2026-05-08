/**
 * Instagram Graph API 共通処理
 */

const IG_API_BASE = 'https://graph.facebook.com/v22.0';

/**
 * Instagram API リクエスト
 */
function igFetch(endpoint, params) {
  const token = getConfig('IG_ACCESS_TOKEN');
  if (!token) throw new Error('アクセストークンが未設定です');

  const queryParams = { access_token: token, ...params };
  const qs = Object.entries(queryParams)
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join('&');

  const url = `${IG_API_BASE}${endpoint}?${qs}`;
  const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  const data = JSON.parse(res.getContentText());

  if (data.error) {
    throw new Error(`Instagram API Error: ${data.error.message} (code: ${data.error.code})`);
  }

  return data;
}

/**
 * 全メディアをページングで取得
 * @param {number} [maxItems=500] 取得上限。Infinity を渡すと全件取得
 */
function fetchAllMedia(maxItems) {
  const userId = getConfig('IG_USER_ID');
  if (!userId) throw new Error('ユーザーIDが未設定です');

  const limit = (typeof maxItems === 'number' && maxItems > 0) ? maxItems : 500;
  const fields = 'id,media_type,media_url,thumbnail_url,timestamp,caption,like_count,comments_count,permalink';
  let allMedia = [];
  let url = `${IG_API_BASE}/${userId}/media?fields=${fields}&limit=50&access_token=${getConfig('IG_ACCESS_TOKEN')}`;

  while (url && allMedia.length < limit) {
    const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    const data = JSON.parse(res.getContentText());

    if (data.error) {
      throw new Error(`Instagram API Error: ${data.error.message}`);
    }

    if (data.data) {
      allMedia = allMedia.concat(data.data);
    }

    url = data.paging && data.paging.next ? data.paging.next : null;
  }

  return allMedia;
}

/**
 * メディアのインサイトを取得
 */
function fetchMediaInsights(mediaId, mediaType) {
  let metrics;
  if (mediaType === 'REELS') {
    metrics = 'views,reach,saved,shares,total_interactions,ig_reels_avg_watch_time';
  } else {
    metrics = 'views,reach,saved,shares,total_interactions';
  }

  try {
    const data = igFetch(`/${mediaId}/insights`, { metric: metrics });
    const result = {};
    if (data.data) {
      data.data.forEach(item => {
        result[item.name] = item.values[0].value;
      });
    }
    return result;
  } catch (e) {
    Logger.log(`インサイト取得エラー (${mediaId}): ${e.message}`);
    return {};
  }
}

/**
 * ストーリーズを取得
 */
function fetchStories() {
  const userId = getConfig('IG_USER_ID');
  if (!userId) throw new Error('ユーザーIDが未設定です');

  const fields = 'id,media_type,media_url,timestamp';
  const data = igFetch(`/${userId}/stories`, { fields: fields });
  return data.data || [];
}

/**
 * ストーリーズのインサイトを取得
 */
function fetchStoryInsights(mediaId) {
  const metrics = 'views,reach,replies,shares,total_interactions,navigation,profile_visits,follows';
  try {
    const data = igFetch(`/${mediaId}/insights`, { metric: metrics });
    const result = {};
    if (data.data) {
      data.data.forEach(item => {
        result[item.name] = item.values[0].value;
      });
    }
    return result;
  } catch (e) {
    Logger.log(`ストーリーインサイト取得エラー (${mediaId}): ${e.message}`);
    return {};
  }
}
