# Docker イメージの CI ビルド・GHCR 公開

GitHub Actions で Docker イメージをビルドし、GitHub Container Registry（GHCR）へ
公開する仕組みです。**イメージの作成・公開のみ**が対象で、サーバーへの自動デプロイは
行いません。

- Workflow 本体制限（Linux AMD64 のみ・Buildx・GITHUB_TOKEN 認証）
- 対象ブランチ: `main`（push 自動ビルド）／`workflow_dispatch`（手動）／`pull_request`（検証のみ）

### Workflow ファイル構成

| ファイル | 役割 |
|---|---|
| `.github/workflows/build.yml` | main push / 手動実行の入口（`packages: write`） |
| `.github/workflows/build-pr.yml` | PR 検証の入口（`packages: read` のみ・push なし） |
| `.github/workflows/base.yml` | ベース 2 画像の単独実行（paths フィルター・手動） |
| `.github/actions/build-base-images/` | ベースビルド手順の複合アクション |
| `.github/actions/build-image/` | 1 イメージのビルド手順の複合アクション |

ビルド手順は**複合アクション**に集約し、2 つの入口が同じ定義を共有します。
複合アクションは job の権限を継承するため、push 用（write）と PR 検証用（read）で
同じ手順をそのまま使えます。なお再利用ワークフロー（`on: workflow_call`）では
再利用側の `packages: write` 要求を呼び出し側の read に縮小できず起動時に拒否される
ため、この方式を採用しています。

## 公開されるイメージとタグ

基本名称は `ghcr.io/iisec-suzaki/overleaf-iisec` です。GHCR の制約によりすべて小文字です。

| イメージ | GHCR 名 | タグ |
|---|---|---|
| Overleaf 本体（sharelatex） | `ghcr.io/iisec-suzaki/overleaf-iisec` | `<git sha>`（毎回）／`latest`（main の成功時） |
| ベース（TeX Live 一式） | `ghcr.io/iisec-suzaki/overleaf-iisec-base` | `tex-<コンテンツハッシュ>`／`latest` |
| 日本語ベース（upLaTeX 等） | `ghcr.io/iisec-suzaki/overleaf-iisec-ja-base` | `ja-<コンテンツハッシュ>`／`latest` |
| 翻訳サービス | `ghcr.io/iisec-suzaki/overleaf-iisec-translation-service` | `<git sha>`／`latest`（main） |
| Git 連携ブリッジ | `ghcr.io/iisec-suzaki/overleaf-iisec-git-bridge` | `<git sha>`／`latest`（main） |
| ビルドキャッシュ専用 | `ghcr.io/iisec-suzaki/overleaf-iisec-buildcache` | `base` `base-ja` `app` `translation` `git-bridge`（キャッシュ用タグ。実行には使わない） |

- `<git sha>` は `github.sha`（実行 ref のコミット）。main 以外からの `workflow_dispatch`
  では `<git sha>` だけ付き、`latest` は付きません。
- ベースイメージの `<コンテンツハッシュ>` は Dockerfile 自体の SHA-256 です
  （`ja-` タグは `server-ce/Dockerfile-base` と `Dockerfile.jp-base` の結合ハッシュ）。
  **同じハッシュ＝同じ Dockerfile 内容**なので、タグから中身の再現追跡ができます。
  ローカル compose 運用で使う `local/overleaf-iisec*` 名前とは別物です。既存の
  `compose.yaml` は変更していません。

## ベースイメージの再利用と再生成（設計）

- `base.yml` が `server-ce/Dockerfile-base` → `Dockerfile.jp-base` の順でビルドします。
  アプリ本体（`build.yml`）は必ず **コンテンツハッシュ付きタグ**で参照し、`latest` に
  依存しません（誰がいつビルドしても同じベースが使われます）。
- 通常のアプリ変更では `base.yml` のチェックは「GHCR に既存タグを発見 → 即終了」だけで、
  重い TeX Live の再ビルドは発生しません。
- ベースの Dockerfile が変わるとハッシュが変わり、`base.yml` が paths フィルターで
  自動実行され、新しいハッシュのタグとして公開されます。`latest` も更新されます。
- `build.yml` は実行のたびに `base.yml` を再利用ワークフローとして呼び、該当ハッシュが
  GHCR に無ければその場でベースから作ります（例: ベース変更の main push で
  `base.yml` が走る前にアプリビルドが先行した場合でも自己修復します）。

### キャッシュの設計と誤用防止

- `docker buildx` の registry キャッシュ（`--cache-from/--cache-to`）を
  `overleaf-iisec-buildcache` の別タグで管理します。キャッシュは**ビルド高速化専用**で、
  成果物イメージの FROM は常にハッシュ固定のため、キャッシュの新旧で内容は変わりません。
- ベースイメージの FROM は「実行 checkout の Dockerfile 内容」から決まるため、
  キャッシュの誤参照で変更が反映されない、という状態が構造上起きません。

## イベント別の振る舞い

| イベント | 挙動 | GHCR 権限 |
|---|---|---|
| `push`（main） | 全イメージビルド → `<sha>` と `latest` を push | `packages: write` |
| `workflow_dispatch` | 実行 ref に対してビルド → `<sha>` を push（main なら `latest`） | `packages: write` |
| `pull_request` | ビルド検証のみ。push なし・書き込み権限なし | `packages: read`（ベースプルのみ） |
| `pull_request_target` | 使用していません | — |

PR でベースの Dockerfile 自身を変更した場合、アプリ画像の検証だけ
「未公開ベースのためスキップ」となり、翻訳・git-bridge・ベース Dockerfile 自体の
ビルド検証は走ります（アノテーションに理由が表示されます）。

## 手動実行と結果確認

1. GitHub リポジトリ → **Actions** → 左のワークフローを選択
   - イメージ一式: `build` → **Run workflow** → 対象 ref 選択
   - ベースだけ: `base-images` → **Run workflow**
2. ジョブ完了後、リポジトリの **Packages**（`https://github.com/orgs/iisec-suzaki/packages`）
   でイメージ名とタグを確認できます。
3. Pull 確認（GitHub CLI でトークン取得）:

   ```sh
   gh auth login
   echo "$(gh auth token)" | docker login ghcr.io -u <自分のGitHubユーザー名> --password-stdin
   docker pull ghcr.io/iisec-suzaki/overleaf-iisec:latest
   ```

   CI の `GITHUB_TOKEN` と違い、個人での pull には読み取り権限のあるトークンが
   必要です（Packages のアクセス管理はリポジトリの visibility に従い、private
   リポジトリなら package も private になります）。

## 秘密情報の扱い

- ビルドに秘密情報は一切埋め込みません（`.env` は `.dockerignore` 済み）。
- 認証は `GITHUB_TOKEN` のみ。PAT は作りません。
- 外部 Actions はコミット SHA で固定しています（checkout v7.0.1 /
  setup-buildx-action v4.4.1 / login-action v4.8.0）。
- PR 由来のコードには書き込み権限を与えません（PR 実行では job 権限が read に
  絞られ、push 系ステップも条件でスキップされます）。

## ローカルで同じビルドを試す

CI と同じ Dockerfile・引数の最小構成です（push と registry キャッシュは無し）。

```sh
# ベース（初回のみ・非常に時間かかります）
docker buildx build --platform linux/amd64 \
  -f server-ce/Dockerfile-base -t local/overleaf-iisec-base:latest .
docker buildx build --platform linux/amd64 \
  --build-arg OVERLEAF_BASE_IMAGE=local/overleaf-iisec-base:latest \
  -f Dockerfile.jp-base -t local/overleaf-iisec-ja-base:latest .

# アプリ本体
docker buildx build --platform linux/amd64 \
  --build-arg OVERLEAF_BASE_TAG=local/overleaf-iisec-ja-base:latest \
  -f server-ce/Dockerfile -t local/overleaf-iisec:latest --load .

# 翻訳サービス / Git ブリッジ
docker buildx build --platform linux/amd64 -t local/translation-service:latest --load ./translation-service
docker buildx build --platform linux/amd64 -f Dockerfile.local -t local/git-bridge:latest --load ./services/git-bridge
```

既存の `scripts/build-images.sh`（compose 経由）も従来どおり使えます。
