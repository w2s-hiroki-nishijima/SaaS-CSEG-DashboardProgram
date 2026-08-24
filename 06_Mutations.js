/** 画面から呼ばれる更新系RPCとして認証を行い、Application Serviceへ処理を委譲する。 */
/** 改善要望・不具合報告を新規登録する。 */
function submitFeedbackReport(input) {
  const user = assertAuthorizedUser_();
  getApplicationServices_().feedback.submit(input, user);
  return { ok: true, view: buildFeedbackData_(user) };
}

/** 既存の改善要望・不具合報告へコメントを追加する。 */
function addFeedbackComment(input) {
  const user = assertAuthorizedUser_();
  getApplicationServices_().feedback.comment(input, user);
  return { ok: true, view: buildFeedbackData_(user) };
}

/** 改善要望・不具合報告のステータスを変更する。 */
function updateFeedbackStatus(input) {
  const user = assertAuthorizedUser_();
  getApplicationServices_().feedback.changeStatus(input, user);
  return { ok: true, view: buildFeedbackData_(user) };
}

/** 画面からの目標直接更新を禁止し、正データが外部シートであることを通知する。 */
function saveMonthlyTargets(payload) {
  assertAdmin_();
  throw new Error('目標件数はアサイン活用報告シートから自動計算されるため、管理画面からは変更できません。');
}

/** 本人または管理者の月別アサイン実績を外部ブックへ保存する。 */
function saveAssignmentEntry(input) {
  if (!input || !input.memberId) throw new Error('メンバーを選択してください。');
  const user = assertMemberWrite_(input.memberId);
  const assignmentService = getApplicationServices_().assignment;
  const saved = assignmentService.save(input);
  return { ok: true, updatedBy: user.email, view: assignmentService.getView(saved.month, user) };
}

/** 本人または管理者のスキルレベルと評価ポイントを保存する。 */
function saveSkillScore(input) {
  if (!input || !input.memberId || !input.skillId) throw new Error('メンバーとスキルを選択してください。');
  const user = assertMemberWrite_(input.memberId);
  const row = getApplicationServices_().skill.saveScore(input, user);
  return { ok: true, score: row };
}

/** 管理者がスキル定義を新規作成または更新する。 */
function saveSkillMaster(input) {
  const user = assertAdmin_();
  const row = getApplicationServices_().skill.saveDefinition(input, user);
  return { ok: true, skill: row };
}

/** 管理者が通知条件、スケジュール、送信先を保存する。 */
function saveNotificationRule(input) {
  const user = assertAdmin_();
  const row = getApplicationServices_().notification.save(input, user);
  return { ok: true, rule: row };
}

/** 管理者が環境設定をScript Propertiesへ保存する。 */
function saveAppSettings(input) {
  const user = assertAdmin_();
  getApplicationServices_().settings.save(input, user);
  return { ok: true };
}

/** 管理者が対象月の所属チームとメンバー設定をまとめて保存する。 */
function saveMonthlyMemberSettings(payload) {
  const user = assertAdmin_();
  const month = getApplicationServices_().member.saveMonthlySettings(payload, user);
  return { ok: true, settings: buildSettingsView_(month) };
}

/** 管理者がメンバーマスタを一括保存する互換RPC。 */
function saveMembers(inputRows) {
  const user = assertAdmin_();
  getApplicationServices_().member.saveMembers(inputRows, user);
  return { ok: true };
}

/** 時間入力を0以上の数値に制限する共通検証処理。 */
function nonNegative_(value) {
  const n = toNumber_(value, 0);
  if (n < 0) throw new Error('0以上の数値を入力してください。');
  return n;
}
