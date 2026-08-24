/** Webアプリの入口と、画面から呼ばれる読取系RPCの互換窓口を提供する。 */
/** HTMLテンプレートから共通HTMLファイルを読み込む。 */
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

/** URLパラメータから初期ページと対象月を決め、WebアプリのHTMLを返す。 */
function doGet(e) {
  const params = e && e.parameter ? e.parameter : {};
  if (params.code || params.error) return handleGoogleIdentityCallback_(params);
  const page = /^[a-z]+$/.test(String(params.page || '')) ? String(params.page) : 'dashboard';
  const month = /^\d{4}-\d{2}$/.test(String(params.month || '')) ? String(params.month) : '';
  const template = HtmlService.createTemplateFromFile('Index');
  template.initialRouteJson = JSON.stringify({
    page: page,
    month: month,
    explicit: Boolean(params.page || params.month)
  }).replace(/</g, '\\u003c');
  template.initialRouteDirect = Boolean(params.page || params.month);
  return template.evaluate()
    .setTitle(CSEG_APP.NAME)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/** ログインユーザーとナビゲーション定義を含む起動情報を返す。 */
function getBootstrapData() {
  const user = assertAuthorizedUser_();
  return buildBootstrapData_(user);
}

/** 権限を確認して初期ページを決定し、起動情報と最初の画面データをまとめて返す。 */
function getInitialView(page, month) {
  const user = assertAuthorizedUser_();
  const boot = buildBootstrapData_(user);
  const allowedPages = boot.pages.filter(function(item) {
    return !item.admin || user.isAdmin;
  }).map(function(item) { return item.id; });
  const targetPage = allowedPages.indexOf(String(page || 'dashboard')) >= 0
    ? String(page || 'dashboard')
    : 'dashboard';
  const targetMonth = monthKey_(month || boot.currentMonth);
  return {
    boot: boot,
    page: targetPage,
    month: targetMonth,
    data: buildInitialPageData_(targetPage, targetMonth, user)
  };
}

/** ページIDに対応するQuery Serviceへ初期画面データの生成を委譲する。 */
function buildInitialPageData_(page, month, user) {
  return getApplicationServices_().pages.get(page, month, user);
}

/** ユーザー権限、同期状態、ページ一覧から画面起動用ViewModelを組み立てる。 */
function buildBootstrapData_(user) {
  const config = getRuntimeConfig_();
  const lastSync = PropertiesService.getScriptProperties().getProperty('BACKLOG_LAST_SYNC_AT') || '';
  return {
    app: { name: CSEG_APP.NAME, version: CSEG_APP.VERSION },
    user: user,
    currentMonth: monthKey_(),
    lastSyncAt: lastSync,
    backlogConfigured: Boolean(config.backlogSpaceUrl && config.backlogApiKey && config.backlogProjectKeys.length),
    dataStoreConfigured: Boolean(config.dataSpreadsheetId && config.dataSpreadsheetId.indexOf('__') !== 0),
    pages: [
      { id: 'dashboard', label: 'ダッシュボード', icon: '◫' },
      { id: 'performance', label: '実績確認', icon: '◎' },
      { id: 'skills', label: 'スキルポイント', icon: '◇' },
      { id: 'assignments', label: 'アサイン状況', icon: '▦' },
      { id: 'notifications', label: '通知センター', icon: '◉', admin: true },
      { id: 'targets', label: 'メンバー目標件数', icon: '⌁', admin: true },
      { id: 'aggregate', label: 'アグリゲート', icon: '▥', admin: true },
      { id: 'settings', label: '設定', icon: '⚙', admin: true },
      { id: 'feedback', label: '改善要望・不具合報告', icon: '!' }
    ]
  };
}

/** 指定月のダッシュボード表示データを返す公開RPC。 */
function getDashboardView(month) {
  assertAuthorizedUser_();
  return buildDashboardData_(monthKey_(month));
}

/** 画面遷移を高速化するため、指定月の主要ページを一括で先読みする。 */
function getNavigationPrefetchData(month) {
  const user = assertAuthorizedUser_();
  const targetMonth = monthKey_(month);
  const pages = {
    performance: buildPerformanceData_(targetMonth),
    skills: getApplicationServices_().skill.getView(user),
    assignments: buildAssignmentData_(targetMonth, user)
  };
  if (user.isAdmin) {
    pages.targets = buildTargetData_(targetMonth);
    pages.aggregate = buildAggregateData_(targetMonth);
    pages.notifications = getApplicationServices_().notification.getView();
    pages.settings = buildSettingsView_(targetMonth);
  }
  return { month: targetMonth, pages: pages };
}

/** 指定月のメンバー別実績一覧を返す公開RPC。 */
function getPerformanceView(month) {
  assertAuthorizedUser_();
  return buildPerformanceData_(monthKey_(month));
}

/** 指定メンバーのチケット明細を索引優先で取得し、画面用形式で返す。 */
function getPerformanceMemberIssues(month, memberName) {
  assertAuthorizedUser_();
  const targetMonth = monthKey_(month);
  const name = String(memberName || '').trim();
  if (!name) throw new Error('メンバー名が指定されていません。');
  const indexKey = targetMonth + '\u001f' + name;
  const index = readRows_('PerformanceIssueIndex').find(function(row) {
    return String(row.indexKey) === indexKey;
  });
  let rows = index ? readIndexedPerformanceIssues_(index, targetMonth, name) : [];
  if (!rows.length) {
    Array.prototype.push.apply(rows, readPerformanceIssuesFromBacklog_(targetMonth, name));
  }
  return {
    month: targetMonth,
    memberName: name,
    rows: (rows || []).map(performanceIssueForClient_)
  };
}

/** PerformanceIssuesの行を、日付・真偽値・数値を整えた画面用データへ変換する。 */
function performanceIssueForClient_(row) {
  const out = {};
  CSEG_SHEETS.PerformanceIssues.forEach(function(header) {
    const value = row && row[header];
    out[header] = value instanceof Date
      ? Utilities.formatDate(value, CSEG_APP.TIMEZONE, "yyyy-MM-dd'T'HH:mm:ssXXX")
      : (value == null ? '' : value);
  });
  out.emergencyFlag = toBoolean_(out.emergencyFlag);
  out.point = toNumber_(out.point);
  return out;
}

/** PerformanceIssueIndexの開始行と件数を使い、対象メンバーの明細だけを高速取得する。 */
function readIndexedPerformanceIssues_(index, targetMonth, memberName) {
  const sheet = getSheet_('PerformanceIssues');
  const headers = CSEG_SHEETS.PerformanceIssues;
  const startRow = Math.max(2, Math.floor(toNumber_(index.startRow, 2)));
  const availableRows = Math.max(0, sheet.getLastRow() - startRow + 1);
  const rowCount = Math.min(availableRows, Math.max(0, Math.floor(toNumber_(index.rowCount))));
  if (!rowCount) return [];
  return sheet.getRange(startRow, 1, rowCount, headers.length).getValues().map(function(values) {
    const row = {};
    headers.forEach(function(header, column) { row[header] = values[column]; });
    return row;
  }).filter(function(row) {
    return monthKey_(row.month) === targetMonth && String(row.memberName || '').trim() === memberName;
  });
}

/** 索引明細がない場合にBacklogIssuesから対象メンバーの明細を復元する。 */
function readPerformanceIssuesFromBacklog_(month, memberName) {
  const sheet = getSheet_('BacklogIssues');
  const headers = CSEG_SHEETS.BacklogIssues;
  const indexes = {};
  headers.forEach(function(header, index) { indexes[header] = index; });
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  const rowCount = lastRow - 1;
  const owners = sheet.getRange(2, indexes.csegOwner + 1, rowCount, 1).getDisplayValues();
  const dueDates = sheet.getRange(2, indexes.dueDate + 1, rowCount, 1).getDisplayValues();
  const result = [];
  const seen = {};
  owners.forEach(function(row, index) {
    if (String(dueDates[index][0] || '').slice(0, 7) !== month) return;
    if (splitCsegOwners_(row[0]).indexOf(memberName) < 0) return;
    const values = sheet.getRange(index + 2, 1, 1, headers.length).getValues()[0];
    const issue = analyticsIssueFromRow_(values, indexes);
    if (seen[issue.issueKey]) return;
    seen[issue.issueKey] = true;
    result.push({
      month: month, memberName: memberName, issueKey: issue.issueKey,
      summary: issue.summary, milestone: issue.milestone, point: issue.point,
      emergencyFlag: toBoolean_(issue.emergencyFlag), tatBusinessDays: issue.tatBusinessDays, url: issue.url
    });
  });
  result.sort(function(a, b) { return String(a.issueKey).localeCompare(String(b.issueKey)); });
  return result;
}

/** スキルマスタとメンバー別スコアを返す公開RPC。 */
function getSkillView() {
  const user = assertAuthorizedUser_();
  return getApplicationServices_().skill.getView(user);
}

/** 指定月の予定・実績アサインを返す公開RPC。 */
function getAssignmentView(month) {
  const user = assertAuthorizedUser_();
  return buildAssignmentData_(monthKey_(month), user);
}

/** 改善要望・不具合報告とコメント一覧を返す公開RPC。 */
function getFeedbackView() {
  const user = assertAuthorizedUser_();
  return buildFeedbackData_(user);
}

/** 管理者向けに指定月のメンバー目標件数を返す公開RPC。 */
function getTargetView(month) {
  assertAdmin_();
  return buildTargetData_(monthKey_(month));
}

/** 管理者向けに指定月のチーム集計を返す公開RPC。 */
function getAggregateView(month) {
  assertAdmin_();
  return buildAggregateData_(monthKey_(month));
}

/** 管理者向けに通知ルール一覧を返す公開RPC。 */
function getNotificationView() {
  assertAdmin_();
  return getApplicationServices_().notification.getView();
}

/** 管理者向けに設定値と指定月のメンバー情報を返す公開RPC。 */
function getSettingsView(month) {
  assertAdmin_();
  return buildSettingsView_(monthKey_(month));
}

/** Script Propertiesと月別所属をまとめ、設定画面用ViewModelを生成する。 */
function buildSettingsView_(month) {
  const cfg = getRuntimeConfig_();
  const targetMonth = monthKey_(month);
  const linkedMemberIds = {};
  readRows_('IdentityBindings').forEach(function(binding) {
    if (toBoolean_(binding.active) && binding.memberId) linkedMemberIds[String(binding.memberId)] = true;
  });
  return {
    month: targetMonth,
    monthlyTeamSpreadsheetUrl: 'https://docs.google.com/spreadsheets/d/' + CSEG_APP.MONTHLY_TEAM_SPREADSHEET_ID + '/edit',
    adminEmails: cfg.adminEmails.join(', '),
    adminGroupEmail: cfg.adminGroupEmail,
    googleIdentityClientId: cfg.googleIdentityClientId,
    googleIdentityClientSecretConfigured: Boolean(cfg.googleIdentityClientSecret),
    googleIdentityRedirectUri: getGoogleIdentityRedirectUri_(),
    backlogSpaceUrl: cfg.backlogSpaceUrl,
    backlogProjectKeys: cfg.backlogProjectKeys.join(', '),
    backlogApiKeyConfigured: Boolean(cfg.backlogApiKey),
    slackWebhookConfigured: Boolean(cfg.slackWebhookUrl),
    termStartDate: cfg.termStartDate,
    dataSpreadsheetId: cfg.dataSpreadsheetId,
    lastSyncAt: PropertiesService.getScriptProperties().getProperty('BACKLOG_LAST_SYNC_AT') || '',
    lastSyncStatus: PropertiesService.getScriptProperties().getProperty('BACKLOG_LAST_SYNC_STATUS') || '',
    members: getMembersForMonth_(targetMonth).map(function(member) {
      const row = Object.assign({}, member);
      row.googleIdentityLinked = Boolean(linkedMemberIds[String(member.memberId)]);
      return row;
    })
  };
}
