# runbook: Live Build 判定（稼働 git SHA の確認）

最終更新: 2026-05-29

## いつ参照する

- dev preview / production が「今どの git commit のビルドを serve しているか」を確実に知りたい時
- `dev` push 後、Cloudflare のビルドが本当に新しい commit を反映したか確認する時
- 「preview URL が旧ビルドを serve している」疑いがある時（キャッシュ・ビルド失敗の切り分け）
- 本番反映後、`main` tip が本番に出ているか確認する時
- `cloudflare-rollback.md` の §1 健全性確認と併用して、誤デプロイの切り分けをする時

## 前提: build marker (`x-tierlog-build` meta)

Plan E / E-6 で、配信 HTML の `<head>` に build marker を埋め込んでいる:

```html
<meta name="x-tierlog-build" content="<git SHA 先頭 12 桁>"/>
```

- 値は `scripts/prepare-cloudflare-env.sh` が build 時に export する `NEXT_PUBLIC_BUILD_SHA`。
- Cloudflare Workers Builds では `WORKERS_CI_COMMIT_SHA`（full 40 桁 SHA1）を先頭 12 桁に truncate。
  - 公式 docs（取得日 2026-05-29）: https://developers.cloudflare.com/workers/ci-cd/builds/configuration/
- local build の fallback は `git rev-parse HEAD` の先頭 12 桁。git が無い環境では `unknown`。
- **非 secret**: 出るのは 12 桁 git SHA のみ。env 全体・内部設定・secret は一切出さない。
- `NEXT_PUBLIC_*` は build 時 inline されるため、curl で SSR HTML を取れば値が読める（client JS 実行不要）。

## 手順

### 1. 稼働 SHA を curl で取得

```bash
# dev preview
curl -s https://dev-duepure-tracker.jianrenzhongtian7.workers.dev | grep -o 'x-tierlog-build[^>]*'
# 本番
curl -s https://tierlog.app | grep -o 'x-tierlog-build[^>]*'
```

出力例: `x-tierlog-build" content="53e33a77365d"`

値だけ抜き出す場合:

```bash
curl -s https://dev-duepure-tracker.jianrenzhongtian7.workers.dev \
  | grep -oE 'x-tierlog-build"[^>]*content="[^"]+"' \
  | grep -oE '[0-9a-f]{12}|unknown'
```

### 2. push した commit と突合（完全一致）

```bash
# dev preview を確認する場合は dev branch の tip、
# production を確認する場合は main branch の tip と突合する。
git rev-parse --short=12 HEAD
```

- curl で得た 12 桁 と `git rev-parse --short=12 HEAD` が **完全一致**すれば、その環境は当該 commit を serve している。
- full SHA の先頭 12 桁 prefix 一致に相当する（衝突確率は実質ゼロ）。
- **一致しない**場合 → §4 へ。

### 3. ビルドが「成功」しているかを Cloudflare check-run で確認（必須）

> ⚠️ **preview URL の目視・curl だけで「反映済み」と判断しない。** lint / test が通っても OpenNext build は落ちうる（memory: cloudflare-build-verification）。**失敗ビルドは preview URL からは不可視**で、preview は直前の成功ビルドを serve し続ける。

```bash
# 直近の Cloudflare Workers Builds の成否を GitHub check-run で確認
gh run list --branch dev --limit 5
# または対象 commit の check-run
gh api repos/:owner/:repo/commits/$(git rev-parse HEAD)/check-runs \
  --jq '.check_runs[] | {name, status, conclusion}'
```

- check-run が `success` かつ §2 の SHA 突合が一致 → live 反映確定。
- check-run が `in_progress` → ビルド進行中。3〜5 分待って §1 から再実行。
- check-run が `failure` → ビルド失敗。preview は旧ビルドのまま。原因を修正して再 push。

### 4. 「旧ビルドを serve している」疑いの確定手順

§2 で SHA が一致しない場合、原因を切り分ける:

1. **ビルド進行中 / 失敗**: §3 の check-run を確認。`failure` なら preview は旧ビルドを serve（marker は旧 SHA）。
2. **CDN / edge キャッシュ**: 数十秒〜数分の伝播待ち。間隔を空けて §1 を再実行。
3. **git SHA の取り違え**: dev preview は `dev` tip、本番は `main` tip と突合しているか確認。
   ```bash
   git fetch origin
   git rev-parse --short=12 origin/dev    # dev preview と突合
   git rev-parse --short=12 origin/main   # 本番と突合
   ```
4. **誤デプロイ（dev build が本番に展開）**: 本番の marker が `dev` tip と一致し `main` tip と乖離していたら誤デプロイの可能性大。§5 の staging 汚染チェックも併用し、`cloudflare-rollback.md` のロールバック手順へ。
5. **marker が `unknown`**: build 時に `prepare-cloudflare-env.sh` が source されなかった（`WORKERS_CI_COMMIT_SHA` 不在かつ git 不在）。Cloudflare の build コマンドが `npm run build`（= script を source）経由か確認。

### 5. staging 汚染チェック（本番のみ・併用）

本番で稼働 SHA を確認する際は、`cloudflare-rollback.md` §1 の汚染チェックも併せて実行する（本番なら両方 0 件であるべき）:

```bash
curl -s https://tierlog.app | grep -c 'dev-duepure-tracker'   # 本番なら 0
curl -s https://tierlog.app | grep -c 'uqndrkaxmbfjuiociuns'  # staging Supabase ref。本番なら 0
```

- marker SHA が `main` tip と一致し、かつ上記が 0 件 → 本番は正しい本番ビルドを serve。
- 汚染が検出されたら（1 以上）→ `cloudflare-rollback.md` のロールバック手順へ。

## ローカルでの marker 動作確認（任意）

```bash
# script を source して export を確認
( . ./scripts/prepare-cloudflare-env.sh; echo "$NEXT_PUBLIC_BUILD_SHA" )
# → 12 桁 SHA（git rev-parse --short=12 HEAD と一致）
```

`npx opennextjs-cloudflare build` を script を source せずに直接実行した場合は `NEXT_PUBLIC_BUILD_SHA` が未設定となり marker は `unknown` になる（ローカル build pass 確認には影響なし。marker の値検証は dev preview の curl で行う）。

## 関連 runbook / 参考

- `cloudflare-rollback.md` — 誤デプロイ・ロールバック手順（§1 健全性確認・staging 汚染チェックと相互参照）
- `observability-overview.md` — Sentry release（`CF_VERSION_METADATA` 由来の deployment version id、git SHA とは別物）との違い
- Cloudflare Workers Builds 環境変数: https://developers.cloudflare.com/workers/ci-cd/builds/configuration/ （取得日 2026-05-29）
- 本リポジトリ `CLAUDE.md` / `AGENTS.md`「環境構成」「デプロイフロー」
