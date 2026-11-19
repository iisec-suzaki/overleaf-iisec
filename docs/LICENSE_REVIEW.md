# 公開前のライセンス確認

[README](../README.md) · [変更・権利表記](../NOTICE.md) · [上流のクレジット](../CREDITS.md)

確認日: 2026-11-09。対象はこの作業ツリーと、下記に固定した上流コミットです。

**Overleaf CE / CE+ の改変版をさらに改変して公開すること自体は、AGPLv3 の許諾範囲です。ただし、本リポジトリは公開準備完了とは判定していません。** 稼働版ソースの提供先、上流の矛盾した権利表記、CE+ の取り込み元の確認などが残っています。本書は技術的な調査記録であり、権利者による許諾確認や法律専門家の判断を代替しません。

## 1. 確認できたこと

| 対象 | 確認結果・根拠 |
| --- | --- |
| 公式 CE | 基準 `e039ad26c5bf5422eb57b89fc7e57c75055e631d` の `LICENSE` は AGPLv3。ローカル `LICENSE` と同一 |
| CE+ | 統合元 `ae07e781ab20dac2378420e5cf7a47f7d8bccbb5` の `LICENSE` も同一の AGPLv3。CE+ を経由したこと自体で再改変が禁止されるわけではない |
| 元の告知 | `LICENSE`、`CREDITS.md`、各所の個別 LICENSE を保持。今回 `NOTICE.md` に独自改変の内容・日付・非公式版であることを追加 |
| 独自追加 | 翻訳 UI / API、翻訳サービス、日本語ビルド、PDF キャッシュ等も改変版の対応ソースとして提供する方針を `NOTICE.md` に明記 |
| 改変前のソースリンク | `services/web/config/settings.defaults.js` の既定フッターは公式 Overleaf を指す。この版の対応ソースの提供先としては不足 |

一次資料: [公式 CE の LICENSE](https://github.com/overleaf/overleaf/blob/e039ad26c5bf5422eb57b89fc7e57c75055e631d/LICENSE)、[CE+ の LICENSE](https://github.com/yu-i-i/overleaf-cep/blob/ae07e781ab20dac2378420e5cf7a47f7d8bccbb5/LICENSE)、[AGPLv3 原文](https://www.gnu.org/licenses/agpl-3.0.html)。上流の現在の main と、この版の基準コミットは区別します。

## 2. 公開方法ごとに必要な対応

| 公開方法 | 対応 |
| --- | --- |
| 改変ソースを GitHub 等で配布 | AGPLv3 を維持し、元の著作権・許諾・無保証表記を残す。改変内容と日付を明示する。個別条件のある部分も保持する（4・5条） |
| サーバーを他の利用者に使わせる | その稼働版の対応ソースを、利用者が無償で取得できるよう目立つ場所に案内する（13条）。LAN / VPN 内だから免除、とは扱わない |
| Docker イメージ・実行形式を配布 | 対応するソースとビルド・インストール等のスクリプトを、6条の要件を満たす方法で提供する。単に上流の URL や別版のソースを示すだけでは足りない |
| 自分だけで利用・変更 | 利用形態を分けて考える。組織内コピーの扱いと、改変 Web アプリを他の利用者に使わせる場合の13条は別の話 |

対応ソースには独自翻訳部分、Dockerfile、Compose、ビルド・起動スクリプト、依存定義・ロックファイルなどを含めます。別コンテナであることだけを理由に翻訳サービスを除外しません。正確な対象範囲は結合の実態によります。

原稿・PDF・ユーザーデータ・API キー・DB・バックアップを公開する趣旨ではありません。通常の利用者文書が、単にこのエディタで作成したことだけで AGPL になるわけでもありません（2条）。公開用ソースと秘密値入りの移行バックアップは別に作ります。

参考: [FSF の AGPL FAQ](https://www.gnu.org/licenses/gpl-faq.html#UnreleasedModsAGPL)。法的要件の最終根拠はライセンス本文です。

## 3. 未解決の権利表記・由来

### 上流に残る `Proprietary` と個別ライセンスの不一致

以下は独自翻訳が追加した表記ではなく、公式 CE の基準コミットから存在します。

- `libraries/overleaf-editor-core/package.json:19` の `license: Proprietary`
- `services/history-v1/package.json:6` の `license: Proprietary`

これらの配下には、この調査で別の LICENSE を発見していません。ルートの AGPL とメタデータが食い違うため、**誤記と断定して AGPL に書き換えたり、商用ソース流出と断定したりしません**。公開前に上流の明示的な説明・訂正・許諾根拠を得る事項として残します。

`services/notifications/package.json` は ISC と記載していますが、同ディレクトリの `LICENSE` は AGPLv3 です。`libraries/redis-wrapper/package.json` は ISC を示す一方、同ディレクトリに許諾文のファイルは見つかっていません。これらも自動的な再ライセンスや許諾文の捏造で解消しません。

ローカルでの再確認例:

```sh
git show e039ad26c5bf5422eb57b89fc7e57c75055e631d:libraries/overleaf-editor-core/package.json
git show e039ad26c5bf5422eb57b89fc7e57c75055e631d:services/history-v1/package.json
```

上流への問い合わせはまだ行っていません。

### CE+ が取り込んだ別プロジェクト

`CREDITS.md` は `ertuil/overleaf`、`smhaller/ldap-overleaf-sl`、`ayaka-notes/overleaf-pro` 等を参照しています。それぞれの現在のリポジトリには AGPLv3 の表示を確認しました。ただし、**現在の表示だけで、実際に取り込まれた全ファイル・全コミットの権利を確認したことにはしません**。

特に `ayaka-notes/overleaf-pro` は現在 `ayaka-notes/ayakaleaf-pro` へ転送されます。CREDITS が参照する固定コミット `06a30fe9a0ed75e5ab40b50a8a4e94f43161cf71` の LICENSE は今回取得できず、Git / GitHub 同期 / 登録ページなどの取り込み元と個別表記の確認を残しています。一般の閲覧失敗は、権利がないことの証明でもありません。

参考: [ertuil/overleaf](https://github.com/ertuil/overleaf)、[LDAP 拡張](https://github.com/smhaller/ldap-overleaf-sl)、[現在の Ayakaleaf](https://github.com/ayaka-notes/ayakaleaf-pro)。クレジットのリンクだけでは許諾の代わりにならないため、由来・許諾・必要な告知を対応付けて確認します。

## 4. 全体を AGPL だけで扱わない

| 対象 | 今回確認した条件・残作業 |
| --- | --- |
| ソース内の第三者コード | ShareJS、git-bridge、o-error 等に MIT、フォントに OFL / Apache-2.0 等の個別ファイルがある。元の著作権・許諾文を残す |
| Node.js / Python の依存 | 下記のイメージでメタデータを棚卸し。直接・推移依存の全許諾文・NOTICE・互換性の精査は未完了。ロックファイルがあるだけでは完了にならない |
| TeX Live・日本語クラス・フォント | フル TeX Live は単一ライセンスではない。配布するイメージ内の各パッケージ・フォントの許諾文と、必要な対応ソースを確認する |
| MongoDB 8.0 | SSPL。通常のアプリ内部 DB と、MongoDB 自体をサービスとして提供する場合を区別。配布時の告知・ソース提供等の義務も別途確認 |
| Redis 7.4 | RSALv2 / SSPLv1 の選択。BSD と扱わず、Redis 8 の AGPL 選択肢も7.4へ遡って適用しない。Redis 自体の機能を提供するサービス・再配布条件は別途確認 |
| OS・Nginx・Node・Python 等 | イメージを公開する場合は、同梱物の著作権・許諾文・ソース提供等の義務も対象。アプリの LICENSE だけでは覆わない |
| LLM ランタイム・モデル・重み | 本リポジトリに含めていない。実際に使うモデルのライセンス、利用規約、再配布・サービス提供・商用利用の条件を別途確認 |

MongoDB は通常の MongoDB 利用 SaaS に SSPL のサービス公開条件を一律適用しない旨を説明しています。これは全用途・全配布形態の無条件承認ではありません。[MongoDB ライセンス FAQ](https://www.mongodb.com/legal/licensing/server-side-public-license/faq)。

Redis は版ごとのライセンスを公開しています。[Redis の版別ライセンス](https://redis.io/legal/licenses/)、[RSALv2 本文](https://redis.io/legal/rsalv2-agreement/)。本構成で DB を内部利用することと、DB 自体を第三者に提供することを区別します。今回 DB の版や製品は変更していません。

### 使用中のアプリイメージの Node 依存

2026-11-09、`local/overleaf-ja:custom` のイメージ ID
`sha256:ba8879af5dcd65e34165136bf6d5d8342f699fccb44d90802de0e4399047abb9`
を、ネットワークと実データを使わずに調査しました。

Yarn PnP のパッケージを名前・版でまとめると1,198件、うち外部依存1,169件でした。外部依存の `license` 表記は MIT 730件、Apache-2.0 295件、ISC 65件、BSD-3-Clause 26件などです。これはビルド済みイメージの収録範囲で、開発依存の全件や、ライセンス互換性の検証済み件数を意味しません。

`license` 欄がない外部依存10件のうち、`@customerio/cdp-analytics-node@0.3.9`、`cluster@0.7.7`、`pause@0.0.1`、`redis@0.7.3`、`socket.io@0.9.19-overleaf-12`、`socket.io-client@0.9.17-overleaf-6`、`thirty-two@1.0.2`、`valid-url@1.0.9` では、同梱 LICENSE または README の MIT 型の許諾文も追加確認しました。古い Node クライアント `redis@0.7.3` と、別コンテナの Redis サーバー7.4は区別します。

`precond@0.2.3` は README に MIT の表記と外部リンクがありますが、完全な許諾文・著作権表示の同梱はこの範囲では未確認です。`base64id@0.1.0` は上位ディレクトリの LICENSE / README では許諾を確定できませんでした。対象版の配布物・ソース内ヘッダー等を調べる残件として扱います。欄が空であることだけで無許諾と断定しません。また、MIT 等の表示があっても許諾文・著作権・NOTICE の保持確認は別途必要です。

同じ種類の棚卸しは、実際に配布するイメージごとに再実行できます。結果は Git 管理外の `backups` に出力します。

```sh
mkdir -p backups/license-inventory
docker image inspect local/overleaf-ja:custom --format '{{.Id}}' > backups/license-inventory/image-id.txt
docker run --rm --network none --entrypoint node \
  --mount "type=bind,src=$PWD/scripts/license-inventory.cjs,dst=/overleaf/license-inventory.cjs,readonly" \
  local/overleaf-ja:custom /overleaf/license-inventory.cjs > backups/license-inventory/node-packages.json
```

`--entrypoint node` は本体の初期化・DB マイグレーションを走らせず、棚卸しだけを実行するために指定します。このスクリプトは package.json の表記と直下の告知ファイル名を `packages` に収集し、イメージに実体のない他プラットフォーム向け optional package 等は `unavailable` に分けます。法的な合否は判定しません。ビルド時に使った依存、バンドル済みコード、OS・Python・TeX・フォントは別に確認します。

### 翻訳イメージの Python 依存

同日、`local/overleaf-translation:latest` のイメージ ID
`sha256:81199bc4a9b23e104ec8fe8166723c6dc97ca238b8109528364e2cc1bc250c9e`
について `importlib.metadata` で22配布パッケージ（pip を含む）のメタデータを確認しました。いずれも license expression、license classifier、License 欄のいずれかに記載があります。

MIT、BSD、Apache-2.0 等のほか、`certifi@2026.10.23` は MPL-2.0、`typing_extensions@4.16.0` は PSF-2.0 の表記があります。個別条件・告知・必要な対応ソースの確認が残るため、この一覧だけで全依存の法的適合を認定しません。特に MPL 対象ファイルの扱いを、全体の AGPL 表記で上書きしません。

依存バージョンは調査したイメージのものです。今後の再ビルドで推移依存が変われば、棚卸しも更新します。

## 5. 名称・ロゴ・公式サービスとの区別

AGPL のコード利用許諾だけで、Overleaf の名称・ロゴを自社製品の商標として使う許諾を得たとは扱いません。README と NOTICE に非公式の派生版であることを表示し、公式版・公式提携・公式サポートを示唆しません。

アプリ内には上流由来のロゴ・ブランド画像が残っています。公開サービスの名称やロゴを確定する際は、独自の表示・保有画像を使うか、適用可能な許諾を確認します。著作権・ライセンス告知の保持と、ブランド画像の変更は区別してください。

公式 overleaf.com の利用規約は同サービス等に関する規約であり、その商用利用制限をセルフホスト AGPL コードのライセンスに置き換えて読みません。一方、同規約は商標等の権利を別途留保しています。[Overleaf の公式規約](https://www.overleaf.com/legal)。今回、セルフホスト派生版向けの包括的なロゴ使用許諾は確認できていません。

## 6. ソース提供リンクを設定する

既存の `OVERLEAF_RIGHT_FOOTER` 設定を Compose から渡せるようにしています。公開するコミットを確定したら、その版の全ソースを取得できる実 URL を `.env` に設定します。次の `example.invalid` は説明用で、そのまま公開してはいけません。

```dotenv
OVERLEAF_RIGHT_FOOTER='[{"text":"Modified source / 改変版ソース","url":"https://example.invalid/your-fork/tree/RELEASE_COMMIT"},{"text":"AGPLv3: redistribute under license / no warranty","url":"https://www.gnu.org/licenses/agpl-3.0.html"}]'
```

```sh
docker compose -f compose.yaml config --quiet
docker compose -f compose.yaml up -d --force-recreate sharelatex
```

LAN・復元イメージ等の追加 Compose ファイルも運用中と同じものを指定します。設定後、ログイン画面とプロジェクト一覧で実際にリンクが表示され、利用者の権限で対応ソースをダウンロードできることを確認します。エディタなどフッターのない画面からも分かりやすい導線が必要かを確認し、必要ならメニューにも追加してください。JSON 設定を渡しただけで13条への適合を確認したとはしません。

Private repository を使う場合も、全利用者に無償の取得手段が必要です。公式 CE / CE+ へのリンクや、独自差分を含まない別ブランチへのリンクだけにしません。GitHub のソースアーカイブだけで外部依存等の対応ソースを満たすかも、配布物に応じて確認します。

## 7. 公開前に完了させる項目

- [ ] `Proprietary` 等の矛盾した表記について、対象版の許諾根拠を確認する。
- [ ] CE+ の実際の取り込み元と許諾・告知の対応を確認する。
- [ ] 公開コミットを確定し、LICENSE / CREDITS / NOTICE / 個別ライセンスを含む対応ソースを準備する。
- [ ] 稼働版と一致するソースの取得先を設定し、画面からの導線・取得を実機確認する。
- [ ] 公開する名称・ロゴを決め、公式版と誤認させない表示にする。
- [ ] イメージも配布する場合は、実際のイメージ単位で依存・OS・TeX・フォント等を棚卸しし、必要な許諾文・NOTICE・ソース提供を揃える。
- [ ] LLM モデル・重みを同梱または提供する場合は、その条件を確認する。
- [ ] 公開ファイルと Git 履歴から秘密値・原稿・DB・バックアップが漏れないことを確認する。`.gitignore` は過去にコミットしたものを消さない。

未解決項目について権利者や専門家に確認する際は、対象コミット、対象ファイル、配布形態（ソース／イメージ／サービス）を添えます。今回、リポジトリの外部公開、イメージ公開、権利者への連絡、稼働環境の切り替えは行っていません。
