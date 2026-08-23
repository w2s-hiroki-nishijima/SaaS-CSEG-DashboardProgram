/** Google Sheets-backed data access. */
let _dataSpreadsheetMemo_ = null;
const _sheetMemo_ = {};
const _rowsMemo_ = {};

function getDataSpreadsheet_() {
  if (_dataSpreadsheetMemo_) return _dataSpreadsheetMemo_;
  const id = getRuntimeConfig_().dataSpreadsheetId;
  if (!id || id.indexOf('__') === 0) throw new Error('DATA_SPREADSHEET_ID が設定されていません。');
  _dataSpreadsheetMemo_ = SpreadsheetApp.openById(id);
  return _dataSpreadsheetMemo_;
}

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

function replaceAllRows_(sheetName, rows) {
  const sheet = getSheet_(sheetName);
  const headers = CSEG_SHEETS[sheetName];
  if (sheet.getLastRow() > 1) sheet.getRange(2, 1, sheet.getLastRow() - 1, headers.length).clearContent();
  appendRows_(sheetName, rows || []);
}

function clearSheetCache_(sheetName) {
  delete _rowsMemo_[sheetName];
  CacheService.getScriptCache().remove('rows:' + sheetName);
  CacheService.getScriptCache().remove('analytics:' + monthKey_());
}

function formatDataSheet_(sheet, columnCount) {
  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, 1, columnCount)
    .setBackground('#e5e7eb')
    .setFontWeight('bold')
    .setFontColor('#111827');
  sheet.getRange(1, 1, Math.max(sheet.getMaxRows(), 2), columnCount).createFilter();
  sheet.autoResizeColumns(1, Math.min(columnCount, 12));
}

function ensureSheetRowCapacity_(sheet, requiredLastRow) {
  const maxRows = sheet.getMaxRows();
  if (requiredLastRow > maxRows) {
    sheet.insertRowsAfter(maxRows, requiredLastRow - maxRows);
  }
}

function invalidateAllCaches_() {
  CacheService.getScriptCache().removeAll(Object.keys(CSEG_SHEETS).map(function(name) { return 'rows:' + name; }));
}

/** Returns the legacy monthly sheet title used by the team assignment workbook. */
function monthlyTeamSheetName_(month) {
  const key = monthKey_(month);
  return Number(key.slice(0, 4)) + '年' + Number(key.slice(5, 7)) + '月';
}

function getMonthlyTeamSheet_(month) {
  const sheetName = monthlyTeamSheetName_(month);
  const sheet = SpreadsheetApp.openById(CSEG_APP.MONTHLY_TEAM_SPREADSHEET_ID).getSheetByName(sheetName);
  if (!sheet) throw new Error(sheetName + ' の所属チームシートが見つかりません。元シートに月別タブを作成してください。');
  return sheet;
}

/** Reads member name (A) and team (C) from the legacy monthly workbook. */
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

/** Applies the selected month's team to the app member master without changing the master itself. */
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

/** Writes team values only to column C, preserving formulas and formatting in the legacy sheet. */
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
