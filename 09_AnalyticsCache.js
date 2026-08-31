/**
 * 集計済みデータをAnalyticsCacheへ保存し、通常画面がBacklogIssues全件を
 * 毎回走査しなくて済むようにする。再構築中もBacklogIssuesは読取専用とする。
 */
let _analyticsCacheMapMemo_ = null;
let _performanceIssueRowsByKeyMemo_ = null;
const CSEG_ANALYTICS_REBUILD = Object.freeze({
  STATE_PROPERTY: 'ANALYTICS_REBUILD_STATE',
  DETAILS_PROPERTY: 'ANALYTICS_REBUILD_PERFORMANCE_DETAILS',
  CHUNK_ROWS: 1500,
  MAX_MILLIS: 3.5 * 60 * 1000
});

/** 管理者操作で集計キャッシュと明細を最初から再構築する公開RPC。 */
function rebuildAnalyticsCache() {
  assertAdmin_();
  deleteAnalyticsRebuildTriggers_();
  PropertiesService.getScriptProperties().setProperty(CSEG_ANALYTICS_REBUILD.DETAILS_PROPERTY, 'true');
  return runAnalyticsCacheRebuild_(true, 'manual');
}

/** Backlog同期後に変更分を反映する差分集計を開始する公開RPC。 */
function rebuildAnalyticsCacheAfterBacklogSync() {
  assertAdmin_();
  deleteAnalyticsRebuildTriggers_();
  return runAnalyticsCacheRebuild_(true, 'post-sync');
}

/** 時間主導トリガーから保存済み状態を使って集計処理を再開する。 */
function rebuildAnalyticsCache_() {
  return runAnalyticsCacheRebuild_(false, 'automatic');
}

/** 現在の集計進捗、継続状態、最終更新日時を画面へ返す。 */
function getAnalyticsCacheStatus() {
  assertAdmin_();
  const props = PropertiesService.getScriptProperties();
  return {
    status: props.getProperty('ANALYTICS_CACHE_STATUS') || '',
    rebuiltAt: props.getProperty('ANALYTICS_CACHE_REBUILT_AT') || '',
    state: parseJson_(props.getProperty(CSEG_ANALYTICS_REBUILD.STATE_PROPERTY), null)
  };
}

/** 排他ロック内でBacklogIssuesを分割処理し、時間上限なら状態を保存して中断する。 */
function runAnalyticsCacheRebuild_(restart, mode) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return { ok: false, busy: true, message: '別の同期・集計処理が実行中です。' };
  const props = PropertiesService.getScriptProperties();
  try {
    const issueSheet = getSheet_('BacklogIssues');

    const targetIssueTypes = getAnalyticsTargetIssueTypes_(
      issueSheet.getParent()
    );

    const headers = CSEG_SHEETS.BacklogIssues;
    const indexes = {};

    headers.forEach(function (header, index) {
      indexes[header] = index;
    });

    const issueTypeIndex =
      typeof indexes.issueType === 'number'
        ? indexes.issueType
        : issueSheet
            .getRange(1, 1, 1, headers.length)
            .getDisplayValues()[0]
            .indexOf('種別');

    if (issueTypeIndex < 0) {
      throw new Error(
        'BacklogIssuesシートに「種別」列が見つかりません。'
      );
    }

    let state = parseJson_(
      props.getProperty(CSEG_ANALYTICS_REBUILD.STATE_PROPERTY),
      null
    );

    if (restart || !state) {
      state = initializeAnalyticsRebuild_(mode);
    }

    const work = loadAnalyticsWork_();
    const startedMs = Date.now();
    const today = dateKey_(new Date());

    while (state.nextRow <= state.lastRow && Date.now() - startedMs < CSEG_ANALYTICS_REBUILD.MAX_MILLIS) {
      const rowCount = Math.min(CSEG_ANALYTICS_REBUILD.CHUNK_ROWS, state.lastRow - state.nextRow + 1);
      const values = issueSheet.getRange(state.nextRow, 1, rowCount, headers.length).getValues();
      const performanceIssueRows = [];
      values.forEach(function (row) {
        if (!row.some(function (value) {
          return value !== '';
        })) {
          return;
        }

        const issueType = String(
          row[issueTypeIndex] || ''
        ).trim();

        if (!targetIssueTypes.has(issueType)) {
          return;
        }

        const issue = analyticsIssueFromRow_(row, indexes);
        applyIssueToAnalyticsWork_(work, issue, today);
        if (state.rebuildPerformanceIssues) {
          Array.prototype.push.apply(performanceIssueRows, buildPerformanceIssueRows_(issue));
        }

        state.issueCount++;
      });
      if (state.rebuildPerformanceIssues) appendRows_('PerformanceIssues', performanceIssueRows);
      state.nextRow += rowCount;
      state.processedRows += rowCount;
    }

    work.overdue.tickets.sort(function(a, b) {
      return String(a.dueDate || '').localeCompare(String(b.dueDate || '')) || String(a.issueKey || '').localeCompare(String(b.issueKey || ''));
    });
    work.overdue.tickets = work.overdue.tickets.slice(0, 20);
    persistAnalyticsWork_(work, state);

    if (state.nextRow <= state.lastRow) {
      props.setProperty(CSEG_ANALYTICS_REBUILD.STATE_PROPERTY, JSON.stringify(state));
      props.setProperty('ANALYTICS_CACHE_STATUS', 'running: ' + state.processedRows + ' / ' + Math.max(0, state.lastRow - 1));
      scheduleAnalyticsContinuation_();
      return {
        ok: true,
        continued: true,
        processedRows: state.processedRows,
        totalRows: Math.max(0, state.lastRow - 1),
        message: '実行時間上限を避けるため、約1分後に自動継続します。'
      };
    }

    const rebuiltAt = nowIso_();
    if (state.rebuildPerformanceIssues) finalizePerformanceIssueIndex_(rebuiltAt);
    const rows = Object.keys(work.months).sort().map(function(month) {
      return {
        cacheKey: 'month:' + month,
        payloadJson: JSON.stringify(work.months[month]),
        sourceUpdatedAt: state.sourceUpdatedAt,
        updatedAt: rebuiltAt
      };
    });
    rows.push({ cacheKey: 'overdue', payloadJson: JSON.stringify(work.overdue), sourceUpdatedAt: state.sourceUpdatedAt, updatedAt: rebuiltAt });
    rows.push({
      cacheKey: 'meta',
      payloadJson: JSON.stringify({ schemaVersion: 8, issueCount: state.issueCount, monthCount: Object.keys(work.months).length, rebuiltAt: rebuiltAt }),
      sourceUpdatedAt: state.sourceUpdatedAt,
      updatedAt: rebuiltAt
    });

    replaceAllRows_('AnalyticsCache', rows);
    _analyticsCacheMapMemo_ = null;
    props.deleteProperty(CSEG_ANALYTICS_REBUILD.STATE_PROPERTY);
    props.deleteProperty(CSEG_ANALYTICS_REBUILD.DETAILS_PROPERTY);
    props.setProperty('ANALYTICS_CACHE_STATUS', 'success');
    props.setProperty('ANALYTICS_CACHE_REBUILT_AT', rebuiltAt);
    return { ok: true, continued: false, issueCount: state.issueCount, monthCount: Object.keys(work.months).length, rebuiltAt: rebuiltAt };
  } catch (err) {
    props.setProperty('ANALYTICS_CACHE_STATUS', 'error: ' + String(err.message || err));
    throw err;
  } finally {
    lock.releaseLock();
  }
}

/** 再構築対象の範囲と進捗状態を初期化し、Script Propertiesへ保存する。 */
function initializeAnalyticsRebuild_(mode) {
  const props = PropertiesService.getScriptProperties();
  const issueSheet = getSheet_('BacklogIssues');
  const existing = readRows_('AnalyticsCache').filter(function(row) {
    return String(row.cacheKey || '').indexOf('work:') !== 0;
  });
  replaceAllRows_('AnalyticsCache', existing);
  const rebuildPerformanceIssues = props.getProperty(CSEG_ANALYTICS_REBUILD.DETAILS_PROPERTY) !== 'false';
  if (rebuildPerformanceIssues) {
    getSheet_('PerformanceIssues').getRange(1, 1, 1, CSEG_SHEETS.PerformanceIssues.length)
      .setValues([CSEG_SHEETS.PerformanceIssues]);
    replaceAllRows_('PerformanceIssues', []);
    replaceAllRows_('PerformanceIssueIndex', []);
  }
  const state = {
    mode: mode,
    nextRow: 2,
    lastRow: issueSheet.getLastRow(),
    processedRows: 0,
    issueCount: 0,
    rebuildPerformanceIssues: rebuildPerformanceIssues,
    startedAt: nowIso_(),
    sourceUpdatedAt: props.getProperty('BACKLOG_LAST_SYNC_AT') || nowIso_()
  };
  props.setProperty(CSEG_ANALYTICS_REBUILD.STATE_PROPERTY, JSON.stringify(state));
  props.setProperty('ANALYTICS_CACHE_STATUS', 'running: 0 / ' + Math.max(0, state.lastRow - 1));
  return state;
}

/** BacklogIssuesの配列行を、集計に必要な型付き課題オブジェクトへ変換する。 */
function analyticsIssueFromRow_(row, indexes) {
  // 列名から対象セルを取り出し、列順への直接依存をこの関数内へ閉じ込める。
  function value(name) { return row[indexes[name]]; }
  const emergency = analyticsEmergencyFlag_(value('emergencyFlag'), value('customFieldsJson'));
  return {
    issueKey: String(value('issueKey') || ''),
    summary: String(value('summary') || ''),
    createdAt: dateKey_(value('createdAt')),
    dueDate: dateKey_(value('dueDate')),
    closedAt: dateKey_(value('closedAt')),
    status: String(value('status') || ''),
    statusId: value('statusId'),
    assigneeName: String(value('assigneeName') || ''),
    milestone: String(value('milestone') || ''),
    csegOwner: String(value('csegOwner') || ''),
    team: String(value('team') || ''),
    qualityScore: value('qualityScore'),
    emergencyFlag: emergency,
    tatBusinessDays: value('tatBusinessDays'),
    point: milestonePoint_(value('milestone')) + (emergency ? CSEG_APP.EMERGENCY_BONUS : 0),
    url: String(value('url') || '')
  };
}

/** 保存済み列を優先し、必要ならカスタム属性JSONから緊急フラグを復元する。 */
function analyticsEmergencyFlag_(storedValue, customFieldsJson) {
  if (toBoolean_(storedValue)) return true;
  try {
    const accepted = CSEG_APP.CUSTOM_FIELDS.emergencyFlag || [];
    const acceptedIds = (CSEG_APP.CUSTOM_FIELD_IDS || {}).emergencyFlag || [];
    const fields = JSON.parse(String(customFieldsJson || '[]'));
    const field = fields.find(function(item) {
      return accepted.indexOf(String(item.name || '')) >= 0 || acceptedIds.indexOf(Number(item.id)) >= 0;
    });
    if (!field) return false;
    const value = normalizeCustomFieldValue_(field.value);
    return toBoolean_(value);
  } catch (ignore) {
    return false;
  }
}

/** 1課題の作成・完了・期限超過・ポイントを作業中の月次集計へ加算する。 */
function applyIssueToAnalyticsWork_(work, issue, today) {
  const dueDate = String(issue.dueDate || '').slice(0, 10);

  const dueMonth =
    /^\d{4}-\d{2}-\d{2}$/.test(dueDate)
      ? dueDate.slice(0, 7)
      : '';

  const teams = splitCsegTeams_(issue.team);
  if (teams.length === 0) teams.push('未設定');

  // 起票数は起票日（createdAt）の月バケットへ計上する
  const createdMonth = /^\d{4}-\d{2}-\d{2}$/.test(String(issue.createdAt || '').slice(0, 10))
    ? String(issue.createdAt).slice(0, 7)
    : '';
  if (createdMonth) {
    ensureMonthBucket_(work.months, createdMonth).createdCount++;
  }

  // 月別実績は、期限日の月へ計上する
  if (dueMonth) {
    const dueBucket = ensureMonthBucket_(
      work.months,
      dueMonth
    );

    // 完了数は完了済み課題のみ計上する
    if (isClosedIssue_(issue)) {
      dueBucket.completedCount++;
    }

    dueBucket.dailyCreated[dueDate] =
      (dueBucket.dailyCreated[dueDate] || 0) + 1;

    if (isClosedIssue_(issue)) {
      dueBucket.dailyCompleted[dueDate] =
        (dueBucket.dailyCompleted[dueDate] || 0) + 1;
    }

    teams.forEach(function(team) {
      dueBucket.createdByTeam[team] =
        (dueBucket.createdByTeam[team] || 0) + 1;
    });

    addCompletedIssueToBucket_(
      dueBucket,
      issue,
      teams,
      dueDate
    );
  }

  // 期限超過は従来どおり
  if (
    !isClosedIssue_(issue) &&
    issue.dueDate &&
    String(issue.dueDate) < today
  ) {
    work.overdue.count++;

    teams.forEach(function(team) {
      work.overdue.byTeam[team] =
        (work.overdue.byTeam[team] || 0) + 1;
    });

    work.overdue.tickets.push(
      issueListItem_(issue)
    );

    work.overdue.tickets.sort(function (a, b) {
      return (
        String(a.dueDate || '').localeCompare(
          String(b.dueDate || '')
        ) ||
        String(a.issueKey || '').localeCompare(
          String(b.issueKey || '')
        )
      );
    });

    work.overdue.tickets =
      work.overdue.tickets.slice(0, 20);
  }
}

/** 複数主担当を展開し、1課題からメンバー別PerformanceIssues行を生成する。 */
function buildPerformanceIssueRows_(issue) {
  const dueDate = String(issue.dueDate || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) return [];
  const teams = splitCsegTeams_(issue.team);
  const owners = splitCsegOwners_(issue.csegOwner);
  if (!teams.length) teams.push('未設定');
  if (!owners.length) owners.push('未設定');
  const rows = [];
  owners.forEach(function(owner) {
    rows.push({
      month: dueDate.slice(0, 7), memberName: owner, sourceTeam: teams.join(', '),
      issueKey: issue.issueKey, summary: issue.summary, milestone: issue.milestone,
      point: issue.point, emergencyFlag: toBoolean_(issue.emergencyFlag),
      tatBusinessDays: issue.tatBusinessDays, url: issue.url
    });
  });
  return rows;
}

/** 変更された課題キーだけ明細を削除・再追加し、全件再生成を避ける。 */
function updatePerformanceIssuesIncremental_(issues, targetIssueTypes) {
  if (!issues || !issues.length) return;
  targetIssueTypes = targetIssueTypes || getAnalyticsTargetIssueTypes_(getSheet_('BacklogIssues').getParent());
  const changedKeys = {};
  issues.forEach(function(issue) {
    const key = String(issue.issueKey || '');
    if (key) changedKeys[key] = true;
  });

  const sheet = getSheet_('PerformanceIssues');
  const headers = CSEG_SHEETS.PerformanceIssues;
  const lastRow = sheet.getLastRow();
  if (_performanceIssueRowsByKeyMemo_ === null) {
    _performanceIssueRowsByKeyMemo_ = {};
  }
  if (lastRow >= 2 && Object.keys(_performanceIssueRowsByKeyMemo_).length === 0) {
    const keyColumn = headers.indexOf('issueKey') + 1;
    const storedKeys = sheet.getRange(2, keyColumn, lastRow - 1, 1).getDisplayValues();
    storedKeys.forEach(function(row, offset) {
      const key = String(row[0] || '');
      if (!key) return;
      if (!_performanceIssueRowsByKeyMemo_[key]) _performanceIssueRowsByKeyMemo_[key] = [];
      _performanceIssueRowsByKeyMemo_[key].push(offset + 2);
    });
  }
  const ranges = [];
  Object.keys(changedKeys).forEach(function(key) {
    (_performanceIssueRowsByKeyMemo_[key] || []).forEach(function(rowNumber) {
      ranges.push('A' + rowNumber + ':' + performanceColumnLetter_(headers.length) + rowNumber);
    });
    delete _performanceIssueRowsByKeyMemo_[key];
  });
  if (ranges.length) sheet.getRangeList(ranges).clearContent();

  const detailRows = [];
  issues.forEach(function(issue) {
    if (!targetIssueTypes.has(String(issue.issueType || '').trim())) return;
    Array.prototype.push.apply(detailRows, buildPerformanceIssueRows_(issue));
  });
  appendRows_('PerformanceIssues', detailRows);
  clearSheetCache_('PerformanceIssues');
}

/** PerformanceIssuesの列番号をA1記法の列文字へ変換する。 */
function performanceColumnLetter_(columnNumber) {
  let value = Number(columnNumber || 0);
  let result = '';
  while (value > 0) {
    value--;
    result = String.fromCharCode(65 + (value % 26)) + result;
    value = Math.floor(value / 26);
  }
  return result;
}

/** 明細を月・メンバー順に並べ、開始行と件数の索引を再生成する。 */
function finalizePerformanceIssueIndex_(updatedAt) {
  const sheet = getSheet_('PerformanceIssues');
  const headers = CSEG_SHEETS.PerformanceIssues;
  let lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    replaceAllRows_('PerformanceIssueIndex', []);
    return;
  }
  const compacted = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues().filter(function(row) {
    return row.some(function(value) { return value !== ''; });
  }).map(function(row) {
    const object = {};
    headers.forEach(function(header, index) { object[header] = row[index]; });
    return object;
  });
  replaceAllRows_('PerformanceIssues', compacted);
  lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    replaceAllRows_('PerformanceIssueIndex', []);
    return;
  }
  sheet.getRange(2, 1, lastRow - 1, headers.length).sort([
    { column: 1, ascending: true },
    { column: 2, ascending: true },
    { column: 4, ascending: true }
  ]);
  const keys = sheet.getRange(2, 1, lastRow - 1, 2).getValues();
  const indexRows = [];
  let current = null;
  keys.forEach(function(row, offset) {
    const month = monthKey_(row[0]);
    const memberName = String(row[1] || '');
    const indexKey = month + '\u001f' + memberName;
    if (!current || current.indexKey !== indexKey) {
      current = {
        indexKey: indexKey, month: month, memberName: memberName,
        startRow: offset + 2, rowCount: 0, updatedAt: updatedAt
      };
      indexRows.push(current);
    }
    current.rowCount++;
  });
  replaceAllRows_('PerformanceIssueIndex', indexRows);
  clearSheetCache_('PerformanceIssues');
  _performanceIssueRowsByKeyMemo_ = null;
}

/** 中断前に保存した作業中集計をScript Propertiesから復元する。 */
function loadAnalyticsWork_() {
  const work = { months: {}, overdue: { count: 0, byTeam: {}, tickets: [] } };
  readRows_('AnalyticsCache').forEach(function(row) {
    const key = String(row.cacheKey || '');
    try {
      if (key.indexOf('work:month:') === 0) work.months[key.slice(11)] = JSON.parse(String(row.payloadJson || '{}'));
      if (key === 'work:overdue') work.overdue = JSON.parse(String(row.payloadJson || '{}'));
    } catch (ignore) {}
  });
  return work;
}

/** 作業中集計と進捗状態を次回継続できる形で保存する。 */
function persistAnalyticsWork_(work, state) {
  const updatedAt = nowIso_();
  const rows = Object.keys(work.months).sort().map(function(month) {
    return { cacheKey: 'work:month:' + month, payloadJson: JSON.stringify(work.months[month]), sourceUpdatedAt: state.sourceUpdatedAt, updatedAt: updatedAt };
  });
  rows.push({ cacheKey: 'work:overdue', payloadJson: JSON.stringify(work.overdue), sourceUpdatedAt: state.sourceUpdatedAt, updatedAt: updatedAt });
  rows.push({ cacheKey: 'work:meta', payloadJson: JSON.stringify(state), sourceUpdatedAt: state.sourceUpdatedAt, updatedAt: updatedAt });
  upsertRows_('AnalyticsCache', rows, ['cacheKey'], true);
}

/** 未完了の集計を再開する時間主導トリガーを登録する。 */
function scheduleAnalyticsContinuation_() {
  ScriptApp.newTrigger('rebuildAnalyticsCache_').timeBased().after(60 * 1000).create();
}

/** 重複実行を防ぐため、既存の集計継続トリガーを削除する。 */
function deleteAnalyticsRebuildTriggers_() {
  ScriptApp.getProjectTriggers().forEach(function(trigger) {
    if (trigger.getHandlerFunction() === 'rebuildAnalyticsCache_') ScriptApp.deleteTrigger(trigger);
  });
}

/** 指定月の集計格納先がなければ初期値を作成して返す。 */
function ensureMonthBucket_(months, month) {
  if (!months[month]) {
    months[month] = {
      month: month,
      createdCount: 0,
      completedCount: 0,
      points: 0,
      qualitySum: 0,
      qualityCount: 0,
      dailyCreated: {},
      dailyCompleted: {},
      dailyPoints: {},
      createdByTeam: {},
      teams: {},
      members: {}
    };
  }
  return months[month];
}

/** 完了課題を月全体・チーム・メンバーの各指標へ加算する。 */
function addCompletedIssueToBucket_(
  bucket,
  issue,
  teams,
  dueDate
) {
  const point = toNumber_(issue.point, 1);

  bucket.points += point;

  if (dueDate) {
    bucket.dailyPoints[dueDate] =
      (bucket.dailyPoints[dueDate] || 0) + point;
  }

  const quality = Number(issue.qualityScore);

  const hasQuality =
    issue.qualityScore !== '' &&
    isFinite(quality);

  if (hasQuality) {
    bucket.qualitySum += quality;
    bucket.qualityCount++;
  }

  // 複数チームの場合、各チームに1件ずつ計上する
  teams.forEach(function(team) {
    const teamMetric = ensureIssueMetric_(bucket.teams, team);
    addCompletedMetric_(teamMetric, issue, point, quality, hasQuality);
  });

  // SaaS-CSEG主担当のみ使用する
  // 通常の担当者へのフォールバックは行わない
  const owners = splitCsegOwners_(
    issue.csegOwner
  );

  if (owners.length === 0) {
    owners.push('未設定');
  }

  // 個人実績は複数チーム案件でも、1チケットを1人につき1回だけ計上する。
  // チーム別の複数計上は bucket.teams 側だけで行う。
  owners.forEach(function (owner) {
    const memberMetric = ensureIssueMetric_(bucket.members, owner);
    memberMetric.name = owner;
    memberMetric.team = teams[0];
    addCompletedMetric_(memberMetric, issue, point, quality, hasQuality);
    if (toBoolean_(issue.emergencyFlag)) memberMetric.emergencyCount++;
  });
}

/** 指標Mapに対象キーの初期値がなければ作成して返す。 */
function ensureIssueMetric_(map, name) {
  if (!map[name]) {
    map[name] = {
      name: name,
      team: '未設定',
      completedCount: 0,
      points: 0,
      emergencyCount: 0,
      qualitySum: 0,
      qualityCount: 0,
      tatCount: 0,
      tat2: 0,
      tat5: 0,
      tat6: 0
    };
  }

  return map[name];
}

/** 完了件数、ポイント、緊急、品質、TAT区分を1つの指標へ加算する。 */
function addCompletedMetric_(
  metric,
  issue,
  point,
  quality,
  hasQuality
) {
  // 総対応件数は期限日基準
  metric.completedCount++;
  metric.points += point;

  if (hasQuality) {
    metric.qualitySum += quality;
    metric.qualityCount++;
  }

  const closedAt = String(
    issue.closedAt || ''
  ).slice(0, 10);

  // TATだけは【CS】完了日ありを母数とする
  if (!/^\d{4}-\d{2}-\d{2}$/.test(closedAt)) {
    return;
  }

  metric.tatCount++;

  const tat = Number(issue.tatBusinessDays);

  if (
    issue.tatBusinessDays === '' ||
    !isFinite(tat)
  ) {
    return;
  }

  if (tat <= 2) {
    metric.tat2++;
  } else if (tat <= 5) {
    metric.tat5++;
  } else {
    metric.tat6++;
  }
}

/** AnalyticsCacheシートをキー検索用Mapとして読み込み、実行中は再利用する。 */
function getAnalyticsCacheMap_() {
  if (_analyticsCacheMapMemo_) return _analyticsCacheMapMemo_;
  const rows = readRows_('AnalyticsCache');
  const map = {};
  rows.forEach(function(row) {
    try {
      map[String(row.cacheKey)] = JSON.parse(String(row.payloadJson || '{}'));
    } catch (ignore) {}
  });
  if (!map.meta) {
    throw new Error('集計キャッシュが未作成です。管理者がApps Scriptで rebuildAnalyticsCache を一度実行してください。');
  }
  _analyticsCacheMapMemo_ = map;
  return _analyticsCacheMapMemo_;
}

/** 指定月の集計スナップショットを取得し、存在しない場合は空データを返す。 */
function getMonthlyIssueSnapshot_(month) {
  const map = getAnalyticsCacheMap_();
  return normalizeSnapshotTeams_(map['month:' + month] || ensureMonthBucket_({}, month));
}

/** 現在の期限超過スナップショットを取得する。 */
function getOverdueSnapshot_() {
  const source = getAnalyticsCacheMap_().overdue || { count: 0, byTeam: {}, tickets: [] };
  return {
    count: toNumber_(source.count),
    byTeam: normalizeTeamCountMap_(source.byTeam || {}),
    tickets: source.tickets || []
  };
}

/** 旧形式と新形式のチーム集計を統一形式へ正規化する。 */
function normalizeSnapshotTeams_(source) {
  const snapshot = Object.assign({}, source);
  snapshot.createdByTeam = normalizeTeamCountMap_(source.createdByTeam || {});
  snapshot.teams = normalizeTeamMetricMap_(source.teams || {});
  snapshot.members = normalizeMemberTeamMetricMap_(source.members || {});
  return snapshot;
}

/** 複数チーム表記を個別チームへ展開し、件数Mapを作り直す。 */
function normalizeTeamCountMap_(source) {
  const out = {};
  Object.keys(source || {}).forEach(function(teamValue) {
    const teams = splitCsegTeams_(teamValue);
    if (!teams.length) teams.push('未設定');
    teams.forEach(function(team) {
      out[team] = (out[team] || 0) + toNumber_(source[teamValue]);
    });
  });
  return out;
}

/** 複数チーム表記の指標を個別チームへそれぞれ加算する。 */
function normalizeTeamMetricMap_(source) {
  const out = {};
  Object.keys(source || {}).forEach(function(teamValue) {
    const teams = splitCsegTeams_(teamValue);
    if (!teams.length) teams.push('未設定');
    teams.forEach(function(team) {
      mergeIssueMetric_(out, team, source[teamValue], team, team);
    });
  });
  return out;
}

/** メンバー×複数チームの旧キーを個別チームのキーへ展開する。 */
function normalizeMemberTeamMetricMap_(source) {
  const out = {};
  Object.keys(source || {}).forEach(function(key) {
    const metric = source[key] || {};
    const name = metric.name || String(key).split('\u001f')[0] || '未設定';
    const teams = splitCsegTeams_(metric.team);
    if (!teams.length) teams.push('未設定');
    teams.forEach(function(team) {
      mergeIssueMetric_(out, name + '\u001f' + team, metric, name, team);
    });
  });
  return out;
}

/** 指定キーの指標へ別指標の各数値を安全にマージする。 */
function mergeIssueMetric_(map, key, source, name, team) {
  const target = ensureIssueMetric_(map, key);
  target.name = name;
  target.team = team;
  [
    'completedCount', 'points', 'emergencyCount', 'qualitySum', 'qualityCount',
    'tatCount', 'tat2', 'tat5', 'tat6'
  ].forEach(function(field) {
    target[field] = toNumber_(target[field]) + toNumber_(source[field]);
  });
}

/** Backlog同期終了後に集計再構築を非同期で開始するトリガーを登録する。 */
function scheduleAnalyticsRebuild_(rebuildPerformanceIssues) {
  const handler = 'rebuildAnalyticsCache_';
  const exists = ScriptApp.getProjectTriggers().some(function(trigger) {
    return trigger.getHandlerFunction() === handler;
  });
  if (!exists) ScriptApp.newTrigger(handler).timeBased().after(60 * 1000).create();
  const props = PropertiesService.getScriptProperties();
  const alreadyFull = props.getProperty(CSEG_ANALYTICS_REBUILD.DETAILS_PROPERTY) === 'true';
  props.deleteProperty(CSEG_ANALYTICS_REBUILD.STATE_PROPERTY);
  props.setProperty(CSEG_ANALYTICS_REBUILD.DETAILS_PROPERTY, alreadyFull || rebuildPerformanceIssues !== false ? 'true' : 'false');
  props.setProperty('ANALYTICS_CACHE_STATUS', 'pending');
}

/** 集計対象とするBacklog課題種別を設定シートから取得する。 */
function getAnalyticsTargetIssueTypes_(spreadsheet) {
  const sheet = spreadsheet.getSheetByName('CSEG対象種別');

  if (!sheet) {
    throw new Error(
      '「CSEG対象種別」シートが見つかりません。'
    );
  }

  const lastRow = sheet.getLastRow();

  if (lastRow < 2) {
    throw new Error(
      '「CSEG対象種別」シートに種別が登録されていません。'
    );
  }

  const targetIssueTypes = new Set();

  sheet
    .getRange(2, 1, lastRow - 1, 2)
    .getValues()
    .forEach(function (row) {
      const issueType = String(row[0] || '').trim();

      if (issueType && row[1] === true) {
        targetIssueTypes.add(issueType);
      }
    });

  if (targetIssueTypes.size === 0) {
    throw new Error(
      '「CSEG対象種別」シートで集計対象の種別にチェックを入れてください。'
    );
  }

  return targetIssueTypes;
}

/** カンマ・改行などで連結された複数主担当を個別の氏名へ分割する。 */
function splitCsegOwners_(value) {
  const owners = String(value || '')
    .split(/[,、，\n\r]+/)
    .map(function (name) {
      return name.trim();
    })
    .filter(function (name) {
      return name !== '';
    });

  // 同じ名前が重複していても、1チケット1件まで
  return Array.from(new Set(owners));
}

/** カンマ・改行などで連結された複数チームを個別チームへ分割する。 */
function splitCsegTeams_(value) {
  return splitCsegOwners_(value);
}
