/**
 * シート固有の読書きをリポジトリへ閉じ込め、Application Serviceが
 * シート名・列位置・SpreadsheetAppへ直接依存しないようにする。
 */
/** 同じキー構成を持つアプリ内部シートの共通リポジトリ。 */
class SheetTableRepository {
  /** 対象シート名と更新判定に使うキー列を受け取る。 */
  constructor(sheetName, keyFields) {
    this.sheetName = sheetName;
    this.keyFields = keyFields || [];
  }

  /** 対象シートの全行をオブジェクト配列として返す。 */
  all() {
    return readRows_(this.sheetName);
  }

  /** キー列を使って複数行を追加または更新する。 */
  save(rows) {
    upsertRows_(this.sheetName, rows, this.keyFields);
    return rows;
  }
}

/** 改善要望本体とコメントの保存・結合を担当する。 */
class FeedbackRepository {
  /** 報告用とコメント用のシートリポジトリを初期化する。 */
  constructor() {
    this.reports = new SheetTableRepository('FeedbackReports', ['reportId']);
    this.comments = new SheetTableRepository('FeedbackComments', ['commentId']);
  }

  /** 報告IDに一致する報告を検索する。 */
  findReport(reportId) {
    return this.reports.all().find(function(row) {
      return String(row.reportId) === String(reportId);
    }) || null;
  }

  /** 全報告へ時系列順のコメント配列を結合して返す。 */
  listReportsWithComments() {
    const commentsByReport = {};
    this.comments.all().forEach(function(comment) {
      const reportId = String(comment.reportId || '');
      if (!commentsByReport[reportId]) commentsByReport[reportId] = [];
      commentsByReport[reportId].push(comment);
    });
    Object.keys(commentsByReport).forEach(function(reportId) {
      commentsByReport[reportId].sort(function(a, b) {
        return String(a.createdAt || '').localeCompare(String(b.createdAt || ''));
      });
    });
    return this.reports.all().map(function(report) {
      const result = Object.assign({}, report);
      result.comments = commentsByReport[String(report.reportId || '')] || [];
      return result;
    });
  }

  /** 報告エンティティまたは行オブジェクトを保存する。 */
  saveReport(report) {
    this.reports.save([report.toRow ? report.toRow() : report]);
  }

  /** 新規コメントをコメントシートへ保存する。 */
  saveComment(comment) {
    this.comments.save([comment]);
  }
}

/** 外部アサイン活用報告ブックへのアクセスを担当する。 */
class AssignmentRepository {
  /** 指定月の予定・実績アサイン一覧を取得する。 */
  listByMonth(month) {
    return readMonthlyAssignmentRows_(monthKey_(month));
  }

  /** 検証済みの月別実績時間を保存する。 */
  saveActual(entity) {
    return saveMonthlyAssignmentActual_(entity.month, entity);
  }
}

/** 外部月別所属・目標ブックへのアクセスを担当する。 */
class TargetRepository {
  /** 指定月の目標スナップショット一覧を取得する。 */
  listByMonth(month) {
    return readMonthlyTargetRows_(monthKey_(month));
  }
}

/** メンバーマスタと月別所属の保存・取得を担当する。 */
class MemberRepository {
  /** 有効メンバーへ指定月の所属チームを適用して返す。 */
  listActiveByMonth(month) {
    return getMembersForMonth_(monthKey_(month));
  }

  /** メンバーマスタの全行を返す。 */
  listAll() {
    return readRows_('Members');
  }

  /** メンバーIDをキーにメンバーマスタを保存する。 */
  save(rows) {
    upsertRows_('Members', rows, ['memberId']);
    syncAuthorizedAccessFromMembers_();
  }

  /** 指定月の所属チームを外部月別ブックへ保存する。 */
  saveMonthlyTeams(month, rows) {
    saveMonthlyTeamMembership_(month, rows);
  }
}

/** スキルマスタ、スコア、対象メンバーの検索を担当する。 */
class SkillRepository {
  /** スキル関連の各シートリポジトリを初期化する。 */
  constructor() {
    this.master = new SheetTableRepository('SkillMaster', ['skillId']);
    this.scores = new SheetTableRepository('SkillScores', ['scoreId']);
    this.members = new MemberRepository();
  }

  /** メンバーIDに一致するメンバーを検索する。 */
  findMember(memberId) {
    return this.members.listAll().find(function(row) {
      return String(row.memberId) === String(memberId);
    }) || null;
  }

  /** スキルIDに一致するスキル定義を検索する。 */
  findSkill(skillId) {
    return this.master.all().find(function(row) {
      return String(row.skillId) === String(skillId);
    }) || null;
  }
}

/** NotificationRules専用のキー設定済みリポジトリ。 */
class NotificationRuleRepository extends SheetTableRepository {
  /** 通知ルールIDを更新キーとして初期化する。 */
  constructor() {
    super('NotificationRules', ['ruleId']);
  }
}

/** Script Propertiesと設定変更履歴の保存を担当する。 */
class SettingsRepository {
  /** 画面入力を環境設定へ反映し、設定変更日時を履歴へ記録する。 */
  saveRuntimeConfig(input, actor) {
    const props = PropertiesService.getScriptProperties();
    props.setProperty('ADMIN_EMAILS', String(input.adminEmails || '').trim().toLowerCase());
    props.setProperty('ADMIN_GROUP_EMAIL', String(input.adminGroupEmail || '').trim().toLowerCase());
    props.setProperty('GOOGLE_IDENTITY_CLIENT_ID', String(input.googleIdentityClientId || '').trim());
    if (String(input.googleIdentityClientSecret || '').trim()) {
      props.setProperty('GOOGLE_IDENTITY_CLIENT_SECRET', String(input.googleIdentityClientSecret).trim());
    }
    props.setProperty('BACKLOG_SPACE_URL', String(input.backlogSpaceUrl || '').trim().replace(/\/$/, ''));
    props.setProperty('BACKLOG_PROJECT_KEYS', String(input.backlogProjectKeys || '').trim());
    if (String(input.backlogApiKey || '').trim()) props.setProperty('BACKLOG_API_KEY', String(input.backlogApiKey).trim());
    if (String(input.slackWebhookUrl || '').trim()) props.setProperty('SLACK_WEBHOOK_URL', String(input.slackWebhookUrl).trim());
    if (input.termStartDate) props.setProperty('TERM_START_DATE', dateKey_(input.termStartDate));
    clearRuntimeConfigMemo_();
    syncAuthorizedAccessFromMembers_();
    appendRows_('Settings', [{
      key: 'LAST_SETTINGS_UPDATE',
      value: nowIso_(),
      description: '設定画面の最終更新',
      updatedAt: nowIso_(),
      updatedBy: actor.email
    }]);
  }
}
