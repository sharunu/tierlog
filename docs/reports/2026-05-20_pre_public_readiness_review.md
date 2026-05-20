# 一般公開前 完成度レビュー報告書

- 作成日: 2026-05-20
- 再レビュー日: 2026-05-20
- ステータス: **公開前要対応 / 一般公開ブロッカー 6 件**
- 対象: `dev` ブランチ（本レポート再レビュー時点）
- 対象規模: tracked files 305 件 / Supabase migrations 82 件
- 総合評価: **62 / 100**

> 注: 本レポートは公開可否の技術・運用レビューであり、法務判断そのものではない。プライバシーポリシー、利用規約、個人情報保護法対応は、最終公開前に公式ガイドラインと必要に応じて専門家確認を行うこと。

---

## 1. 概要

Tierlog は、Next.js 16 App Router + Supabase + Cloudflare Workers で構成されたマルチゲーム対応の TCG 戦績トラッカーである。DB 設計、RLS、RPC 権限制御、Cloudflare Workers 向けの実行環境設定はかなり作り込まれており、アプリケーションの土台は良い。

一方で、一般公開前の観点では **法務表示、問い合わせ導線、品質保証、障害検知** がまだ不足している。加えて `npm run lint` が現時点で失敗しているため、CI を追加する前に lint エラーの解消も必要。

結論として、現状は「限定利用・検証公開なら可、一般公開はまだ早い」。ブロッカーを解消すれば公開可能水準に近づくが、特に法務ページと運用監視は公開前に必ず整えるべき。

---

## 2. 再レビュー方法

初稿は Claude Code による分析を元に作成されていた。今回の再レビューでは、内容をそのまま信頼せず、ローカルコードと主要コマンドで再検証した。

実行・確認した主な項目:

| 項目 | 結果 |
|---|---|
| `git status --short --branch` | `dev...origin/dev`。未追跡ファイル `docs/admin-deck-list-update-flow.html` あり。本レポートとは無関係のため未変更 |
| `git rev-parse --short HEAD` | `7db495d` |
| `git ls-files \| wc -l` | 305 件 |
| `find supabase/migrations -name '*.sql' \| wc -l` | 82 件 |
| `npm run lint` | **失敗: 58 problems / 34 errors / 24 warnings** |
| `npx tsc --noEmit` | 成功 |
| `npm audit --json` | moderate 5 件 |
| `curl -I https://tierlog.app` | HTTP 200、セキュリティヘッダ配信を確認 |
| `curl -I https://tierlog.app/robots.txt` | HTTP 200 |
| `curl -I https://tierlog.app/manifest.json` | HTTP 200 |

未検証・留意点:

- Supabase hosted project の Auth 設定、advisor 結果、RLS の本番 DB 実状態は、この再レビューでは直接確認していない。記載はローカルコード、マイグレーション、初稿の指摘に基づく。
- Cloudflare / Supabase のダッシュボード設定値は、ローカル設定ファイルから確認できる範囲と公式ドキュメントで補正した。

---

## 3. カテゴリ別スコア

| カテゴリ | 配点 | 得点 | 評価 |
|---|---:|---:|---|
| セキュリティ・データ保護 | 25 | **21** | 良好。ただし hosted Auth 設定と OGP redirect は要確認 |
| コード品質・アーキテクチャ | 20 | **15** | 良好。重複と型逃げが主な負債 |
| 法務・コンプライアンス | 15 | **6** | 公開前に要補強 |
| テスト・CI・品質保証 | 15 | **3** | 重大な不足 |
| UX/UI・アクセシビリティ | 15 | **11** | 概ね良好。一部 WCAG 観点で要改善 |
| SEO・パフォーマンス・運用 | 10 | **6** | 基本あり。監視・メタデータ・bundle 方針が不足 |
| **合計** | **100** | **62** | **一般公開前要対応** |

---

## 4. カテゴリ別詳細

### 4-1. セキュリティ・データ保護 — 21/25

RLS、RPC 権限、環境変数の扱い、セキュリティヘッダは良好。公開を即停止すべき明白な脆弱性は、今回の静的確認では見つからなかった。

強み:

- `supabase/migrations/` 上、主要テーブルの RLS 強化、anon 権限剥奪、SECURITY DEFINER 関数の search_path 固定が段階的に整備されている。
- `DISCORD_CLIENT_SECRET` / `SUPABASE_SERVICE_ROLE_KEY` / `INTERNAL_API_KEY` の `process.env` 直読みは見つからず、`getServerEnv()` 経由の方針に沿っている。
- `next.config.ts` で CSP、HSTS、X-Frame-Options、Referrer-Policy、Permissions-Policy 等を配信している。本番 `https://tierlog.app` でもレスポンスヘッダを確認済み。
- `wrangler.jsonc` に Cloudflare Workers Rate Limiting binding があり、`src/middleware.ts` で POST に限定して 60 req/min の制限をかけている。
- Discord OAuth state は UUID nonce + DB 消費型の設計になっており、CSRF 耐性がある。

要対応:

- `src/app/api/og/[id]/route.tsx` は `shares.image_url` が存在する場合にそのまま 302 redirect している。保存経路が限定されていても、`https://*.supabase.co/...` など許可ホスト制にしておく方が安全。
- `src/app/admin/layout.tsx` の admin guard は Client Component 側。DB/RPC 側の admin check が実害を抑えているが、画面コード配信・初期描画の観点では Server Component / middleware 側の guard を追加したい。
- `supabase/config.toml` のローカル Auth 設定は `minimum_password_length = 6` / `password_requirements = ""`。アプリ側は 8 文字を要求しているが、Supabase Auth API は anon key から直接呼べるため、hosted project 側の最小長・複雑性・漏洩パスワード保護の設定を公開前に確認すること。
- Supabase の漏洩パスワード保護は Pro Plan 以上の機能。利用可能なプランなら有効化を推奨。

### 4-2. コード品質・アーキテクチャ — 15/20

actions 層、ゲームレジストリ、ゲーム別 URL 構造など、基本設計は整理されている。公開ブロッカー級の設計破綻はない。

強み:

- `src/lib/games/index.ts` がゲーム定義の単一真実源になっている。
- `src/lib/actions/` が battle / deck / stats / admin / team / account / feedback に分かれており、DB 操作の置き場は概ね明確。
- `src` 配下の TODO / FIXME / HACK は 0 件。
- cursor-based pagination など、負荷を意識した実装がある。

主な負債:

- `src/app/dm/` と `src/app/pokepoke/` が合計 5,379 行あり、かなりの重複がある。`GameLayoutClient.tsx` は完全一致。3 つ目のゲーム追加前に `src/app/[game]/` 統合を検討したい。
- `src/lib/actions/admin-actions.ts` に `(supabase.rpc as any)` が 3 箇所ある。型定義再生成または RPC 型の補完で解消したい。
- `src/middleware.ts` で `createServerClient()` を生成しているが、`supabase.auth.getUser()` 等を呼んでいないため、Supabase SSR のセッションリフレッシュ処理としては実質的に機能していない可能性が高い。
- `TrendChart.tsx`、`EncounterDonutChart.tsx` などに `any` が残っており、lint 失敗の一因になっている。
- 一部 actions はエラー時に空配列・0 件として返すため、データ取得失敗と実データ 0 件が UI 上で区別しづらい。

### 4-3. 法務・コンプライアンス — 6/15

privacy / terms ページは存在し、非公式ファンツールの免責や 13 歳未満の利用不可は明記されている。ただし、一般公開前の法務表示としては不足がある。

公開前に必須:

1. **問い合わせ窓口をログイン不要で用意する**
   現状はアプリ内「ご意見・バグ報告」に依存しており、ゲスト・退会者・未登録者が連絡しづらい。メールアドレス、問い合わせフォーム、SNS DM など、ログイン不要で到達できる窓口が必要。

2. **個人情報の開示・訂正・削除・利用停止等の請求手順を明記する**
   プライバシーポリシーの「ユーザーの権利」は操作可能な範囲を説明しているが、保有個人データに関する問い合わせ・請求の受付方法が不足している。

3. **運営者情報の扱いを整理する**
   現状は「運営者」とだけあり、個人情報取扱事業者として本人が問い合わせ・苦情申出を行うための情報が不足している。個人開発で住所等を直接公開しない場合でも、少なくとも連絡可能な窓口と、必要に応じて遅滞なく回答できる運用を定めること。

4. **外部サービス・委託先・越境移転の説明を補強する**
   Supabase、Cloudflare、Cloudflare Web Analytics に加え、Google / X / Discord の OAuth と Discord 連携で扱う情報を整理する。海外クラウドに保存・処理される点、提供・委託・共同利用のどれとして整理するかも明確にする。

5. **Cloudflare Web Analytics の記載を公式表現に寄せる**
   Cloudflare 公式 docs では Web Analytics は visitor personal data を収集・使用しないと説明されている。一方、ポリシー側では「どのサービスを何のために使うか」を中心に書き、断定表現は公式表現と矛盾しない範囲に留める。

6. **利用規約の管轄条項を実効性ある表現にする**
   「運営者所在地の裁判所」としているが、所在地情報が非開示のためユーザーから見て不明確。公開する運営者情報または別の定め方と整合させる。

### 4-4. テスト・CI・品質保証 — 3/15

ここが最大の弱点。TypeScript は通るが、自動テスト・CI・lint が公開品質の水準に達していない。

実測:

- `npx tsc --noEmit`: 成功
- `npm run lint`: 失敗。58 problems / 34 errors / 24 warnings
- `npm audit --json`: moderate 5 件
- `*.test.ts` / `*.spec.ts` は 0 件
- `.github/workflows/` は `limitless-sync.yml` のみ。push / pull_request の品質ゲートはない

公開ブロッカー:

1. **lint が失敗している**
   CI を入れる前に、少なくとも現行 lint を通す必要がある。主因は `react-hooks/set-state-in-effect`、`react-hooks/preserve-manual-memoization`、`@typescript-eslint/no-explicit-any`。

2. **自動テストが 0 件**
   最低限、`src/lib/battle/result-format.ts`、`src/lib/games/index.ts`、`src/lib/actions/stats-actions.ts` の変換・集計系、検索正規化、デッキ名 canonicalization 周辺にユニットテストを追加したい。

3. **CI 品質ゲートがない**
   `push` / `pull_request` で lint + typecheck を走らせる GitHub Actions が必要。build は Cloudflare Builds 側に任せるとしても、ローカルで落ちる品質問題を dev に流さない仕組みは要る。

4. **本番エラー検知が弱い**
   `wrangler.jsonc` の `observability.enabled = true` はあるが、Sentry 等のアプリケーションエラートラッキング、通知、対応 runbook がない。公開後に障害をユーザー報告頼みにしない仕組みが必要。

補足:

- `npm audit` の moderate 5 件は `wrangler` / `miniflare` / `ws` / `brace-expansion` / `@opennextjs/cloudflare` 経由。現時点ではビルド・開発ツールチェーン寄りだが、依存更新計画には入れること。

### 4-5. UX/UI・アクセシビリティ — 11/15

モバイル向けの画面構成、空状態・ローディング状態、ボトムナビ、PWA manifest は一定水準にある。

強み:

- 本番 `https://tierlog.app`、`/robots.txt`、`/manifest.json` は HTTP 200。
- `public/manifest.json`、`public/sw.js`、アイコン類が存在し、PWA の基本要素が揃っている。
- `BottomNav` は `aria-label` / `aria-current` / タップ領域を意識した実装になっている。
- 共有ページの `generateMetadata` と OGP 画像生成は実装済み。

改善点:

- `src/app/auth/page.tsx` のメール・ユーザー名・パスワード入力が placeholder のみで、明示的な `<label>` または `aria-label` がない。
- `src/app/layout.tsx` の `viewport.maximumScale = 1` はピンチズームを抑制するため、アクセシビリティ上は外すのが望ましい。
- `prefers-reduced-motion` 対応が見当たらない。`animate-pulse` や transition を多用しているため、最低限の reduced motion 対応を追加したい。
- `src/components/ui/Skeleton.tsx` は存在するが未使用で、各画面に `animate-pulse` の重複実装がある。
- `src/app/account/page.tsx` の一部メニューは `<div onClick>` で、キーボード操作・role・tabIndex の観点で改善余地がある。

### 4-6. SEO・パフォーマンス・運用 — 6/10

robots / sitemap / manifest / OpenGraph の基本はある。DB インデックス整備やロールバック方針も過去レポート・運用メモに残っている。

要改善:

- 通常ページの `<title>` / description はほぼ共通。`/dm/battle`、`/dm/stats`、`/pokepoke/...` などページ別 metadata を追加したい。
- canonical URL が設定されていない。クエリ付き URL や旧 URL redirect 後の重複対策として検討する。
- `src/assets/fonts/NotoSansJP-Bold.ttf` が 9.1MB あるが、コード上の参照は見つからない。不要なら削除候補。
- `next/dynamic` は `ShareModal` で使われているが、recharts 系チャートは通常 import。stats 画面の初期 bundle を見て、必要ならチャート単位で lazy load を検討する。
- 障害切り分け runbook、通知先、RPO/RTO、Supabase バックアップ確認手順が公開運用レベルではまだ薄い。

---

## 5. 一般公開ブロッカー一覧

初稿からブロッカー構成を見直し、課金プラン依存の Supabase 漏洩パスワード保護は推奨対応へ移動し、現時点で実測失敗している lint 解消を公開前ブロッカーへ追加した。

| # | 項目 | 領域 | 目安工数 |
|---|---|---|---:|
| 1 | プライバシーポリシーと利用規約の不足修正（問い合わせ、請求手順、外部サービス、越境移転、管轄条項） | 法務 | 半日〜1日 |
| 2 | ログイン不要の問い合わせ窓口を用意し、privacy / terms から到達可能にする | 法務/UX | 1〜2 時間 |
| 3 | `npm run lint` の 34 errors を解消する | 品質 | 1〜2 日 |
| 4 | 主要ロジックに最小限のユニットテストを追加する | 品質 | 1〜3 日 |
| 5 | GitHub Actions に lint + typecheck の品質ゲートを追加する | 品質/CI | 1〜2 時間 |
| 6 | エラートラッキング、通知、障害対応 runbook を用意する | 運用 | 半日〜1日 |

---

## 6. 公開前に推奨する追加対応

- Supabase hosted Auth 設定を確認し、最小パスワード長・複雑性・漏洩パスワード保護を可能な範囲で強化する。
- `/api/og/[id]` の stored image redirect に allowlist を追加する。
- `/admin` を Server Component / middleware 側でも guard する。
- Supabase SSR middleware で必要なら `supabase.auth.getUser()` を呼び、セッションリフレッシュが実際に走る形に直す。
- 通常ページの `generateMetadata` と canonical を追加する。
- `@supabase/supabase-js` / `@supabase/ssr` / `wrangler` / `@opennextjs/cloudflare` の更新方針を確認する。Auth 設定は既存フローを壊さないよう小さく検証する。

---

## 7. 公開後の技術的負債返済

- `src/app/dm/` と `src/app/pokepoke/` の重複を `src/app/[game]/` に統合する。
- `(supabase.rpc as any)` を解消するため `database.types.ts` を再生成・活用する。
- `TrendChart.tsx`、`OpponentDeckManager.tsx` など巨大/型弱めのコンポーネントを分割する。
- `Skeleton.tsx` の利用統一、`prefers-reduced-motion` 対応を進める。
- `docs/reports/2026-05-11_db_hardening_pre_public.md` にある `unused_index` 警告を再評価する。

---

## 8. 参考にした公式資料

- 個人情報保護委員会「個人情報の保護に関する法律についてのガイドライン（通則編）」
  https://www.ppc.go.jp/files/pdf/241202_guidelines01.pdf
- 個人情報保護委員会「個人情報の保護に関する法律についてのガイドライン（外国にある第三者への提供編）」
  https://www.ppc.go.jp/files/pdf/251212_guidelines02.pdf
- Cloudflare Docs「Cloudflare Web Analytics」
  https://developers.cloudflare.com/web-analytics/about/
- Supabase Docs「Password security」
  https://supabase.com/docs/guides/auth/password-security
