# Plan F: Public Launch Go/No-Go / Final Release Readiness

- 作成日: 2026-05-30
- 対象ブランチ: `dev`（本 plan ファイルの作成のみ。判定・検証・実装は別セッション）
- 性格: **無料一般公開（`tierlog.app`）の最終 Go/No-Go 判定フレームワーク**。新機能追加・コード変更・DB 変更は一切しない。Plan A〜E 完了後の「公開してよいか」を判定するための照合・チェックリスト・基準・最終ゲート手順を定義する。
- 前提（すべて本番反映完了済）:
  - Plan A: Public Launch Safety（shares.image_url Storage-only / auth game next / BanGuard fail-open）
  - Plan B: Observability / OG / SEO（Sentry / OG 動的画像 / sitemap / robots）
  - Plan C: Multi-Game DB Scope（game_title スコープ / quality scoring / detection game scope）
  - Plan D: Access Gate / Auth Expiry（account_access_state / requireBearer / AuthGuard / BanGuard 並列）
  - Plan E: Pre-Public UX / Stability Polish（lint/version 整合 / auth helper test / onboarding / Discord UX / perf / build marker E-6）
- **重要な構造的特性**: 本 plan は **DB migration・コード編集・外部サービス操作・commit/push（plan ファイル以外）を一切しない**。記載する検証（Email Routing / PITR / smoke / C-6 preflight）は **go-live セッションで実行する手順書**であり、本チャットでは実行しない。
- **C-6 detection_alerts 24 件**: 本 plan では **leave/truncate の結論を出さない**。go-live 直前の最終ゲートで preflight を実行して判断するための「preflight + 選択肢整理」までに限定する（RD-F4）。

---

## 0. 目的とスコープ

### 含めるもの（本 plan で作成）

| 観点 | 内容 | 章 |
|---|---|---|
| 1 | 統合 pre-public audit の P0/P1 が A〜E で解消済かの照合 | §3.1, §4 |
| 2 | 本番 `tierlog.app` の公開前最終 smoke check 項目 | §5 |
| 3 | ログイン済み主要導線の確認項目 | §6 |
| 4 | Plan A〜E 保護対象の regression 確認 | §7 |
| 5 | Sentry / build marker / rollback / runbook / Supabase backup・PITR の運用確認 | §8 |
| 6 | 法務ページ・問い合わせ導線・無料一般公開の充足確認 | §9 |
| 7 | C-6 detection_alerts 24 件の最終判断用 preflight と選択肢整理 | §10 |
| 8 | Go/No-Go 判定基準（公開 OK / 条件付き OK / 公開前追加対応必須）+ 最終ゲート手順 | §11, §12 |

### 含めないもの（別 plan / 別フェーズ / 別セッション）

- **leave/truncate の C-6 最終結論**（go-live 直前の最終ゲートで判断、RD-F4）
- **検証の実行そのもの**（Email Routing / PITR / smoke / C-6 preflight は go-live セッションで実行）
- **DB migration / production DB 変更 / コード編集 / 外部サービス操作**
- **P2 backlog（#11 期限切れ share・DB error 404 / #13 auto_add safe-hatch / #15 残り）の実装**（公開後 Phase 2、RD-F1）
- **収益化（Phase 3）**: Billing / Entitlement / Stripe / AdSense / 特商法 / CSP・consent / auth-広告リスク再評価（統合 audit §5 で当初から分離）

---

## 1. 関連 plan / 監査との依存関係

| 出典 | 役割 |
|---|---|
| `docs/reports/2026-05-27_integrated_pre_public_monetization_audit.md` | P0/P1/P2/P3 と「統合 Top Fixes 15 件」の master list（照合基準） |
| `docs/reports/2026-05-27_plan_a_public_launch_safety_completion.md` 〜 `2026-05-30_plan_e_..._completion.md` | A〜E 各完了報告（解消エビデンス） |
| `docs/reports/2026-05-27_legal_gap_analysis.md` | 無料公開の法務充足/先送り判定 |
| `docs/runbooks/*` | 運用 readiness（rollback / backup / sentry / live-build-verification / access_gate / plan_c_data_truncate 等） |

本 plan は上記を A〜E 完了後の現状に照合し、**判定基準と go-live 手順に落とすだけ**で、いずれの実装・データにも触れない。

---

## 2. プロジェクト固有ルールの厳守事項（CLAUDE.md / AGENTS.md）

- **`main` 直 push 禁止**。検証・実装は `dev`、本番反映はユーザー明示指示後。
- **production DB への `db push` / TRUNCATE はユーザー明示指示まで実行しない**。C-6 はとくに preflight + 二段承認 + PITR 確認後のみ（§10）。
- **既存 auth 設定（implicit flow / middleware.ts / client.ts）非変更**。認可判断を `getSession()` ローカル値に置換しない。
- **外部サービス（Cloudflare / Supabase）のダッシュボード手順を案内する前に公式ドキュメントを WebFetch で確認**（§8.5 PITR / §9 Email Routing 手順は go-live セッションで公式 docs 確認のうえ実施）。
- **build 検証は check-run conclusion + build marker 突合**で行い、preview/本番 URL の目視に依存しない（memory: cloudflare-build-verification、Plan E E-6）。
- 本 plan 自体は **調査・計画のみ**。コード/DB/外部操作・実行はしない。

---

## 3. 現状調査（2026-05-30 時点）

### 3.1 統合 audit Top Fixes 15 件 × A〜E 照合（観点 1）

| # | Pri | 対象 | 解消 Plan | Status |
|---|---|---|---|---|
| 1 | **P0** | `shares.image_url` 任意外部 URL 拒否 | A-1 | **RESOLVED**（DB trigger + display sanitizer + prod migration + smoke） |
| 2 | P1 | ban/suspended の DB/RLS/API access gate | D-1〜D-4 | **RESOLVED** |
| 3 | P1 | legacy URL / slug なし stats / 文字化け / loading・error | A-2 | **RESOLVED** |
| 4 | P1 | detection / quality / team summary の game scope | C-1〜C-5 | **RESOLVED**（データ残件は C-6 別掲） |
| 5 | P1 | Sentry scrubber / release / environment | B-1 | **RESOLVED** |
| 6 | P1 | OG route の外部フォント fetch 廃止 / fallback / cache | B-2 | **RESOLVED** |
| 7 | P1 | sitemap / root / metadata / noindex | B-3, B-4 | **RESOLVED** |
| 8 | P1 | auth 失効と戦績ゼロ区別 / `if(!user) return []` 統一 | D-5 | **RESOLVED** |
| 9 | P1 | BanGuard reject 白画面 | A-3 + D（並列 AuthGuard） | **RESOLVED** |
| 10 | P1 | 共有/認証導線で game/next 保持（open redirect 防止） | A-4 | **RESOLVED** |
| 11 | **P2** | 期限切れ share 公開停止 / share・OG の DB error と 404 分離 | — | **NOT ADDRESSED（→ Phase 2、RD-F1）** |
| 12 | P2 | middleware session refresh 実質化 or 削除 | D-6 | **RESOLVED（"不要" 判定 + コメント）** |
| 13 | P2 | auto_add trigger の例外 safe-hatch / logging | — | **NOT ADDRESSED（→ Phase 2、RD-F1）** |
| 14 | P2 | デッキ0件→1戦目を同一画面で完結 | E-3 | **RESOLVED** |
| 15 | P2 | Discord refresh DB error / public GET cache・rate limit / unbounded query | E-4, E-5（一部） | **PARTIAL（残り → Phase 2、RD-F1）** |

**結論**: **P0 1/1・P1 9/9 RESOLVED**（本番反映 + production migration + smoke 完了）。**公開ブロッカー級の未解消なし**。P2 は RESOLVED 2 / PARTIAL 1 / NOT ADDRESSED 2 で、未解消分は当初から Phase 2 候補（§4.4）。

### 3.2 法務・問い合わせ（観点 6）

- `/privacy`（PrivacyClient.tsx, 13 セクション・個人情報保護法準拠）/ `/terms`（TermsClient.tsx, 非公式ツール宣言 + 11 条）/ `/contact`（ContactClient.tsx, mailto）すべて **実コンテンツあり**（placeholder/TODO なし）。
- `legal_gap_analysis` §2: **無料公開は「追加実装なしで公開可能」**。特商法 / ads.txt / Stripe 条項 / CMP は **monetization（Phase 3）へ正しく分離**。
- 導線: landing footer（`LandingHero.tsx:133-139`）/ auth footer（`auth/page.tsx:308-314`）/ account（`account/page.tsx:406-422`）+ sitemap（`sitemap.ts`）+ robots allow + AuthGuard/BanGuard の PUBLIC_PREFIXES バイパス → ログアウト/BAN ユーザーも到達可。
- **唯一の懸念**: `contact@tierlog.app` の Cloudflare Email Routing が `2026-05-24_legal_pages_first_draft.md` §6.1 で「未実施」、以降未確認 → §9 で公開前必須検証（RD-F3）。
- 既知の soft caveat（非ブロッカー）: 法務文面は一次案、公開後に弁護士レビューの方針（documented decision）。

### 3.3 運用 runbook（観点 5）

9 runbook 中 8 が launch-ready。`database-backup-restore.md` のみ **partial**（§3.5）。

| runbook | launch-ready |
|---|---|
| observability-overview / sentry-runbook / cloudflare-rollback / live-build-verification / monitoring-alert-handling / supabase-incident-response / access_gate_operation / incident-communication-template | **yes** |
| database-backup-restore | **partial**（PITR 前提が plan tier で矛盾、§3.5） |

### 3.4 build marker（E-6、観点 5）

- emission: `scripts/prepare-cloudflare-env.sh`（branch 分岐の外で常時実行）が `NEXT_PUBLIC_BUILD_SHA = WORKERS_CI_COMMIT_SHA`（full 40 桁）を `cut -c1-12` で **12 桁**化、local fallback `git rev-parse HEAD` 12 桁、無ければ `unknown`。
- surfacing: `src/app/layout.tsx` の `metadata.other["x-tierlog-build"]` → SSR HTML に `<meta name="x-tierlog-build" content="<12hex>">`（**HTTP header ではなく meta tag**、curl で読める）。
- 検証: `curl -s <url> | grep -o 'x-tierlog-build[^>]*'` → **本番は `git rev-parse --short=12 origin/main`（main の merge commit。作業者が dev に戻っていると `HEAD` は dev を指し誤判定）**、dev preview は dev HEAD と一致 + **check-run conclusion=success**（失敗ビルドは preview URL から不可視 = 旧ビルドを serve）。`unknown` は prepare script 未経由のサイン。

### 3.5 Supabase backup / PITR（観点 5、要解消）

- `database-backup-restore.md`（2026-05-25）は **「Free Plan = 日次のみ・PITR なし」前提**。Restore 経路 A（dashboard PITR）は Pro gated。
- 一方 `plan_c_data_truncate.md` は **復旧 (TRUNCATE 取り消し) に production PITR 前提**（`access_gate_operation.md` の復旧は admin self-recovery で PITR 非依存のため対象外）。**docs が plan tier で矛盾し、production の実 tier は未確認**。
- → §8.5 で **公開前に production の tier / PITR を必須検証**（RD-F2）。PITR 無しなら C-6 production TRUNCATE は実質不可逆（§10）。

### 3.6 C-6 detection_alerts 現状（観点 7）

- production `detection_alerts` **24 件、全 `game_title='dm'`**（`dm/rapid_input:5` + `dm/repetitive_pattern:19`、すべて `is_resolved=false`）。Plan C 以前の旧 runner が INSERT 時に `game_title` を省略 → DEFAULT `'dm'` 固定。**真に dm 由来か pokepoke 誤分類かは行から判別不能**。
- `quality_score_snapshots`（14 件 = dm7 + pokepoke7）は smoke 時に再生成済 → **C-6 の対象外**。
- 新規 alert は C-3 で正しく game 別 INSERT される（運用即時支障なし）。ただし 24 件の未解決 dm 行が **dm 側の同一 user/rule の再 alert を抑制**（smoke で `run_detection_scan()` alerts=0 を確認）。誤分類があれば将来の真の dm 異常を黙って抑制し得る（狭いが実在のリスク）。
- 詳細手順は `docs/runbooks/plan_c_data_truncate.md`（preflight → 二段承認 → pg_cron 停止 → TRUNCATE → re-scan → cron 再開）。

---

## 4. Go/No-Go 判定対象の分類

### 4.1 公開 OK（解消済・本番反映済） — No-Go 理由にしない
- P0 #1（shares.image_url）/ P1 #2–#10 すべて（§3.1）。Plan A〜D で本番反映 + production migration + smoke 完了。
- 法務 3 ページ・導線（§3.2）。build marker（§3.4）。Sentry / OG / SEO / access gate / AuthGuard（§7 で regression 確認）。

### 4.2 公開前追加対応必須（blocker — 未達なら No-Go）
1. **contact@tierlog.app Email Routing = Verified + 実受信**（RD-F3、§9）。
2. **production Supabase が Pro 以上かつ PITR 有効**（RD-F2、§8.5）。Free/PITR 無しなら Pro 化を公開前に実施（または明示的に方針再判断）。
3. **C-6 の最終判断を明示的に実施**（leave/truncate のいずれか、§10・§12）。暗黙放置は不可（RD-F4）。
4. **§5 smoke / §6 主要導線 / §7 regression がすべて pass**。
5. **稼働ビルドが marker + check-run で確認可能**（§3.4）。

### 4.3 条件付き OK（許容・記録のうえ公開可）
- P2 backlog #11 / #13 / #15 残り（§4.4）を「Phase 2 で対応」と Go/No-Go 記録に明記したうえで公開（RD-F1）。
- C-6 が「leave-as-is」最終判断の場合（明示判断していれば許容、§10）。
- 法務文面が一次案（公開後に弁護士レビュー、documented decision）。

### 4.4 公開後 Phase 2 backlog（公開ブロッカーではない、RD-F1）
- **#11**: 期限切れ share の公開停止（`expires_at > now()` を公開条件化）/ share・OG の DB error と 404 分離。
- **#13**: `auto_add_opponent_deck_trigger` の `EXCEPTION WHEN OTHERS` safe-hatch / logging、battle-actions の DB error.message 直投げ見直し。
- **#15 残り**: Discord token refresh 後の DB 永続化失敗ハンドリング / `/share/*`・`/api/og/*` の public GET cache・rate limit / unbounded query への `.limit()`（SECURITY DEFINER RPC 改修 = migration 要、別 plan）。
- Plan B/C/E の Phase 2 follow-up: OG フォント subset 化、per-page metadata 精緻化、ランディング素材差し替え、client/browser Sentry、detection 旧 overload DROP（contract）、`public.games` マスタ化、admin UI の game フィルタ表示、`/auth` Suspense fallback の局所改善。

### 4.5 Phase 3 収益化（公開ブロッカー対象外）
- Billing / Entitlement / Stripe webhook / `account_access_state` 予約値（suspended/unpaid/canceled/past_due）接続。
- Ads / CSP / consent / privacy 更新 / **特商法表記** / AdSense 申請。
- implicit flow + localStorage session のまま広告タグ増加のリスク再評価（PKCE + httpOnly cookie / SSR session は明示承認付き長期 plan）。

---

## 5. 本番 `tierlog.app` 最終 smoke check（観点 2）

go-live セッションで実行（ブラウザ + curl）。すべて pass が Go 条件（§4.2-4）。

| # | 項目 | 期待 | 手段 |
|---|---|---|---|
| S1 | 稼働ビルド確認 | `x-tierlog-build` が公開対象 commit（**本番 = main の merge commit**）と一致、CI check-run success | curl + `git rev-parse --short=12 origin/main`（§3.4） |
| S2 | staging 汚染なし | 本番 HTML に `dev-duepure-tracker` / staging Supabase ref が 0 件 | `cloudflare-rollback.md` の grep |
| S3 | 公開入口 | `/` が SSR ランディング 200、login 不要で表示 | curl -I |
| S4 | 法務到達 | `/privacy` `/terms` `/contact` が 200・indexable | curl -I + robots/sitemap |
| S5 | OG | valid share の `/api/og/<id>` は **302 to Storage URL**（safe な image_url あり、`route.tsx:441`）または **ImageResponse 200**（image_url なし/弾かれた生成経路、外部フォント fetch 非依存、`route.tsx:459`）。`og:image` が Storage URL で外部 URL を出さない | curl -sI |
| S6 | OG 404/fallback | 存在しない id は **404**（`route.tsx:420`）。`/og-default.png` への 302 は **想定外例外時のみ**（`route.tsx:588`、強制例外/既知 fallback 経路で確認） | curl -sI |
| S7 | noindex / robots | `/{game}/*` は X-Robots-Tag / `<meta robots>` で noindex/nofollow（**robots.txt では disallow しない設計**、Plan B）。robots.txt は `/admin` `/account` `/api` `/auth` のみ disallow | curl + meta |
| S8 | Sentry | 本番で意図的 test error → Sentry に release/environment 付きで届き、Authorization/Cookie/token が scrub 済 | sentry-runbook |
| S9 | error/loading | `not-found` / `error` / `loading` が崩れず、HomeLink が `/{game}/...` | ブラウザ |

---

## 6. ログイン済み主要導線の確認（観点 3）

go-live セッションで実機（dm / pokepoke 両方、可能なら新規アカウント 1 つ）。

| # | 導線 | 確認 | 関連 |
|---|---|---|---|
| F1 | 新規登録 / ログイン | X / Google OAuth + email/password、login 後 `game`/`next` 保持で着地 | A-4 / `auth` |
| F2 | デッキ作成 | 0 件状態から初回デッキ登録（E-3 の導線）、dm/pokepoke 両方 | E-3 / `decks` |
| F3 | 戦績登録 | デッキ選択 → 対戦記録 INSERT 成功、format/game スコープ正しい | `battle` |
| F4 | stats 表示 | 個人/global/team stats が表示、game/format 混入なし、loading flash 軽減 | C / E-5 / `stats` |
| F5 | share 作成 | ShareModal から share 作成、image が Storage 由来のみ | A-1 / `ShareModal` |
| F6 | share 表示 / OG | `/share/[id]` 表示 + OG 画像が Storage URL、外部 URL を出力しない | A-1 / B-2 |
| F7 | Discord 連携 | start → callback → connected、失敗/解除/refresh が無言でなくエラー表示、auth 失効が AuthGuard redirect へ | D / E-4 / `api/discord/*` |
| F8 | account / security | display name / auth provider / X 連携 / stage 表示が正しい | `account`, `account/security` |
| F9 | account delete | 退会が stage 状態に関わらず実行可（requireActiveUser:false）、関連データ削除 | D-4 / `api/account/delete` |
| F10 | BAN 体験 | stage=4 で書き込みが DB/RLS で拒否、BanGuard が白画面でなく BAN UI、fail-open は維持 | A-3 / D |

---

## 7. Plan A〜E 保護対象の regression 確認（観点 4）

§5/§6 実行中に下記が壊れていないことを確認（git は触らず挙動で確認）。

- **A**: share image は Storage scheme のみ（`sanitizeShareImageUrl` / `is_safe_share_image_url`）。auth next は `isSafeInternalPath`。BanGuard fail-open + retry `[300,800]` + public path bypass。
- **B**: Sentry `beforeSend` scrubber + `sendDefaultPii:false` + release/env。OG `runtime="nodejs"` + `/og-default.png` fallback + cache。sitemap/robots/metadata robots ロジック。
- **C**: format コード一意、read-RPC は `p_format` のみ（`p_game_title` を足さない）、write-RPC は `p_game_title`。quality scoring の `(user_id, game_title)` + stage = MAX(score)。
- **D**: `account_access_state` の返り値（active/banned/unknown/unauthenticated + admin 例外）。requireBearer requireActiveUser（delete は opt-out）。AuthExpiredError + `tierlog:auth-expired` + AuthGuard 三重経路 + Suspense 境界。BanGuard と AuthGuard 並列・責務分離。
- **E**: build marker meta。lint 0 + react-hooks `7.1.1` pin（CI green）。onboarding 空状態導線。Discord UX エラー表示。stats perf（Promise.all、p_format 維持）。

---

## 8. 運用確認（観点 5）

| # | 項目 | 確認 | blocker? |
|---|---|---|---|
| O1 | build marker | §3.4 の curl + check-run 突合が機能 | Go 条件（§4.2-5） |
| O2 | rollback | `cloudflare-rollback.md` の health check + Dashboard rollback 手順が最新、Deploy ボタン禁止周知 | 推奨 |
| O3 | Sentry | §5 S8 の test event が scrub/ release/env 付きで届く | 推奨 |
| O4 | monitoring | `monitoring-alert-handling.md` の severity / 初動が運用可能 | 推奨 |
| O5 | **backup / PITR** | **production の plan tier と PITR を実検証。Pro+PITR なら充足、Free/PITR 無しなら Pro 化を公開前必須**（RD-F2） | **blocker（§4.2-2）** |
| O6 | incident | supabase-incident-response / incident-communication-template が利用可能 | 推奨 |

### 8.5 backup / PITR 検証手順（go-live セッションで実行、RD-F2）
1. **公式 docs 確認**（CLAUDE.md ルール）: Supabase の backup / PITR がどの plan で利用可か WebFetch で確認。
2. production project（ref `asjqtqxvwipqmtpcatvz`、出典: Plan C/D 完了報告 + memory `supabase-migration-ops`）の Dashboard → Settings → Database → Backups / Point-in-Time Recovery で **現在の tier と PITR 有効/保持期間**を確認。
3. 判定:
   - **Pro 以上 + PITR add-on 有効** → O5 充足、C-6 truncate の prod 復旧路あり。（注: PITR は Pro/Team/Enterprise の有料 add-on で Small compute add-on 等が前提。Pro でも PITR を別途有効化していなければ「無効」扱い。要件は公式 docs で確認: `supabase.com/docs/guides/platform/backups`。）
   - **Free または PITR 無し** → **No-Go / 要対応**。Pro 化を公開前に実施するか、方針を再判断。PITR 無しのまま公開する場合は **C-6 production TRUNCATE は実質不可逆**として §10 に従い truncate を選ばない。
4. `database-backup-restore.md` の plan-tier 記述を実態に合わせて更新する follow-up を記録（本 plan では編集しない）。

---

## 9. 法務・問い合わせ・無料公開充足（観点 6）

- **充足済（公開可）**: 法務 3 ページ実コンテンツ・導線・sitemap/robots（§3.2）。`legal_gap_analysis` が「追加実装なしで公開可能」と明言。特商法等は Phase 3 へ正しく分離。
- **公開前必須（blocker、RD-F3）— Email Routing 検証 checklist**（go-live セッションで実行、公式 docs 確認のうえ）:
  - [ ] Cloudflare Email Routing で `contact@tierlog.app` の routing rule が有効
  - [ ] destination address が verified
  - [ ] **転送先とは別のアドレスから** `contact@tierlog.app` 宛にテスト送信
  - [ ] 転送先 inbox で受信を確認
  - [ ] 受信不可なら **No-Go / 公開前要対応**（代替導線だけでは公開しない）
- **記録のみ（非ブロッカー）**: 法務一次案・公開後弁護士レビュー方針。

---

## 10. C-6 detection_alerts 24 件 preflight + 選択肢（観点 7、RD-F4）

**本 plan では leave/truncate を決めない。go-live 直前の最終ゲートで下記 preflight を実行してから判断する。**

### 10.1 preflight チェック（go-live 直前、read-only）
- [ ] 環境確認（production / staging）、接続文字列は local env で扱いチャットに貼らない。
- [ ] **件数と分布の再確認**（2026-05-28 から増えている可能性。新規は正しい game_title で入る）:
  ```sql
  SELECT game_title, count(*) FROM public.detection_alerts GROUP BY game_title;
  SELECT game_title, rule_key,
         count(*) FILTER (WHERE is_resolved=false) AS unresolved, count(*) AS total
  FROM public.detection_alerts GROUP BY game_title, rule_key ORDER BY 1,2;
  ```
- [ ] 対象ユーザーの状態（stage 等）を確認。
- [ ] **ユーザー向け / 自動処理に game-ambiguous reader が無い**ことを確認（consumer は game-scoped `detect_*` の NOT EXISTS dedup で正しく分離）。**ただし admin detection UI は all-game 初期表示（`getDetectionAlerts` の game 未指定で game_title 非フィルタ、`admin-actions.ts:688`）かつ alert 表示に game_title を出さない（`admin/detection/page.tsx:30,174`）既知制約があり、leave-as-is 判断時にこれを記録する**。
- [ ] **backup / PITR が有効か確認**（§8.5）。無効なら truncate は選ばない。
- [ ] 「ユーザー0 = 損失なし」と仮定しない（runbook が明示禁止）。

### 10.2 選択肢
| 選択肢 | 内容 | 可逆性 |
|---|---|---|
| **A. leave-as-is** | 24 件をそのまま残す。新規は正しく分類。様子見。 | **可逆（no-op）**。明示判断していれば §4.3 で許容 |
| **B. TRUNCATE + 即 re-scan** | `TRUNCATE detection_alerts` → 同一セッションで `run_detection_scan()` 再生成（runbook 手順）。pg_cron 停止 → 二段承認 → 実行 → cron 再開。 | **行レベル不可逆**。re-scan は「現 battles に残る異常」を正しい game_title で復元するが、**手動 resolve 済み履歴は復元不可**（現 24 件は全 is_resolved=false のため懸念は低い）。**prod 復旧は PITR 依存（無ければ実質不可逆）** |
| C. backfill | 正しい game_title を 24 件に埋める | **不可（真の game は復元不能）= 非選択肢** |

### 10.3 実行規律（B を選ぶ場合のみ、go-live セッション）
- `apply_migration` ではなく `execute_sql` / 手動 SQL（履歴に migration として残さない、RD-C6）。
- pg_cron の `daily-detection-scan` / `daily-quality-scoring` を停止 → jobid 記録 → 実行 → 再スケジュール。
- 二段承認（preflight 後 / backup 確認後）。
- `quality_score_snapshots` は対象外（再生成済）。

判断結果（A / B / その他）は **go-live 記録に残す**。

---

## 11. Go/No-Go 判定基準（観点 8）

### 公開 OK（Go）
次をすべて満たす:
- §4.2 blocker が全項目 pass:
  - contact@tierlog.app 受信確認済（§9）
  - production Pro+PITR 有効（§8.5）
  - C-6 最終判断を明示実施（A or B、§10）
  - §5 smoke / §6 主要導線 / §7 regression すべて pass
  - 稼働ビルド marker + check-run 確認済（§3.4）
- §4.4 Phase 2 backlog を「公開後対応」と記録済（RD-F1）

### 条件付き OK（Conditional Go）
- 上記 Go 条件を満たすが、軽微な smoke 不備に **回避策があり記録済**、または C-6 が「leave-as-is」明示判断、P2 backlog を Phase 2 受容 — の状態。公開可だが follow-up を go-live 記録に明記。

### 公開前追加対応必須（No-Go）
次のいずれかに該当:
- contact@tierlog.app が受信不可（§9）
- production が Free / PITR 無しで、Pro 化も方針再判断もしていない（§8.5）
- C-6 を明示判断していない（暗黙放置）
- §5/§6/§7 のいずれかで P0/P1 級の不具合・regression を検出
- 稼働ビルドが marker / check-run で確認できない（旧ビルド serve 疑い）

---

## 12. go-live 実行シーケンス（最終ゲート手順）

別セッションで上から順に実行（本チャットでは実行しない）:

1. **ビルド確定**: 公開対象 commit が `main` に反映 → Cloudflare check-run success → `x-tierlog-build` が一致（§3.4 / S1）。
2. **smoke**: §5 S1–S9 を本番で実行。
3. **主要導線**: §6 F1–F10 を dm/pokepoke 実機。
4. **regression**: §7 を §5/§6 中に確認。
5. **運用**: §8 O1–O6、とくに **O5 backup/PITR（blocker）**。
6. **法務**: §9 Email Routing 受信確認（blocker）。
7. **C-6 最終ゲート**: §10 preflight → leave/truncate 判断 → 記録。
8. **Go/No-Go 判定**: §11 に照らし 公開 OK / 条件付き OK / 公開前追加対応必須 を確定し記録。
9. （Go の場合）公開告知（incident-communication-template の planned 系を活用）。

---

## 13. 未解決質問

### 13.A 着手前に解くべき質問
**該当なし**（P2 残件の扱い / PITR / 問い合わせ窓口 / C-6 判定時期は 2026-05-30 の AskUserQuestion で RD-F1〜F4 として確定）。

### 13.B go-live セッションで確定する事項（本 plan では決めない）
- C-6 の leave/truncate 最終結論（§10、preflight 後）。
- production tier が Free/PITR 無しだった場合の Pro 化実施か方針再判断か（§8.5）。
- §5/§6 で不具合が出た場合の修正 plan 化。

---

## 14. 検証コマンド（go-live セッション用、本チャットでは実行しない）

```bash
# S1 稼働ビルド（本番 marker = main の merge commit SHA）
curl -s https://tierlog.app | grep -o 'x-tierlog-build[^>]*'
git fetch origin main && git rev-parse --short=12 origin/main   # 本番対象 = main HEAD/merge commit。dev に戻っていると HEAD は誤判定
gh run list --branch main --limit 5                             # 当該 main commit の check-run success を確認

# S2 staging 汚染（cloudflare-rollback.md）
curl -s https://tierlog.app | grep -c 'dev-duepure-tracker'   # 0 期待
curl -s https://tierlog.app | grep -c 'uqndrkaxmbfjuiociuns'  # 0 期待

# S3/S4 公開入口・法務
curl -sI https://tierlog.app | head -3
for p in privacy terms contact; do curl -sI https://tierlog.app/$p | head -1; done

# C-6 preflight（read-only、§10）— production 接続は local env、チャットに貼らない
# SELECT game_title, count(*) FROM public.detection_alerts GROUP BY game_title;

# 静的（dev、A〜E 非破壊の念のため確認）
npm run lint && npx tsc --noEmit && npm test
```

PITR / Email Routing は Dashboard + 公式 docs 確認（§8.5 / §9）。

---

## 15. Codex にレビューさせるべき観点

1. **照合の正確性**: §3.1 の P0/P1/P2 マッピングが各完了報告と一致するか、RESOLVED 判定に過大評価がないか。
2. **blocker 定義の妥当性**: §4.2 / §11 の No-Go 条件（Email Routing / PITR / C-6 明示判断）が過不足ないか。とくに PITR 無し=No-Go の線引き。
3. **C-6 preflight の安全性**: §10 の preflight・選択肢・可逆性が `plan_c_data_truncate.md` と整合し、truncate を PITR 確認前に許していないか。backfill 非選択肢の明記。
4. **regression リストの網羅**: §7 が A〜E の保護契約（とくに read-RPC p_format / AuthGuard 三重経路 / share Storage scheme / build marker）を漏れなく含むか。
5. **スコープ厳守**: 本 plan が DB/コード/外部操作を一切せず、検証を go-live セッションへ正しく委譲しているか。Phase 2 / Phase 3 の切り分けが audit §5 と整合するか。
6. **C-6 を公開後に回さない構造**: RD-F4（最終ゲートで判断）が §10/§11/§12 に一貫して落ちているか。

---

## 16. レビュー / 反映フロー

1. 本 plan を `/review-plan-loop` で plan-critic 検証 → 機械的指摘は自動修正、判断要は AskUserQuestion（着手前は RD-F1〜F4 で解決済）。
2. plan-critic GO 後、Codex レビュー（§15）→ 反映 → 再 GO。
3. plan ファイルを `dev` に commit/push（Plan A〜E と同じ運用）。
4. **判定・検証・C-6・公開は別の go-live セッションで実施**（本チャットは plan 作成と review まで）。

---

## 17. 補足

- 本 plan は **判定フレームワークであり実装ではない**。公開可否を機械的に詰めるためのチェックリストで、A〜E の成果を壊さず・データに触れず・収益化と切り分けて「無料一般公開してよいか」を確定する。
- 公開ブロッカー級の未解消コードは無い。残る blocker は **運用/設定の検証**（Email Routing / PITR）と **C-6 の明示判断**で、いずれも go-live 直前に確定する。
- C-6 と PITR は同一リスク軸（prod truncate 復旧が PITR 依存）。PITR を先に確定すれば C-6 判断が安全になる。

---

## Resolved Decisions

- **RD-F1（P2 残件 #11/#13/#15）**: Phase 2（公開後）backlog として承認。Go/No-Go の **No-Go 理由にしない**。理由: P0/P1 解消済、#11 は外部 URL/OG/SEO の主要リスク塞済、#13 は公開停止級でない、#15 は E で一部改善・残りは公開後の運用/負荷耐性。§4.3 の許容項目 + §4.4 backlog に明記。
- **RD-F2（PITR/backup）**: production の Supabase plan tier / backup / PITR を **公開前必須確認**（§8.5）。Pro 以上 + PITR 有効なら Go 条件充足、Free または PITR 無しは **無料公開前の No-Go / 要対応**。C-6 production TRUNCATE+rescan は PITR 無い限り実施不可（実質不可逆）と明記。確認手順・PITR 無し時の扱い・C-6 への影響を Plan F に記載。
- **RD-F3（問い合わせ窓口）**: `contact@tierlog.app` の Cloudflare Email Routing が Verified で **実際に受信できる**ことを無料公開前の **必須チェック**（§9）。未達なら公開ブロッカー。checklist: routing rule 有効 / destination verified / 別アドレスからテスト送信 / 転送先 inbox 受信確認 / 受信不可なら No-Go。代替導線だけでは公開 OK にしない。
- **RD-F4（C-6 判定時期）**: C-6 detection_alerts 24 件は **Go/No-Go の最終ゲート項目**。go-live 直前に preflight（件数・game_title 分布・is_resolved・rule_key 分布・対象ユーザー状態の再確認 / game-ambiguous reader 無し確認 / backup・PITR 確認）を実行し、leave-as-is / truncate+rescan / その他を **最終判断して go-live 記録に残す**。**Plan F 内では結論を出さず preflight + 選択肢整理まで**（§10）。truncate は PITR 無しだと実質不可逆のため backup/PITR 確認前は実施しない。leave-as-is も有効だが暗黙放置でなく明示判断。
- **RD-F5（スコープ）**: 本 plan は **DB migration・コード編集・外部サービス操作・実行を一切しない**。記載の検証（Email Routing / PITR / smoke / 主要導線 / regression / C-6 preflight）は **go-live セッションで実行する手順書**であり、本チャットでは実行しない。commit/push は Plan F ファイルのみ。
