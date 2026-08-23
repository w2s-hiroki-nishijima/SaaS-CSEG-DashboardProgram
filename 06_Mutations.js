/** Validated writes from the web application. */
function saveMonthlyTargets(payload) {
  const user = assertAdmin_();
  if (!payload || !Array.isArray(payload.rows)) throw new Error('保存データが不正です。');
  const month = monthKey_(payload.month);
  const members = readRows_('Members');
  const rows = payload.rows.map(function(input) {
    const member = members.find(function(m) { return String(m.memberId) === String(input.memberId); });
    if (!member) throw new Error('メンバーが見つかりません: ' + input.memberId);
    const speed = toNumber_(member.speedCoefficient, calculateSpeed_(member));
    const assignment = nonNegative_(input.assignmentHours);
    const minus = nonNegative_(input.minusHours);
    const adjustment = nonNegative_(input.adjustmentHours);
    return {
      month: month, memberId: member.memberId, memberName: member.name, team: member.team,
      speedCoefficient: speed, assignmentHours: assignment, minusHours: minus, adjustmentHours: adjustment,
      supportHours: nonNegative_(input.supportHours),
      targetCount: round_(Math.max(0, speed * (assignment - minus - adjustment) / CSEG_APP.TARGET_BASE_HOURS), 1),
      updatedAt: nowIso_(), updatedBy: user.email
    };
  });
  const result = upsertRows_('MonthlyTargets', rows, ['month', 'memberId']);
  return { ok: true, result: result, view: buildTargetData_(month) };
}

function saveAssignmentEntry(input) {
  if (!input || !input.memberId) throw new Error('メンバーを選択してください。');
  const user = assertMemberWrite_(input.memberId);
  const member = readRows_('Members').find(function(m) { return String(m.memberId) === String(input.memberId); });
  if (!member) throw new Error('メンバーが見つかりません。');
  const weekStart = dateKey_(input.weekStart);
  if (!weekStart) throw new Error('週開始日を入力してください。');
  const entry = {
    entryId: input.entryId || Utilities.getUuid(), weekStart: weekStart, month: weekStart.slice(0, 7),
    memberId: member.memberId, memberName: member.name, team: member.team,
    responseHours: nonNegative_(input.responseHours), improvementHours: nonNegative_(input.improvementHours),
    specialHours: nonNegative_(input.specialHours), plannedHours: nonNegative_(input.plannedHours),
    adjustmentHours: nonNegative_(input.adjustmentHours), note: String(input.note || '').slice(0, 1000),
    updatedAt: nowIso_(), updatedBy: user.email
  };
  upsertRows_('AssignmentEntries', [entry], ['entryId']);
  return { ok: true, entry: entry };
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
  return { ok: true, settings: getSettingsView() };
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
