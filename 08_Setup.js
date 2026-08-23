/** One-time setup. Run setupApplication() from the Apps Script editor. */
function setupApplication() {
  const props = PropertiesService.getScriptProperties();
  const email = getActiveEmail_();
  if (!email) throw new Error('W2アカウントでApps Scriptを開いて実行してください。');
  if (!props.getProperty('DATA_SPREADSHEET_ID') && CSEG_APP.DEFAULT_DATA_SPREADSHEET_ID.indexOf('__') !== 0) {
    props.setProperty('DATA_SPREADSHEET_ID', CSEG_APP.DEFAULT_DATA_SPREADSHEET_ID);
  }
  if (!props.getProperty('ALLOWED_DOMAIN')) props.setProperty('ALLOWED_DOMAIN', CSEG_APP.ALLOWED_DOMAIN);
  const admins = splitCsv_(props.getProperty('ADMIN_EMAILS')).map(function(v) { return v.toLowerCase(); });
  if (admins.indexOf(email) < 0) admins.push(email);
  props.setProperty('ADMIN_EMAILS', admins.join(','));
  Object.keys(CSEG_SHEETS).forEach(function(name) {
    const sheet = getSheet_(name);
    const headers = CSEG_SHEETS[name];
    if (sheet.getLastRow() === 0) sheet.getRange(1, 1, 1, headers.length).setValues([sheetHeaderLabels_(name)]);
  });
  linkPrimaryAdminMember_(email);
  seedDefaults_();
  installTriggers_();
  scheduleAnalyticsRebuild_();
  return { ok: true, adminEmail: email, dataSpreadsheetId: getRuntimeConfig_().dataSpreadsheetId, analyticsCacheScheduled: true };
}

function linkPrimaryAdminMember_(email) {
  const members = readRows_('Members');
  let target = members.find(function(m) { return m.name === CSEG_APP.DEFAULT_ADMIN_MEMBER_NAME; });
  if (!target) {
    target = { memberId: 'primary_admin', name: CSEG_APP.DEFAULT_ADMIN_MEMBER_NAME, team: 'エスカレBチーム', skillLevel: 'M', experienceLevel: 'CSEGD', speedCoefficient: 1, compositeLevel: 'M-D', active: true };
  }
  target.email = email; target.role = 'admin'; target.updatedAt = nowIso_(); target.updatedBy = email;
  upsertRows_('Members', [target], ['memberId']);
}

function seedDefaults_() {
  if (!readRows_('TargetCoefficients').length) {
    appendRows_('TargetCoefficients', [
      { kind: 'skill', code: 'BT', label: 'BT', coefficient: 3.125, description: '', active: true },
      { kind: 'skill', code: 'S', label: 'S', coefficient: 2.5, description: '', active: true },
      { kind: 'skill', code: 'A', label: 'A', coefficient: 2, description: '', active: true },
      { kind: 'skill', code: 'H', label: 'H', coefficient: 1.625, description: '', active: true },
      { kind: 'skill', code: 'T', label: 'T', coefficient: 1.25, description: '', active: true },
      { kind: 'skill', code: 'M', label: 'M', coefficient: 1, description: '', active: true },
      { kind: 'skill', code: 'L', label: 'L', coefficient: 0.85, description: '', active: true },
      { kind: 'skill', code: 'L新Q3', label: 'L新Q3', coefficient: 0.5, description: '', active: true },
      { kind: 'skill', code: 'VNﾗｲﾝ', label: 'VNライン', coefficient: 0.4625, description: '', active: true },
      { kind: 'skill', code: 'VNﾗｲﾝ(新人)', label: 'VNライン（新人）', coefficient: 0.8, description: '', active: true },
      { kind: 'experience', code: 'CSEGA', label: 'CSEG経験3年〜', coefficient: 1.35, description: '', active: true },
      { kind: 'experience', code: 'CSEGB', label: 'CSEG経験2年〜', coefficient: 1.2, description: '', active: true },
      { kind: 'experience', code: 'CSEGC', label: 'CSEG経験または入社1年〜', coefficient: 1.15, description: '', active: true },
      { kind: 'experience', code: 'CSEGD', label: 'CSEG経験1年未満', coefficient: 1, description: '', active: true }
    ]);
  }
  if (!readRows_('SkillMaster').length) {
    appendRows_('SkillMaster', [
      { skillId: 'skill_investigation', category: '調査', skillName: '原因調査', description: 'ログ・コード・DBを用いて原因を特定する', maxLevel: 5, pointsPerLevel: 10, active: true, displayOrder: 10, updatedAt: nowIso_(), updatedBy: 'system' },
      { skillId: 'skill_customer', category: '対応', skillName: '顧客説明', description: '技術内容を相手に合わせて説明する', maxLevel: 5, pointsPerLevel: 10, active: true, displayOrder: 20, updatedAt: nowIso_(), updatedBy: 'system' },
      { skillId: 'skill_backlog', category: '運用', skillName: 'Backlog起票品質', description: '再現条件・原因・対応方針を明確に記載する', maxLevel: 5, pointsPerLevel: 10, active: true, displayOrder: 30, updatedAt: nowIso_(), updatedBy: 'system' }
    ]);
  }
}

function installTriggers_() {
  const handlers = ['runHourlyBacklogSync_', 'runNotificationJobs_', 'continueBacklogSync_'];
  ScriptApp.getProjectTriggers().forEach(function(trigger) {
    if (handlers.indexOf(trigger.getHandlerFunction()) >= 0) ScriptApp.deleteTrigger(trigger);
  });
  ScriptApp.newTrigger('runHourlyBacklogSync_').timeBased().everyHours(1).create();
  ScriptApp.newTrigger('runNotificationJobs_').timeBased().everyDays(1).atHour(9).create();
}
