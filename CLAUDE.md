# shogi-web

ブラウザ内で完結する将棋アプリ。技術的事実は README、設計判断は `docs/adr/` に置く。ここには agent が毎回守る契約だけを書く。

## 不変条件

- 実行時の外部依存、API サーバー、計測、npm 依存を追加しない。必要な操作は Bun 標準 API と DevTools Protocol で書く。
- COOP/COEP/CSP の定義は `scripts/web-headers.mjs` の一箇所。開発サーバー、smoke、テストはこれを import する。
- エンジンは `engine/manifest.json` で固定する。`engine/manifest.json`、`engine/browser.patch`、`scripts/build-engine.sh` を変えたら `bun run engine` で再ビルドし、`wasmSha256` を更新する。`public/source/` はこの三つと一致していなければ `bun run build` が失敗する。
- GitHub Actions の `uses` はコミット SHA で固定し、バージョンをコメントで併記する。
- ブランチとタグを作らない。main 直接 push が通常経路で、PR は `gh pr merge --auto --squash` で取り込む。
- リリースは `releases/<commit>/` に不変で公開され、公開ページの切り替えだけが直列化される。`scripts/publish.sh` と `scripts/promote.sh` 以外から S3 を書かない。

## Definition of Done

1. `bun run check` がローカルで通る。Google Chrome または Chromium が必要で、`CHROME_BIN` で実行ファイルを指定できる。
2. push 後に `gh run watch` で `Test and deploy` の `build` と `promote` の両方の成功を確認する。`promote` は公開 URL で smoke と実走を行い、失敗すれば直前のリリースへ自動で戻る。
3. `git status` が clean で origin/main と同期している。

## 書き方

- README は技術的事実のみ。手順の由来や方針の説明は `docs/adr/NNNN-<slug>.md` に書く。
- コードの 1 行ごとに理由があること。コメントは「なぜ」だけを書く。
- 本番の障害は `Roll back` ワークフローに公開済みコミットを渡して復旧し、原因修正は main を前に進めて行う。
