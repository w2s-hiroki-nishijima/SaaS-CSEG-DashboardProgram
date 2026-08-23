/** Dashboard, performance, target and aggregate calculations. */
function getMonthTargets_(month) {
  return readRows_('MonthlyTargets').filter(function(row) { return String(row.month) === month; });
}

function buildDashboardData_(month) {
  const snapshot = getMonthlyIssueSnapshot_(month);
  const overdue = getOverdueSnapshot_();
  const targets = getMonthTargets_(month);
  const target = sum_(targets, 'targetCount');
  const quality = snapshot.qualityCount ? snapshot.qualitySum / snapshot.qualityCount : null;
  return {
    month: month,
    lastSyncAt: PropertiesService.getScriptProperties().getProperty('BACKLOG_LAST_SYNC_AT') || '',
    kpis: {
      createdCount: snapshot.createdCount,
      completedCount: snapshot.completedCount,
      overdueCount: overdue.count,
      responsePoints: round_(snapshot.points, 2),
      targetCount: round_(target, 1),
      achievementRate: target ? snapshot.points / target : 0,
      qualityAverage: quality == null ? null : round_(quality, 2)
    },
    term: buildTermSummary_(),
    daily: buildDailySeriesFromSnapshot_(month, snapshot),
    teamSummary: buildTeamMetricsFromSnapshot_(snapshot, targets),
    overdueTickets: overdue.tickets || []
  };
}

function buildPerformanceData_(month) {
  const snapshot = getMonthlyIssueSnapshot_(month);
  const targets = getMonthTargets_(month);
  const members = readRows_('Members').filter(function(r) { return toBoolean_(r.active); });
  const byMember = {};
  members.forEach(function(m) {
    byMember[m.name] = {
      memberId: m.memberId, name: m.name, team: m.team, completedCount: 0, points: 0,
      emergencyCount: 0, qualitySum: 0, qualityCount: 0, tat2: 0, tat5: 0, tat6: 0, targetCount: 0
    };
  });
  targets.forEach(function(t) {
    const name = t.memberName || memberNameById_(t.memberId, members);
    if (!byMember[name]) byMember[name] = emptyMemberMetric_(name, t.team);
    byMember[name].targetCount += toNumber_(t.targetCount);
  });
  Object.keys(snapshot.members || {}).forEach(function(name) {
    const source = snapshot.members[name];
    if (!byMember[name]) byMember[name] = emptyMemberMetric_(name, source.team);
    const metric = byMember[name];
    metric.team = source.team || metric.team;
    metric.completedCount += toNumber_(source.completedCount);
    metric.points += toNumber_(source.points);
    metric.emergencyCount += toNumber_(source.emergencyCount);
    metric.qualitySum += toNumber_(source.qualitySum);
    metric.qualityCount += toNumber_(source.qualityCount);
    metric.tat2 += toNumber_(source.tat2);
    metric.tat5 += toNumber_(source.tat5);
    metric.tat6 += toNumber_(source.tat6);
  });
  const rows = Object.keys(byMember).map(function(name) {
    const m = byMember[name];
    return {
      memberId: m.memberId || '', name: m.name, team: m.team || '', completedCount: m.completedCount,
      points: round_(m.points, 2), emergencyCount: m.emergencyCount,
      qualityAverage: m.qualityCount ? round_(m.qualitySum / m.qualityCount, 2) : null,
      tat2: m.tat2, tat5: m.tat5, tat6: m.tat6,
      targetCount: round_(m.targetCount, 1), achievementRate: m.targetCount ? m.points / m.targetCount : 0
    };
  }).filter(function(r) { return r.completedCount || r.targetCount; });
  rows.sort(function(a, b) { return b.points - a.points || a.name.localeCompare(b.name, 'ja'); });
  return { month: month, rows: rows, teams: unique_(rows.map(function(r) { return r.team; }).filter(Boolean)) };
}

function buildTargetData_(month) {
  const members = readRows_('Members').filter(function(r) { return toBoolean_(r.active); });
  const current = readRows_('MonthlyTargets').filter(function(r) { return String(r.month) === month; });
  const byId = {};
  current.forEach(function(r) { byId[String(r.memberId)] = r; });
  return {
    month: month,
    baseHours: CSEG_APP.TARGET_BASE_HOURS,
    rows: members.map(function(m) {
      const row = byId[String(m.memberId)] || {};
      const speed = toNumber_(m.speedCoefficient, calculateSpeed_(m));
      const assignment = toNumber_(row.assignmentHours);
      const minus = toNumber_(row.minusHours);
      const adjustment = toNumber_(row.adjustmentHours);
      return {
        memberId: m.memberId, memberName: m.name, team: m.team,
        skillLevel: m.skillLevel, experienceLevel: m.experienceLevel, speedCoefficient: speed,
        assignmentHours: assignment, minusHours: minus, adjustmentHours: adjustment,
        supportHours: toNumber_(row.supportHours), targetCount: round_(Math.max(0, speed * (assignment - minus - adjustment) / CSEG_APP.TARGET_BASE_HOURS), 1)
      };
    })
  };
}

function buildAggregateData_(month) {
  const snapshot = getMonthlyIssueSnapshot_(month);
  const targets = getMonthTargets_(month);
  const overdue = getOverdueSnapshot_();
  const teams = buildTeamMetricsFromSnapshot_(snapshot, targets);
  teams.forEach(function(team) {
    team.createdCount = toNumber_((snapshot.createdByTeam || {})[team.name]);
    team.overdueCount = toNumber_((overdue.byTeam || {})[team.name]);
  });
  return {
    month: month,
    teams: teams,
    totals: {
      createdCount: snapshot.createdCount,
      completedCount: snapshot.completedCount,
      overdueCount: overdue.count,
      points: round_(snapshot.points, 2),
      targetCount: round_(sum_(targets, 'targetCount'), 1)
    },
    performance: buildPerformanceData_(month).rows
  };
}

function buildAssignmentData_(month, user) {
  const members = readRows_('Members').filter(function(r) { return toBoolean_(r.active); });
  const rows = readRows_('AssignmentEntries').filter(function(r) { return String(r.month) === month; });
  rows.sort(function(a, b) { return String(b.weekStart).localeCompare(String(a.weekStart)); });
  return { month: month, user: user, members: members, rows: rows };
}

function buildSkillData_(user) {
  const master = readRows_('SkillMaster').filter(function(r) { return toBoolean_(r.active); });
  master.sort(function(a, b) { return toNumber_(a.displayOrder) - toNumber_(b.displayOrder); });
  return {
    user: user,
    members: readRows_('Members').filter(function(r) { return toBoolean_(r.active); }),
    skills: master,
    scores: readRows_('SkillScores')
  };
}

function buildTermSummary_() {
  const cfg = getRuntimeConfig_();
  const start = new Date(cfg.termStartDate + 'T00:00:00+09:00');
  const end = new Date(start); end.setMonth(end.getMonth() + 3); end.setDate(end.getDate() - 1);
  const startKey = dateKey_(start); const endKey = dateKey_(end);
  const cache = getAnalyticsCacheMap_();
  let points = 0;
  Object.keys(cache).forEach(function(key) {
    if (key.indexOf('month:') !== 0) return;
    const month = key.slice(6);
    if (month < startKey.slice(0, 7) || month > endKey.slice(0, 7)) return;
    Object.keys(cache[key].dailyPoints || {}).forEach(function(date) {
      if (date >= startKey && date <= endKey) points += toNumber_(cache[key].dailyPoints[date]);
    });
  });
  const targets = readRows_('MonthlyTargets').filter(function(r) { return String(r.month) >= startKey.slice(0, 7) && String(r.month) <= endKey.slice(0, 7); });
  const target = sum_(targets, 'targetCount');
  return { label: startKey + ' 〜 ' + endKey, points: round_(points, 2), targetCount: round_(target, 1), achievementRate: target ? points / target : 0 };
}

function buildDailySeriesFromSnapshot_(month, snapshot) {
  const year = Number(month.slice(0, 4)); const mon = Number(month.slice(5, 7));
  const days = new Date(year, mon, 0).getDate();
  const out = [];
  for (let d = 1; d <= days; d++) {
    const key = month + '-' + String(d).padStart(2, '0');
    out.push({
      date: key,
      created: toNumber_((snapshot.dailyCreated || {})[key]),
      completed: toNumber_((snapshot.dailyCompleted || {})[key])
    });
  }
  return out;
}

function buildTeamMetricsFromSnapshot_(snapshot, targets) {
  const map = {};
  function ensure(name) {
    if (!map[name]) map[name] = { name: name, completedCount: 0, points: 0, targetCount: 0, qualitySum: 0, qualityCount: 0, tat2: 0, tat5: 0, tat6: 0 };
    return map[name];
  }
  (targets || []).forEach(function(row) {
    ensure(String(row.team || '未設定')).targetCount += toNumber_(row.targetCount);
  });
  Object.keys(snapshot.teams || {}).forEach(function(name) {
    const source = snapshot.teams[name];
    const metric = ensure(name);
    metric.completedCount += toNumber_(source.completedCount);
    metric.points += toNumber_(source.points);
    metric.qualitySum += toNumber_(source.qualitySum);
    metric.qualityCount += toNumber_(source.qualityCount);
    metric.tat2 += toNumber_(source.tat2);
    metric.tat5 += toNumber_(source.tat5);
    metric.tat6 += toNumber_(source.tat6);
  });
  return Object.keys(map).map(function(name) {
    const metric = map[name];
    return {
      name: name,
      completedCount: metric.completedCount,
      points: round_(metric.points, 2),
      targetCount: round_(metric.targetCount, 1),
      achievementRate: metric.targetCount ? metric.points / metric.targetCount : 0,
      qualityAverage: metric.qualityCount ? round_(metric.qualitySum / metric.qualityCount, 2) : null,
      tat2: metric.tat2,
      tat5: metric.tat5,
      tat6: metric.tat6
    };
  }).sort(function(a, b) { return b.points - a.points; });
}

function buildDailySeries_(month, created, completed) {
  const year = Number(month.slice(0, 4)); const mon = Number(month.slice(5, 7));
  const days = new Date(year, mon, 0).getDate();
  const createdMap = {}; const completedMap = {};
  created.forEach(function(r) { createdMap[r.createdAt] = (createdMap[r.createdAt] || 0) + 1; });
  completed.forEach(function(r) { completedMap[r.closedAt] = (completedMap[r.closedAt] || 0) + 1; });
  const out = [];
  for (let d = 1; d <= days; d++) {
    const key = month + '-' + String(d).padStart(2, '0');
    out.push({ date: key, created: createdMap[key] || 0, completed: completedMap[key] || 0 });
  }
  return out;
}

function groupMetrics_(completed, targets, field) {
  const map = {};
  function ensure(name) { if (!map[name]) map[name] = { name: name, completedCount: 0, points: 0, targetCount: 0, quality: [], tat2: 0, tat5: 0, tat6: 0 }; return map[name]; }
  targets.forEach(function(r) { ensure(String(r[field] || '未設定')).targetCount += toNumber_(r.targetCount); });
  completed.forEach(function(r) {
    const m = ensure(String(r[field] || '未設定'));
    m.completedCount++; m.points += toNumber_(r.point, 1);
    const q = Number(r.qualityScore); if (isFinite(q) && r.qualityScore !== '') m.quality.push(q);
    const tat = Number(r.tatBusinessDays);
    if (isFinite(tat) && r.tatBusinessDays !== '') { if (tat <= 2) m.tat2++; else if (tat <= 5) m.tat5++; else m.tat6++; }
  });
  return Object.keys(map).map(function(name) {
    const m = map[name];
    return { name: name, completedCount: m.completedCount, points: round_(m.points, 2), targetCount: round_(m.targetCount, 1), achievementRate: m.targetCount ? m.points / m.targetCount : 0, qualityAverage: m.quality.length ? round_(average_(m.quality), 2) : null, tat2: m.tat2, tat5: m.tat5, tat6: m.tat6 };
  }).sort(function(a, b) { return b.points - a.points; });
}

function isClosedIssue_(row) {
  return Boolean(row.closedAt) || Number(row.statusId) === 4 || CSEG_APP.CLOSED_STATUS_NAMES.indexOf(String(row.status || '')) >= 0;
}

function issueListItem_(r) { return { issueKey: r.issueKey, summary: r.summary, dueDate: r.dueDate, status: r.status, owner: r.csegOwner || r.assigneeName, team: r.team, url: r.url }; }
function memberNameById_(id, members) { const m = members.find(function(v) { return String(v.memberId) === String(id); }); return m ? m.name : ''; }
function emptyMemberMetric_(name, team) { return { name: name, team: team || '', completedCount: 0, points: 0, emergencyCount: 0, qualitySum: 0, qualityCount: 0, tat2: 0, tat5: 0, tat6: 0, targetCount: 0 }; }
function calculateSpeed_(m) { const skill = coefficient_('skill', m.skillLevel); const exp = coefficient_('experience', m.experienceLevel); return round_(skill * exp, 4); }
function coefficient_(kind, code) { const r = readRows_('TargetCoefficients').find(function(v) { return v.kind === kind && v.code === code; }); return r ? toNumber_(r.coefficient, 1) : 1; }
function sum_(rows, field) { return rows.reduce(function(total, r) { return total + toNumber_(r[field]); }, 0); }
function average_(values) { return values.length ? values.reduce(function(a, b) { return a + b; }, 0) / values.length : null; }
function round_(value, digits) { const p = Math.pow(10, digits || 0); return Math.round((Number(value) + Number.EPSILON) * p) / p; }
function unique_(values) { return values.filter(function(v, i, a) { return a.indexOf(v) === i; }); }
