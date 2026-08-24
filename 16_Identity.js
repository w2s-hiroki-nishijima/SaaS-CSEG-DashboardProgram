/** Googleアカウントの固定IDとApps Script一時ユーザーキーによる本人確認を担当する。 */
const CSEG_IDENTITY = Object.freeze({
  AUTHORIZE_URL: 'https://accounts.google.com/o/oauth2/v2/auth',
  TOKEN_URL: 'https://oauth2.googleapis.com/token',
  TOKENINFO_URL: 'https://oauth2.googleapis.com/tokeninfo?id_token=',
  SESSION_SECONDS: 30 * 24 * 60 * 60,
  STATE_SECONDS: 10 * 60,
  SECRET_PROPERTY: 'APP_SESSION_SECRET'
});

/** 画面から呼び出せる業務RPCを明示し、任意のサーバー関数が実行されることを防ぐ。 */
function clientApiHandlers_() {
  return {
    getInitialView: getInitialView,
    getDashboardView: getDashboardView,
    getNavigationPrefetchData: getNavigationPrefetchData,
    getPerformanceView: getPerformanceView,
    getPerformanceMemberIssues: getPerformanceMemberIssues,
    getSkillView: getSkillView,
    getAssignmentView: getAssignmentView,
    getFeedbackView: getFeedbackView,
    getTargetView: getTargetView,
    getAggregateView: getAggregateView,
    getNotificationView: getNotificationView,
    getSettingsView: getSettingsView,
    saveSkillScore: saveSkillScore,
    saveSkillMaster: saveSkillMaster,
    saveAssignmentEntry: saveAssignmentEntry,
    submitFeedbackReport: submitFeedbackReport,
    addFeedbackComment: addFeedbackComment,
    updateFeedbackStatus: updateFeedbackStatus,
    saveNotificationRule: saveNotificationRule,
    saveAppSettings: saveAppSettings,
    saveMonthlyMemberSettings: saveMonthlyMemberSettings,
    manualBacklogSync: manualBacklogSync,
    rebuildAnalyticsCacheAfterBacklogSync: rebuildAnalyticsCacheAfterBacklogSync,
    resetMemberGoogleIdentity: resetMemberGoogleIdentity,
    logoutGoogleIdentity: logoutGoogleIdentity
  };
}

/** 画面から許可済みの業務関数だけを呼び出し、内部関数の任意実行を防ぐ。 */
function callClientApi(methodName, args) {
  const handlers = clientApiHandlers_();
  const name = String(methodName || '');
  if (!Object.prototype.hasOwnProperty.call(handlers, name)) throw new Error('許可されていない操作です。');
  return handlers[name].apply(null, Array.isArray(args) ? args : []);
}

/** Googleログインが設定済みかを、未認証のランディング画面へ返す。 */
function getPublicIdentityConfig() {
  const cfg = getRuntimeConfig_();
  return { configured: Boolean(cfg.googleIdentityClientId && cfg.googleIdentityClientSecret) };
}

/** 現在の画面へ戻るための署名付きstateを作り、GoogleログインURLを返す。 */
function createGoogleIdentitySignInUrl(route) {
  const cfg = getRuntimeConfig_();
  if (!cfg.googleIdentityClientId || !cfg.googleIdentityClientSecret) {
    throw new Error('Googleログイン設定が未完了です。管理者へ連絡してください。');
  }
  const input = route || {};
  const page = /^[a-z]+$/.test(String(input.page || '')) ? String(input.page) : 'dashboard';
  const month = /^\d{4}-\d{2}$/.test(String(input.month || '')) ? String(input.month) : '';
  const nonce = Utilities.getUuid();
  const state = createSignedIdentityPayload_({
    kind: 'google-oauth-state',
    page: page,
    month: month,
    nonce: nonce,
    exp: Math.floor(Date.now() / 1000) + CSEG_IDENTITY.STATE_SECONDS
  });
  const query = {
    client_id: cfg.googleIdentityClientId,
    redirect_uri: getGoogleIdentityRedirectUri_(),
    response_type: 'code',
    scope: 'openid email profile',
    state: state,
    nonce: nonce,
    access_type: 'online',
    prompt: 'select_account'
  };
  return CSEG_IDENTITY.AUTHORIZE_URL + '?' + Object.keys(query).map(function(key) {
    return encodeURIComponent(key) + '=' + encodeURIComponent(query[key]);
  }).join('&');
}

/** Googleから戻った認可コードをIDトークンへ交換し、一時ユーザーキーと固定IDを連携する。 */
function handleGoogleIdentityCallback_(params) {
  try {
    if (params.error) throw new Error('Googleログインがキャンセルされました。');
    const state = parseSignedIdentityPayload_(params.state, 'google-oauth-state');
    const tokenResponse = exchangeGoogleIdentityCode_(params.code);
    const claims = verifyGoogleIdentityToken_(tokenResponse.id_token, state.nonce);
    const user = linkGoogleIdentity_(claims);
    bindTemporaryIdentitySession_(claims.sub);
    const returnUrl = identityReturnUrl_(state.page, state.month);
    return identityRedirectHtml_(returnUrl, user.name);
  } catch (error) {
    return identityErrorHtml_(error && error.message ? error.message : CSEG_ACCESS_DENIED_MESSAGE);
  }
}

/** Googleの認可コードをサーバー間通信でIDトークンへ交換する。 */
function exchangeGoogleIdentityCode_(code) {
  if (!code) throw new Error('Googleログインの認可コードがありません。');
  const cfg = getRuntimeConfig_();
  const response = UrlFetchApp.fetch(CSEG_IDENTITY.TOKEN_URL, {
    method: 'post',
    payload: {
      code: String(code),
      client_id: cfg.googleIdentityClientId,
      client_secret: cfg.googleIdentityClientSecret,
      redirect_uri: getGoogleIdentityRedirectUri_(),
      grant_type: 'authorization_code'
    },
    muteHttpExceptions: true
  });
  const body = parseJson_(response.getContentText(), {});
  if (response.getResponseCode() !== 200 || !body.id_token) {
    throw new Error('Googleログインの確認に失敗しました。時間をおいて再度お試しください。');
  }
  return body;
}

/** IDトークンをGoogleへ照会し、発行先・発行者・期限・nonceを検証する。 */
function verifyGoogleIdentityToken_(idToken, expectedNonce) {
  const cfg = getRuntimeConfig_();
  const response = UrlFetchApp.fetch(CSEG_IDENTITY.TOKENINFO_URL + encodeURIComponent(String(idToken || '')), {
    muteHttpExceptions: true
  });
  const claims = parseJson_(response.getContentText(), {});
  const jwtClaims = decodeIdentityJwtPayload_(idToken);
  const now = Math.floor(Date.now() / 1000);
  const validIssuer = claims.iss === 'accounts.google.com' || claims.iss === 'https://accounts.google.com';
  if (response.getResponseCode() !== 200 || !claims.sub || claims.aud !== cfg.googleIdentityClientId ||
      !validIssuer || Number(claims.exp || 0) <= now || String(jwtClaims.nonce || '') !== String(expectedNonce || '')) {
    throw new Error('Googleアカウントを安全に確認できませんでした。');
  }
  if (!(claims.email_verified === true || String(claims.email_verified) === 'true')) {
    throw new Error('確認済みのGoogleアカウントを使用してください。');
  }
  return claims;
}

/** 初回は設定メールと照合して固定Google IDをメンバーへ紐づけ、以後は固定IDを更新する。 */
function linkGoogleIdentity_(claims) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    return linkGoogleIdentityLocked_(claims);
  } finally {
    lock.releaseLock();
  }
}

/** 排他ロック内でメールの初回照合と固定Google IDの保存を一続きに実行する。 */
function linkGoogleIdentityLocked_(claims) {
  const subject = String(claims.sub || '');
  const email = String(claims.email || '').trim().toLowerCase();
  const bindings = readRows_('IdentityBindings');
  let binding = bindings.find(function(row) { return String(row.googleSubject) === subject; }) || null;
  if (binding && !toBoolean_(binding.active)) throw new Error(CSEG_ACCESS_DENIED_MESSAGE);

  if (!binding) {
    const member = findMemberByEmail_(email);
    const memberActive = member && (member.active === '' || member.active == null || toBoolean_(member.active));
    const isAdmin = email ? isAdminEmail_(email) : false;
    if ((!member || !memberActive) && !isAdmin) throw new Error(CSEG_ACCESS_DENIED_MESSAGE);
    if (member) {
      const alreadyLinked = bindings.some(function(row) {
        return toBoolean_(row.active) && String(row.memberId) === String(member.memberId);
      });
      if (alreadyLinked) throw new Error('別のGoogleアカウントが連携済みです。管理者へ連絡してください。');
    }
    binding = {
      googleSubject: subject,
      memberId: member ? member.memberId : '',
      emailAtLink: email,
      currentEmail: email,
      linkedAt: nowIso_(),
      lastLoginAt: nowIso_(),
      active: true
    };
  } else {
    binding.currentEmail = email || binding.currentEmail;
    binding.lastLoginAt = nowIso_();
  }
  upsertRows_('IdentityBindings', [binding], ['googleSubject'], true);
  return userFromGoogleIdentityBinding_(binding);
}

/** 現在の一時ユーザーキーをハッシュ化し、連携済み固定Google IDから利用者を復元する。 */
function authenticateTemporaryIdentitySession_() {
  const temporaryKey = String(Session.getTemporaryActiveUserKey() || '');
  if (!temporaryKey) return null;
  const sessionKeyHash = hashTemporaryIdentityKey_(temporaryKey);
  const now = Math.floor(Date.now() / 1000);
  const session = readRows_('IdentitySessions').find(function(row) {
    return String(row.sessionKeyHash) === sessionKeyHash && toBoolean_(row.active) && Number(row.expiresAt || 0) > now;
  });
  if (!session) return null;
  const binding = readRows_('IdentityBindings').find(function(row) {
    return String(row.googleSubject) === String(session.googleSubject) && toBoolean_(row.active);
  });
  if (!binding) return null;
  return userFromGoogleIdentityBinding_(binding);
}

/** 固定Google IDの連携行から、既存画面と互換性のある利用者情報を組み立てる。 */
function userFromGoogleIdentityBinding_(binding) {
  const memberId = String(binding.memberId || '');
  const member = memberId ? readRows_('Members').find(function(row) {
    return String(row.memberId) === memberId;
  }) : null;
  const memberActive = member && (member.active === '' || member.active == null || toBoolean_(member.active));
  const email = String((member && member.email) || binding.currentEmail || binding.emailAtLink || '').toLowerCase();
  const isAdmin = Boolean(memberActive && member.role === 'admin') || (email ? isAdminEmail_(email) : false);
  if (memberId && !memberActive) throw new Error(CSEG_ACCESS_DENIED_MESSAGE);
  if (!memberId && !isAdmin) throw new Error(CSEG_ACCESS_DENIED_MESSAGE);
  return {
    email: email,
    name: member ? member.name : (email ? email.split('@')[0] : 'Googleユーザー'),
    memberId: member ? member.memberId : '',
    team: member ? member.team : '',
    isAdmin: isAdmin
  };
}

/** Googleログイン成功時の一時ユーザーキーを固定IDへ30日間紐づける。 */
function bindTemporaryIdentitySession_(subject) {
  const temporaryKey = String(Session.getTemporaryActiveUserKey() || '');
  if (!temporaryKey) throw new Error('Googleアカウントの一時識別情報を取得できませんでした。');
  const now = Math.floor(Date.now() / 1000);
  const session = {
    sessionKeyHash: hashTemporaryIdentityKey_(temporaryKey),
    googleSubject: String(subject),
    expiresAt: now + CSEG_IDENTITY.SESSION_SECONDS,
    createdAt: nowIso_(),
    active: true
  };
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const activeSessions = readRows_('IdentitySessions').filter(function(row) {
      return Number(row.expiresAt || 0) > now && String(row.sessionKeyHash) !== session.sessionKeyHash;
    });
    activeSessions.push(session);
    replaceAllRows_('IdentitySessions', activeSessions);
  } finally {
    lock.releaseLock();
  }
}

/** 一時ユーザーキーを復元できないSHA-256ハッシュへ変換する。 */
function hashTemporaryIdentityKey_(temporaryKey) {
  const bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    String(temporaryKey),
    Utilities.Charset.UTF_8
  );
  return Utilities.base64EncodeWebSafe(bytes).replace(/=+$/g, '');
}

/** 現在の一時ユーザーキーに対応するセッションだけを削除する。 */
function logoutGoogleIdentity() {
  assertAuthorizedUser_();
  const sessionKeyHash = hashTemporaryIdentityKey_(Session.getTemporaryActiveUserKey());
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const remaining = readRows_('IdentitySessions').filter(function(row) {
      return String(row.sessionKeyHash) !== sessionKeyHash;
    });
    replaceAllRows_('IdentitySessions', remaining);
    return { ok: true };
  } finally {
    lock.releaseLock();
  }
}

/** 対象メンバーの固定Google ID連携を削除し、次回ログインで新しいIDを紐づけられるようにする。 */
function resetGoogleIdentityBindingForMember_(memberId) {
  const target = String(memberId || '');
  if (!target) throw new Error('メンバーが指定されていません。');
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const bindings = readRows_('IdentityBindings');
    const subjects = bindings.filter(function(row) {
      return String(row.memberId) === target;
    }).map(function(row) { return String(row.googleSubject); });
    const remaining = bindings.filter(function(row) {
      return String(row.memberId) !== target;
    });
    replaceAllRows_('IdentityBindings', remaining);
    const remainingSessions = readRows_('IdentitySessions').filter(function(row) {
      return subjects.indexOf(String(row.googleSubject)) < 0;
    });
    replaceAllRows_('IdentitySessions', remainingSessions);
  } finally {
    lock.releaseLock();
  }
}

/** JSONペイロードへHMAC署名を付け、改ざんできないURLセーフトークンを作る。 */
function createSignedIdentityPayload_(payload) {
  const encoded = identityBase64UrlEncode_(JSON.stringify(payload || {}));
  return encoded + '.' + signIdentityValue_(encoded);
}

/** HMAC署名・用途・期限を確認して署名済みペイロードを復元する。 */
function parseSignedIdentityPayload_(token, expectedKind) {
  const parts = String(token || '').split('.');
  if (parts.length !== 2 || !constantTimeTextEquals_(parts[1], signIdentityValue_(parts[0]))) {
    throw new Error(CSEG_ACCESS_DENIED_MESSAGE);
  }
  let payload;
  try {
    payload = JSON.parse(identityBase64UrlDecode_(parts[0]));
  } catch (ignore) {
    throw new Error(CSEG_ACCESS_DENIED_MESSAGE);
  }
  if (payload.kind !== expectedKind || Number(payload.exp || 0) <= Math.floor(Date.now() / 1000)) {
    throw new Error(CSEG_ACCESS_DENIED_MESSAGE);
  }
  return payload;
}

/** Script Propertiesの秘密鍵を使い、値へSHA-256 HMAC署名を付ける。 */
function signIdentityValue_(value) {
  const bytes = Utilities.computeHmacSha256Signature(String(value), getIdentitySecret_());
  return Utilities.base64EncodeWebSafe(bytes).replace(/=+$/g, '');
}

/** 初回だけランダムなOAuth state署名鍵を生成し、以後の署名で再利用する。 */
function getIdentitySecret_() {
  const props = PropertiesService.getScriptProperties();
  let secret = props.getProperty(CSEG_IDENTITY.SECRET_PROPERTY);
  if (secret) return secret;
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    secret = props.getProperty(CSEG_IDENTITY.SECRET_PROPERTY);
    if (!secret) {
      secret = Utilities.getUuid() + Utilities.getUuid() + Utilities.getUuid();
      props.setProperty(CSEG_IDENTITY.SECRET_PROPERTY, secret);
    }
    return secret;
  } finally {
    lock.releaseLock();
  }
}

/** 署名比較の処理時間差を小さくし、推測攻撃を受けにくくする。 */
function constantTimeTextEquals_(left, right) {
  const a = String(left || '');
  const b = String(right || '');
  let difference = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let i = 0; i < length; i++) difference |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return difference === 0;
}

/** UTF-8文字列をURLセーフBase64へ変換する。 */
function identityBase64UrlEncode_(value) {
  return Utilities.base64EncodeWebSafe(Utilities.newBlob(String(value)).getBytes()).replace(/=+$/g, '');
}

/** URLセーフBase64をUTF-8文字列へ戻す。 */
function identityBase64UrlDecode_(value) {
  return Utilities.newBlob(Utilities.base64DecodeWebSafe(String(value))).getDataAsString();
}

/** Google IDトークンのペイロード部分をnonce確認用に復元する。 */
function decodeIdentityJwtPayload_(idToken) {
  try {
    const parts = String(idToken || '').split('.');
    return parts.length === 3 ? JSON.parse(identityBase64UrlDecode_(parts[1])) : {};
  } catch (ignore) {
    return {};
  }
}

/** 本番WebアプリのURLをGoogle OAuthの戻り先として返す。 */
function getGoogleIdentityRedirectUri_() {
  return String(ScriptApp.getService().getUrl() || '');
}

/** 元の画面条件を含む、ログイン完了後のWebアプリURLを作る。 */
function identityReturnUrl_(page, month) {
  const params = [];
  if (page) params.push('page=' + encodeURIComponent(page));
  if (month) params.push('month=' + encodeURIComponent(month));
  return getGoogleIdentityRedirectUri_() + (params.length ? '?' + params.join('&') : '');
}

/** Googleログイン成功後にWebアプリへ戻す最小HTMLを生成する。 */
function identityRedirectHtml_(returnUrl, userName) {
  const safeUrl = JSON.stringify(String(returnUrl)).replace(/</g, '\\u003c');
  const safeName = String(userName || '').replace(/[&<>"']/g, '');
  return HtmlService.createHtmlOutput(
    '<!doctype html><html lang="ja"><head><meta charset="utf-8"><base target="_top"></head>' +
    '<body style="font-family:sans-serif;text-align:center;padding:48px">' +
    '<p>' + safeName + ' さんとしてログインしました。画面へ戻ります...</p>' +
    '<script>window.top.location.replace(' + safeUrl + ');<\/script></body></html>'
  ).setTitle(CSEG_APP.NAME);
}

/** Googleログインに失敗した理由と再試行リンクを安全なHTMLで表示する。 */
function identityErrorHtml_(message) {
  const safeMessage = String(message || CSEG_ACCESS_DENIED_MESSAGE).replace(/[&<>"']/g, function(character) {
    return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character];
  });
  const safeUrl = String(getGoogleIdentityRedirectUri_()).replace(/"/g, '&quot;');
  return HtmlService.createHtmlOutput(
    '<!doctype html><html lang="ja"><head><meta charset="utf-8"><base target="_top"></head>' +
    '<body style="font-family:sans-serif;text-align:center;padding:48px"><h2>ログインできませんでした</h2>' +
    '<p>' + safeMessage + '</p><p><a href="' + safeUrl + '">TOPへ戻る</a></p></body></html>'
  ).setTitle(CSEG_APP.NAME);
}
