/** SpreadsheetAppへ依存せず、入力制約・計算・状態遷移などの業務ルールを表現する。 */
/** 画面へそのまま返せる業務入力エラーを表す。 */
class DomainValidationError extends Error {
  /** エラーメッセージを保持したドメイン例外を生成する。 */
  constructor(message) {
    super(message);
    this.name = 'DomainValidationError';
  }
}

/** 改善要望・不具合報告の状態と変更ルールを管理する。 */
class FeedbackReportEntity {
  /** 保存済みの報告値からエンティティを復元する。 */
  constructor(values) {
    Object.assign(this, values);
  }

  /** 入力を検証し、初期ステータス「未対応」の新規報告を生成する。 */
  static create(input, actor, clock, idFactory) {
    const type = String(input && input.type || '改善要望');
    const title = String(input && input.title || '').trim();
    const description = String(input && input.description || '').trim();
    if (CSEG_FEEDBACK.TYPES.indexOf(type) < 0) throw new DomainValidationError('報告種別が不正です。');
    if (!title) throw new DomainValidationError('タイトルを入力してください。');
    if (!description) throw new DomainValidationError('内容を入力してください。');
    const now = clock();
    return new FeedbackReportEntity({
      reportId: 'feedback_' + idFactory(), type: type,
      title: title.slice(0, 200), description: description.slice(0, 5000), status: '未対応',
      createdAt: now, createdByEmail: actor.email, createdByName: actor.name,
      updatedAt: now, updatedBy: actor.email
    });
  }

  /** 許可されたステータスへ変更し、更新者と更新日時を記録する。 */
  changeStatus(status, actor, clock) {
    if (CSEG_FEEDBACK.STATUSES.indexOf(status) < 0) throw new DomainValidationError('ステータスが不正です。');
    this.status = status;
    this.updatedAt = clock();
    this.updatedBy = actor.email;
    return this;
  }

  /** シートへ保存できるプレーンオブジェクトへ変換する。 */
  toRow() {
    return Object.assign({}, this);
  }
}

/** 報告へ追加するコメントの生成ルールを管理する。 */
class FeedbackCommentEntity {
  /** 報告IDと本文を検証し、投稿者情報付きコメントを生成する。 */
  static create(reportId, text, actor, clock, idFactory) {
    const comment = String(text || '').trim();
    if (!reportId) throw new DomainValidationError('対象の報告が指定されていません。');
    if (!comment) throw new DomainValidationError('コメントを入力してください。');
    return {
      commentId: 'comment_' + idFactory(), reportId: reportId,
      comment: comment.slice(0, 3000), createdAt: clock(),
      createdByEmail: actor.email, createdByName: actor.name
    };
  }
}

/** 画面から入力された月別アサイン実績を検証する。 */
class AssignmentActualEntity {
  /** メンバー、対象月、各時間を正規化した保存用データを生成する。 */
  static fromInput(input) {
    if (!input || !input.memberId) throw new DomainValidationError('メンバーを選択してください。');
    return {
      memberId: String(input.memberId), month: monthKey_(input.month),
      responseHours: domainNonNegative_(input.responseHours),
      improvementHours: domainNonNegative_(input.improvementHours),
      specialHours: domainNonNegative_(input.specialHours)
    };
  }
}

/** 過去月にも影響しない目標件数スナップショットを計算する。 */
class TargetSnapshotEntity {
  /** 速度係数と有効アサイン時間から目標件数を算出する。 */
  static calculate(speed, assignment, minus, adjustment) {
    return round_(Math.max(0,
      toNumber_(speed) * (toNumber_(assignment) - toNumber_(minus) - toNumber_(adjustment)) /
      CSEG_APP.TARGET_BASE_HOURS
    ), 1);
  }
}

/** メンバーのスキルレベルと評価ポイントを生成する。 */
class SkillScoreEntity {
  /** スキルの上限レベルを適用し、保存用スコアを生成する。 */
  static create(input, member, skill, actor, clock) {
    if (!member || !skill) throw new DomainValidationError('メンバーまたはスキルが見つかりません。');
    const maxLevel = toNumber_(skill.maxLevel, 5);
    const level = Math.max(0, Math.min(maxLevel, Math.floor(toNumber_(input.level))));
    return {
      scoreId: member.memberId + ':' + skill.skillId,
      memberId: member.memberId,
      memberName: member.name,
      skillId: skill.skillId,
      skillName: skill.skillName,
      level: level,
      points: level * toNumber_(skill.pointsPerLevel, 1),
      note: String(input.note || '').slice(0, 1000),
      updatedAt: clock(),
      updatedBy: actor.email
    };
  }
}

/** スキルマスタの入力制約と初期値を管理する。 */
class SkillDefinitionEntity {
  /** スキル名、上限、ポイントなどを検証して保存用定義を生成する。 */
  static create(input, actor, clock, idFactory) {
    if (!input || !String(input.skillName || '').trim()) {
      throw new DomainValidationError('スキル名を入力してください。');
    }
    return {
      skillId: input.skillId || 'skill_' + idFactory(),
      category: String(input.category || '共通').slice(0, 100),
      skillName: String(input.skillName).trim().slice(0, 200),
      description: String(input.description || '').slice(0, 1000),
      maxLevel: Math.max(1, Math.min(10, Math.floor(toNumber_(input.maxLevel, 5)))),
      pointsPerLevel: Math.max(0, toNumber_(input.pointsPerLevel, 1)),
      active: input.active !== false,
      displayOrder: toNumber_(input.displayOrder, 100),
      updatedAt: clock(),
      updatedBy: actor.email
    };
  }
}

/** 通知ルールの種類、送信先、スケジュールの入力制約を管理する。 */
class NotificationRuleEntity {
  /** 許可された通知種別とチャネルだけを受け付け、保存用ルールを生成する。 */
  static create(input, actor, clock, idFactory) {
    if (!input || !String(input.name || '').trim()) {
      throw new DomainValidationError('通知名を入力してください。');
    }
    if (CSEG_NOTIFICATION.TYPES.indexOf(input.type) < 0 ||
        CSEG_NOTIFICATION.CHANNELS.indexOf(input.channel) < 0) {
      throw new DomainValidationError('通知種別または送信先が不正です。');
    }
    return {
      ruleId: input.ruleId || 'rule_' + idFactory(),
      name: String(input.name).trim().slice(0, 200),
      type: input.type,
      enabled: Boolean(input.enabled),
      schedule: input.schedule || 'daily',
      dayOfWeek: input.dayOfWeek || '',
      sendTime: input.sendTime || '09:00',
      channel: input.channel,
      recipients: String(input.recipients || '').slice(0, 1000),
      message: String(input.message || '').slice(0, 2000),
      lastRunAt: input.lastRunAt || '',
      updatedAt: clock(),
      updatedBy: actor.email
    };
  }
}

/** ドメイン入力を0以上の数値へ変換し、負数なら業務エラーにする。 */
function domainNonNegative_(value) {
  const number = toNumber_(value, 0);
  if (number < 0) throw new DomainValidationError('0以上の数値を入力してください。');
  return number;
}
