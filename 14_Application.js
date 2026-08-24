/** 認証後のユースケース実行手順と、画面へ返すViewModelの組み立てを担当する。 */
/** 改善要望・不具合報告の一覧、投稿、コメント、状態変更を扱う。 */
class FeedbackApplicationService {
  /** 保存先、時計、ID生成処理を外部から受け取りテスト可能にする。 */
  constructor(repository, clock, idFactory) {
    this.repository = repository;
    this.clock = clock;
    this.idFactory = idFactory;
  }

  /** 未完了を先頭に並べた報告・コメント一覧を画面用に返す。 */
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

  /** 入力から新規報告を生成して保存する。 */
  submit(input, actor) {
    const report = FeedbackReportEntity.create(input, actor, this.clock, this.idFactory);
    this.repository.saveReport(report);
    return report.toRow();
  }

  /** 対象報告の存在を確認し、コメントを追加する。 */
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

  /** 対象報告を復元し、ドメインルールに従ってステータスを変更する。 */
  changeStatus(input, actor) {
    const report = this.repository.findReport(String(input && input.reportId || ''));
    if (!report) throw new DomainValidationError('対象の報告が見つかりません。');
    const entity = new FeedbackReportEntity(report);
    entity.changeStatus(String(input && input.status || ''), actor, this.clock);
    this.repository.saveReport(entity);
    return entity.toRow();
  }
}

/** 月別アサインの表示と実績保存ユースケースを扱う。 */
class AssignmentApplicationService {
  /** アサイン保存先を受け取る。 */
  constructor(repository) {
    this.repository = repository;
  }

  /** 指定月のメンバー候補と予定・実績行を画面用に組み立てる。 */
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

  /** 画面入力をドメインで検証し、外部アサインブックへ保存する。 */
  save(input) {
    const entity = AssignmentActualEntity.fromInput(input);
    this.repository.saveActual(entity);
    return entity;
  }
}

/** 月別目標スナップショットの取得と画面表示を扱う。 */
class TargetApplicationService {
  /** 目標データの保存先を受け取る。 */
  constructor(repository) {
    this.repository = repository;
  }

  /** 指定月の目標行をリポジトリから取得する。 */
  getTargets(month) {
    return this.repository.listByMonth(month);
  }

  /** 目標行と参照スプレッドシートURLを画面用にまとめる。 */
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

/** スキル一覧表示、メンバースコア、スキル定義の保存を扱う。 */
class SkillApplicationService {
  /** 保存先、時計、ID生成処理を受け取る。 */
  constructor(repository, clock, idFactory) {
    this.repository = repository;
    this.clock = clock;
    this.idFactory = idFactory;
  }

  /** 有効スキルを表示順に並べ、メンバーとスコアをまとめて返す。 */
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

  /** 対象メンバーとスキルを確認し、検証済みスコアを保存する。 */
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

  /** スキル定義を検証して新規作成または更新する。 */
  saveDefinition(input, actor) {
    const row = SkillDefinitionEntity.create(input, actor, this.clock, this.idFactory);
    this.repository.master.save([row]);
    return row;
  }
}

/** 通知ルールの一覧表示と保存ユースケースを扱う。 */
class NotificationApplicationService {
  /** 保存先、時計、ID生成処理を受け取る。 */
  constructor(repository, clock, idFactory) {
    this.repository = repository;
    this.clock = clock;
    this.idFactory = idFactory;
  }

  /** 全通知ルールを画面用オブジェクトで返す。 */
  getView() {
    return { rules: this.repository.all() };
  }

  /** 通知ルールをドメインで検証して保存する。 */
  save(input, actor) {
    const row = NotificationRuleEntity.create(input, actor, this.clock, this.idFactory);
    this.repository.save([row]);
    return row;
  }
}

/** アプリ環境設定の保存ユースケースを扱う。 */
class SettingsApplicationService {
  /** 設定保存先を受け取る。 */
  constructor(repository) {
    this.repository = repository;
  }

  /** 設定入力をリポジトリへ渡し、Script Propertiesへ反映する。 */
  save(input, actor) {
    this.repository.saveRuntimeConfig(input || {}, actor);
  }
}

/** メンバーマスタと月別所属の一括保存を扱う。 */
class MemberApplicationService {
  /** 保存先、時計、ID生成処理を受け取る。 */
  constructor(repository, clock, idFactory) {
    this.repository = repository;
    this.clock = clock;
    this.idFactory = idFactory;
  }

  /** 指定月の所属チームを保存してから、対応するメンバーマスタも更新する。 */
  saveMonthlySettings(payload, actor) {
    if (!payload || !Array.isArray(payload.rows)) throw new DomainValidationError('メンバーデータが不正です。');
    const month = monthKey_(payload.month);
    this.repository.saveMonthlyTeams(month, payload.rows);
    this.saveMembers(payload.rows, actor);
    return month;
  }

  /** メンバー入力を検証・正規化し、速度係数と複合レベルを補完して保存する。 */
  saveMembers(inputRows, actor) {
    if (!Array.isArray(inputRows)) throw new DomainValidationError('メンバーデータが不正です。');
    const idFactory = this.idFactory;
    const clock = this.clock;
    const rows = inputRows.map(function(input) {
      const name = String(input.name || '').trim();
      if (!name) throw new DomainValidationError('メンバー名を入力してください。');
      const skill = String(input.skillLevel || '');
      const experience = String(input.experienceLevel || '');
      const email = String(input.email || '').trim().toLowerCase();
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        throw new DomainValidationError(name + 'のメールアドレス形式が不正です。');
      }
      return {
        memberId: input.memberId || 'member_' + idFactory(),
        name: name,
        email: email,
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

/** ページIDから対応する読取ユースケースを選択するルーター。 */
class PageQueryService {
  /** 各機能のApplication Serviceを受け取る。 */
  constructor(services) {
    this.services = services;
  }

  /** ページIDに対応するQueryを実行し、不明な場合はダッシュボードを返す。 */
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

/** リポジトリとサービスを一度だけ組み立て、同一実行内で再利用する。 */
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

/** スプレッドシートIDから利用者向け編集URLを生成する。 */
function spreadsheetUrl_(spreadsheetId) {
  return 'https://docs.google.com/spreadsheets/d/' + spreadsheetId + '/edit';
}
