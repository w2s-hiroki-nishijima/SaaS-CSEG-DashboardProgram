/** Application layer: use cases and view-model assembly. */
class FeedbackApplicationService {
  constructor(repository, clock, idFactory) {
    this.repository = repository;
    this.clock = clock;
    this.idFactory = idFactory;
  }

  getView(user) {
    const reports = this.repository.listReportsWithComments();
    reports.sort(function(a, b) {
      const aComplete = String(a.status) === '完了' ? 1 : 0;
      const bComplete = String(b.status) === '完了' ? 1 : 0;
      return aComplete - bComplete ||
        String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || ''));
    });
    return {
      user: user,
      types: CSEG_FEEDBACK.TYPES.slice(),
      statuses: CSEG_FEEDBACK.STATUSES.slice(),
      reports: reports
    };
  }

  submit(input, actor) {
    const report = FeedbackReportEntity.create(input, actor, this.clock, this.idFactory);
    this.repository.saveReport(report);
    return report.toRow();
  }

  comment(input, actor) {
    const reportId = String(input && input.reportId || '');
    if (!this.repository.findReport(reportId)) throw new DomainValidationError('対象の報告が見つかりません。');
    const comment = FeedbackCommentEntity.create(
      reportId,
      input && input.comment,
      actor,
      this.clock,
      this.idFactory
    );
    this.repository.saveComment(comment);
    return comment;
  }

  changeStatus(input, actor) {
    const report = this.repository.findReport(String(input && input.reportId || ''));
    if (!report) throw new DomainValidationError('対象の報告が見つかりません。');
    const entity = new FeedbackReportEntity(report);
    entity.changeStatus(String(input && input.status || ''), actor, this.clock);
    this.repository.saveReport(entity);
    return entity.toRow();
  }
}

class AssignmentApplicationService {
  constructor(repository) {
    this.repository = repository;
  }

  getView(month, user) {
    const targetMonth = monthKey_(month);
    const rows = this.repository.listByMonth(targetMonth);
    return {
      month: targetMonth,
      user: user,
      members: rows.map(function(row) {
        return { memberId: row.memberId, name: row.memberName, team: row.team };
      }),
      rows: rows,
      spreadsheetUrl: spreadsheetUrl_(CSEG_APP.ASSIGNMENT_SPREADSHEET_ID)
    };
  }

  save(input) {
    const entity = AssignmentActualEntity.fromInput(input);
    this.repository.saveActual(entity);
    return entity;
  }
}

class TargetApplicationService {
  constructor(repository) {
    this.repository = repository;
  }

  getTargets(month) {
    return this.repository.listByMonth(month);
  }

  getView(month) {
    const targetMonth = monthKey_(month);
    const rows = this.getTargets(targetMonth);
    return {
      month: targetMonth,
      baseHours: CSEG_APP.TARGET_BASE_HOURS,
      spreadsheetUrl: spreadsheetUrl_(CSEG_APP.MONTHLY_TEAM_SPREADSHEET_ID),
      assignmentSpreadsheetUrl: spreadsheetUrl_(CSEG_APP.ASSIGNMENT_SPREADSHEET_ID),
      rows: rows.map(function(row) {
        return {
          memberId: row.memberId,
          memberName: row.memberName,
          team: row.team,
          skillLevel: row.skillLevel,
          experienceLevel: row.experienceLevel,
          speedCoefficient: row.speedCoefficient,
          assignmentHours: row.assignmentHours,
          minusHours: row.minusHours,
          adjustmentHours: row.adjustmentHours,
          supportHours: 0,
          targetCount: round_(row.targetCount, 1)
        };
      })
    };
  }
}

class SkillApplicationService {
  constructor(repository, clock, idFactory) {
    this.repository = repository;
    this.clock = clock;
    this.idFactory = idFactory;
  }

  getView(user) {
    const master = this.repository.master.all().filter(function(row) {
      return toBoolean_(row.active);
    });
    master.sort(function(a, b) {
      return toNumber_(a.displayOrder) - toNumber_(b.displayOrder);
    });
    return {
      user: user,
      members: this.repository.members.listAll().filter(function(row) { return toBoolean_(row.active); }),
      skills: master,
      scores: this.repository.scores.all()
    };
  }

  saveScore(input, actor) {
    if (!input || !input.memberId || !input.skillId) {
      throw new DomainValidationError('メンバーとスキルを選択してください。');
    }
    const row = SkillScoreEntity.create(
      input,
      this.repository.findMember(input.memberId),
      this.repository.findSkill(input.skillId),
      actor,
      this.clock
    );
    this.repository.scores.save([row]);
    return row;
  }

  saveDefinition(input, actor) {
    const row = SkillDefinitionEntity.create(input, actor, this.clock, this.idFactory);
    this.repository.master.save([row]);
    return row;
  }
}

class NotificationApplicationService {
  constructor(repository, clock, idFactory) {
    this.repository = repository;
    this.clock = clock;
    this.idFactory = idFactory;
  }

  getView() {
    return { rules: this.repository.all() };
  }

  save(input, actor) {
    const row = NotificationRuleEntity.create(input, actor, this.clock, this.idFactory);
    this.repository.save([row]);
    return row;
  }
}

class SettingsApplicationService {
  constructor(repository) {
    this.repository = repository;
  }

  save(input, actor) {
    this.repository.saveRuntimeConfig(input || {}, actor);
  }
}

class MemberApplicationService {
  constructor(repository, clock, idFactory) {
    this.repository = repository;
    this.clock = clock;
    this.idFactory = idFactory;
  }

  saveMonthlySettings(payload, actor) {
    if (!payload || !Array.isArray(payload.rows)) throw new DomainValidationError('メンバーデータが不正です。');
    const month = monthKey_(payload.month);
    this.repository.saveMonthlyTeams(month, payload.rows);
    this.saveMembers(payload.rows, actor);
    return month;
  }

  saveMembers(inputRows, actor) {
    if (!Array.isArray(inputRows)) throw new DomainValidationError('メンバーデータが不正です。');
    const idFactory = this.idFactory;
    const clock = this.clock;
    const rows = inputRows.map(function(input) {
      const name = String(input.name || '').trim();
      if (!name) throw new DomainValidationError('メンバー名を入力してください。');
      const skill = String(input.skillLevel || '');
      const experience = String(input.experienceLevel || '');
      return {
        memberId: input.memberId || 'member_' + idFactory(),
        name: name,
        email: String(input.email || '').trim().toLowerCase(),
        team: String(input.team || ''),
        skillLevel: skill,
        experienceLevel: experience,
        speedCoefficient: toNumber_(input.speedCoefficient, coefficient_('skill', skill) * coefficient_('experience', experience)),
        compositeLevel: input.compositeLevel || (skill && experience ? skill + '-' + experience.replace('CSEG', '') : ''),
        role: input.role === 'admin' ? 'admin' : 'member',
        active: input.active !== false,
        updatedAt: clock(),
        updatedBy: actor.email
      };
    });
    this.repository.save(rows);
    return rows;
  }
}

class PageQueryService {
  constructor(services) {
    this.services = services;
  }

  get(page, month, user) {
    const queries = {
      dashboard: function() { return buildDashboardData_(month); },
      performance: function() { return buildPerformanceData_(month); },
      skills: () => this.services.skill.getView(user),
      assignments: () => this.services.assignment.getView(month, user),
      targets: () => this.services.target.getView(month),
      aggregate: function() { return buildAggregateData_(month); },
      notifications: () => this.services.notification.getView(),
      settings: function() { return buildSettingsView_(month); },
      feedback: () => this.services.feedback.getView(user)
    };
    return (queries[page] || queries.dashboard)();
  }
}

let applicationServicesMemo_ = null;

function getApplicationServices_() {
  if (applicationServicesMemo_) return applicationServicesMemo_;
  const idFactory = function() { return Utilities.getUuid(); };
  const services = {
    feedback: new FeedbackApplicationService(
      new FeedbackRepository(),
      nowIso_,
      idFactory
    ),
    assignment: new AssignmentApplicationService(new AssignmentRepository()),
    target: new TargetApplicationService(new TargetRepository()),
    skill: new SkillApplicationService(new SkillRepository(), nowIso_, idFactory),
    notification: new NotificationApplicationService(new NotificationRuleRepository(), nowIso_, idFactory),
    settings: new SettingsApplicationService(new SettingsRepository()),
    member: new MemberApplicationService(new MemberRepository(), nowIso_, idFactory)
  };
  services.pages = new PageQueryService(services);
  applicationServicesMemo_ = services;
  return services;
}

function spreadsheetUrl_(spreadsheetId) {
  return 'https://docs.google.com/spreadsheets/d/' + spreadsheetId + '/edit';
}
