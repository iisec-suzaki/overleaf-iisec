# セットアップ

[README](../README.md) · [設定](CONFIGURATION.md) · [移行](MIGRATION.md)

この手順は空の環境への導入用です。既存ユーザー・プロジェクト・翻訳設定を引き継ぐ場合は[移行手順](MIGRATION.md)から始めます。以下のコマンドはリポジトリのルートで実行します。

## 1. ホストとソースを準備する

- Linux 上の Docker Engine と Docker Compose v2 以降。Dockerfile は BuildKit と `COPY --parents` 対応の Dockerfile frontend を使います。
- Git、OpenSSL。Docker を実行できるユーザーで作業します。
- ビルド時にコンテナレジストリ、OS / Node.js / Yarn / Python の配布元、TeX Live ミラーに接続できること。
- フル TeX Live を含むイメージとビルドキャッシュ用のディスク・メモリー。
- 翻訳を使う場合は、コンテナから到達できる OpenAI 互換 LLM API。

2026-11-09 の稼働ホストでは Overleaf アプリイメージだけで約 22.6 GB でした。ベースイメージ、キャッシュ、データ、移行アーカイブと展開先にも別途容量が必要です。この値は必要空き容量の下限を保証するものではありません。

```sh
docker version
docker compose version
docker info --format '{{.Architecture}}'
df -h .
docker system df
```

独自版の fork / private repository を clone するか、移行元で作った Git bundle を使います。リポジトリ URL は配布先に合わせてください。上流の公式 CE や CE+ だけを clone しても翻訳モジュールは入りません。

```sh
git clone --branch jp-translation <独自版リポジトリのURL> overleaf
cd overleaf
git rev-parse HEAD
```

ブランチ名を変えて配布している場合はその名前を使います。配布用 remote の登録・push は自動では行いません。リポジトリを公開するときは [LICENSE](../LICENSE) と [CREDITS.md](../CREDITS.md) も保持します。

## 2. `.env` を作成する

```sh
cp .env.example .env
chmod 600 .env
openssl rand -base64 32
```

エディタで `.env` を開き、少なくとも次を設定します。

| 設定 | 作業 |
| --- | --- |
| `OVERLEAF_INVITE_TOKEN_SECRET` | 生成した秘密値を記入。運用開始後は保持する |
| `OVERLEAF_ADMIN_EMAIL` | 管理者メールを記入 |
| `OVERLEAF_SITE_URL` | ブラウザーから開く URL。ローカル利用は既定値でよい |
| `LOCAL_LLM_BASE_URL` | 翻訳を使う場合、コンテナから到達可能な `/v1` URL |
| `LOCAL_LLM_API_KEY` | LLM 側で必要な場合に記入 |

LLM 未設定でも Overleaf の編集・コンパイルは利用できます。LLM の配置例と LAN / Tailscale 公開は[設定リファレンス](CONFIGURATION.md)を参照してください。`.env` をシェルの `source` で読み込む必要はありません。

構文を確認します。`--quiet` を外すと秘密値も出力されるため、出力を共有しないでください。

```sh
docker compose -f compose.yaml config --quiet
```

## 3. イメージをビルドする

```sh
./scripts/build-images.sh
```

以下の順でビルドします。

| 定義 | 生成タグ |
| --- | --- |
| `server-ce/Dockerfile-base` | `local/overleaf-base:latest`（フル TeX Live） |
| `Dockerfile.jp-base` | `local/overleaf-ja-base:latest`（日本語クラス・フォント） |
| `server-ce/Dockerfile` | `local/overleaf-ja:custom`（CE+ と独自機能） |
| `translation-service/Dockerfile` | `local/overleaf-translation:latest` |

Node.js・Yarn・Python・TeX Live はイメージ内に入ります。ホストへの個別インストールは不要です。LLM ランタイム・モデル・GPU ドライバーはこのビルドの対象外です。

`latest`、OS パッケージ、TeX Live ミラーは時間とともに変わります。同じソースから後日ビルドしても同一バイナリにはなりません。既存環境と同じものを移す場合は[イメージを保存する手順](MIGRATION.md)を使います。

## 4. 起動し、管理者を作る

```sh
docker compose -f compose.yaml up -d
docker compose -f compose.yaml ps -a
docker compose -f compose.yaml logs --tail=100 sharelatex mongo-init translation-service
```

MongoDB の PRIMARY 選出と初回 DB マイグレーションを待ちます。`mongo-init` は正常時も **Exited (0)** となる一回限りのサービスです。`mongo`・`redis`・`translation-service` は healthy、`sharelatex` は running を確認します。ログイン画面が表示されるまで待ってから次へ進みます。

```sh
docker compose -f compose.yaml exec sharelatex grunt user:create-admin --email=admin@example.com
```

メールアドレスを自分のものに置き換え、表示された有効化 URL をブラウザーで開いてパスワードを設定します。既定は <http://localhost:8080>。`grunt` はリポジトリに含まれる管理スクリプトへの互換ラッパーです。

自己登録は既定で無効です。ユーザー追加など CE+ の管理機能は管理者でログインして確認してください。既存データを復元した環境で管理者を作り直す必要はありません。

## 5. 利用確認

1. 管理者でログインし、新規プロジェクトで保存・再読み込みができる。
2. [利用ガイド](USER_GUIDE.md)の日本語文書を **LuaLaTeX** でコンパイルし、PDF に日本語が表示される。
3. 翻訳パネルの接続テストとモデル一覧取得に成功する。
4. 短い文書を翻訳し、`.en.tex` として保存する。原文・英語版をそれぞれコンパイルする。
5. 必要な CE+ 機能（変更追跡・コメントなど）を実際に操作する。
6. 継続利用前に[バックアップと復元](MIGRATION.md)を試す。

翻訳サービスの `/health` はサービス自体の生存確認です。healthy でも LLM 接続・モデルロード・翻訳成功までは保証しません。障害時は[運用手順](OPERATIONS.md)を参照してください。
