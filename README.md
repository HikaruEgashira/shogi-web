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

`engine:fetch` は公開サイトの `version.json` から現行リリースを特定し、そのリリースが公開する `source/`（manifest・patch・build script）がローカルのビルド入力と一致する場合だけWASMと評価関数を `public/` へ取得する。評価関数とWASMをmanifestのSHA-256で検証し、全て検証してから書き込む。入力が異なれば失敗するので、その場合は次の手順でビルドする。

エンジンのビルドには Emscripten **3.1.43**、Python 3、make、bsdtar、git、curl が必要。

```sh
source /path/to/emsdk/emsdk_env.sh
bun run engine
```

`http://127.0.0.1:8795` を開く。開発サーバーも本番と同じ COOP/COEP/CSP を返す。`file://` やヘッダーを付けない静的サーバーでは動作しない。

`engine/manifest.json` にソースのコミット、評価関数URL、評価関数とWASMのSHA-256、アーキテクチャを固定。`bun run build` はこれらのハッシュと、`public/source/` の配布ソースがビルド入力（manifest・patch・build script）と一致することを検査する。エンジンの入力を変えたら再ビルド後に `wasmSha256` を更新する。`engine/browser.patch` はWASMのメモリ・スレッド上限、進行度ファイルの仮想FSパス、盤面情報取得コマンドを変更する。通常ビルドを使い、トーナメント用の簡略千日手判定を有効にしない。

`bun test` は実際のWASMで成り、二歩、打ち歩詰め、詰み、駒の取得、千日手、30手の自動対局を検証する。さらに headless Chrome で本番と同じヘッダーの下にアプリを読み込み、1手指してエンジンの応答を確認する。Google Chrome が必要で、`CHROME_BIN` で実行ファイルを指定できる。`bun scripts/play.mjs URL` は任意のURLに対して同じ実走を行う。

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

`Test and deploy` は `build` と `promote` の2ジョブからなる。`build` は全てのpushとPRで走り、固定版WASMのビルド・テスト・ブラウザ実走を行う。mainのコミットは並列にビルドされ、それぞれ `releases/<commit>/` へ配信し、候補URLに対してヘッダー・チェックサム・配布ソースの検査（`smoke.mjs`）とブラウザ実走（`play.mjs`）をCloudFront経由で行う。入力（`engine/manifest.json`、`engine/browser.patch`、`scripts/build-engine.sh`）のハッシュで `public/engine/` と対応する配布ソースをキャッシュする。キャッシュがなければまず `engine:fetch` で公開中のリリースから取得し、入力が変わっていて取得できない場合だけEmscripten SDKを復元または導入して再ビルドする。通常のUI変更ではSDKもエンジンの作業ツリーも取得しない。初回はIaC適用後に変数を設定し、`Test and deploy` を手動実行する。長期アクセスキーは使わない。

`promote` は `production` concurrency group で直列化され、公開中のコミットより古いコミットの切り替えは省略する。切り替えはバケット内で `releases/<commit>/` のエントリファイル（`index.html`、`licenses.html`、`version.json`）をルートへコピーし、CloudFrontの無効化を要求し、完了待ちを挟まず公開URLに同じ検査と実走を行う。エントリファイルは最小TTL 0と`no-cache`で毎回再検証する。失敗した場合は直前に公開していたリリースへ戻してジョブを失敗させる。

S3は非公開、CloudFront OACのみ読み取りを許可。HTTPS必須。WASMスレッド用にCOOP/COEPを付与する。日本を含むPriceClass_200、SSE-S3、圧縮、長期キャッシュを使用し、WAF・実行サーバーを追加しない。評価関数とWASMはgzipで事前圧縮し、転送量を合計約3.1MBに抑える。料金はアカウント共通の無料枠とアクセス量に依存する。

`shogi.egahika.dev` の証明書はモジュール内のACM（us-east-1）、DNSは **HikaruEgashira/egahika.dev** で管理する。CloudFrontへのCNAMEとACM検証用CNAMEはDNS-onlyで保持する。初回は証明書だけを適用し、`certificate_validation_records` のCNAMEをDNS側へ反映してから全体を適用する。検証用CNAMEは証明書の自動更新にも必要。

`Watch production` が6時間ごとに公開中のページへ同じ検査と実走を行い、配信物の破損や改竄をCIの失敗として検出する。バージョン管理を有効にし、非現行オブジェクト版は30日保存する。リリースディレクトリは公開中の古いタブを壊さないため自動削除しない。リリース数に比例して保存容量は増える。

### ロールバック

`Roll back` ワークフローに公開済みリリースのコミットを指定して実行する。`promote` と同じ切り替え・検査・自動復帰を行う。ローカルからは通常配信と同じ認証で次を実行する。

```sh
SITE_BUCKET=... DISTRIBUTION_ID=... SITE_URL=... bash scripts/promote.sh "$RELEASE_SHA"
```

### 取り込み

mainへの直接pushとPRのauto-mergeを受け付ける。PRでは `build` ジョブだけが走る。ruleset `main` は `build` の成功を必須とし、ブランチの削除とforce pushを禁止する。リポジトリ管理者はrulesetをbypassできる。`gh pr merge --auto --squash` は `build` 成功後に取り込み、ブランチを削除する。

## 対応範囲

日本語・英語のUI（ブラウザ言語から初期選択、切り替え可能）と漢字・アルファベットの駒表記。平手・先後選択・成り・駒打ち・待った・投了・27点法の入玉宣言・棋譜の端末内自動保存とUSI形式の書き出し。最新のSharedArrayBufferとWASM SIMD対応ブラウザが対象。段級位を保証する難易度調整、オンライン対人対局、棋譜の取り込み、双方の合意による持将棋は対象外。

アプリとエンジンはGPL-3.0-or-later、評価関数のnn.binとprogress.binはMIT。配信するWASMと同じコミットの元ソースと変更パッチを、サイトのライセンスページから提供する。
