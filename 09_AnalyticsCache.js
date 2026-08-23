/**
 * Pre-aggregated analytics storage.
 *
 * BacklogIssues is intentionally read only while rebuilding this cache. Normal
 * dashboard/performance/aggregate requests read the small AnalyticsCache sheet.
 */
let _analyticsCacheMapMemo_ = null;
const CSEG_ANALYTICS_REBUILD = Object.freeze({
  STATE_PROPERTY: 'ANALYTICS_REBUILD_STATE',
  CHUNK_ROWS: 1500,
  MAX_MILLIS: 3.5 * 60 * 1000
});

function rebuildAnalyticsCache() {
  assertAdmin_();
  deleteAnalyticsRebuildTriggers_();
  return runAnalyticsCacheRebuild_(true, 'manual');
}

function rebuildAnalyticsCache_() {
  return runAnalyticsCacheRebuild_(false, 'automatic');
}

function getAnalyticsCacheStatus() {
  assertAdmin_();
  const props = PropertiesService.getScriptProperties();
  return {
    status: props.getProperty('ANALYTICS_CACHE_STATUS') || '',
    rebuiltAt: props.getProperty('ANALYTICS_CACHE_REBUILT_AT') || '',
    state: parseJson_(props.getProperty(CSEG_ANALYTICS_REBUILD.STATE_PROPERTY), null)
  };
}

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
        Array.prototype.push.apply(performanceIssueRows, buildPerformanceIssueRows_(issue));

        state.issueCount++;
      });
      appendRows_('PerformanceIssues', performanceIssueRows);
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
      payloadJson: JSON.stringify({ schemaVersion: 5, issueCount: state.issueCount, monthCount: Object.keys(work.months).length, rebuiltAt: rebuiltAt }),
      sourceUpdatedAt: state.sourceUpdatedAt,
      updatedAt: rebuiltAt
    });

    replaceAllRows_('AnalyticsCache', rows);
    _analyticsCacheMapMemo_ = null;
    props.deleteProperty(CSEG_ANALYTICS_REBUILD.STATE_PROPERTY);
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

function initializeAnalyticsRebuild_(mode) {
  const props = PropertiesService.getScriptProperties();
  const issueSheet = getSheet_('BacklogIssues');
  const existing = readRows_('AnalyticsCache').filter(function(row) {
    return String(row.cacheKey || '').indexOf('work:') !== 0;
  });
  replaceAllRows_('AnalyticsCache', existing);
  replaceAllRows_('PerformanceIssues', []);
  const state = {
    mode: mode,
    nextRow: 2,
    lastRow: issueSheet.getLastRow(),
    processedRows: 0,
    issueCount: 0,
    startedAt: nowIso_(),
    sourceUpdatedAt: props.getProperty('BACKLOG_LAST_SYNC_AT') || nowIso_()
  };
  props.setProperty(CSEG_ANALYTICS_REBUILD.STATE_PROPERTY, JSON.stringify(state));
  props.setProperty('ANALYTICS_CACHE_STATUS', 'running: 0 / ' + Math.max(0, state.lastRow - 1));
  return state;
}

function analyticsIssueFromRow_(row, indexes) {
  function value(name) { return row[indexes[name]]; }
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
    emergencyFlag: value('emergencyFlag'),
    tatBusinessDays: value('tatBusinessDays'),
    point: milestonePoint_(value('milestone')) + (toBoolean_(value('emergencyFlag')) ? CSEG_APP.EMERGENCY_BONUS : 0),
    url: String(value('url') || '')
  };
}

function applyIssueToAnalyticsWork_(work, issue, today) {
  const dueDate = String(issue.dueDate || '').slice(0, 10);

  const dueMonth =
    /^\d{4}-\d{2}-\d{2}$/.test(dueDate)
      ? dueDate.slice(0, 7)
      : '';

  const teams = splitCsegTeams_(issue.team);
  if (teams.length === 0) teams.push('未設定');

  // 月別実績は、すべて期限日の月へ計上する
  if (dueMonth) {
    const dueBucket = ensureMonthBucket_(
      work.months,
      dueMonth
    );

    // 既存画面との互換性維持のため、
    // createdCount / completedCount ともに期限日基準の件数とする
    dueBucket.createdCount++;
    dueBucket.completedCount++;

    dueBucket.dailyCreated[dueDate] =
      (dueBucket.dailyCreated[dueDate] || 0) + 1;

    dueBucket.dailyCompleted[dueDate] =
      (dueBucket.dailyCompleted[dueDate] || 0) + 1;

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

function buildPerformanceIssueRows_(issue) {
  const dueDate = String(issue.dueDate || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) return [];
  const teams = splitCsegTeams_(issue.team);
  const owners = splitCsegOwners_(issue.csegOwner);
  if (!teams.length) teams.push('未設定');
  if (!owners.length) owners.push('未設定');
  const rows = [];
  owners.forEach(function(owner) {
    teams.forEach(function(team) {
      rows.push({
        month: dueDate.slice(0, 7), memberName: owner, sourceTeam: team,
        issueKey: issue.issueKey, summary: issue.summary, milestone: issue.milestone,
        point: issue.point, tatBusinessDays: issue.tatBusinessDays, url: issue.url
      });
    });
  });
  return rows;
}

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

function persistAnalyticsWork_(work, state) {
  const updatedAt = nowIso_();
  const rows = Object.keys(work.months).sort().map(function(month) {
    return { cacheKey: 'work:month:' + month, payloadJson: JSON.stringify(work.months[month]), sourceUpdatedAt: state.sourceUpdatedAt, updatedAt: updatedAt };
  });
  rows.push({ cacheKey: 'work:overdue', payloadJson: JSON.stringify(work.overdue), sourceUpdatedAt: state.sourceUpdatedAt, updatedAt: updatedAt });
  rows.push({ cacheKey: 'work:meta', payloadJson: JSON.stringify(state), sourceUpdatedAt: state.sourceUpdatedAt, updatedAt: updatedAt });
  upsertRows_('AnalyticsCache', rows, ['cacheKey'], true);
}

function scheduleAnalyticsContinuation_() {
  ScriptApp.newTrigger('rebuildAnalyticsCache_').timeBased().after(60 * 1000).create();
}

function deleteAnalyticsRebuildTriggers_() {
  ScriptApp.getProjectTriggers().forEach(function(trigger) {
    if (trigger.getHandlerFunction() === 'rebuildAnalyticsCache_') ScriptApp.deleteTrigger(trigger);
  });
}

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

  // 複数名・複数チームを担当者×チームに展開して各組み合わせへ計上する
  owners.forEach(function (owner) {
    teams.forEach(function(team) {
      const memberKey = owner + '\u001f' + team;
      const memberMetric = ensureIssueMetric_(bucket.members, memberKey);
      memberMetric.name = owner;
      memberMetric.team = team;

      addCompletedMetric_(memberMetric, issue, point, quality, hasQuality);
      if (toBoolean_(issue.emergencyFlag)) memberMetric.emergencyCount++;
    });
  });
}

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

function getMonthlyIssueSnapshot_(month) {
  const map = getAnalyticsCacheMap_();
  return normalizeSnapshotTeams_(map['month:' + month] || ensureMonthBucket_({}, month));
}

function getOverdueSnapshot_() {
  const source = getAnalyticsCacheMap_().overdue || { count: 0, byTeam: {}, tickets: [] };
  return {
    count: toNumber_(source.count),
    byTeam: normalizeTeamCountMap_(source.byTeam || {}),
    tickets: source.tickets || []
  };
}

/** Keeps old cache rows compatible after team values became multi-select. */
function normalizeSnapshotTeams_(source) {
  const snapshot = Object.assign({}, source);
  snapshot.createdByTeam = normalizeTeamCountMap_(source.createdByTeam || {});
  snapshot.teams = normalizeTeamMetricMap_(source.teams || {});
  snapshot.members = normalizeMemberTeamMetricMap_(source.members || {});
  return snapshot;
}

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

function scheduleAnalyticsRebuild_() {
  const handler = 'rebuildAnalyticsCache_';
  const exists = ScriptApp.getProjectTriggers().some(function(trigger) {
    return trigger.getHandlerFunction() === handler;
  });
  if (!exists) ScriptApp.newTrigger(handler).timeBased().after(60 * 1000).create();
  PropertiesService.getScriptProperties().setProperty('ANALYTICS_CACHE_STATUS', 'pending');
}

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

function splitCsegTeams_(value) {
  return splitCsegOwners_(value);
}
