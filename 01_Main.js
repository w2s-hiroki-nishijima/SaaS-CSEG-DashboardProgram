/** Web application entry points and read-only RPC facade. */
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

function doGet() {
  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle(CSEG_APP.NAME)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function getBootstrapData() {
  const user = assertDomainUser_();
  return buildBootstrapData_(user);
}

function getInitialView() {
  const user = assertDomainUser_();
  const boot = buildBootstrapData_(user);
  return {
    boot: boot,
    dashboard: buildDashboardData_(boot.currentMonth)
  };
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
    pages.settings = buildSettingsView_();
  }
  return { month: targetMonth, pages: pages };
}

function getPerformanceView(month) {
  assertDomainUser_();
  return buildPerformanceData_(monthKey_(month));
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

function getSettingsView() {
  assertAdmin_();
  return buildSettingsView_();
}

function buildSettingsView_() {
  const cfg = getRuntimeConfig_();
  return {
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
    members: readRows_('Members').filter(function(r) { return toBoolean_(r.active); })
  };
}
