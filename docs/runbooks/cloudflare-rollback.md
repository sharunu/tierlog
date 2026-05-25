# runbook: Cloudflare Workers Rollback / 誤デプロイ復旧

最終更新: 2026-05-25

## いつ参照する

- 本番 `tierlog.app` でユーザー報告の障害が発生した時
- Cloudflare Dashboard で **Deploy** ボタンを誤押下し、dev / staging build が本番に展開された疑いがある時
- 直近 commit を本番から取り除きたい時（軽微なバグ発見など）
- main branch の git tip と Cloudflare の active deployment が乖離していることが疑われる時

## 最初の 5 分でやること

### 1. 本番健全性の確認（HTTP 200 だけでは不十分）

`HTTP 200` を返していても、dev/staging build が本番に展開されているケースがある（2026-05-25 incident 参照）。以下を必ず確認:

```bash
# 1. HTTP ステータス
curl -sI https://tierlog.app/auth | head -3

# 2. dev preview URL の混入チェック（本番なら 0 件であるべき）
curl -s https://tierlog.app/auth | grep -c 'dev-duepure-tracker'

# 3. staging Supabase ref の混入チェック（本番なら 0 件であるべき）
curl -s https://tierlog.app/auth | grep -c 'uqndrkaxmbfjuiociuns'

# 4. main branch tip と Cloudflare active deployment の比較
git fetch origin
git log --oneline main -1
# Cloudflare Dashboard → Workers & Pages → duepure-tracker → Deployments タブで
# 「Active」表示の deployment が main tip と一致するか目視確認
```

- 上記 2 / 3 が **1 以上**を返すなら、dev/staging build が本番に展開されている可能性大 → ロールバック実施
- 4 で乖離が確認できた場合も同様

### 2. Cloudflare Dashboard でのロールバック

1. Cloudflare Dashboard → Workers & Pages → **duepure-tracker** → **Deployments**
2. Active deployment の 1 つ前（または直近の正常 deployment）の行で「⋯」→ **Rollback to this deployment** をクリック
3. ダイアログで確認 → 数秒で本番に反映
4. **1 分以内に** §1 の curl コマンド 4 件を再実行し、すべて 0 件返却 / 期待される HTTP 200 を確認

### 3. ユーザー通知の判断

- 影響時間が **5 分未満** かつ ユーザー報告 0 件 → 通知見送り、内部記録のみ
- 影響時間が **5 分以上** または ユーザー報告あり → `incident-communication-template.md` の手順で X / Discord 等で周知

## 誰に通知する

- 運営者（個人開発のため自分自身）
- 重大障害時は `contact@tierlog.app` 経由で問い合わせを受け付ける状態にし、ユーザーへ周知

## CLAUDE.md 既存ルール（再徹底）

> Variables and Secrets画面で環境変数を保存する際、**「Save」と「Deploy」の2つのボタン**がある：
> - **Save**: 変数を保存するだけ。次のビルド時から反映。**通常はこれを使う**。
> - **Deploy**: 変数保存に加え、**現在の最新ビルドを即座に本番デプロイする**。これを押すと、プレビュー環境のビルド（dev ブランチ由来）を本番として展開してしまい、**git main と本番が不一致になる事故**が起きる。

→ **Deploy ボタンは絶対に押さない**。変数を反映したい場合は `git commit --allow-empty -m "..." && git push origin <branch>` で再ビルド trigger。

## 関連インシデント

### 2026-05-25 Cloudflare Deploy 誤操作インシデント

- 報告書: `docs/reports/2026-05-25_cloudflare_deploy_incident.md`
- 概要: `#6-b Phase 4` の Sentry 検証中、ユーザーが Cloudflare Dashboard で `SENTRY_DSN` Runtime variable を追加した際、誤って **Deploy** を押下。dev branch の最新ビルドが本番に展開され、配信 JS に staging Supabase ref `uqndrkaxmbfjuiociuns` と dev preview URL `dev-duepure-tracker.jianrenzhongtian7.workers.dev` が混入
- 復旧: Cloudflare deployment rollback で `b475291f`（Merge branch 'dev' / main の過去 deployment）に戻す
- 検出のポイント: HTTP 200 は返るがログイン後に dev preview に遷移する状況。本 runbook §1 の curl コマンド 2 / 3 で検出可能だった

## 参考リンク

- Cloudflare Workers Deployments: https://developers.cloudflare.com/workers/configuration/deployments/ （取得日 2026-05-25）
- Cloudflare Workers Builds rollback: https://developers.cloudflare.com/workers/ci-cd/builds/ （取得日 2026-05-25）
- 本リポジトリ CLAUDE.md「Cloudflare ダッシュボードの『Deploy』ボタンについて」

## 関連 runbook

- `incident-communication-template.md` — ユーザー周知文テンプレート
- `supabase-incident-response.md` — Supabase 側障害との切り分け
- `monitoring-alert-handling.md` — Sentry アラート受信時の一次対応
