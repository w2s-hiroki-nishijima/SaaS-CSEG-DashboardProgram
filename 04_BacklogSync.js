/** Backlogの全件・差分同期、正規化、時間制限時の継続実行を担当する。 */

/** installTriggers_() が毎時登録する時間主導トリガーのエントリポイント。 */
function runHourlyBacklogSync_() {
  startBacklogSync_('incremental');
}

/** 管理者操作から差分同期を開始し、同期状態を画面へ返す公開RPC。 */
function manualBacklogSync() {
  assertAdmin_();

  const props = PropertiesService.getScriptProperties();

  const syncState = props.getProperty(
    'BACKLOG_SYNC_STATE'
  );

  if (syncState) {
    const state = JSON.parse(syncState);

    Logger.log(
      '進行中の同期を再開します。現在位置: ' +
      state.offset +
      '件'
    );

    return startBacklogSync_(
      'continuation'
    );
  }

  return startBacklogSync_(
    'manual'
  );
}

/** 排他ロックを取得し、保存済み状態からBacklog同期本体を開始・再開する。 */
function startBacklogSync_(mode) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return { ok: false, message: '別の同期処理が実行中です。' };
  const startedAt = nowIso_();
  let syncId = 'sync_' + Utilities.getUuid();
  let fetched = 0;
  let inserted = 0;
  let updated = 0;
  try {
    const cfg = getRuntimeConfig_();
    if (!cfg.backlogSpaceUrl || !cfg.backlogApiKey || !cfg.backlogProjectKeys.length) {
      throw new Error('Backlog設定（スペースURL・APIキー・プロジェクトキー）が不足しています。');
    }
    const props = PropertiesService.getScriptProperties();
    const performanceTargetIssueTypes = getAnalyticsTargetIssueTypes_(getSheet_('BacklogIssues').getParent());
    let state = parseJson_(props.getProperty('BACKLOG_SYNC_STATE'), null);
    if (!state || mode !== 'continuation') {
      const previous = props.getProperty('BACKLOG_LAST_SYNC_AT') || '';
      const lowerBound = previous ? new Date(new Date(previous).getTime() - CSEG_APP.SYNC_OVERLAP_MINUTES * 60000).toISOString() : '';
      state = {
        syncId: syncId,
        syncMode: previous ? 'incremental' : 'full',
        projectIndex: 0,
        offset: 0,
        lowerBound: lowerBound,
        upperBound: new Date().toISOString(),
        startedAt: startedAt,
        fetched: 0,
        inserted: 0,
        updated: 0
      };
    } else {
      syncId = state.syncId;
      fetched = Number(state.fetched || 0);
      inserted = Number(state.inserted || 0);
      updated = Number(state.updated || 0);
    }

    const startMs = Date.now();
    while (state.projectIndex < cfg.backlogProjectKeys.length) {
      const projectKey = cfg.backlogProjectKeys[state.projectIndex];
      const projectId = resolveBacklogProjectId_(cfg, projectKey);
      const page = fetchBacklogIssuesPage_(cfg, projectId, state.offset, state.lowerBound, state.upperBound);
      const holidaySet = getHolidaySet_();
      const normalized = page.map(function (issue) {
        return normalizeBacklogIssue_(
          cfg,
          issue,
          holidaySet,
          projectKey
        );
      });
      const result = upsertRows_('BacklogIssues', normalized, ['issueKey'], true);
      if (state.syncMode === 'incremental' && normalized.length) {
        updatePerformanceIssuesIncremental_(normalized, performanceTargetIssueTypes);
      }
      fetched += normalized.length;
      inserted += result.inserted;
      updated += result.updated;
      state.fetched = fetched;
      state.inserted = inserted;
      state.updated = updated;

      if (page.length < CSEG_APP.BACKLOG_PAGE_SIZE) {
        state.projectIndex++;
        state.offset = 0;
      } else {
        state.offset += CSEG_APP.BACKLOG_PAGE_SIZE;
      }

      if (Date.now() - startMs > CSEG_APP.SYNC_MAX_MILLIS && state.projectIndex < cfg.backlogProjectKeys.length) {
        props.setProperty('BACKLOG_SYNC_STATE', JSON.stringify(state));
        scheduleContinuation_();
        logSync_(state, '', 'running', '実行時間上限のため、続きの同期を予約しました。');
        props.setProperty('BACKLOG_LAST_SYNC_STATUS', 'running');
        return { ok: true, continued: true, fetchedCount: fetched, insertedCount: inserted, updatedCount: updated };
      }
    }

    props.deleteProperty('BACKLOG_SYNC_STATE');
    props.setProperty('BACKLOG_LAST_SYNC_AT', state.upperBound);
    props.setProperty('BACKLOG_LAST_SYNC_STATUS', 'success');
    clearSheetCache_('BacklogIssues');
    if (state.syncMode === 'incremental') {
      finalizePerformanceIssueIndex_(nowIso_());
    }
    scheduleAnalyticsRebuild_(state.syncMode === 'full');
    logSync_(state, nowIso_(), 'success', '同期完了');
    return { ok: true, continued: false, cachePending: true, fetchedCount: fetched, insertedCount: inserted, updatedCount: updated, lastSyncAt: state.upperBound };
  } catch (err) {
    PropertiesService.getScriptProperties().setProperty('BACKLOG_LAST_SYNC_STATUS', 'error: ' + err.message);
    appendRows_('SyncLog', [{
      syncId: syncId, startedAt: startedAt, finishedAt: nowIso_(), mode: mode, status: 'error',
      fetchedCount: fetched, insertedCount: inserted, updatedCount: updated, message: String(err.message || err)
    }]);
    throw err;
  } finally {
    lock.releaseLock();
  }
}

/** Backlog APIから更新日時条件付きで課題を1ページ分取得する。 */
function fetchBacklogIssuesPage_(
  cfg,
  projectId,
  offset,
  lowerBound,
  upperBound
) {
  const params = [
    'apiKey=' + encodeURIComponent(cfg.backlogApiKey),

    'projectId[]=' + encodeURIComponent(projectId),

    'count=' + CSEG_APP.BACKLOG_PAGE_SIZE,

    'offset=' + Number(offset || 0),

    'sort=updated',

    'order=asc'
  ];

  if (lowerBound) {
    params.push(
      'updatedSince=' +
      encodeURIComponent(
        dateKey_(lowerBound)
      )
    );
  }

  if (upperBound) {
    params.push(
      'updatedUntil=' +
      encodeURIComponent(
        dateKey_(upperBound)
      )
    );
  }

  const url =
    cfg.backlogSpaceUrl +
    '/api/v2/issues?' +
    params.join('&');

  return backlogFetchJson_(url);
}

/** プロジェクトキーをBacklog内部のプロジェクトIDへ解決する。 */
function resolveBacklogProjectId_(cfg, projectKey) {
  const cache = CacheService.getScriptCache();
  const cacheKey = 'backlog-project:' + projectKey;
  const cached = cache.get(cacheKey);
  if (cached) return cached;
  const project = backlogFetchJson_(cfg.backlogSpaceUrl + '/api/v2/projects/' + encodeURIComponent(projectKey) + '?apiKey=' + encodeURIComponent(cfg.backlogApiKey));
  cache.put(cacheKey, String(project.id), 21600);
  return project.id;
}

/** Backlog APIへGETリクエストし、エラーを検証してJSONを返す。 */
function backlogFetchJson_(url) {
  const response = UrlFetchApp.fetch(url, { muteHttpExceptions: true, headers: { Accept: 'application/json' } });
  const code = response.getResponseCode();
  const body = response.getContentText('UTF-8');
  if (code < 200 || code >= 300) throw new Error('Backlog API error ' + code + ': ' + body.slice(0, 500));
  return JSON.parse(body);
}

/** Backlogの課題JSONをBacklogIssuesシートの共通スキーマへ正規化する。 */
function normalizeBacklogIssue_(
  cfg,
  issue,
  holidaySet,
  projectKey
) {
  const status = issue.status || {};

  const completed = configuredCustomFieldValue_(
    issue,
    'completedDate'
  );

  const closedAt = dateKey_(completed);

  // BacklogIssuesの互換列として保持する（ポイント計算はマイルストーンを使用）。
  const size = String(
    configuredCustomFieldValue_(issue, 'issueSize') || ''
  );

  const emergency = toBoolean_(
    configuredCustomFieldValue_(issue, 'emergencyFlag')
  );

  const milestone = (issue.milestone || [])
    .map(function (item) { return item.name; })
    .join(', ');

  const createdAt = dateKey_(issue.created);

  holidaySet = holidaySet || {};

  return {
    summary: issue.summary || '',

    issueKey: issue.issueKey || '',

    status: status.name || '',

    issueType: issue.issueType
      ? issue.issueType.name
      : '',

    assigneeName: issue.assignee
      ? issue.assignee.name
      : '',

    priority: issue.priority
      ? issue.priority.name
      : '',

    milestone: milestone,

    startDate: dateKey_(issue.startDate),

    dueDate: dateKey_(issue.dueDate),

    actualHours: optionalNumber_(issue.actualHours),

    caseType: configuredCustomFieldValue_(
      issue,
      'caseType'
    ),

    csegOwner: configuredCustomFieldValue_(
      issue,
      'csegOwner'
    ),

    team: configuredCustomFieldValue_(
      issue,
      'team'
    ),

    csTicketContentRating: configuredCustomFieldValue_(
      issue,
      'csTicketContentRating'
    ),

    ratingReasonCsegToCs: configuredCustomFieldValue_(
      issue,
      'ratingReasonCsegToCs'
    ),

    qualityScore: configuredCustomFieldValue_(
      issue,
      'qualityScore'
    ),

    csQualityReasonCsToCseg: configuredCustomFieldValue_(
      issue,
      'csQualityReasonCsToCseg'
    ),

    closedAt: closedAt,

    waitingFlag: toBoolean_(
      configuredCustomFieldValue_(
        issue,
        'waitingFlag'
      )
    ),

    escalationCategory: configuredCustomFieldValue_(
      issue,
      'escalationCategory'
    ),

    dueDateRequiredFlag: toBoolean_(
      configuredCustomFieldValue_(
        issue,
        'dueDateRequiredFlag'
      )
    ),

    emergencyFlag: emergency,

    issueId: issue.id || '',

    projectId: issue.projectId || '',

    projectKey: projectKey || '',

    createdAt: createdAt,

    updatedAt: dateKey_(issue.updated),

    statusId: status.id || '',

    assigneeId: issue.assignee
      ? issue.assignee.id
      : '',

    reporterName: issue.createdUser
      ? issue.createdUser.name
      : '',

    resolution: issue.resolution
      ? issue.resolution.name
      : '',

    category: (issue.category || [])
      .map(function (item) {
        return item.name;
      })
      .join(', '),

    environment: configuredCustomFieldValue_(
      issue,
      'environment'
    ),

    issueSize: size,

    rollbackFlag: toBoolean_(
      configuredCustomFieldValue_(
        issue,
        'rollbackFlag'
      )
    ),

    completionStatus: configuredCustomFieldValue_(
      issue,
      'completionStatus'
    ),

    tatBusinessDays: closedAt
      ? businessDays_(createdAt, closedAt, holidaySet)
      : '',

    point: milestonePoint_(milestone) + (emergency ? CSEG_APP.EMERGENCY_BONUS : 0),

    url:
      cfg.backlogSpaceUrl +
      '/view/' +
      issue.issueKey,

    customFieldsJson: serializeCustomFields_(
      issue.customFields
    ),

    syncedAt: nowIso_()
  };
}

/** カスタム属性を将来の再解析用に必要項目だけのJSONへ圧縮する。 */
function serializeCustomFields_(customFields) {
  return JSON.stringify((customFields || []).map(function(field) {
    return {
      id: field.id,
      name: field.name,
      fieldTypeId: field.fieldTypeId,
      value: field.value
    };
  }));
}

/** 設定された名称・IDの候補から対象カスタム属性の値を取得する。 */
function configuredCustomFieldValue_(issue, fieldKey) {
  const customFieldNames =
    CSEG_APP.CUSTOM_FIELDS || {};

  const customFieldIds =
    CSEG_APP.CUSTOM_FIELD_IDS || {};

  const acceptedNames =
    customFieldNames[fieldKey] || [];

  const acceptedIds =
    customFieldIds[fieldKey] || [];

  return customFieldValue_(
    issue,
    acceptedNames,
    acceptedIds
  );
}

/** カスタム属性一覧を名称またはIDで照合し、正規化済みの値を返す。 */
function customFieldValue_(
  issue,
  acceptedNames,
  acceptedIds
) {
  const fields = issue.customFields || [];

  if (acceptedIds && acceptedIds.length > 0) {
    for (let index = 0; index < fields.length; index++) {
      const field = fields[index];

      if (
        acceptedIds.indexOf(
          Number(field.id)
        ) >= 0
      ) {
        return normalizeCustomFieldValue_(field.value);
      }
    }
  }

  for (let index = 0; index < fields.length; index++) {
    const field = fields[index];

    if (
      acceptedNames.indexOf(field.name) < 0
    ) {
      continue;
    }

    return normalizeCustomFieldValue_(field.value);
  }

  return '';
}

/** Backlogカスタム属性の配列・オブジェクト・真偽値を保存可能な文字列へ変換する。 */
function normalizeCustomFieldValue_(value) {
  if (Array.isArray(value)) {
    return value
      .map(function (item) {
        return item && item.name != null
          ? item.name
          : item;
      })
      .join(', ');
  }

  if (
    value &&
    typeof value === 'object'
  ) {
    return value.name != null
      ? value.name
      : JSON.stringify(value);
  }

  return value == null
    ? ''
    : value;
}

/** 開始日から完了日までの土日祝を除いた対応日数を計算する。 */
function businessDays_(startValue, endValue, holidaySet) {
  if (!startValue || !endValue) return '';
  const start = new Date(startValue + 'T00:00:00+09:00');
  const end = new Date(endValue + 'T00:00:00+09:00');
  if (isNaN(start.getTime()) || isNaN(end.getTime()) || end < start) return '';
  let count = 0;
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const day = d.getDay();
    const key = Utilities.formatDate(d, CSEG_APP.TIMEZONE, 'yyyy-MM-dd');
    if (day !== 0 && day !== 6 && !holidaySet[key]) count++;
  }
  return Math.max(0, count - 1);
}

/** Holidaysシートを日付検索用のSetへ変換する。 */
function getHolidaySet_() {
  const set = {};
  readRows_('Holidays').forEach(function(row) { if (row.date) set[dateKey_(row.date)] = true; });
  return set;
}

/** 実行時間上限へ近づいた同期を再開する時間主導トリガーを登録する。 */
function scheduleContinuation_() {
  const triggers = ScriptApp.getProjectTriggers();

  const alreadyScheduled = triggers.some(function (trigger) {
    return (
      trigger.getHandlerFunction() ===
      'continueBacklogSyncV2'
    );
  });

  if (alreadyScheduled) {
    Logger.log('自動継続トリガーは設定済みです。');
    return;
  }

  ScriptApp
    .newTrigger('continueBacklogSyncV2')
    .timeBased()
    .everyMinutes(1)
    .create();

  Logger.log(
    '1分ごとの自動継続トリガーを設定しました。'
  );
}

/** 不要になったBacklog同期の継続トリガーを削除する。 */
function deleteBacklogContinuationTriggers_() {
  const targetFunctions = [
    'continueBacklogSync_',
    'continueBacklogSyncV2'
  ];

  ScriptApp
    .getProjectTriggers()
    .filter(function (trigger) {
      return targetFunctions.includes(
        trigger.getHandlerFunction()
      );
    })
    .forEach(function (trigger) {
      ScriptApp.deleteTrigger(trigger);
    });
}

/** 同期件数、処理時間、結果メッセージをSyncLogへ記録する。 */
function logSync_(state, finishedAt, status, message) {
  appendRows_('SyncLog', [{
    syncId: state.syncId,
    startedAt: state.startedAt,
    finishedAt: finishedAt,
    mode: state.syncMode,
    status: status,
    fetchedCount: state.fetched,
    insertedCount: state.inserted,
    updatedCount: state.updated,
    message: message
  }]);
}

/** JSON文字列を安全に解析し、失敗時は指定された既定値を返す。 */
function parseJson_(raw, fallback) {
  if (!raw) return fallback;
  try { return JSON.parse(raw); } catch (ignore) { return fallback; }
}

/** 時間主導トリガーから未完了のBacklog同期を継続する。 */
function continueBacklogSyncV2() {
  const props = PropertiesService.getScriptProperties();

  const syncState = props.getProperty(
    'BACKLOG_SYNC_STATE'
  );

  if (!syncState) {
    deleteBacklogContinuationTriggers_();

    Logger.log(
      '同期は完了済みです。継続トリガーを削除しました。'
    );

    return {
      ok: true,
      completed: true
    };
  }

  const state = JSON.parse(syncState);

  Logger.log(
    '同期を再開します。現在位置: ' +
    state.offset +
    '件'
  );

  const result = startBacklogSync_(
    'continuation'
  );

  if (
    !props.getProperty(
      'BACKLOG_SYNC_STATE'
    )
  ) {
    deleteBacklogContinuationTriggers_();

    Logger.log(
      '全件取得が完了したため、継続トリガーを削除しました。'
    );
  }

  return result;
}

/** 管理者操作で停止中の自動再開トリガーを再登録する。 */
function restartBacklogAutoResumeV2() {
  const props = PropertiesService.getScriptProperties();

  const syncState = props.getProperty(
    'BACKLOG_SYNC_STATE'
  );

  if (!syncState) {
    throw new Error(
      '再開できる同期状態が見つかりません。'
    );
  }

  const state = JSON.parse(syncState);

  deleteBacklogContinuationTriggers_();

  scheduleContinuation_();

  Logger.log(
    state.offset +
    '件目から同期を再開します。'
  );

  return continueBacklogSyncV2();
}
