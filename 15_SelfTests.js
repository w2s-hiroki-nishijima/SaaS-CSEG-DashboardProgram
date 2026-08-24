/**
 * スプレッドシートを変更せず、Apps Scriptエディタから実行できる軽量テスト。
 * 末尾がアンダースコアのためWeb画面からは直接公開されない。
 */
/** 主要な業務ルールを順番に検証し、成功・失敗件数を返す。 */
function runDomainSelfTests_() {
  const results = [];
  // 1つのテストを実行し、例外を失敗結果として記録する。
  function test(name, body) {
    try {
      body();
      results.push({ name: name, ok: true });
    } catch (error) {
      results.push({ name: name, ok: false, message: error.message });
    }
  }
  // 実際値と期待値を厳密比較し、不一致なら分かりやすい例外を投げる。
  function equal(actual, expected, message) {
    if (actual !== expected) {
      throw new Error((message || '値が一致しません。') + ' expected=' + expected + ' actual=' + actual);
    }
  }

  const actor = { email: 'tester@w2solution.co.jp', name: 'テスト担当' };
  const clock = function() { return '2026-08-23T12:00:00+09:00'; };
  const idFactory = function() { return 'fixed-id'; };

  test('改善要望の初期ステータスは未対応', function() {
    const report = FeedbackReportEntity.create({
      type: '不具合', title: '表示崩れ', description: '一覧が崩れる'
    }, actor, clock, idFactory);
    equal(report.status, '未対応');
    equal(report.reportId, 'feedback_fixed-id');
  });

  test('アサイン実績は負数を拒否する', function() {
    let rejected = false;
    try {
      AssignmentActualEntity.fromInput({ memberId: 'm1', month: '2026-08', responseHours: -1 });
    } catch (error) {
      rejected = error instanceof DomainValidationError;
    }
    equal(rejected, true);
  });

  test('目標件数を5.5時間基準で算出する', function() {
    equal(TargetSnapshotEntity.calculate(1.1, 55, 5, 0), 10);
  });

  test('マイルストーンと緊急加点を合算する', function() {
    equal(milestonePoint_('SaaS:中(5h)') + CSEG_APP.EMERGENCY_BONUS, 1.5);
    equal(milestonePoint_('SaaS:最大(20h)'), 2.5);
  });

  test('BacklogのTRUEを緊急扱いにする', function() {
    equal(toBoolean_(true), true);
    equal(toBoolean_('TRUE'), true);
    equal(toBoolean_('FALSE'), false);
  });

  test('Google認証用画面はiframe越しにlocationを直接操作しない', function() {
    const html = renderApplicationHtml_('dashboard', '2026-08', true).getContent();
    equal(html.indexOf('window.top.location'), -1, '禁止された画面遷移が残っています。');
    equal(html.indexOf('target="_top"') >= 0, true, '安全な戻りリンクがありません。');
  });

  const failed = results.filter(function(result) { return !result.ok; });
  return { ok: failed.length === 0, passed: results.length - failed.length, failed: failed.length, results: results };
}
