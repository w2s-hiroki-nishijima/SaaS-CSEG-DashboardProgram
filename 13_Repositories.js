/**
 * Repository layer.
 *
 * Spreadsheet-specific reads and writes are kept behind these classes so that
 * application services do not depend on sheet layouts or SpreadsheetApp.
 */
class SheetTableRepository {
  constructor(sheetName, keyFields) {
    this.sheetName = sheetName;
    this.keyFields = keyFields || [];
  }

  all() {
    return readRows_(this.sheetName);
  }

  save(rows) {
    upsertRows_(this.sheetName, rows, this.keyFields);
    return rows;
  }
}

class FeedbackRepository {
  constructor() {
    this.reports = new SheetTableRepository('FeedbackReports', ['reportId']);
    this.comments = new SheetTableRepository('FeedbackComments', ['commentId']);
  }

  findReport(reportId) {
    return this.reports.all().find(function(row) {
      return String(row.reportId) === String(reportId);
    }) || null;
  }

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

  saveReport(report) {
    this.reports.save([report.toRow ? report.toRow() : report]);
  }

  saveComment(comment) {
    this.comments.save([comment]);
  }
}

class AssignmentRepository {
  listByMonth(month) {
    return readMonthlyAssignmentRows_(monthKey_(month));
  }

  saveActual(entity) {
    return saveMonthlyAssignmentActual_(entity.month, entity);
  }
}

class TargetRepository {
  listByMonth(month) {
    return readMonthlyTargetRows_(monthKey_(month));
  }
}

class MemberRepository {
  listActiveByMonth(month) {
    return getMembersForMonth_(monthKey_(month));
  }

  listAll() {
    return readRows_('Members');
  }

  save(rows) {
    upsertRows_('Members', rows, ['memberId']);
  }

  saveMonthlyTeams(month, rows) {
    saveMonthlyTeamMembership_(month, rows);
  }
}

class SkillRepository {
  constructor() {
    this.master = new SheetTableRepository('SkillMaster', ['skillId']);
    this.scores = new SheetTableRepository('SkillScores', ['scoreId']);
    this.members = new MemberRepository();
  }

  findMember(memberId) {
    return this.members.listAll().find(function(row) {
      return String(row.memberId) === String(memberId);
    }) || null;
  }

  findSkill(skillId) {
    return this.master.all().find(function(row) {
      return String(row.skillId) === String(skillId);
    }) || null;
  }
}

class NotificationRuleRepository extends SheetTableRepository {
  constructor() {
    super('NotificationRules', ['ruleId']);
  }
}

class SettingsRepository {
  saveRuntimeConfig(input, actor) {
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
    appendRows_('Settings', [{
      key: 'LAST_SETTINGS_UPDATE',
      value: nowIso_(),
      description: '設定画面の最終更新',
      updatedAt: nowIso_(),
      updatedBy: actor.email
    }]);
  }
}
