# 運用手順

[README](../README.md) · [設定](CONFIGURATION.md) · [バックアップ・復元](MIGRATION.md)

以下はリポジトリルートで実行します。LAN / Tailscale 運用では毎回 `-f compose.lan.yaml` も指定してください。保存イメージで復元した環境は、移行時の `compose.images.yaml` も指定します。Compose ファイル群・プロジェクト名・ポートを運用メモに残します。

## 日常のコマンド

```sh
# 起動・状態・直近ログ
docker compose -f compose.yaml up -d
docker compose -f compose.yaml ps -a
docker compose -f compose.yaml logs --tail=100 sharelatex mongo-init translation-service mongo redis

# ログを追う（Ctrl-C でログ表示だけ終了）
docker compose -f compose.yaml logs -f --tail=100 sharelatex translation-service

# コンテナを残して停止。volume は維持する。
docker compose -f compose.yaml stop

# コンテナと Compose ネットワークを削除。名前付き volume は維持する。
docker compose -f compose.yaml down
```

`mongo-init` の Exited (0) は正常です。`sharelatex` が running でも内部サービスの準備が完了しているとは限らないため、ログイン画面・編集・コンパイルも確認します。

`.env` を変更したら対象サービスに `up -d --force-recreate` を使います。`restart` は既存の環境変数を使って再起動するだけです。翻訳パネルから保存した接続先は即時反映されます。

## バックアップと復元確認

[移行手順](MIGRATION.md)の停止バックアップを使います。MongoDB・Redis・SQLite の稼働中ファイルをそのまま tar にまとめる方法は使いません。取得日時、ソースコミット、イメージ、全4 volume、秘密値を一組にします。

バックアップは別ディスク・別ホストにも保持し、保存世代と復元確認日を運用メモに記録してください。復元試験には別 Compose プロジェクトと空きポートを使います。稼働環境の volume に試しに展開しないでください。

## 更新する

1. 現在のソース・実イメージ・`.env`・全4 volume を[バックアップ](MIGRATION.md)する。
2. 作業ブランチで更新内容・マイグレーション・依存サービス要件を確認する。
3. 新しいイメージをビルドし、別プロジェクトにバックアップを復元して検証する。
4. ログイン、日本語コンパイル、翻訳、CE+ の利用機能を確認してから本番を切り替える。

CE+ の統合元・既存の統合記録は [CE_PLUS.md](CE_PLUS.md) にあります。取り込みは自動更新ではなく、競合と挙動を確認するソース統合です。公式 CE の更新だけを無条件で上書きしないでください。

```sh
git status --short
git switch -c update-ce-plus
git fetch https://github.com/yu-i-i/overleaf-cep.git ext-ce
git log --oneline -n 10 FETCH_HEAD
git diff --stat HEAD...FETCH_HEAD
# 内容を確認し、取り込む場合に実行。中止は git merge --abort。
git merge --no-commit --no-ff FETCH_HEAD
```

特に確認する場所は `services/web/config/settings.defaults.js`、`server-ce/nginx/overleaf.conf.template`、翻訳モジュール、PDF キャッシュ、日本語用 Dockerfile です。取り込み後は変更をコミットします。

```sh
# アプリ・翻訳コードだけの変更（日本語ベースが既に存在する場合）
docker compose -f compose.yaml build sharelatex translation-service
# ベース依存・TeX Live も更新する場合はこちらを使う。
# ./scripts/build-images.sh
docker compose -f compose.yaml up -d
```

保存イメージ用の追加設定を使っている場合は、ビルド・更新時にその追加設定を外します。MongoDB / Overleaf のメジャー更新は、対象版の段階的アップグレード要件を確認して別作業にします。物理バックアップを別メジャーの MongoDB で直接開く手順にはしません。

起動時に DB マイグレーションが実行されます。**イメージだけ旧版に戻すと DB と不整合になる可能性があります。** ロールバックは更新前のイメージと、その時点の全データを空の復元先へ戻す方法で行います。切り替え後の編集内容は更新前バックアップには含まれません。

## 翻訳サービスの回帰テスト

翻訳サービスのアプリイメージを作成済みなら、実データに触れず実行できます。LLM 応答は模擬で、実モデルの接続・翻訳品質の試験ではありません。

```sh
docker run --rm --network none \
  --mount "type=bind,src=$PWD/translation-service/tests,dst=/app/tests,readonly" \
  -e TRANSLATION_DB_PATH=/tmp/translation-test.sqlite3 \
  local/overleaf-translation:latest python -m unittest discover -s tests
```

## 障害対応

| 症状 | 確認・対応 |
| --- | --- |
| 起動直後に本体が終了する | `sharelatex` のログで秘密値不足・DB マイグレーション失敗を確認。`OVERLEAF_INVITE_TOKEN_SECRET` は既存値を維持 |
| MongoDB 初期化で止まる | `mongo` と `mongo-init` のログ、ディスク空き、PRIMARY 選出を確認。replica set のホスト名は `mongo:27017` |
| 起動したがプロジェクトが空 | プロジェクト名・実際の volume 名・Compose ファイル群が以前と同じか確認。新規アカウントを作る前に確認する |
| ポートの bind エラー | 移行先にその LAN / Tailscale IP が存在するか、同じポートを他プロセスが使用していないか確認 |
| 日本語コンパイルに失敗する | LuaLaTeX を選択したか、日本語ベースからビルドしたか確認。`kpsewhich bxjsarticle.cls`・`kpsewhich luatexja.sty` を本体内で実行 |
| フォントキャッシュの権限エラー | 本体の `TEXMFVAR` / `TEXMFCACHE` と `/var/lib/overleaf` の所有権を確認。ホストから一括で所有者変更しない |
| モデル一覧が取得できない | 翻訳パネルの有効 URL を確認。SQLite 保存値、LLM の待ち受け・キー・`/v1/models`、Docker からの経路を確認 |
| ホストでは接続できるが翻訳は失敗 | コンテナの `localhost` を使っていないか、LLM が loopback 限定で待ち受けていないか確認 |
| URL・キー変更が反映されない | `.env` 変更後はコンテナを再作成。UI 保存設定があるならリセットするか UI で変更 |
| 長い翻訳が途切れる | 翻訳ログと LLM ログを確認。外部プロキシの SSE バッファリングとタイムアウトも確認 |
| 結果の保存ができない | 翻訳中の文書編集、書き込み権限、LaTeX 検証エラーを確認。部分結果は草稿として扱う |
| 長文の一部だけ日本語に戻る | 翻訳ログの `Chunk translation failed` と `Keeping original` を確認。マーカーが一致していても追加の数式・構文で失敗する場合がある。構文検証もチャンク確定前に再試行する修正版を使う |
| 版を変えても古い PDF が出る | 現在のメイン文書を確認し再コンパイル。ブラウザー再読み込み後はキャッシュを再生成 |

本体の内部 DB 接続確認と日本語パッケージ確認:

```sh
docker compose -f compose.yaml exec sharelatex grunt check:mongo
docker compose -f compose.yaml exec sharelatex grunt check:redis
docker compose -f compose.yaml exec sharelatex kpsewhich bxjsarticle.cls
docker compose -f compose.yaml exec sharelatex kpsewhich luatexja.sty
```

LLM へのネットワークだけを確認する場合は、翻訳コンテナ内で次を実行できます。これは `.env` 由来の URL を使い、UI 保存値の優先順位と API キーは扱いません。認証エラーでも HTTP 応答があれば接続経路は成立しています。通常は UI の「接続テスト」を使ってください。

```sh
docker compose -f compose.yaml exec -T translation-service python - <<'PY'
import os
import urllib.request
url = os.environ.get('LOCAL_LLM_BASE_URL', '').rstrip('/')
if not url:
    raise SystemExit('LOCAL_LLM_BASE_URL is empty; check the translation panel settings')
with urllib.request.urlopen(url + '/models', timeout=10) as response:
    print('HTTP', response.status)
PY
```

ログや `docker inspect` / `docker compose config` の全出力には秘密情報が含まれる場合があります。調査のため共有するときは、URL 内の認証情報、API キー、トークン、原稿内容を取り除きます。
