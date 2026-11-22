# バックアップと別 PC への移行

[README](../README.md) · [設定](CONFIGURATION.md) · [運用](OPERATIONS.md)

移行は「ソースと設定」「使用中のイメージ」「整合する全データ」「LLM とホスト側の設定」をまとめて扱います。**移行とバージョンアップは分け、まず移行元と同じイメージで復元します。** この手順は Linux・Bash・同じ CPU アーキテクチャの Docker ホスト間を対象にしています。

## 持ち運ぶもの

| 対象 | 内容・保存方法 |
| --- | --- |
| 独自版ソース | 全変更をコミットした Git bundle。ブランチ名だけでなくコミットも記録 |
| `.env` | 元の秘密値を保持して安全に転送。移行先の URL / IP を後で編集 |
| アプリと DB のイメージ | 実際にコンテナが使っているイメージを保存。タグの付け替わりに影響されない方法を下記に記載 |
| `overleaf-local_overleaf_data` | `/var/lib/overleaf`。プロジェクトファイル・履歴等のファイル領域 |
| `overleaf-local_mongo_data` | ユーザー・プロジェクト情報等の MongoDB データ |
| `overleaf-local_redis_data` | Redis の AOF・キュー・編集状態等 |
| `overleaf-local_translation_data` | 用語集・モデル選択・文体・プロンプト・短い翻訳履歴・保存済み LLM 接続先とキー |
| ホスト側の設定 | 独自 Compose 追加ファイル、プロキシ・DNS・TLS・Tailscale・ファイアウォール・自動起動・バックアップ定期実行 |
| LLM 側 | ランタイム名とバージョン、モデル名・重み・量子化、起動引数・プロンプトテンプレート、コンテキスト長、GPU ドライバー等 |

プロジェクト ZIP だけではユーザー・履歴・翻訳設定を復元できません。4 volume は同じ停止期間に取得したセットで保持します。`.env` と翻訳 DB には秘密情報、アーカイブには原稿を含むため、バックアップを Git や公開共有に入れず、アクセスを制限した媒体・転送経路で扱います。

以下は標準のプロジェクト名 **`overleaf-local`** と同梱の4 volume を使う例です。`-p` / `COMPOSE_PROJECT_NAME`、独自 volume 名・bind mount・追加サービスを使っている場合は、実際の構成に合わせて対象と復元先を変更してください。旧 PC にだけある外部連携を残さないよう、上の表を先に確認します。

## 1. 移行元で準備する（まだ停止しない）

この節からバックアップ終了まで、同じ Bash セッションでリポジトリルートから実行します。途中で失敗したら原因を解決してから再開し、不完全なセットを復元しないでください。

```bash
set -euo pipefail
umask 077
stamp=$(date -u +%Y%m%dT%H%M%SZ)
backup_dir="$PWD/backups/$stamp"
mkdir -p "$backup_dir"

# 運用中と同じ Compose ファイル群を指定する。
dc=(docker compose -p overleaf-local -f compose.yaml)
# LAN / Tailscale 公開中なら次も実行する。
# dc+=(-f compose.lan.yaml)

"${dc[@]}" config --quiet
"${dc[@]}" ps -a
git status --short
```

ソースに未コミットの変更・必要な未追跡ファイルがある場合は、秘密値が入っていないことを確認してコミットします。**Git bundle は未コミット／無視されたファイルを含みません。** 必要な追加設定も保存対象に含めます。`.env` は以下で個別にコピーします。

ソースのコミットと稼働イメージの作成元が一致しているかも運用記録で確認します。下記では両方を個別に保存するため、稼働イメージがソースより古い場合もその状態を保持します。

```bash
test -z "$(git status --porcelain)" || { echo '必要な変更を先にコミットしてください' >&2; exit 1; }
git rev-parse HEAD > "$backup_dir/source-commit.txt"
git bundle create "$backup_dir/source.bundle" --all HEAD
git bundle verify "$backup_dir/source.bundle"
cp .env "$backup_dir/env"
chmod 600 "$backup_dir/env"
docker version > "$backup_dir/docker-version.txt"
docker compose version > "$backup_dir/compose-version.txt"
docker info --format '{{.OSType}}/{{.Architecture}}' > "$backup_dir/platform.txt"

# データ保存用の小さな作業イメージ。停止前に取得しておく。
docker pull busybox:1.37

# 稼働中のコンテナの実イメージを別タグで保存する。
# ローカルの custom/latest タグが再ビルドで変わっていても元を保存できる。
image_tags=()
printf 'services:\n' > "$backup_dir/compose.images.yaml"
for service in sharelatex translation-service mongo mongo-init redis; do
  container_id=$("${dc[@]}" ps -a -q "$service")
  test -n "$container_id"
  image_id=$(docker inspect --format '{{.Image}}' "$container_id")
  image_tag="local/overleaf-migration/$service:$stamp"
  docker image tag "$image_id" "$image_tag"
  image_tags+=("$image_tag")
  printf '  %s:\n    image: %s\n' "$service" "$image_tag" >> "$backup_dir/compose.images.yaml"
done
docker image inspect "${image_tags[@]}" --format '{{.Id}} {{.Os}}/{{.Architecture}} {{json .RepoTags}}' > "$backup_dir/images.txt"
docker image save -o "$backup_dir/runtime-images.tar" "${image_tags[@]}" busybox:1.37
```

`compose.images.yaml` は保存したイメージを使うための追加設定です。アプリイメージをロードすれば復元時にベースイメージは不要です。ただし移行先でアプリを再ビルドする場合は、通常の[全ビルド](SETUP.md)を行うか、ベースの `local/overleaf-base:latest` / `local/overleaf-ja-base:latest` も別途 `docker image save` で保存します。

## 2. 書き込みを止め、全 volume を保存する

利用者に停止を知らせ、編集・コンパイル・翻訳を終えてもらいます。アプリを先に正常停止し、編集状態を flush してから DB を止めます。以後、取得完了まで起動しません。

```bash
"${dc[@]}" stop -t 120 sharelatex translation-service
"${dc[@]}" stop -t 120 mongo redis
test -z "$("${dc[@]}" ps --status running -q)"

for volume in overleaf_data mongo_data redis_data translation_data; do
  volume_name="overleaf-local_$volume"
  # 名前間違いで空 volume をバックアップしないよう存在を確認する。
  docker volume inspect "$volume_name" >/dev/null
  test -z "$(docker ps -q --filter "volume=$volume_name")"
  docker run --rm --network none \
    --mount "type=volume,src=$volume_name,dst=/data,readonly" \
    --mount "type=bind,src=$backup_dir,dst=/backup" \
    busybox:1.37 tar czpf "/backup/$volume.tgz" -C /data .
done

# 中身の列挙が成功することを確認し、転送検証用のハッシュを作る。
for volume in overleaf_data mongo_data redis_data translation_data; do
  tar tzf "$backup_dir/$volume.tgz" >/dev/null
done
(cd "$backup_dir" && sha256sum source.bundle source-commit.txt env \
  docker-version.txt compose-version.txt platform.txt images.txt compose.images.yaml \
  runtime-images.tar overleaf_data.tgz mongo_data.tgz redis_data.tgz translation_data.tgz > SHA256SUMS)
printf 'バックアップ先: %s\n' "$backup_dir"
```

停止コマンドが強制終了・タイムアウトした場合は、ログを確認し、正常起動・正常停止を済ませてから取り直します。通常の定期バックアップなら、取得後に `"${dc[@]}" up -d --no-build --pull never` で元の環境を再開できます。移行の最終コピーでは旧 PC を停止したままにします。旧 PC を再開して書き込みが生じたら、切り替え前に再度全データを取得してください。

`down -v` や `docker volume prune` はバックアップ／移行には使いません。バックアップの成功はファイル作成だけで判断せず、別プロジェクトへの復元も確認します。

## 3. 移行先へ転送して準備する

上のバックアップディレクトリ全体を安全に転送します。ここからは新しい Bash セッションで、`backup_dir` を転送先の絶対パスに設定します。

```bash
set -euo pipefail
umask 077
backup_dir=/absolute/path/to/backup
cd "$backup_dir"
sha256sum -c SHA256SUMS
cat platform.txt
docker info --format '{{.OSType}}/{{.Architecture}}'
docker image load -i runtime-images.tar

# 新規の空ディレクトリへ clone する。パスは移行先に合わせる。
git clone "$backup_dir/source.bundle" /absolute/path/to/overleaf
cd /absolute/path/to/overleaf
git checkout --detach "$(cat "$backup_dir/source-commit.txt")"
cp "$backup_dir/env" .env
chmod 600 .env
```

CPU アーキテクチャが違う場合は保存イメージをそのまま使う前提を見直します。対象アーキテクチャでビルドし直す場合も、MongoDB の物理データの互換性を確認する必要があります。DB のメジャー更新を兼ねた復元はこの手順の対象外です。

`.env` の `OVERLEAF_SITE_URL`、公開先 IP、ポート、LLM URL・キーを移行先に合わせます。**既存の `OVERLEAF_INVITE_TOKEN_SECRET` は維持**します。Tailscale は移行先で参加・アドレス取得し直し、プロキシ・TLS 等も準備します。LLM も同時に移す場合は、先に同じモデルと API を用意してください。

## 4. 空の volume に復元する（起動前）

復元先に既存データがある場合は上書きせず、別のプロジェクト名で試します。次の `target_stack` を `overleaf-restore-test` などに変えると、同梱 Compose の4 volume も別名になります。テスト時は `.env` も loopback と空きポートに変更し、LAN 用追加ファイルを使わないでください。

```bash
target_stack=overleaf-local
dc=(docker compose -p "$target_stack" -f compose.yaml)
# 本番で LAN / Tailscale を使う場合のみ追加。
# dc+=(-f compose.lan.yaml)
dc+=(-f "$backup_dir/compose.images.yaml" -f compose.restore.yaml)
"${dc[@]}" config --quiet

# 復元先 volume はすべて未作成であることを確認。1つでも既存なら停止する。
# 既存 volume を削除せず、別の target_stack でやり直す。
for volume in overleaf_data mongo_data redis_data translation_data; do
  if docker volume inspect "${target_stack}_$volume" >/dev/null 2>&1; then
    echo "復元先が既に存在します: ${target_stack}_$volume" >&2
    exit 1
  fi
done

# create はコンテナと Compose 管理の volume を作るが、サービスを起動しない。
"${dc[@]}" create --no-build --pull never
for volume in overleaf_data mongo_data redis_data translation_data; do
  volume_name="${target_stack}_$volume"
  docker volume inspect "$volume_name" >/dev/null
  test -z "$(docker ps -q --filter "volume=$volume_name")"
  docker run --rm --network none \
    --mount "type=volume,src=$volume_name,dst=/data" \
    --mount "type=bind,src=$backup_dir,dst=/backup,readonly" \
    -e "ARCHIVE=$volume.tgz" busybox:1.37 sh -eu -c \
    'test -z "$(ls -A /data)" || { echo "復元先は空ではありません" >&2; exit 1; }; tar xzpf "/backup/$ARCHIVE" -C /data'
done
```

同梱の `compose.restore.yaml` は、コンテナ作成時にイメージ内の初期ファイルを volume へコピーしない設定（`nocopy`）です。これにより空チェックを維持して復元できます。復元途中で失敗したときは、その volume に再展開せず、別の空の復元先で最初からやり直します。展開はコンテナ内 root で行うため、元の数値 UID / GID とパーミッションを保持します。`chmod -R 777` 等は不要です。

## 5. 起動・確認・切り替え

```bash
"${dc[@]}" up -d --no-build --pull never
"${dc[@]}" ps -a
"${dc[@]}" logs --tail=100 sharelatex mongo-init translation-service
```

1. `mongo-init` が終了コード0、MongoDB / Redis / 翻訳サービスが healthy、Overleaf が running。
2. 既存アカウントでログインでき、プロジェクト・画像・添付ファイル・履歴が開く。
3. 移行前に使っていたテンプレートを同じコンパイラーでコンパイルできる。
4. 翻訳パネルで接続先を確認する。**SQLite の保存済み接続先は移行後も `.env` より優先**するため、必要なら「.env 設定へ戻す」または接続先を再保存する。
5. モデル・用語集・文体・プロンプトが残り、短文翻訳と `.en.tex` 保存に成功する。
6. 共同編集・変更追跡・外部連携等、実際に使う機能を確認する。
7. DNS / プロキシ / Tailscale 等の接続先を切り替え、新 PC だけに書き込みを集約する。

ブラウザー内の PDF キャッシュ・ログインセッションは引き継ぐ前提にせず、再ログイン・再コンパイルします。復元確認が終わるまで旧ホストとバックアップを保持します。新 PC で編集を開始してから旧 PC に戻す場合は、新 PC 側の変更を取り出すか、再度全データを移す必要があります。

復元後の運用でも `compose.images.yaml` を指定し続けると、移行時のイメージに固定できます。安定した場所に保管して Compose ファイル群を記録してください。通常のビルド版に更新する際はバックアップを取得し、保存イメージの追加設定を外して[更新手順](OPERATIONS.md)を実行します。ソースを編集する前には `git switch -c <作業ブランチ名>` でブランチを作ります。
