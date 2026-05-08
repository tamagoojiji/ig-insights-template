/**
 * ダッシュボード集計・グラフ生成
 */

/**
 * ダッシュボードを更新
 */
function updateDashboard() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = getOrCreateSheet('📊 ダッシュボード');
  sheet.clear();

  // タイトル
  sheet.getRange('A1').setValue('📊 Instagram Insights ダッシュボード').setFontSize(16).setFontWeight('bold');
  sheet.getRange('A2').setValue(`最終更新: ${Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy/MM/dd HH:mm')}`).setFontColor('#666666');

  // サマリー
  writeSummary(sheet);

  // トップ投稿
  writeTopPosts(sheet);

  // 週別推移データ
  writeWeeklyTrend(sheet);

  // ストーリーズサマリー（今日/今週/今月・TOP3）
  writeStorySummary(sheet);

  // 時間帯別初速比較（投稿1h後の視聴数を時間帯ごとに平均）
  writeStoryHourlyChart(sheet);

  // 曜日×時間帯ヒートマップ（最終視聴数の平均）
  writeStoryHeatmap(sheet);

  // ストーリーズ初速（直近5件の視聴数推移）
  writeStoryVelocityChart(sheet);

  // 分析シート更新（ストーリーズ）
  updateTopStoriesSheet();
  updateFastGrowthSheet();

  // 分析シート更新（フィード）
  updateTopFeedSheet();
  updateFeedFastGrowthSheet();

  // 分析シート更新（リール）
  updateTopReelSheet();
  updateReelFastGrowthSheet();

  // メディア別ダッシュボード
  updateFeedDashboard();
  updateReelDashboard();
}

/**
 * 🗓 曜日×時間帯ヒートマップ（過去30日の最終視聴数平均）
 * 条件付き書式でカラースケール表示。どの曜日・時間帯に投稿すると伸びるかが一目で分かる
 */
function writeStoryHeatmap(sheet) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const storySheet = ss.getSheetByName('📖 ストーリーズ');
  const startRow = 78;

  sheet.getRange(startRow, 1).setValue('🗓 曜日×時間帯ヒートマップ（過去30日の平均最終視聴数）').setFontSize(13).setFontWeight('bold');

  if (!storySheet || storySheet.getLastRow() < 2) {
    sheet.getRange(startRow + 1, 1).setValue('（データなし）').setFontColor('#999999');
    return;
  }

  const data = storySheet.getRange(2, 1, storySheet.getLastRow() - 1, 10).getValues();
  const now = new Date();
  const cutoff = new Date(now.getTime() - 30 * 86400000);

  // [曜日][時間帯] -> [視聴数, ...]
  const matrix = Array.from({ length: 24 }, () => Array.from({ length: 7 }, () => []));
  data.forEach(row => {
    const postedAt = new Date(row[0]);
    const views = Number(row[4]) || 0;
    if (isNaN(postedAt.getTime()) || postedAt < cutoff) return;
    const hour = postedAt.getHours();
    const dow = (postedAt.getDay() + 6) % 7; // 月=0, 日=6
    matrix[hour][dow].push(views);
  });

  const dowLabels = ['月', '火', '水', '木', '金', '土', '日'];
  sheet.getRange(startRow + 1, 1, 1, 8).setValues([['時間帯', ...dowLabels]])
    .setFontWeight('bold').setBackground('#FFE0B2');

  const rows = [];
  for (let h = 0; h < 24; h++) {
    const row = [`${h}時`];
    for (let d = 0; d < 7; d++) {
      const list = matrix[h][d];
      row.push(list.length > 0 ? Math.round(list.reduce((a, b) => a + b, 0) / list.length) : '');
    }
    rows.push(row);
  }
  sheet.getRange(startRow + 2, 1, 24, 8).setValues(rows);
  sheet.getRange(startRow + 2, 2, 24, 7).setNumberFormat('#,##0');

  // 条件付き書式（カラースケール）
  const dataRange = sheet.getRange(startRow + 2, 2, 24, 7);
  const existingRules = sheet.getConditionalFormatRules();
  const keepRules = existingRules.filter(rule => {
    const ranges = rule.getRanges();
    return !ranges.some(r =>
      r.getRow() === dataRange.getRow() &&
      r.getColumn() === dataRange.getColumn() &&
      r.getNumRows() === dataRange.getNumRows() &&
      r.getNumColumns() === dataRange.getNumColumns()
    );
  });
  const heatmapRule = SpreadsheetApp.newConditionalFormatRule()
    .setGradientMinpointWithValue('#FFFFFF', SpreadsheetApp.InterpolationType.MIN, '')
    .setGradientMidpointWithValue('#FFE082', SpreadsheetApp.InterpolationType.PERCENTILE, '50')
    .setGradientMaxpointWithValue('#FB8C00', SpreadsheetApp.InterpolationType.MAX, '')
    .setRanges([dataRange])
    .build();
  sheet.setConditionalFormatRules([...keepRules, heatmapRule]);
}

/**
 * 📊 時間帯別初速比較（過去30日の投稿1h後視聴数を時間帯ごとに平均）
 */
function writeStoryHourlyChart(sheet) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const historySheet = ss.getSheetByName('📖 ストーリーズ履歴');
  const chartAnchorRow = 58;

  sheet.getRange(chartAnchorRow, 1).setValue('📊 時間帯別初速（過去30日の投稿1h後視聴数平均）').setFontSize(13).setFontWeight('bold');

  if (!historySheet || historySheet.getLastRow() < 2) {
    sheet.getRange(chartAnchorRow + 1, 1).setValue('（履歴データ蓄積待ち）').setFontColor('#999999');
    return;
  }

  const data = historySheet.getRange(2, 1, historySheet.getLastRow() - 1, 10).getValues();
  const now = new Date();
  const cutoff = new Date(now.getTime() - 30 * 86400000);

  // id→{postedAt, points}
  const byStory = {};
  data.forEach(row => {
    const postedAt = new Date(row[0]);
    const id = String(row[1]);
    const elapsedMin = Number(row[3]);
    const views = Number(row[5]) || 0;
    if (isNaN(postedAt.getTime())) return;
    if (postedAt < cutoff) return;
    if (!byStory[id]) byStory[id] = { postedAt, points: [] };
    byStory[id].points.push({ elapsedMin, views });
  });

  // 各投稿の1h時点視聴数（45-75分帯で60分に最も近い点）
  const view1hByHour = {}; // 時間帯 -> [視聴数, ...]
  Object.values(byStory).forEach(s => {
    const candidates = s.points.filter(p => p.elapsedMin >= 45 && p.elapsedMin <= 75);
    if (candidates.length === 0) return;
    const closest = candidates.reduce((best, p) =>
      Math.abs(p.elapsedMin - 60) < Math.abs(best.elapsedMin - 60) ? p : best
    );
    const hour = s.postedAt.getHours();
    if (!view1hByHour[hour]) view1hByHour[hour] = [];
    view1hByHour[hour].push(closest.views);
  });

  const activeHours = Object.keys(view1hByHour).length;
  if (activeHours === 0) {
    sheet.getRange(chartAnchorRow + 1, 1).setValue('（1h時点データ蓄積待ち）').setFontColor('#999999');
    return;
  }

  // 0-23時の全時間帯でテーブル化（データなしはスキップ）
  const headers = ['投稿時間帯', '平均1h視聴', '投稿数'];
  sheet.getRange(chartAnchorRow + 1, 1, 1, 3).setValues([headers]).setFontWeight('bold').setBackground('#FFE0B2');

  const rows = [];
  for (let h = 0; h < 24; h++) {
    const list = view1hByHour[h];
    if (!list || list.length === 0) continue;
    const avg = list.reduce((a, b) => a + b, 0) / list.length;
    rows.push([`${h}時台`, Math.round(avg), list.length]);
  }

  if (rows.length === 0) {
    sheet.getRange(chartAnchorRow + 2, 1).setValue('（データなし）').setFontColor('#999999');
    return;
  }

  sheet.getRange(chartAnchorRow + 2, 1, rows.length, 3).setValues(rows);
  sheet.getRange(chartAnchorRow + 2, 2, rows.length, 2).setNumberFormat('#,##0');

  const chartBuilder = sheet.newChart()
    .setChartType(Charts.ChartType.COLUMN)
    .addRange(sheet.getRange(chartAnchorRow + 1, 1, rows.length + 1, 2))
    .setPosition(chartAnchorRow, 8, 0, 0)
    .setOption('title', '📊 時間帯別 平均1h視聴数')
    .setOption('width', 700)
    .setOption('height', 350)
    .setOption('legend', { position: 'none' })
    .setOption('hAxis', { title: '投稿時間帯' })
    .setOption('vAxis', { title: '平均1h視聴数', viewWindow: { min: 0 } })
    .setOption('colors', ['#FB8C00']);

  sheet.insertChart(chartBuilder.build());
}

/**
 * 📖 ストーリーズサマリー（今日/今週/今月の実績 + 月間TOP3）
 */
function writeStorySummary(sheet) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const startRow = 42;

  sheet.getRange(startRow, 1).setValue('📖 ストーリーズサマリー').setFontSize(13).setFontWeight('bold');

  const storySheet = ss.getSheetByName('📖 ストーリーズ');
  if (!storySheet || storySheet.getLastRow() < 2) {
    sheet.getRange(startRow + 1, 1).setValue('（データなし）').setFontColor('#999999');
    return;
  }

  const lastRow = storySheet.getLastRow();
  const values = storySheet.getRange(2, 1, lastRow - 1, 10).getValues();
  const thumbnailFormulas = storySheet.getRange(2, 2, lastRow - 1, 1).getFormulas();

  const stories = values
    .map((row, idx) => ({
      postedAt: new Date(row[0]),
      thumbnailValue: row[1],
      thumbnailFormula: thumbnailFormulas[idx][0] || '',
      views: Number(row[4]) || 0
    }))
    .filter(s => !isNaN(s.postedAt.getTime()));

  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterdayStart = new Date(todayStart.getTime() - 86400000);
  const weekStart = new Date(todayStart.getTime() - 7 * 86400000);
  const prevWeekStart = new Date(weekStart.getTime() - 7 * 86400000);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);

  const periodStats = (from, to) => {
    const posts = stories.filter(s => s.postedAt >= from && s.postedAt < to);
    const count = posts.length;
    const avgViews = count > 0 ? posts.reduce((a, s) => a + s.views, 0) / count : 0;
    return { count, avgViews };
  };

  const pctChange = (a, b) => {
    if (b === 0) return a === 0 ? '—' : '+∞%';
    const pct = ((a - b) / b) * 100;
    const sign = pct >= 0 ? '+' : '';
    return `${sign}${pct.toFixed(1)}%`;
  };

  const today = periodStats(todayStart, now);
  const yesterday = periodStats(yesterdayStart, todayStart);
  const thisWeek = periodStats(weekStart, now);
  const prevWeek = periodStats(prevWeekStart, weekStart);
  const thisMonth = periodStats(monthStart, now);
  const prevMonth = periodStats(prevMonthStart, monthStart);

  const headers = ['期間', '投稿数', '平均視聴', '前比'];
  sheet.getRange(startRow + 1, 1, 1, 4).setValues([headers]).setFontWeight('bold').setBackground('#FFF3E0');

  const rows = [
    ['今日', today.count, Math.round(today.avgViews), pctChange(today.avgViews, yesterday.avgViews)],
    ['今週', thisWeek.count, Math.round(thisWeek.avgViews), pctChange(thisWeek.avgViews, prevWeek.avgViews)],
    ['今月', thisMonth.count, Math.round(thisMonth.avgViews), pctChange(thisMonth.avgViews, prevMonth.avgViews)]
  ];
  sheet.getRange(startRow + 2, 1, 3, 4).setValues(rows);
  sheet.getRange(startRow + 2, 2, 3, 2).setNumberFormat('#,##0');

  // TOP3
  sheet.getRange(startRow + 6, 1).setValue('🏆 今月のTOP3（視聴数順）').setFontSize(12).setFontWeight('bold');
  const top3 = stories
    .filter(s => s.postedAt >= monthStart)
    .sort((a, b) => b.views - a.views)
    .slice(0, 3);

  const topHeaders = ['順位', '投稿日時', 'サムネ', '視聴数'];
  sheet.getRange(startRow + 7, 1, 1, 4).setValues([topHeaders]).setFontWeight('bold').setBackground('#FFE0B2');

  if (top3.length === 0) {
    sheet.getRange(startRow + 8, 1).setValue('（今月の投稿なし）').setFontColor('#999999');
    return;
  }

  const topRows = top3.map((s, i) => [
    i + 1,
    Utilities.formatDate(s.postedAt, 'Asia/Tokyo', 'MM/dd HH:mm'),
    '',
    s.views
  ]);
  sheet.getRange(startRow + 8, 1, topRows.length, 4).setValues(topRows);
  sheet.getRange(startRow + 8, 4, topRows.length, 1).setNumberFormat('#,##0');

  // サムネイルの =IMAGE 数式を転記
  top3.forEach((s, i) => {
    const row = startRow + 8 + i;
    if (s.thumbnailFormula) {
      sheet.getRange(row, 3).setFormula(s.thumbnailFormula);
    } else if (s.thumbnailValue) {
      sheet.getRange(row, 3).setValue(s.thumbnailValue);
    }
    sheet.setRowHeight(row, 100);
  });
}

const BASELINE_DAYS_ = 30;
const TOP_STORIES_SHEET_ = '🏆 伸びた投稿';
const FAST_GROWTH_SHEET_ = '⚡ 初速良好';
const TOP_FEED_SHEET_ = '🏆 フィード伸びた投稿';
const TOP_REEL_SHEET_ = '🏆 リール伸びた投稿';
const FEED_FAST_SHEET_ = '⚡ フィード初速良好';
const REEL_FAST_SHEET_ = '⚡ リール初速良好';

/**
 * 🏆 伸びた投稿シート更新
 * A基準: 過去30日の平均に対して4指標中2つ以上クリアした投稿
 * - 視聴数が平均の1.5倍以上
 * - リピート率 1.5以上
 * - シェア 1以上
 * - プロフィール遷移率 1.0%以上
 */
function updateTopStoriesSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const storySheet = ss.getSheetByName('📖 ストーリーズ');
  const sheet = getOrCreateSheet(TOP_STORIES_SHEET_);
  sheet.clear();
  setupTopStoriesHeader(sheet);

  if (!storySheet || storySheet.getLastRow() < 2) {
    sheet.getRange(2, 1).setValue('（ストーリーズデータなし）').setFontColor('#999999');
    return;
  }

  const lastRow = storySheet.getLastRow();
  const values = storySheet.getRange(2, 1, lastRow - 1, 10).getValues();
  const thumbnailFormulas = storySheet.getRange(2, 2, lastRow - 1, 1).getFormulas();
  const now = new Date();
  const cutoff = new Date(now.getTime() - BASELINE_DAYS_ * 86400000);

  const recent = values
    .map((row, idx) => ({
      postedAt: new Date(row[0]),
      thumbnailValue: row[1],
      thumbnailFormula: thumbnailFormulas[idx][0] || '',
      reach: Number(row[3]) || 0,
      views: Number(row[4]) || 0,
      replies: Number(row[5]) || 0,
      shares: Number(row[6]) || 0,
      navigation: Number(row[7]) || 0,
      profileVisits: Number(row[8]) || 0
    }))
    .filter(s => !isNaN(s.postedAt.getTime()) && s.postedAt >= cutoff);

  if (recent.length === 0) {
    sheet.getRange(2, 1).setValue('（過去30日のデータなし）').setFontColor('#999999');
    return;
  }

  const avgViews = recent.reduce((s, r) => s + r.views, 0) / recent.length;

  const evaluated = recent.map(s => {
    const repeatRate = s.reach > 0 ? s.views / s.reach : 0;
    const profileRate = s.reach > 0 ? (s.profileVisits / s.reach) * 100 : 0;
    const viewsRatio = avgViews > 0 ? s.views / avgViews : 0;
    const met = {
      views: viewsRatio >= 1.5,
      repeat: repeatRate >= 1.5,
      shares: s.shares >= 1,
      profile: profileRate >= 1.0
    };
    const metCount = Object.values(met).filter(Boolean).length;
    return { ...s, viewsRatio, repeatRate, profileRate, met, metCount };
  })
    .filter(s => s.metCount >= 2)
    .sort((a, b) => b.views - a.views)
    .slice(0, 10);

  if (evaluated.length === 0) {
    sheet.getRange(2, 1).setValue('（基準クリアの投稿なし）').setFontColor('#999999');
    return;
  }

  const rows = evaluated.map(s => [
    Utilities.formatDate(s.postedAt, 'Asia/Tokyo', 'MM/dd HH:mm'),
    '',
    s.views,
    `${s.viewsRatio.toFixed(2)}×${s.met.views ? ' 🔥' : ''}`,
    `${s.repeatRate.toFixed(2)}${s.met.repeat ? ' 🔥' : ''}`,
    `${s.shares}${s.met.shares ? ' 🔥' : ''}`,
    `${s.profileRate.toFixed(1)}%${s.met.profile ? ' 🔥' : ''}`,
    `${s.metCount}/4`
  ]);
  sheet.getRange(2, 1, rows.length, 8).setValues(rows);

  // サムネイル列は元セルの数式（=IMAGE(...)）をそのまま転記
  evaluated.forEach((s, i) => {
    if (s.thumbnailFormula) {
      sheet.getRange(2 + i, 2).setFormula(s.thumbnailFormula);
    } else if (s.thumbnailValue) {
      sheet.getRange(2 + i, 2).setValue(s.thumbnailValue);
    }
    sheet.setRowHeight(2 + i, 100);
  });
}

/**
 * ⚡ 初速良好シート更新
 * C基準: 24時間以内の投稿で、1h時点視聴数が過去30日平均の1.3倍以上
 */
function updateFastGrowthSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const historySheet = ss.getSheetByName('📖 ストーリーズ履歴');
  const sheet = getOrCreateSheet(FAST_GROWTH_SHEET_);
  sheet.clear();
  setupFastGrowthHeader(sheet);

  if (!historySheet || historySheet.getLastRow() < 2) {
    sheet.getRange(2, 1).setValue('（履歴データなし）').setFontColor('#999999');
    return;
  }

  const data = historySheet.getRange(2, 1, historySheet.getLastRow() - 1, 10).getValues();
  const now = new Date();
  const dayAgo = new Date(now.getTime() - 24 * 3600 * 1000);
  const cutoff = new Date(now.getTime() - BASELINE_DAYS_ * 86400000);

  // id→{postedAt, points} に集約
  const byStory = {};
  data.forEach(row => {
    const postedAt = new Date(row[0]);
    const id = String(row[1]);
    const elapsedMin = Number(row[3]);
    const views = Number(row[5]) || 0;
    if (isNaN(postedAt.getTime())) return;
    if (!byStory[id]) byStory[id] = { postedAt, points: [] };
    byStory[id].points.push({ elapsedMin, views });
  });

  // 1h時点（45-75分）の視聴数を取得。帯内に複数点ある場合は60分に最も近い点を選ぶ
  const getView1h = (points) => {
    const candidates = points.filter(p => p.elapsedMin >= 45 && p.elapsedMin <= 75);
    if (candidates.length === 0) return null;
    const closest = candidates.reduce((best, p) =>
      Math.abs(p.elapsedMin - 60) < Math.abs(best.elapsedMin - 60) ? p : best
    );
    return closest.views;
  };

  // 過去30日の平均算出（ベースライン）
  const baseline = Object.values(byStory).filter(s => s.postedAt >= cutoff);
  const view1hs = baseline.map(s => getView1h(s.points)).filter(v => v !== null);

  if (view1hs.length === 0) {
    sheet.getRange(2, 1).setValue('（1h時点データ蓄積待ち）').setFontColor('#999999');
    return;
  }

  const avg1h = view1hs.reduce((a, b) => a + b, 0) / view1hs.length;

  const finals = baseline.map(s => {
    if (s.points.length === 0) return 0;
    return s.points.reduce((a, b) => (a.elapsedMin > b.elapsedMin ? a : b)).views;
  }).filter(v => v > 0);
  const avgFinal = finals.length > 0 ? finals.reduce((a, b) => a + b, 0) / finals.length : 0;

  // 24h以内の投稿で1h経過済みを候補化
  const candidates = Object.values(byStory)
    .filter(s => s.postedAt >= dayAgo)
    .map(s => {
      const view1h = getView1h(s.points);
      if (view1h === null) return null;
      const latest = s.points.reduce((a, b) => (a.elapsedMin > b.elapsedMin ? a : b));
      const ratio = avg1h > 0 ? view1h / avg1h : 0;
      return {
        postedAt: s.postedAt,
        elapsedMin: latest.elapsedMin,
        view1h,
        currentViews: latest.views,
        ratio,
        predictedFinal: avg1h > 0 ? Math.round(view1h / avg1h * avgFinal) : 0
      };
    })
    .filter(s => s && s.ratio >= 1.3)
    .sort((a, b) => b.ratio - a.ratio);

  if (candidates.length === 0) {
    sheet.getRange(2, 1).setValue('（現在ライブ中の初速良好投稿なし）').setFontColor('#999999');
    return;
  }

  const rows = candidates.map(s => [
    Utilities.formatDate(s.postedAt, 'Asia/Tokyo', 'MM/dd HH:mm'),
    `${(s.elapsedMin / 60).toFixed(1)}h`,
    s.view1h,
    s.currentViews,
    `${s.ratio.toFixed(2)}× 🔥`,
    `~${s.predictedFinal}`
  ]);
  sheet.getRange(2, 1, rows.length, 6).setValues(rows);
}

/**
 * サマリー（投稿数・平均エンゲージメント等）
 */
function writeSummary(sheet) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  sheet.getRange('A4').setValue('📌 サマリー').setFontSize(13).setFontWeight('bold');

  const summaryHeaders = ['', 'フィード', 'リール', 'ストーリーズ', '合計'];
  sheet.getRange(5, 1, 1, 5).setValues([summaryHeaders]).setFontWeight('bold').setBackground('#E3F2FD');

  // フィード集計
  const feedSheet = ss.getSheetByName('📸 フィード');
  const feedCount = feedSheet && feedSheet.getLastRow() > 1 ? feedSheet.getLastRow() - 1 : 0;
  const feedStats = feedCount > 0 ? aggregateColumn(feedSheet, { likes: 5, comments: 6, saved: 7, reach: 8 }) : { likes: 0, comments: 0, saved: 0, reach: 0 };

  // リール集計（D列=views）
  const reelSheet = ss.getSheetByName('🎬 リール');
  const reelCount = reelSheet && reelSheet.getLastRow() > 1 ? reelSheet.getLastRow() - 1 : 0;
  const reelStats = reelCount > 0 ? aggregateColumn(reelSheet, { views: 4, likes: 5, comments: 6, saved: 7, reach: 8 }) : { views: 0, likes: 0, comments: 0, saved: 0, reach: 0 };

  // ストーリーズ集計（E列=views）
  const storySheet = ss.getSheetByName('📖 ストーリーズ');
  const storyCount = storySheet && storySheet.getLastRow() > 1 ? storySheet.getLastRow() - 1 : 0;
  const storyStats = storyCount > 0 ? aggregateColumn(storySheet, { reach: 4, views: 5 }) : { reach: 0, views: 0 };

  const rows = [
    ['投稿数', feedCount, reelCount, storyCount, feedCount + reelCount + storyCount],
    ['合計いいね', feedStats.likes, reelStats.likes, '-', feedStats.likes + reelStats.likes],
    ['合計コメント', feedStats.comments, reelStats.comments, '-', feedStats.comments + reelStats.comments],
    ['合計保存', feedStats.saved, reelStats.saved, '-', feedStats.saved + reelStats.saved],
    ['合計リーチ', feedStats.reach, reelStats.reach, storyStats.reach, feedStats.reach + reelStats.reach + storyStats.reach],
    ['合計視聴数', '-', reelStats.views || 0, storyStats.views || 0, (reelStats.views || 0) + (storyStats.views || 0)]
  ];

  sheet.getRange(6, 1, rows.length, 5).setValues(rows);
  sheet.getRange(6, 2, rows.length, 4).setNumberFormat('#,##0');
}

/**
 * 列の合計を集計
 */
function aggregateColumn(sheet, columnMap) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    return Object.keys(columnMap).reduce((acc, key) => { acc[key] = 0; return acc; }, {});
  }

  const result = {};
  Object.entries(columnMap).forEach(([key, col]) => {
    const values = sheet.getRange(2, col, lastRow - 1, 1).getValues();
    result[key] = values.reduce((sum, row) => sum + (Number(row[0]) || 0), 0);
  });
  return result;
}

/**
 * トップ投稿（いいね順トップ5）
 */
function writeTopPosts(sheet) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const startRow = 14;

  sheet.getRange(startRow, 1).setValue('🏆 トップ投稿（いいね順）').setFontSize(13).setFontWeight('bold');

  const headers = ['順位', '種類', '投稿日', 'キャプション', 'いいね', 'リーチ'];
  sheet.getRange(startRow + 1, 1, 1, 6).setValues([headers]).setFontWeight('bold').setBackground('#FFF3E0');

  // フィードとリールを統合
  const allPosts = [];

  const feedSheet = ss.getSheetByName('📸 フィード');
  if (feedSheet && feedSheet.getLastRow() > 1) {
    const feedData = feedSheet.getRange(2, 1, feedSheet.getLastRow() - 1, 11).getValues();
    feedData.forEach(row => {
      allPosts.push({ type: '📸', date: row[0], caption: row[3], likes: row[4], reach: row[7] });
    });
  }

  const reelSheet = ss.getSheetByName('🎬 リール');
  if (reelSheet && reelSheet.getLastRow() > 1) {
    const reelData = reelSheet.getRange(2, 1, reelSheet.getLastRow() - 1, 11).getValues();
    reelData.forEach(row => {
      allPosts.push({ type: '🎬', date: row[0], caption: row[2], likes: row[4], reach: row[7] });
    });
  }

  allPosts.sort((a, b) => (b.likes || 0) - (a.likes || 0));
  const top5 = allPosts.slice(0, 5);

  if (top5.length > 0) {
    const rows = top5.map((post, i) => [
      i + 1, post.type, post.date, post.caption, post.likes, post.reach
    ]);
    sheet.getRange(startRow + 2, 1, rows.length, 6).setValues(rows);
  }
}

/**
 * 週別推移データ（グラフ用）
 */
function writeWeeklyTrend(sheet) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const startRow = 22;

  sheet.getRange(startRow, 1).setValue('📈 週別推移').setFontSize(13).setFontWeight('bold');

  const headers = ['週', 'フィードいいね', 'リールいいね', 'フィードリーチ', 'リールリーチ'];
  sheet.getRange(startRow + 1, 1, 1, 5).setValues([headers]).setFontWeight('bold').setBackground('#E8F5E9');

  // 全投稿を週別に集計
  const weeklyData = {};

  const feedSheet = ss.getSheetByName('📸 フィード');
  if (feedSheet && feedSheet.getLastRow() > 1) {
    const feedData = feedSheet.getRange(2, 1, feedSheet.getLastRow() - 1, 11).getValues();
    feedData.forEach(row => {
      const week = getWeekKey(row[0]);
      if (!weeklyData[week]) weeklyData[week] = { feedLikes: 0, reelLikes: 0, feedReach: 0, reelReach: 0 };
      weeklyData[week].feedLikes += Number(row[4]) || 0;
      weeklyData[week].feedReach += Number(row[7]) || 0;
    });
  }

  const reelSheet = ss.getSheetByName('🎬 リール');
  if (reelSheet && reelSheet.getLastRow() > 1) {
    const reelData = reelSheet.getRange(2, 1, reelSheet.getLastRow() - 1, 11).getValues();
    reelData.forEach(row => {
      const week = getWeekKey(row[0]);
      if (!weeklyData[week]) weeklyData[week] = { feedLikes: 0, reelLikes: 0, feedReach: 0, reelReach: 0 };
      weeklyData[week].reelLikes += Number(row[4]) || 0;
      weeklyData[week].reelReach += Number(row[7]) || 0;
    });
  }

  const weeks = Object.keys(weeklyData).sort().slice(-12); // 直近12週
  if (weeks.length > 0) {
    const rows = weeks.map(week => {
      const d = weeklyData[week];
      return [week, d.feedLikes, d.reelLikes, d.feedReach, d.reelReach];
    });
    const dataStartRow = startRow + 2;
    sheet.getRange(dataStartRow, 1, rows.length, 5).setValues(rows);

    // グラフ作成
    createWeeklyChart(sheet, dataStartRow, rows.length, startRow);
  }
}

/**
 * 日付から週キーを生成
 */
function getWeekKey(dateStr) {
  try {
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return 'unknown';
    const startOfYear = new Date(date.getFullYear(), 0, 1);
    const weekNum = Math.ceil(((date - startOfYear) / 86400000 + startOfYear.getDay() + 1) / 7);
    return `${date.getFullYear()}-W${String(weekNum).padStart(2, '0')}`;
  } catch (e) {
    return 'unknown';
  }
}

/**
 * 週別推移グラフを作成
 */
function createWeeklyChart(sheet, dataStartRow, rowCount, chartAnchorRow) {
  // 既存のグラフを削除
  const charts = sheet.getCharts();
  charts.forEach(chart => sheet.removeChart(chart));

  if (rowCount < 2) return;

  const chartBuilder = sheet.newChart()
    .setChartType(Charts.ChartType.LINE)
    .addRange(sheet.getRange(dataStartRow - 1, 1, rowCount + 1, 5))
    .setPosition(chartAnchorRow, 7, 0, 0)
    .setOption('title', '週別推移（いいね・リーチ）')
    .setOption('width', 600)
    .setOption('height', 350)
    .setOption('legend', { position: 'bottom' })
    .setOption('hAxis', { title: '週' })
    .setOption('vAxis', { title: '件数' });

  sheet.insertChart(chartBuilder.build());
}

/**
 * ストーリーズ初速グラフ（直近5件の視聴数推移）
 * 履歴シートから30分刻みでリサンプリングして折れ線表示
 */
function writeStoryVelocityChart(sheet) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const historySheet = ss.getSheetByName('📖 ストーリーズ履歴');
  const chartAnchorRow = 108;

  sheet.getRange(chartAnchorRow, 1).setValue('⚡ ストーリーズ初速（直近5件の視聴数推移）').setFontSize(13).setFontWeight('bold');

  if (!historySheet || historySheet.getLastRow() < 2) {
    sheet.getRange(chartAnchorRow + 1, 1).setValue('（履歴データがまだ蓄積されていません）').setFontColor('#999999');
    return;
  }

  const data = historySheet.getRange(2, 1, historySheet.getLastRow() - 1, 10).getValues();

  // メディアID別にグループ化
  const byStory = {};
  data.forEach(row => {
    const postedAt = row[0];
    const id = String(row[1]);
    const elapsedMin = Number(row[3]);
    const views = Number(row[5]) || 0;
    if (!byStory[id]) byStory[id] = { postedAt, points: [] };
    byStory[id].points.push({ elapsedMin, views });
  });

  // 投稿日時の新しい順で直近5件
  const storyList = Object.entries(byStory)
    .map(([id, d]) => ({ id, postedAt: new Date(d.postedAt), points: d.points }))
    .filter(s => !isNaN(s.postedAt.getTime()))
    .sort((a, b) => b.postedAt - a.postedAt)
    .slice(0, 5);

  if (storyList.length === 0) {
    sheet.getRange(chartAnchorRow + 1, 1).setValue('（履歴データがまだ蓄積されていません）').setFontColor('#999999');
    return;
  }

  // 30分刻みのバケット（0〜1440分）
  const buckets = [];
  for (let m = 0; m <= 1440; m += 30) buckets.push(m);

  const headers = ['経過分'].concat(
    storyList.map(s => Utilities.formatDate(s.postedAt, 'Asia/Tokyo', 'MM/dd HH:mm'))
  );
  sheet.getRange(chartAnchorRow + 1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold').setBackground('#FFE0B2');

  const rows = buckets.map(bucket => {
    const row = [bucket];
    storyList.forEach(s => {
      const before = s.points.filter(p => p.elapsedMin <= bucket);
      if (before.length === 0) {
        row.push('');
      } else {
        const latest = before.reduce((a, b) => (a.elapsedMin > b.elapsedMin ? a : b));
        row.push(latest.views);
      }
    });
    return row;
  });

  sheet.getRange(chartAnchorRow + 2, 1, rows.length, headers.length).setValues(rows);

  const chartBuilder = sheet.newChart()
    .setChartType(Charts.ChartType.LINE)
    .addRange(sheet.getRange(chartAnchorRow + 1, 1, rows.length + 1, headers.length))
    .setPosition(chartAnchorRow, 8, 0, 0)
    .setOption('title', '⚡ ストーリーズ初速（視聴数 vs 経過分）')
    .setOption('width', 700)
    .setOption('height', 400)
    .setOption('legend', { position: 'bottom' })
    .setOption('hAxis', { title: '投稿からの経過分', viewWindow: { min: 0, max: 1440 } })
    .setOption('vAxis', { title: '視聴数', viewWindow: { min: 0 } })
    .setOption('interpolateNulls', true);

  sheet.insertChart(chartBuilder.build());
}

/**
 * 共通ヘルパー: 投稿シートから行を抽出（Date + サムネイル数式付き）
 */
function readPostsWithFormulas_(sheet, cols) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  const values = sheet.getRange(2, 1, lastRow - 1, cols).getValues();
  const formulas = sheet.getRange(2, 2, lastRow - 1, 1).getFormulas();
  return values.map((row, i) => ({
    row,
    thumbnailValue: row[1],
    thumbnailFormula: formulas[i][0] || '',
    postedAt: new Date(row[0])
  })).filter(x => !isNaN(x.postedAt.getTime()));
}

/**
 * 共通ヘルパー: サムネイル列転記
 */
function writeThumbnail_(sheet, row, col, thumbnailFormula, thumbnailValue) {
  if (thumbnailFormula) {
    sheet.getRange(row, col).setFormula(thumbnailFormula);
  } else if (thumbnailValue) {
    sheet.getRange(row, col).setValue(thumbnailValue);
  }
}

/**
 * 履歴シートからメディアIDごとの時系列ポイントを構築
 * @param viewColIdx 視聴数/反応数の列インデックス（0始まり）
 */
function buildHistoryByStory_(historySheet, numCols, viewColIdx) {
  if (!historySheet || historySheet.getLastRow() < 2) return {};
  const data = historySheet.getRange(2, 1, historySheet.getLastRow() - 1, numCols).getValues();
  const byStory = {};
  data.forEach(row => {
    const postedAt = new Date(row[0]);
    const id = String(row[1]);
    const elapsedMin = Number(row[3]);
    const metric = Number(row[viewColIdx]) || 0;
    if (isNaN(postedAt.getTime())) return;
    if (!byStory[id]) byStory[id] = { postedAt, points: [] };
    byStory[id].points.push({ elapsedMin, metric });
  });
  return byStory;
}

/**
 * 指定分帯で最も近い点を返す
 */
function getMetricAtTime_(points, targetMin, windowMin) {
  const min = targetMin - windowMin;
  const max = targetMin + windowMin;
  const candidates = points.filter(p => p.elapsedMin >= min && p.elapsedMin <= max);
  if (candidates.length === 0) return null;
  const closest = candidates.reduce((best, p) =>
    Math.abs(p.elapsedMin - targetMin) < Math.abs(best.elapsedMin - targetMin) ? p : best
  );
  return closest.metric;
}

/**
 * 🏆 フィード伸びた投稿シート更新
 * A基準: 4指標中2つ以上クリア
 * - リーチが平均の1.5倍以上
 * - いいね率（いいね÷リーチ）が平均の1.5倍以上
 * - 保存率（保存÷リーチ）が1.0%以上
 * - コメント 1以上
 */
function updateTopFeedSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const feedSheet = ss.getSheetByName('📸 フィード');
  const sheet = getOrCreateSheet(TOP_FEED_SHEET_);
  sheet.clear();
  setupTopFeedHeader(sheet);

  if (!feedSheet || feedSheet.getLastRow() < 2) {
    sheet.getRange(2, 1).setValue('（フィードデータなし）').setFontColor('#999999');
    return;
  }

  const now = new Date();
  const cutoff = new Date(now.getTime() - BASELINE_DAYS_ * 86400000);
  const posts = readPostsWithFormulas_(feedSheet, 11)
    .filter(x => x.postedAt >= cutoff)
    .map(x => ({
      postedAt: x.postedAt,
      thumbnailValue: x.thumbnailValue,
      thumbnailFormula: x.thumbnailFormula,
      likes: Number(x.row[4]) || 0,
      comments: Number(x.row[5]) || 0,
      saved: Number(x.row[6]) || 0,
      reach: Number(x.row[7]) || 0
    }));

  if (posts.length === 0) {
    sheet.getRange(2, 1).setValue('（過去30日のデータなし）').setFontColor('#999999');
    return;
  }

  const avgReach = posts.reduce((s, p) => s + p.reach, 0) / posts.length;
  const avgLikeRate = posts.reduce((s, p) => s + (p.reach > 0 ? p.likes / p.reach : 0), 0) / posts.length;

  const evaluated = posts.map(p => {
    const likeRate = p.reach > 0 ? p.likes / p.reach : 0;
    const saveRate = p.reach > 0 ? (p.saved / p.reach) * 100 : 0;
    const reachRatio = avgReach > 0 ? p.reach / avgReach : 0;
    const likeRateRatio = avgLikeRate > 0 ? likeRate / avgLikeRate : 0;
    const met = {
      reach: reachRatio >= 1.5,
      likeRate: likeRateRatio >= 1.5,
      saveRate: saveRate >= 1.0,
      comments: p.comments >= 1
    };
    const metCount = Object.values(met).filter(Boolean).length;
    return { ...p, reachRatio, likeRate, saveRate, met, metCount };
  })
    .filter(p => p.metCount >= 2)
    .sort((a, b) => b.reach - a.reach)
    .slice(0, 10);

  if (evaluated.length === 0) {
    sheet.getRange(2, 1).setValue('（基準クリアの投稿なし）').setFontColor('#999999');
    return;
  }

  const rows = evaluated.map(p => [
    Utilities.formatDate(p.postedAt, 'Asia/Tokyo', 'MM/dd HH:mm'),
    '',
    p.reach,
    `${p.reachRatio.toFixed(2)}×${p.met.reach ? ' 🔥' : ''}`,
    `${(p.likeRate * 100).toFixed(1)}%${p.met.likeRate ? ' 🔥' : ''}`,
    `${p.saveRate.toFixed(1)}%${p.met.saveRate ? ' 🔥' : ''}`,
    `${p.comments}${p.met.comments ? ' 🔥' : ''}`,
    `${p.metCount}/4`
  ]);
  sheet.getRange(2, 1, rows.length, 8).setValues(rows);

  evaluated.forEach((p, i) => {
    writeThumbnail_(sheet, 2 + i, 2, p.thumbnailFormula, p.thumbnailValue);
    sheet.setRowHeight(2 + i, 100);
  });
}

/**
 * 🏆 リール伸びた投稿シート更新
 * A基準: 4指標中2つ以上クリア
 * - 視聴数が平均の1.5倍以上
 * - 保存率（保存÷リーチ）が1.0%以上
 * - シェア 1以上
 * - リーチ率（リーチ÷視聴数）が0.6以上
 */
function updateTopReelSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const reelSheet = ss.getSheetByName('🎬 リール');
  const sheet = getOrCreateSheet(TOP_REEL_SHEET_);
  sheet.clear();
  setupTopReelHeader(sheet);

  if (!reelSheet || reelSheet.getLastRow() < 2) {
    sheet.getRange(2, 1).setValue('（リールデータなし）').setFontColor('#999999');
    return;
  }

  const now = new Date();
  const cutoff = new Date(now.getTime() - BASELINE_DAYS_ * 86400000);
  const posts = readPostsWithFormulas_(reelSheet, 11)
    .filter(x => x.postedAt >= cutoff)
    .map(x => ({
      postedAt: x.postedAt,
      thumbnailValue: x.thumbnailValue,
      thumbnailFormula: x.thumbnailFormula,
      views: Number(x.row[3]) || 0,
      saved: Number(x.row[6]) || 0,
      reach: Number(x.row[7]) || 0,
      shares: Number(x.row[8]) || 0
    }));

  if (posts.length === 0) {
    sheet.getRange(2, 1).setValue('（過去30日のデータなし）').setFontColor('#999999');
    return;
  }

  const avgViews = posts.reduce((s, p) => s + p.views, 0) / posts.length;

  const evaluated = posts.map(p => {
    const saveRate = p.reach > 0 ? (p.saved / p.reach) * 100 : 0;
    const reachRate = p.views > 0 ? p.reach / p.views : 0;
    const viewsRatio = avgViews > 0 ? p.views / avgViews : 0;
    const met = {
      views: viewsRatio >= 1.5,
      saveRate: saveRate >= 1.0,
      shares: p.shares >= 1,
      reachRate: reachRate >= 0.6
    };
    const metCount = Object.values(met).filter(Boolean).length;
    return { ...p, viewsRatio, saveRate, reachRate, met, metCount };
  })
    .filter(p => p.metCount >= 2)
    .sort((a, b) => b.views - a.views)
    .slice(0, 10);

  if (evaluated.length === 0) {
    sheet.getRange(2, 1).setValue('（基準クリアの投稿なし）').setFontColor('#999999');
    return;
  }

  const rows = evaluated.map(p => [
    Utilities.formatDate(p.postedAt, 'Asia/Tokyo', 'MM/dd HH:mm'),
    '',
    p.views,
    `${p.viewsRatio.toFixed(2)}×${p.met.views ? ' 🔥' : ''}`,
    `${p.saveRate.toFixed(1)}%${p.met.saveRate ? ' 🔥' : ''}`,
    `${p.shares}${p.met.shares ? ' 🔥' : ''}`,
    `${p.reachRate.toFixed(2)}${p.met.reachRate ? ' 🔥' : ''}`,
    `${p.metCount}/4`
  ]);
  sheet.getRange(2, 1, rows.length, 8).setValues(rows);

  evaluated.forEach((p, i) => {
    writeThumbnail_(sheet, 2 + i, 2, p.thumbnailFormula, p.thumbnailValue);
    sheet.setRowHeight(2 + i, 100);
  });
}

/**
 * ⚡ フィード初速良好シート更新
 * C基準: 7日以内の投稿で、6h時点（5-7h帯）の総反応数が過去30日平均の1.3倍以上
 */
function updateFeedFastGrowthSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const historySheet = ss.getSheetByName('📸 フィード履歴');
  const sheet = getOrCreateSheet(FEED_FAST_SHEET_);
  sheet.clear();
  setupFeedFastGrowthHeader(sheet);

  if (!historySheet || historySheet.getLastRow() < 2) {
    sheet.getRange(2, 1).setValue('（履歴データなし）').setFontColor('#999999');
    return;
  }

  // フィード履歴: A投稿日時/B ID/C 取得時刻/D 経過分/E いいね/F コメント/G 保存/H リーチ/I 視聴/J 総反応
  // 総反応数 = 列J = index 9
  const byStory = buildHistoryByStory_(historySheet, 10, 9);
  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 86400000);
  const cutoff = new Date(now.getTime() - BASELINE_DAYS_ * 86400000);

  const baseline = Object.values(byStory).filter(s => s.postedAt >= cutoff);
  const view6hs = baseline.map(s => getMetricAtTime_(s.points, 360, 60)).filter(v => v !== null);

  if (view6hs.length === 0) {
    sheet.getRange(2, 1).setValue('（6h時点データ蓄積待ち）').setFontColor('#999999');
    return;
  }
  const avg6h = view6hs.reduce((a, b) => a + b, 0) / view6hs.length;

  const finals = baseline.map(s => {
    if (s.points.length === 0) return 0;
    return s.points.reduce((a, b) => (a.elapsedMin > b.elapsedMin ? a : b)).metric;
  }).filter(v => v > 0);
  const avgFinal = finals.length > 0 ? finals.reduce((a, b) => a + b, 0) / finals.length : 0;

  const candidates = Object.values(byStory)
    .filter(s => s.postedAt >= sevenDaysAgo)
    .map(s => {
      const view6h = getMetricAtTime_(s.points, 360, 60);
      if (view6h === null) return null;
      const latest = s.points.reduce((a, b) => (a.elapsedMin > b.elapsedMin ? a : b));
      const ratio = avg6h > 0 ? view6h / avg6h : 0;
      return {
        postedAt: s.postedAt,
        elapsedMin: latest.elapsedMin,
        view6h,
        currentViews: latest.metric,
        ratio,
        predictedFinal: avg6h > 0 ? Math.round(view6h / avg6h * avgFinal) : 0
      };
    })
    .filter(s => s && s.ratio >= 1.3)
    .sort((a, b) => b.ratio - a.ratio);

  if (candidates.length === 0) {
    sheet.getRange(2, 1).setValue('（初速良好の投稿なし）').setFontColor('#999999');
    return;
  }

  const rows = candidates.map(s => [
    Utilities.formatDate(s.postedAt, 'Asia/Tokyo', 'MM/dd HH:mm'),
    `${(s.elapsedMin / 60).toFixed(1)}h`,
    s.view6h,
    s.currentViews,
    `${s.ratio.toFixed(2)}× 🔥`,
    `~${s.predictedFinal}`
  ]);
  sheet.getRange(2, 1, rows.length, 6).setValues(rows);
}

/**
 * ⚡ リール初速良好シート更新
 * C基準: 7日以内の投稿で、6h時点（5-7h帯）の視聴数が過去30日平均の1.3倍以上
 */
function updateReelFastGrowthSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const historySheet = ss.getSheetByName('🎬 リール履歴');
  const sheet = getOrCreateSheet(REEL_FAST_SHEET_);
  sheet.clear();
  setupReelFastGrowthHeader(sheet);

  if (!historySheet || historySheet.getLastRow() < 2) {
    sheet.getRange(2, 1).setValue('（履歴データなし）').setFontColor('#999999');
    return;
  }

  // リール履歴: A投稿日時/B ID/C 取得時刻/D 経過分/E 視聴/F いいね/G コメント/H 保存/I リーチ/J シェア/K 総反応
  // 視聴数 = 列E = index 4
  const byStory = buildHistoryByStory_(historySheet, 11, 4);
  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 86400000);
  const cutoff = new Date(now.getTime() - BASELINE_DAYS_ * 86400000);

  const baseline = Object.values(byStory).filter(s => s.postedAt >= cutoff);
  const view6hs = baseline.map(s => getMetricAtTime_(s.points, 360, 60)).filter(v => v !== null);

  if (view6hs.length === 0) {
    sheet.getRange(2, 1).setValue('（6h時点データ蓄積待ち）').setFontColor('#999999');
    return;
  }
  const avg6h = view6hs.reduce((a, b) => a + b, 0) / view6hs.length;

  const finals = baseline.map(s => {
    if (s.points.length === 0) return 0;
    return s.points.reduce((a, b) => (a.elapsedMin > b.elapsedMin ? a : b)).metric;
  }).filter(v => v > 0);
  const avgFinal = finals.length > 0 ? finals.reduce((a, b) => a + b, 0) / finals.length : 0;

  const candidates = Object.values(byStory)
    .filter(s => s.postedAt >= sevenDaysAgo)
    .map(s => {
      const view6h = getMetricAtTime_(s.points, 360, 60);
      if (view6h === null) return null;
      const latest = s.points.reduce((a, b) => (a.elapsedMin > b.elapsedMin ? a : b));
      const ratio = avg6h > 0 ? view6h / avg6h : 0;
      return {
        postedAt: s.postedAt,
        elapsedMin: latest.elapsedMin,
        view6h,
        currentViews: latest.metric,
        ratio,
        predictedFinal: avg6h > 0 ? Math.round(view6h / avg6h * avgFinal) : 0
      };
    })
    .filter(s => s && s.ratio >= 1.3)
    .sort((a, b) => b.ratio - a.ratio);

  if (candidates.length === 0) {
    sheet.getRange(2, 1).setValue('（初速良好の投稿なし）').setFontColor('#999999');
    return;
  }

  const rows = candidates.map(s => [
    Utilities.formatDate(s.postedAt, 'Asia/Tokyo', 'MM/dd HH:mm'),
    `${(s.elapsedMin / 60).toFixed(1)}h`,
    s.view6h,
    s.currentViews,
    `${s.ratio.toFixed(2)}× 🔥`,
    `~${s.predictedFinal}`
  ]);
  sheet.getRange(2, 1, rows.length, 6).setValues(rows);
}

/**
 * 📸 フィード専用ダッシュボード
 */
function updateFeedDashboard() {
  const sheet = getOrCreateSheet('📊 フィードダッシュ');
  sheet.clear();
  sheet.getBandings().forEach(b => b.remove());
  sheet.getCharts().forEach(c => sheet.removeChart(c));
  sheet.setConditionalFormatRules([]);

  sheet.getRange('A1').setValue('📸 フィードダッシュボード').setFontSize(16).setFontWeight('bold');
  sheet.getRange('A2').setValue('最終更新: ' + Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy/MM/dd HH:mm')).setFontColor('#666666');

  writeMediaSummary_(sheet, '📸 フィード', { label: 'リーチ', metricCol: 7, thumbCol: 1, theme: '#1565C0' });
  writeMediaHourlyChart_(sheet, '📸 フィード履歴', { label: '総反応数', historyCols: 10, metricIdx: 9, targetMin: 360, windowMin: 60, unit: '6h反応', theme: '#1565C0', hourlyAnchorRow: 20 });
  writeMediaHeatmap_(sheet, '📸 フィード', { metricCol: 7, label: 'リーチ', theme: '#1976D2', heatmapAnchorRow: 48 });
  writeMediaVelocityChart_(sheet, '📸 フィード履歴', { historyCols: 10, metricIdx: 9, label: '総反応数', maxMinutes: 72 * 60, stepMinutes: 180, theme: '#1565C0', velocityAnchorRow: 78 });
}

/**
 * 🎬 リール専用ダッシュボード
 */
function updateReelDashboard() {
  const sheet = getOrCreateSheet('📊 リールダッシュ');
  sheet.clear();
  sheet.getBandings().forEach(b => b.remove());
  sheet.getCharts().forEach(c => sheet.removeChart(c));
  sheet.setConditionalFormatRules([]);

  sheet.getRange('A1').setValue('🎬 リールダッシュボード').setFontSize(16).setFontWeight('bold');
  sheet.getRange('A2').setValue('最終更新: ' + Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy/MM/dd HH:mm')).setFontColor('#666666');

  writeMediaSummary_(sheet, '🎬 リール', { label: '視聴数', metricCol: 3, thumbCol: 1, theme: '#C62828' });
  writeMediaHourlyChart_(sheet, '🎬 リール履歴', { label: '視聴数', historyCols: 11, metricIdx: 4, targetMin: 360, windowMin: 60, unit: '6h視聴', theme: '#C62828', hourlyAnchorRow: 20 });
  writeMediaHeatmap_(sheet, '🎬 リール', { metricCol: 3, label: '視聴数', theme: '#D32F2F', heatmapAnchorRow: 48 });
  writeMediaVelocityChart_(sheet, '🎬 リール履歴', { historyCols: 11, metricIdx: 4, label: '視聴数', maxMinutes: 168 * 60, stepMinutes: 360, theme: '#C62828', velocityAnchorRow: 78 });
}

/**
 * 共通: メディア別サマリー（今日/今週/今月・TOP3）
 */
function writeMediaSummary_(sheet, sourceSheetName, opts) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const startRow = 4;

  sheet.getRange(startRow, 1).setValue('📌 ' + sourceSheetName + ' サマリー').setFontSize(13).setFontWeight('bold');

  const src = ss.getSheetByName(sourceSheetName);
  if (!src || src.getLastRow() < 2) {
    sheet.getRange(startRow + 1, 1).setValue('（データなし）').setFontColor('#999999');
    return;
  }

  const lastRow = src.getLastRow();
  const values = src.getRange(2, 1, lastRow - 1, 11).getValues();
  const formulas = src.getRange(2, opts.thumbCol + 1, lastRow - 1, 1).getFormulas();
  const posts = values.map((row, i) => ({
    postedAt: new Date(row[0]),
    thumbnailValue: row[opts.thumbCol],
    thumbnailFormula: formulas[i][0] || '',
    metric: Number(row[opts.metricCol]) || 0
  })).filter(p => !isNaN(p.postedAt.getTime()));

  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterdayStart = new Date(todayStart.getTime() - 86400000);
  const weekStart = new Date(todayStart.getTime() - 7 * 86400000);
  const prevWeekStart = new Date(weekStart.getTime() - 7 * 86400000);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);

  const stats = (from, to) => {
    const p = posts.filter(x => x.postedAt >= from && x.postedAt < to);
    return {
      count: p.length,
      avg: p.length > 0 ? p.reduce((s, x) => s + x.metric, 0) / p.length : 0
    };
  };
  const pct = (a, b) => {
    if (b === 0) return a === 0 ? '—' : '+∞%';
    const p = ((a - b) / b) * 100;
    return (p >= 0 ? '+' : '') + p.toFixed(1) + '%';
  };

  const t = stats(todayStart, now);
  const y = stats(yesterdayStart, todayStart);
  const w = stats(weekStart, now);
  const pw = stats(prevWeekStart, weekStart);
  const m = stats(monthStart, now);
  const pm = stats(prevMonthStart, monthStart);

  sheet.getRange(startRow + 1, 1, 1, 4).setValues([['期間', '投稿数', '平均' + opts.label, '前比']])
    .setFontWeight('bold').setBackground(opts.theme).setFontColor('#FFFFFF');
  sheet.getRange(startRow + 2, 1, 3, 4).setValues([
    ['今日', t.count, Math.round(t.avg), pct(t.avg, y.avg)],
    ['今週', w.count, Math.round(w.avg), pct(w.avg, pw.avg)],
    ['今月', m.count, Math.round(m.avg), pct(m.avg, pm.avg)]
  ]);
  sheet.getRange(startRow + 2, 2, 3, 2).setNumberFormat('#,##0');

  sheet.getRange(startRow + 7, 1).setValue('🏆 今月のTOP3（' + opts.label + '順）').setFontSize(12).setFontWeight('bold');
  const top3 = posts.filter(p => p.postedAt >= monthStart).sort((a, b) => b.metric - a.metric).slice(0, 3);
  sheet.getRange(startRow + 8, 1, 1, 4).setValues([['順位', '投稿日時', 'サムネ', opts.label]])
    .setFontWeight('bold').setBackground('#FFE0B2');
  if (top3.length === 0) {
    sheet.getRange(startRow + 9, 1).setValue('（今月の投稿なし）').setFontColor('#999999');
    return;
  }
  sheet.getRange(startRow + 9, 1, top3.length, 4).setValues(
    top3.map((p, i) => [i + 1, Utilities.formatDate(p.postedAt, 'Asia/Tokyo', 'MM/dd HH:mm'), '', p.metric])
  );
  sheet.getRange(startRow + 9, 4, top3.length, 1).setNumberFormat('#,##0');
  top3.forEach((p, i) => {
    writeThumbnail_(sheet, startRow + 9 + i, 3, p.thumbnailFormula, p.thumbnailValue);
    sheet.setRowHeight(startRow + 9 + i, 100);
  });
}

/**
 * 共通: 時間帯別初速グラフ
 */
function writeMediaHourlyChart_(sheet, historySheetName, opts) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const hs = ss.getSheetByName(historySheetName);
  const anchor = opts.hourlyAnchorRow;

  sheet.getRange(anchor, 1).setValue('📊 時間帯別初速（投稿' + (opts.targetMin / 60) + 'h後の' + opts.label + '平均）').setFontSize(13).setFontWeight('bold');

  if (!hs || hs.getLastRow() < 2) {
    sheet.getRange(anchor + 1, 1).setValue('（履歴データなし）').setFontColor('#999999');
    return;
  }

  const byStory = buildHistoryByStory_(hs, opts.historyCols, opts.metricIdx);
  const now = new Date();
  const cutoff = new Date(now.getTime() - BASELINE_DAYS_ * 86400000);

  const byHour = {};
  Object.values(byStory).forEach(s => {
    if (s.postedAt < cutoff) return;
    const v = getMetricAtTime_(s.points, opts.targetMin, opts.windowMin);
    if (v === null) return;
    const h = s.postedAt.getHours();
    if (!byHour[h]) byHour[h] = [];
    byHour[h].push(v);
  });

  if (Object.keys(byHour).length === 0) {
    sheet.getRange(anchor + 1, 1).setValue('（' + (opts.targetMin / 60) + 'h時点データ蓄積待ち）').setFontColor('#999999');
    return;
  }

  sheet.getRange(anchor + 1, 1, 1, 3).setValues([['投稿時間帯', '平均' + opts.unit, '投稿数']])
    .setFontWeight('bold').setBackground(opts.theme).setFontColor('#FFFFFF');

  const rows = [];
  for (let h = 0; h < 24; h++) {
    const list = byHour[h];
    if (!list || list.length === 0) continue;
    rows.push([h + '時台', Math.round(list.reduce((a, b) => a + b, 0) / list.length), list.length]);
  }
  if (rows.length === 0) return;

  sheet.getRange(anchor + 2, 1, rows.length, 3).setValues(rows);
  sheet.getRange(anchor + 2, 2, rows.length, 2).setNumberFormat('#,##0');

  const chart = sheet.newChart()
    .setChartType(Charts.ChartType.COLUMN)
    .addRange(sheet.getRange(anchor + 1, 1, rows.length + 1, 2))
    .setPosition(anchor, 8, 0, 0)
    .setOption('title', '📊 時間帯別 平均' + opts.unit)
    .setOption('width', 700)
    .setOption('height', 350)
    .setOption('legend', { position: 'none' })
    .setOption('hAxis', { title: '投稿時間帯' })
    .setOption('vAxis', { title: '平均' + opts.unit, viewWindow: { min: 0 } })
    .setOption('colors', [opts.theme]);
  sheet.insertChart(chart.build());
}

/**
 * 共通: 曜日×時間ヒートマップ
 */
function writeMediaHeatmap_(sheet, sourceSheetName, opts) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const src = ss.getSheetByName(sourceSheetName);
  const anchor = opts.heatmapAnchorRow;

  sheet.getRange(anchor, 1).setValue('🗓 曜日×時間帯ヒートマップ（過去30日の平均' + opts.label + '）').setFontSize(13).setFontWeight('bold');

  if (!src || src.getLastRow() < 2) {
    sheet.getRange(anchor + 1, 1).setValue('（データなし）').setFontColor('#999999');
    return;
  }

  const data = src.getRange(2, 1, src.getLastRow() - 1, 11).getValues();
  const now = new Date();
  const cutoff = new Date(now.getTime() - BASELINE_DAYS_ * 86400000);
  const matrix = Array.from({ length: 24 }, () => Array.from({ length: 7 }, () => []));
  data.forEach(row => {
    const postedAt = new Date(row[0]);
    const metric = Number(row[opts.metricCol]) || 0;
    if (isNaN(postedAt.getTime()) || postedAt < cutoff) return;
    const hour = postedAt.getHours();
    const dow = (postedAt.getDay() + 6) % 7;
    matrix[hour][dow].push(metric);
  });

  sheet.getRange(anchor + 1, 1, 1, 8).setValues([['時間帯', '月', '火', '水', '木', '金', '土', '日']])
    .setFontWeight('bold').setBackground(opts.theme).setFontColor('#FFFFFF');

  const rows = [];
  for (let h = 0; h < 24; h++) {
    const row = [h + '時'];
    for (let d = 0; d < 7; d++) {
      const list = matrix[h][d];
      row.push(list.length > 0 ? Math.round(list.reduce((a, b) => a + b, 0) / list.length) : '');
    }
    rows.push(row);
  }
  sheet.getRange(anchor + 2, 1, 24, 8).setValues(rows);
  sheet.getRange(anchor + 2, 2, 24, 7).setNumberFormat('#,##0');

  const range = sheet.getRange(anchor + 2, 2, 24, 7);
  const rule = SpreadsheetApp.newConditionalFormatRule()
    .setGradientMinpointWithValue('#FFFFFF', SpreadsheetApp.InterpolationType.MIN, '')
    .setGradientMidpointWithValue('#90CAF9', SpreadsheetApp.InterpolationType.PERCENTILE, '50')
    .setGradientMaxpointWithValue(opts.theme, SpreadsheetApp.InterpolationType.MAX, '')
    .setRanges([range])
    .build();
  sheet.setConditionalFormatRules([...sheet.getConditionalFormatRules(), rule]);
}

/**
 * 共通: 初速グラフ（直近5件の指定範囲メトリクス推移）
 */
function writeMediaVelocityChart_(sheet, historySheetName, opts) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const hs = ss.getSheetByName(historySheetName);
  const anchor = opts.velocityAnchorRow;

  sheet.getRange(anchor, 1).setValue('⚡ 初速（直近5件の' + opts.label + '推移）').setFontSize(13).setFontWeight('bold');

  if (!hs || hs.getLastRow() < 2) {
    sheet.getRange(anchor + 1, 1).setValue('（履歴データなし）').setFontColor('#999999');
    return;
  }

  const byStory = buildHistoryByStory_(hs, opts.historyCols, opts.metricIdx);
  const stories = Object.entries(byStory)
    .map(([id, d]) => ({ id, postedAt: d.postedAt, points: d.points }))
    .filter(s => !isNaN(s.postedAt.getTime()))
    .sort((a, b) => b.postedAt - a.postedAt)
    .slice(0, 5);

  if (stories.length === 0) {
    sheet.getRange(anchor + 1, 1).setValue('（データなし）').setFontColor('#999999');
    return;
  }

  const buckets = [];
  for (let m = 0; m <= opts.maxMinutes; m += opts.stepMinutes) buckets.push(m);
  const headers = ['経過分'].concat(stories.map(s => Utilities.formatDate(s.postedAt, 'Asia/Tokyo', 'MM/dd HH:mm')));
  sheet.getRange(anchor + 1, 1, 1, headers.length).setValues([headers])
    .setFontWeight('bold').setBackground(opts.theme).setFontColor('#FFFFFF');

  const rows = buckets.map(bucket => {
    const row = [bucket];
    stories.forEach(s => {
      const before = s.points.filter(p => p.elapsedMin <= bucket);
      if (before.length === 0) row.push('');
      else row.push(before.reduce((a, b) => (a.elapsedMin > b.elapsedMin ? a : b)).metric);
    });
    return row;
  });
  sheet.getRange(anchor + 2, 1, rows.length, headers.length).setValues(rows);

  const chart = sheet.newChart()
    .setChartType(Charts.ChartType.LINE)
    .addRange(sheet.getRange(anchor + 1, 1, rows.length + 1, headers.length))
    .setPosition(anchor, 8, 0, 0)
    .setOption('title', '⚡ 初速（' + opts.label + ' vs 経過分）')
    .setOption('width', 700)
    .setOption('height', 400)
    .setOption('legend', { position: 'bottom' })
    .setOption('hAxis', { title: '投稿からの経過分', viewWindow: { min: 0, max: opts.maxMinutes } })
    .setOption('vAxis', { title: opts.label, viewWindow: { min: 0 } })
    .setOption('interpolateNulls', true);
  sheet.insertChart(chart.build());
}
