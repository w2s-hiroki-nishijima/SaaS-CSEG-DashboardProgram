/** Validated writes from the web application. */
function submitFeedbackReport(input) {
  const user = assertDomainUser_();
  getApplicationServices_().feedback.submit(input, user);
  return { ok: true, view: buildFeedbackData_(user) };
}

function addFeedbackComment(input) {
  const user = assertDomainUser_();
  getApplicationServices_().feedback.comment(input, user);
  return { ok: true, view: buildFeedbackData_(user) };
}

function updateFeedbackStatus(input) {
  const user = assertDomainUser_();
  getApplicationServices_().feedback.changeStatus(input, user);
  return { ok: true, view: buildFeedbackData_(user) };
}

function saveMonthlyTargets(payload) {
  assertAdmin_();
  throw new Error('目標件数はアサイン活用報告シートから自動計算されるため、管理画面からは変更できません。');
}

function saveAssignmentEntry(input) {
  if (!input || !input.memberId) throw new Error('メンバーを選択してください。');
  const user = assertMemberWrite_(input.memberId);
  const assignmentService = getApplicationServices_().assignment;
  const saved = assignmentService.save(input);
  return { ok: true, updatedBy: user.email, view: assignmentService.getView(saved.month, user) };
}

function saveSkillScore(input) {
  if (!input || !input.memberId || !input.skillId) throw new Error('メンバーとスキルを選択してください。');
  const user = assertMemberWrite_(input.memberId);
  const row = getApplicationServices_().skill.saveScore(input, user);
  return { ok: true, score: row };
}

function saveSkillMaster(input) {
  const user = assertAdmin_();
  const row = getApplicationServices_().skill.saveDefinition(input, user);
  return { ok: true, skill: row };
}

function saveNotificationRule(input) {
  const user = assertAdmin_();
  const row = getApplicationServices_().notification.save(input, user);
  return { ok: true, rule: row };
}

function saveAppSettings(input) {
  const user = assertAdmin_();
  getApplicationServices_().settings.save(input, user);
  return { ok: true };
}

function saveMonthlyMemberSettings(payload) {
  const user = assertAdmin_();
  const month = getApplicationServices_().member.saveMonthlySettings(payload, user);
  return { ok: true, settings: buildSettingsView_(month) };
}

function saveMembers(inputRows) {
  const user = assertAdmin_();
  getApplicationServices_().member.saveMembers(inputRows, user);
  return { ok: true };
}

function nonNegative_(value) {
  const n = toNumber_(value, 0);
  if (n < 0) throw new Error('0以上の数値を入力してください。');
  return n;
}
