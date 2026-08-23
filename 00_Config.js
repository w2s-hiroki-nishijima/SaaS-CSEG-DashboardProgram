/** CSEG Dashboard configuration and storage schema. */
const CSEG_APP = Object.freeze({
  NAME: 'CSEG Dashboard',
  VERSION: '2.0.0',
  TIMEZONE: 'Asia/Tokyo',
  ALLOWED_DOMAIN: 'w2solution.co.jp',
  DEFAULT_DATA_SPREADSHEET_ID: '1nWxKowOvJeOzz1HFzyhieTvcapMn3UXl5ZDTcWyYRiY',
  MONTHLY_TEAM_SPREADSHEET_ID: '1vS10vT-clLJFskKrNNox4pE8ROtwnaFoIm5MDThnkv4',
  ASSIGNMENT_SPREADSHEET_ID: '1Dy6dgPXH7Jnrhssa4TdgJ62ASMwaUC6gHW2xiW5-cEI',
  DEFAULT_ADMIN_MEMBER_NAME: '西島弘騎',
  CLOSED_STATUS_NAMES: ['完了', '処理済み', 'Closed', 'Done', 'Resolved'],
  BACKLOG_PAGE_SIZE: 100,
  SYNC_MAX_MILLIS: 4.5 * 60 * 1000,
  SYNC_OVERLAP_MINUTES: 5,
  CACHE_SECONDS: 300,
  TARGET_BASE_HOURS: 5.5,
  CUSTOM_FIELDS: {
    caseType: ['【CS】案件タイプ', '案件タイプ'],
    environment: ['環境'],
    csegOwner: ['SaaS-CSEG主担当', 'CSEG主担当', 'CSEG担当者'],
    team: ['担当チーム(SaaS)', '担当チーム（SaaS）', 'チーム', '担当チーム'],
    issueSize: ['チケットサイズ', '規模', 'サイズ'],
    csTicketContentRating: ['CS起票内容評価'],
    ratingReasonCsegToCs: ['評価理由(CSEGからCS)', '評価理由（CSEGからCS）'],
    qualityScore: ['【CS】評価（質）', '【CS】評価(質)', 'CSEG品質', '品質評価', 'CS評価'],
    csQualityReasonCsToCseg: ['【CS】評価理由(CSからCSEG)', '【CS】評価理由（CSからCSEG）'],
    waitingFlag: ['待ちフラグ', '待機フラグ', '待機'],
    escalationCategory: ['エスカレ分類'],
    dueDateRequiredFlag: ['【CS】期日マストフラグ'],
    emergencyFlag: ['緊急募集フラグ', '緊急フラグ', '緊急対応'],
    rollbackFlag: ['差し戻しフラグ', '差し戻し'],
    completionStatus: ['完了区分', '完了ステータス'],
    completedDate: ['【CS】完了日', '完了日', '対応完了日']
  },
  POINTS_BY_SIZE: {
    '極小': 0.25,
    '小': 0.5,
    '中': 1,
    '大': 1.5,
    '特大': 2,
    '最大': 2.5
  },
  EMERGENCY_BONUS: 0.5,
  CUSTOM_FIELDS: {
  caseType: [
    '【CS】案件タイプ',
    '案件タイプ'
  ],

  environment: [
    '【CS】環境',
    '環境'
  ],

  csegOwner: [
    'SaaS-CSEG主担当',
    'CSEG主担当',
    'CSEG担当者'
  ],

  team: [
    '担当チーム(SaaS)',
    '担当チーム（SaaS）',
    'チーム',
    '担当チーム'
  ],

  issueSize: [
    'チケットサイズ',
    '規模',
    'サイズ'
  ],

  csTicketContentRating: [
    'CS起票内容評価'
  ],

  ratingReasonCsegToCs: [
    '評価理由(CSEGからCS)',
    '評価理由（CSEGからCS）'
  ],

  qualityScore: [
    '【CS】評価（質）',
    '【CS】評価(質)',
    'CSEG品質',
    '品質評価',
    'CS評価'
  ],

  csQualityReasonCsToCseg: [
    '【CS】評価理由(CSからCSEG)',
    '【CS】評価理由（CSからCSEG）'
  ],

  completedDate: [
    '【CS】完了日',
    '完了日',
    '対応完了日'
  ],

  waitingFlag: [
    '待ちフラグ',
    '待機フラグ',
    '待機'
  ],

  escalationCategory: [
    'エスカレ分類'
  ],

  dueDateRequiredFlag: [
    '【CS】期日マストフラグ'
  ],

  emergencyFlag: [
    '緊急募集フラグ',
    '緊急フラグ',
    '緊急対応'
  ],

  rollbackFlag: [
    'エスカレーション差し戻しフラグ',
    '差し戻しフラグ',
    '差し戻し'
  ],

  completionStatus: [
    '完了区分',
    '完了ステータス'
  ]
},
});

const CSEG_SHEETS = Object.freeze({
  Members: ['memberId', 'name', 'email', 'team', 'skillLevel', 'experienceLevel', 'speedCoefficient', 'compositeLevel', 'role', 'active', 'updatedAt', 'updatedBy'],
  TargetCoefficients: ['kind', 'code', 'label', 'coefficient', 'description', 'active'],
  MonthlyTargets: ['month', 'memberId', 'memberName', 'team', 'speedCoefficient', 'assignmentHours', 'minusHours', 'adjustmentHours', 'supportHours', 'targetCount', 'updatedAt', 'updatedBy'],
  BacklogIssues: [
  'summary',
  'issueKey',
  'status',
  'issueType',
  'assigneeName',
  'priority',
  'milestone',
  'startDate',
  'dueDate',
  'actualHours',
  'caseType',
  'csegOwner',
  'team',
  'csTicketContentRating',
  'ratingReasonCsegToCs',
  'qualityScore',
  'csQualityReasonCsToCseg',
  'closedAt',
  'waitingFlag',
  'escalationCategory',
  'dueDateRequiredFlag',
  'emergencyFlag',
  'issueId',
  'projectId',
  'projectKey',
  'createdAt',
  'updatedAt',
  'statusId',
  'assigneeId',
  'reporterName',
  'resolution',
  'category',
  'environment',
  'issueSize',
  'rollbackFlag',
  'completionStatus',
  'tatBusinessDays',
  'point',
  'url',
  'customFieldsJson',
  'syncedAt'
  ],
  AssignmentEntries: ['entryId', 'weekStart', 'month', 'memberId', 'memberName', 'team', 'responseHours', 'improvementHours', 'specialHours', 'plannedHours', 'adjustmentHours', 'note', 'updatedAt', 'updatedBy'],
  SkillMaster: ['skillId', 'category', 'skillName', 'description', 'maxLevel', 'pointsPerLevel', 'active', 'displayOrder', 'updatedAt', 'updatedBy'],
  SkillScores: ['scoreId', 'memberId', 'memberName', 'skillId', 'skillName', 'level', 'points', 'note', 'updatedAt', 'updatedBy'],
  NotificationRules: ['ruleId', 'name', 'type', 'enabled', 'schedule', 'dayOfWeek', 'sendTime', 'channel', 'recipients', 'message', 'lastRunAt', 'updatedAt', 'updatedBy'],
  Holidays: ['date', 'name'],
  Settings: ['key', 'value', 'description', 'updatedAt', 'updatedBy'],
  SyncLog: ['syncId', 'startedAt', 'finishedAt', 'mode', 'status', 'fetchedCount', 'insertedCount', 'updatedCount', 'message'],
  AnalyticsCache: ['cacheKey', 'payloadJson', 'sourceUpdatedAt', 'updatedAt'],
  PerformanceIssues: ['month', 'memberName', 'sourceTeam', 'issueKey', 'summary', 'milestone', 'point', 'emergencyFlag', 'tatBusinessDays', 'url'],
  PerformanceIssueIndex: ['indexKey', 'month', 'memberName', 'startRow', 'rowCount', 'updatedAt']
});

const CSEG_SHEET_HEADERS = Object.freeze({
  BacklogIssues: [
    '案件名',
    'キー',
    '状態',
    '種別',
    '担当者',
    '優先度',
    'マイルストーン',
    '開始日',
    '期限日',
    '実績時間',
    '【CS】案件タイプ',
    'SaaS-CSEG主担当',
    '担当チーム(SaaS)',
    'CS起票内容評価',
    '評価理由(CSEGからCS)',
    '【CS】評価（質）',
    '【CS】評価理由(CSからCSEG)',
    '【CS】完了日',
    '待ちフラグ',
    'エスカレ分類',
    '【CS】期日マストフラグ',
    '緊急募集フラグ',
    '課題ID',
    'プロジェクトID',
    'プロジェクトキー',
    '作成日',
    '更新日',
    '状態ID',
    '担当者ID',
    '起票者',
    '完了理由',
    'カテゴリー',
    '環境',
    'チケットサイズ',
    '差し戻しフラグ',
    '完了区分',
    'TAT（営業日）',
    'ポイント',
    'Backlog URL',
    'カスタム項目元データ(JSON)',
    '同期日時'
  ]
});

function sheetHeaderLabels_(sheetName) {
  return CSEG_SHEET_HEADERS[sheetName] || CSEG_SHEETS[sheetName];
}

let _runtimeConfigMemo_ = null;

function getRuntimeConfig_() {
  if (_runtimeConfigMemo_) return _runtimeConfigMemo_;
  const props = PropertiesService.getScriptProperties();
  _runtimeConfigMemo_ = {
    dataSpreadsheetId: props.getProperty('DATA_SPREADSHEET_ID') || CSEG_APP.DEFAULT_DATA_SPREADSHEET_ID,
    allowedDomain: props.getProperty('ALLOWED_DOMAIN') || CSEG_APP.ALLOWED_DOMAIN,
    adminEmails: splitCsv_(props.getProperty('ADMIN_EMAILS')),
    adminGroupEmail: props.getProperty('ADMIN_GROUP_EMAIL') || '',
    backlogSpaceUrl: String(props.getProperty('BACKLOG_SPACE_URL') || '').replace(/\/$/, ''),
    backlogApiKey: props.getProperty('BACKLOG_API_KEY') || '',
    backlogProjectKeys: splitCsv_(props.getProperty('BACKLOG_PROJECT_KEYS')),
    slackWebhookUrl: props.getProperty('SLACK_WEBHOOK_URL') || '',
    termStartDate: props.getProperty('TERM_START_DATE') || '2026-07-01'
  };
  return _runtimeConfigMemo_;
}

function clearRuntimeConfigMemo_() {
  _runtimeConfigMemo_ = null;
}

function splitCsv_(value) {
  return String(value || '').split(',').map(function(v) { return v.trim(); }).filter(Boolean);
}

function nowIso_() {
  return Utilities.formatDate(new Date(), CSEG_APP.TIMEZONE, "yyyy-MM-dd'T'HH:mm:ssXXX");
}

function dateKey_(value) {
  if (!value) return '';
  const d = value instanceof Date ? value : new Date(value);
  return isNaN(d.getTime()) ? '' : Utilities.formatDate(d, CSEG_APP.TIMEZONE, 'yyyy-MM-dd');
}

function monthKey_(value) {
  if (!value) return Utilities.formatDate(new Date(), CSEG_APP.TIMEZONE, 'yyyy-MM');
  if (/^\d{4}-\d{2}$/.test(String(value))) return String(value);
  const d = value instanceof Date ? value : new Date(value);
  if (isNaN(d.getTime())) throw new Error('月の形式が不正です。');
  return Utilities.formatDate(d, CSEG_APP.TIMEZONE, 'yyyy-MM');
}

function toNumber_(value, fallback) {
  const n = Number(value);
  return isFinite(n) ? n : (fallback == null ? 0 : fallback);
}

function optionalNumber_(value) {
  if (value == null || value === '') return '';
  const n = Number(value);
  return isFinite(n) ? n : '';
}

/** Resolves the response point from a Backlog milestone such as SaaS:大(5h). */
function milestonePoint_(value) {
  const milestone = String(value || '').trim();
  if (!milestone) return 1;
  const matched = milestone.split(/[,、，\n\r]+/).map(function(item) {
    const match = item.trim().match(/(?:^|[:：])\s*(最大|特大|極小|大|中|小)(?:\s*\([^)]*\))?\s*$/);
    return match ? match[1] : '';
  }).filter(Boolean);
  if (!matched.length) return 1;
  return matched.reduce(function(max, size) {
    return Math.max(max, toNumber_(CSEG_APP.POINTS_BY_SIZE[size], 1));
  }, 0);
}

function toBoolean_(value) {
  if (value === true || value === 1) return true;
  const normalized = String(value == null ? '' : value)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '');
  return ['true', '1', 'yes', 'on', '有', 'あり', '対象', '〇', '○'].indexOf(normalized) >= 0;
}
