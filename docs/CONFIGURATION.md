# 設定リファレンス

[README](../README.md) · [セットアップ](SETUP.md) · [運用](OPERATIONS.md)

## 設定ファイルの役割

| ファイル | 用途 |
| --- | --- |
| `.env.example` | 配布用テンプレート。秘密値を入れない |
| `.env` | このホストの設定・秘密値。Git 管理外 |
| `compose.yaml` | この独自版のセルフホスト構成。プロジェクト名は `overleaf-local` |
| `compose.lan.yaml` | LAN と Tailscale の指定 IPv4 に追加公開する設定 |
| `compose.restore.yaml` | 復元用。空 volume への初期ファイルの自動コピーを抑止 |
| `docker-compose.yml` / `docker-compose.debug.yml` | 上流由来の開発用。この環境の運用には使わない |

Compose コマンドには常に `-f compose.yaml` を付けます。LAN 用は `-f compose.lan.yaml` も付けます。`-p` / `COMPOSE_PROJECT_NAME` でプロジェクト名を変えると volume 名も変わり、別データとして起動します。

Compose へ渡すシェル環境変数は `.env` より優先されます。設定が反映されない場合は、同名変数や `COMPOSE_FILE`・`COMPOSE_PROJECT_NAME` の設定も確認します。

## `.env` の項目

| 変数 | 既定・例 | 意味 |
| --- | --- | --- |
| `OVERLEAF_SITE_URL` | `http://localhost:8080` | ブラウザーから使う基準 URL。ポート・プロトコルも合わせる |
| `OVERLEAF_LISTEN_IP` | `127.0.0.1` | ホスト側の待ち受けアドレス |
| `OVERLEAF_PORT` | `8080` | ホスト側のポート。コンテナ内は 80 |
| `OVERLEAF_RIGHT_FOOTER` | 空（上流既定を維持） | フッター項目の JSON 配列。公開時は稼働版の改変ソース取得先等を設定。[ライセンス確認](LICENSE_REVIEW.md)を参照 |
| `OVERLEAF_LAN_IP` | 空 | LAN 用追加公開先。LAN 用 Compose では必須 |
| `OVERLEAF_TAILSCALE_IP` | 空 | Tailscale 用追加公開先。LAN 用 Compose では必須 |
| `OVERLEAF_ENABLE_REGISTRATION_PAGE` | `false` | CE+ の自己登録ページを有効にするか |
| `OVERLEAF_ADMIN_EMAIL` | `admin@example.com` | 管理者連絡先。アカウント作成は別操作 |
| `OVERLEAF_INVITE_TOKEN_SECRET` | 空（起動前に必須） | 招待トークン署名用秘密値。既存環境の移行では保持する |
| `LOCAL_LLM_BASE_URL` | 空 | OpenAI 互換 API の `/v1` までの URL。未設定でも本体は起動可能 |
| `LOCAL_LLM_API_KEY` | 空 | LLM API の Bearer キー。不要なら空 |
| `LOCAL_LLM_MAX_CONCURRENT_REQUESTS` | `2` | 翻訳サービスから LLM への同時リクエスト上限 |
| `TRANSLATION_CHUNK_CHARS` | `3600` | チャンク分割の目安文字数 |
| `TRANSLATION_MAX_DOCUMENT_CHARS` | `500000` | 1 回の翻訳で受け付ける原文文字数の上限 |

`LOCAL_LLM_SERVICE_URL=http://translation-service:8000` と `TRANSLATION_DB_PATH=/data/translation.sqlite3` は Compose 内で固定しています。前者は Overleaf → 翻訳サービスの接続先で、LLM の URL とは別です。LLM の API キーをブラウザーに返す API はありませんが、SQLite には保存されるためバックアップも秘密情報として扱います。

## LLM の接続先

LLM サーバーはこの Compose に含まれません。サーバー側で `/v1/models` と `/v1/chat/completions`（ストリーミング応答）を用意し、利用モデルをロードしてください。

| LLM の配置 | `LOCAL_LLM_BASE_URL` の例 | 確認点 |
| --- | --- | --- |
| 別 PC（LAN） | `http://192.168.1.50:1234/v1` | 待ち受けアドレス・ファイアウォール・アドレス変更 |
| 別 PC（Tailscale） | `http://100.x.y.z:1234/v1` | ホスト VPN だけでなく、Docker のネットワークからも到達できること |
| 同じ Docker ホスト | `http://host.docker.internal:1234/v1` | Compose の `extra_hosts` を利用。LLM をホストの到達可能なアドレスで待ち受けさせる |

翻訳コンテナから見た `127.0.0.1` / `localhost` は**翻訳コンテナ自身**です。ホストで起動した LLM を指しません。`host.docker.internal` を使っても、ホストの loopback 限定で待ち受けるサーバーにはそのまま接続できません。

`.env` の値を変えた場合は、コンテナを再作成します。`restart` だけでは環境変数は更新されません。

```sh
docker compose -f compose.yaml up -d --force-recreate translation-service
```

翻訳の接続先の選択は **LLM 設定画面**（ユーザー設定の LLM 項目、`/user/llm-settings`）へ統合しました。翻訳パネルに接続 UI はなく、現在の接続先の一行表示と設定画面へのリンクだけを置きます。

- **標準設定に従う**（翻訳専用欄の既定）: 翻訳サービス側の設定を使い続けます。用語集・モデル・文体・システムプロンプトはプロジェクト単位です。
- **BYO 行を選ぶ**: 自分の LLM 行（OpenAI / OpenAI 互換。Anthropic は翻訳サービスが話せないため対象外）とモデル・ミニマルプロンプト・チャンク字数を翻訳専用欄に保存します。翻訳依頼のたびにサーバー側がキーを復号し、翻訳サービスへオーバーライドとして渡します（キーはブラウザーへ返りません）。

翻訳で実際に使われる接続先の優先順位は「**ユーザーの翻訳専用欄（BYO 行） > プロジェクトが選んだエンドポイント > 標準エンドポイント > 単一の保存済み接続先 > `.env`**」です。

## 翻訳エンドポイントの保存（名前付きプリセット・フォールバック側）

翻訳エンドポイント（SQLite 保存の名前付きプリセット）は、翻訳専用欄が「標準設定に従う」だときの標準 lane として残ります。登録は翻訳サービス API または管理運用側で行います（翻訳パネルの保存 UI は廃止済み）。

- **標準エンドポイント**（★）: プロジェクトがエンドポイント未選択のときに使われます。
- **追加パラメータ**: `/chat/completions` へ追加で送る JSON です（`stop`・`max_tokens`・`temperature` など）。`model` / `messages` / `stream` はパイプライン必須のため指定できません（保存時にエラー）。
- API キーは翻訳用 SQLite に保存され、読み出し時は有無のみ公開されます（生値は返りません）。

### 翻訳特化モデル（plamo-3-translate 等）の登録例

翻訳特化モデルは本文に命令文を混ぜる設計ではないため、「**ミニマルプロンプト（翻訳特化モデル用）**」にチェックして登録します。このモードでは命令文や用語集の文章を送らず、**直近 2 チャンクの対訳履歴**（公式 README の続き翻訳形式）だけで文脈を保ちます。

| 項目 | 値の例 |
| --- | --- |
| 名前 | `plamo-3-translate` |
| 接続先 URL | `http://192.168.0.10:8000/v1` |
| 追加パラメータ | `{"temperature": 0, "max_tokens": 4096, "stop": ["<\|plamo:tag\|>", "<\|plamo:bos\|>"]}` |
| チャンクサイズ | `4000` |
| ミニマルプロンプト | チェックする |

`max_tokens` は訳文の生成上限です。公式の短い例文では 256 ですが、本機能のチャンクは数千字規模あるため**大きめに設定し直します**（小さすぎると訳文が途中で切れます）。plamo 3 系の学習上限は入出力合計 32,768 トークンです。

実測（8B Q4・llama.cpp・n_ctx 32768）では、チャンクを 12,000 字まで大きくすると保護マーカーの複写が壊れることがありました（その場合も自動の分割再試行で回復します）。**4,000〜6,000 字**から始めて安定を確認しながら大きくするのが安全です。

### チャンクサイズとコンテキスト予算

エンドポイントごとに**チャンクサイズ（文字数）**を設定できます（空欄 = 全体の既定 `TRANSLATION_CHUNK_CHARS` の 3600 字）。チャンクを大きくすると翻訳の「縫い目」が減り、文書が 1 チャンクに収まる場合は**分割ゼロ・全文 1 リクエスト**で翻訳方向・用語・文体がぶれません。

コンテキスト予算の目安（plamo 3 系の 32,768 トークンに収める例）:

| 内訳 | 目安 |
| --- | --- |
| 今回の原文チャンク | 6,000 字 ≒ 6K トークン |
| 対訳履歴（直近 2 ペア・片側 1,500 字まで自動切り詰め） | ≒ 6K トークン |
| 訳文生成上限 `max_tokens` | 4,096 |
| 合計 | ≒ 22K トークン（余裕あり） |

モデルのコンテキストが大きい場合（256K 級など）はさらに大きくできますが、1 チャンクの応答時間は文字数に比例して長くなります（進捗表示と keepalive でタイムアウト対策済み）。文書がコンテキストに**収まらない**場合、全文を 1 度読ませることはできません。その場合は用語集（訳語の強制）、文書全体の要約（見出し・冒頭・末尾を毎チャンク送信）、対訳履歴の 3 層で整合を保ちます。


## LAN / Tailscale から公開する

同梱の `compose.lan.yaml` は **LAN と Tailscale の両方**を設定する構成です。

```sh
ip -4 addr
tailscale ip -4
```

実際のアドレスを `.env` に記入します。次の値は例です。

```dotenv
OVERLEAF_SITE_URL=http://100.x.y.z:8081
OVERLEAF_LISTEN_IP=127.0.0.1
OVERLEAF_LAN_IP=192.168.1.10
OVERLEAF_TAILSCALE_IP=100.x.y.z
OVERLEAF_PORT=8081
```

```sh
docker compose -f compose.yaml -f compose.lan.yaml config --quiet
docker compose -f compose.yaml -f compose.lan.yaml up -d
```

公開先は loopback、指定 LAN IPv4、指定 Tailscale IPv4 の3つです。起動前に該当アドレスがホストに存在する必要があります。移行先の IP に書き換えてください。ポート番号を変えたら `OVERLEAF_SITE_URL` も合わせます。

片方だけ使う場合は、次のような追加ファイル（例: `compose.network.yaml`）を自分の構成として保存し、`compose.lan.yaml` の代わりに指定します。

```yaml
services:
  sharelatex:
    ports:
      - "${OVERLEAF_LAN_IP:?Set OVERLEAF_LAN_IP}:${OVERLEAF_PORT:-8080}:80"
```

以後の起動・停止・設定確認・移行でも同じ Compose ファイル群を使います。独自の追加ファイルはソースと一緒に持ち運びます。

## HTTPS / リバースプロキシ

TLS 終端、ドメイン、DNS、Tailscale Serve は本リポジトリの自動構築範囲外です。既存の構成がある場合は設定・証明書の再発行方法・自動起動設定も移行します。公開 URL を `OVERLEAF_SITE_URL` に設定してください。

Overleaf の共同編集に必要な WebSocket の中継と、翻訳の SSE 配信を通す必要があります。独自の Nginx / ingress では SSE のバッファリングを無効にし、長い翻訳でも切断されないタイムアウトにします。翻訳は LLM の応答待ちにも15秒ごとに進捗を配信します。アプリ内 Nginx の設定は `server-ce/nginx/overleaf.conf.template` にあります。
