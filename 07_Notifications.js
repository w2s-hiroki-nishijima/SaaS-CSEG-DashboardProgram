/** 有効な通知ルールを定期評価し、条件を満たす通知を送信する。 */
/** トリガー実行時に全通知ルールを評価し、必要なメッセージを配信する。 */
function runNotificationJobs_() {
  const rules = readRows_('NotificationRules').filter(function(r) { return toBoolean_(r.enabled); });
  rules.forEach(function(rule) {
    try {
      if (!shouldRunRule_(rule)) return;
      const message = buildNotificationMessage_(rule);
      if (!message) return;
      dispatchNotification_(rule, message);
      rule.lastRunAt = nowIso_();
      rule.updatedAt = nowIso_();
      upsertRows_('NotificationRules', [rule], ['ruleId']);
    } catch (err) {
      console.error('Notification rule failed: ' + rule.name + ' / ' + err.message);
    }
  });
}

/** 通知ルールの実行周期と曜日から、現在実行すべきか判定する。 */
function shouldRunRule_(rule) {
  const now = new Date();
  const today = dateKey_(now);
  if (String(rule.lastRunAt || '').slice(0, 10) === today) return false;
  if (rule.schedule === 'weekly') {
    const names = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
    if (names[now.getDay()] !== String(rule.dayOfWeek || '').toLowerCase()) return false;
  }
  return true;
}

/** 通知種別に応じて対象データを集計し、送信本文を生成する。 */
function buildNotificationMessage_(rule) {
  if (rule.type === 'overdue_tickets') {
    const overdue = getOverdueSnapshot_();
    if (!overdue.count) return '';
    return (rule.message || '期限超過チケットがあります。') + '\n件数: ' + overdue.count + '\n' + (overdue.tickets || []).slice(0, 10).map(function(i) { return i.issueKey + ' ' + i.summary; }).join('\n');
  }
  if (rule.type === 'missing_assignment') {
    const month = monthKey_();
    const entries = readMonthlyAssignmentRows_(month);
    const missing = entries.filter(function(row) { return !row.updatedAt; });
    if (!missing.length) return '';
    return (rule.message || '今月のアサイン実績が未入力です。') + '\n未入力: ' + missing.map(function(row) { return row.memberName; }).join('、');
  }
  if (rule.type === 'sync_error') {
    const status = PropertiesService.getScriptProperties().getProperty('BACKLOG_LAST_SYNC_STATUS') || '';
    if (status.indexOf('error') !== 0) return '';
    return (rule.message || 'Backlog同期でエラーが発生しました。') + '\n' + status;
  }
  return '';
}

/** 通知ルールで指定されたメールまたはSlackへメッセージを送信する。 */
function dispatchNotification_(rule, message) {
  if (rule.channel === 'none') return;
  if (rule.channel === 'email') {
    const recipients = splitCsv_(rule.recipients);
    if (!recipients.length) throw new Error('メール送信先が設定されていません。');
    MailApp.sendEmail({ to: recipients.join(','), subject: '[CSEG Dashboard] ' + rule.name, body: message });
    return;
  }
  if (rule.channel === 'slack') {
    const url = getRuntimeConfig_().slackWebhookUrl;
    if (!url) throw new Error('SLACK_WEBHOOK_URL が設定されていません。');
    UrlFetchApp.fetch(url, { method: 'post', contentType: 'application/json', payload: JSON.stringify({ text: message }), muteHttpExceptions: true });
  }
}

/** 指定日が属する週の月曜日を返す。 */
function getMonday_(date) {
  const d = new Date(date); const day = d.getDay();
  d.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
  return dateKey_(d);
}
