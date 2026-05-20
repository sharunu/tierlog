# 一般公開前 完成度レビュー報告書

- 作成日: 2026-05-20
- ステータス: **レビュー完了 / 一般公開ブロッカー 6 件 未解消**
- 対象: `dev` ブランチ（commit `9a7b34c` 時点）
- 評価方法: 4 観点を専門サブエージェントで並列レビュー（コード品質・セキュリティ・UX/法務/PWA・テスト/CI/運用）
- 総合評価: **65 / 100**

---

## 1. 概要

一般公開を前提に Tierlog（マルチゲーム TCG 戦績トラッカー、Next.js 16 App Router + Supabase + Cloudflare Workers、304 ファイル / 82 マイグレーション）の完成度を 100 点満点で評価した。

**結論**: 技術的な土台 — とくにセキュリティと DB 設計 — は商用水準に達している。一方で「一般公開」の前提条件である**法務整備・品質保証の仕組み・障害監視**が未完成で、現状のまま公開すべきではない。土台が強いため残作業の性質は明確で、1〜2 週間程度で公開可能水準（85 点前後）に到達できる見込み。

総合評価 65 点は「あと一歩、まだ公開は早い」を意味する。

---

## 2. 評価方法

以下 4 観点を専門サブエージェントで並列にレビューし、結果を統合した。各エージェントは実際にファイルを読み、`npm run lint` / `tsc --noEmit` / `npm audit` / `curl` 等のコマンドを実行して根拠を取得している。

| 観点 | 主な調査範囲 |
|---|---|
| コード品質・アーキテクチャ | actions 層、ゲームレジストリ、型安全性、エラーハンドリング、lint |
| セキュリティ | RLS、API 認可、認証フロー、秘密情報、入力検証、Supabase advisor |
| UX/UI・SEO・法務・PWA | privacy/terms 全文、metadata、manifest、アクセシビリティ、本番 URL 検証 |
| テスト・CI・運用 | 自動テスト、CI/CD、パフォーマンス、依存関係、モニタリング、runbook |

---

## 3. カテゴリ別スコア

| カテゴリ | 配点 | 得点 | 評価 |
|---|---:|---:|---|
| 🔒 セキュリティ・データ保護 | 25 | **22** | 優秀 |
| 🏗 コード品質・アーキテクチャ | 20 | **15** | 良好 |
| ⚖️ 法務・コンプライアンス | 15 | **7** | 不足（公開ブロッカー） |
| 🧪 テスト・CI・品質保証 | 15 | **4** | 重大な欠落 |
| 🎨 UX/UI・アクセシビリティ | 15 | **11** | 良好 |
| 🚀 SEO・パフォーマンス・運用 | 10 | **6** | 要改善 |
| **合計** | **100** | **65** | |

---

## 4. カテゴリ別詳細

### 4-1. 🔒 セキュリティ・データ保護 — 22/25

**このアプリで最も完成度が高い領域。** 個人開発アプリとしては異例の水準。公開ブロッカー級の脆弱性は 0 件。

**強み**
- RLS が全 public テーブルで有効。INSERT/UPDATE の `WITH CHECK` でデッキ所有・format/game_title 整合・tuning 配下まで強検証（`20260426005407`, `20260426050848`）
- SECURITY DEFINER 関数すべてに `SET search_path = ''` + 完全修飾名。admin RPC は関数本体で `profiles.is_admin` を再検証、Team RPC は `is_team_member` ガード
- anon ロールの権限を網羅的に剥奪（`20260512000001`、`ALTER DEFAULT PRIVILEGES` で将来の自動付与も停止）
- `shares` テーブルの直読みを閉塞（`20260509000002`）、Discord OAuth トークンを column-level GRANT で保護（`20260509000003`）
- 秘密情報を `process.env` 直読みする箇所ゼロ・ハードコード鍵ゼロ、`getServerEnv()` 経由に統一
- CSP / HSTS / X-Frame-Options DENY 等のセキュリティヘッダ完備（`next.config.ts`）
- Discord OAuth の CSRF 対策（UUID nonce の atomic consume、10 分 expiry）、旧脆弱ルートは 410 Gone で閉塞
- `dangerouslySetInnerHTML` は静的定数 1 箇所のみ、OGP はユーザー入力をテキストノードのみで描画（XSS 耐性）
- Cloudflare Rate Limiting で POST を IP 単位 60req/min 制限（DoS 緩和）

**減点要因（中〜軽微）**
- Supabase の漏洩パスワード保護が無効（advisor `auth_leaked_password_protection`）。ダッシュボード操作で即解消可
- 管理画面のガードがクライアントサイドのみ（`src/app/admin/layout.tsx:11-16`）。DB 側で実認可されるため実害は小さいが、画面構造が非 admin にも配信される
- `/api/og/[id]` が `shares.image_url` へ無検証リダイレクト（`src/app/api/og/[id]/route.tsx:387-390`）。`*.supabase.co` 配下の検証を追加するとより堅牢

### 4-2. 🏗 コード品質・アーキテクチャ — 15/20

actions 層の責務分離、ゲームレジストリの単一真実源、TODO/FIXME ゼロ、console.log ほぼゼロ — 骨格は明快。公開ブロッカーは 0 件。

**強み**
- `src/lib/actions/` が責務ごと（battle/deck/stats/admin/team/account/feedback）に分割され、UI から Supabase クエリが排除されている
- `src/lib/games/index.ts` がゲーム定義の単一真実源、型ガード・ヘルパー完備
- ページネーションが cursor-based（tuple 比較）で実装、設計意図もコメント済
- TODO/FIXME/HACK コメントが `src` 全体で 0 件

**主な技術的負債（中程度）**
- **`src/app/dm/` と `src/app/pokepoke/` で約 2,700 行が重複**。`GameLayoutClient.tsx` は完全一致。すでに実害が出ており、`DeckList.tsx` は pokepoke 側だけにバグ修正が入り dm 側は未反映・実装も分岐。`src/app/[game]/` 動的セグメントへの統合が最優先の負債返済
- `(supabase.rpc as any)` で 3 つの admin RPC が型チェック外（`admin-actions.ts:380, 618, 910`、型再生成漏れ）
- `src/middleware.ts:62-81` の Supabase セッションリフレッシュが `getUser()` 未呼び出しで実質 no-op
- `npm run lint` で 34 エラー（大半は `set-state-in-effect` 21 件）
- エラーハンドリング方針が不統一。`team-actions.ts` は throw 0 件で取得失敗を「0 件」と表示してしまう（`team-actions.ts:42` ほか）
- `database.types.ts`（1,544 行）の import 元が 5 ファイルのみで活用度が低い
- `TrendChart.tsx` の `any` 6 箇所、巨大ファイル（`OpponentDeckManager.tsx` 1,071 行ほか）

### 4-3. ⚖️ 法務・コンプライアンス — 7/15 ←**公開ブロッカー**

privacy/terms ページは存在し、非公式ツールの免責・13 歳未満の利用制限は明記済み。しかし**個人情報保護法の必須項目が欠落**しており、このまま公開するとコンプライアンス違反になる。

**公開ブロッカー**
1. **運営者（個人情報取扱事業者）の特定情報が一切ない**（`src/app/privacy/page.tsx`）。「運営者」とあるのみで氏名・屋号・所在地の記載なし。利用規約は「運営者所在地の裁判所」を専属管轄とするがその所在地も非開示で実効性がない
2. **ログイン不要の問い合わせ窓口がない**（`src/app/terms/page.tsx` / `privacy/page.tsx`）。問い合わせ手段がアプリ内フォームのみで、しかもゲスト無効（`src/app/account/page.tsx:384`）。退会者・未登録者が開示請求の連絡を取れない
3. **第三者提供の記載が不正確**（`src/app/privacy/page.tsx:46-57`）。X/Google/Discord の OAuth 連携を使っているのに外部サービス一覧に未記載。海外移転（Supabase/Cloudflare）の移転先国情報の提供もない。Cloudflare Web Analytics の「個人を特定しない」断定も踏み込みすぎ

**強み**
- 非公式ファンツールの免責を terms 冒頭・各条文・auth ページで繰り返し明示
- terms 第 8 条で 13 歳未満の利用不可・未成年の保護者同意を明記

### 4-4. 🧪 テスト・CI・品質保証 — 4/15 ←**公開ブロッカー**

`tsc --noEmit` はクリーン（エラー 0）だが、それ以外の安全網が皆無。

**公開ブロッカー**
1. **自動テストが 0 件**。`*.test.ts` / テストフレームワーク / `test` スクリプトすべて無し。戦績集計・検知ロジックなど「誤るとユーザーデータが壊れる」コードがノーガード
2. **CI に品質ゲートが無い**。`.github/workflows/` は定期バッチ用 `limitless-sync.yml` 1 本のみ。push 時の lint/typecheck/build チェックなし
3. **エラートラッキング・障害アラートが無い**。Sentry 等未導入、`error.tsx` は `console.error` のみ。公開後に本番でエラーが多発してもユーザー報告以外で気づけない

**強み**
- `tsc --noEmit` がクリーン、DB インデックスが計画的に整備（`20260511000001`, `20260512000003`）
- エラー境界が二層（`error.tsx` + `ErrorBoundary.tsx`）、ロールバック手順あり、staging 同期 runbook あり

**中程度の問題**
- `npm audit` で moderate 5 件（全件 `ws` 由来、wrangler/OpenNext のビルドツールチェーン側）
- 依存が軒並み古い（`@supabase/supabase-js` 8 マイナー遅れ、`@supabase/ssr` minor 遅れ＝認証コアのパッチ未取込）

### 4-5. 🎨 UX/UI・アクセシビリティ — 11/15

モバイルファースト設計、エラー/空/ローディング状態の実装、OGP 動的生成、`IconButton` の `aria-label` 型必須化 — 基本は良好。

**強み**
- 本番（`https://tierlog.app`）が HTTP 200 で正常稼働、robots/sitemap/manifest/sw も正しく配信
- OGP 動的生成が高品質（`src/app/api/og/[id]/route.tsx`、1200x630 + Cache-Control immutable）
- `BottomNav` が `aria-label` / `aria-current` / 44px タップ領域を確保、`fixed bottom` + safe-area 対応

**中〜軽微の改善点**
- 認証フォームに `<label>` が無く placeholder のみ（`src/app/auth/page.tsx:177-207`）
- `prefers-reduced-motion` 対応がリポジトリ全体で 0 件
- `viewport` の `maximumScale: 1`（`layout.tsx:69`）がピンチズームを抑制（WCAG 1.4.4 非推奨）
- `Skeleton.tsx` が定義のみ未使用、各ページが `animate-pulse` を重複記述
- `account` ページのメニューが `<div onClick>` でキーボード操作不可（`account/page.tsx:383-411`）

### 4-6. 🚀 SEO・パフォーマンス・運用 — 6/10

robots.ts/sitemap.ts の動的生成、DB インデックスの計画的整備、ロールバック手順は good。

**中〜軽微の改善点**
- **全ページの `<title>` が実質固定**。`generateMetadata` を持つのは `/share/[id]` のみで、`/dm/battle` も `/dm/stats` も同じ title/description → ページ別 SEO が機能していない
- canonical URL がどのページにも無い（クエリ付き URL の重複索引リスク）
- `src/assets/fonts/NotoSansJP-Bold.ttf` が 9.1MB だがコードから未参照（OGP は Google Fonts 動的 fetch）
- `next/dynamic` 未使用で recharts / html2canvas 等の重い依存が初期バンドルに含まれる
- インシデント対応・障害切り分けの runbook、バックアップ方針（RPO/RTO）の文書化が手薄

---

## 5. 一般公開ブロッカー一覧（対応優先度順）

| # | 項目 | 領域 | 目安工数 |
|---|---|---|---:|
| 1 | プライバシーポリシーの法的不備（運営者情報・第三者提供・海外移転） | 法務 | 半日 |
| 2 | ログイン不要の問い合わせ窓口を用意 | 法務 | 1〜2 時間 |
| 3 | エラートラッキング / 障害アラート導入 | 運用 | 半日 |
| 4 | 主要ロジック（`src/lib/actions/` の集計・変換系、`src/lib/games/` のレジストリ整合）への最小限のユニットテスト | 品質 | 数日 |
| 5 | CI に lint + typecheck ゲート追加（push トリガーの GitHub Actions） | 品質 | 1〜2 時間 |
| 6 | Supabase 漏洩パスワード保護を有効化（ダッシュボード操作のみ） | セキュリティ | 5 分 |

---

## 6. 総評

多くの個人アプリが手を抜くセキュリティと DB 設計をここまで作り込めているのは大きな強みで、最も難しい部分は既に終わっている。残る公開ブロッカーは法務文面の修正・監視導入・テスト追加といった「仕上げ」であり、性質が明確。

公開を止めるべき致命的なバグや脆弱性は無く、ブロッカー 6 件に対応すれば総合 85 点前後（公開可能水準）に到達できる見込み。

---

## 7. 残作業 / 今後の課題

### 公開前に必須（ブロッカー）
- 上記 §5 の 6 項目。とくに法務 2 件は公開の絶対条件

### 公開前に推奨
- 管理画面のサーバーサイド gating（Server Component / middleware で `/admin` 保護）
- ページ別 `generateMetadata` 追加、canonical 設定
- `@supabase/ssr` / `@supabase/supabase-js` のバージョン追従（auth 設定は変更せず慎重に）

### 公開後の技術的負債返済
- `src/app/dm/` と `src/app/pokepoke/` の約 2,700 行重複を `src/app/[game]/` 動的セグメントへ統合（3 つ目のゲーム追加前に対応すべき）
- `(supabase.rpc as any)` 解消のための `database.types.ts` 再生成
- lint 34 エラー（`set-state-in-effect` 21 件ほか）の整理
- `prefers-reduced-motion` 対応、`Skeleton.tsx` の活用統一
- `unused_index` 警告の再評価（`docs/reports/2026-05-11_db_hardening_pre_public.md` 記載のフォロー）

---

## 8. メモリ更新

本報告書の所在と要点を auto-memory（`pre-public-readiness-review.md`）に記録した。
