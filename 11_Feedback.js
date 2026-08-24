/** 全ドメインユーザーで共有する改善要望・不具合報告の定数と互換処理。 */
const CSEG_FEEDBACK = Object.freeze({
  TYPES: ['改善要望', '不具合', 'その他'],
  STATUSES: ['未対応', '確認中', '改修中', '完了']
});

/** Feedback Application Serviceから報告・コメント一覧のViewModelを取得する。 */
function buildFeedbackData_(user) {
  return getApplicationServices_().feedback.getView(user);
}
