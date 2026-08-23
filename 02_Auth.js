/** Domain and administrator authorization. */
function getActiveEmail_() {
  return String(Session.getActiveUser().getEmail() || '').trim().toLowerCase();
}

function assertDomainUser_() {
  const email = getActiveEmail_();
  const cfg = getRuntimeConfig_();
  if (!email) {
    throw new Error('Googleアカウントを確認できません。W2アカウントでログインし、ウェブアプリの公開範囲がW2ドメイン内になっていることを確認してください。');
  }
  if (cfg.allowedDomain && !email.endsWith('@' + cfg.allowedDomain.toLowerCase())) {
    throw new Error('このアプリはW2ドメインのユーザーのみ利用できます。');
  }
  const member = findMemberByEmail_(email);
  return {
    email: email,
    name: member ? member.name : email.split('@')[0],
    memberId: member ? member.memberId : '',
    team: member ? member.team : '',
    isAdmin: isAdminEmail_(email)
  };
}

function assertAdmin_() {
  const user = assertDomainUser_();
  if (!user.isAdmin) throw new Error('管理者権限が必要です。');
  return user;
}

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

function findMemberByEmail_(email) {
  if (!email) return null;
  const key = String(email).toLowerCase();
  const rows = readRows_('Members');
  for (let i = 0; i < rows.length; i++) {
    if (String(rows[i].email || '').toLowerCase() === key) return rows[i];
  }
  return null;
}

function assertMemberWrite_(memberId) {
  const user = assertDomainUser_();
  if (user.isAdmin) return user;
  if (!user.memberId) throw new Error('設定画面でメンバーとメールアドレスを紐付けてください。');
  if (String(user.memberId) !== String(memberId)) throw new Error('自分以外のデータは更新できません。');
  return user;
}
