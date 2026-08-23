/** Web application entry points and read-only RPC facade. */
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

function doGet(e) {
  const params = e && e.parameter ? e.parameter : {};
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

function getBootstrapData() {
  const user = assertDomainUser_();
  return buildBootstrapData_(user);
}

function getInitialView(page, month) {
  const user = assertDomainUser_();
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

function buildInitialPageData_(page, month, user) {
  if (page === 'dashboard') return buildDashboardData_(month);
  if (page === 'performance') return buildPerformanceData_(month);
  if (page === 'skills') return buildSkillData_(user);
  if (page === 'assignments') return buildAssignmentData_(month, user);
  if (page === 'targets') return buildTargetData_(month);
  if (page === 'aggregate') return buildAggregateData_(month);
  if (page === 'notifications') return { rules: readRows_('NotificationRules') };
  if (page === 'settings') return buildSettingsView_(month);
  return buildDashboardData_(month);
}

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
      { id: 'settings', label: '設定', icon: '⚙', admin: true }
    ]
  };
}

function getDashboardView(month) {
  assertDomainUser_();
  return buildDashboardData_(monthKey_(month));
}

function getNavigationPrefetchData(month) {
  const user = assertDomainUser_();
  const targetMonth = monthKey_(month);
  const pages = {
    performance: buildPerformanceData_(targetMonth),
    skills: buildSkillData_(user),
    assignments: buildAssignmentData_(targetMonth, user)
  };
  if (user.isAdmin) {
    pages.targets = buildTargetData_(targetMonth);
    pages.aggregate = buildAggregateData_(targetMonth);
    pages.notifications = { rules: readRows_('NotificationRules') };
    pages.settings = buildSettingsView_(targetMonth);
  }
  return { month: targetMonth, pages: pages };
}

function getPerformanceView(month) {
  assertDomainUser_();
  return buildPerformanceData_(monthKey_(month));
}

function getPerformanceMemberIssues(month, memberName) {
  assertDomainUser_();
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

function getSkillView() {
  const user = assertDomainUser_();
  return buildSkillData_(user);
}

function getAssignmentView(month) {
  const user = assertDomainUser_();
  return buildAssignmentData_(monthKey_(month), user);
}

function getTargetView(month) {
  assertAdmin_();
  return buildTargetData_(monthKey_(month));
}

function getAggregateView(month) {
  assertAdmin_();
  return buildAggregateData_(monthKey_(month));
}

function getNotificationView() {
  assertAdmin_();
  return { rules: readRows_('NotificationRules') };
}

function getSettingsView(month) {
  assertAdmin_();
  return buildSettingsView_(monthKey_(month));
}

function buildSettingsView_(month) {
  const cfg = getRuntimeConfig_();
  const targetMonth = monthKey_(month);
  return {
    month: targetMonth,
    monthlyTeamSpreadsheetUrl: 'https://docs.google.com/spreadsheets/d/' + CSEG_APP.MONTHLY_TEAM_SPREADSHEET_ID + '/edit',
    allowedDomain: cfg.allowedDomain,
    adminEmails: cfg.adminEmails.join(', '),
    adminGroupEmail: cfg.adminGroupEmail,
    backlogSpaceUrl: cfg.backlogSpaceUrl,
    backlogProjectKeys: cfg.backlogProjectKeys.join(', '),
    backlogApiKeyConfigured: Boolean(cfg.backlogApiKey),
    slackWebhookConfigured: Boolean(cfg.slackWebhookUrl),
    termStartDate: cfg.termStartDate,
    dataSpreadsheetId: cfg.dataSpreadsheetId,
    lastSyncAt: PropertiesService.getScriptProperties().getProperty('BACKLOG_LAST_SYNC_AT') || '',
    lastSyncStatus: PropertiesService.getScriptProperties().getProperty('BACKLOG_LAST_SYNC_STATUS') || '',
    members: getMembersForMonth_(targetMonth)
  };
}
