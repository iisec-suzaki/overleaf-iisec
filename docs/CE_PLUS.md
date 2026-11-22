# CE+ とローカル翻訳の統合

> この文書は統合時点の記録です。現在の構成は [構成と現状](PROJECT_STATUS.md)、
> 起動は [セットアップ](SETUP.md)、稼働環境への適用・ロールバックは
> [運用手順](OPERATIONS.md)、バックアップは [移行手順](MIGRATION.md)を参照してください。

統合元は [yu-i-i/overleaf-cep](https://github.com/yu-i-i/overleaf-cep) の
`ext-ce`、コミット `ae07e781ab20dac2378420e5cf7a47f7d8bccbb5` です。
公式 CE と共有する `e039ad26c5bf5422eb57b89fc7e57c75055e631d` からの変更を
Git のマージで取り込んでいます。CE+ はコミュニティによる派生版です。
`CREDITS.md` と AGPL ライセンスも取り込んでいます。

## 維持する独自機能

- 日本語向けのフル TeX Live、クラスとフォント
- 認証・プロジェクト権限・CSRF 保護付きのローカル LLM 翻訳 API と英訳ボタン
- SSE の即時配信、停止、LaTeX 保護、用語集、英語版別ファイル保存
- メイン文書ごとの PDF とログのセッション内キャッシュ
- MongoDB / Redis / 翻訳用 SQLite の既存 volume 名とローカル公開設定

## 競合の解消

`settings.defaults.js` は CE+ のモジュール登録を採用したうえで翻訳モジュールと
ツールバーボタンを追加しています。旧 `user-activate` の代わりに CE+ の
登録・管理機構を使います。

Nginx 設定は CE+ の `overleaf.conf.template` に移行し、Git の公開経路制限と
翻訳 SSE の `proxy_buffering off` を両方維持しています。Dockerfile のテンプレート
配置と起動時の環境変数展開は CE+ に合わせています。

## 機能と設定

変更追跡・コメント、シンボルパレット、参考文献検索、テンプレート管理などの
CE+ ソースとモジュールを取り込んでいます。追加の linked-url-proxy サービスも
CE+ のビルド対象に含まれます。

自己登録は `OVERLEAF_ENABLE_REGISTRATION_PAGE=false` が既定です。
有効にする場合は `.env` で `true` にしてください。

### 有効化済みの CE+ 機能（2026-11-12 現在）

- **Git 統合（git-bridge）**: この Compose に `git-bridge` サービスを追加し、
  `GIT_BRIDGE_ENABLED=true` で有効化しました。既製イメージは Server Pro 版
  （quay.io）かプライベートレジストリにあり取得できないため、リポジトリ内の
  MIT ライセンスソース（`services/git-bridge`、Java 21）からローカルビルドして
  `local/overleaf-git-bridge` に焼込みます。ビルドコマンドは
  `services/git-bridge/Dockerfile.jp-git-bridge` の冒頭に書いています。
  利用方法はプロジェクトメニューの「Git 統合」で個人アクセストークンを作成し、
  `git clone http://<サイト URL>/git/<プロジェクト ID>.git`（パスワード = トークン）。
- **テンプレートギャラリー（/templates）**: `OVERLEAF_TEMPLATE_GALLERY=true` と
  所有者アカウントの `_id`（`.env` の `OVERLEAF_TEMPLATES_USER_ID`）で有効化。
- **URL リンク付きファイル**: `ENABLED_LINKED_FILE_TYPES` に `url` を追加
  （linked-url-proxy は CE+ ビルドで起動済み）。
- **Python 実行（Pyodide）・プロジェクト全文検索・選択範囲語数カウント**:
  ブラウザー側だけで動く CE+ 機能で、ビルド設定（`overleafModuleImports`）が
  上流 CE+ のまま有効なため、バンドル済み・利用可能。
- **history-v1（履歴 API）・chat**: 本体コンテナ内で稼働済み。

### 無効のままの CE+ 機能

- **GitHub 同期 / Zotero 連携**: 外部の鍵（GitHub OAuth App、Zotero consumer
  key/secret）の取得が必要なため未有効化。変数名と取得元は `.env.example` に
  記載。トークン暗号鍵は初回使用時に自動生成されます。
- **Sandboxed Compiles**: Docker ソケットのマウントが必要で、CE では分離機構が
  なく上流も有効化を推奨していません。危険なため無効のままです。コンパイルは
  本体コンテナの日本語 TeX Live を使い続けます。

## 検証と適用

2026-11-08 に以下を確認しました。

- 翻訳サービスの回帰テスト14件: 成功（LLM 呼び出しは模擬）
- 通常・LAN 用 Compose の設定検証: 成功
- 日本語ベースを使った統合アプリイメージのビルド: 成功
- 別 Compose プロジェクトと空の専用 volume での初回マイグレーション・起動: 成功
- ログイン画面: HTTP 200、Nginx 設定検査: 成功
- web / API / linked-url-proxy を含むアプリサービス: run 状態
- 翻訳・変更追跡・参考文献検索モジュールの登録: 確認済み
- 未認証の翻訳 API 呼び出し: ログインへ転送（HTTP 302）
- 日本語クラスと LuaTeX-ja: `kpsewhich` で確認

検証用プロジェクトと専用 volume は確認後に削除しました。
稼働中の `overleaf-local` のコンテナ・DB は切り替えていません。
ローカルの `local/overleaf-ja:custom` タグは統合版に更新済みです。
実 LLM への接続とブラウザー上の共同編集・変更追跡は別途実機確認が必要です。

2026-11-12 の CE+ 全機能有効化で確認したことです。

- git-bridge イメージのローカルビルドと起動: 成功（Jetty listening、`/status` 200）
- nginx 経由の Git エンドポイント: `GET /git/<id>.git/info/refs` が
  `401 + WWW-Authenticate: Basic realm="Git Bridge"` を返す（中継動作 OK）
- `/templates` ルート: 有効化後ログインへリダイレクト（モジュール登録 OK）
- 本体コンテナの環境変数（GIT_BRIDGE_*・テンプレートギャラリー・linked url）: 反映確認
- Pyodide・全文検索のフロントエンドバンドル: 配信済み確認
- 実クローン（PAT 発行）・ギャラリー投稿・GitHub / Zotero の実連携は
  ブラウザーでの操作が必要なため未実施（鍵・ログイン情報が必要）

稼働環境へ適用する前に [バックアップ手順](MIGRATION.md)で全 volume を保存します。
ソースの統合だけでは稼働コンテナは切り替わりません。

```sh
docker compose -f compose.yaml build sharelatex
docker compose -f compose.yaml up -d
```

LAN 公開中は起動時に `-f compose.lan.yaml` も指定してください。
既存 DB に CE+ のマイグレーションが適用されるため、旧イメージへ戻す場合は
適用前の DB バックアップと組み合わせて復元します。
