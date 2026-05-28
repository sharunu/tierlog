# Plan D: Access Gate / Auth Expiry

- 作成日: 2026-05-28
- 作成者: Claude Code (Opus 4.7)
- 元レポート: `docs/reports/2026-05-27_integrated_pre_public_monetization_audit.md` §4.2 + §4.8 + §5.3
- Plan A 完了報告: `docs/reports/2026-05-27_plan_a_public_launch_safety_completion.md`
- Plan B 完了報告: `docs/reports/2026-05-27_plan_b_observability_og_seo_completion.md`
- Plan C 完了報告: `docs/reports/2026-05-28_plan_c_multi_game_db_scope_completion.md`
- ステータス: **ドラフト (Codex レビュー前)**
- 想定ブランチ: `dev`
- **本 plan ファイルの取り扱い**:
  - **plan 作成専用チャット** で作成。実装は別チャットで開始。
  - **本 plan 作成チャットでは実装に入らない**。コード編集 / DB 変更 / migration 適用 / commit / push / 外部サービス操作は一切しない。plan ファイル編集のみ。
  - production / staging Supabase DB への操作は禁止。
  - 実装着手は、ユーザーが別チャットで「実装してください」と明示指示した時点から開始。

---

## 0. 目的とスコープ

統合 audit §4.2 (停止ユーザー制御と将来の課金停止 gate) + §4.8 (auth 失効の silent empty 化) を実装可能な単位に整理する。Plan A / B / C 完了の前提で、**DB レイヤでの書き込み強制** と **`if (!user)` 系の認証失敗時挙動の整理** を進める。

### 含めるもの

- D-1 `account_access_state(uid)` DB 関数の導入 (stage=4 ban を boolean ではなく state 表現で扱い、将来 unpaid / canceled / suspended に拡張可能な土台) (P1)
- D-2 書き込み系 RLS (`battles` / `decks` / `deck_tunings` / `shares` の INSERT/UPDATE) に access gate を AND (P1)
- D-3 書き込み系 RPC / SECDEF 関数の明示チェック (`auto_add_opponent_deck` 等で必要に応じて) (P1)
- D-4 重要 API route (`/api/account/delete` / `/api/discord/*` / `/api/admin/*` の admin 操作) で gate チェック (P1)
- D-5 `lib/actions/` の `if (!user)` 37 箇所を **用途別 3 分類** (UI 表示用 / 認可 / optional state) に整理、`AuthExpiredError` 共通エラー + UI 側 `AuthGuard` 連動 (P1)
- D-6 middleware session refresh の正式化 (Plan A で「最小修正」のまま残っていた整理、Plan A BanGuard fail-open との整合確認) (P2)
- D-7 Plan A BanGuard fail-open / Plan C `profiles.stage = MAX(score)` との接続性明文化 (P1)

### 含めないもの (別 plan)

- **Plan A / B / C で完了済の再実装は禁止**:
  - Plan A: `shares.image_url` 二段防御、legacy URL、`<HomeLink />`、BanGuard retry + fail-open + RD-B8 二段判定、auth `game/next` 引き継ぎ、open redirect helper、`loading.tsx` / `global-error.tsx`
  - Plan B: Sentry scrubber / release / environment、OG フォント自前、public landing、sitemap、noindex header、`/share/[id]` `robots: noindex,follow`、B-4-e BanGuard exact + prefix
  - Plan C: `get_team_member_summaries` game scope、detection 関数 `p_game_title`、`_run_detection_scan_internal` 二重ループ、`_calculate_quality_score_internal` game 別、`quality_score_snapshots` 複合キー、`profiles.stage = MAX(score)`、snapshot caller `.single()` 撤去
- **Plan C の C-6 TRUNCATE および production 既存 detection_alerts 24 件の扱い判断**: 本 plan のスコープに含めない (ユーザー指示で別途判断)
- **Stripe / 課金導入そのもの**: Phase 3 plan に分離。本 plan は **「将来 unpaid / canceled を同じ gate に載せられる土台」** までを設計する
- 認可判断の `getUser()` → `getSession()` 一括置換: 禁止 (Codex 既存指摘で確定)
- `getUser()` 多用そのものの最適化 (RTT 削減 / 集約 RPC 化): Plan E (Phase 2) で扱う、本 plan では `if (!user)` 失敗時挙動の整理のみ
- `profiles.stage` の game 別分離 (account-level stage 集約をやめる): Plan C §10.B で Phase 2 送り確定済、本 plan で再検討しない (account-level state を強化する方向で進める)
- consent UI / ads.txt / 特商法ページ: Phase 3 plan
- 退会 (account delete) の Stripe 顧客削除連携: Phase 3 plan

---

## 1. 関連 plan との依存関係

| Plan | 内容 | Plan D との関係 |
|---|---|---|
| Plan A (完了) | UI/route + `shares.image_url` 二段防御 | **BanGuard fail-open + retry を維持**。Plan D は DB レイヤで書き込みを強制し、UI 側 BanGuard は Supabase 一時障害時の UX 維持のため引き続き fail-open。両者は補完関係 |
| Plan B (完了) | Sentry / OG / SEO | 影響なし。Plan D は Sentry / OG route / landing / `next.config.ts` を touch しない |
| Plan C (完了) | Multi-Game DB Scope | **`profiles.stage = MAX(score)` の自動降格 (Plan C `_run_quality_scoring_internal`) が起きた瞬間に書き込みが止まる** という接続を D-7 で明文化。Plan C で stage=4 への降格経路ができたため、Plan D の access gate がリアルに機能する |
| **Plan D (本 plan)** | Access Gate / Auth Expiry | — |
| Plan E (Phase 2) | onboarding / perf / Discord refresh / test 復旧 / `getUser()` RTT 削減 | Plan D 後。`getUser()` 多用そのものの最適化は Plan E で |
| Phase 3 plan | Billing (Stripe) / Ads / Legal | Plan D の `account_access_state` を **拡張** して `'unpaid'` / `'canceled'` を載せる。Plan D で「拡張可能な土台」までを完成させる |

**実装順序の推奨**: Plan A / B / C 完了後、Plan D を独立して進められる。Plan E と並行可能 (異なる領域)。

---

## 2. プロジェクト固有ルールの厳守事項

`AGENTS.md` / `CLAUDE.md` から本 plan に直結する制約:

- **`main` への直接 push 禁止**。全変更を `dev` ブランチで実装し、ユーザーの「本番反映」明示指示を待ってから `main` へ merge。
- **`dev` への commit/push は実装完了時点で Claude が自動実施可**。本番影響なし。
- **production Supabase DB 変更は禁止**。本 plan 作成チャットでは staging DB への変更もしない。
- **production migration 適用はユーザーの明示指示があるまで禁止**。staging 適用 → dev preview 検証 → ユーザー承認 → production 適用の順序を厳守。
- **既存 auth 設定 (implicit flow / `client.ts` / `auth/callback/page.tsx` の SIGNED_IN 処理) は変更しない**。
- **`middleware.ts` は Plan A で touch 済 (rate limit + legacy redirect)**。Plan D で session refresh を正式化する場合は Plan A の既存処理を壊さない。
- **`getUser()` を `getSession()` に一括置換しない** (Codex 既存指摘で確定)。Plan D の `if (!user)` 整理でも `getSession()` 一括置換はしない。
- **任意外部 `image_url` を再許可する方向に戻さない** (Plan A 二段防御維持)。
- **Plan A / Plan B / Plan C 完了済の機能は再実装しない**。
- **URL ハードコード禁止**。`process.env.NEXT_PUBLIC_APP_URL` か `window.location.origin` 経由。
- **Runtime secret は `getServerEnv()` 経由**。
- **読み取り系 RPC全体への `p_game_title` 追加は禁止**。`p_format` で game scope される前提を維持。
- **Cloudflare / Supabase / Sentry 等の外部サービス dashboard 操作は本 plan 作成チャットでは実施しない**。
- **dashboard 操作手順を plan に含める場合は、必ず公式ドキュメント確認 (WebFetch) を前提条件として明記する**。

---

## 3. 現状調査

### 3.1 関連 migrations / SQL functions / RLS

| 領域 | ファイル / 関数 | 現状 |
|---|---|---|
| Access helper (既存) | `supabase/migrations/20260424000001_security_hardening_additive.sql:116` の `is_team_member(p_team_id uuid, p_user_id uuid)` / `20260426005408:25` の `is_admin_user()` | ✅ 既存。team / admin 専用 helper。**書き込み許可判定の汎用 helper `is_active_user()` / `account_access_state()` は未存在** |
| `battles` INSERT RLS | `supabase/migrations/20260511000003_rls_auth_init_plan.sql:47` `Users can insert own battles` | **WITH CHECK は `auth.uid() = user_id` + decks 所有 EXISTS + format/game_title 一致 + opponent_deck_settings EXISTS + tuning_id EXISTS の 4 段 depth-defense を既に含む。❌ ただし access_state / stage チェックはない**。stage=4 ユーザーが REST から直 INSERT 可能 (deck と format を持っていれば書き込めてしまう) |
| `decks` INSERT RLS | 同 `:121` `Users can insert own decks` | **WITH CHECK は `auth.uid() = user_id` + opponent_deck_settings EXISTS を既に含む。❌ access_state / stage チェックはない** |
| `deck_tunings` RLS | `supabase/migrations/20260314000001_add_deck_tunings.sql` + `20260511000004_consolidate_admin_select_policies.sql:95-138` で **SELECT / INSERT / UPDATE / DELETE の 4 本に分割済** (旧 FOR ALL `Users can manage own deck tunings` は DROP 済) | **各 POLICY とも EXISTS decks 所有検査を既に含む。❌ access_state / stage チェックはない**。Plan D では **INSERT / UPDATE のみ** に gate を追加し DELETE / SELECT は変更しない (RD-D2 + 既存 D-2 DELETE 非変更方針と整合) |
| `shares` INSERT RLS | `supabase/migrations/20260511000003_rls_auth_init_plan.sql:258` `Authenticated users can create own shares` | **`WITH CHECK (auth.uid() = user_id)` のみ + Plan A の `is_safe_share_image_url` trigger 由来の image_url 制限。❌ access_state / stage チェックなし** |
| `feedback` INSERT RLS | `supabase/migrations/20260407000001_feedback.sql` | **`WITH CHECK (auth.uid() = user_id)` のみで stage チェックなし** (実コード grep で確認済)。ただし [RD-D2] により Plan D では **対象外** (BAN 不服申立て経路として残す) |
| `profiles.stage` | `20260412000007_user_stages.sql` で導入、`1` = 優良 / `2` = 一般 / `3` = 要注意 / `4` = BAN | ✅ 既存。Plan C で MAX(score) で自動更新される |
| detection / quality scoring の stage 参照 | `WHERE p.stage IN (1, 2, 3)` で stage=4 を **検出対象から除外** している (Plan C 完了済の 20260527000003 等) | ✅ 既存。stage=4 = BAN 済を意味する運用 |
| BanGuard (Plan A 完了) | `src/components/providers/BanGuard.tsx` retry + fail-open + RD-B8 exact + prefix 二段判定 | ✅ 維持。Plan D では touch しない、DB 強制と並列で動く |

### 3.2 関連 actions / lib / API route / admin UI

| ファイル | 関連箇所 | Plan D 影響 |
|---|---|---|
| `src/lib/actions/account-actions.ts:165` | `getUserStage()` (現状実装、`profiles.stage` を read) | D-5 で AuthExpiredError 共通化対象の 1 つ |
| `src/lib/actions/admin-actions.ts:645` | `getUserStageHistory(userId)` (admin 用 stage 履歴取得) | D-4 (admin route 経路) で access gate チェック対象 |
| `src/lib/actions/**` 全体 | `supabase.auth.getUser()` 呼び出し **41 箇所** / `if (!user)` 分岐 **37 箇所** (`account=9 / battle=12 / team=5 / deck=4 / stats=4 / admin=2 / feedback=1`、admin-actions.ts では getUser 後に if(!user) チェックを持たない箇所が 2 件ある)、`return [] / null / false / throw` 混在 | **D-5 メイン対象**。`if (!user)` 37 箇所を用途別 3 分類 (UI 表示用 / 認可 / optional state) に整理 |
| `src/components/providers/BanGuard.tsx` | Plan A 完了の retry + fail-open + RD-B8 | **D-7 で接続性明文化**、本 plan では構造変更なし |
| `src/middleware.ts` | Plan A で rate limit + legacy redirect 最小修正済、`supabase` import 残置 (session refresh は touch 不要との Plan A 判断) | **D-6 で正式設計**、Plan A 既存 + B-4-e BanGuard 連動を壊さない |
| `src/app/api/account/delete/route.ts` | アカウント削除 API | D-4 で access gate チェック対象 (削除自体は ban 中でも可だが、状態確認必要) |
| `src/app/api/discord/*` | Discord 連携 / refresh | D-4 で gate チェック対象 |
| `src/app/api/admin/*` | admin 経路 (limitless-sync / share-cleanup / settings) | D-4 で **gate (要 admin) + access gate (要 active)** の二段 |
| `src/lib/auth/require-bearer.ts` | admin API Bearer 検証共通 helper | D-4 で access gate チェックを統合する候補 |

### 3.3 現状の認証経路まとめ

- **UI 表示** (`BanGuard` Plan A 完了): client 側で `getUser()` + `getUserStage()` → stage=4 なら BAN 画面、retry + fail-open
- **書き込み** (RLS): `WITH CHECK (auth.uid() = user_id)` のみ、**stage チェックなし** → REST 直叩きで stage=4 ユーザーも書き込み可能
- **管理操作** (`require-bearer`): Bearer JWT 検証 + admin 判定 (オプション) のみ、stage チェックなし
- **書き込み系 RPC** (`auto_add_opponent_deck` 等、SECDEF): RLS bypass で動作するため、関数内で個別チェック必要

**結論**: UI 側の BanGuard は機能しているが、**REST/RPC から見ると stage=4 が書き込み禁止されていない**。これが Plan D の P1 解決対象。

---

## 4. 問題の分類

### 4.1 公開前に直すべきもの (本 plan で実施)

- D-1 `account_access_state(uid)` 関数導入 ([RD-D1] により text 型確定、admin 例外を関数内蔵)
- D-2 書き込み系 RLS に access gate を AND (battles / decks / deck_tunings / shares)
- D-3 書き込み系 RPC / SECDEF 関数の明示チェック (`auto_add_opponent_deck` / `update_my_display_name` 等の必要箇所、影響箇所の grep が必要)
- D-4 重要 API route で gate チェック (`require-bearer` 拡張で集約可能)
- D-5 `if (!user)` 37 箇所を 3 分類整理 + `AuthExpiredError` + UI `AuthGuard` 連動
- D-7 Plan A BanGuard + Plan C `profiles.stage = MAX(score)` との接続性明文化

### 4.2 P2 / 後回しでよいもの

- D-6 middleware session refresh の正式化 (Plan A 最小修正で動作中、UX 影響軽微)
- `if (!user)` の RTT 削減 / 集約 RPC 化 (Plan E)
- `profiles.stage` を game 別分離 (Plan C §10.B、Phase 2)
- Stripe webhook → `account_access_state` 拡張 (Phase 3)

### 4.3 誤検知または現状維持

- Plan A BanGuard fail-open は **意図通り維持**。Supabase 一時障害時に全ユーザー画面停止を避ける UX 設計のため。
- Plan D は **DB 側強制** で書き込みを止めるので、UI 側 fail-open が不正利用に繋がらないことを §D-7 で明文化。
- 認可判断の `getUser()` → `getSession()` 一括置換は禁止 (現状維持)。

---

## 5. 実装方針 (migration 安全順序)

### 5.1 expand → code → contract の原則

- 原則 **additive expand**。RLS 既存 POLICY は `DROP POLICY IF EXISTS` → `CREATE POLICY` で置換 (Supabase RLS は ALTER POLICY ではなく drop-create が standard)。
- 既存 `Users can insert own battles` 等の POLICY を **新しい WITH CHECK 式** (`auth.uid() = user_id AND public.account_access_state(auth.uid()) = 'active'`) に置換するため、**既存挙動を壊す可能性** がある。staging で smoke test を入念に行う。
- 旧関数 / 旧 POLICY を一時的に並走させる必要は **ない** (RLS は POLICY 単体で評価されるため)。

### 5.2 staging 適用 → dev preview 検証 → production 適用順序

1. (Claude) **migration ファイルを `supabase/migrations/` に追加** (実装チャット)
2. (Claude) **staging DB 適用** (`apply_migration` または `npx supabase db push --include-all`)
3. (Claude) staging で migration list 確認 + smoke test (SQL レベル + REST 直叩き)
4. (Claude) コード変更 (`if (!user)` 整理 + `AuthExpiredError` + `AuthGuard` 連動 + `require-bearer` 拡張) を `dev` branch に commit → push → Cloudflare dev preview build
5. (ユーザー) dev preview で動作確認:
   - stage=4 ユーザーで `/dm/battle` から戦績登録 → DB レイヤで 拒否される
   - stage=1〜3 ユーザーで通常操作 → regression なし
   - JWT 失効状態の操作 → AuthExpiredError → AuthGuard が `/auth` redirect (戦績ゼロ表示にならない)
6. (ユーザー) 「本番反映」明示指示
7. (Claude) `git checkout main && git merge dev && git push origin main`
8. (ユーザー) 本番デプロイ確認後、production migration 適用の明示指示
9. (Claude) production DB 適用
10. (Claude) production smoke test (admin で stage=4 テストユーザーを作って書き込みが拒否されることを確認)

**順序の必須性**:

- D-1 (関数追加) → D-2 (RLS で関数を AND) の順序が必須。関数が無いまま POLICY を変更すると依存解決エラー。同一 migration 内で `CREATE FUNCTION → CREATE POLICY` を 1 ファイルに集約してもよい。
- D-2 / D-3 適用後、stage=4 ユーザーの書き込みが即拒否される。**Plan A BanGuard の fail-open 動作と矛盾しないことを D-7 で明文化** (BanGuard が UI 表示を fail-open しても DB 側で拒否されるので不正利用にならない)。

### 5.3 rollback 方針

- D-1 関数追加: `DROP FUNCTION IF EXISTS public.account_access_state(uuid);` (依存先 POLICY が DROP CASCADE で消えるリスクあり、staging で確認)
- D-2 RLS 更新: 旧 POLICY 定義 (Plan A 完了時の `auth.uid() = user_id` のみ) に戻す `CREATE POLICY` を rollback ファイルに保存
- D-3 RPC 更新: 旧関数定義に戻す `CREATE OR REPLACE FUNCTION`
- コード rollback: Cloudflare Deployments ダッシュボードで前 deploy に戻す

---

## 6. サブタスク詳細

### D-1: `account_access_state(uid)` DB 関数導入 (P1)

#### 背景

統合 audit §4.2: 「`is_active_user()` または `account_access_state` 相当の DB 関数を作り、書き込み系 RLS と重要 RPC/API で強制する。短期は ban / suspended を DB/RLS/API で強制し、将来 unpaid / canceled を同じ gate に載せられる形を plan で明確化する」。

#### 対象ファイル候補

- `supabase/migrations/2026MMDD00000N_d1_account_access_state.sql` (新規)
- `supabase/rollback/2026MMDD00000N_rollback.sql`

#### 実装方針

**採用方式**: [RD-D1] により `account_access_state(uid uuid) returns text` を採用。戻り値は `'active'` / `'banned'` / `'unauthenticated'` / `'unknown'`、将来 reserved state として `'suspended'` / `'unpaid'` / `'canceled'` / `'past_due'` を追加する設計余地を確保 (Phase 3 Stripe 連携時)。

**重要**: [RD-D3-1] により admin は stage チェックから除外する。既存 `is_admin_user()` (`20260426005408_secdef_search_path.sql:25`) は **`auth.uid()` 専用** (引数なし) なので、`account_access_state(p_uid)` の中で **`p_uid` に対する admin 判定**を行う方式を確定する必要がある。

**確定 ([RD-D1-A])**: `account_access_state` 関数内で `public.profiles.is_admin` を **直接 SELECT** して admin 判定する (案 A 採用)。`is_admin_user(p_uid uuid)` overload は **本 plan では作らない**。理由:
- `is_admin_user` インタフェース汎用化 (引数あり版の追加) は影響範囲が広いため、Phase 2 候補に分離する
- `account_access_state` は内部実装として `profiles.is_admin` を読むだけで済むため、最小変更でゴール達成可能
- `stage` と `is_admin` を 1 回の `SELECT` で取得して `STABLE` キャッシュ効率も悪くない

```sql
-- [RD-D1] + [RD-D1-A] + [RD-D3-1] 反映済擬似 SQL
CREATE OR REPLACE FUNCTION public.account_access_state(p_uid uuid)
RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_stage int;
  v_is_admin boolean;
BEGIN
  IF p_uid IS NULL THEN
    RETURN 'unauthenticated';
  END IF;

  -- ★ [RD-D1-A] admin 例外: profiles.is_admin を直接 SELECT、is_admin_user overload は作らない
  SELECT COALESCE(is_admin, false), stage
    INTO v_is_admin, v_stage
    FROM public.profiles
    WHERE id = p_uid;

  IF v_stage IS NULL THEN
    -- profiles 行が存在しない場合 (auth.users にはあるが profiles レコード未作成等)
    RETURN 'unknown';
  END IF;

  -- ★ [RD-D3-1] admin は stage に関わらず active 相当扱い
  IF v_is_admin THEN
    RETURN 'active';
  END IF;

  IF v_stage = 4 THEN
    RETURN 'banned';
  END IF;

  -- 将来 reserved state: 'suspended' / 'unpaid' / 'canceled' / 'past_due' は Phase 3 Stripe で追加
  RETURN 'active';
END;
$$;

REVOKE ALL ON FUNCTION public.account_access_state(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.account_access_state(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.account_access_state(uuid) IS
  'Returns the account access state for the given user. Used by write-side RLS and important RPCs to gate stage=4 (banned) and future unpaid/canceled states. Admin users (profiles.is_admin = true) bypass stage check and always return ''active'' (RD-D3-1). Reads profiles.is_admin directly without using is_admin_user() overload (RD-D1-A). SECURITY DEFINER + SET search_path = '''' (既存 secdef hardening 規約準拠).';
```

- `STABLE` 属性: 同一トランザクション内で同じ uid に対して同じ結果を返す (Postgres optimizer の `STABLE` hint)。
- `SECURITY DEFINER` + `SET search_path = ''`: 既存 SECDEF hardening 規約 (`20260509000004_secdef_hardening_phase_a.sql` 等) 準拠。
- `STABLE` で十分か `IMMUTABLE` か: 同一 transaction 中で `profiles.stage` / `is_admin` が変わる可能性は実運用ではゼロに近いが、安全側に `STABLE` (transaction 内のみキャッシュ、別 transaction では再評価)。
- `profiles.is_admin` column が NULL の場合は `COALESCE(is_admin, false)` で `false` 扱い。
- `is_admin_user(p_uid uuid)` overload を将来追加するかは **Phase 2 の検討課題** (本 plan §10.B に記載)。

#### 検証方法

| 確認項目 | 手順 | 期待結果 |
|---|---|---|
| 関数存在 | staging で `\df public.account_access_state` | 関数定義が見える |
| stage=1 ユーザー | `SELECT public.account_access_state('<stage1_uid>')` | `'active'` |
| stage=4 ユーザー | `SELECT public.account_access_state('<stage4_uid>')` | `'banned'` |
| 存在しない uid | `SELECT public.account_access_state('00000000-0000-0000-0000-000000000000')` | `'unknown'` |
| NULL uid | `SELECT public.account_access_state(NULL)` | `'unauthenticated'` |
| 権限 | anon ロールから `SELECT public.account_access_state(...)` | 拒否 |

#### リスク / rollback

- **リスク 1**: 関数依存により D-2 で POLICY に組み込んだ後、DROP FUNCTION が CASCADE エラーになる。staging で `DROP FUNCTION CASCADE` の挙動を確認する。
- **rollback**: `DROP FUNCTION IF EXISTS public.account_access_state(uuid)` で十分 (D-2 ロールバック後)。

---

### D-2: 書き込み系 RLS に access gate を AND (P1)

#### 背景

§3.1 のとおり `battles` / `decks` / `deck_tunings` / `shares` の INSERT POLICY が `auth.uid() = user_id` のみで stage チェックなし。stage=4 ユーザーが REST 直叩きで書き込み可能。

#### 対象ファイル候補

- `supabase/migrations/2026MMDD00000N_d2_write_rls_access_gate.sql` (D-1 と同一 migration にしてもよい)
- `supabase/rollback/2026MMDD00000N_rollback.sql`

#### 実装方針

[RD-D2] により対象は `battles` / `decks` / `deck_tunings` / `shares` の 4 テーブルのみ (feedback / team_members は対象外)。INSERT/UPDATE POLICY を以下のように更新:

```sql
-- 既存の depth-defense (decks 所有 + format/game_title 一致 + opponent_deck_settings EXISTS + tuning EXISTS) を
-- 完全保持し、末尾に AND public.account_access_state(...) = 'active' を append する。
DROP POLICY IF EXISTS "Users can insert own battles" ON public.battles;
CREATE POLICY "Users can insert own battles"
  ON public.battles FOR INSERT
  WITH CHECK (
    (SELECT auth.uid()) = user_id
    AND EXISTS (
      SELECT 1 FROM public.decks d
      WHERE d.id = battles.my_deck_id
        AND d.user_id = (SELECT auth.uid())
        AND d.format = battles.format
        AND d.game_title = battles.game_title
    )
    AND EXISTS (
      SELECT 1 FROM public.opponent_deck_settings s
      WHERE s.format = battles.format
        AND s.game_title = battles.game_title
    )
    AND (
      battles.tuning_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.deck_tunings t
        WHERE t.id = battles.tuning_id
          AND t.deck_id = battles.my_deck_id
      )
    )
    AND public.account_access_state((SELECT auth.uid())) = 'active'
  );

DROP POLICY IF EXISTS "Users can update own battles" ON public.battles;
CREATE POLICY "Users can update own battles"
  ON public.battles FOR UPDATE
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK (
    (SELECT auth.uid()) = user_id
    AND EXISTS (
      SELECT 1 FROM public.decks d
      WHERE d.id = battles.my_deck_id
        AND d.user_id = (SELECT auth.uid())
        AND d.format = battles.format
        AND d.game_title = battles.game_title
    )
    AND EXISTS (
      SELECT 1 FROM public.opponent_deck_settings s
      WHERE s.format = battles.format
        AND s.game_title = battles.game_title
    )
    AND (
      battles.tuning_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.deck_tunings t
        WHERE t.id = battles.tuning_id
          AND t.deck_id = battles.my_deck_id
      )
    )
    AND public.account_access_state((SELECT auth.uid())) = 'active'
  );

-- decks INSERT/UPDATE も同様に opponent_deck_settings EXISTS を保持して append。
-- deck_tunings は 20260511000004 で SELECT/INSERT/UPDATE/DELETE の 4 本に分割済 (旧 FOR ALL は DROP 済)。
-- Plan D では INSERT / UPDATE の 2 本のみに gate を追加し、SELECT / DELETE は変更しない (RD-D2 + D-2 DELETE/SELECT 非変更方針)。
--   - "Users can insert own deck tunings" → 既存 EXISTS decks 所有 を保持して末尾 AND access_state 追加
--   - "Users can update own deck tunings" → 同上 (USING / WITH CHECK ともに access_state 追加)
--   - "Users can read own deck tunings" → 変更なし (SELECT は ban ユーザーでも閲覧可能)
--   - "Users can delete own deck tunings" → 変更なし (削除は退会フローと衝突しないため許可)
```

- `(SELECT auth.uid())` ラップ: Postgres RLS initplan 最適化 (`20260511000003_rls_auth_init_plan.sql` の既存規約準拠)。
- **既存 depth-defense (decks 所有 / format-game 一致 / opponent_deck_settings / tuning_id EXISTS) を絶対に削除しない**。Plan D は access gate を末尾 AND で **追加** するだけ。
- **DELETE POLICY は変更しない**: ban されたユーザーが自分のデータを削除すること自体は許可する (退会フローと衝突しないため)。
- **SELECT POLICY も変更しない**: ban されたユーザーが自分のデータを **見る** ことは許可 (BAN 画面で過去の戦績を確認する UX のため)。

#### 検証方法

| 確認項目 | 手順 | 期待結果 |
|---|---|---|
| stage=1 ユーザーの INSERT | staging で `INSERT INTO battles ...` (REST/JS 経由) | 成功 |
| stage=4 ユーザーの INSERT | staging で stage=4 のテストユーザーを作って `INSERT INTO battles ...` | **RLS 拒否 (`new row violates row-level security policy`)** |
| stage=4 ユーザーの SELECT | stage=4 で自分の battles を SELECT | 成功 (SELECT POLICY 変更なし) |
| stage=4 ユーザーの DELETE | stage=4 で自分の battles を DELETE | 成功 (DELETE POLICY 変更なし) |

#### リスク / rollback

- **リスク 1**: 既存 stage=4 ユーザーがいない場合、staging で偽陽性のテストが必要。staging で `UPDATE profiles SET stage = 4 WHERE id = '<test_uid>'` で擬似 BAN を作って検証。
- **リスク 2**: production で既存 stage=4 ユーザーがリアルタイムで操作中の場合、適用瞬間から書き込みが拒否される。**意図通り** だが、admin に事前通知する手順を runbook 化。
- **rollback**: 旧 POLICY (`auth.uid() = user_id` のみ) を再 CREATE。

---

### D-3: 書き込み系 RPC / SECDEF 関数の明示チェック (P1)

#### 背景

書き込み系 SECDEF 関数 (`auto_add_opponent_deck` / `recalculate_opponent_decks` / `run_daily_opponent_deck_batch` / `sync_team_membership` / `update_my_display_name` / `sync_my_x_connection` / `clear_my_x_connection`) は **RLS を bypass する SECURITY DEFINER** で動作する。これらの関数内で `account_access_state` チェックが無いと、D-2 で塞いだ stage=4 ユーザーの書き込み経路が残る。

#### 対象ファイル候補

- `supabase/migrations/2026MMDD00000N_d3_rpc_access_gate.sql` (新規、または D-1/D-2 と同一)
- `supabase/rollback/2026MMDD00000N_rollback.sql`

#### 実装方針

**重要**: SECDEF 関数は **どの主体 (subject) が呼ぶか** で gate の書き方が変わる。一律 `auth.uid()` をチェック対象にすると `sync_team_membership` のような service_role 専用関数を壊す。以下を関数別に明示する。

#### グループ A: 本人 (authenticated user) が呼ぶ関数 → `auth.uid()` を gate 対象

対象関数 (signature は実コード確認済):

- `update_my_display_name(p_display_name text)`: 関数冒頭で `IF public.account_access_state(auth.uid()) <> 'active' THEN RAISE EXCEPTION 'account_banned';` を追加。**シグネチャは既存のまま、CREATE OR REPLACE で本体のみ更新**
- `sync_my_x_connection()`: 同上。**既存シグネチャはパラメータなし** (auth.identities からサーバ側で読み取る既存設計、`20260424000001` のコメント「クライアント入力不信」を維持)。シグネチャ変更禁止
- `clear_my_x_connection()`: 同上 (パラメータなし、シグネチャ変更禁止)
- `auto_add_opponent_deck`: trigger 経由で battles INSERT 時に呼ばれるため、battles INSERT POLICY (D-2 で gate 済) で既に防がれる → **明示チェック不要** だが念のため確認

#### グループ B: service_role 専用関数 (authenticated には GRANT されていない) → `p_user_id` を gate 対象

対象関数:

- `sync_team_membership(p_user_id uuid, p_discord_username text, p_guilds jsonb, p_game_title text DEFAULT 'dm')` (`20260426005408_secdef_search_path.sql:269-314`、`GRANT EXECUTE ... TO service_role` のみ): **`auth.uid()` を使うと壊れる**。discord callback (`src/app/api/discord/callback/route.ts:123`) と discord refresh-guilds (`src/app/api/discord/refresh-guilds/route.ts:123`) から **service_role + 明示的 `p_user_id` 指定**で呼ばれる経路だから (実コードは `p_discord_username` / `p_guilds` / `p_game_title` を渡している)。関数冒頭で `IF public.account_access_state(p_user_id) <> 'active' THEN RAISE EXCEPTION 'account_banned';` を追加 (p_user_id を gate 対象にする)。**ただし [RD-D3-1] により admin は active 相当扱いなので、`account_access_state` 関数側の admin 例外で正しく動く**

#### グループ C-1: cron 専用関数 (service_role 経路、`auth.uid()` 不在) → **access gate は入れない**

対象関数:

- `run_daily_opponent_deck_batch()`: **pg_cron / Supabase scheduled job から service_role 権限で呼ばれる cron 専用関数**。実行コンテキストに認証済みユーザーは無く、`auth.uid()` は **NULL** を返す。`account_access_state(auth.uid())` を入れると `'unauthenticated'` で必ず弾かれ、**cron が止まる**。**access gate を一切入れない**。stage=4 ユーザーへの直接的書き込み経路ではない (関数内部で `WHERE p.stage IN (1, 2, 3)` などで対象ユーザーをフィルタしている既存ロジックを維持) ため、Plan D で touch しない。

**重要原則**: 「念のためガード」を入れない。cron 関数に `account_access_state(auth.uid())` を追加すると `auth.uid()` が NULL になる service_role 経路でガードが偽陽性発火して関数全体が壊れる。**cron / service_role 経路の関数は本 plan の access gate 対象外** と明確に分離する。

#### グループ C-2: authenticated admin 経路 → 既存 admin check + admin 例外 [RD-D3-1] で素通り

対象関数:

- `recalculate_opponent_decks(...)`: admin が UI / curl から **Bearer 付き authenticated 経路で呼ぶ** 関数。`auth.uid()` は admin user の uid を返す。既存実装内に `IF NOT public.is_admin_user() THEN RAISE EXCEPTION 'forbidden';` のような admin gate がある (`20260426005408_secdef_search_path.sql:235` 等で確認可能、実装チャットで grep 確認)。これに加えて access state チェックを入れる場合、`account_access_state(auth.uid()) <> 'active'` だけで OK ([RD-D3-1] により admin は active が返るので素通る、誤 stage=4 admin でも復旧経路を維持)。
- **実装方針**: 既存 admin check の直後に `IF public.account_access_state(auth.uid()) <> 'active' THEN RAISE EXCEPTION 'account_banned'; END IF;` を追加。admin 自身が stage=4 になっても `account_access_state` の admin 例外で `'active'` が返るため、ガードは素通る。

#### グループ C 全体の留意点

- グループ C-1 (cron) と C-2 (authenticated admin) を **必ず分離して扱う**。一律のガード式は危険。
- 実装チャットで `grep -rln "SECURITY DEFINER" supabase/migrations/` を網羅し、各関数を **「呼び出し主体は誰か (authenticated / service_role / cron)」** で分類してからガード追加方針を決める。

#### 実装パターン (グループ A 代表例):

```sql
CREATE OR REPLACE FUNCTION public.update_my_display_name(p_display_name text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth_required';
  END IF;
  -- ★ D-3 (グループ A) 追加: 本人 access state チェック
  -- account_access_state 内で admin 例外を担保するため、ここでは単純比較で OK
  IF public.account_access_state(v_uid) <> 'active' THEN
    RAISE EXCEPTION 'account_banned';
  END IF;
  -- 以下既存ロジック (UPDATE public.profiles 等)
  ...
END;
$$;
```

#### 実装パターン (グループ B `sync_team_membership` 代表例):

```sql
CREATE OR REPLACE FUNCTION public.sync_team_membership(
  p_user_id uuid,
  p_discord_username text,
  p_guilds jsonb,
  p_game_title text DEFAULT 'dm'
)
RETURNS void  -- 既存戻り値型を維持
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'user_id_required';
  END IF;
  -- ★ D-3 (グループ B) 追加: p_user_id を gate 対象にする
  -- service_role 経路 (discord callback / refresh-guilds) なので auth.uid() は使えない
  IF public.account_access_state(p_user_id) <> 'active' THEN
    RAISE EXCEPTION 'account_banned';
  END IF;
  -- 以下既存ロジック (team_members への upsert 等)
  ...
END;
$$;
```

#### 検証方法

| 確認項目 | 手順 | 期待結果 |
|---|---|---|
| stage=1 で `update_my_display_name` | staging で `SELECT public.update_my_display_name('test')` | 成功 |
| stage=4 で `update_my_display_name` | staging で stage=4 ユーザーで同上 | `account_banned` で reject |
| 全 SECDEF 関数の grep | `grep -rln "SECURITY DEFINER" supabase/migrations/` で網羅性確認 | Plan D で扱う対象を洗い出す |

#### リスク / rollback

- **リスク 1**: 対象関数の網羅漏れ。`grep -l "SECURITY DEFINER"` で機械的に洗い出し、各関数の **呼び出し主体 (authenticated / service_role / cron)** を実装チャットで分類してからガード追加方針を決める。
- **リスク 2**: cron 関数 (`run_daily_opponent_deck_batch` 等) に「念のため」`account_access_state(auth.uid())` ガードを入れると `auth.uid()` が NULL の service_role 経路で偽陽性発火し **cron が止まる**。グループ C-1 cron 専用関数には絶対にガードを入れない。
- **リスク 3**: admin 操作 (`recalculate_opponent_decks` 等) を admin 自身が stage=4 になった時 (理論上ありえないが) は、[RD-D3-1] により `account_access_state` が `'active'` を返すため素通る。グループ C-2 では既存 admin check の直後に `account_access_state(auth.uid()) <> 'active'` の 1 行を追加するだけで OK。
- **rollback**: 旧関数定義に戻す。

---

### D-4: 重要 API route で gate チェック (P1)

#### 背景

`/api/account/delete` / `/api/discord/*` / `/api/admin/*` (admin 操作) などの重要 API route は Bearer JWT 検証 (`require-bearer.ts`) は通るが、access state チェックは無い。加えて、現状 **手動 Bearer 検証** で `require-bearer.ts` を経由していない route もある (実コード grep で確認: `/api/discord/start`, `/api/discord/refresh-guilds`, `/api/admin/limitless-sync` 等)。これらは `require-bearer` 経由に統一するか、同等の `account_access_state` チェックを inline で入れる必要がある。

#### 対象ファイル候補と現状の認証経路

| Route | 現状 | Plan D 後 |
|---|---|---|
| `src/lib/auth/require-bearer.ts` | `requireAdmin?: boolean` のみ | `requireActiveUser?: boolean` (デフォルト `true`) を追加 |
| `src/app/api/account/delete/route.ts` | (要確認) | `requireBearer` 経由 + **`requireActiveUser: false`** (RD-D4-1 により stage=4 でも自己削除許可) |
| `src/app/api/discord/start/route.ts` | **手動 Bearer 検証** (`require-bearer` 未使用) | `requireBearer` 経由に統一 + `requireActiveUser: true` |
| `src/app/api/discord/refresh-guilds/route.ts` | **手動 Bearer 検証** | `requireBearer` 経由に統一 + `requireActiveUser: true` |
| `src/app/api/discord/callback/route.ts` | **Bearer なし** (`stateRow.user_id` で本人確認、内部で `supabaseAdmin.rpc('sync_team_membership', { p_user_id })` を service_role で呼ぶ) | **inline で `stateRow.user_id` に対して `account_access_state(userId)` を明示確認** してから token upsert / `sync_team_membership` へ進める。`requireBearer` は使えない (Bearer 自体がないため)。stage=4 / banned なら 403 で打ち切り |
| `src/app/api/admin/limitless-sync/route.ts` | **手動 Bearer 検証** | `requireBearer` 経由 + `requireAdmin: true` + `requireActiveUser: true`。ただし [RD-D3-1] により admin は active 相当扱いされるため stage=4 admin でも素通る |
| `src/app/api/admin/*/route.ts` (その他) | (要 grep 確認) | `requireBearer` 経由 + admin route は `requireAdmin: true` + `requireActiveUser: true` (admin 例外で素通る) |
| `src/app/api/internal/*/route.ts` | `INTERNAL_API_KEY` 検証のみで user 認証なし | gate 対象外 (server-to-server) |

#### 実装方針

`require-bearer.ts` を拡張して `requireActiveUser` option を追加:

```ts
// 擬似コード
export type BearerAuthResult =
  | { ok: true; userId: string; supabaseAdmin: SupabaseClient<Database> }
  | { ok: false; response: NextResponse };

export async function requireBearer(
  request: NextRequest,
  options: { requireAdmin?: boolean; requireActiveUser?: boolean } = {},
): Promise<BearerAuthResult> {
  // ... 既存の JWT 検証
  // ★ D-4 追加 (デフォルトで active 要求、明示的 opt-out のみ false を許す)
  if (options.requireActiveUser ?? true) {
    const { data } = await supabaseAdmin.rpc('account_access_state', { p_uid: userId });
    // [RD-D3-1] admin は account_access_state 内で 'active' が返るため特別扱い不要
    if (data !== 'active') {
      return { ok: false, response: NextResponse.json({ error: 'Account not active', reason: data }, { status: 403 }) };
    }
  }
  // ...
}
```

`/api/discord/callback` (Bearer なし) では inline check が必要:

```ts
// 擬似コード in src/app/api/discord/callback/route.ts
const userId = stateRow.user_id;
const { data: accessState } = await supabaseAdmin.rpc('account_access_state', { p_uid: userId });
if (accessState !== 'active') {
  return NextResponse.json({ error: 'Account not active', reason: accessState }, { status: 403 });
}
// 以下、token upsert / sync_team_membership 呼び出しに進む
```

**手動 Bearer 検証の route を `requireBearer` に統一する作業 (D-4 一部)**:

- `/api/discord/start` / `/api/discord/refresh-guilds` / `/api/admin/limitless-sync` の手動検証ロジックを `requireBearer({ requireAdmin?, requireActiveUser })` 呼び出しに置き換える
- これにより access gate のチェック漏れ防止 + 将来の `requireActiveUser` 拡張 (Stripe 等) が単一箇所で完結する

**[RD-D4-1] 確定**: `/api/account/delete` は **`requireActiveUser: false` で個別 opt-out**。退会の自由を保証する。デフォルトは `true` のままで、`/api/account/delete` でのみ明示的に opt-out 指定する。

#### 検証方法

| 確認項目 | 手順 | 期待結果 |
|---|---|---|
| stage=1 で `/api/admin/limitless-sync` (admin) | curl で Bearer 付き POST | 成功 (admin かつ active) |
| **stage=4 admin** で `/api/admin/limitless-sync` | 同上 | **成功 (admin 例外 [RD-D3-1] により active 相当扱い)** |
| stage=4 一般ユーザーで `/api/discord/start` | 同上 | **403 (account_banned)** |
| stage=4 一般ユーザーで `/api/discord/refresh-guilds` | 同上 | **403 (account_banned)** |
| stage=4 一般ユーザーで `/api/discord/callback` (OAuth state を持っている前提) | callback URL に redirect | **403 (account_banned)、token upsert / sync_team_membership 呼び出しに進まない** |
| stage=4 ユーザーで `/api/account/delete` | 同上 | **成功 ([RD-D4-1] により退会許可)** |
| stage=1 で `/api/account/delete` | 同上 | 成功 (active、通常退会) |

#### リスク / rollback

- **リスク 1**: 既存 admin が誤って stage=4 になっても、[RD-D3-1] admin 例外で admin 操作は止まらない (検証表で確認)。
- **リスク 2**: 手動 Bearer 検証 route を `requireBearer` に置換する際、既存の error response 形式や Bearer 抽出ロジックに差異があると regression する → dev preview で全 admin / discord route の動作確認必須。
- **リスク 3**: `/api/discord/callback` の inline check で `stateRow.user_id` を読む前に access_state を確認するため、`stateRow` が NULL のケース (state 期限切れ等) の既存エラーハンドリングと衝突しないことを確認。
- **rollback**: `requireActiveUser` フラグを `false` に戻す (デフォルト挙動を元に戻す) + `/api/discord/callback` の inline check 削除。

---

### D-5: `if (!user)` 整理 + `AuthExpiredError` + `AuthGuard` 連動 (P1)

#### 背景

統合 audit §4.8: 「`supabase.auth.getUser()` 呼び出しが多数あり、未認証時に空配列・null・throw が混在する。`if (!user) return []` により、JWT 失効と『本当にデータゼロ』が UI で区別不能になる」。

§3.2 確認: `lib/actions/` の `if (!user)` パターンが **37 箇所**、`return []` / `return null` / `return false` / `throw` が混在。

#### 対象ファイル候補

- `src/lib/actions/**` 全 37 箇所 (用途別 3 分類で整理)
- 新規 `src/lib/errors/auth-expired-error.ts` (`AuthExpiredError` クラス)
- 新規 `src/components/providers/AuthGuard.tsx` (または既存 `BanGuard` 内に統合)
- 既存 `src/app/error.tsx` / `src/app/global-error.tsx` (Plan A) との連動

#### 実装方針 (用途別 3 分類)

各 `if (!user)` 箇所を以下に分類して挙動を統一:

| カテゴリ | 例 | Plan D 後の挙動 |
|---|---|---|
| **UI 表示用 (read)** | `getDecks()`, `getBattles()`, `getStatsRange()`, `getTeamMembers()` | `throw new AuthExpiredError("not_authenticated")` で投げる。`AuthGuard` (新規) が catch して `/auth?next=<current_path>` redirect。**戦績ゼロ表示にしない** |
| **認可 / 重要操作** | `createDeck()`, `recordBattle()`, `createShare()`, `getUserStage()` 等 | 同上、`throw AuthExpiredError`。client 側でも catch → AuthGuard で redirect。DB 側は D-2/D-3 で別途強制 |
| **Optional state** | `getMyXConnectionStatus()`, `hasGoogleIdentity()` などの「あれば返す、なければ null/false でも UI 上問題ない」もの | **`if (!user) return null/false`** をそのまま維持 (現状の意図通り)。AuthGuard で redirect は **しない** |

**確定 ([RD-D5-1])**: 新規 `<AuthGuard>` provider を採用 (案 A)。`app/layout.tsx` で BanGuard と並列に配置し、以下の **三重経路** で `AuthExpiredError` を確実に捕捉して `router.push('/auth?next=...')` する。`next` は **Plan A の open redirect helper (`isSafeInternalPath` / `resolveAuthRedirectTarget`) で検証** し、外部 URL / `/auth` / `/api` 等の危険な遷移先は拒否。

#### AuthGuard 三重経路 ([RD-D5-2] で確定、`unhandledrejection` 単独では不十分)

`unhandledrejection` だけでは不足する理由: 実コードに `try / catch (e) { setError(...) }` や `.catch(() => null)` などで promise rejection を **握りつぶす箇所が多数存在** する。これらでは `unhandledrejection` イベントが発火しないため、AuthExpiredError が AuthGuard まで届かない。以下 3 経路を併用する。

- **経路 1 (明示 event)**: `src/lib/errors/auth-expired-error.ts` 内に `handleAuthExpiredError(error: unknown): boolean` helper を export。`error instanceof AuthExpiredError` なら `window.dispatchEvent(new CustomEvent("tierlog:auth-expired", { detail: { reason } }))` を発火して `true` を返す。**握りつぶし箇所 (`catch` 内) では `if (handleAuthExpiredError(e)) return;` を 1 行追加するだけで AuthGuard まで届く**。`if (!user)` 整理時のコード変更箇所と同じファイルで対応できるので導入コスト低。
- **経路 2 (unhandledrejection fallback)**: 既存設計通り `window.addEventListener('unhandledrejection', ...)` でも `AuthExpiredError` を catch。握りつぶしを忘れた箇所の safety net として機能。
- **経路 3 (CustomEvent listener)**: AuthGuard component 内で `window.addEventListener('tierlog:auth-expired', ...)` を listen し、経路 1 / 2 のいずれから来ても `router.push('/auth?next=...')` を実行。同一 redirect target への二重発火を避けるため、`isRedirecting` ref で de-duplication する。

#### `handleAuthExpiredError` helper の擬似コード:

```ts
// src/lib/errors/auth-expired-error.ts
export class AuthExpiredError extends Error {
  readonly reason: string;
  constructor(reason: string) {
    super(`auth_expired: ${reason}`);
    this.name = 'AuthExpiredError';
    this.reason = reason;
  }
}

/**
 * catch ブロック内で 1 行呼ぶだけで AuthGuard まで届ける。
 * 戻り値: AuthExpiredError なら true、それ以外なら false (呼び出し側は通常 error 処理を継続)
 */
export function handleAuthExpiredError(error: unknown): boolean {
  if (typeof window === 'undefined') return false;  // SSR では noop
  if (error instanceof AuthExpiredError) {
    window.dispatchEvent(new CustomEvent('tierlog:auth-expired', { detail: { reason: error.reason } }));
    return true;
  }
  return false;
}
```

#### 握りつぶし箇所での使い方:

```ts
// 例: getStatsRange() を呼ぶ component
try {
  const stats = await getStatsRange(...);
  setStats(stats);
} catch (e) {
  if (handleAuthExpiredError(e)) return;  // ← 1 行追加
  setError(e);  // 既存のエラー表示処理
}
```

- 37 箇所すべてを「UI 表示用 / 認可重要操作 / optional state」に分類する作業は実装チャットで個別判定が必要。本 plan では **分類のガイドライン** と **代表例** までを定義、個別判定は実装時。
- AuthGuard は **client component として最小責務**。DB access / ban 判定 / stage 判定は持たせない。これらは BanGuard / DB レイヤで処理する。
- 経路 1 (`handleAuthExpiredError`) を **catch ブロックがある箇所では原則必須**、経路 2 (`unhandledrejection`) は safety net、経路 3 (`CustomEvent` listener) が AuthGuard の主入口、と位置付ける。

#### 検証方法

| 確認項目 | 手順 | 期待結果 |
|---|---|---|
| JWT 失効 → UI 表示用 action | dev preview で cookie を強制削除 → `/dm/stats` 訪問 | 戦績ゼロ表示にならず、`/auth?next=/dm/stats` に redirect |
| JWT 失効 → 重要操作 | 同上で `/dm/battle` から戦績登録 → AuthExpiredError throw | client がエラーキャッチ → `/auth` redirect |
| JWT 失効 → optional state | 同上で `getMyXConnectionStatus()` 呼び出し | `null` 返却、UI 上は X 連携なし扱い (現状維持) |
| Regression 確認 | 既存 dev preview の全主要画面で regression なし | Plan A / B / C で動いていたフローが壊れない |

#### リスク / rollback

- **リスク 1**: 37 箇所の分類間違いで「UI 表示用 → throw」を誤って optional state に適用すると、UI が AuthGuard で redirect されてしまう。実装チャットで個別レビュー + dev preview 検証必須。
- **リスク 2**: `AuthGuard` が Plan A `BanGuard` の動作と衝突 (`/auth` redirect の二重発火等)。**Plan A `BanGuard` の `/auth` redirect ロジック (`window.location.href = "/auth"`) と統一する**: AuthGuard は `router.push('/auth?next=...')` で next param 付き、BanGuard は anonymous → `window.location.href = '/auth'` (next なし)。両者の優先順位を D-7 で明文化。
- **rollback**: `if (!user) return []` パターンに戻す (実装チャットで `git revert` 容易)。

---

### D-6: middleware session refresh の正式化 (P2)

#### 背景

Plan A 完了時点で `src/middleware.ts` は rate limit + legacy redirect の最小修正にとどまっており、`@supabase/ssr` の `createServerClient` を import しているが session refresh は **実質動作していない** (Plan A 完了報告 §6.2.7 参照)。

統合 audit §4.12: 「middleware session refresh を実質化、または不要なら削除」。Plan A では「不要なら削除」を Plan D に persision。

#### 対象ファイル候補

- `src/middleware.ts`

#### 実装方針

**確定 ([RD-D6-1])**: 不要として最小実装を維持 (案 A 採用)。理由: client-side supabase-js の自動 refresh で対応可能、middleware で refresh すると Cookie 同期・legacy redirect・rate limit・auth callback 周りに影響が出やすく blast radius が大きい。

**plan 内容**:
- `src/middleware.ts` の `createServerClient` import が残っている場合、**コメントで「Plan D ([RD-D6-1]) で不要判定」を明記**。dead code として削除はしない (将来再評価時の参考のため import 形だけ残す。または完全削除しても良いが、その場合は §10.B の Phase 2 再評価時に再 import が必要)。
- 将来 SSR で認証状態に依存するページが増えた時に再評価する方針を §10.B に残す。

#### 検証方法

- middleware simplification 後、Plan A の rate limit / legacy redirect が引き続き動作することを確認。
- dev preview で長時間アイドル後、client-side `supabase-js` の自動 refresh で JWT が再発行されることを確認 (middleware 経由ではなく client 単独で動く)。

#### リスク / rollback

- **リスク 1**: 将来 SSR ページが増えた時に session refresh が必要になる可能性 → §10.B の Phase 2 再評価項目で対応。
- **rollback**: 不要 (本 plan ではコード変更が import コメント程度のため)。

---

### D-7: Plan A BanGuard + Plan C `profiles.stage = MAX(score)` との接続性明文化 (P1)

#### 背景

Plan A BanGuard の retry + fail-open は意図通り維持されるが、Plan D で DB 側に access gate を入れることで以下の挙動になる:

- Supabase 一時障害 → BanGuard fail-open で UI 通常表示
- ただし stage=4 ユーザーが書き込みを試みると → **DB 側 (D-2/D-3) で拒否**
- → fail-open でも不正利用にならない (UI 側 BAN 表示なしで通常画面が見えても、DB 書き込みが止まる)

加えて Plan C で `_run_quality_scoring_internal` が `profiles.stage = MAX(score)` で自動降格する経路ができたため、quality scoring 実行後に stage=4 になったユーザーは **次の書き込みから即拒否される**。

#### 対象ファイル候補

- 本 plan §6 D-7 (本セクション、文書のみ)
- 必要に応じて `docs/runbooks/access_gate_operation.md` (新規、運用 runbook)

#### 実装方針

文書整理のみ、コード変更なし:

1. Plan A BanGuard fail-open との接続を明文化:
   - DB 側 D-2/D-3 で書き込み拒否されるため、UI 側 fail-open は不正利用に繋がらない
   - BanGuard が Supabase 一時障害で BAN 判定失敗した場合でも、ユーザーは「BAN 画面が出ない」だけで実害なし

2. Plan C `profiles.stage = MAX(score)` との接続を明文化:
   - quality scoring 実行 (daily cron) で stage=4 になったユーザーは即 access gate 対象
   - 逆に MAX(score) で stage=1〜3 に復帰したユーザーは即書き込み再開可能
   - admin が手動で stage を変更した場合も同様

3. 既存 admin UI (`admin/users/[userId]`) で stage 変更操作と access gate の関係を運用 runbook に明記。

#### 検証方法

- 文書レビュー (実装チャット + Codex)
- 動作検証は D-2 / D-3 / D-5 の検証で済む

#### リスク / rollback

- リスクなし (文書のみ)。

---

## 7. Plan A / Plan B / Plan C との非破壊確認

| Plan の機能 | Plan D での影響 |
|---|---|
| A-1 `shares.image_url` 二段防御 | ✅ 影響なし。Plan D は `shares` INSERT POLICY に access gate を **追加** するだけで、`is_safe_share_image_url` trigger は touch しない |
| A-2 legacy URL / `<HomeLink>` / loading / global-error | ✅ 影響なし |
| A-3 BanGuard retry + fail-open + RD-B8 | ✅ 維持。D-7 で接続性明文化、構造変更なし |
| A-4 共有 / 未ログイン導線 `game/next` + open redirect | ✅ 影響なし |
| B-1 Sentry scrubber | ✅ 影響なし。D-5 で `AuthExpiredError` を Sentry に流す場合は scrubber 経由で sanitize される |
| B-2 OG ルート | ✅ 影響なし |
| B-3 noindex header | ✅ 影響なし |
| B-4 公開ランディング + sitemap + B-4-e BanGuard | ✅ 影響なし |
| B-5 Observability runbook | ✅ 影響なし。D-7 / D-1 関連の運用 runbook を追加する場合は B-5 と同じ場所 (`docs/runbooks/`) に置く |
| B-6 法務 gap analysis | ✅ 影響なし |
| C-1 `get_team_member_summaries` game scope | ✅ 影響なし。team 集計に access gate は不要 (SELECT 系) |
| C-2 detection 関数 game scope | ✅ 影響なし。detection 関数は `WHERE p.stage IN (1, 2, 3)` で既に stage=4 を除外している |
| C-3 `_run_detection_scan_internal` game × rule | ✅ 影響なし |
| C-4 `_calculate_quality_score_internal` game scope + MAX(score) | ✅ **接続あり**。MAX(score) で stage=4 になったユーザーは Plan D の access gate で書き込み拒否される (D-7 で明文化) |
| C-5 `quality_score_snapshots` 複合キー | ✅ 影響なし |
| C-6 TRUNCATE 手動 runbook | ✅ 影響なし (Plan D スコープ外) |
| **既存 production 24 件の detection_alerts 扱い判断** | ✅ Plan D スコープ外 (ユーザー指示) |

---

## 8. 統合検証 (Plan D 全体)

| カテゴリ | 検証内容 |
|---|---|
| Access gate (DB) | stage=4 ユーザーが REST 直叩きで `battles.insert` / `decks.insert` / `deck_tunings.insert` / `shares.insert` を試みて拒否される |
| Access gate (SECDEF RPC) | stage=4 ユーザーが `update_my_display_name` / `sync_my_x_connection` 等を呼んで `account_banned` で reject される |
| Access gate (API route) | stage=4 ユーザーが `/api/discord/*` / `/api/admin/*` を Bearer 付きで叩いて 403 |
| Auth expiry (UI 表示用) | JWT 失効後に `/dm/stats` 訪問 → 戦績ゼロ表示にならず `/auth?next=...` redirect |
| Auth expiry (重要操作) | JWT 失効後に戦績登録 → AuthExpiredError → `/auth` redirect |
| Auth expiry (optional state) | JWT 失効後に X 連携状態取得 → null 返却で現状維持 |
| Plan A BanGuard との整合 | Supabase 一時障害シナリオで BanGuard fail-open が通常 UI 表示するが、書き込みは DB 側で拒否される |
| Plan C stage 自動更新との整合 | `_run_quality_scoring_internal` で stage=4 に降格したユーザーが即書き込み拒否される |
| 既存機能の非破壊 | Plan A / B / C 完了時点の全機能が引き続き動作 |

---

## 9. 実装順序 (推奨)

1. **D-1** (`account_access_state` 関数追加) (0.5 日)
2. **D-2** (書き込み系 RLS 更新) (0.5〜1 日、対象テーブル数次第)
3. **D-3** (書き込み系 SECDEF 関数の明示チェック) (0.5〜1 日、対象関数数次第。D-1/D-2 と同一 migration にしてもよい)
4. **D-4** (API route で `require-bearer` 拡張 + 各 route に `requireActiveUser` フラグ追加) (0.5 日)
5. **D-5** (`if (!user)` 37 箇所整理 + `AuthExpiredError` + `AuthGuard`) (2〜3 日、37 箇所の個別判定 + UI 連動が大きい)
6. **D-7** (Plan A / Plan C との接続性明文化) (0.25 日、文書のみ)
7. **D-6** (middleware session refresh、[RD-D6-1] により案 A = 不要削除確定で最小コメント追加のみ) (0.25 日)

**並行実行**: D-1 / D-2 / D-3 は SQL レイヤで連動するため同一 migration ファイルに集約推奨。D-4 / D-5 はコードレイヤで独立。D-6 / D-7 は最後。

**合計工数目安**: 約 4〜6 日 (D-5 が支配的)。

---

## 10. 未解決質問

### 10.A 実装着手前に解くべき質問

**該当なし**。当初の 7 項目 + Codex 再レビューで追加された D-1 admin 例外実装方式 / D-5 AuthGuard 経路網羅性をすべて Resolved Decisions section ([RD-D1] / [RD-D1-A] / [RD-D2] / [RD-D3-1] / [RD-D4-1] / [RD-D5-1] / [RD-D5-2] / [RD-D6-1] / [RD-D7-1]) で確定済み。実装チャットはそちらを参照すること。

### 10.B 後回しでよい質問 (Phase 2 / Phase 3 で扱う)

1. `getUser()` 呼び出し 41 箇所そのものの RTT 削減 / 集約 RPC 化 (Plan E、本 plan D-5 の分類対象である `if (!user)` 37 箇所とは別指標で、getUser() を呼んで if(!user) チェックを持たない箇所も含む)
2. `profiles.stage` の game 別分離 (Plan C §10.B、Phase 2)
3. Stripe webhook → `account_access_state` 拡張 (Phase 3): `'unpaid'` / `'canceled'` / `'past_due'` の追加
4. consent UI / ads.txt / 特商法ページ (Phase 3 Legal plan)
5. 退会フローの Stripe 顧客削除連携 (Phase 3)
6. middleware session refresh の長期方針 (Plan D で案 A 採用後、必要が出たら再評価)
7. account_access_state の **読み込み系 RLS** への適用 (本 plan では SELECT を変更しない方針、見る権利は維持。Phase 3 で課金停止時に過去データ閲覧をどう扱うか別途設計)
8. `is_admin_user(p_uid uuid)` overload の追加 ([RD-D1-A] で Phase 2 送り確定済)。`account_access_state` 内で `profiles.is_admin` を直接 SELECT する形が本 plan の実装。将来 admin 判定を別関数で共有する用途が増えたら overload 化を検討

---

## 11. ローカル検証コマンド (Plan D 統合)

```bash
# 静的検証
npm run lint
npx tsc --noEmit
npm test -- --run

# 関数定義の grep
grep -rn "FUNCTION public.account_access_state\|is_active_user" supabase/migrations/

# 書き込み系 RLS POLICY の grep
git grep -n "CREATE POLICY.*insert own\|WITH CHECK" supabase/migrations/ | grep -v archive

# SECURITY DEFINER 関数の全件 grep (D-3 網羅性確認)
grep -rln "SECURITY DEFINER" supabase/migrations/ | head -20

# if (!user) パターンの全件確認 (D-5)
grep -rn "if (!user)" src/lib/actions/ | wc -l
grep -rn "if (!user)" src/lib/actions/

# Bearer + access state の require-bearer 拡張 (D-4)
grep -n "requireBearer\|requireActiveUser" src/lib/auth/require-bearer.ts src/app/api/

# Plan A BanGuard との整合 (D-7、touch しないことを git diff で確認)
git diff src/components/providers/BanGuard.tsx | head -20  # should be empty after Plan D
```

---

## 12. Codex にレビューさせるべき観点

1. **[RD-D1] account_access_state(uid) returns text** の妥当性 (将来 Stripe 拡張時の互換性、reserved state の命名)
2. **[RD-D1-A] admin 例外実装方式 = `profiles.is_admin` 直接 SELECT** の妥当性 (`is_admin_user(p_uid uuid)` overload は Phase 2 候補に分離)
3. **D-2 SELECT POLICY を変更しない判断** (ban ユーザーが自分のデータを見られる UX) の妥当性
4. **[RD-D3-1] admin 例外運用** の妥当性 (admin が誤 stage=4 でも admin 操作素通り、復旧経路維持)
5. **[RD-D4-1] `/api/account/delete` の access gate opt-out** の妥当性 (退会の自由保証)
6. **D-3 グループ分離 (A: auth.uid() / B: service_role + p_user_id / C-1: cron gate なし / C-2: authenticated admin)** が `sync_team_membership` の service_role 専用挙動・`run_daily_opponent_deck_batch` の cron 専用挙動を壊さないこと
7. **D-4 手動 Bearer 検証 route を `requireBearer` に統一する作業** が既存 error response / Bearer 抽出ロジックと衝突しないこと
8. **D-4 `/api/discord/callback` の inline `account_access_state(stateRow.user_id)` check** の妥当性 (Bearer なし経路の唯一の gate)
9. **[RD-D5-1] AuthGuard と Plan A BanGuard の優先順位** (両者が同時に `/auth` redirect を発火しないか、open redirect helper との整合)
10. **[RD-D5-2] AuthGuard 三重経路** の妥当性 (`handleAuthExpiredError` helper + CustomEvent + `unhandledrejection` の三重経路で握りつぶし箇所もカバーできるか、de-duplication が機能するか)
11. **D-5 37 箇所の個別判定** + catch ブロック内 `handleAuthExpiredError` 挿入箇所の網羅性 (実装チャットでの作業手順 / Codex がレビュー可能か)
12. **[RD-D6-1] middleware session refresh 不要削除** の妥当性 (Phase 2 で SSR ページ増加時の再評価条件)
13. **D-7 Plan C stage 自動更新との接続性**: `_run_quality_scoring_internal` 実行直後に stage=4 になったユーザーの書き込みが即時拒否される (transaction 整合性)
14. **Plan A / Plan B / Plan C 非破壊性**: 完了済機能を touch しないこと
15. **RLS / SECURITY DEFINER / search_path**: `account_access_state` / グループ B `sync_team_membership` / グループ C-2 `recalculate_opponent_decks` が既存 SECDEF hardening 規約準拠
16. **staging / production migration 順序**: D-1 関数追加 → D-2 RLS の同一 migration / 別 migration の判断 + cron 関数への gate 非追加方針確認
17. **既存 stage=4 ユーザーへの影響**: production 適用時の即時拒否の運用ガイド (admin 通知手順含む)、deck_tunings の 4 本分割 POLICY を INSERT/UPDATE のみ書き換える整合性

---

## 13. 想定タイムライン (参考)

| サブタスク | 実装 + smoke | staging 適用 + dev preview 検証 | production 反映 |
|---|---|---|---|
| D-1 (account_access_state) | 0.5 日 | 0.25 日 | 0.25 日 |
| D-2 (書き込み RLS) | 0.5〜1 日 | 0.5 日 | 0.5 日 |
| D-3 (SECDEF 関数) | 0.5〜1 日 | 0.5 日 | 0.5 日 |
| D-4 (API route) | 0.5 日 | 0.5 日 | 0.5 日 |
| D-5 (if !user 37 箇所) | 2〜3 日 | 0.5 日 | 0.5 日 |
| D-6 (middleware、案 A) | 0.25 日 | — | — |
| D-7 (文書整理) | 0.25 日 | — | — |
| 合計 | 約 4.5〜6.5 日 | 約 2.25 日 | 約 2.25 日 |

Codex レビュー / plan-critic 反復を含めると **2 週間程度** が現実的なバッファ。

---

## 14. レビュー / 反映フロー

1. 本 plan ファイル作成 (完了時点)
2. `/review-plan-loop docs/plans/2026-05-28_plan_d_access_gate_auth_expiry.md` で plan-critic にレビューさせ、指摘を反映 → GO 判定まで反復
3. ユーザーが Codex に本 plan を渡してレビュー → Codex 指摘を Claude Code 側で反映 → 再度 plan-critic で差分レビュー (Plan A / B / C と同じパターン)
4. ユーザー承認後、別チャットで実装着手 (本 plan 作成チャットでは実装に入らない)
5. 実装後の検証 (Plan D 全体 §8) → user 承認 → production 反映

---

## 15. 補足

- 本 plan は統合 audit §4.2 + §4.8 + §5.3 を実装可能な単位に整理したもの。
- Plan A / B / C 完了報告と整合しており、Plan A / B / C が touch した領域には Plan D で再度触らない。
- Plan C で導入した `profiles.stage = MAX(score)` の自動降格経路と本 plan の access gate が組み合わさることで、品質スコア低下時の即時書き込み停止が実現する。
- Phase 3 Stripe 導入時に `account_access_state` を `'unpaid'` / `'canceled'` 等で拡張する設計余地を確保。
- Plan E (Phase 2) で `getUser()` RTT 削減 / 集約 RPC 化を別途扱う。本 plan ではあくまで「失敗時挙動の整理」までで、最適化はスコープ外。

---

## Resolved Decisions

plan-critic 反復 + AskUserQuestion で確定した判断項目。実装チャットはこの section を **最優先** で参照すること。

- **[RD-D1] D-1 戻り値型** → `account_access_state(uid) returns text` (案 B) を採用。
  - 理由: Plan D は ban だけでなく Access Gate の **土台** なので将来 `'suspended'` / `'unpaid'` / `'canceled'` を追加できる形にする。POLICY 側は `account_access_state(auth.uid()) = 'active'` で固定し、Stripe / billing 拡張時は関数内部のみ変更すれば RLS 全体の書き換えを最小化できる。
  - 現時点では `stage=4` を `'banned'`、それ以外を `'active'` として扱い、`'suspended'` / `'unpaid'` / `'canceled'` は将来の **reserved state** として plan / 関数 COMMENT に明記する。
- **[RD-D2] D-2 RLS access gate 対象テーブル** → `battles` / `decks` / `deck_tunings` / `shares` の 4 テーブルのみ。
  - `feedback` は **対象外**。理由: BAN への不服申立て・問い合わせ経路として残す。誤 BAN 時の回復導線がアプリ内から消えるのを避ける。
  - `team_members` も **対象外**。理由: 現状 team_actions / RPC 経由が中心で直接書き込み経路が薄いため、Plan D では含めない。
  - 将来 abuse が見えたら feedback 側に rate limit / admin moderation を追加する方針。
- **[RD-D3-1] D-3 / D-4 admin 例外** → admin は stage チェックから **除外**。
  - 理由: admin = 信頼済み主体。誤 stage=4 時に管理画面からの復旧経路を残す。別 admin が居ない場合 service_role 直操作が必要になる運用リスクを回避。
  - 実装: `is_admin_user(uid)` が true の場合は `account_access_state(uid)` 関数内および RLS access gate / `require-bearer` の `requireActiveUser` で **active 相当** として扱う。
  - 監査要件: admin の stage 変更履歴は `user_stage_history` などで引き続き追えるよう既存ロジックを維持。
- **[RD-D1-A] D-1 admin 例外実装方式** → `account_access_state` 内で `public.profiles.is_admin` を直接 SELECT (案 A 採用)。
  - 理由: `is_admin_user(p_uid uuid)` overload を追加すると `is_admin_user` インタフェースの汎用化が必要で影響範囲が広い。本 plan では `account_access_state` 内で `stage` と `is_admin` を 1 回の SELECT で取得するだけで済むため最小変更。
  - 制約: `profiles.is_admin` が NULL の場合は `COALESCE(is_admin, false)` で false 扱い。
  - Phase 2 候補: `is_admin_user(p_uid uuid)` overload 追加は Phase 2 の検討課題 (§10.B)。
- **[RD-D5-1] D-5 AuthGuard 実装方式** → 新規 `<AuthGuard>` provider (案 A) を採用。
  - 理由: AuthExpiredError は ban / stage 判定ではなく **認証期限切れ時の再ログイン導線** なので BanGuard とは責務を分ける。Plan A BanGuard の retry + fail-open ロジックへの干渉リスクを避ける。
  - 実装: `app/layout.tsx` で BanGuard と並列に AuthGuard を置き、`window` の `unhandledrejection` で `AuthExpiredError` を捕捉して `router.push('/auth?next=...')`。`next` には現在の `pathname + search` を入れる。
  - 制約: Plan A 完了の **open redirect helper (`isSafeInternalPath` / `resolveAuthRedirectTarget`) と整合**。外部 URL / `/auth` / `/api` など危険な遷移先は拒否する設計。
  - 責務分離: AuthGuard は client component として **最小責務**。DB access / ban 判定 / stage 判定は持たせない。
- **[RD-D5-2] D-5 AuthGuard 三重経路** → `unhandledrejection` 単独では不十分なため三重経路を採用。
  - 経路 1 (明示 event): `handleAuthExpiredError(error: unknown): boolean` helper を `src/lib/errors/auth-expired-error.ts` に export。catch ブロック内で 1 行呼ぶと `window.dispatchEvent(new CustomEvent("tierlog:auth-expired", { detail: { reason } }))` を発火。
  - 経路 2 (`unhandledrejection` fallback): 握りつぶしを忘れた箇所の safety net。
  - 経路 3 (CustomEvent listener): AuthGuard 内で `window.addEventListener('tierlog:auth-expired', ...)` を listen して `router.push('/auth?next=...')`。
  - 理由: 実コードに `catch (e) { setError(...) }` で promise rejection を握りつぶす箇所が多く、`unhandledrejection` 単独だと AuthExpiredError が AuthGuard まで届かない。catch ブロック内で `if (handleAuthExpiredError(e)) return;` を 1 行追加するだけで対応できる設計にする。
  - de-duplication: AuthGuard 内で `isRedirecting` ref を持ち、同一 redirect target への二重発火を防ぐ。

- **[RD-D4-1] D-4 `/api/account/delete` の access gate** → stage=4 (banned) ユーザーでも **自己削除を許可**。
  - 理由: アカウント削除はアプリ主要機能利用ではなく、退会・データ削除の権利に近い。BAN 中でも退会導線を残す方が UX / 運用 / 法務面で安全。admin サポート依存にすると誤 BAN 時の対応コストが上がる。
  - 実装: `/api/account/delete` で `require-bearer` の `requireActiveUser: false` を **明示的に opt-out** で指定。他の API route に accidentally 広がらないよう、フラグ未指定時のデフォルトは `requireActiveUser: true` (active 要求) のまま。
  - 維持: 本人確認は Bearer JWT / getUser 相当で厳密に維持。他人の削除や匿名実行は不可のまま。
- **[RD-D6-1] D-6 middleware session refresh** → **不要判定** (案 A 採用)。
  - 理由: 現状 client-side supabase-js 中心で通常の token refresh はクライアント側に任せられる。middleware に createServerClient ベースの refresh を入れると Cookie 同期・legacy redirect・rate limit・auth callback 周りに影響が出やすい。Plan D の主目的は access gate / auth expiry UX / RLS 強化であり、middleware session refresh は **blast radius が大きい**。
  - 実装: `src/middleware.ts` の `createServerClient` import が残る場合は **Plan D で不要判定した旨をコメントに明記**。
  - 将来方針: SSR で認証状態に依存するページが増えた時に再評価する方針を §10.B / Phase 2 に残す。
- **[RD-D7-1] Plan D の dev commit タイミング** → Plan A/B/C と同じパターンを採用。
  - 流れ: Claude Code 起案 → plan-critic GO → Codex review → Claude Code 反映 → plan-critic GO → 必要なら反復 → 全 resolved + plan-critic GO 確認後 → dev へ commit/push。
  - 制約: この plan 作成チャットでは実装に入らない。文書 plan の完成と commit/push までに留める。
  - 完了条件: Codex レビュー反映後、未解決質問ゼロ・plan-critic GO を再確認してから dev に commit/push。
