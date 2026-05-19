# Tierlog ブランドリネーム + tierlog.app ドメイン移行 — 完了報告

- 実施日: 2026-05-19
- 本番反映 commit: `4f42354` (merge of `a4de0c2` + `03cfd01` into `main`、`0614e7f → 4f42354`)
- 本番 URL: <https://tierlog.app>
- Plan: `docs/plans/2026-05-19_tierlog_rebrand.md`
- 関連 memory: [[project_oauth_redirect_paths]] / [[project_remaining_tasks_after_2026_05_09]]

## 完了サマリー

| フェーズ | 内容 | 結果 |
|---|---|---|
| 0 | 商標確認 / 読み方確定 (ティアログ) | ✅ |
| 1 | tierlog.app 取得 (Cloudflare Registrar) | ✅ |
| 2 | Cloudflare Custom Domain 紐付け | ✅ |
| 3-4 | 外部設定 5.B.1-5.B.8 (Supabase / Discord / Google / X / Cloudflare Build+Runtime / GitHub Actions secret) | ✅ ユーザー作業完了 |
| 5 | コード実装 16 ファイル (`a4de0c2` + `03cfd01`) | ✅ |
| 6 | dev preview 検証 (Claude 自前 + ユーザー実機) | ✅ |
| 7 | 本番反映 (`4f42354`)、本番動作確認 | ✅ |
| 8 | 後日対応 (系統 D 4 項目) | 残課題、memory 登録済 |

## コード変更範囲 (16 ファイル)

- **ブランド・表示名**: `src/lib/games/index.ts` (`APP_BRAND.name = "Tierlog"`、`dm.trackerName = "Tierlog - デュエプレ"`、`pokepoke.trackerName = "Tierlog - ポケポケ"`)、`src/app/layout.tsx` (`SITE_NAME`)、`src/app/auth/page.tsx` (h1)
- **theme**: `src/lib/theme.ts` (`THEME_STORAGE_KEY = "tierlog-theme"`)、`src/app/layout.tsx` (THEME_INIT_SCRIPT)
- **PWA**: `public/manifest.json` (`name` / `short_name`)、`public/sw.js` (`CACHE_NAME = "tierlog-v1"`)
- **共有・規約**: `src/components/share/ShareModal.tsx` (`tierlog-stats.png`)、`src/app/terms/page.tsx`、`src/app/privacy/page.tsx`
- **外部連携**: `src/lib/pokepoke/limitless-sync.ts` (User-Agent)、`.github/workflows/limitless-sync.yml` (`PRODUCTION_API_URL` secret 化 + 空チェックガード)、`scripts/sync-staging-data.mjs` (X-Client-Info)
- **ドキュメント**: `README.md`、`DESIGN.md`、`docs/app-structure-overview.html`

**コミット対象外** (`.gitignore`): `CLAUDE.md` / `AGENTS.md` はローカル同期更新済。

## 注目すべき出来事

### 1. フェーズ 2 で方針変更 (Cloudflare 仕様調査結果)

当初 dev preview に `dev.tierlog.app` を紐付ける予定だったが、Cloudflare Workers Preview URLs は **`workers.dev` 以外のサブドメインに紐付け不可** と公式ドキュメントに明記されていたため、dev preview は `dev-duepure-tracker.jianrenzhongtian7.workers.dev` 継続で再選択。Worker 名 (`duepure-tracker`) を変更すると KV/D1/Insights/環境変数バインディングが破壊されるため、Worker 名も維持。dev URL は開発者しか見ないため brand 残置で実害なし。

### 2. codex レビューで OAuth redirect path 5 点訂正

Plan 初版で誤っていた redirect path を codex 指摘で修正:
- Discord redirect path: `/auth/callback` ❌ → `/api/discord/callback` ✅
- Supabase Redirect URLs: `/auth/callback` 1 件 ❌ → `/auth/callback` + `/auth/confirm` 2 種 ✅
- Google/X provider 側 callback: アプリ URL 追加 ❌ → Supabase URL 固定、provider 側は Google: origin / X: brand URL のみ更新 ✅
- Build variables Save タイミング: 同時 ❌ → main push **前** 必須 ✅
- SW cache クリア処理: 新規追加 ❌ → activate ハンドラに既存、`CACHE_NAME` 変更だけで足りる ✅

これら 5 点は memory [[project_oauth_redirect_paths]] に保存済、将来のドメイン変更時に再利用。

### 3. dev sitemap.xml で URL 途中改行混入の発見

`STAGING_NEXT_PUBLIC_APP_URL` の末尾改行が原因で `<loc>https://dev-...workers.dev\n/dm/home</loc>` のように URL が分断される事象を curl で観測。Plan §5.B.6/5.B.7/5.B.8 に「**値は前後空白・改行なしで登録、Save 後にダッシュボード上で目視再確認**」の注意点を追記。ユーザーが本番設定時に注意して Save した結果、本番 `https://tierlog.app/sitemap.xml` は単一行 URL で正常出力。

コード側 trim 防御 (`process.env.NEXT_PUBLIC_APP_URL?.trim()`) は本作業のスコープ外 (build 時 inline のため runtime trim 不可、`scripts/prepare-cloudflare-env.sh` での sanitize が筋、別件作業)。

### 4. 当初 grep スコープが狭く DESIGN.md:789 を見逃した

実装完了後の grep 漏れチェックを `src/ public/ docs/` のみで実施したため、ルート直下の DESIGN.md / README.md / AGENTS.md / CLAUDE.md が対象外となり、DESIGN.md:789 の「Claude Code Review Prompt」内テンプレに残った「デュエプレトラッカー」を見逃した。ユーザー指摘で発見、追加 commit `03cfd01` で修正 + Plan §5.A.11 の grep コマンドを `--include` 形に修正済 (再発防止)。

## 本番検証エビデンス (2026-05-19 17:41:14)

```
GET https://tierlog.app/
  <title>Tierlog</title>
  <meta property="og:title" content="Tierlog">
  <meta property="og:site_name" content="Tierlog">
  <meta name="twitter:title" content="Tierlog">

GET https://tierlog.app/manifest.json
  {"name": "Tierlog", "short_name": "Tierlog", ...}

GET https://tierlog.app/sitemap.xml
  <loc>https://tierlog.app/dm/home</loc>     ← 単一行、改行なし
  <loc>https://tierlog.app/pokepoke/home</loc>
  <loc>https://tierlog.app/privacy</loc>
  <loc>https://tierlog.app/terms</loc>
```

ユーザー実機ブラウザ検証 (OAuth 3 経路 / Discord 連携 / PWA / 共有導線): OK。

## 後日対応 (フェーズ 8 = 系統 D)

memory [[project_remaining_tasks_after_2026_05_09]] の系統 D に登録:

11. 旧 workers.dev redirect 削除 (Supabase prod Auth / Discord prod App) — ユーザー作業
12. www.tierlog.app の Custom Domain 追加 + naked への 301 redirect — ユーザー作業
13. GitHub Actions LimitlessTCG Deck Sync の `workflow_dispatch` verify — `LIMITLESS_HTML_SYNC_PAUSED=true` のため skipped 確認で十分、cron 影響なし
14. Cloudflare Web Analytics で tierlog.app トラフィック計測確認 — 24h 後にダッシュボードで確認

## review-plan-loop 履歴

3 iteration で GO 到達:
- iter 1: mechanical 2 (`app_structure_overview_html_missing` / `twitter_card_validator_deprecated`) + judgment 1 (`sync_staging_x_client_info_brand` → `tierlog-staging-sync` リネーム確定) を解決
- iter 2: mechanical 1 (`app_structure_overview_html_replacement_count_and_service_name_gap` = URL 5箇所→1箇所訂正 + サービス名 3箇所明示) を解決
- iter 3: ✅ GO

## 参照

- Plan: `docs/plans/2026-05-19_tierlog_rebrand.md`
- 関連 memory:
  - [[project_oauth_redirect_paths]] — OAuth redirect path 構造 (今回 codex レビューで確立)
  - [[project_remaining_tasks_after_2026_05_09]] — 系統 D に後日対応 4 項目を登録
  - [[project_security_review_2026_05_14]] — 公開ブロッカー残 0 確認済
  - [[feedback_codex_review_flow]] — Plan → codex レビュー → 反映 → 実装フロー
  - [[feedback_self_verification]] — 検証は Claude 自前 (lint/build/curl/MCP) で実施
