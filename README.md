# Shogi

https://shogi.egahika.dev/

[つようら王11micro](https://yaneurao.fanbox.cc/posts/12761272) と対局する、ブラウザ内で完結する将棋アプリ。やねうら王のWASMが探索・合法手・千日手・27点法の入玉宣言を処理する。JavaScriptは盤面の表示と対局の進行を担う。実行時の外部依存、APIサーバー、計測サービスはない。

## 開発

Bun 1.4以上が必要。

```sh
bun run engine:fetch
bun run check
bun run dev
```

`engine:fetch` は公開サイトの `version.json` から現行リリースを特定し、そのリリースが公開する `source/`（manifest・patch・build script）がローカルのビルド入力と一致する場合だけWASMと評価関数を `public/` へ取得する。評価関数はmanifestのSHA-256で、WASMはコンパイル可否で検証し、全て検証してから書き込む。入力が異なれば失敗するので、その場合は次の手順でビルドする。

エンジンのビルドには Emscripten **3.1.43**、Python 3、make、bsdtar、git、curl が必要。

```sh
source /path/to/emsdk/emsdk_env.sh
bun run engine
```

`http://127.0.0.1:8795` を開く。開発サーバーも本番と同じ COOP/COEP/CSP を返す。`file://` やヘッダーを付けない静的サーバーでは動作しない。

`engine/manifest.json` にソースのコミット、評価関数URL、SHA-256、アーキテクチャを固定。`engine/browser.patch` はWASMのメモリ・スレッド上限、進行度ファイルの仮想FSパス、盤面情報取得コマンドを変更する。通常ビルドを使い、トーナメント用の簡略千日手判定を有効にしない。

`bun test` は実際のWASMで成り、二歩、打ち歩詰め、詰み、駒の取得、千日手、30手の自動対局を検証する。

`ccache` がPATHにあれば `EM_COMPILER_WRAPPER=ccache` でオブジェクトをキャッシュし、エンジンを差分で再ビルドする。CIも `.cache/ccache` を復元するので、`make clean` 後も変更のない翻訳単位は再コンパイルしない。

## 配備

`infra/` は S3、CloudFront、main限定のGitHub OIDCデプロイロールを作るTerraformモジュール。stateとモジュールの呼び出しは **HikaruEgashira/iac-aws の projects/shogi-web** で管理する。モジュール参照はコミットSHAで固定する。

モジュール出力を、このリポジトリのActions変数へ設定する。

| Terraform出力 | Actions変数 |
| --- | --- |
| `bucket_name` | `SITE_BUCKET` |
| `distribution_id` | `CLOUDFRONT_DISTRIBUTION_ID` |
| `site_url` | `SITE_URL` |
| `deploy_role_arn` | `AWS_DEPLOY_ROLE_ARN` |

main pushで、固定版WASMのビルド・テスト・S3配信・本番のヘッダーと評価関数チェックサム確認を実行する。入力（`engine/manifest.json`、`engine/browser.patch`、`scripts/build-engine.sh`）のハッシュで `public/engine/` と対応する配布ソースをキャッシュする。キャッシュがなければまず `engine:fetch` で公開中のリリースから取得し、入力が変わっていて取得できない場合だけEmscripten SDKを復元または導入して再ビルドする。通常のUI変更ではSDKもエンジンの作業ツリーも取得しない。初回はIaC適用後に変数を設定し、`Test and deploy` を手動実行する。長期アクセスキーは使わない。

S3は非公開、CloudFront OACのみ読み取りを許可。HTTPS必須。WASMスレッド用にCOOP/COEPを付与する。日本を含むPriceClass_200、SSE-S3、圧縮、長期キャッシュを使用し、WAF・実行サーバーを追加しない。評価関数とWASMはgzipで事前圧縮し、転送量を合計約3.1MBに抑える。料金はアカウント共通の無料枠とアクセス量に依存する。

`shogi.egahika.dev` の証明書はモジュール内のACM（us-east-1）、DNSは **HikaruEgashira/egahika.dev** で管理する。CloudFrontへのCNAMEとACM検証用CNAMEはDNS-onlyで保持する。初回は証明書だけを適用し、`certificate_validation_records` のCNAMEをDNS側へ反映してから全体を適用する。検証用CNAMEは証明書の自動更新にも必要。

配信物は `releases/<commit>/` に保存し、CloudFront経由で候補のHTML・ヘッダー・WASM・評価関数・配布ソースを検査してからルートのindex.htmlを切り替える。候補検査が失敗した場合は公開中のページを維持する。切り替えとキャッシュ無効化の後も同じ検査を実行する。バージョン管理を有効にし、非現行オブジェクト版は30日保存する。リリースディレクトリは公開中の古いタブを壊さないため自動削除しない。リリース数に比例して保存容量は増える。

### ロールバック

既存の正常なコミットを `RELEASE_SHA` に指定し、次を実行する。必要な認証は通常配信と同じ。

```sh
for file in licenses.html version.json index.html; do
  aws s3 cp "s3://$SITE_BUCKET/releases/$RELEASE_SHA/$file" "s3://$SITE_BUCKET/$file" --cache-control 'no-cache,max-age=0,must-revalidate'
done
aws cloudfront create-invalidation --distribution-id "$DISTRIBUTION_ID" --paths / /index.html /licenses.html /version.json
bun scripts/smoke.mjs "$SITE_URL" "$RELEASE_SHA"
```

## 対応範囲

日本語・英語のUI（ブラウザ言語から初期選択、切り替え可能）と漢字・アルファベットの駒表記。平手・先後選択・成り・駒打ち・待った・投了・27点法の入玉宣言・棋譜の端末内自動保存とUSI形式の書き出し。最新のSharedArrayBufferとWASM SIMD対応ブラウザが対象。段級位を保証する難易度調整、オンライン対人対局、棋譜の取り込み、双方の合意による持将棋は対象外。

アプリとエンジンはGPL-3.0-or-later、評価関数のnn.binとprogress.binはMIT。配信するWASMと同じコミットの元ソースと変更パッチを、サイトのライセンスページから提供する。
