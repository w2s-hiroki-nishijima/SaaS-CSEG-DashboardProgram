/** LLM を使わずコストゼロで C#・JS エラーを読解する唯一のエントリポイント。言語・種別・発生箇所の3段階で情報を絞り込み、辞書から原因と対処を返す。 */
function analyzeErrorLogLocal_(text) {
  const lang  = detectErrorLanguage_(text);
  const info  = extractErrorInfo_(text, lang);
  const entry = findErrorEntry_(info.type, info.message, lang);
  return buildAnalysisText_(lang, info, entry);
}

/** C# と JS はスタックトレースの記法が異なる（.cs:line vs .js:行:列）ため、スコアリングで言語を推定する。後続の例外抽出・辞書引きの前提となる。 */
function detectErrorLanguage_(text) {
  const csScore = (/ at [\w.<>, ]+\(| in .+\.cs:line |\bSystem\.\w+Exception\b|場所 System\./.test(text) ? 2 : 0)
                + (/\.cs(:\d+)?|AspNetCore|EntityFramework|\.NET/.test(text) ? 1 : 0);
  const jsScore = (/ at .+\.[jt]sx?:\d+:\d+| at [\w$.]+ \(.+\.[jt]sx?:\d+/.test(text) ? 2 : 0)
                + (/\.[jt]sx?:\d+|webpack:|node:internal/.test(text) ? 1 : 0);
  if (csScore === 0 && jsScore === 0) return 'unknown';
  return csScore >= jsScore ? 'csharp' : 'javascript';
}

/** 先頭6行に走査を限定するのは、長大なスタックトレースで無関係な内部フレームを拾わないため。UnhandledPromiseRejection は前置きプレフィックスを除去してから照合する。 */
function extractErrorInfo_(text, lang) {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  let type = '', message = '', location = '';

  for (let i = 0; i < Math.min(lines.length, 6); i++) {
    const bare = lines[i].replace(/^(?:Uncaught\s+|UnhandledPromiseRejectionWarning:\s*)/, '');
    let m = bare.match(/^(?:[\w.]+\.)?([\w]+Exception)(?::[ \t]*(.+))?$/);
    if (!m) m = bare.match(/^(TypeError|ReferenceError|SyntaxError|RangeError|URIError|EvalError|AggregateError|Error)(?::[ \t]*(.+))?$/i);
    if (m) { type = m[1]; message = (m[2] || '').trim(); break; }
    if (/UnhandledPromiseRejection/.test(lines[i])) {
      type = 'UnhandledPromiseRejection';
      message = lines[i].replace(/.*UnhandledPromiseRejectionWarning:\s*/, '').slice(0, 200);
      break;
    }
  }
  if (!type && lang === 'csharp') {
    for (const entry of JAPANESE_CSHARP_TYPE_PATTERNS_) {
      if (!entry.pattern.test(text)) continue;
      type = entry.type;
      const textLines = text.split('\n');
      for (const line of textLines) {
        const bare = line.replace(/^[ \t]*->[ \t]*/, '');
        if (bare !== line && entry.pattern.test(bare)) { message = bare.trim().slice(0, 200); break; }
      }
      break;
    }
    if (!type) type = 'Unknown';
  }
  if (!type) type = 'Unknown';

  if (lang === 'csharp') {
    const loc = text.match(/ in (.+\.cs):line (\d+)/)
             || text.match(/(\S+\.(?:aspx\.cs|ascx\.cs|cs)):行 (\d+)/);
    if (loc) location = loc[1].replace(/.*[/\\]/, '') + ' ' + loc[2] + '行目';
  } else {
    const loc = text.match(/ at [\w$.<>]+ \((.+\.[jt]sx?):(\d+):\d+\)/)
             || text.match(/at (.+\.[jt]sx?):(\d+):\d+/);
    if (loc) location = loc[1].replace(/.*[/\\]/, '') + ' ' + loc[2] + '行目';
  }

  return { type, message, location };
}

/** .NET が日本語環境で出力するエラーメッセージから例外クラス名を推定するパターンテーブル。上位パターンほど具体的になるよう順序を維持する。 */
const JAPANESE_CSHARP_TYPE_PATTERNS_ = [
  { pattern: /にキャストできません/,                                      type: 'InvalidCastException' },
  { pattern: /オブジェクト参照がオブジェクト インスタンスに設定されていません/, type: 'NullReferenceException' },
  { pattern: /値を [Nn]ull にすることはできません/,                        type: 'ArgumentNullException' },
  { pattern: /インデックスが配列の境界の外/,                               type: 'IndexOutOfRangeException' },
  { pattern: /指定された引数は.+有効な範囲/,                               type: 'ArgumentOutOfRangeException' },
  { pattern: /入力文字列の形式が正しくありません/,                          type: 'FormatException' },
  { pattern: /算術演算の結果オーバーフロー/,                               type: 'OverflowException' },
  { pattern: /0 で除算/,                                                 type: 'DivideByZeroException' },
  { pattern: /コレクションが変更されました/,                               type: 'InvalidOperationException' },
  { pattern: /シーケンスに要素が含まれていません/,                          type: 'InvalidOperationException' },
  { pattern: /破棄されたオブジェクト/,                                    type: 'ObjectDisposedException' },
  { pattern: /スタック オーバーフロー/,                                   type: 'StackOverflowException' },
  { pattern: /メモリが不足/,                                             type: 'OutOfMemoryException' },
  { pattern: /指定されたファイルが見つかりません/,                          type: 'FileNotFoundException' },
  { pattern: /指定されたパスの一部が見つかりません/,                        type: 'DirectoryNotFoundException' },
  { pattern: /アクセスが拒否されました/,                                  type: 'UnauthorizedAccessException' },
  { pattern: /指定されたキーはディレクトリに存在しませんでした/,              type: 'KeyNotFoundException' },
  { pattern: /メソッドまたは操作は実装されていません/,                      type: 'NotImplementedException' },
  { pattern: /指定されたメソッドはサポートされていません/,                   type: 'NotSupportedException' },
  { pattern: /操作がタイムアウト/,                                        type: 'TimeoutException' },
  { pattern: /タスクはキャンセルされました/,                               type: 'TaskCanceledException' },
  { pattern: /操作はキャンセルされました/,                                 type: 'OperationCanceledException' },
];

/** 日本語 .NET エラーメッセージから例外クラス名を推定する。一致しない場合は null を返す。 */
function detectJapaneseCsharpType_(text) {
  for (const entry of JAPANESE_CSHARP_TYPE_PATTERNS_) {
    if (entry.pattern.test(text)) return entry.type;
  }
  return null;
}

/** C# の主要例外と対処のマスタ。例外クラス名をキーとして原因・対処・代表的なメッセージ・調査手順を保持する。辞書に存在しない例外はフォールバックメッセージで対応する。 */
const CSHARP_ERROR_DICT_ = {
  NullReferenceException: {
    cause: 'null のオブジェクトに対してメンバーアクセスが発生しています。',
    suggestions: [
      'アクセス前に null チェックを追加する（if (obj != null) または obj?.Property）',
      '変数が正しく初期化されているか、依存注入が機能しているか確認する',
      'null 条件演算子 ?. や null 合体演算子 ?? の活用を検討する'
    ],
    typicalMessage: 'オブジェクト参照がオブジェクト インスタンスに設定されていません。',
    steps: [
      'スタックトレースからnull参照が発生したメソッドと行番号を把握する',
      '該当行で`.`でアクセスしているオブジェクト（変数・プロパティ・戻り値）のうちnullになりうるものを特定する',
      'そのオブジェクトにnullが流れてくる代入元・戻り値元・引数の渡し元を追う'
    ]
  },
  ArgumentNullException: {
    cause: 'null を渡してはいけない引数に null が渡されています。',
    suggestions: [
      '呼び出し元で null でないことを確認してから渡す',
      'メソッド先頭で ArgumentNullException.ThrowIfNull() を使用した防御チェックを追加する'
    ],
    typicalMessage: '値をNullにすることはできません。パラメーター名: paramName',
    steps: [
      'メッセージからnullを渡してはいけないパラメータ名（paramName）を把握する',
      '例外をスローしているメソッドのシグネチャとnullチェック箇所を読む',
      'そのメソッドの呼び出し元でnullを渡している箇所を特定する'
    ]
  },
  ArgumentException: {
    cause: '引数の値が不正です。',
    suggestions: [
      'メッセージ中の引数名を確認し、許容値の範囲を見直す',
      '呼び出し元でバリデーションを追加する'
    ],
    typicalMessage: '[理由を示すメッセージ] パラメーター名: paramName',
    steps: [
      'メッセージから不正な引数のパラメータ名（paramName）と無効な理由を把握する',
      '例外をスローしているバリデーション箇所を読み、有効値の条件を確認する',
      '条件を満たさない値を渡している呼び出し元を特定する'
    ]
  },
  ArgumentOutOfRangeException: {
    cause: '引数が許容範囲外（インデックス超過など）です。',
    suggestions: [
      'インデックス参照前に Count/Length と比較するチェックを追加する',
      'LINQ の ElementAtOrDefault() など安全なメソッドの使用を検討する'
    ],
    typicalMessage: '指定された引数は有効な値の範囲外です。パラメーター名: paramName（実際の値はX）',
    steps: [
      'メッセージからパラメータ名（paramName）と実際の値（X）を把握する',
      '例外をスローしているメソッドの有効な範囲の上限・下限を確認する',
      '範囲外の値が流れてくる入力元・計算元を特定する'
    ]
  },
  InvalidOperationException: {
    cause: 'オブジェクトの現在の状態ではその操作は実行できません。',
    suggestions: [
      'foreach 中にコレクションを変更していないか確認する',
      '接続・トランザクションが適切な状態にあるか確認する',
      '操作の前提条件（初期化・開始処理）が揃っているか見直す'
    ],
    typicalMessage: '[オブジェクトの状態が原因を示すメッセージ]',
    steps: [
      'メッセージから操作が無効である理由（オブジェクトのどの状態が前提を満たしていないか）を把握する',
      '例外をスローしているメソッドの呼び出しが許可される事前条件を確認する',
      '事前条件を満たさない状態でそのメソッドを呼び出している箇所を特定する'
    ]
  },
  ObjectDisposedException: {
    cause: '既に Dispose() されたオブジェクトを使用しようとしています。',
    suggestions: [
      'using ブロックの外でオブジェクトを参照していないか確認する',
      '非同期処理で Dispose のタイミングがずれていないか確認する'
    ],
    typicalMessage: "破棄されたオブジェクトにアクセスできません。オブジェクト名: 'TypeName'",
    steps: [
      'メッセージから破棄済みオブジェクトの型名（TypeName）を把握する',
      'そのオブジェクトのDisposeまたはusing終端の箇所を特定する',
      'Dispose後にそのオブジェクトへアクセスしている箇所を特定する'
    ]
  },
  IndexOutOfRangeException: {
    cause: '配列またはコレクションの範囲外インデックスにアクセスしています。',
    suggestions: [
      'ループ・参照前に Length/Count を確認する',
      'インデックス計算のオフバイワンエラーを見直す'
    ],
    typicalMessage: 'インデックスが配列の境界外でした。',
    steps: [
      'スタックトレースからインデックスアクセスが発生したメソッドと行番号を把握する',
      '該当行でアクセスしているインデックス値（変数・式）とコレクションを確認する',
      'インデックス値とコレクションのサイズがそれぞれどこで決まるかを追い、不一致が生じる条件を特定する'
    ]
  },
  KeyNotFoundException: {
    cause: 'Dictionary に存在しないキーへのアクセスが発生しています。',
    suggestions: [
      'dict[key] の代わりに dict.TryGetValue(key, out var value) を使用する',
      'ContainsKey() でキーの存在確認を行ってからアクセスする'
    ],
    typicalMessage: '指定されたキーはディクショナリ内に存在しませんでした。',
    steps: [
      'スタックトレースからDictionaryアクセスが発生したメソッドと行番号を把握する',
      '該当行でアクセスしているキー（変数・式）とDictionaryを確認する',
      'そのキーがDictionaryに登録されるべき箇所（Add/[]への代入）と、登録が漏れる・キーが変わる条件を特定する'
    ]
  },
  FormatException: {
    cause: '文字列を数値・日付などへ変換する際に形式が不正です。',
    suggestions: [
      'int.Parse() の代わりに int.TryParse() を使用する',
      '入力値のフォーマットを事前にバリデーションする',
      'DateTime.ParseExact() で期待するフォーマットを明示する'
    ],
    typicalMessage: '入力文字列の形式が正しくありません。',
    steps: [
      'スタックトレースから変換処理（Parse/Convert等）が発生したメソッドと行番号を把握する',
      '期待するフォーマットと変換メソッドを確認する',
      '変換対象の値がどの入力元（フォーム・DB・外部API）から来るか、不正な形式が混入するパターンを特定する'
    ]
  },
  OverflowException: {
    cause: '演算結果が型の最大値/最小値を超えています。',
    suggestions: [
      'long など範囲の大きい型に変更する',
      '入力値の範囲制限を追加する',
      'unchecked ブロックで意図的なラップアラウンドを使用する'
    ],
    typicalMessage: '算術演算の結果オーバーフローが発生しました。',
    steps: [
      'スタックトレースからオーバーフローが発生したメソッドと行番号を把握する',
      '演算の型（int/long等）と演算子を確認する',
      '想定外に大きな値が流れてくる入力元・計算元を特定する'
    ]
  },
  FileNotFoundException: {
    cause: '指定されたパスのファイルが存在しません。',
    suggestions: [
      'File.Exists() で存在確認してからアクセスする',
      'パスが絶対パスか相対パスか、実行ディレクトリを確認する',
      'デプロイ時にファイルが含まれているか確認する'
    ],
    typicalMessage: "'C:\\path\\to\\file.txt' ファイルが見つかりません。",
    steps: [
      'メッセージから存在しないファイルの絶対パスを把握する',
      'そのパスを組み立てているコードを特定する',
      'パスの各要素（ベースディレクトリ・サブパス・ファイル名・拡張子）がどこから来るかを追い、欠落・誤りが生じる条件を特定する'
    ]
  },
  DirectoryNotFoundException: {
    cause: '指定されたディレクトリパスが存在しません。',
    suggestions: [
      'Directory.Exists() で確認する',
      'Directory.CreateDirectory() で自動生成を検討する'
    ],
    typicalMessage: "'C:\\path\\to\\dir' の一部または全部のパスが見つかりません。",
    steps: [
      'メッセージから存在しないディレクトリの絶対パスを把握する',
      'そのパスを組み立てているコードを特定する',
      'パスの各要素がどこから来るかを追い、欠落・誤りが生じる条件を特定する'
    ]
  },
  IOException: {
    cause: 'ファイルやストリームの入出力操作でエラーが発生しています。',
    suggestions: [
      'ファイルが他のプロセスにロックされていないか確認する',
      'ディスク容量や書き込み権限を確認する',
      'using ブロックで Stream を確実に閉じる'
    ],
    typicalMessage: '[具体的なI/Oエラーメッセージ（ファイル占有・読み取り専用等）]',
    steps: [
      'メッセージからI/Oエラーの具体的な理由（ファイル占有・アクセス権・ディスク容量等）を把握する',
      'ファイル・ストリーム操作箇所を読む',
      'エラー理由に応じてファイルの占有プロセス・アクセス権設定・ディスク残量・パスの妥当性を確認する'
    ]
  },
  UnauthorizedAccessException: {
    cause: 'ファイルやリソースへのアクセス権限がありません。',
    suggestions: [
      '実行ユーザーのファイルシステム権限を確認する',
      '読み取り専用属性が設定されていないか確認する',
      '管理者権限が必要な操作でないか確認する'
    ],
    typicalMessage: "パス 'C:\\path' へのアクセスが拒否されました。",
    steps: [
      'メッセージからアクセスが拒否されたリソースのパスを把握する',
      'そのリソースへのアクセスコードを特定する',
      '実行アカウント（IISアプリケーションプール等）と対象リソースのアクセス権設定を照合する'
    ]
  },
  HttpRequestException: {
    cause: 'HTTP リクエストが失敗しています（ネットワークエラーまたはサーバーエラー）。',
    suggestions: [
      'URL が正しいか、エンドポイントが稼働しているか確認する',
      '4xx はリクエスト側の問題、5xx はサーバー側の問題として切り分ける',
      'タイムアウト設定や再試行ロジックの追加を検討する'
    ],
    typicalMessage: 'Response status code does not indicate success: 4XX/5XX',
    steps: [
      'メッセージからHTTPステータスコードまたは接続エラーの種類（名前解決失敗・接続拒否等）を把握する',
      'HTTPリクエストを送信しているコードのリクエストURL・ヘッダー・ボディを確認する',
      'ステータスコードの原因（認証エラー・リソース不在・サーバーエラー等）に応じてエンドポイント側のログ・設定を確認する'
    ]
  },
  TimeoutException: {
    cause: '操作が制限時間内に完了しませんでした。',
    suggestions: [
      'タイムアウト値を見直す、または CancellationToken で適切に処理する',
      '処理量が増大していないかパフォーマンスを確認する',
      'デッドロックが発生していないか非同期処理を確認する'
    ],
    typicalMessage: '[タイムアウトした操作を示すメッセージ]',
    steps: [
      'メッセージとスタックトレースからタイムアウトした操作と設定されているタイムアウト値を把握する',
      'タイムアウト値を設定しているコードを特定する',
      '対象操作の実際の所要時間（DBクエリ・外部API応答等）とタイムアウト値のギャップを確認する'
    ]
  },
  TaskCanceledException: {
    cause: 'CancellationToken によりタスクがキャンセルされました。',
    suggestions: [
      'キャンセルが意図的なものか確認する',
      'タイムアウト起因の場合は TimeoutException と同様に対処する',
      'catch で TaskCanceledException を個別にハンドリングする'
    ],
    typicalMessage: 'タスクは取り消されました。',
    steps: [
      'InnerExceptionを確認し、明示的なキャンセル（Cancel()呼び出し）かタイムアウト起因かを判別する',
      'CancellationTokenSourceの発行箇所とキャンセルトリガー（CancelAfter/手動Cancel）を特定する',
      'キャンセル要求が発生したタイミングとキャンセルを受け取ったタスクの処理内容を照合する'
    ]
  },
  OperationCanceledException: {
    cause: '操作がキャンセルされました（CancellationToken 経由）。',
    suggestions: [
      'キャンセルが意図的かどうかを確認する',
      'catch で個別にハンドリングして上位へ適切に伝播させる'
    ],
    typicalMessage: '操作はキャンセルされました。',
    steps: [
      'InnerExceptionを確認し、明示的なキャンセルかタイムアウト起因かを判別する',
      'CancellationTokenSourceの発行箇所とキャンセルトリガーを特定する',
      'キャンセル要求が発生したタイミングとキャンセルを受け取った操作の処理内容を照合する'
    ]
  },
  StackOverflowException: {
    cause: '再帰呼び出しが深くなりすぎてスタック領域を使い果たしました。',
    suggestions: [
      '無限再帰になっていないか終了条件を確認する',
      '再帰をループや明示的なスタック（Stack<T>）で書き直す'
    ],
    typicalMessage: '（スタックトレースに同一メソッドが繰り返し登場する）',
    steps: [
      'スタックトレースから繰り返し登場するメソッド名を特定する',
      'そのメソッド内の再帰呼び出し箇所を読み、終了条件を確認する',
      '終了条件が満たされない入力パターンまたは呼び出し経路を特定する'
    ]
  },
  OutOfMemoryException: {
    cause: 'マネージドヒープのメモリが不足しています。',
    suggestions: [
      '大量データを一括ロードしていないか確認する（ストリーミング処理を検討）',
      'IDisposable オブジェクトの解放漏れがないか確認する',
      '64bit プロセスへの移行やメモリ制限の見直しを検討する'
    ],
    typicalMessage: 'メモリが不足しています。',
    steps: [
      'スタックトレースからメモリ確保に失敗した操作（コレクション生成・ファイル読み込み等）を把握する',
      '大量メモリを消費する処理（大規模コレクション・ファイル全件読み込み・大量DataBind等）を特定する',
      'メモリが解放されない原因（静的フィールドへの蓄積・イベントハンドラによる参照保持等）または想定外の大量データを確認する'
    ]
  },
  NotImplementedException: {
    cause: '未実装のメソッドまたは機能が呼び出されました。',
    suggestions: [
      'スタックトレースで該当メソッドを特定し実装する',
      'インターフェースや抽象クラスの実装漏れがないか確認する'
    ],
    typicalMessage: 'メソッドまたは操作は実装されていません。',
    steps: [
      'スタックトレースからthrow new NotImplementedException()が存在するメソッド名を特定する',
      'そのメソッドの定義を読み、インターフェース・抽象クラスの未実装メンバーか、意図的な暫定実装かを確認する',
      'その呼び出し経路がなぜそのメソッドに到達したかを追う'
    ]
  },
  NotSupportedException: {
    cause: 'この環境またはオブジェクトの状態ではサポートされていない操作です。',
    suggestions: [
      '使用しているプラットフォーム・バージョンでサポートされているか確認する',
      '代替 API を調査する'
    ],
    typicalMessage: '[サポートされていない操作を示すメッセージ]',
    steps: [
      'メッセージからサポートされていない操作を把握する',
      '例外をスローしているメソッドを読み、どの型・状態のときにサポート外とするかを確認する',
      '呼び出し元のオブジェクトの型・状態がその条件に該当するかを照合する'
    ]
  },
  InvalidCastException: {
    cause: '互換性のない型へのキャストが発生しています。',
    suggestions: [
      'as 演算子で null チェックと組み合わせてキャストする（直接キャストより安全）',
      'is でキャスト可能か事前に確認する',
      '型階層・継承関係を見直す'
    ],
    typicalMessage: "型 'A' のオブジェクトを型 'B' にキャストできません。場所 Form_Dir_File.Event(...)",
    steps: [
      'メッセージから期待型（B）・実型（A）・イベントハンドラ名（Event）を把握する',
      'エラー発生行のキャスト元・キャスト先を確認する',
      'コントロール型が異なる呼び出し箇所を特定する'
    ]
  },
  DivideByZeroException: {
    cause: '整数をゼロで除算しています。',
    suggestions: [
      '除数が 0 でないことを確認してから演算する',
      '浮動小数点の場合は例外にならず Infinity になるため double.IsInfinity() で確認する'
    ],
    typicalMessage: '0 で除算しようとしました。',
    steps: [
      'スタックトレースから除算が発生したメソッドと行番号を把握する',
      '除数となっている変数・式を確認する',
      '除数が0になる入力パターンまたは計算経路を特定する'
    ]
  },
  AggregateException: {
    cause: '複数の非同期タスクや PLINQ で複数の例外が集約されています。',
    suggestions: [
      '.InnerExceptions を列挙して個々の例外を確認する',
      '.Flatten() で入れ子の AggregateException を展開してから処理する',
      '.Handle() で特定の例外だけをハンドリングすることも可能'
    ],
    typicalMessage: '1 つ以上のエラーが発生しました。',
    steps: [
      'InnerExceptionsを列挙し、各内部例外の型・メッセージ・スタックトレースを把握する',
      '例外が発生した並列処理またはタスク処理（Task.WhenAll/Parallel.ForEach等）の箇所を特定する',
      '各内部例外に対して対応する例外種別の調査手順を個別に適用する'
    ]
  },
  AccessViolationException: {
    cause: '保護されたメモリへのアクセス違反です（アンマネージドコード起因が多い）。',
    suggestions: [
      'P/Invoke や unsafe コードのポインタ操作を確認する',
      'アンマネージドライブラリのバージョン互換性を確認する',
      'ハンドルや参照の二重解放が発生していないか確認する'
    ],
    typicalMessage: '保護されているメモリに読み取りまたは書き込み操作を実行しようとしました。',
    steps: [
      'スタックトレースからP/InvokeまたはアンセーフコードのP/Invoke呼び出し箇所を特定する',
      'ポインタ操作・アンマネージリソースへのアクセスコードを読む',
      'ポインタの有効期間とアンマネージメモリの解放タイミングを確認し、解放後アクセスや不正ポインタ演算がないかを照合する'
    ]
  },
  TypeInitializationException: {
    cause: '静的コンストラクタまたは静的フィールドの初期化中に例外が発生しています。',
    suggestions: [
      '.InnerException を確認して根本原因を特定する',
      '静的フィールドの初期化処理（設定値読み込みなど）を確認する'
    ],
    typicalMessage: "'TypeName' の型初期化子が例外をスローしました。",
    steps: [
      'メッセージから初期化に失敗した型名（TypeName）を把握し、InnerExceptionで実際の例外を確認する',
      'その型の静的コンストラクタ・静的フィールドの初期化コードを読む',
      '初期化時に依存しているリソース（設定値・ファイル・外部サービス・他の型の静的メンバー等）が実行時に取得できていない原因を確認する'
    ]
  }
};

/** JS は同じ TypeError でも message の内容によって原因と対処が大きく異なるため、type だけでなく message パターンでも絞り込む。上位パターンほど具体的になるよう順序を維持する。 */
const JS_ERROR_PATTERNS_ = [
  {
    type: 'TypeError',
    pattern: /Cannot read propert(?:y|ies) of null/i,
    cause: 'null に対してプロパティアクセスが発生しています。',
    suggestions: [
      'アクセス前に null チェックを追加する、またはオプショナルチェーン (?.) を使用する',
      'データ取得・非同期処理の完了を待ってからアクセスしているか確認する'
    ]
  },
  {
    type: 'TypeError',
    pattern: /Cannot read propert(?:y|ies) of undefined/i,
    cause: 'undefined に対してプロパティアクセスが発生しています。',
    suggestions: [
      'オプショナルチェーン obj?.prop を使用する',
      '変数が期待どおりに初期化・代入されているか確認する',
      'API レスポンスや非同期処理の結果が undefined になっていないか確認する'
    ]
  },
  {
    type: 'TypeError',
    pattern: /Cannot set propert(?:y|ies) of (null|undefined)/i,
    cause: 'null または undefined に対してプロパティ代入が発生しています。',
    suggestions: [
      '代入対象のオブジェクトが存在するか確認する',
      '非同期処理の await 位置を見直す'
    ]
  },
  {
    type: 'TypeError',
    pattern: /is not a function/i,
    cause: '関数として呼び出している値が実際には関数ではありません。',
    suggestions: [
      'スペルミスや大文字/小文字の誤りがないか確認する',
      '正しくインポート・エクスポートされているか確認する',
      'コールバックや非同期処理で undefined が渡っていないか確認する'
    ]
  },
  {
    type: 'TypeError',
    pattern: /is not iterable/i,
    cause: 'for...of やスプレッド構文などで、イテラブルでない値を反復しようとしています。',
    suggestions: [
      '変数が配列・Map 等のイテラブルな型か確認する',
      'API レスポンスが配列でない場合のフォールバック（|| []）を追加する'
    ]
  },
  {
    type: 'TypeError',
    pattern: /(?:map|filter|reduce|forEach|find|some|every) is not a function/i,
    cause: '配列メソッドを配列以外の値に対して呼び出しています。',
    suggestions: [
      'Array.isArray() で変数が配列かどうかを確認する',
      'API レスポンスの型を確認し、デフォルト値（[]）を設定する'
    ]
  },
  {
    type: 'ReferenceError',
    pattern: /is not defined/i,
    cause: '宣言されていない変数、または現在のスコープにない変数にアクセスしています。',
    suggestions: [
      '変数名のスペルミスを確認する',
      'インポートが漏れていないか確認する',
      '変数の宣言スコープ（var/let/const）と使用箇所のスコープを確認する'
    ]
  },
  {
    type: 'SyntaxError',
    pattern: /JSON\.parse|Unexpected token .+ in JSON/i,
    cause: 'JSON のパースに失敗しています。入力が正しい JSON 形式ではありません。',
    suggestions: [
      '受信したテキストが JSON か確認する（HTML エラーページが返っている可能性あり）',
      'JSON.parse の前に try-catch を追加する',
      'レスポンスのステータスコードと Content-Type を確認する'
    ]
  },
  {
    type: 'SyntaxError',
    pattern: /Unexpected token|Unexpected end|Unexpected identifier/i,
    cause: 'コードまたはデータに構文エラーがあります。',
    suggestions: [
      'エラー行番号付近の括弧・クォートの対応、カンマの有無を確認する',
      'TypeScript / Babel のビルドエラーがないか確認する'
    ]
  },
  {
    type: 'RangeError',
    pattern: /Maximum call stack size exceeded/i,
    cause: '再帰呼び出しが深くなりすぎてコールスタックが溢れています。',
    suggestions: [
      '無限再帰になっていないか終了条件を確認する',
      '再帰をループへ書き直す',
      'Promise チェーンやイベントハンドラの循環参照も疑う'
    ]
  },
  {
    type: 'RangeError',
    pattern: /Invalid array length/i,
    cause: '不正な長さ（負の値・非常に大きな値）で配列を生成しようとしています。',
    suggestions: [
      '配列サイズの計算ロジックを確認する',
      'API やデータからの値が想定外の値になっていないか確認する'
    ]
  },
  {
    type: 'Error',
    pattern: /Network Error|Failed to fetch|net::ERR/i,
    cause: 'ネットワークリクエストが失敗しています（接続拒否・タイムアウト等）。',
    suggestions: [
      'API サーバーが起動しているか、URL が正しいか確認する',
      'ブラウザコンソールで CORS エラーの詳細を確認する',
      'プロキシ・ファイアウォール設定を確認する'
    ]
  },
  {
    type: 'UnhandledPromiseRejection',
    pattern: /.*/,
    cause: 'Promise の reject が catch されずに処理されています。',
    suggestions: [
      '非同期処理に .catch() または try-catch（async/await）を追加する',
      'Promise チェーン全分岐でエラーハンドリングを確認する'
    ]
  }
];

/** JS の TypeError 等は type だけでは対処が特定できないため、まず type+message の完全一致で探し、なければ type のみで最初のエントリにフォールバックする。 */
function findErrorEntry_(type, message, lang) {
  if (lang === 'csharp') return CSHARP_ERROR_DICT_[type] || null;
  for (const entry of JS_ERROR_PATTERNS_) {
    if (entry.type === type && entry.pattern.test(message)) return entry;
  }
  for (const entry of JS_ERROR_PATTERNS_) {
    if (entry.type === type) return entry;
  }
  return null;
}

/** 発生箇所はスタックトレースの先頭フレームから推定するため「（推定）」を明示する。辞書未登録の場合もフォールバックメッセージを返し、呼び出し元でエラーにしない。 */
function buildAnalysisText_(lang, info, entry) {
  const langLabel = { csharp: 'C#', javascript: 'JavaScript', unknown: '判定不明' }[lang] || '判定不明';
  const lines = [
    '【言語】' + langLabel,
    '【種別】' + info.type + (info.message ? ': ' + info.message : ''),
  ];
  if (info.location) lines.push('【発生箇所（推定）】' + info.location);
  lines.push('');

  if (entry) {
    lines.push('【原因】');
    lines.push(entry.cause);
    lines.push('');
    lines.push('【対処方法】');
    entry.suggestions.forEach((s, i) => lines.push((i + 1) + '. ' + s));
  } else {
    lines.push('【原因】');
    lines.push('この例外・エラー種別は辞書に登録されていません。');
    lines.push('');
    lines.push('【対処のヒント】');
    lines.push('1. エラーメッセージをそのまま検索エンジンで調べる');
    lines.push('2. スタックトレースで発生箇所を特定し、周辺コードを確認する');
  }

  const investigation = lang === 'csharp' ? CSHARP_ERROR_DICT_[info.type] : null;
  if (investigation) {
    lines.push('');
    lines.push('【調査手順】');
    lines.push('代表的なメッセージ: ' + investigation.typicalMessage);
    lines.push('');
    investigation.steps.forEach((s, i) => lines.push((i + 1) + '. ' + s));
  }

  return lines.join('\n');
}
