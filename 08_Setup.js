/** 初回導入時にシート、初期値、管理者、定期トリガーを設定する。 */
/** Apps Scriptエディタから実行し、アプリを利用可能な初期状態へ整える。 */
function setupApplication() {
  const props = PropertiesService.getScriptProperties();
  const email = getActiveEmail_();
  if (!email) throw new Error('GoogleアカウントでApps Scriptを開いて実行してください。');
  if (!props.getProperty('DATA_SPREADSHEET_ID') && CSEG_APP.DEFAULT_DATA_SPREADSHEET_ID.indexOf('__') !== 0) {
    props.setProperty('DATA_SPREADSHEET_ID', CSEG_APP.DEFAULT_DATA_SPREADSHEET_ID);
  }
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
  syncAuthorizedAccessFromMembers_();
  installTriggers_();
  scheduleAnalyticsRebuild_();
  return { ok: true, adminEmail: email, dataSpreadsheetId: getRuntimeConfig_().dataSpreadsheetId, analyticsCacheScheduled: true };
}

/** 既定管理者名のメンバーへ実行者メールと管理者権限を紐付ける。 */
function linkPrimaryAdminMember_(email) {
  const members = readRows_('Members');
  let target = members.find(function(m) { return m.name === CSEG_APP.DEFAULT_ADMIN_MEMBER_NAME; });
  if (!target) {
    target = { memberId: 'primary_admin', name: CSEG_APP.DEFAULT_ADMIN_MEMBER_NAME, team: 'エスカレBチーム', skillLevel: 'M', experienceLevel: 'CSEGD', speedCoefficient: 1, compositeLevel: 'M-D', active: true };
  }
  target.email = email; target.role = 'admin'; target.updatedAt = nowIso_(); target.updatedBy = email;
  upsertRows_('Members', [target], ['memberId']);
}

/** メンバー、目標係数、スキル、通知ルールの初期データを不足分だけ登録する。 */
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

/** 同期・通知などの既存重複トリガーを避けて定期トリガーを登録する。 */
function installTriggers_() {
  const handlers = ['runHourlyBacklogSync_', 'runNotificationJobs_', 'continueBacklogSync_', 'runMonthlyTeamSheetCreate_', 'syncAssignmentToMonthlyTeam'];
  ScriptApp.getProjectTriggers().forEach(function(trigger) {
    if (handlers.indexOf(trigger.getHandlerFunction()) >= 0) ScriptApp.deleteTrigger(trigger);
  });
  ScriptApp.newTrigger('runHourlyBacklogSync_').timeBased().everyHours(1).create();
  ScriptApp.newTrigger('runNotificationJobs_').timeBased().everyDays(1).atHour(9).create();
  ScriptApp.newTrigger('runMonthlyTeamSheetCreate_').timeBased().onMonthDay(1).atHour(8).create();
  ScriptApp.newTrigger('syncAssignmentToMonthlyTeam').timeBased().everyWeeks(1).onWeekDay(ScriptApp.WeekDay.FRIDAY).atHour(0).create();
}

/** 毎月1日に前月タブを複製して当月の所属チームシートを作成する。 */
function runMonthlyTeamSheetCreate_() {
  const ss = openSpreadsheetById_(CSEG_APP.MONTHLY_TEAM_SPREADSHEET_ID, '月別所属・目標ブック');
  const currentName = monthlyTeamSheetName_(new Date());
  if (ss.getSheetByName(currentName)) return;

  const prevDate = new Date();
  prevDate.setDate(1);
  prevDate.setMonth(prevDate.getMonth() - 1);
  const prevName = monthlyTeamSheetName_(prevDate);
  const prevSheet = ss.getSheetByName(prevName);
  if (!prevSheet) throw new Error(prevName + ' のシートが見つからないため ' + currentName + ' を作成できませんでした。');

  prevSheet.copyTo(ss).setName(currentName);
}

/** GASエディタから手動実行して当月の所属チームシートを作成する。 */
function createMonthlyTeamSheet() {
  runMonthlyTeamSheetCreate_();
}

/**
 * ASSIGNMENT_SPREADSHEET_IDの「yyyy年M月アサイン活用報告」シートを読み込み、
 * MONTHLY_TEAM_SPREADSHEET の対応月タブのE列・F列を更新する。
 * A列が一致する行に対して H列→E列、C+D列の合算→F列 を書き込む。
 */
function syncAssignmentToMonthlyTeam() {
  const srcSs = openSpreadsheetById_(CSEG_APP.ASSIGNMENT_SPREADSHEET_ID, 'アサイン元データ');
  const dstSs = openSpreadsheetById_(CSEG_APP.MONTHLY_TEAM_SPREADSHEET_ID, '月別所属・目標ブック');

  var updated = 0;
  srcSs.getSheets().forEach(function(srcSheet) {
    // 「yyyy年M月アサイン活用報告」形式のシートのみ対象
    var m = srcSheet.getName().match(/^(\d{4}年\d+月)アサイン活用報告$/);
    if (!m) return;

    var monthLabel = m[1]; // 例: "2026年9月"
    var dstSheet = dstSs.getSheetByName(monthLabel);
    if (!dstSheet) return;

    // アサイン元データを読み込む（2行目以降、A～D列）
    var srcLastRow = srcSheet.getLastRow();
    if (srcLastRow < 2) return;
    var srcData = srcSheet.getRange(2, 1, srcLastRow - 1, 8).getValues();

    // 書き込み先のA列をキーにしたマップを作成（2行目以降）
    var dstLastRow = dstSheet.getLastRow();
    if (dstLastRow < 2) return;
    var dstKeys = dstSheet.getRange(2, 1, dstLastRow - 1, 1).getValues();
    var dstKeyMap = {};
    dstKeys.forEach(function(row, i) {
      var key = String(row[0]).trim();
      if (key) dstKeyMap[key] = i + 2; // 実際の行番号（1始まり）
    });

    // A列が一致する行にE列・F列を書き込む
    srcData.forEach(function(row) {
      var key = String(row[0]).trim();
      if (!key || !(key in dstKeyMap)) return;
      var dstRow = dstKeyMap[key];
      var colH = row[7];
      var colCandD = (Number(row[2]) || 0) + (Number(row[3]) || 0);
      dstSheet.getRange(dstRow, 5).setValue(colH);   // E列
      dstSheet.getRange(dstRow, 6).setValue(colCandD); // F列
      updated++;
    });
  });

  return { ok: true, updatedRows: updated };
}
