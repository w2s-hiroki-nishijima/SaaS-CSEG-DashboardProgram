/** アプリ内部シートと外部月別ブックの共通読書きを担当する。 */
let _dataSpreadsheetMemo_ = null;
const _sheetMemo_ = {};
const _rowsMemo_ = {};

/** Script Propertiesで指定されたアプリデータブックを開き、実行中は再利用する。 */
function getDataSpreadsheet_() {
  if (_dataSpreadsheetMemo_) return _dataSpreadsheetMemo_;
  const id = getRuntimeConfig_().dataSpreadsheetId;
  if (!id || id.indexOf('__') === 0) throw new Error('DATA_SPREADSHEET_ID が設定されていません。');
  _dataSpreadsheetMemo_ = SpreadsheetApp.openById(id);
  return _dataSpreadsheetMemo_;
}

/** スキーマ登録済みのシートを取得し、存在しなければ見出し付きで作成する。 */
function getSheet_(sheetName) {
  if (!CSEG_SHEETS[sheetName]) throw new Error('不明なデータシートです: ' + sheetName);
  if (_sheetMemo_[sheetName]) return _sheetMemo_[sheetName];
  const ss = getDataSpreadsheet_();
  let sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
    sheet.getRange(1, 1, 1, CSEG_SHEETS[sheetName].length).setValues([sheetHeaderLabels_(sheetName)]);
    formatDataSheet_(sheet, CSEG_SHEETS[sheetName].length);
  }
  _sheetMemo_[sheetName] = sheet;
  return sheet;
}

/** シート全行を内部列名のオブジェクト配列として読み、短時間キャッシュする。 */
function readRows_(sheetName) {
  if (_rowsMemo_[sheetName]) return _rowsMemo_[sheetName];
  const cache = CacheService.getScriptCache();
  const cacheKey = 'rows:' + sheetName;
  const cached = cache.get(cacheKey);
  if (cached && cached.length < 95000) {
    try {
      _rowsMemo_[sheetName] = JSON.parse(cached);
      return _rowsMemo_[sheetName];
    } catch (ignore) {}
  }
  const sheet = getSheet_(sheetName);
  const lastRow = sheet.getLastRow();
  const headers = CSEG_SHEETS[sheetName];
  if (lastRow < 2) {
    _rowsMemo_[sheetName] = [];
    return _rowsMemo_[sheetName];
  }
  const values = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
  const rows = values.filter(function(row) { return row.some(function(v) { return v !== ''; }); }).map(function(row) {
    const out = {};
    headers.forEach(function(h, i) {
      const v = row[i];
      out[h] = v instanceof Date ? Utilities.formatDate(v, CSEG_APP.TIMEZONE, "yyyy-MM-dd'T'HH:mm:ssXXX") : v;
    });
    return out;
  });
  try {
    const json = JSON.stringify(rows);
    if (json.length < 95000) cache.put(cacheKey, json, CSEG_APP.CACHE_SECONDS);
  } catch (ignore) {}
  _rowsMemo_[sheetName] = rows;
  return _rowsMemo_[sheetName];
}

/** 既存行を変更せず、指定したオブジェクト配列をシート末尾へ追加する。 */
function appendRows_(sheetName, rows) {
  if (!rows || !rows.length) return;
  const sheet = getSheet_(sheetName);
  const headers = CSEG_SHEETS[sheetName];
  const values = rows.map(function(row) { return headers.map(function(h) { return row[h] == null ? '' : row[h]; }); });
  const startRow = sheet.getLastRow() + 1;
  ensureSheetRowCapacity_(sheet, startRow + values.length - 1);
  sheet.getRange(startRow, 1, values.length, headers.length).setValues(values);
  clearSheetCache_(sheetName);
}

/** キー列が一致する行を更新し、存在しない行は追加する。 */
function upsertRows_(sheetName, rows, keyFields, lockAlreadyHeld) {
  if (!rows || !rows.length) return { inserted: 0, updated: 0 };
  const lock = lockAlreadyHeld ? null : LockService.getScriptLock();
  if (lock) lock.waitLock(30000);
  try {
    const sheet = getSheet_(sheetName);
    const headers = CSEG_SHEETS[sheetName];
    const keyIndexes = keyFields.map(function(k) { return headers.indexOf(k); });
    const lastRow = sheet.getLastRow();
    const existing = lastRow > 1 ? sheet.getRange(2, 1, lastRow - 1, headers.length).getValues() : [];
    const rowByKey = {};
    existing.forEach(function(row, index) {
      const key = keyIndexes.map(function(i) { return String(row[i] || ''); }).join('\u001f');
      if (key) rowByKey[key] = index + 2;
    });
    const appends = [];
    let updated = 0;
    rows.forEach(function(obj) {
      const row = headers.map(function(h) { return obj[h] == null ? '' : obj[h]; });
      const key = keyIndexes.map(function(i) { return String(row[i] || ''); }).join('\u001f');
      if (rowByKey[key]) {
        sheet.getRange(rowByKey[key], 1, 1, headers.length).setValues([row]);
        updated++;
      } else {
        appends.push(row);
      }
    });
    if (appends.length) {
      const startRow = sheet.getLastRow() + 1;
      ensureSheetRowCapacity_(sheet, startRow + appends.length - 1);
      sheet.getRange(startRow, 1, appends.length, headers.length).setValues(appends);
    }
    clearSheetCache_(sheetName);
    return { inserted: appends.length, updated: updated };
  } finally {
    if (lock) lock.releaseLock();
  }
}

/** 見出しを残してデータ行を全置換し、集計キャッシュなどの再生成に使用する。 */
function replaceAllRows_(sheetName, rows) {
  const sheet = getSheet_(sheetName);
  const headers = CSEG_SHEETS[sheetName];
  if (sheet.getLastRow() > 1) sheet.getRange(2, 1, sheet.getLastRow() - 1, headers.length).clearContent();
  appendRows_(sheetName, rows || []);
}

/** 指定シートの読取キャッシュだけを削除する。 */
function clearSheetCache_(sheetName) {
  delete _rowsMemo_[sheetName];
  CacheService.getScriptCache().remove('rows:' + sheetName);
  CacheService.getScriptCache().remove('analytics:' + monthKey_());
}

/** 新規データシートへ見出し書式、フィルター、列幅を設定する。 */
function formatDataSheet_(sheet, columnCount) {
  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, 1, columnCount)
    .setBackground('#e5e7eb')
    .setFontWeight('bold')
    .setFontColor('#111827');
  sheet.getRange(1, 1, Math.max(sheet.getMaxRows(), 2), columnCount).createFilter();
  sheet.autoResizeColumns(1, Math.min(columnCount, 12));
}

/** 書込み予定の最終行まで不足している行数を追加する。 */
function ensureSheetRowCapacity_(sheet, requiredLastRow) {
  const maxRows = sheet.getMaxRows();
  if (requiredLastRow > maxRows) {
    sheet.insertRowsAfter(maxRows, requiredLastRow - maxRows);
  }
}

/** アプリ内部の全シート読取キャッシュを一括削除する。 */
function invalidateAllCaches_() {
  CacheService.getScriptCache().removeAll(Object.keys(CSEG_SHEETS).map(function(name) { return 'rows:' + name; }));
}

/** 対象月から「2026年8月」形式の月別シート名を生成する。 */
function monthlyTeamSheetName_(month) {
  const key = monthKey_(month);
  return Number(key.slice(0, 4)) + '年' + Number(key.slice(5, 7)) + '月';
}

/** 月別所属・目標ブックから対象月タブを取得する。 */
function getMonthlyTeamSheet_(month) {
  const sheetName = monthlyTeamSheetName_(month);
  const sheet = SpreadsheetApp.openById(CSEG_APP.MONTHLY_TEAM_SPREADSHEET_ID).getSheetByName(sheetName);
  if (!sheet) throw new Error(sheetName + ' の所属チームシートが見つかりません。元シートに月別タブを作成してください。');
  return sheet;
}

/** 月別所属・目標ブックのA列から氏名、C列から所属チームを読み込む。 */
function readMonthlyTeamMembership_(month) {
  const sheet = getMonthlyTeamSheet_(month);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  return sheet.getRange(2, 1, lastRow - 1, 3).getDisplayValues()
    .map(function(row, index) {
      return { rowNumber: index + 2, name: String(row[0] || '').trim(), team: String(row[2] || '').trim() };
    })
    .filter(function(row) { return row.name; });
}

/** 月別所属・目標ブックのA～H列から対象月の目標スナップショットを読み込む。 */
function readMonthlyTargetRows_(month) {
  const sheet = getMonthlyTeamSheet_(month);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  const values = sheet.getRange(2, 1, lastRow - 1, 8).getValues();
  const displays = sheet.getRange(2, 1, lastRow - 1, 8).getDisplayValues();
  const membersByName = {};
  readRows_('Members').forEach(function(member) {
    membersByName[String(member.name || '').trim()] = member;
  });
  return values.map(function(row, index) {
    const shown = displays[index];
    const name = String(shown[0] || '').trim();
    if (!name) return null;
    const member = membersByName[name] || {};
    const combinedLevel = String(shown[1] || '').trim();
    const separator = combinedLevel.lastIndexOf('-');
    const skillLevel = separator > 0 ? combinedLevel.slice(0, separator) : String(member.skillLevel || combinedLevel);
    const experienceLevel = separator > 0 ? 'CSEG' + combinedLevel.slice(separator + 1) : String(member.experienceLevel || '');
    return {
      rowNumber: index + 2,
      month: monthKey_(month),
      memberId: member.memberId || 'sheet:' + name,
      memberName: name,
      team: String(shown[2] || '').trim(),
      skillLevel: skillLevel,
      experienceLevel: experienceLevel,
      speedCoefficient: toNumber_(row[3]),
      assignmentHours: toNumber_(row[4]),
      minusHours: toNumber_(row[5]),
      adjustmentHours: toNumber_(row[6]),
      supportHours: 0,
      targetCount: toNumber_(row[7])
    };
  }).filter(Boolean);
}

/** 月別の算定時間と計算済み目標をE～H列へ固定スナップショットとして保存する。 */
function saveMonthlyTargetRows_(month, rows) {
  const sheet = getMonthlyTeamSheet_(month);
  const source = readMonthlyTargetRows_(month);
  const byId = {};
  source.forEach(function(row) { byId[String(row.memberId)] = row; });
  rows.forEach(function(input) {
    const current = byId[String(input.memberId)];
    if (!current) throw new Error('月別目標シートにメンバーが見つかりません: ' + input.memberId);
    const assignment = nonNegative_(input.assignmentHours);
    const minus = nonNegative_(input.minusHours);
    const adjustment = nonNegative_(input.adjustmentHours);
    const target = TargetSnapshotEntity.calculate(current.speedCoefficient, assignment, minus, adjustment);
    sheet.getRange(current.rowNumber, 5, 1, 4).setValues([[assignment, minus, adjustment, target]]);
  });
}

/** 対象月からアサイン活用報告タブ名を生成する。 */
function monthlyAssignmentSheetName_(month) {
  return monthlyTeamSheetName_(month) + 'アサイン活用報告';
}

/** アサイン活用報告ブックから対象月タブを取得する。 */
function getMonthlyAssignmentSheet_(month) {
  const sheetName = monthlyAssignmentSheetName_(month);
  const sheet = SpreadsheetApp.openById(CSEG_APP.ASSIGNMENT_SPREADSHEET_ID).getSheetByName(sheetName);
  if (!sheet) throw new Error(sheetName + ' がアサイン活用報告シートに見つかりません。');
  return sheet;
}

/** 空白表記を除去し、ブック間でメンバー名を照合するためのキーを作る。 */
function assignmentMemberKey_(value) {
  return String(value || '').replace(/[\s\u3000]+/g, '').trim();
}

/** 対象月の予定・実績アサインを数式列を含めて読み込み、画面用の行へ変換する。 */
function readMonthlyAssignmentRows_(month) {
  const sheet = getMonthlyAssignmentSheet_(month);
  const lastRow = sheet.getLastRow();
  if (lastRow < 4) return [];
  const values = sheet.getRange(1, 1, lastRow, 10).getValues();
  const displays = sheet.getRange(1, 1, lastRow, 10).getDisplayValues();
  const formulas = sheet.getRange(1, 1, lastRow, 10).getFormulas();
  const membersByName = {};
  readRows_('Members').forEach(function(member) {
    membersByName[assignmentMemberKey_(member.name)] = member;
  });
  const teamsByName = {};
  readMonthlyTeamMembership_(month).forEach(function(row) {
    teamsByName[assignmentMemberKey_(row.name)] = row.team;
  });
  return values.map(function(row, index) {
    const name = String(displays[index][0] || '').trim();
    const rowNumber = index + 1;
    const actualFormula = String(formulas[index][4] || '').trim();
    const plannedFormula = String(formulas[index][7] || '').trim();
    if (!name || !actualFormula || !plannedFormula) return null;
    const key = assignmentMemberKey_(name);
    const member = membersByName[key] || {};
    return {
      rowNumber: rowNumber, month: monthKey_(month),
      memberId: member.memberId || 'sheet:' + key, memberName: name,
      team: teamsByName[key] || member.team || '',
      responseHours: toNumber_(row[1]), improvementHours: toNumber_(row[2]),
      specialHours: toNumber_(row[3]), actualHours: toNumber_(row[4]),
      plannedStartHours: toNumber_(row[5]), plannedAdjustmentHours: toNumber_(row[6]),
      plannedHours: toNumber_(row[7]), remainingHours: toNumber_(row[8]),
      updatedAt: row[9] instanceof Date
        ? Utilities.formatDate(row[9], CSEG_APP.TIMEZONE, 'yyyy-MM-dd HH:mm')
        : String(displays[index][9] || '')
    };
  }).filter(Boolean);
}

/** 対象メンバーの実績内訳B～D列と更新日時J列だけを保存する。 */
function saveMonthlyAssignmentActual_(month, input) {
  const sheet = getMonthlyAssignmentSheet_(month);
  const current = readMonthlyAssignmentRows_(month).find(function(row) {
    return String(row.memberId) === String(input.memberId);
  });
  if (!current) throw new Error('アサイン活用報告シートにメンバーが見つかりません。');
  sheet.getRange(current.rowNumber, 2, 1, 3).setValues([[
    nonNegative_(input.responseHours), nonNegative_(input.improvementHours), nonNegative_(input.specialHours)
  ]]);
  sheet.getRange(current.rowNumber, 10).setValue(new Date());
  SpreadsheetApp.flush();
  return current;
}

/** メンバーマスタを変更せず、選択月の所属チームを重ねたメンバー一覧を返す。 */
function getMembersForMonth_(month) {
  const members = readRows_('Members').filter(function(r) { return toBoolean_(r.active); });
  const byName = {};
  readMonthlyTeamMembership_(month).forEach(function(row) { byName[row.name] = row.team; });
  return members.map(function(member) {
    const out = Object.assign({}, member);
    if (Object.prototype.hasOwnProperty.call(byName, member.name)) out.team = byName[member.name];
    return out;
  });
}

/** 数式と書式を保ったまま、月別所属シートのC列だけを更新する。 */
function saveMonthlyTeamMembership_(month, rows) {
  const sheet = getMonthlyTeamSheet_(month);
  const existing = readMonthlyTeamMembership_(month);
  const rowByName = {};
  existing.forEach(function(row) { rowByName[row.name] = row.rowNumber; });
  const missing = [];
  rows.forEach(function(row) {
    const name = String(row.name || '').trim();
    if (!rowByName[name]) missing.push(name);
  });
  if (missing.length) throw new Error('月別シートに存在しないメンバーがあります: ' + missing.join('、'));
  rows.forEach(function(row) {
    sheet.getRange(rowByName[String(row.name).trim()], 3).setValue(String(row.team || '').trim());
  });
}
