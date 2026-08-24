# CSEG Dashboard

SaaS-CSEG の実績、目標、アサイン、スキル、通知、改善要望をまとめて確認する Google Apps Script 製の社内ダッシュボードです。

このリポジトリでは、既存画面から呼ばれている関数名と既存シートを互換層として維持しつつ、内部を「ドメイン」「アプリケーション」「リポジトリ」「インフラ」に分離しています。機能追加では、原則としてこの依存方向を守ってください。

```text
ブラウザ
  Index.html / Styles.html / Scripts.html / PageCache.html
                         │ google.script.run
                         ▼
公開RPC（互換ファサード）
  01_Main.js / 06_Mutations.js
                         │
                         ▼
アプリケーション層
  14_Application.js  ── 画面・ユースケース単位の処理
                         │
             ┌───────────┴───────────┐
             ▼                       ▼
ドメイン層                         リポジトリ層
  12_Domain.js                     13_Repositories.js
  検証・計算・状態遷移              保存先を抽象化
                                     │
                                     ▼
インフラ／外部サービス
  03_SheetStore.js / 04_BacklogSync.js / Google Sheets / Backlog
```

## 設計方針

厳密なフレームワーク型DDDではなく、Google Apps Scriptの制約に合わせた実用的なDDD構成です。

- ドメイン層は、入力検証、ポイント・目標計算、ステータス遷移などの業務ルールを持ちます。`SpreadsheetApp` や画面HTMLへ直接依存させません。
- アプリケーション層は、「報告を投稿する」「アサイン実績を保存する」など、1回の操作に必要な手順をまとめます。
- リポジトリ層は、どのシート・ブックへ保存するかを隠します。アプリケーション層から `readRows_` や `SpreadsheetApp` を直接呼ばないことを目標にしています。
- `01_Main.js` と `06_Mutations.js` は公開RPC名を維持する互換ファサードです。検証済みユーザーをサービスへ渡し、結果をそのまま返します。
- 集計と同期はデータ量・再開処理の都合で専用モジュールに分けています。長時間処理は1回で完走させず、状態を保存してトリガーで継続します。
- 既存のシート名・列名・公開RPC名は、移行処理なしに変更しません。

## ファイル構成

| ファイル | 責務 |
|---|---|
| `00_Config.js` | アプリ定数、ポイント、外部ブックID、シートスキーマ、共通変換関数 |
| `01_Main.js` | Webアプリ入口、読取系の公開RPC、初期表示、ルーティング用データ |
| `02_Auth.js` | 設定済みメールによる閲覧制限、管理者判定、本人／管理者の更新権限 |
| `03_SheetStore.js` | アプリ用シートの共通CRUD、月別目標・アサインブックの読書き |
| `04_BacklogSync.js` | Backlog差分同期、正規化、継続実行、同期ログ |
| `05_Analytics.js` | ダッシュボード・実績・アグリゲートの集計とViewModel |
| `06_Mutations.js` | 更新系の公開RPC。実処理はアプリケーションサービスへ委譲 |
| `07_Notifications.js` | 通知条件の判定とメール／Slack送信 |
| `08_Setup.js` | 初期シート作成、初期データ、定期トリガー設定 |
| `09_AnalyticsCache.js` | `AnalyticsCache`、`PerformanceIssues`、索引の差分再構築 |
| `10_BacklogSchemaMigration.js` | Backlog列変更時の移行・検査・再同期ツール |
| `11_Feedback.js` | 改善要望・不具合報告の定数と旧呼出し互換関数 |
| `12_Domain.js` | エンティティ、値検証、目標算定などの業務ルール |
| `13_Repositories.js` | アプリ内シート、外部月別シートを扱うリポジトリ |
| `14_Application.js` | 機能別Application ServiceとページQuery Service |
| `15_SelfTests.js` | シートを書き換えない業務ルールの簡易テスト |
| `Index.html` | HTMLシェル、サイドバー、ヘッダー、テンプレート読込み |
| `Styles.html` | 全画面共通のスタイル |
| `Scripts.html` | 画面状態、RPC、ページレジストリ、各画面レンダラーと操作 |
| `PageCache.html` | 画面先読みと短期キャッシュ。描画は `CLIENT_PAGES` へ委譲 |
| `appsscript.json` | Apps Scriptランタイム、OAuthスコープ、Webアプリ設定 |

## 機能境界

### Backlog同期・実績

- 正データ: アプリデータブックの `BacklogIssues`
- 同期: `manualBacklogSync` → `04_BacklogSync.js`
- 集計キャッシュ: `AnalyticsCache`
- チケット明細: `PerformanceIssues`
- 明細索引: `PerformanceIssueIndex`
- ポイント: Backlogのマイルストーンを `milestonePoint_` で判定し、緊急なら `CSEG_APP.EMERGENCY_BONUS` を加算
- 現在のポイント: 極小 0.25、小 0.5、中 1、大 1.5、特大 2、最大 2.5、緊急 +0.5

`PerformanceIssues` は全件再取得ではなく、Backlog差分同期で変更された課題をもとに更新します。再構築が時間制限へ近づくと、状態をScript Propertiesへ保存し、継続トリガーから再開します。

### 月別所属・目標

正データは次の外部ブックです。

- [月別所属・目標ブック](https://docs.google.com/spreadsheets/d/1vS10vT-clLJFskKrNNox4pE8ROtwnaFoIm5MDThnkv4/edit)
- タブ名: `YYYY年M月`
- A列: メンバー名
- B列: 複合レベル
- C列: その月の所属チーム
- D列: 速度係数
- E～G列: 算定に使う時間
- H列: その月に固定された目標件数

実績画面の所属チームも、チケット登録時のチームではなくこの月別所属を正とします。過去月のH列を固定値として保持することで、現在の経験年数やスキル変更が過去目標へ波及しない前提です。

### アサイン

正データは次の外部ブックです。

- [月別アサイン活用報告ブック](https://docs.google.com/spreadsheets/d/1Dy6dgPXH7Jnrhssa4TdgJ62ASMwaUC6gHW2xiW5-cEI/edit)
- タブ名: `YYYY年M月アサイン活用報告`
- B～D列: 画面から入力する実績時間
- E列: 実績合計の数式
- F～G列: 予定の内訳
- H列: 予定合計の数式
- I列: 残時間
- J列: 最終更新日時

メンバー本人または管理者だけが対象メンバーの実績を更新できます。数式のあるE列・H列と既存書式は上書きしません。

### 改善要望・不具合報告

- `FeedbackReports`: 報告本体
- `FeedbackComments`: コメント
- 種別: 改善要望、不具合、その他
- ステータス: 未対応、確認中、改修中、完了
- 状態遷移と入力制限: `FeedbackReportEntity` / `FeedbackApplicationService`

## データストアと設定

### 利用するスプレッドシート

| 用途 | ID／設定元 |
|---|---|
| アプリ内部データ | Script Property `DATA_SPREADSHEET_ID`。未設定時は `CSEG_APP.DEFAULT_DATA_SPREADSHEET_ID` |
| 月別所属・目標 | `CSEG_APP.MONTHLY_TEAM_SPREADSHEET_ID` |
| 月別アサイン | `CSEG_APP.ASSIGNMENT_SPREADSHEET_ID` |

今回の構造整理では既存データを壊さないため、ライブのシート列や値は変更していません。新しい保存先が必要な機能だけ、後述の手順でスキーマとセットアップを追加してください。

### Script Properties

Apps Scriptの「プロジェクトの設定 → スクリプト プロパティ」で管理します。APIキーやWebhook URLをソースへ直接書かないでください。

| キー | 内容 |
|---|---|
| `DATA_SPREADSHEET_ID` | アプリ内部データブック |
| `AUTHORIZED_EMAILS` | 設定タブの有効メンバーから自動生成される閲覧許可メール一覧 |
| `ADMIN_EMAILS` | 管理者メールアドレス（カンマ区切り） |
| `ADMIN_GROUP_EMAIL` | 管理者Google Group |
| `BACKLOG_SPACE_URL` | BacklogスペースURL |
| `BACKLOG_API_KEY` | Backlog APIキー |
| `BACKLOG_PROJECT_KEYS` | 同期対象プロジェクトキー（カンマ区切り） |
| `SLACK_WEBHOOK_URL` | Slack通知先Webhook |
| `TERM_START_DATE` | 四半期集計の開始日 |

## よくある改修

### ポイントや目標算定を変える

1. ポイントの定数は `00_Config.js` の `CSEG_APP.POINTS_BY_SIZE` と `EMERGENCY_BONUS` を変更します。
2. マイルストーン文字列の解釈は `milestonePoint_` を変更します。
3. 目標算定は `TargetSnapshotEntity.calculate` を変更します。
4. `runDomainSelfTests_` の期待値を更新します。
5. 集計ルール変更後は `rebuildAnalyticsCache` を実行し、過去キャッシュを再生成します。

### 既存機能を変更する

1. `12_Domain.js` で業務ルールと入力制約を変更します。
2. 保存先や読取列が変わる場合は `13_Repositories.js` と `03_SheetStore.js` を変更します。
3. 操作手順や画面返却値は `14_Application.js` の対象サービスを変更します。
4. 公開関数の引数・戻り値は、互換性が必要なため原則変えず、`01_Main.js` または `06_Mutations.js` を薄い変換層にします。
5. 画面は `Scripts.html` の対象レンダラーだけを変更します。
6. URLや月の有無を変える場合は `CLIENT_PAGES` と `buildBootstrapData_` の両方を確認します。

例: 改善要望に優先度を追加する場合は、`CSEG_SHEETS.FeedbackReports`、`FeedbackReportEntity`、`FeedbackApplicationService`、`renderFeedback` の順で変更します。

### 新しい画面を追加する

1. `buildBootstrapData_` の `pages` にID、表示名、権限を追加します。
2. `PageQueryService.get` に初期表示のQueryを追加します。
3. 必要なら `01_Main.js` に読取RPC、`06_Mutations.js` に更新RPCを追加します。
4. `Scripts.html` の `CLIENT_PAGES` にロード関数、レンダラー、`monthIndependent` を登録します。
5. レンダラーと操作関数を実装します。
6. 管理者画面ならサーバー側RPCでも必ず `assertAdmin_()` を行います。画面を隠すだけでは権限制御になりません。

### シートや列を追加する

1. アプリ内部シートなら `CSEG_SHEETS` に内部列名を追加します。
2. 見出しを日本語表示する場合は `CSEG_SHEET_HEADERS` へ同じ列数・同じ順序で追加します。
3. `setupApplication` が新規環境でシートを作れることを確認します。
4. 既存シートへ列を追加・並べ替える場合は、`10_BacklogSchemaMigration.js` と同様にバックアップ、移行、検証を別関数で用意します。
5. 列番号の直書きは `03_SheetStore.js` の外へ増やさず、リポジトリ経由で扱います。

外部月別ブックでは列位置と数式の有無も契約です。値を書き込む前に、読取関数とタブ名規則を更新し、数式列を上書きしないことを確認してください。

### 設定値を変える

- 機密ではない固定値: `00_Config.js`
- 環境ごとに変わる値・秘密情報: Script Properties
- 画面から変更可能な運用設定: 設定画面 → `saveAppSettings`
- 通知ルール: `NotificationRules` または通知センター
- 月別所属・目標・アサイン: 上記の外部月別ブック

定数を追加した場合は、`CSEG_APP` の1か所だけを参照させ、複数ファイルへ同じ数値や文字列を複製しないでください。

## 公開RPCの互換性

ブラウザの `google.script.run` から呼ぶ主な公開関数です。名称変更や引数変更は既存画面を壊すため、内部実装だけを差し替えてください。

- 起動・読取: `getInitialView`, `getDashboardView`, `getPerformanceView`, `getPerformanceMemberIssues`, `getSkillView`, `getAssignmentView`, `getTargetView`, `getAggregateView`, `getNotificationView`, `getSettingsView`, `getFeedbackView`
- 更新: `saveAssignmentEntry`, `saveSkillScore`, `saveSkillMaster`, `saveNotificationRule`, `saveAppSettings`, `saveMonthlyMemberSettings`, `submitFeedbackReport`, `addFeedbackComment`, `updateFeedbackStatus`
- 同期・再集計: `manualBacklogSync`, `rebuildAnalyticsCacheAfterBacklogSync`, `getAnalyticsCacheStatus`

末尾が `_` の関数は内部関数です。ブラウザから直接呼ばないでください。

## キャッシュ・排他・長時間処理

- 一般シート読取は `CacheService` を利用します。書込み後は対象キャッシュを削除します。
- ブラウザは短時間のページキャッシュを持ちます。描画先は `CLIENT_PAGES` に一本化されています。
- URLは `page` と `month` を保持し、直接リンク・リロード・戻る／進むを復元します。
- Backlog同期と集計再構築はロックと状態プロパティで多重実行を制御します。
- Apps Scriptの実行時間へ近づいた処理は継続トリガーを登録します。同期中に状態プロパティやトリガーを手動削除しないでください。

## 開発とデプロイ

前提: Node.js と `clasp` を利用でき、対象Apps Scriptプロジェクトへの権限があること。

```powershell
clasp login
clasp pull
clasp push
```

このリポジトリは `.clasp.json` で既存Apps Scriptプロジェクトに紐づいています。共同作業では次を守ってください。

1. 作業前に `clasp pull` とGitの差分を確認します。
2. 1機能1ブランチを基本とし、シート構造変更と画面変更を同じPRで追跡します。
3. `clasp push` 前に、他メンバーの未取得変更を上書きしないことを確認します。
4. Webアプリはテスト用デプロイでスモークテスト後、本番デプロイを更新します。
5. シート移行はコードのデプロイ前後どちらで実行するかをPRへ明記します。

### Webアプリの実行権限

本アプリは`appsscript.json`で次の方式を使用します。

- 実行ユーザー: Webアプリへアクセスしたユーザー（`USER_ACCESSING`）
- Google側のアクセス範囲: ログイン済みGoogleアカウント（`ANYONE`）
- アプリ側のアクセス範囲: 設定タブにメールを登録した有効メンバーと設定済み管理者

利用者本人のメールアドレスを`Session.getActiveUser()`で取得し、`AUTHORIZED_EMAILS`と照合します。ドメイン名による判定は行いません。未登録ユーザーとメールを取得できないユーザーには「閲覧権限がありません。管理者へ連絡お願いします」と表示します。

メンバー設定を保存すると、有効メンバーのメール一覧が`AUTHORIZED_EMAILS`へ同期され、次の3ブックの編集者へ自動追加されます。

1. アプリ内部データブック
2. 月別所属・目標ブック
3. 月別アサイン活用報告ブック

設定から削除・無効化されたユーザーはアプリへ入れなくなります。誤って所有者や運用管理者の共有権限を削除する事故を避けるため、既存のスプレッドシート共有権限は自動削除しません。必要な場合は各スプレッドシートの共有設定から手動で削除してください。

移行後に`AUTHORIZED_EMAILS`が存在しない場合は、設定済み管理者が最初にアクセスした時点で既存の有効メンバーから自動生成されます。

実行方式を変更した後は、既存URLのコードを更新するだけでなく、Apps Scriptの「デプロイを管理」から新しいバージョンを選んで再デプロイしてください。

初回のみApps Scriptエディタで `setupApplication` を実行します。既存環境では、意図せず初期値やトリガーを作り直さないよう、実行前に対象データブックと既存トリガーを確認してください。

## 確認手順

### ローカル静的確認

```powershell
Get-ChildItem -Filter *.js | ForEach-Object { node --check $_.FullName }
git diff --check
```

`Scripts.html` と `PageCache.html` の `<script>` 内もJavaScriptとして構文確認してください。

### Apps Script上の業務ルール確認

Apps Scriptエディタから `runDomainSelfTests_` を実行します。シート更新は行わず、ポイント、緊急判定、目標算定、入力制約を確認します。

### 手動スモークテスト

- 直接URLで各ページを開き、トップ画面を挟まず目的ページが表示される
- 対象月を変更してリロードしても、同じページと月が維持される
- 実績のチーム絞込みが月別所属ブックと一致する
- メンバー明細に件名、マイルストーン、ポイント、緊急、TAT、Backlogリンクが表示される
- アサイン入力がB～D列だけを更新し、E列・H列の数式が残る
- 一般ユーザーと管理者で表示・更新権限が正しい
- 改善要望の投稿、コメント、ステータス変更ができる
- Backlog同期後に `AnalyticsCache` と `PerformanceIssues` の更新状態を確認できる

## レビュー時のチェックポイント

- 業務ルールがHTMLやシートアクセス関数へ散らばっていないか
- 公開RPCで認証・権限確認をしているか
- 新しい保存処理がリポジトリを経由しているか
- 既存の公開関数名、シート名、列順を壊していないか
- 月別データで「現在値」と「過去スナップショット」を混同していないか
- 複数チーム、複数担当者、TRUE/FALSE、空欄など既存データの表記揺れを考慮したか
- 長時間処理がApps Scriptの制限内で中断・再開できるか
- APIキー、メール、Webhookなどをソースやログへ出していないか

## 命名ルール

- 公開RPC: 動詞から始める `get...`, `save...`, `submit...`, `update...`
- 内部関数: 末尾 `_`
- Application Service: `<Feature>ApplicationService`
- Repository: `<Aggregate>Repository`
- Domain Entity / Value Object: `<Concept>Entity` または業務概念名
- シートの内部列名: lowerCamelCase
- ページID: 英小文字。URLの `page` パラメータと一致させる

## コメントルール

- 名前付き関数、クラス、主要メソッドの直前に、日本語で処理目的を記載します。
- シート更新、外部API通信、トリガー登録などの副作用がある場合は、更新対象もコメントへ含めます。
- コードをそのまま読み上げる説明ではなく、「なぜ必要か」「何を正データとするか」を優先します。
- 業務ルールを変更した場合は、実装と同じ変更内でコメントも更新します。

不明なロジックを追加する場合は、まず「どの機能境界の業務ルールか」「どのデータを正とするか」を決めてから実装してください。これが共同開発時の変更衝突と過去データの先祖返りを防ぐ基準です。
