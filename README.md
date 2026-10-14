# ひと局

[つようら王11micro](https://yaneurao.fanbox.cc/posts/12761272) と対局する、ブラウザ内で完結する将棋アプリ。やねうら王のWASMが探索・合法手・千日手・27点法の入玉宣言を処理する。JavaScriptは盤面の表示と対局の進行を担う。実行時の外部依存、APIサーバー、計測サービスはない。

## 開発

Node.js 22以上、Emscripten **3.1.43**、Python 3、make、bsdtar、git、curl が必要。

```sh
source /path/to/emsdk/emsdk_env.sh
npm run engine
npm test
npm run build
npm run dev
```

`http://127.0.0.1:8795` を開く。開発サーバーも本番と同じ COOP/COEP/CSP を返す。`file://` やヘッダーを付けない静的サーバーでは動作しない。

`engine/manifest.json` にソースのコミット、評価関数URL、SHA-256、アーキテクチャを固定。`engine/browser.patch` はWASMのメモリ・スレッド上限、進行度ファイルの仮想FSパス、盤面情報取得コマンドを変更する。通常ビルドを使い、トーナメント用の簡略千日手判定を有効にしない。

`npm test` は実際のWASMで成り、二歩、打ち歩詰め、詰み、駒の取得、千日手、30手の自動対局を検証する。

## 配備

`infra/` は S3、CloudFront、main限定のGitHub OIDCデプロイロールを作るTerraformモジュール。stateとモジュールの呼び出しは **HikaruEgashira/iac-aws の projects/shogi-web** で管理する。モジュール参照はコミットSHAで固定する。

モジュール出力を、このリポジトリのActions変数へ設定する。

| Terraform出力 | Actions変数 |
| --- | --- |
| `bucket_name` | `SITE_BUCKET` |
| `distribution_id` | `CLOUDFRONT_DISTRIBUTION_ID` |
| `site_url` | `SITE_URL` |
| `deploy_role_arn` | `AWS_DEPLOY_ROLE_ARN` |

main pushで、固定版WASMのビルド・テスト・S3配信・本番のヘッダーと評価関数チェックサム確認を実行する。初回はIaC適用後に変数を設定し、`Test and deploy` を手動実行する。長期アクセスキーは使わない。

S3は非公開、CloudFront OACのみ読み取りを許可。HTTPS必須。WASMスレッド用にCOOP/COEPを付与する。日本を含むPriceClass_200、SSE-S3、圧縮、長期キャッシュを使用し、専用ドメイン・WAF・実行サーバーの固定費を増やさない。料金はアカウント共通の無料枠とアクセス量に依存する。

配信物は `releases/<commit>/` に保存し、最後にルートのindex.htmlを切り替える。バージョン管理を有効にし、非現行オブジェクト版は30日保存する。リリースディレクトリは公開中の古いタブを壊さないため自動削除しない。リリース数に比例して保存容量は増える。

### ロールバック

既存の正常なコミットを `RELEASE_SHA` に指定し、次を実行する。必要な認証は通常配信と同じ。

```sh
for file in licenses.html version.json index.html; do
  aws s3 cp "s3://$SITE_BUCKET/releases/$RELEASE_SHA/$file" "s3://$SITE_BUCKET/$file" --cache-control 'no-cache,max-age=0,must-revalidate'
done
aws cloudfront create-invalidation --distribution-id "$DISTRIBUTION_ID" --paths / /index.html /licenses.html /version.json
node scripts/smoke.mjs "$SITE_URL" "$RELEASE_SHA"
```

## 対応範囲

平手・先後選択・成り・駒打ち・待った・投了・27点法の入玉宣言・棋譜の端末内自動保存とUSI形式の書き出し。最新のSharedArrayBufferとWASM SIMD対応ブラウザが対象。段級位を保証する難易度調整、オンライン対人対局、棋譜の取り込み、双方の合意による持将棋は対象外。

アプリとエンジンはGPL-3.0-or-later、評価関数のnn.binとprogress.binはMIT。配信するWASMと同じコミットの元ソースと変更パッチを、サイトのライセンスページから提供する。
