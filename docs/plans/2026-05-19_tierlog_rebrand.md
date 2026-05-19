# Tierlog ブランドリネーム + tierlog.app ドメイン移行 Plan

- 作成日: 2026-05-19
- 作成者: Claude (orchestrator)
- レビュー方式: `/review-plan-loop` で plan-critic 反復 → GO
- ステータス: Draft
- 関連 memory:
  - `project_oauth_redirect_paths.md` (OAuth/redirect path の構造)
  - `project_remaining_tasks_after_2026_05_09.md` (本作業はドメインバッチの一環)
  - `feedback_codex_review_flow.md` (Plan → codex レビュー → 反映 → 実装の順)
  - `feedback_self_verification.md` (検証は Claude 自前優先)
  - `project_security_review_2026_05_14.md` (公開ブロッカー残 0、本作業は公開前ラスト工程の一つ)

---

## 1. 背景・目的

- 「デュエプレトラッカー」という名称は元々 DM 専用の名前だが、ポケポケ対応で **マルチゲーム化** したため、サービス名と DM 専用名がズレている。
- 一般公開前のタイミングで、サービス名を **Tierlog (ティアログ)** に統一し、ドメインも独自ドメイン **tierlog.app** に移行する。
- 既存ユーザー 0 のため、後日リブランディングする場合に発生する「告知・周知・OAuth 並走期間・SEO 引き継ぎ・localStorage 移行コード・SW cache クリーンアップ」がすべて不要 → 公開前リネームが最適と確定済 (Q4 確定)。

## 2. 確定方針 (確認済の判断事項)

| ID | 項目 | 確定内容 |
|---|---|---|
| Q1 | trackerName 表記 | `Tierlog - デュエプレ` / `Tierlog - ポケポケ` (ゲーム別表記を残す) |
| Q2 | dev preview ドメイン | `workers.dev` 継続 (`dev-duepure-tracker.jianrenzhongtian7.workers.dev`)。Cloudflare Preview URLs は workers.dev 以外不可のため再選択。 |
| Q3 | GitHub リポジトリ名 | 今回は変更しない (`duepure-tracker` のまま) |
| Q4 | 公開タイミング | 公開前にリネーム完了 (既存ユーザー 0 のため) |
| 追加 | Worker 名 (`duepure-tracker`) | 変更しない (KV/D1/Insights/環境変数のバインディングが破壊されるため非推奨) |
| 追加 | Supabase project_id (`duepure-tracker`) | 変更しない (ローカル CLI 用、機能影響なし) |
| 追加 | package.json `name` | 変更しない (任意、機能影響なし、本 Plan のスコープ外) |
| 追加 | PWA アイコン/ファビコン | 今回のスコープ外 (後日対応) |

## 3. 完了済 (フェーズ 0-1、本 Plan の対象外)

- Tierlog の商標確認 (競合なし)
- 読み方確定 (ティアログ)
- tierlog.app を Cloudflare Registrar で取得

## 4. 進行中 (フェーズ 2、ユーザー作業、本 Plan の対象外)

- Cloudflare Workers `duepure-tracker` に Custom Domain `tierlog.app` を紐付け
- SSL 自動発行待ち
- (Plan 作成と並行進行)

## 5. 本 Plan のスコープ (フェーズ 3〜7)

### 5.A コード実装 (Claude 作業、dev ブランチで実施)

#### 5.A.1 ブランド・表示名定義

**`src/lib/games/index.ts`**:
- `APP_BRAND.name`: `"ゲーム戦績トラッカー"` → `"Tierlog"`
- `APP_BRAND.description`: `"各ゲームの対戦記録・環境分析ツール"` → 維持 (内容変えない)
- `GAMES.dm.trackerName`: `"デュエプレトラッカー"` → `"Tierlog - デュエプレ"`
- `GAMES.dm.description`: `"デュエル・マスターズ プレイスの対戦記録・環境分析ツール"` → 維持
- `GAMES.pokepoke.trackerName`: `"ポケポケトラッカー"` → `"Tierlog - ポケポケ"`
- `GAMES.pokepoke.description`: 維持

#### 5.A.2 layout metadata (HTML <title>, OG, Twitter Card)

**`src/app/layout.tsx`**:
- L23 `SITE_NAME`: `"ゲーム戦績トラッカー"` → `"Tierlog"`
- L24 `SITE_DESCRIPTION`: 維持 (内容変えない)
- `metadata.title` / `metadata.openGraph.siteName` / `twitter` は `SITE_NAME` 経由で自動追従
- L11 `THEME_INIT_SCRIPT` 内の `localStorage.getItem('duepure-theme')` → `localStorage.getItem('tierlog-theme')`

#### 5.A.3 auth 画面表記

**`src/app/auth/page.tsx`**:
- L131-133 の `<h1>ゲーム戦績トラッカー</h1>` → `<h1>Tierlog</h1>`
- L135 サブテキスト `対戦記録・環境分析ツール` は維持

#### 5.A.4 theme localStorage キー

**`src/lib/theme.ts`**:
- `THEME_STORAGE_KEY`: `"duepure-theme"` → `"tierlog-theme"`

(layout.tsx 側の `THEME_INIT_SCRIPT` も同期。5.A.2 参照)

既存ユーザー 0 のため旧キー → 新キー移行コードは **不要**。

#### 5.A.5 PWA manifest

**`public/manifest.json`**:
- `name`: `"ゲーム戦績トラッカー"` → `"Tierlog"`
- `short_name`: `"GameTracker"` → `"Tierlog"`
- `description`: 維持 (`"各ゲームの対戦記録・環境分析ツール"`)
- `icons` / `theme_color` / `background_color`: 維持 (アイコン差し替えはスコープ外)

#### 5.A.6 Service Worker cache 名

**`public/sw.js`**:
- L1 `CACHE_NAME`: `"dp-tracker-v2"` → `"tierlog-v1"`
- L11-22 の activate ハンドラが既に `name !== CACHE_NAME` の cache を `caches.delete` する処理を持つため、追加コード不要

既存ユーザー 0 のため、SW cache 移行リスクなし。

#### 5.A.7 共有 / OGP / ダウンロード

**`src/components/share/ShareModal.tsx`**:
- L93, L107 download filename: `"duepure-stats.png"` → `"tierlog-stats.png"`
- L37, L40, L43 の shareText に含まれる `trackerName` は 5.A.1 経由で自動追従

**`src/app/api/og/[id]/route.tsx`**:
- `trackerName` を引数で受けるため 5.A.1 で自動追従
- ただし OG 画像内のテンプレに「デュエプレトラッカー」固定文字列があれば実装時に確認・修正

#### 5.A.8 規約・プライバシー

**`src/app/terms/page.tsx`**:
- L21 最終更新日: `2026年4月18日` → `2026年5月19日` (リネームに伴う規約更新を反映)
- L35 第1条: `「本規約は、ゲーム戦績トラッカー（以下「本サービス」）の利用に関する条件を定めるものです。」` → `「本規約は、Tierlog（以下「本サービス」）の利用に関する条件を定めるものです。」`

**`src/app/privacy/page.tsx`**:
- L21 最終更新日: `2026年4月18日` → `2026年5月19日` (terms と同期)
- 本文中にサービス固有名はないため、本文変更なし

#### 5.A.9 外部連携 (User-Agent / GitHub Actions URL)

**`src/lib/pokepoke/limitless-sync.ts`**:
- L25 `USER_AGENT`: `"duepure-tracker/0.1 (+https://github.com/sharunu/duepure-tracker)"` → `"tierlog/0.1 (+https://github.com/sharunu/duepure-tracker)"`
- GitHub URL の `duepure-tracker` は **リポジトリ名のまま** (Q3 確定: repo 名変更なし)

**`.github/workflows/limitless-sync.yml`**:
- L20 `"https://duepure-tracker.jianrenzhongtian7.workers.dev/api/internal/limitless-sync"` を解消
- **案 B (secret 化) で確定** (Resolved Decisions 参照): `"${{ secrets.PRODUCTION_API_URL }}/api/internal/limitless-sync"` に変更
- 加えて `${{ secrets.PRODUCTION_API_URL }}` が空文字列の時に early fail するガード行を追加 (例: `if [ -z "${{ secrets.PRODUCTION_API_URL }}" ]; then echo "PRODUCTION_API_URL not set"; exit 1; fi`)
- GitHub Actions の Repository secrets に `PRODUCTION_API_URL = https://tierlog.app` を追加 (ユーザー作業、§5.B.8 参照)

**`scripts/sync-staging-data.mjs`**:
- L114 X-Client-Info ヘッダ `duepure-staging-sync/${name}` → `tierlog-staging-sync/${name}` にリネーム (公開前リブランドとして duepure の残存を減らすため、Supabase log 連続性より優先。Resolved Decisions 参照)

#### 5.A.10 ドキュメント類

**`README.md`**:
- L1 タイトル `# duepure-tracker` → `# Tierlog`
- サービス概要として `tierlog.app` を併記

**`DESIGN.md`**:
- L2 タイトル「デュエプレトラッカーのUI/ビジュアルデザイン」→「Tierlog の UI/ビジュアルデザイン」
- 本文中「デュエプレトラッカー」表記を「Tierlog」に置換

**`CLAUDE.md`** (ローカル、`.gitignore` 対象):
- L1 タイトル `# デュエプレトラッカー` → `# Tierlog`
- L6 本番 URL: `https://duepure-tracker.jianrenzhongtian7.workers.dev` → `https://tierlog.app`
- L12 dev URL: `https://dev-duepure-tracker.jianrenzhongtian7.workers.dev` → **維持** (workers.dev 継続)
- L61 プレビュー URL 記載: 同じく dev URL は維持、本番のみ変更
- L80-81 環境変数の `NEXT_PUBLIC_APP_URL` 値表記: 本番のみ更新

**`AGENTS.md`** (CLAUDE.md と同期):
- 同じ箇所を CLAUDE.md と同じ内容で更新

**`docs/runbooks/`**:
- 配下のファイルに `duepure-tracker.jianrenzhongtian7.workers.dev` (本番) が含まれていないか実装時に grep → あれば `tierlog.app` に置換
- dev URL (`dev-duepure-tracker.jianrenzhongtian7.workers.dev`) は維持

**`docs/app-structure-overview.html`**:
- 本番 URL `duepure-tracker.jianrenzhongtian7.workers.dev` を `tierlog.app` に置換 (実 grep で確認: 本番 URL は line 424 の **1 箇所のみ**。当初 plan の『5 箇所』記述は誤り)
- dev URL (`dev-duepure-tracker.jianrenzhongtian7.workers.dev`) は維持 (workers.dev 継続。line 430 / 792 に出現)
- サービス名 `デュエプレトラッカー` を `Tierlog` に置換 (line 6 `<title>` / line 297 `<h1>` / line 325 本文導入の `<strong>` の計 3 箇所)
- コード例ブロック内 `trackerName: "デュエプレトラッカー"` (line 742 付近、GAMES 定義の解説) は 5.A.1 の `src/lib/games/index.ts` 改修に合わせて `Tierlog - デュエプレ` に更新
- 「対象リポジトリ: duepure-tracker」(line 299) / 「duepure-tracker/」ディレクトリ表記 (line 454) / フッタ「duepure-tracker / アプリ構造ガイド」(line 947) の **repo 名表記** は維持 (Q3 確定: repo 名変更なし)

#### 5.A.11 grep で確認する「意図的に残す箇所」

以下は **意図的に変更しない**:

| ファイル | 残す理由 |
|---|---|
| `package.json` の `"name": "duepure-tracker"` | 機能影響なし、スコープ外 |
| `wrangler.jsonc` の `"name": "duepure-tracker"` | Worker 名変更は破壊的 |
| `supabase/config.toml` の `project_id = "duepure-tracker"` | ローカル CLI 用、機能影響なし |
| `src/lib/pokepoke/limitless-sync.ts` GitHub URL の `duepure-tracker` | repo 名 (Q3) |
| `src/lib/games/context.tsx` の `selectedGame` Cookie | 汎用名、リネーム不要 |
| `dev-duepure-tracker.jianrenzhongtian7.workers.dev` (dev URL) | workers.dev 継続 |

実装後の grep で上記以外の `duepure-tracker` / `デュエプレトラッカー` / `ゲーム戦績トラッカー` / `GameTracker` / `duepure-theme` / `dp-tracker-v2` / `duepure-stats` が残っていれば追加修正。

### 5.B 外部設定変更 (ユーザー作業、main push 前に実施)

#### 5.B.1 Supabase Auth (production project)

ダッシュボード Path: Authentication → URL Configuration

- **Site URL**: `https://tierlog.app` に変更
- **Additional Redirect URLs に追加** (旧 workers.dev URL は **本番動作確認完了まで残す**):
  - `https://tierlog.app/auth/callback` (Google/X ログインフロー、auth/page.tsx:55)
  - `https://tierlog.app/auth/confirm` (パスワードリセットフロー、auth/page.tsx:107)

#### 5.B.2 Supabase Auth (staging project: `uqndrkaxmbfjuiociuns`)

- dev URL は workers.dev 継続のため、staging Supabase の Redirect URLs は **変更不要**
- 既存の `dev-duepure-tracker.jianrenzhongtian7.workers.dev/auth/callback` 等の dev URL は **削除しない**

#### 5.B.3 Discord Developer Portal (本番 Discord App)

ダッシュボード Path: Application → OAuth2 → Redirects

- 追加: `https://tierlog.app/api/discord/callback`
  - redirect path は `/api/discord/callback` (NOT `/auth/callback`、src/app/api/discord/start/route.ts:66)
- 既存 dev workers.dev redirect (`https://dev-duepure-tracker.jianrenzhongtian7.workers.dev/api/discord/callback`) は **dev 検証用に残す**
- 既存 prod workers.dev redirect (`https://duepure-tracker.jianrenzhongtian7.workers.dev/api/discord/callback`) は本番動作確認完了まで残し、後日削除

#### 5.B.4 Google Cloud Console

- OAuth 2.0 Client ID 設定:
  - **Authorized JavaScript origins** に `https://tierlog.app` を追加
  - **Authorized redirect URIs** は Supabase の `https://uosgcrgmcwerlqfpprcl.supabase.co/auth/v1/callback` のまま **絶対に変更しない**
- OAuth consent screen:
  - **Authorized domains**: `tierlog.app` を追加
  - **Application home page URL**: `https://tierlog.app`
  - **Application privacy policy link**: `https://tierlog.app/privacy`
  - **Application terms of service link**: `https://tierlog.app/terms`
  - (オプション) Application name / Logo を Tierlog 用に更新

#### 5.B.5 X (Twitter) Developer Portal

- App 設定:
  - **Website URL**: `https://tierlog.app`
  - **Terms of Service URL**: `https://tierlog.app/terms`
  - **Privacy Policy URL**: `https://tierlog.app/privacy`
- **Callback URI / Redirect URL は Supabase の URL のまま、絶対に変更しない**

#### 5.B.6 Cloudflare Build variables and secrets (本番側)

ダッシュボード Path: Workers & Pages → `duepure-tracker` → Settings → Build variables and secrets

- `NEXT_PUBLIC_APP_URL`: `https://tierlog.app` に変更
- `STAGING_NEXT_PUBLIC_APP_URL`: **変更不要** (dev workers.dev 継続)
- **保存は「Save」のみ。「Deploy」ボタンは絶対に押さない** (押すと dev preview ビルドが本番展開され、main と本番不一致事故が起きる)
- **タイミングは main push の前** (NEXT_PUBLIC_* はビルド時 inline、main push 後だと本番ビルドに旧 URL が残る)
- **値の入力は前後空白・改行なし** (正しい値: `https://tierlog.app`)。Cloudflare ダッシュボードのテキストフィールドはコピペ時に末尾改行が紛れ込むことがあり、`new URL(...)` 等を通って sitemap.xml の `<loc>` / og:image 絶対 URL に改行が含まれリンク切れの原因になる。**実際 dev (STAGING_NEXT_PUBLIC_APP_URL) で末尾改行混入が curl 検証で観測済** (本番でも同じミスをしないよう注意)。Save 後、Cloudflare ダッシュボード上で値を再表示して末尾に余分な改行や空白がないか目視確認すること

#### 5.B.7 Cloudflare Runtime Variables (本番側、念のため)

ダッシュボード Path: Workers & Pages → `duepure-tracker` → Settings → Variables and Secrets (Runtime)

- Runtime 側に `NEXT_PUBLIC_APP_URL` が登録されている場合は同じく `https://tierlog.app` に揃える
- CLAUDE.md (`Build + Runtime 両方に登録するのが確実`) と整合
- **値の入力は前後空白・改行なし** (5.B.6 と同じ理由、Build と Runtime で値がズレないよう注意)

#### 5.B.8 GitHub Actions Repository Secrets (本番側)

ダッシュボード Path: GitHub Repository → Settings → Secrets and variables → Actions → Repository secrets

- **追加**: `PRODUCTION_API_URL` = `https://tierlog.app`
  - 用途: `.github/workflows/limitless-sync.yml` が `${{ secrets.PRODUCTION_API_URL }}/api/internal/limitless-sync` 形式で参照する本番 API base URL
  - URL 自体は非機密 (一般公開ドメイン) なので Repository variables でも機能的には可。今回は Resolved Decisions に従い **secret として登録** (将来のドメイン変更時に値を秘匿性のある場所に集約しておくため、および INTERNAL_API_KEY と同じ管理面に揃えるため)
  - **main push 前に登録完了必須**。未登録だと cron job が空 URL で fetch 失敗する (空チェックガードで early fail する)
  - **値の入力は前後空白・改行なし** (5.B.6 と同じ理由、`${{ secrets.PRODUCTION_API_URL }}/api/internal/limitless-sync` を組み立てる時に改行が混入すると HTTP リクエスト URL がエラーになる)

### 5.C 実行順序

```
1. Claude: dev ブランチで 5.A の変更を実装し、**対象ファイルを明示して** `git add` (`git add .` は禁止: `.codex/` 等の untracked を意図せず含めないため)。明示対象 (15 ファイル + Plan 1):
   - `src/lib/games/index.ts` / `src/app/layout.tsx` / `src/app/auth/page.tsx` / `src/lib/theme.ts`
   - `public/manifest.json` / `public/sw.js`
   - `src/components/share/ShareModal.tsx` / `src/app/terms/page.tsx` / `src/app/privacy/page.tsx`
   - `src/lib/pokepoke/limitless-sync.ts` / `.github/workflows/limitless-sync.yml` / `scripts/sync-staging-data.mjs`
   - `README.md` / `DESIGN.md`
   - `docs/app-structure-overview.html` (**今回 Tierlog リネームの一環として明示的にコミット対象に含める意図**: 元々 untracked だったが本番 URL とサービス名の置換が必要なため)
   - `docs/plans/2026-05-19_tierlog_rebrand.md` (Plan ファイル + Resolved Decisions 履歴)
   - **コミット対象外**: `CLAUDE.md` / `AGENTS.md` (`.gitignore` 対象、ローカル運用)、`.codex/` (untracked、本作業と無関係)
2. Cloudflare が dev preview をビルド (3〜5分)
3. ユーザー + Claude: dev preview (workers.dev) で 5.D.A の検証
4. ユーザー OK
5. ユーザー: 5.B.1〜5.B.8 をすべて実施 (main push 前に完了必須。特に 5.B.8 の `PRODUCTION_API_URL` secret 未登録だと main 反映後の GitHub Actions cron job が失敗する)
6. Claude: git checkout main && git pull && git merge dev && git push origin main
7. Cloudflare が本番ビルド (NEXT_PUBLIC_APP_URL=tierlog.app が inline、3〜5分)
8. ユーザー + Claude: https://tierlog.app で 5.D.B の検証
9. Claude: git checkout dev で戻す
10. (後日) 本番動作が安定したら、5.B.1 / 5.B.3 の旧 workers.dev redirect を削除
```

### 5.D 検証項目

#### 5.D.A dev preview 検証 (workers.dev URL)

**Claude 自前 (ユーザー操作不要):**
- `npm run lint`
- `npx opennextjs-cloudflare build` (ローカル build 成否確認)
- dev push 後、`curl https://dev-duepure-tracker.jianrenzhongtian7.workers.dev` で `<title>` / `og:title` / `og:site_name` を確認
- `curl https://dev-duepure-tracker.jianrenzhongtian7.workers.dev/manifest.json` で `name` / `short_name` 確認
- grep 漏れチェック: ルート直下 (README.md / DESIGN.md / AGENTS.md / CLAUDE.md 等) も含めて確認するため `--include` 付きで実行する。`grep -rEn "デュエプレトラッカー|ゲーム戦績トラッカー|GameTracker|duepure-theme|dp-tracker-v2|duepure-stats|duepure-tracker\.jianrenzhongtian7\.workers\.dev" --include="*.md" --include="*.tsx" --include="*.ts" --include="*.json" --include="*.html" --include="*.yml" --include="*.mjs" --include="*.js" --include="*.toml" --include="*.jsonc" .` (リポジトリルートから)。除外箇所は (a) dev URL `dev-duepure-tracker...`、(b) `.claude/worktrees/` (過去 worktree スナップショット)、(c) `.claude/reports/` (過去レビュー報告書)、(d) `docs/reports/` (過去レポート履歴)、(e) `docs/plans/` 配下の他 plan/report (履歴)、(f) `src/lib/games/context.tsx` の `selectedGame` cookie (汎用名のため維持) — これらは grep 結果から手動除外。**本作業初回の grep を `src/ public/ docs/` だけに絞ったため DESIGN.md:789 を見逃した教訓**: 必ずルート含めて実行する

**ユーザー実機ブラウザ (必須):**
- 全画面の「Tierlog」「Tierlog - デュエプレ」「Tierlog - ポケポケ」表記反映確認
- X ログインフロー → `/auth/callback` redirect 後にホームへ
- Google ログインフロー → `/auth/callback` redirect 後にホームへ
- メール登録 → 確認メールから新規ログイン可能
- パスワードリセット → リセットメールから `/auth/confirm` で新パスワード設定
- Discord 連携 → `/api/discord/callback` redirect 後に連携成功
- PWA インストール (iOS Safari / Android Chrome) でアプリ名が "Tierlog" 表示
- OG プレビュー: X Card Validator は 2024 年以前に廃止済のため使用しない。代替として (a) `curl -s https://dev-duepure-tracker.jianrenzhongtian7.workers.dev/share/<sample-id> | grep -E 'og:(title|image|site_name)'` で SSR meta を確認 (Claude 自前)、(b) https://www.opengraph.xyz/ などの第三者プレビューサービスに dev URL を入力 (ユーザー実機)、(c) 実際の X 投稿 intent (twitter.com/intent/tweet?url=...) を踏んで Web 上でカード描画を確認
- 共有ダウンロードファイル名が `tierlog-stats.png`

#### 5.D.B 本番反映後の検証 (tierlog.app)

dev で確認した項目を **production 環境** (本番 Supabase / Discord prod / Google prod / X prod) で再実施:

- OAuth 3 経路 (メール / Google / X) で `https://tierlog.app` ログイン
- Discord 連携 (本番 Discord App、tierlog.app redirect)
- PWA インストール / 表示名
- OG プレビュー: 5.D.A と同様に curl による og:* meta 取得 + opengraph.xyz 等の代替プレビューサービスで `https://tierlog.app/share/<sample-id>` を確認 (X Card Validator は廃止済のため使用不可)
- Cloudflare Web Analytics / Insights で tierlog.app のトラフィックが計測されているか
- sitemap.xml (`https://tierlog.app/sitemap.xml`) の URL が tierlog.app になっているか (NEXT_PUBLIC_APP_URL 経由のため自動)

## 6. 判断要事項 (Plan 確定前のユーザー判断)

### 6.A〜6.B (解決済、Resolved Decisions 参照)

- 6.A `.github/workflows/limitless-sync.yml` の URL 解消方法 → **案 B (secret 化)** 確定 (§5.A.9 + §5.B.8 に反映)
- 6.B README.md / DESIGN.md でのサービス名併記 → **案 A (Tierlog のみ表記)** 確定 (§5.A.10 はこの方針)

### 6.C OG 画像内テキストの「デュエプレトラッカー」固定文確認 (実装時チェック)

`src/app/api/og/[id]/route.tsx` の `renderStatsOg` / `renderDeckOg` 内に `trackerName` を引数で受けるパスとは別に固定文字列が含まれていないか、実装時に grep で再確認 (plan-critic の evidence で『固定文字列なし』確認済だが念のため)。

## 7. ロールバック計画

- **本番デプロイで問題発生時**: Cloudflare ダッシュボード → Deployments → 旧デプロイの Rollback ボタン (数秒で復旧)
- **OAuth 設定で問題発生時**: 旧 workers.dev URL を Supabase / Discord に **本番動作確認完了まで残してある** ため、新 URL を一時削除して旧 URL 経由に戻す
- **DB migration**: 本 Plan に DB 変更なし → DB ロールバック不要
- **Cloudflare Custom Domain 解除**: ダッシュボードから削除可、A/AAAA レコードも自動削除
- **CLAUDE.md / AGENTS.md の URL 巻き戻し**: git revert で対応可

## 8. リスクと緩和策

| ID | リスク | 影響 | 緩和策 |
|---|---|---|---|
| R1 | `NEXT_PUBLIC_APP_URL` の Build vars Save 漏れ | 本番ビルドに旧 URL inline、og:image (絶対 URL) / OG image generation / sitemap.xml で誤 URL を返す | 5.C-5 のチェックリストでユーザーが Save 完了を確認してから main push。Claude が本番ビルド完了後の `curl` で (a) `<meta property="og:image">` の絶対 URL が `https://tierlog.app/...`、(b) `<meta property="og:site_name">` / `<title>` が `Tierlog`、(c) `/sitemap.xml` の `<loc>` が `https://tierlog.app/...` を確認 (現コードは `openGraph.url` を出していないため `og:url` 検証は対象外) |
| R2 | OAuth redirect 漏れによるログイン不能 | 本番反映後にログインできない | 旧 workers.dev URL を Supabase / Discord に残してあるため、緊急時は旧 URL 経由でログイン可。5.D.A の OAuth 3 経路検証で事前に dev で確認 |
| R3 | OG 画像内の固定文字列残存 | OG プレビューで旧名表示 | 6.C で実装時に再確認、5.D.A の curl meta 取得 + opengraph.xyz 代替プレビュー (X Card Validator は廃止済) で実機確認 |
| R4 | Service Worker cache 移行漏れ | (既存ユーザーいないので実害なし、念のため) | sw.js の activate ハンドラが旧 cache を delete、CACHE_NAME 変更だけで対応 |
| R5 | CLAUDE.md / AGENTS.md の URL ハードコード残し | 今後の Claude セッションが旧 URL を参照 | 5.A.10 で両ファイルを同期更新、5.D.A の grep 漏れチェック |
| R6 | Google OAuth consent screen 未更新 | Google ログイン画面に旧サービス名が表示 | 5.B.4 でユーザーが consent screen 設定を必ず実施、5.D.B の Google ログイン実機確認 |

## 9. スコープ外 (今回やらない)

- GitHub リポジトリ名変更 (Q3 確定: `duepure-tracker` のまま)
- Cloudflare Worker 名変更 (破壊的)
- Supabase project_id 変更 (機能影響なし)
- package.json `name` 変更 (任意、機能影響なし)
- PWA アイコン / ファビコン差し替え
- 旧 workers.dev URL からの 301 redirect 設定 (移行期間中は並走、後日対応)
- `www.tierlog.app` の Custom Domain 追加 + naked redirect (フェーズ 2 の任意項目、後日対応可)
- sitemap.xml の絶対パス URL 変更 (`NEXT_PUBLIC_APP_URL` 経由で自動追従)
- Supabase メール送信文面 (`{{ .SiteURL }}` テンプレ変数を使っていれば Site URL 変更で自動追従、要確認は本番反映後)

## 10. 完了条件

- [x] 5.A の全コード変更が dev ブランチに反映され、`npm run lint` (リネームによる新規エラー 0、既存 lint 残債 58 件は Plan 範囲外) パス。`opennextjs-cloudflare build` は Cloudflare 側の自動ビルドで成功確認済
- [x] dev preview (`https://dev-duepure-tracker.jianrenzhongtian7.workers.dev`) で 5.D.A の全項目 OK (ユーザー実機検証 OK)
- [x] 5.B.1〜5.B.8 の全外部設定がユーザーにより実施完了 (5.B.8 の `PRODUCTION_API_URL` secret 登録含む)
- [x] main マージ (commit `4f42354`、`0614e7f → 4f42354`) 後の本番ビルドが成功し、`https://tierlog.app` で 5.D.B の全項目 OK (Claude 自前 curl 検証 + ユーザー実機検証 OK)
- [ ] GitHub Actions の LimitlessTCG Deck Sync job を `workflow_dispatch` で発火し、`PRODUCTION_API_URL` 経由で本番 API に到達できることを確認 → **後日対応** (フェーズ 8 / 系統 D に位置付け。`LIMITLESS_HTML_SYNC_PAUSED=true` のため skipped レスポンス確認で十分、cron 影響なし)
- [ ] Cloudflare Web Analytics で tierlog.app トラフィック計測確認 → **後日対応** (本番反映から 24h 経過後にダッシュボードで確認)

## 11. 参照

- 元議論セッション (この conversation の経過)
- codex レビューフィードバック (2026-05-19): OAuth redirect path 訂正 5 点
- Cloudflare 公式 Docs:
  - [Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/)
  - [Preview URLs](https://developers.cloudflare.com/workers/configuration/previews/)
- Supabase 公式 Docs:
  - [Redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls)
  - [Google Auth](https://supabase.com/docs/guides/auth/social-login/auth-google)
  - [Twitter Auth](https://supabase.com/docs/guides/auth/social-login/auth-twitter)
- Discord 公式 Docs: [OAuth2](https://docs.discord.com/developers/topics/oauth2)
- CLAUDE.md / AGENTS.md (環境構成、必須ルール、禁止事項)

---

## Resolved Decisions

- [X-Client-Info] scripts/sync-staging-data.mjs の X-Client-Info ヘッダ `duepure-staging-sync/${name}` をどう扱うか → **`tierlog-staging-sync/...` にリネーム** (公開前リブランドとして duepure の残存を減らす方を優先。Supabase log の連続性は staging 同期スクリプトという内部運用ログのため影響軽微と判断。§5.A.9 の置換対象に追加済)
- [6.A] `.github/workflows/limitless-sync.yml` の URL 解消方法 → **案 B (GitHub Actions secret 化)** で確定。`${{ secrets.PRODUCTION_API_URL }}/api/internal/limitless-sync` 参照 + 空チェックガード (§5.A.9)、`PRODUCTION_API_URL = https://tierlog.app` を Repository secrets に追加 (§5.B.8)。将来のドメイン変更耐性 + INTERNAL_API_KEY と同管理面に揃えるため
- [6.B] README.md / DESIGN.md でのサービス名併記 → **案 A (Tierlog のみ表記)** で確定 (過去名「デュエプレトラッカー」は記載しない、§5.A.10 はこの方針で実装)
- [git add 方針] §5.C の dev push 時の `git add` は **対象ファイル明示** (`git add .` 禁止)。`.codex/` 等 untracked を意図せず含めないため。`docs/app-structure-overview.html` は今回 Tierlog リネームの一環として明示的にコミット対象に含める (§5.C-1)
- [R1 検証対象] og:url 検証は現コードが `openGraph.url` を出していないため対象外。代わりに og:image (絶対 URL) / og:site_name / `<title>` / sitemap.xml を検証対象とする (§8 R1)
- [APP_URL 末尾改行] dev (STAGING_NEXT_PUBLIC_APP_URL) で末尾改行が混入しており sitemap.xml の `<loc>` が改行で分断される事象がユーザー実機で観測済。**本番側 5.B.6 / 5.B.7 / 5.B.8 のいずれでも値を前後空白・改行なしで登録**、Save 後にダッシュボード上で目視再確認する手順を §5.B.6-8 に追記済。コード側の防御 (`process.env.NEXT_PUBLIC_APP_URL?.trim()`) は本 Plan のスコープ外として **別件作業に分離** (NEXT_PUBLIC_* は build 時 inline で runtime 側 trim は使えず、`scripts/prepare-cloudflare-env.sh` で build 前に sanitize するのが筋。dev の修正はこの別件で扱う)
- [grep スコープ] §5.A.11 の grep 漏れチェックは初回 `src/ public/ docs/` だけだったため DESIGN.md:789 を見逃した。Plan に grep コマンドをルート直下含む `--include` 形に修正済 (§5.D.A)

---

**ステータス**: ✅ **Completed (フェーズ 1-7)** (2026-05-19) — 本番反映 commit `4f42354`、本番 URL `https://tierlog.app` 稼働中。完了報告 `docs/reports/2026-05-19_tierlog_rebrand.md`。

**後日対応 (フェーズ 8 = 系統 D)** — memory `project_remaining_tasks_after_2026_05_09` に登録:
1. 旧 workers.dev redirect 削除 (Supabase prod Auth / Discord prod App)
2. www.tierlog.app の Custom Domain 追加 + naked への 301 redirect
3. GitHub Actions LimitlessTCG Deck Sync の `workflow_dispatch` verify
4. Cloudflare Web Analytics で tierlog.app トラフィック計測確認 (24h 後)
