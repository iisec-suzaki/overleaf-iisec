# 追加のCompose設定

通常起動は `compose.yaml` だけを使います。以下は必要なときだけ重ねます。

## LAN・Tailscaleへの公開

`.env` の `OVERLEAF_LAN_IP` と `OVERLEAF_TAILSCALE_IP` に、このホストに割り当てられた
IPv4を設定します。ブラウザーから使うURLは `OVERLEAF_SITE_URL` に設定してください。

```sh
docker compose -f compose.yaml -f compose.lan.yaml up -d
```

既存のloopback公開に、指定した2つのアドレスへの公開を追加します。
MongoDB・Redis・翻訳サービス・Gitブリッジの内部ポートは公開しません。
LANだけに公開する場合は、追加ファイルを使わず既存の `OVERLEAF_LISTEN_IP` に
LANアドレスを指定する方法もあります。

## 空のvolumeへの復元準備

`compose.restore.yaml` は、イメージからvolumeへ初期ファイルがコピーされるのを止める設定です。
バックアップの作成・展開・既存データの消去は行いません。

復元先専用のComposeプロジェクト名を指定すると、通常運用のvolumeと分けられます。
同じ名前の復元先が既にある場合は新しい名前を選んでください。

```sh
docker compose -p overleaf-iisec-restore -f compose.yaml -f compose.restore.yaml create --no-build
```

この段階ではサービスを起動せず、作成された空のvolumeへバックアップを展開します。
対象は `overleaf_data`、`mongo_data`、`redis_data`、`translation_data`、`git_bridge_data` です。
バックアップ時と復元時のMongoDBの形式・バージョンを合わせ、所有者とパーミッションを保持してください。
LLMの保存済みAPIキーを復号するには、バックアップ時と同じ `LLM_KEY_SECRET` も必要です。

展開完了後は、同じプロジェクト名で通常設定を起動します。
公開ポートは他の稼働中インスタンスと重ならない値を設定してください。

```sh
docker compose -p overleaf-iisec-restore -f compose.yaml up -d
```
