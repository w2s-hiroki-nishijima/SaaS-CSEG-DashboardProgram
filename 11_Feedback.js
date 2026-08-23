/** Improvement requests and bug reports shared by all domain users. */
const CSEG_FEEDBACK = Object.freeze({
  TYPES: ['改善要望', '不具合', 'その他'],
  STATUSES: ['未対応', '確認中', '改修中', '完了']
});

function buildFeedbackData_(user) {
  const commentsByReport = {};
  readRows_('FeedbackComments').forEach(function(comment) {
    const reportId = String(comment.reportId || '');
    if (!commentsByReport[reportId]) commentsByReport[reportId] = [];
    commentsByReport[reportId].push(comment);
  });
  Object.keys(commentsByReport).forEach(function(reportId) {
    commentsByReport[reportId].sort(function(a, b) {
      return String(a.createdAt || '').localeCompare(String(b.createdAt || ''));
    });
  });
  const reports = readRows_('FeedbackReports').map(function(report) {
    const out = Object.assign({}, report);
    out.comments = commentsByReport[String(report.reportId || '')] || [];
    return out;
  });
  reports.sort(function(a, b) {
    const aComplete = String(a.status) === '完了' ? 1 : 0;
    const bComplete = String(b.status) === '完了' ? 1 : 0;
    return aComplete - bComplete || String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || ''));
  });
  return { user: user, types: CSEG_FEEDBACK.TYPES, statuses: CSEG_FEEDBACK.STATUSES, reports: reports };
}
