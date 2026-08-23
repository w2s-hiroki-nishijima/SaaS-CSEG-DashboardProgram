/** Improvement requests and bug reports shared by all domain users. */
const CSEG_FEEDBACK = Object.freeze({
  TYPES: ['改善要望', '不具合', 'その他'],
  STATUSES: ['未対応', '確認中', '改修中', '完了']
});

function buildFeedbackData_(user) {
  return getApplicationServices_().feedback.getView(user);
}
