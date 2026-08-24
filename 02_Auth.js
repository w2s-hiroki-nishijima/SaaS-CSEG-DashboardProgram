/** 設定済みメールアドレス、管理者、本人更新のアクセス制御を行う。 */
const CSEG_ACCESS_DENIED_MESSAGE = '閲覧権限がありません。管理者へ連絡お願いします';
/** 現在Webアプリを操作しているGoogleアカウントのメールアドレスを取得する。 */
function getActiveEmail_() {
  return String(Session.getActiveUser().getEmail() || '').trim().toLowerCase();
}

/** 設定タブの有効メンバーまたは管理者メールに登録されていることを検証する。 */
function assertAuthorizedUser_() {
  const cfg = getRuntimeConfig_();
  if (cfg.googleIdentityClientId && cfg.googleIdentityClientSecret) {
    const identityUser = authenticateTemporaryIdentitySession_();
    if (identityUser) return identityUser;
    throw new Error(CSEG_ACCESS_DENIED_MESSAGE);
  }
  const email = getActiveEmail_();
  const authorizedEmails = unique_(cfg.authorizedEmails.concat(cfg.adminEmails));
  const isAdmin = email ? isAdminEmail_(email) : false;
  if (!email || (authorizedEmails.indexOf(email) < 0 && !isAdmin)) {
    throw new Error(CSEG_ACCESS_DENIED_MESSAGE);
  }
  const props = PropertiesService.getScriptProperties();
  if (isAdmin && props.getProperty('AUTHORIZED_EMAILS') === null) {
    syncAuthorizedAccessFromMembers_();
  }
  const member = findMemberByEmail_(email);
  return {
    email: email,
    name: member ? member.name : email.split('@')[0],
    memberId: member ? member.memberId : '',
    team: member ? member.team : '',
    isAdmin: isAdmin
  };
}

/** 現在の利用者が管理者であることを検証する。 */
function assertAdmin_() {
  const user = assertAuthorizedUser_();
  if (!user.isAdmin) throw new Error('管理者権限が必要です。');
  return user;
}

/** メール設定、メンバーマスタ、Google Groupのいずれかから管理者かを判定する。 */
function isAdminEmail_(email) {
  const cfg = getRuntimeConfig_();
  if (cfg.adminEmails.indexOf(String(email).toLowerCase()) >= 0) return true;
  if (!cfg.adminGroupEmail) return false;
  const cache = CacheService.getScriptCache();
  const cacheKey = 'admin-check:' + Utilities.base64EncodeWebSafe(String(email).toLowerCase()).slice(0, 100);
  const cached = cache.get(cacheKey);
  if (cached !== null) return cached === '1';
  try {
    const isAdmin = GroupsApp.getGroupByEmail(cfg.adminGroupEmail).hasUser(email);
    cache.put(cacheKey, isAdmin ? '1' : '0', 600);
    return isAdmin;
  } catch (err) {
    console.warn('Google Group administrator check failed: ' + err.message);
    return false;
  }
}

/** メンバーマスタからメールアドレスが一致する有効メンバーを検索する。 */
function findMemberByEmail_(email) {
  if (!email) return null;
  const key = String(email).toLowerCase();
  const rows = readRows_('Members');
  for (let i = 0; i < rows.length; i++) {
    if (String(rows[i].email || '').toLowerCase() === key) return rows[i];
  }
  return null;
}

/** 対象メンバー本人または管理者だけが更新できることを検証する。 */
function assertMemberWrite_(memberId) {
  const user = assertAuthorizedUser_();
  if (user.isAdmin) return user;
  if (!user.memberId) throw new Error('設定画面でメンバーとメールアドレスを紐付けてください。');
  if (String(user.memberId) !== String(memberId)) throw new Error('自分以外のデータは更新できません。');
  return user;
}
