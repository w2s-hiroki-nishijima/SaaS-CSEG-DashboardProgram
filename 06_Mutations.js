/** Validated writes from the web application. */
function submitFeedbackReport(input) {
  const user = assertDomainUser_();
  const type = String(input && input.type || '改善要望');
  const title = String(input && input.title || '').trim();
  const description = String(input && input.description || '').trim();
  if (CSEG_FEEDBACK.TYPES.indexOf(type) < 0) throw new Error('報告種別が不正です。');
  if (!title) throw new Error('タイトルを入力してください。');
  if (!description) throw new Error('内容を入力してください。');
  const now = nowIso_();
  const report = {
    reportId: 'feedback_' + Utilities.getUuid(), type: type,
    title: title.slice(0, 200), description: description.slice(0, 5000), status: '未対応',
    createdAt: now, createdByEmail: user.email, createdByName: user.name,
    updatedAt: now, updatedBy: user.email
  };
  upsertRows_('FeedbackReports', [report], ['reportId']);
  return { ok: true, view: buildFeedbackData_(user) };
}

function addFeedbackComment(input) {
  const user = assertDomainUser_();
  const reportId = String(input && input.reportId || '');
  const commentText = String(input && input.comment || '').trim();
  if (!readRows_('FeedbackReports').some(function(report) { return String(report.reportId) === reportId; })) {
    throw new Error('対象の報告が見つかりません。');
  }
  if (!commentText) throw new Error('コメントを入力してください。');
  const now = nowIso_();
  upsertRows_('FeedbackComments', [{
    commentId: 'comment_' + Utilities.getUuid(), reportId: reportId,
    comment: commentText.slice(0, 3000), createdAt: now,
    createdByEmail: user.email, createdByName: user.name
  }], ['commentId']);
  return { ok: true, view: buildFeedbackData_(user) };
}

function updateFeedbackStatus(input) {
  const user = assertDomainUser_();
  const reportId = String(input && input.reportId || '');
  const status = String(input && input.status || '');
  if (CSEG_FEEDBACK.STATUSES.indexOf(status) < 0) throw new Error('ステータスが不正です。');
  const report = readRows_('FeedbackReports').find(function(row) { return String(row.reportId) === reportId; });
  if (!report) throw new Error('対象の報告が見つかりません。');
  report.status = status;
  report.updatedAt = nowIso_();
  report.updatedBy = user.email;
  upsertRows_('FeedbackReports', [report], ['reportId']);
  return { ok: true, view: buildFeedbackData_(user) };
}

function saveMonthlyTargets(payload) {
  assertAdmin_();
  throw new Error('目標件数はアサイン活用報告シートから自動計算されるため、管理画面からは変更できません。');
}

function saveAssignmentEntry(input) {
  if (!input || !input.memberId) throw new Error('メンバーを選択してください。');
  const user = assertMemberWrite_(input.memberId);
  const month = monthKey_(input.month);
  saveMonthlyAssignmentActual_(month, input);
  return { ok: true, updatedBy: user.email, view: buildAssignmentData_(month, user) };
}

function saveSkillScore(input) {
  if (!input || !input.memberId || !input.skillId) throw new Error('メンバーとスキルを選択してください。');
  const user = assertMemberWrite_(input.memberId);
  const member = readRows_('Members').find(function(m) { return String(m.memberId) === String(input.memberId); });
  const skill = readRows_('SkillMaster').find(function(s) { return String(s.skillId) === String(input.skillId); });
  if (!member || !skill) throw new Error('メンバーまたはスキルが見つかりません。');
  const level = Math.max(0, Math.min(toNumber_(skill.maxLevel, 5), Math.floor(toNumber_(input.level))));
  const row = {
    scoreId: member.memberId + ':' + skill.skillId, memberId: member.memberId, memberName: member.name,
    skillId: skill.skillId, skillName: skill.skillName, level: level,
    points: level * toNumber_(skill.pointsPerLevel, 1), note: String(input.note || '').slice(0, 1000),
    updatedAt: nowIso_(), updatedBy: user.email
  };
  upsertRows_('SkillScores', [row], ['scoreId']);
  return { ok: true, score: row };
}

function saveSkillMaster(input) {
  const user = assertAdmin_();
  if (!input || !String(input.skillName || '').trim()) throw new Error('スキル名を入力してください。');
  const row = {
    skillId: input.skillId || 'skill_' + Utilities.getUuid(), category: String(input.category || '共通').slice(0, 100),
    skillName: String(input.skillName).trim().slice(0, 200), description: String(input.description || '').slice(0, 1000),
    maxLevel: Math.max(1, Math.min(10, Math.floor(toNumber_(input.maxLevel, 5)))),
    pointsPerLevel: Math.max(0, toNumber_(input.pointsPerLevel, 1)), active: input.active !== false,
    displayOrder: toNumber_(input.displayOrder, 100), updatedAt: nowIso_(), updatedBy: user.email
  };
  upsertRows_('SkillMaster', [row], ['skillId']);
  return { ok: true, skill: row };
}

function saveNotificationRule(input) {
  const user = assertAdmin_();
  if (!input || !String(input.name || '').trim()) throw new Error('通知名を入力してください。');
  const allowedTypes = ['overdue_tickets', 'missing_assignment', 'sync_error'];
  const allowedChannels = ['email', 'slack', 'none'];
  if (allowedTypes.indexOf(input.type) < 0 || allowedChannels.indexOf(input.channel) < 0) throw new Error('通知種別または送信先が不正です。');
  const row = {
    ruleId: input.ruleId || 'rule_' + Utilities.getUuid(), name: String(input.name).trim().slice(0, 200),
    type: input.type, enabled: Boolean(input.enabled), schedule: input.schedule || 'daily',
    dayOfWeek: input.dayOfWeek || '', sendTime: input.sendTime || '09:00', channel: input.channel,
    recipients: String(input.recipients || '').slice(0, 1000), message: String(input.message || '').slice(0, 2000),
    lastRunAt: input.lastRunAt || '', updatedAt: nowIso_(), updatedBy: user.email
  };
  upsertRows_('NotificationRules', [row], ['ruleId']);
  return { ok: true, rule: row };
}

function saveAppSettings(input) {
  const user = assertAdmin_();
  const props = PropertiesService.getScriptProperties();
  if (input.allowedDomain) props.setProperty('ALLOWED_DOMAIN', String(input.allowedDomain).trim().toLowerCase());
  props.setProperty('ADMIN_EMAILS', String(input.adminEmails || '').trim().toLowerCase());
  props.setProperty('ADMIN_GROUP_EMAIL', String(input.adminGroupEmail || '').trim().toLowerCase());
  props.setProperty('BACKLOG_SPACE_URL', String(input.backlogSpaceUrl || '').trim().replace(/\/$/, ''));
  props.setProperty('BACKLOG_PROJECT_KEYS', String(input.backlogProjectKeys || '').trim());
  if (String(input.backlogApiKey || '').trim()) props.setProperty('BACKLOG_API_KEY', String(input.backlogApiKey).trim());
  if (String(input.slackWebhookUrl || '').trim()) props.setProperty('SLACK_WEBHOOK_URL', String(input.slackWebhookUrl).trim());
  if (input.termStartDate) props.setProperty('TERM_START_DATE', dateKey_(input.termStartDate));
  clearRuntimeConfigMemo_();
  appendRows_('Settings', [{ key: 'LAST_SETTINGS_UPDATE', value: nowIso_(), description: '設定画面の最終更新', updatedAt: nowIso_(), updatedBy: user.email }]);
  return { ok: true };
}

function saveMonthlyMemberSettings(payload) {
  assertAdmin_();
  if (!payload || !Array.isArray(payload.rows)) throw new Error('メンバーデータが不正です。');
  const month = monthKey_(payload.month);
  saveMonthlyTeamMembership_(month, payload.rows);
  saveMembers(payload.rows);
  return { ok: true, settings: buildSettingsView_(month) };
}

function saveMembers(inputRows) {
  const user = assertAdmin_();
  if (!Array.isArray(inputRows)) throw new Error('メンバーデータが不正です。');
  const rows = inputRows.map(function(input) {
    const name = String(input.name || '').trim();
    if (!name) throw new Error('メンバー名を入力してください。');
    const skill = String(input.skillLevel || ''); const exp = String(input.experienceLevel || '');
    return {
      memberId: input.memberId || 'member_' + Utilities.getUuid(), name: name, email: String(input.email || '').trim().toLowerCase(),
      team: String(input.team || ''), skillLevel: skill, experienceLevel: exp,
      speedCoefficient: toNumber_(input.speedCoefficient, coefficient_('skill', skill) * coefficient_('experience', exp)),
      compositeLevel: input.compositeLevel || (skill && exp ? skill + '-' + exp.replace('CSEG', '') : ''),
      role: input.role === 'admin' ? 'admin' : 'member', active: input.active !== false,
      updatedAt: nowIso_(), updatedBy: user.email
    };
  });
  upsertRows_('Members', rows, ['memberId']);
  return { ok: true };
}

function nonNegative_(value) {
  const n = toNumber_(value, 0);
  if (n < 0) throw new Error('0以上の数値を入力してください。');
  return n;
}
