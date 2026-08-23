/** BacklogIssues v2 schema inspection and migration utilities. */

function inspectBacklogCustomFields() {
  assertAdmin_();
  const cfg = getRuntimeConfig_();

  if (!cfg.backlogSpaceUrl || !cfg.backlogApiKey || !cfg.backlogProjectKeys.length) {
    throw new Error('Backlog設定（スペースURL・APIキー・プロジェクトキー）が不足しています。');
  }

  const requiredNames = requiredBacklogCustomFieldNames_();
  const projects = cfg.backlogProjectKeys.map(function(projectKey) {
    const fields = backlogFetchJson_(
      cfg.backlogSpaceUrl +
      '/api/v2/projects/' +
      encodeURIComponent(projectKey) +
      '/customFields?apiKey=' +
      encodeURIComponent(cfg.backlogApiKey)
    );

    const names = fields.map(function(field) {
      return String(field.name || '');
    });

    return {
      projectKey: projectKey,
      fields: fields.map(function(field) {
        return {
          id: field.id,
          name: field.name,
          typeId: field.typeId,
          required: Boolean(field.required)
        };
      }),
      matchedRequiredFields: requiredNames.filter(function(name) {
        return names.indexOf(name) >= 0;
      }),
      missingRequiredFields: requiredNames.filter(function(name) {
        return names.indexOf(name) < 0;
      })
    };
  });

  Logger.log(JSON.stringify(projects, null, 2));
  return projects;
}

function requiredBacklogCustomFieldNames_() {
  return [
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
    '緊急募集フラグ'
  ];
}

function migrateBacklogIssuesSchemaV2() {
  assertAdmin_();
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    const ss = getDataSpreadsheet_();
    const current = ss.getSheetByName('BacklogIssues');
    const expectedHeaders = sheetHeaderLabels_('BacklogIssues');

    if (current && backlogHeadersMatch_(current, expectedHeaders)) {
      return {
        ok: true,
        migrated: false,
        message: 'BacklogIssuesはすでにv2形式です。'
      };
    }

    let backupSheetName = '';
    if (current) {
      backupSheetName = uniqueBackupSheetName_(ss, 'BacklogIssues_backup_' + Utilities.formatDate(new Date(), CSEG_APP.TIMEZONE, 'yyyyMMdd_HHmmss'));
      current.setName(backupSheetName);
    }

    const created = ss.insertSheet('BacklogIssues');
    created.getRange(1, 1, 1, expectedHeaders.length).setValues([expectedHeaders]);
    formatDataSheet_(created, expectedHeaders.length);

    delete _sheetMemo_.BacklogIssues;
    delete _rowsMemo_.BacklogIssues;
    clearSheetCache_('BacklogIssues');

    const props = PropertiesService.getScriptProperties();
    props.deleteProperty('BACKLOG_SYNC_STATE');
    props.deleteProperty('BACKLOG_LAST_SYNC_AT');
    props.setProperty('BACKLOG_LAST_SYNC_STATUS', 'schema_v2_ready');

    return {
      ok: true,
      migrated: true,
      backupSheetName: backupSheetName,
      newSheetName: 'BacklogIssues',
      nextStep: 'runFullBacklogSyncV2'
    };
  } finally {
    lock.releaseLock();
  }
}

function runFullBacklogSyncV2() {
  assertAdmin_();
  const sheet = getDataSpreadsheet_().getSheetByName('BacklogIssues');
  const expectedHeaders = sheetHeaderLabels_('BacklogIssues');

  if (!sheet || !backlogHeadersMatch_(sheet, expectedHeaders)) {
    throw new Error('先にmigrateBacklogIssuesSchemaV2を実行してください。');
  }

  if (sheet.getLastRow() > 1) {
    sheet.getRange(2, 1, sheet.getLastRow() - 1, expectedHeaders.length).clearContent();
  }

  const props = PropertiesService.getScriptProperties();
  props.deleteProperty('BACKLOG_SYNC_STATE');
  props.deleteProperty('BACKLOG_LAST_SYNC_AT');
  props.setProperty('BACKLOG_LAST_SYNC_STATUS', 'full_sync_starting');
  clearSheetCache_('BacklogIssues');

  return startBacklogSync_('manual');
}

function validateBacklogIssuesV2() {
  assertAdmin_();
  const sheet = getDataSpreadsheet_().getSheetByName('BacklogIssues');
  const expectedHeaders = sheetHeaderLabels_('BacklogIssues');

  if (!sheet || !backlogHeadersMatch_(sheet, expectedHeaders)) {
    throw new Error('BacklogIssuesがv2形式ではありません。');
  }

  const rowCount = Math.max(0, sheet.getLastRow() - 1);
  const sampleCount = Math.min(rowCount, 500);
  const requiredKeys = [
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
    'emergencyFlag'
  ];

  const result = {
    ok: true,
    rowCount: rowCount,
    sampleCount: sampleCount,
    fields: {}
  };

  if (!sampleCount) return result;

  const keys = CSEG_SHEETS.BacklogIssues;
  const values = sheet.getRange(2, 1, sampleCount, keys.length).getValues();

  requiredKeys.forEach(function(key) {
    const index = keys.indexOf(key);
    const populatedCount = values.reduce(function(count, row) {
      const value = row[index];
      return count + (value !== '' && value != null ? 1 : 0);
    }, 0);

    result.fields[key] = {
      header: expectedHeaders[index],
      populatedCount: populatedCount,
      emptyCount: sampleCount - populatedCount,
      populatedRate: sampleCount ? populatedCount / sampleCount : 0
    };
  });

  Logger.log(JSON.stringify(result, null, 2));
  return result;
}

function backlogHeadersMatch_(sheet, expectedHeaders) {
  if (!sheet || sheet.getLastColumn() < expectedHeaders.length) return false;
  const actual = sheet.getRange(1, 1, 1, expectedHeaders.length).getDisplayValues()[0];
  return expectedHeaders.every(function(header, index) {
    return String(actual[index] || '') === String(header);
  });
}

function uniqueBackupSheetName_(spreadsheet, baseName) {
  let name = baseName.slice(0, 99);
  let suffix = 2;

  while (spreadsheet.getSheetByName(name)) {
    name = (baseName + '_' + suffix).slice(0, 99);
    suffix++;
  }

  return name;
}

function inspectRequiredBacklogFieldsCompact() {
  assertAdmin_();

  const cfg = getRuntimeConfig_();

  if (
    !cfg.backlogSpaceUrl ||
    !cfg.backlogApiKey ||
    !cfg.backlogProjectKeys.length
  ) {
    throw new Error(
      'Backlog設定に必要な情報が不足しています。'
    );
  }

  const requiredFields = [
    {
      name: '【CS】案件タイプ',
      id: 1073837153
    },
    {
      name: 'SaaS-CSEG主担当',
      id: 1073830963
    },
    {
      name: '担当チーム(SaaS)',
      id: 1073880026
    },
    {
      name: 'CS起票内容評価',
      id: 1073850932
    },
    {
      name: '評価理由(CSEGからCS)',
      id: 1073852895
    },
    {
      name: '【CS】評価（質）',
      id: 1073854735
    },
    {
      name: '【CS】評価理由(CSからCSEG)',
      id: 1073852894
    },
    {
      name: '【CS】完了日',
      id: 1073856628
    },
    {
      name: '待ちフラグ',
      id: 1073883942
    },
    {
      name: 'エスカレ分類',
      id: 1073886391
    },
    {
      name: '【CS】期日マストフラグ',
      id: 1073903015
    },
    {
      name: '緊急募集フラグ',
      id: 1073908518
    }
  ];

  const results = [];

  cfg.backlogProjectKeys.forEach(function (projectKey) {
    const url =
      cfg.backlogSpaceUrl +
      '/api/v2/projects/' +
      encodeURIComponent(projectKey) +
      '/customFields?apiKey=' +
      encodeURIComponent(cfg.backlogApiKey);

    const fields = backlogFetchJson_(url);

    Logger.log('対象プロジェクト: ' + projectKey);
    Logger.log('カスタム項目総数: ' + fields.length);

    let foundCount = 0;
    const missingFields = [];

    requiredFields.forEach(function (requiredField) {
      const matchedField = fields.find(function (field) {
        const idMatches =
          requiredField.id !== null &&
          Number(field.id) === Number(requiredField.id);

        const nameMatches =
          String(field.name || '') === requiredField.name;

        return idMatches || nameMatches;
      });

      if (matchedField) {
        foundCount++;

        Logger.log(
          '取得可: ' +
          matchedField.name +
          ' / ID: ' +
          matchedField.id
        );

        return;
      }

      missingFields.push(requiredField.name);

      Logger.log('未発見: ' + requiredField.name);
    });

    Logger.log(
      '確認結果: ' +
      foundCount +
      ' / ' +
      requiredFields.length +
      '項目'
    );

    if (missingFields.length > 0) {
      Logger.log(
        '見つからなかった項目: ' +
        missingFields.join('、')
      );
    }

    results.push({
      projectKey: projectKey,
      foundCount: foundCount,
      totalCount: requiredFields.length,
      missingFields: missingFields
    });
  });

  return results;
}

function getBacklogSyncProgressV2() {
  assertAdmin_();

  const cfg = getRuntimeConfig_();

  const props =
    PropertiesService.getScriptProperties();

  const sheet =
    getDataSpreadsheet_()
      .getSheetByName('BacklogIssues');

  const importedCount = sheet
    ? Math.max(0, sheet.getLastRow() - 1)
    : 0;

  let expectedCount = 0;

  cfg.backlogProjectKeys.forEach(function (projectKey) {
    const projectId =
      resolveBacklogProjectId_(
        cfg,
        projectKey
      );

    const url =
      cfg.backlogSpaceUrl +
      '/api/v2/issues/count' +
      '?apiKey=' +
      encodeURIComponent(cfg.backlogApiKey) +
      '&projectId[]=' +
      encodeURIComponent(projectId);

    const result =
      backlogFetchJson_(url);

    expectedCount += Number(
      result.count || 0
    );
  });

  const syncStatus =
    props.getProperty(
      'BACKLOG_LAST_SYNC_STATUS'
    ) || '未設定';

  const syncStateText =
    props.getProperty(
      'BACKLOG_SYNC_STATE'
    );

  const syncState = syncStateText
    ? JSON.parse(syncStateText)
    : null;

  const continuationScheduled =
    ScriptApp.getProjectTriggers()
      .some(function (trigger) {
        const functionName =
          trigger.getHandlerFunction();

        return (
          functionName === 'continueBacklogSync_' ||
          functionName === 'continueBacklogSyncV2'
        );
      });

  const progressRate = expectedCount
    ? Math.round(
        importedCount /
        expectedCount *
        100
      )
    : 0;

  Logger.log(
    '取得済み: ' +
    importedCount +
    '件'
  );

  Logger.log(
    'Backlog全件: ' +
    expectedCount +
    '件'
  );

  Logger.log(
    '進捗: ' +
    progressRate +
    '%'
  );

  Logger.log(
    '同期状態: ' +
    syncStatus
  );

  Logger.log(
    '自動継続予約: ' +
    (
      continuationScheduled
        ? 'あり'
        : 'なし'
    )
  );

  if (syncState) {
    Logger.log(
      '現在の取得位置: ' +
      syncState.offset
    );
  }

  return {
    importedCount: importedCount,
    expectedCount: expectedCount,
    progressRate: progressRate,
    syncStatus: syncStatus,
    continuationScheduled: continuationScheduled,
    syncState: syncState
  };
}

function resumeBacklogSyncV2() {
  assertAdmin_();

  const props =
    PropertiesService.getScriptProperties();

  const syncState =
    props.getProperty(
      'BACKLOG_SYNC_STATE'
    );

  if (!syncState) {
    throw new Error(
      '再開可能な同期状態がありません。'
    );
  }

  Logger.log(
    '前回停止した位置から同期を再開します。'
  );

  return startBacklogSync_(
    'continuation'
  );
}
