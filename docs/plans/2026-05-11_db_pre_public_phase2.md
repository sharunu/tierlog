# 2026-05-11 公開前 DB 改善 (Phase 2)

## 目的
PR1〜PR3 の Advisor 警告解消 hardening に続く、利用者増加時に後から困る DB / 性能 / 運用改善を公開前に詰める。コードとスキーマ両面で、現状動いている既存挙動を壊さず、性能と整合性を底上げする。

## スコープ外 (CLAUDE.md / ユーザー合意済)
- Backup の自動化 (日次 + 手動復元手順確認のみ。PITR は不要)
- Captcha (必要になれば導入、今回は対策なし)
- 匿名ログイン (引き続き未開放)
- `auth_leaked_password_protection` の Dashboard ON (前 plan の判断通り保留)

## 関連 plan / 履歴
- `docs/plans/2026-05-11_db_hardening_pre_public.md` (PR1/2/3 完了済)
- `docs/reports/2026-05-11_db_hardening_pre_public.md` (実装報告)
- migration: `20260511000001` 〜 `20260511000005` (production 適用済、Local/Remote 一致)

## 入力資料
- 現行 src/lib/actions/{battle,stats,deck,account,admin,feedback,team}-actions.ts
- 現行 src/app/{share/[id],dm/battle,admin}
- 現行 supabase/migrations/ (初期 schema 20260304000001 から PR3 まで)
- Supabase Advisor: 主要警告は PR1〜PR3 で 0 件達成済

## 現状サマリ (調査結果)

### テーブル / 既存制約 (length / unique / enum の不在)
| テーブル | 列 | 現状 | 課題 |
|---|---|---|---|
| `profiles` | `display_name` | text、長さ制約なし | DB 側で長さ強制なし |
| `decks` | `name` | text NOT NULL、`is_archived`, `format`, `game_title` あり | アクティブ同名重複の DB 制約なし (client check のみ) |
| `decks` | `name` 長さ | 制約なし | DB 側で長さ強制なし |
| `battles` | `my_deck_name` / `opponent_deck_name` / `tuning_name` / `opponent_memo` | text、長さ制約なし | DB 側で長さ強制なし |
| `deck_tunings` | `(deck_id, name)` | 重複可 | DB 側で同名重複制約なし (client check のみ) |
| `feedback` | `category` / `message` | text NOT NULL、enum / 長さ制約なし | DB 側で値域強制なし |
| `shares` | 保存期間 | なし (created_at のみ) | 無期限保存、Storage 画像も無期限 |

### 既存 index (`battles`)
- `idx_battles_user_id` / `idx_battles_fought_at` (DESC) / `idx_battles_my_deck_id` / `idx_battles_format` / `idx_battles_tuning_id` / `battles_user_game_idx (user_id, game_title, fought_at DESC)`
- 不足: `(user_id, game_title, format, fought_at DESC, id DESC)` 複合 (UI の主要絞り込み + pagination tiebreaker と不一致)
- 不足: 統計 RPC 用 `(format, game_title, fought_at DESC)` 候補

### 集計のクライアント側実装 (RPC 化対象)
- `src/lib/actions/stats-actions.ts` 内の以下は `battles.select('...')` で全件取得→ JS で集計:
  - `getPersonalStats(format)` (line 4)
  - `getDetailedPersonalStats(format, startDate, endDate)` (line 133)
  - `getDeckDetailStats(deckName, format, startDate, endDate)` (line 297)
  - `getOpponentDeckDetailStats(opponentDeckName, format, startDate, endDate)` (line 394)
- 既に RPC 化済: `getGlobalStatsByRange` / `getTeamStatsByRange` / `getDeckTrendByRange` / `getGlobalDeckDetailStats` / `getGlobalOpponentDeckDetailStats` / `getEnvironmentShares*` / `getPersonalEnvironmentSharesByRange`

### `auto_add_opponent_deck` の現状
- `supabase/migrations/20260426005408_secdef_search_path.sql` の最新版で `SECDEF` + auth.uid() / length / format-game 事前検証あり
- ただし「実際に battles INSERT があった」事実とは紐付いていない: クライアントが battle insert を skip して `supabase.rpc('auto_add_opponent_deck')` 単体で呼ぶことが可能
- 呼び出し元: `src/lib/actions/battle-actions.ts` の `recordBattle()` 末尾で battles INSERT 後に直接 RPC を呼ぶ (line 42-46)

### `delete_own_account` の現状
- `supabase/migrations/20260426050849_secdef_search_path_phase2.sql` の最新版で `DELETE FROM auth.users WHERE id = auth.uid();`
- 関連テーブルは FK CASCADE / SET NULL で連動削除されるが、**share-images bucket の Storage オブジェクトは SQL では消えない** (Storage は別系統)
- 呼び出し元: `src/lib/actions/account-actions.ts:75` の `deleteAccount()`

### `shares` の現状
- 20260415000002 で作成、20260418000001 で `image_url` 追加、20260419000001 で `game_title` 追加、20260509000002 で anon/authenticated の SELECT REVOKE (service_role のみ)
- 取得経路: `src/app/share/[id]/page.tsx` (server-side service_role)、`src/app/api/og/[id]/route.tsx` (同様の想定)
- INSERT は authenticated 直接 (`src/components/share/ShareModal.tsx:147-160`)
- Storage upload も authenticated 直接 (`ShareModal.tsx:130-135`)
- **expires_at / retention 設定は存在せず**

### admin UI 構造
- `src/app/admin/{detection,feedback,opponent-decks,quality-scoring,users}` 既存
- 「一般」カードはまだない (本 plan で追加)

### anon DB アクセス (task 1 関連)
- 主要テーブル (battles/decks/profiles/shares/...) の anon 用 GRANT は PR1〜PR3 の hardening で REVOKE 済
- 公開共有ページ (`/share/[id]`) と OGP (`/api/og/[id]`) は server-side service_role で読み取り (`ShareRow` を service_role で取得)
- → 既に方針通り「anon は原則 DB アクセスなし、必要な公開読み取りは server/service_role 経由」になっている。本 plan では追加変更なし。最終確認 (audit only) のみ実施

## PR 分割案 (7 PR / 11 Phase)

PR1〜PR3 で「20260511000001 〜 20260511000005」を使用済のため、本 plan の migration timestamp は `20260512000001` 以降を使用する (実装日が翌日に跨る場合は実装日で更新)。

各 PR は CLAUDE.md ルール通り `dev` ブランチで実装 → staging Supabase に dry-run + apply → dev preview で実機確認 → ユーザー「本番反映」明示指示後に main マージ → production DB に dry-run + apply の順序を厳守。**`npx supabase db push` は production 反映時はユーザーの明示指示後のみ実行**。

**codex review 指摘対応 (順序問題)**: コード反映 (main deploy) と migration apply (production DB push) は CLAUDE.md ルールにより必ず「コード先 → DB 後」になるため、新コードが新 DB オブジェクト (RPC / column / 権限変更) に依存する PR は「DB 追加のみ」「コード切替」「DB 制約強化」のように Phase に分割する。具体的には PR 6 = 3 Phase / PR 7 = 2 Phase / PR 9 = 2 Phase / PR 10 = PR 9 完了後実装。各 Phase が独立した dev → staging → main → production DB cycle として完結する。

Migration ファイル一覧 (PR 順):
- `20260512000001_revoke_anon_residual_grants.sql` (PR 4)
- `20260512000002_add_check_constraints.sql` (PR 4)
- `20260512000003_add_battles_composite_indexes.sql` (PR 4)
- `20260513000001_unique_decks_and_tunings.sql` (PR 5)
- `20260513000002_auto_add_opponent_deck_trigger.sql` (PR 6 Phase 6a)
- `20260513000003_auto_add_opponent_deck_revoke.sql` (PR 6 Phase 6c)
- `20260514000001_personal_stats_rpcs.sql` (PR 7 Phase 7a)
- `20260515000001_app_settings_and_shares_expiry.sql` (PR 9 Phase 9a)
- `20260516000001_drop_delete_own_account.sql` (PR 10)

PR 8 は migration なし、PR 7 Phase 7b / PR 9 Phase 9b はコード変更のみで migration なし。

---

### PR 4: CHECK 制約 + 複合 index 追加 (低リスク)

**目的**: DB 側でデータ整合性を強制 + 主要クエリパターンの性能改善。

**新規 migration**:
- `20260512000001_revoke_anon_residual_grants.sql`
- `20260512000002_add_check_constraints.sql`
- `20260512000003_add_battles_composite_indexes.sql`

**anon grants 監査 + PUBLIC EXECUTE 撤去 + 必要関数のみ再 GRANT migration** (`20260512000001_revoke_anon_residual_grants.sql`):

codex review 指摘対応: 公開前に anon ロールに残存する table/function GRANT を監査し、anon 原則 DB アクセスなしの方針に合わせて REVOKE する。**単純な `REVOKE ... FROM anon` だけでは Postgres の PUBLIC ロール経由で anon が EXECUTE できる経路が残る** (`has_function_privilege('anon', oid, 'EXECUTE')` は PUBLIC grant 経由でも true になり得る)。本 migration は:

1. anon の直接 grant を REVOKE (PR1-3 補強)
2. **`REVOKE ALL ON ALL FUNCTIONS ... FROM PUBLIC, anon`** で PUBLIC 経由 EXECUTE 経路を塞ぐ
3. authenticated が必要とする関数のみ EXECUTE を明示 GRANT (blanket REVOKE で既存 UI RPC を壊さないため、対象関数一覧と再 GRANT 一覧を明記)
4. DEFAULT PRIVILEGES の PUBLIC + anon を REVOKE (今後の CREATE FUNCTION で自動付与しない)

```sql
-- ===== 監査 SQL (apply 前に staging で実行、結果を migration コメントに残す) =====
--
--   -- a) table / sequence の anon 直接 grant
--   SELECT n.nspname, c.relname, array_agg(p.privilege_type ORDER BY p.privilege_type) AS privs
--   FROM information_schema.table_privileges p
--   JOIN pg_class c ON c.relname = p.table_name
--   JOIN pg_namespace n ON n.oid = c.relnamespace
--   WHERE p.grantee = 'anon' AND n.nspname = 'public'
--   GROUP BY n.nspname, c.relname;
--
--   -- b) function EXECUTE (anon が直接 OR PUBLIC 経由でも EXECUTE 可な関数を全列挙)
--   SELECT n.nspname, p.proname, p.oid::regprocedure AS sig,
--          has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_exec,
--          has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_exec,
--          has_function_privilege('public', p.oid, 'EXECUTE') AS public_exec
--   FROM pg_proc p
--   JOIN pg_namespace n ON n.oid = p.pronamespace
--   WHERE n.nspname = 'public'
--     AND has_function_privilege('anon', p.oid, 'EXECUTE') = true
--   ORDER BY p.proname;
--   -- 期待 (apply 前): public_exec=true (= PUBLIC 経由) の関数があれば、それが anon_exec=true の真の原因
--   -- 期待 (apply 後): a) も b) も 0 行 (anon は直接 / PUBLIC 経由いずれの経路でも EXECUTE できなくなる)

-- ===== step 1: anon の table / sequence REVOKE (PR1-3 補強) =====
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;

-- ===== step 2: PUBLIC + anon の function EXECUTE を ALL FUNCTIONS で REVOKE =====
-- codex review 指摘対応: PUBLIC 経由 EXECUTE 経路を塞ぐのが目的。
-- 本 REVOKE は PUBLIC と anon のみを対象とし、authenticated / service_role の
-- 既存 GRANT は touch しない (SQL 上 `FROM PUBLIC, anon` に authenticated/service_role を
-- 含めていないため)。step 3 の authenticated GRANT は step 2 で失った権限の復元ではなく、
-- 既存の authenticated GRANT を明示再宣言して staging/production の権限差分を防ぐための
-- 念押し用途。staging 監査で step 2 前後の has_function_privilege 差分を確認し、
-- 想定外に authenticated EXECUTE が失われた関数があれば step 3 に追記する。
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC, anon;

-- ===== step 3: authenticated に必要な関数のみ EXECUTE を明示 GRANT =====
-- 対象関数の一覧根拠: src grep (`grep -rn "supabase\.rpc(" src/`) で 2026-05-12 時点に
-- UI / actions から rpc 呼び出しされる関数を全列挙し、その中から **client-side authenticated client が呼ぶ
-- もの** だけを抽出する (codex review 指摘対応)。server-side で `supabaseAdmin` (service_role)
-- が呼ぶ RPC は authenticated GRANT 不要 (既存 service_role GRANT が残る、本 migration step 2 の
-- `REVOKE ... FROM PUBLIC, anon` は service_role を touch しないため)。
-- 分類フロー:
--   1) `src/lib/pokepoke/limitless-sync.ts` 等 server route (service_role client) のみが呼ぶ → service_role 限定のまま、authenticated 非 GRANT
--   2) `src/lib/actions/*.ts` 等 client-side actions が呼ぶ → authenticated に GRANT
--   3) RLS policy 内で参照される SECDEF function (例: is_admin_user, is_my_team_member) → authenticated に GRANT (policy 評価のため)
-- staging 監査結果と突き合わせて差分があれば追記する。
--
-- 後続 PR で構成が変わる関数の扱い:
--   - auto_add_opponent_deck: PR6 Phase 6c で改めて REVOKE する (Phase 6c apply 時点まで GRANT 維持で旧 UI 経路を温存)
--   - delete_own_account: PR10 で DROP するので PR4 では GRANT 維持
--   - PR7 Phase 7a で追加する personal stats RPC 6 本は当該 migration 内で `REVOKE PUBLIC + GRANT authenticated`
--   - PR9 Phase 9a の SECDEF function (validate_app_settings / set_shares_expires_at /
--     recalc_shares_expires_at_on_retention_change / derive_image_path_from_url) は trigger 経由のみ
--     なので EXECUTE 再 GRANT 不要 (REVOKE 状態維持)
--   - PR9 Phase 9a の list_expired_shares() は service_role のみ (本 migration では対象外、PR9 内で GRANT)

-- ----- (3-a) 書き込み / 状態変更 RPC -----
GRANT EXECUTE ON FUNCTION public.auto_add_opponent_deck(text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_own_account() TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_my_display_name(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sync_my_x_connection() TO authenticated;
GRANT EXECUTE ON FUNCTION public.clear_my_x_connection() TO authenticated;
GRANT EXECUTE ON FUNCTION public.recalculate_opponent_decks(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_update_user_stage(uuid, int, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.run_detection_scan() TO authenticated;
GRANT EXECUTE ON FUNCTION public.run_quality_scoring(boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.calculate_quality_score(uuid) TO authenticated;

-- ※ codex review 指摘対応 (client vs server RPC 分類):
--   `src` 内に `supabase.rpc(...)` 呼び出しがあっても、呼び出し側が
--   server-side service_role client なら authenticated への GRANT は不要 (むしろ危険)。
--   以下は server-side service_role 限定のグローバル書き込み RPC のため authenticated に GRANT しない:
--     - public.apply_limitless_snapshot(text, text, jsonb, timestamptz)  -- limitless-sync (server) のみ
--     - public.mark_limitless_sync_error(text, text, text, text)          -- limitless-sync (server) のみ
--   これらは既存 migration (20260509000001_secure_rpc_permissions.sql) で
--   `REVOKE ... FROM PUBLIC, anon, authenticated` + `GRANT ... TO service_role` 済。
--   本 migration の step 2 で PUBLIC + anon を再度 REVOKE するが、service_role への
--   既存 GRANT は剥がさないため (step 2 の `FROM PUBLIC, anon` は service_role を含まない)、
--   limitless-sync の server route は引き続き正常動作する。

-- ----- (3-b) 読み込み系: global / team stats -----
GRANT EXECUTE ON FUNCTION public.get_global_my_deck_stats_range(date, date, text, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_global_opponent_deck_stats_range(date, date, text, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_global_turn_order_stats_range(date, date, text, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_global_deck_detail_stats(text, text, date, date, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_global_opponent_deck_detail_stats(text, text, date, date, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_team_my_deck_stats_range(uuid, uuid, date, date, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_team_opponent_deck_stats_range(uuid, uuid, date, date, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_team_turn_order_stats_range(uuid, uuid, date, date, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_team_deck_trend_range(uuid, uuid, date, date, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_team_deck_detail_stats(uuid, text, text, uuid, date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_team_opponent_deck_detail_stats(uuid, text, text, uuid, date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_deck_trend_range(date, date, text, uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_environment_deck_shares(integer, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_environment_deck_shares_range(date, date, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_personal_environment_shares_range(date, date, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_opponent_deck_suggestions(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_team_members(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_team_member_summaries(uuid) TO authenticated;

-- ----- (3-c) RLS policy 内で参照される SECDEF function -----
-- (RLS policy 評価時に呼出 user の context で実行されるため、EXECUTE 権限が必要)
GRANT EXECUTE ON FUNCTION public.is_admin_user() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_my_team_member(uuid) TO authenticated;

-- ※ 上記 signature は本 plan 執筆時点 (2026-05-12) の見込み。staging 監査で
-- 「has_function_privilege('authenticated', oid, 'EXECUTE') が production で true で、
--  かつ step 2 後に false になった関数」を pg_proc から拾い、ここに漏れがあれば追記する。

-- ===== step 4: service_role 経由のみ呼ばれる関数の補強 GRANT (必要時のみ) =====
-- step 2 の REVOKE は `FROM PUBLIC, anon` のみで service_role は対象外のため、
-- 通常は service_role の既存 GRANT が維持され追加 GRANT は不要。staging 監査で
-- `has_function_privilege('service_role', oid, 'EXECUTE')` が想定外に false になった関数が
-- あった場合 (例: 過去 migration で REVOKE ... FROM service_role が漏れて残っていた等) に限り、
-- ここで明示 GRANT を追加する。
-- (PR9 で追加する list_expired_shares() は同 migration 内で GRANT TO service_role 済なので対象外)

-- ===== step 5: DEFAULT PRIVILEGES の PUBLIC + anon を REVOKE =====
-- 今後 CREATE TABLE / CREATE FUNCTION した時に PUBLIC / anon が自動 GRANT されないように
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon;

-- 注: 公開共有ページ (/share/[id]) と OGP route (/api/og/[id]) は既に server-side service_role で
-- 読み取り済 (src/app/share/[id]/page.tsx:30-43)。anon に対する公開読み取りが必要な経路はない。
```

**preflight 確認**: 上記監査 SQL (a) (b) を staging Studio で実行し anon / PUBLIC 残存権限を列挙。step 3 / step 4 の GRANT 一覧と突き合わせ、本 migration に **不足する GRANT がないか** をユーザー + Claude で twin-check する (漏れると authenticated の rpc 呼び出しが permission denied で 500 になる)。**apply 後**: 同 SQL を再実行し (a) は 0 行 / (b) も 0 行 / かつ step 3 で GRANT した関数が `has_function_privilege('authenticated', oid, 'EXECUTE') = true` になっていることを確認。

---

**CHECK 制約 (length / trim 後空文字 / enum)** (`20260512000002_add_check_constraints.sql`):

長さ上限に加え、`length(trim(...))` で空文字 + 空白のみの値も拒否する。`opponent_deck_master.name` にも 80 字制限を追加 (codex review 指摘対応、admin 入力経由も DB 側で強制)。
```sql
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_display_name_length_check
  CHECK (
    display_name IS NULL
    OR (char_length(display_name) <= 50 AND char_length(trim(display_name)) >= 1)
  );

ALTER TABLE public.decks
  ADD CONSTRAINT decks_name_length_check
  CHECK (char_length(name) <= 80 AND char_length(trim(name)) >= 1);

ALTER TABLE public.battles
  ADD CONSTRAINT battles_my_deck_name_length_check
  CHECK (
    my_deck_name IS NULL
    OR (char_length(my_deck_name) <= 80 AND char_length(trim(my_deck_name)) >= 1)
  );

ALTER TABLE public.battles
  ADD CONSTRAINT battles_opponent_deck_name_length_check
  CHECK (char_length(opponent_deck_name) <= 80 AND char_length(trim(opponent_deck_name)) >= 1);

ALTER TABLE public.battles
  ADD CONSTRAINT battles_opponent_memo_length_check
  CHECK (
    opponent_memo IS NULL
    OR (char_length(opponent_memo) <= 500 AND char_length(trim(opponent_memo)) >= 1)
  );

-- codex review 指摘対応: tuning_name (battles snapshot) も 50 字制限を強制
-- 元の deck_tunings.name と同じ上限。NULL 許可 (tuning なし battle あり)
ALTER TABLE public.battles
  ADD CONSTRAINT battles_tuning_name_length_check
  CHECK (
    tuning_name IS NULL
    OR (char_length(tuning_name) <= 50 AND char_length(trim(tuning_name)) >= 1)
  );

ALTER TABLE public.deck_tunings
  ADD CONSTRAINT deck_tunings_name_length_check
  CHECK (char_length(name) <= 50 AND char_length(trim(name)) >= 1);

ALTER TABLE public.feedback
  ADD CONSTRAINT feedback_message_length_check
  CHECK (char_length(message) <= 2000 AND char_length(trim(message)) >= 1);

ALTER TABLE public.feedback
  ADD CONSTRAINT feedback_category_check
  CHECK (category IN ('bug', 'feature', 'other'));

-- codex review 指摘対応: admin 入力経由でも DB 側で 80 字制限を強制
ALTER TABLE public.opponent_deck_master
  ADD CONSTRAINT opponent_deck_master_name_length_check
  CHECK (char_length(name) <= 80 AND char_length(trim(name)) >= 1);
```

**preflight クエリ (staging で 0 件を確認後 apply)**:
```sql
-- 既存データに長さ違反がないか
SELECT 'profiles.display_name (over 50)' AS where_, COUNT(*) AS violations FROM public.profiles WHERE char_length(display_name) > 50;
SELECT 'decks.name (over 80)', COUNT(*) FROM public.decks WHERE char_length(name) > 80;
SELECT 'battles.my_deck_name (over 80)', COUNT(*) FROM public.battles WHERE char_length(my_deck_name) > 80;
SELECT 'battles.opponent_deck_name (over 80)', COUNT(*) FROM public.battles WHERE char_length(opponent_deck_name) > 80;
SELECT 'battles.opponent_memo (over 500)', COUNT(*) FROM public.battles WHERE char_length(opponent_memo) > 500;
SELECT 'battles.tuning_name (over 50)', COUNT(*) FROM public.battles WHERE char_length(tuning_name) > 50;
SELECT 'deck_tunings.name (over 50)', COUNT(*) FROM public.deck_tunings WHERE char_length(name) > 50;
SELECT 'feedback.message (over 2000)', COUNT(*) FROM public.feedback WHERE char_length(message) > 2000;
SELECT 'opponent_deck_master.name (over 80)', COUNT(*) FROM public.opponent_deck_master WHERE char_length(name) > 80;

-- 既存データに trim 後空違反がないか (NOT NULL 列)
SELECT 'decks.name (trim empty)', COUNT(*) FROM public.decks WHERE char_length(trim(name)) < 1;
SELECT 'battles.opponent_deck_name (trim empty)', COUNT(*) FROM public.battles WHERE char_length(trim(opponent_deck_name)) < 1;
SELECT 'deck_tunings.name (trim empty)', COUNT(*) FROM public.deck_tunings WHERE char_length(trim(name)) < 1;
SELECT 'feedback.message (trim empty)', COUNT(*) FROM public.feedback WHERE char_length(trim(message)) < 1;
SELECT 'opponent_deck_master.name (trim empty)', COUNT(*) FROM public.opponent_deck_master WHERE char_length(trim(name)) < 1;
-- NULL 許可列 (display_name / my_deck_name / opponent_memo) は空文字フィルタを別途
SELECT 'profiles.display_name (trim empty non-null)', COUNT(*) FROM public.profiles WHERE display_name IS NOT NULL AND char_length(trim(display_name)) < 1;
SELECT 'battles.my_deck_name (trim empty non-null)', COUNT(*) FROM public.battles WHERE my_deck_name IS NOT NULL AND char_length(trim(my_deck_name)) < 1;
SELECT 'battles.opponent_memo (trim empty non-null)', COUNT(*) FROM public.battles WHERE opponent_memo IS NOT NULL AND char_length(trim(opponent_memo)) < 1;
SELECT 'battles.tuning_name (trim empty non-null)', COUNT(*) FROM public.battles WHERE tuning_name IS NOT NULL AND char_length(trim(tuning_name)) < 1;

-- 既存データに enum 違反がないか
SELECT 'feedback.category (invalid)', COUNT(*) FROM public.feedback WHERE category NOT IN ('bug','feature','other');
```

各クエリが 0 件であることを確認してから ALTER 適用。1 件でもあれば fix 用 UPDATE を migration 先頭に追加:
- 長さ超過: `SUBSTRING(... FROM 1 FOR N)` で truncate
- trim 後空: NULL 化 (許可列) / 「未設定」等で埋める (NOT NULL 列)
- 不明 category: 'other' に正規化

**複合 index**:
```sql
-- 主要 UI クエリ: user_id × game_title × format × 日付降順 + id (tiebreaker)
-- codex review 指摘対応: pagination の ORDER BY が (fought_at DESC, id DESC) なので、
-- index 末尾にも id DESC を含めて index-only walk を可能にする
CREATE INDEX IF NOT EXISTS battles_user_game_format_fought_at_idx
  ON public.battles(user_id, game_title, format, fought_at DESC, id DESC);

-- 統計 RPC 用 (global stats): format × game_title × 日付降順
CREATE INDEX IF NOT EXISTS battles_format_game_fought_at_idx
  ON public.battles(format, game_title, fought_at DESC);
```

`CREATE INDEX` は SHARE lock を取り並列の INSERT/UPDATE/DELETE をブロックし得る (PR1 と同じ注意点)。データ量小さく低リスクだが production 適用は低トラフィック時に。既存 index (`idx_battles_format` 等) は本 PR では削除しない (cleanup は post-launch に持ち越し)。

**コード変更**: なし

**破壊リスク**: 低 — preflight 0 件確認後なら ALTER は確実、index 追加は非破壊。

**staging 確認**: preflight クエリ実行 → 0 件確認 → apply → 通常入力フロー (deck/battle/feedback) で何も壊れないこと確認

---

### PR 5: アクティブデッキの同名重複禁止 + チューニング名同名重複禁止 (中リスク)

**目的**: race-safe な uniqueness を DB に持つ。

**新規 migration**: `20260513000001_unique_decks_and_tunings.sql`

Resolved Decision [PR5 dedupe]「migration で自動 fix」+ codex review 指摘対応 (重複自動修正 SQL を具体化) に基づき、既存重複を dedupe してから unique index を張る。dedupe + index 作成は同一 migration トランザクションで実施するため race-free。

```sql
-- ========== 1. active decks の同名重複自動 fix ==========
-- 同一 (user_id, game_title, format, lower(trim(name))) のアクティブデッキ群から、
-- 最も古い created_at の 1 件のみを active のまま残し、それ以外を is_archived=true にする。
WITH dups AS (
  SELECT
    id,
    user_id,
    game_title,
    format,
    lower(trim(name)) AS lname,
    created_at,
    ROW_NUMBER() OVER (
      PARTITION BY user_id, game_title, format, lower(trim(name))
      ORDER BY created_at ASC, id ASC  -- 最古を keep。tie breaker は id
    ) AS rn
  FROM public.decks
  WHERE is_archived = false
)
UPDATE public.decks
SET is_archived = true
WHERE id IN (SELECT id FROM dups WHERE rn > 1);

-- ========== 2. deck_tunings の同名重複自動 fix ==========
-- 同一 (deck_id, lower(trim(name))) のチューニング群から、最も古い created_at の 1 件を
-- 残し、それ以外は name に suffix を付けて重複解消する (アーカイブ列が無いため rename 方式)。
--
-- codex review 指摘対応: 既存ユーザー入力名と再衝突しないよう、suffix に対象行の
-- `id` (uuid) 前 8 桁を含める。これにより:
--   - 重複解消対象の各行は uuid 由来でユニーク → 同 deck 内の他行と衝突しない
--   - ユーザーが偶然 ' (重複N_xxxxxxxx)' 形式を入力済 (極めて稀) でも、対象行自身の
--     id 8 桁が一致しない限り衝突は発生しない
--   - 16進 8 桁 = 約 43 億通り → 同 deck 内での偶発衝突は実質ゼロ
--
-- 文字数計算 (元 name を 28 字に truncate + ' (重複N_<id8桁>)' 14〜17字):
--   rn=2:    28 + ' (重複2_xxxxxxxx)'    (15字) = 43 字
--   rn=10:   28 + ' (重複10_xxxxxxxx)'   (16字) = 44 字
--   rn=100:  28 + ' (重複100_xxxxxxxx)'  (17字) = 45 字
--   rn=1000: 28 + ' (重複1000_xxxxxxxx)' (18字) = 46 字
-- すべて PR4 の 50 字 CHECK 制限内に収まる。
WITH dups AS (
  SELECT
    id,
    deck_id,
    name,
    lower(trim(name)) AS lname,
    created_at,
    ROW_NUMBER() OVER (
      PARTITION BY deck_id, lower(trim(name))
      ORDER BY created_at ASC, id ASC
    ) AS rn
  FROM public.deck_tunings
)
UPDATE public.deck_tunings t
SET name = LEFT(t.name, 28)
        || ' (重複'
        || d.rn::text
        || '_'
        || substr(t.id::text, 1, 8)
        || ')'
FROM dups d
WHERE t.id = d.id AND d.rn > 1;

-- 安全網: dedupe 後も同名重複が残っていないか明示的に確認 (理論上ありえないが、
-- 万一 uuid 8 桁衝突 / ユーザー入力名衝突などで残った場合は migration を中断して
-- 手動 fix に倒す。これにより直後の UNIQUE index 作成失敗を防ぐ)。
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.deck_tunings
    GROUP BY deck_id, lower(trim(name))
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION '[migration abort] deck_tunings 重複解消後も同名重複が残存しています。staging で手動確認後、suffix 衝突行の name を手で変更してください。';
  END IF;
END $$;

-- ========== 3. unique index 追加 ==========
-- expression index は IMMUTABLE 関数のみ可。lower/trim は IMMUTABLE。
CREATE UNIQUE INDEX IF NOT EXISTS decks_active_name_unique_idx
  ON public.decks (user_id, game_title, format, lower(trim(name)))
  WHERE is_archived = false;

CREATE UNIQUE INDEX IF NOT EXISTS deck_tunings_name_unique_idx
  ON public.deck_tunings (deck_id, lower(trim(name)));
```

**動作仕様の明示**:
- アクティブデッキ重複: 同 (user_id, game_title, format, 名前) の中で、最古 created_at が active のまま残る。他は archived。アーカイブ後でも battles の history は preserved (`my_deck_name` snapshot 経由)
- deck_tunings 重複: 1 件を残し、他は ` (重複N_<id前8桁>)` suffix で rename。元の name は 28 字までに truncate (50 字 CHECK 制限を suffix と合わせて満たす)。id 前 8 桁を含めることで既存ユーザー入力名との偶発衝突を回避する設計
- 移行後、UI から見えるデッキ数 / チューニング数は変わる (重複が解消されるため)。staging で件数差を事前確認

**preflight クエリ (重複件数の事前把握用、migration が自動 fix するので apply ブロックではない)**:
```sql
-- 既存アクティブデッキの同名重複件数
SELECT user_id, game_title, format, lower(trim(name)) AS lname, COUNT(*) AS cnt
FROM public.decks
WHERE is_archived = false
GROUP BY user_id, game_title, format, lower(trim(name))
HAVING COUNT(*) > 1
ORDER BY cnt DESC;

-- deck_tunings の同名重複件数
SELECT deck_id, lower(trim(name)) AS lname, COUNT(*) AS cnt
FROM public.deck_tunings
GROUP BY deck_id, lower(trim(name))
HAVING COUNT(*) > 1
ORDER BY cnt DESC;
```

重複が見つかれば migration の自動 fix SQL (1, 2 ブロック) が apply 時に実行され、unique index が成立する。preflight は「事前に件数を把握するため」の参考クエリ。

**コード変更**:
- `src/lib/actions/deck-actions.ts:34-46` (`createDeck`): 既存の client check (`同じ名前のデッキ`) はそのまま維持 (UI で fast-fail)。エラー catch を追加して unique 違反 (Postgres error code `23505`) を「同じ名前のデッキが既に登録されています」に変換
- 同 `updateDeck`, `createTuning`, `updateTuning` も同様に DB 制約違反 fallback メッセージを実装
- 既存の case-sensitive な client check を case-insensitive (lower/trim) に合わせる修正は **本 PR ではしない** (UX は現状維持、DB は安全側)

**破壊リスク**: 中 — staging で既存重複が見つかった場合の fix SQL を慎重に書く必要あり。

**staging 確認**:
- preflight で重複 0 件確認
- apply 後、UI でデッキ新規作成・改名で挙動変化なし
- 意図的に同名 (大文字小文字違い・前後スペース違い含む) で作成試行 → エラー表示
- アーカイブ済デッキの同名再作成 → 成功

---

### PR 6: `auto_add_opponent_deck` を battles trigger 経由のみに制限 (中リスク)

**目的**: opponent_deck_master への自動追加を、実際に登録された battle 行に紐づく opponent_deck_name のみに制限。クライアントが battle 不在で auto_add を単体呼びする経路を塞ぐ。

**codex review 指摘対応 (順序問題への対応)**: 旧コードが `auto_add_opponent_deck` を直接 RPC 呼びしているため、`REVOKE EXECUTE FROM authenticated` を 1 つの migration に同梱すると、main deploy 完了前に production DB へ apply された瞬間に旧クライアント (まだコード切替前のセッション) が permission denied で battle 記録に失敗する。これを避けるため **3 Phase に分割** する:

| Phase | 内容 | DB | コード |
|---|---|---|---|
| 6a | trigger 追加 (旧 EXECUTE grant 維持) | migration apply | 変更なし |
| 6b | RPC 呼び出し削除 | 変更なし | code change |
| 6c | authenticated EXECUTE REVOKE + body 簡素化 | migration apply | 変更なし |

各 Phase は独立 dev → staging → main → production DB apply (該当する場合) サイクルとして実装する。Phase 6a → 6b → 6c の順序は厳守。

#### Phase 6a: trigger 追加 (旧 EXECUTE grant 維持)

**新規 migration**: `20260513000002_auto_add_opponent_deck_trigger.sql`

`auto_add_opponent_deck()` 本体および `authenticated` への `EXECUTE` grant は変更しない。AFTER INSERT trigger を追加し、新規 battle INSERT 時に自動で呼ばれるようにする。trigger が呼ぶ `auto_add_opponent_deck()` は SECDEF だが、認証 context (`auth.uid()`) も保持される。

```sql
-- 1. battles INSERT trigger を追加 (UPDATE は対象外: UPDATE での deck name 改変は
--    既存 normalize_battle_deck_names trigger により制約あり、また通常 UX フローは INSERT)
CREATE OR REPLACE FUNCTION public.trg_battles_auto_add_opponent_deck()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM public.auto_add_opponent_deck(
    NEW.opponent_deck_name,
    NEW.format,
    NEW.game_title
  );
  RETURN NULL; -- AFTER trigger return value 無視
END;
$$;
REVOKE EXECUTE ON FUNCTION public.trg_battles_auto_add_opponent_deck() FROM PUBLIC, anon, authenticated, service_role;
-- trigger 経由のみ。owner 権限で動く。

DROP TRIGGER IF EXISTS battles_auto_add_opponent_deck ON public.battles;
CREATE TRIGGER battles_auto_add_opponent_deck
AFTER INSERT ON public.battles
FOR EACH ROW EXECUTE FUNCTION public.trg_battles_auto_add_opponent_deck();

-- 注: auto_add_opponent_deck() 本体は変更しない。authenticated EXECUTE grant も維持。
-- Phase 6b で client 側の rpc 呼び出しを削除し、Phase 6c で REVOKE + body 簡素化を行う。
```

**コード変更**: なし

**順序**: dev (commit only migration ファイル) → staging apply → 動作確認 → main 反映 (no-op for runtime code) → production DB apply

**staging 確認**:
- 新規 battle 登録 (auto モード format) → 旧コード経路で `auto_add_opponent_deck()` が **rpc 呼び 1 回 + trigger 1 回 = 2 回**実行される。`auto_add_opponent_deck()` は冪等 (UPDATE then INSERT IF NOT FOUND) なので副作用なし
- 旧クライアントの battle 記録が引き続き成功 (authenticated EXECUTE は維持)
- opponent_deck_master に新 deck が正しく追加され、`last_used_at` が更新される

#### Phase 6b: RPC 呼び出し削除 (コード変更のみ)

**コード変更**:
- `src/lib/actions/battle-actions.ts:42-46` (`recordBattle`): `await supabase.rpc('auto_add_opponent_deck', ...)` の行を削除。INSERT 成功すれば Phase 6a の trigger が代わりに呼ぶ
- 動作差分はゼロ (同じ場合に同じ呼び出しが trigger 経由で行われる、二重実行も解消)

**順序**: dev → staging で動作確認 (DB は Phase 6a 適用済) → main 反映 (production DB は無変更)

**staging 確認**:
- 新規 battle 登録 → trigger 経由で opponent_deck_master が 1 回更新 (二重実行なし)
- DevTools console で `supabase.rpc('auto_add_opponent_deck', {...})` を直接呼ぶ → まだ authenticated EXECUTE が残っているので 200 が返る (期待挙動、Phase 6c で REVOKE)

#### Phase 6c: REVOKE migration + body 簡素化

**新規 migration**: `20260513000003_auto_add_opponent_deck_revoke.sql`

旧コード (Phase 6b 反映前) の rpc 呼び出しが production から完全に消えたことを前提に、`authenticated EXECUTE` を REVOKE し、本体から不要になった `auth.uid()` チェック相当を削除する。trigger 経由のみで呼ばれるため SECDEF owner 権限で十分。

```sql
-- 1. auto_add_opponent_deck 本体: trigger context 前提で簡素化 (auth.uid() 系チェックは
--    battle INSERT の RLS WITH CHECK で既に認証 + 所有者 + format/game 整合が保証されている)
CREATE OR REPLACE FUNCTION public.auto_add_opponent_deck(
  p_deck_name text,
  p_format text,
  p_game_title text DEFAULT 'dm'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $func$
DECLARE
  v_mode text;
  v_max_sort integer;
BEGIN
  IF p_deck_name IS NULL OR length(trim(p_deck_name)) = 0 OR length(p_deck_name) > 80 THEN
    RETURN; -- 不正名はサイレントに skip (battle INSERT は通っているため例外で巻き戻したくない)
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.opponent_deck_settings s
    WHERE s.format = p_format AND s.game_title = p_game_title
  ) THEN
    RETURN; -- format/game 不整合もサイレント skip (RLS WITH CHECK で battle 側が既に保証)
  END IF;

  SELECT management_mode INTO v_mode
  FROM public.opponent_deck_settings
  WHERE format = p_format AND game_title = p_game_title;

  UPDATE public.opponent_deck_master
  SET last_used_at = now(),
      is_active = CASE WHEN v_mode = 'auto' THEN true ELSE is_active END
  WHERE name = p_deck_name
    AND format = p_format
    AND game_title = p_game_title;
  IF FOUND THEN RETURN; END IF;

  SELECT COALESCE(MAX(sort_order), 0) INTO v_max_sort
  FROM public.opponent_deck_master
  WHERE format = p_format AND game_title = p_game_title;

  IF v_mode = 'auto' THEN
    INSERT INTO public.opponent_deck_master (name, format, game_title, category, is_active, sort_order, last_used_at)
    VALUES (p_deck_name, p_format, p_game_title, 'other', true, v_max_sort + 10, now());
  ELSE
    INSERT INTO public.opponent_deck_master (name, format, game_title, category, is_active, sort_order, last_used_at)
    VALUES (p_deck_name, p_format, p_game_title, 'other', false, v_max_sort + 10, now());
  END IF;
END;
$func$;

-- 2. authenticated からの直 EXECUTE を REVOKE (trigger のみが呼べる)
REVOKE EXECUTE ON FUNCTION public.auto_add_opponent_deck(text, text, text) FROM authenticated;
-- service_role 経由 (admin tooling 等) は将来必要になった時に明示 GRANT。今回は付与なし。
```

**コード変更**: なし

**順序**: ユーザーが「Phase 6b の main deploy 後の production が安定動作している」ことを確認 (Cloudflare deploy 完了 + 旧セッションの cookie 期限切れ目安、最低 1〜2 日) → dev (migration commit only) → staging apply → 動作確認 → user OK → production DB apply

**staging 確認**:
- `supabase.rpc('auto_add_opponent_deck', {...})` を DevTools から直接呼ぶ → **permission denied で REJECTed** (旧経路は完全に閉じた)
- 新規 battle 登録 → trigger 経由で auto_add 成功 (trigger は SECDEF owner 権限なので REVOKE の影響なし)
- admin モード format で新 deck 登録 → opponent_deck_master に is_active=false で追加

---

### PR 7: 個人統計の RPC 化 (中リスク)

**目的**: 既存 `getPersonalStats` / `getDetailedPersonalStats` / `getDeckDetailStats` / `getOpponentDeckDetailStats` (`src/lib/actions/stats-actions.ts`) が全 battles を取得 → JS で集計しているのを DB 集計に切替。

**codex review 指摘対応 (順序問題への対応)**: コード切替時点で新 RPC が production DB に存在しないと runtime エラーになる (CLAUDE.md ルールによりコードは main 反映が先、production DB apply は後)。これを避けるため **2 Phase に分割**:

| Phase | 内容 | DB | コード |
|---|---|---|---|
| 7a | personal stats RPC 6 本の migration apply | migration apply | 変更なし |
| 7b | stats-actions.ts を RPC 呼出に切替 | 変更なし | code change |

各 Phase は独立 dev → staging → main → production DB apply (該当する場合) サイクルとして実装する。Phase 7a → 7b の順序は厳守。

#### Phase 7a: RPC migration apply (コード変更なし)

**新規 migration**: `20260514000001_personal_stats_rpcs.sql`

global 系 RPC (`get_global_my_deck_stats_range` 等) と同シグネチャの personal 版を新設。`auth.uid()` 経由で本人 battles のみ集計するため、`p_user_id` パラメータは取らない (取ると oracle になり危険)。

新設 RPC (signature 確定):
- `get_personal_my_deck_stats_range(p_start_date date, p_end_date date, p_format text)` → `(deck_name, wins, losses, draws, total, win_rate)` (現行 `getDetailedPersonalStats` の myDeckStats 部分相当、my_deck 軸集計)
- `get_personal_opponent_deck_stats_range(p_start_date date, p_end_date date, p_format text)` → 同型 (opponent deck 軸、現行 `getPersonalStats` および `getDetailedPersonalStats` の opponentDeckStats 部分相当)
- `get_personal_turn_order_stats_range(p_start_date date, p_end_date date, p_format text)` → `(first_wins, first_losses, first_draws, second_wins, second_losses, second_draws, unknown_wins, unknown_losses, unknown_draws)`
- `get_personal_deck_detail_stats_overall(p_deck_name text, p_format text, p_start_date date, p_end_date date)` → `(opponent_deck_name, wins, losses, draws, total, win_rate, first_wins, first_losses, first_draws, first_total, second_wins, second_losses, second_draws, second_total, unknown_wins, unknown_losses, unknown_draws, unknown_total)` (現行 `DeckDetailStats.overall` 相当の per-opponent 集計)
- `get_personal_deck_detail_stats_by_tuning(p_deck_name text, p_format text, p_start_date date, p_end_date date)` → 同列 + `tuning_name text` (先頭) (`COALESCE(b.tuning_name, '指定なし')` × `opponent_deck_name` 単位、現行 `DeckDetailStats.tuningStats[].opponents[]` 相当)
- `get_personal_opponent_deck_detail_stats(p_opponent_deck_name text, p_format text, p_start_date date, p_end_date date)` → `getOpponentDeckDetailStats` の DB 版

[PR7 tuning RPC shape] Resolved Decision に従い、deck detail は **2 本に分割** (overall + by_tuning)。1 本にまとめると JSON aggregate or flat 再集計が必要で SQL 複雑化 / TS 再集計ロジック残置を招く。2 本に分けることで RPC 境界と責務 (overall = per-opponent / by_tuning = per-(tuning, opponent)) を明確にし、両者とも同型カラム + 集計列で staging 検証も並列に行える。

各 RPC は `SECURITY DEFINER SET search_path = ''` + `public.` 修飾 + `REVOKE PUBLIC, anon` + `GRANT authenticated`。本文は global 版から `WHERE p.stage <= p_max_stage AND p.is_guest = false` 条件を抜き、`WHERE b.user_id = auth.uid()` を入れる形。

**コード変更**: なし (RPC を追加するだけ。旧 JS 集計コードは引き続き動作)

**順序**: dev (migration ファイルのみ) → staging apply → 動作確認 → main 反映 (no-op for runtime code) → production DB apply

**staging 確認**:

> codex review 指摘対応: 新規 personal RPC は本文で `WHERE b.user_id = auth.uid()` を使うため、**Supabase Studio の SQL Editor (plain SELECT) では `auth.uid()` が NULL になり常に 0 行を返す**。検証は必ず authenticated session 経由で行う:
>
> - **方法 A (推奨)**: dev preview にログイン → DevTools Console で `await supabase.rpc('get_personal_my_deck_stats_range', { p_start_date: null, p_end_date: null, p_format: 'ND' })` を直接実行
> - **方法 B**: 認証済 access token を取得 (`supabase.auth.getSession()` から `access_token` を抜く) → `curl` で PostgREST へ `POST /rest/v1/rpc/<name>` (`Authorization: Bearer <token>` + `apikey: <anon_key>`) を打つ
> - **方法 C**: Supabase Studio の "Run SQL with role" でテストユーザーの session 経由実行ができる場合はそれを利用 (Studio バージョン依存)

検証項目:
- 6 RPC が EXECUTE できる (authenticated として): 上記 方法 A で `get_personal_my_deck_stats_range(null, null, 'ND')` 等を順に呼び、テストアカウントの自分の集計値が返ることを確認
- 未認証で同じ RPC を呼ぶ (anon key のみ) → `permission denied` または空配列が返り、他人のデータが漏れないこと
- 旧 UI / JS 集計が引き続き正常動作 (新 RPC が追加されただけなので回帰なし)
- `get_personal_deck_detail_stats_overall('<deck_name>', 'ND', null, null)` と `get_personal_deck_detail_stats_by_tuning('<deck_name>', 'ND', null, null)` を **方法 A** で個別に呼び、行数と集計値が手元の現行 UI 画面 (Phase 7a 反映前のコード、まだ旧 JS 集計) の数値と一致するか確認 (Phase 7b 適用前に DB レベルでズレを検出できる)

#### Phase 7b: stats-actions.ts のコード切替

**コード変更**:
- `src/lib/actions/stats-actions.ts`:
  - `getPersonalStats(format)`: `supabase.rpc('get_personal_opponent_deck_stats_range', { p_start_date: null, p_end_date: null, p_format: format })` に置換 (start/end 省略は RPC 側で NULL チェック)
  - `getDetailedPersonalStats(format, startDate, endDate)`: 3 つの RPC (my_deck + opponent_deck + turn_order) を Promise.all で並列実行し集計
  - `getDeckDetailStats(deckName, format, startDate, endDate)`: `Promise.all([rpc('get_personal_deck_detail_stats_overall', ...), rpc('get_personal_deck_detail_stats_by_tuning', ...)])` で 2 本を並列実行 → TS 側で `by_tuning` の結果を `tuning_name` ごとに軽くグルーピング (Map<tuning_name, opponents[]>) して既存 `{ overall, overallWins, ..., tuningStats: TuningStats[] }` の return shape に組み立てる
  - `getOpponentDeckDetailStats(opponentDeckName, format, startDate, endDate)`: `get_personal_opponent_deck_detail_stats` 1 本に置換

**順序**: dev → staging で動作確認 (DB は Phase 7a 適用済) → main 反映 (production DB は無変更、Phase 7a で既に apply 済)

**検証方法 (表示結果が現行とズレないこと)**:
1. staging で apply 前後の比較。apply 前: 旧 JS 集計 (Phase 7a 適用済だが UI は旧コード)、apply 後: 新 RPC 集計
2. 同一ユーザー・同一期間で、各画面 (戦績画面 / デッキ詳細 / 対面詳細) の表示数値を **手動で並べる**
3. 自動比較スクリプト (簡易): staging dev preview で `getPersonalStats` を旧実装でも一時的に保持し、新 RPC と diff を console.assert する一時 commit を切る → 検証完了で revert

**破壊リスク**: 中 — 集計ロジックの境界条件 (draw / turn_order null / tuning null) で旧実装と微妙にズレるリスクあり。Phase 7a apply 後の DB レベル並走比較で先に検出する。

**staging 確認**:
- 個人戦績画面 (全期間 / 期間指定) で勝率・対面別・ターン順別の数値が現行 (Phase 7a 適用済の旧コード経路) と一致
- 個別デッキ詳細画面で tuning 別集計が現行と一致 ([PR7 tuning RPC shape] に従い `Promise.all([overall, by_tuning])` の TS グルーピング結果が現行 JS 集計と一致することを画面上で確認)
- 対面別詳細画面 (opponent_deck 軸) で my_deck 別集計が現行と一致
- データ 0 件のユーザーで空配列 / null になり画面が壊れないこと

---

### PR 8: 対戦履歴一覧のページング (中リスク)

**目的**: `getAllBattles` / `getBattlesByDateRange` が unlimited 取得で重いため、UI を「初期 50 件 + Load more 50 件 (cursor-based pagination)」に切替。日付検索・期間検索は維持。

Resolved Decision [PR8-pagination-policy]「50 件/ページの cursor-based pagination」に従い、cursor は直前ページ末尾の `(fought_at, id)` を保持し、次ページ取得時は `(fought_at, id) < (cursor_fought_at, cursor_id)` の tuple 比較で安定取得する。offset-based は途中で行が挿入されると重複/抜けが発生するため採用しない。

**新規 migration**: なし (Supabase range() のみで実装可能)

**コード変更**:
- `src/lib/actions/battle-actions.ts`:
  - 新規関数 `getBattlesByDateRangePaginated(format, startDate, endDate, cursor: { foughtAt: string; id: string } | null = null, limit = 50, game = DEFAULT_GAME)` (Resolved Decision [PR8-pagination-policy] 対応、cursor-based):
    - cursor が null なら最初の 1 ページ目、それ以外は `(fought_at, id) < (cursor.foughtAt, cursor.id)` の tuple 比較で次ページを取得 (Supabase の `.or('fought_at.lt.<x>,and(fought_at.eq.<x>,id.lt.<y>)')` 形式で実装)
    - 内部で limit+1 件取得し、hasMore = (result.length > limit) で判定。返り値は `rows = result.slice(0, limit)` + `nextCursor`
    - 順序は **`.order('fought_at', { ascending: false }).order('id', { ascending: false })`** で fought_at 同秒の battles も安定ソート。cursor tuple 比較と組み合わせることで同秒入力時の next page 漏れ / 重複を完全防止
    - 返り値: `{ rows, hasMore, nextCursor }` を返す。`nextCursor = hasMore ? { foughtAt: lastRow.fought_at, id: lastRow.id } : null`
  - 既存の `getBattlesByDateRange` も残し、新規呼び出しから順次差し替え (互換性のため)
- `src/app/dm/battle/page.tsx`:
  - state に `cursor: { foughtAt; id } | null` / `hasMore` を追加 (`loadedOffset` ではなく cursor を保持)
  - 初期 load: `getBattlesByDateRangePaginated(format, start, end, null, 50)`
  - 「もっと読む」ボタン: 押下時に保持中の `nextCursor` を渡して fetch、既存 state に append し新しい `nextCursor` で更新
  - 日付・期間変更時は cursor を null に reset
  - 同様の処理を `pokepoke/battle/page.tsx` 等他ゲームページにも適用 (`src/app/pokepoke/` を grep して確認)

**破壊リスク**: 中 — pagination state の rollover で重複 / 抜けが出ないかが懸念点。staging で実機確認必須。

**staging 確認**:
- 50 件以上の battle を持つテストユーザーで「もっと読む」を 2 回押す → 重複なく時系列降順に並ぶ (cursor tuple 比較で fought_at 同秒の境界も安定)
- 日付変更 → cursor を null に reset して再 fetch
- 期間変更で 30 件しかない場合 → 「もっと読む」ボタン非表示 (hasMore = false)

---

### PR 9: shares / share-images 保存期間 (90 日デフォルト、管理者画面で変更可能) (中-高リスク)

**目的**: 共有データ・共有画像を一定期間後に削除する仕組みを導入。期間は admin から変更可能。Storage 削除は SQL ではなく Storage API 経由で行う。

**codex review 指摘対応 (順序問題への対応)**: PR9 で追加する `shares.image_path` 列に新コード (ShareModal) が INSERT するため、コード反映が main → production DB apply の順だと、main deploy 直後 production DB に column が無い時間が発生して INSERT が失敗する。これを避けるため **2 Phase に分割**:

| Phase | 内容 | DB | コード |
|---|---|---|---|
| 9a | app_settings / shares.expires_at / shares.image_path / triggers / list_expired_shares RPC の migration apply | migration apply | 変更なし |
| 9b | ShareModal image_path INSERT + cleanup API route + admin settings API route + admin general-settings page | 変更なし | code change |

Phase 9a → 9b の順序は厳守 (DB が先)。サブ章は Phase 9a = 9-A / 9-B、Phase 9b = 9-C / 9-D / 9-E + ShareModal コード変更。

#### Phase 9a: DB migration apply (コード変更なし)

##### 9-A: DB 設定テーブル + shares 拡張

**新規 migration**: `20260515000001_app_settings_and_shares_expiry.sql`

```sql
-- 1. app_settings テーブル (汎用 key-value 設定)
CREATE TABLE IF NOT EXISTS public.app_settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  description text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL
);

ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

-- codex review 指摘対応: admin のみ read/write。authenticated_read は不要 (設定値は admin 専用とする)
-- authenticated/anon は INSERT/SELECT/UPDATE/DELETE すべて拒否される
CREATE POLICY app_settings_admin_all ON public.app_settings
  FOR ALL USING ((SELECT public.is_admin_user())) WITH CHECK ((SELECT public.is_admin_user()));

-- 防御的に anon/authenticated の table grant も REVOKE (default は GRANT がないが念のため)
REVOKE ALL ON public.app_settings FROM anon, authenticated;

-- codex review 指摘対応: service_role API route (9-E /api/admin/settings) から SELECT/INSERT/UPDATE が
-- 必要なので明示的に grant する。service_role は通常 RLS bypass + SECURITY DEFINER bypass で動くが、
-- table-level grant が無いと一部 PostgREST / supabase-js 経路で失敗するため (default の sequence/function grant
-- とは別に table grant が必要)、明示する。
GRANT SELECT, INSERT, UPDATE, DELETE ON public.app_settings TO service_role;

-- codex review 指摘対応: share_retention_days の DB 側バリデーション
-- (整数かつ 1〜3650 の範囲を強制。API route でも同等バリデーションを行うが、
-- 直接 SQL で UPDATE される事故 / 不正型 jsonb 投入を防ぐため DB trigger でも強制)
CREATE OR REPLACE FUNCTION public.validate_app_settings()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_days integer;
BEGIN
  IF NEW.key = 'share_retention_days' THEN
    -- jsonb 型が number でないとエラー (例: '"90"'::jsonb は string なので reject)
    IF jsonb_typeof(NEW.value) <> 'number' THEN
      RAISE EXCEPTION 'share_retention_days は jsonb number 型で指定してください。実際の型: %', jsonb_typeof(NEW.value);
    END IF;
    BEGIN
      v_days := (NEW.value#>>'{}')::integer;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'share_retention_days を integer に変換できません: %', NEW.value;
    END;
    IF v_days < 1 OR v_days > 3650 THEN
      RAISE EXCEPTION 'share_retention_days は 1〜3650 の範囲で指定してください。実際: %', v_days;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.validate_app_settings() FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS app_settings_validate ON public.app_settings;
CREATE TRIGGER app_settings_validate
BEFORE INSERT OR UPDATE ON public.app_settings
FOR EACH ROW EXECUTE FUNCTION public.validate_app_settings();

-- 初期値: 90 日 (validate trigger を通過することで型/範囲も同時にスモークテスト)
INSERT INTO public.app_settings (key, value, description)
VALUES ('share_retention_days', '90', '共有データと共有画像を保持する日数。1〜3650 の整数。期限到達後は admin 一般設定画面の手動ボタンで削除する (公開初期方針)。')
ON CONFLICT (key) DO NOTHING;

-- 2. shares に expires_at 列を追加 (created_at + retention 日数で計算)
-- codex review 指摘対応: retention を必須運用にするため、backfill 後に NOT NULL を立てる
ALTER TABLE public.shares
  ADD COLUMN IF NOT EXISTS expires_at timestamptz;

-- 既存 shares の expires_at を初期化 (retention 設定値 + created_at)
UPDATE public.shares
SET expires_at = created_at + interval '90 days'
WHERE expires_at IS NULL;

-- backfill が漏れていないか防御確認 (1 件でも残れば例外で migration 中断、手動 fix 後に再 apply)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.shares WHERE expires_at IS NULL) THEN
    RAISE EXCEPTION '[migration abort] shares.expires_at が backfill 後も NULL の行が残っています。手動で確認してください。';
  END IF;
END $$;

-- codex review 指摘対応: expires_at を必須運用にする (画像なし share も期限管理対象)
ALTER TABLE public.shares
  ALTER COLUMN expires_at SET NOT NULL;

-- codex review 指摘対応: expires_at < created_at は論理的に不正なので CHECK で防御
-- (再計算 trigger 等のバグで過去日が入るのを早期検出)
ALTER TABLE public.shares
  ADD CONSTRAINT shares_expires_at_after_created_at_check
  CHECK (expires_at >= created_at);

-- 2-bis. shares に image_path 列を追加 (codex review 指摘対応)
-- Storage 削除時に image_url の URL 解析を避けるため、画像作成時に Storage 上のパス
-- (例: 'user_id/share_id.png') を直接保存する。
ALTER TABLE public.shares
  ADD COLUMN IF NOT EXISTS image_path text;

-- 既存 shares の image_path を image_url からバックフィル
-- image_url は Supabase public URL: 'https://<project>.supabase.co/storage/v1/object/public/share-images/<user_id>/<share_id>.png'
UPDATE public.shares
SET image_path = split_part(image_url, '/storage/v1/object/public/share-images/', 2)
WHERE image_url IS NOT NULL
  AND image_path IS NULL
  AND image_url LIKE '%/storage/v1/object/public/share-images/%';

-- 検証: image_url があるのに image_path が NULL の行 (バックフィル漏れ) を staging で確認。
-- もし残れば手動 fix。
--   SELECT count(*) FROM public.shares WHERE image_url IS NOT NULL AND image_path IS NULL;
--   期待: 0

-- 2-ter. shares INSERT/UPDATE 時に image_path を image_url から自動補完する trigger
-- codex review 指摘対応: Phase 9a 適用後 / Phase 9b 反映前は旧 ShareModal が image_url のみ
-- INSERT し image_path を空のまま投入する時間帯が発生する。この間に作成された行は
-- 後段の cleanup / account-delete で Storage path 不明として orphan 化するリスクがある。
-- BEFORE INSERT OR UPDATE で image_url を split_part してパスを取り出し、image_path が NULL の
-- 場合のみ補完する (Phase 9b の明示 INSERT を優先するため空判定で gating)。
CREATE OR REPLACE FUNCTION public.derive_image_path_from_url()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_path text;
BEGIN
  IF NEW.image_path IS NULL
     AND NEW.image_url IS NOT NULL
     AND NEW.image_url LIKE '%/storage/v1/object/public/share-images/%' THEN
    v_path := split_part(NEW.image_url, '/storage/v1/object/public/share-images/', 2);
    -- 空文字 / '/' 等の不正値はスキップ (NULL のまま残し、cleanup 側の image_url fallback ロジックで救済)
    IF v_path IS NOT NULL AND v_path <> '' AND v_path <> '/' THEN
      NEW.image_path := v_path;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.derive_image_path_from_url() FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS shares_derive_image_path ON public.shares;
CREATE TRIGGER shares_derive_image_path
BEFORE INSERT OR UPDATE ON public.shares
FOR EACH ROW EXECUTE FUNCTION public.derive_image_path_from_url();
```

**ShareModal.tsx のコード変更は Phase 9b に分離** (codex review 指摘対応: 順序問題回避のため、column 追加を含む 9-A migration を production DB に apply してからコード切替する)。詳細は本 PR の Phase 9b section 参照。

```sql
-- (DB migration の続きはここから:)

-- INSERT 時に自動で expires_at を埋める trigger
CREATE OR REPLACE FUNCTION public.set_shares_expires_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_days integer;
BEGIN
  SELECT (value#>>'{}')::integer INTO v_days
  FROM public.app_settings
  WHERE key = 'share_retention_days';
  IF v_days IS NULL THEN v_days := 90; END IF;
  NEW.expires_at := COALESCE(NEW.expires_at, NEW.created_at + (v_days || ' days')::interval);
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.set_shares_expires_at() FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS shares_set_expires_at ON public.shares;
CREATE TRIGGER shares_set_expires_at
BEFORE INSERT ON public.shares
FOR EACH ROW EXECUTE FUNCTION public.set_shares_expires_at();

CREATE INDEX IF NOT EXISTS shares_expires_at_idx ON public.shares(expires_at);

-- 3. retention 変更時に既存 shares の expires_at を追従更新する trigger
-- Resolved Decision [PR9 retention]「追従更新」対応
CREATE OR REPLACE FUNCTION public.recalc_shares_expires_at_on_retention_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_days integer;
BEGIN
  IF NEW.key <> 'share_retention_days' THEN RETURN NEW; END IF;
  v_days := (NEW.value#>>'{}')::integer;
  IF v_days IS NULL THEN RETURN NEW; END IF;
  UPDATE public.shares
     SET expires_at = created_at + (v_days || ' days')::interval;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.recalc_shares_expires_at_on_retention_change() FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS app_settings_recalc_shares_expires_at ON public.app_settings;
CREATE TRIGGER app_settings_recalc_shares_expires_at
AFTER INSERT OR UPDATE ON public.app_settings
FOR EACH ROW WHEN (NEW.key = 'share_retention_days')
EXECUTE FUNCTION public.recalc_shares_expires_at_on_retention_change();
```

##### 9-B: 期限切れ shares 抽出 RPC

**同 migration 内**:
```sql
-- service_role 用: 期限切れ shares の id / image_path / image_url を返す
-- codex review 指摘対応: image_path を一次キーとして使うが、image_path NULL + image_url NOT NULL の
-- 行 (Phase 9a 直後 / trigger LIKE 不一致 等) では cleanup 側で image_url から path を fallback 抽出する。
-- そのため image_url も同時に返す。
CREATE OR REPLACE FUNCTION public.list_expired_shares()
RETURNS TABLE(id text, user_id uuid, image_path text, image_url text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT s.id, s.user_id, s.image_path, s.image_url
  FROM public.shares s
  WHERE s.expires_at IS NOT NULL AND s.expires_at < now();
$$;
REVOKE EXECUTE ON FUNCTION public.list_expired_shares() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_expired_shares() TO service_role;
```

##### Phase 9a 順序

**コード変更**: なし

**順序**: dev (migration ファイルのみ) → staging apply → 動作確認 → main 反映 (no-op for runtime code) → production DB apply

**Phase 9a staging 確認**:
- migration apply 成功 (新規 column `shares.expires_at` NOT NULL / `shares.image_path`、新規 CHECK `shares_expires_at_after_created_at_check`、新規 table `app_settings`、新規関数 `validate_app_settings` / `set_shares_expires_at` / `recalc_shares_expires_at_on_retention_change` / `derive_image_path_from_url` / `list_expired_shares`、新規 trigger `app_settings_validate` / `shares_set_expires_at` / `shares_derive_image_path` / `app_settings_recalc_shares_expires_at` が作成される)
- 既存 shares の `expires_at` が `created_at + 90 days` で埋まり (NOT NULL 化前の backfill DO ブロックで 0 件保証)、`image_path` が image_url からバックフィルされる (`SELECT count(*) FROM public.shares WHERE image_url IS NOT NULL AND image_path IS NULL` が 0 件)
- expires_at が NOT NULL になったことを確認: `SELECT count(*) FROM public.shares WHERE expires_at IS NULL;` → 0 件
- expires_at >= created_at の CHECK が active: `SELECT conname FROM pg_constraint WHERE conname = 'shares_expires_at_after_created_at_check';` → 1 行
- 旧 ShareModal コード (Phase 9b 反映前) で新規 share 作成 → `expires_at` は trigger で自動補完される。**image_path も新規 `shares_derive_image_path` BEFORE INSERT trigger が image_url から自動抽出して埋めるため NULL にならない** (codex review 指摘対応: Phase 9a 後 / 9b 前の orphan 画像化を防止)
- 確認 SQL: 旧コードで新規 share を作成した後 `SELECT image_url, image_path FROM public.shares ORDER BY created_at DESC LIMIT 1;` を実行 → 両方とも NOT NULL になっていること
- `list_expired_shares()` を service_role で実行 → 期限切れ shares が列挙される

#### Phase 9b: コード切替 + API + admin UI

##### 9-C0: ShareModal.tsx のコード変更

**コード変更** (`src/components/share/ShareModal.tsx`):
- shares INSERT payload に `image_path` も含める (codex review 指摘対応の前提)
- 既存 `imageUrl = pub.publicUrl` を取得した直後に、同じ `filePath` (例: `${user.id}/${id}.png`) を `image_path` として保持
- `insertPayload.image_path = filePath` を `if (imageUrl) insertPayload.image_url = imageUrl;` と一緒に設定 (image_url が null の場合は image_path も null のままで OK)
- 既存 `image_url` 設定ロジックは維持 (UI で `getPublicUrl` は引き続き必要、og:image / `<img>` 等のため)

**前提**: Phase 9a の migration が staging / production の両方に apply 済 (shares.image_path 列が存在する) であること。Phase 9a apply 前にこのコードが本番に出ると INSERT が失敗する。

##### 9-C: cleanup API route

**新規ファイル**: `src/app/api/admin/share-cleanup/route.ts`

codex review 指摘対応: admin UI から `/api/internal/*` を直接呼ぶと INTERNAL_API_KEY 露出になるため、`/api/admin/*` に server-side admin 判定経由で配置する (既存 admin route の Bearer JWT パターンに整合)。

```ts
// 既存 admin API パターン (Bearer JWT 統一、Resolved Decision [admin auth pattern] 対応):
// - client が supabase.auth.getSession() で access_token を取得
// - fetch に Authorization: Bearer <access_token> ヘッダを付ける
// - server 側は supabaseAdmin.auth.getUser(jwt) で user を検証 (既存 /api/admin/limitless-sync /
//   /api/discord/refresh-guilds と同じパターン)
// - 検証通過後 profiles.is_admin = true を service_role で SELECT
// - 検証 OK なら service_role client で cleanup 実行
// - 検証 NG なら 403 を返す
//
// 共通 helper の方針:
// - requireBearerUser(request: NextRequest): Promise<{ user, supabaseAdmin }> — JWT 検証して user 返却
// - requireBearerAdmin(request): Promise<{ user, supabaseAdmin }> — requireBearerUser 後に
//   profiles.is_admin = true を確認 (false なら 403 を throw)
// - service_role key は src/lib/cf-env.ts getServerEnv('SUPABASE_SERVICE_ROLE_KEY') 経由で
//   server route 内だけで取得、client に絶対出さない
//
// 流れ:
//   1. (server) requireBearerAdmin(request) → user / supabaseAdmin (未認証/非 admin なら 401/403 throw)
//   2. (service_role) list_expired_shares() で期限切れ shares リスト取得
//      → 各行は { id, user_id, image_path, image_url } (codex review 指摘対応で image_url も同時取得)
//   3. (service_role) **各 share の Storage path を解決** (codex review 指摘対応: image_path NULL かつ
//      image_url NOT NULL の行を Storage 削除不要扱いしない設計):
//      a. image_path IS NOT NULL → そのまま使う
//      b. image_path IS NULL かつ image_url が `'%/storage/v1/object/public/share-images/%'` に
//         一致 → image_url から split_part で path を fallback 抽出 (DB trigger と同じロジックを
//         JS 側に複製)。抽出値が '' や '/' なら fallback 不可として後段の orphan 扱いへ
//      c. image_path IS NULL かつ image_url IS NULL → 画像なし share、Storage 削除不要
//      d. image_path IS NULL かつ image_url 不正形式 → fallback 不可、storage_failed として
//         記録し DB は残置 (image_url を残すことで後日手動 cleanup の手掛かりにする)
//   4. (service_role) 解決済 path を chunk (最大 1000 件) して
//      supabase.storage.from('share-images').remove(paths) で一括削除
//      Storage 削除に成功した share id 集合 successfullyRemovedIds を保持
//   5. (service_role) DELETE FROM public.shares
//      WHERE id = ANY(successfullyRemovedIds)
//         OR (id = ANY(noImageIds))  -- (3-c) 画像なし share、Storage 操作不要
//      ※ image_path NULL かつ image_url NOT NULL は DELETE しない (codex review 指摘対応:
//        orphan 画像追跡可能性を維持。storage_failed として返し、再 cleanup の対象に残す)
//   6. 統計: { previewed, storage_deleted, db_deleted, storage_failed, fallback_recovered } を return
//      (fallback_recovered = image_path NULL から image_url 経由で path 抽出に成功した件数)

// preview-only モード:
//   GET /api/admin/share-cleanup?preview=1 → 削除予定件数だけ返す (DELETE せず)
//   UI のボタン横プレビュー表示に使う
```

実装時に注意:
- Storage API `.remove()` は一度に 1000 件まで。`list_expired_shares()` の返り値を chunk して呼ぶ
- 画像が既に手動削除されていても 404 で fail しない (Storage `.remove()` の missing file 仕様)
- Storage 削除に **失敗した share** は DB 残置 (`successfullyRemovedIds` に含めない)、`storage_failed` カウントで UI 表示
- **image_path NULL + image_url NOT NULL の行は image_url からの path 抽出を必ず試みる** (codex review 指摘対応)。抽出に成功すれば Storage 削除 + DB DELETE、失敗すれば DB 残置 (orphan 追跡可能)。DB だけ直接 DELETE してよいのは `image_path IS NULL AND image_url IS NULL` の行のみ
- 後で自動化する場合は、同じ route を Cloudflare Cron Trigger から呼ぶ拡張に切替 (現状は admin button のみ)

##### 9-D: 手動実行 (admin 一般設定画面のボタン)

Resolved Decision [PR9 cron 方式] に基づき、公開初期は cron 自動実行を入れず、admin 一般設定画面の「期限切れ共有を今すぐ削除」ボタンで手動実行する。共有保存期間は 90 日デフォルトのため、運用頻度は低くて済む。

**実装**:
- admin 一般設定画面 (9-E) に「期限切れ共有を今すぐ削除」ボタンを追加
- ボタン押下で client → `/api/admin/share-cleanup` (POST) を呼ぶ。route 内で session 確認 + admin 判定後に service_role で cleanup 実行 (9-C 参照)
- 削除対象件数プレビュー (`list_expired_shares()` の件数) もボタン横に表示
- 後で自動化する場合は、同じ cleanup API route を Cloudflare Cron Trigger から呼ぶ形に拡張できる (今回は wrangler.jsonc 変更なし)

Cloudflare Cron Trigger / pg_cron / wrangler.jsonc triggers.crons の追加は本 plan では実装しない (Resolved Decision で明示却下)。

##### 9-E: admin UI「一般」カード + 設定画面

codex review 指摘対応: `app_settings` は RLS が admin-only + `REVOKE ALL ... FROM anon, authenticated` 済のため、`admin-actions.ts` (authenticated client) から直接 SELECT/UPDATE することはできない (RLS で拒否されるだけでなく table grant でも拒否)。読み書き経路は API route + service_role に統一する。

**新規 API route**: `src/app/api/admin/settings/route.ts`

```ts
// 既存 admin API パターン (9-C の share-cleanup と統一、Bearer JWT):
// - client → Authorization: Bearer <access_token>
// - server → requireBearerAdmin(request) で JWT 検証 + profiles.is_admin 確認 (Resolved Decision
//   [admin auth pattern] 対応、既存 limitless-sync / discord/refresh-guilds と統一)
// - 検証 OK なら service_role client で app_settings を読み書き
// - 検証 NG なら 401 / 403 を返す

// GET /api/admin/settings?key=share_retention_days
//   1. requireBearerAdmin(request) → user / supabaseAdmin (失敗なら 401/403)
//   2. supabaseAdmin で `SELECT value FROM public.app_settings WHERE key = $1`
//   3. 200 で `{ key, value }` を返す (値が未登録なら 404)

// POST /api/admin/settings
//   body: { key: string, value: number | string | ... }
//   1. requireBearerAdmin(request) → user / supabaseAdmin (失敗なら 401/403)
//   2. API 側バリデーション (codex review 指摘対応):
//      - key === 'share_retention_days' の場合:
//        - typeof value === 'number' && Number.isInteger(value)
//        - 1 <= value <= 3650
//      - いずれか失敗 → 400 で `{ error: "share_retention_days must be integer between 1 and 3650" }`
//   3. supabaseAdmin で `INSERT ... ON CONFLICT (key) DO UPDATE
//      SET value = EXCLUDED.value, updated_at = now(), updated_by = $user_id`
//      (DB 側にも 9-A の validate_app_settings trigger があり二重防御。trigger が
//       例外を throw した場合は 400 に変換して返す)
//   4. 200 で `{ key, value }` を返す
```

**コード変更**:
- `src/app/admin/page.tsx`: 「一般」カードを追加 (`/admin/general-settings` へリンク)
- 新規 `src/app/admin/general-settings/page.tsx`: 「共有保存期間 (日)」input + 保存ボタン
  - 初期読込: `supabase.auth.getSession()` で access_token 取得 → `fetch('/api/admin/settings?key=share_retention_days', { headers: { Authorization: `Bearer ${session.access_token}` } })` で値を取得して input 初期化
  - 保存: 同じく `fetch('/api/admin/settings', { method: 'POST', headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ key, value: Number(input) }) })` 経由
  - クライアント側にも UX 用バリデーション (整数 / 1〜3650) を入れて、不正値で disable / inline error
  - 削除対象件数プレビューは同じ Bearer ヘッダ付きで `fetch('/api/admin/share-cleanup?preview=1')` を呼ぶ
- `src/lib/actions/admin-actions.ts` には **app_settings 系の関数を追加しない**。authenticated client が app_settings を直接読めない設計と矛盾するため (codex review 指摘対応)
- UI 注意書き: 「保存期間を変更すると、既存共有の期限も `created_at + new_retention_days` で再計算されます。短くすると既存共有 URL が早く削除対象になります。」を表示
- 設定変更後に期限切れ件数プレビューも更新する (`/api/admin/share-cleanup?preview=1` を再 fetch)

**破壊リスク**: 中 - 高
- expires_at に依存して shares が消える → 画像 URL が dead link 化。ユーザーが share URL を SNS で拡散している場合、期限後にリンク切れになる
- 90 日デフォルトはユーザー合意済方針なので妥当
- 既存 share に初期 expires_at を埋める UPDATE で、想定外に大量の即時期限切れにならないか staging で要確認
- Phase 9a → 9b の順序を逆にすると新コードが image_path 列なしの DB に INSERT を試みて失敗する (codex review 指摘対応で 2 Phase 分割済、両 Phase の本番反映順序を厳守)

**Phase 9b staging 確認**:
- admin で `/admin/general-settings` を開ける (初期表示で `/api/admin/settings?key=share_retention_days` が成功し、現値 90 が input に出る)
- 非 admin ユーザーで `/api/admin/settings` GET/POST → 403 が返ることを確認
- 未ログインで `/api/admin/settings` GET/POST → 401 が返ることを確認
- 新規 share を作成 → `shares.image_path` に正しいパス (`{user_id}/{share_id}.png`) が入っていることを SQL で確認 (ShareModal コード変更の動作確認)
- share_retention_days を 30 に変更 (UI 経由) → 新規 share の expires_at が created_at + 30 days になる
- 不正値テスト (codex review 指摘の DB/API バリデーション動作確認):
  - 0 / -1 / 3651 / 'abc' を API 直接 POST → 400 で reject
  - SQL で `UPDATE app_settings SET value = '0' WHERE key='share_retention_days'` → DB trigger で reject
- `list_expired_shares()` を SQL で手動実行 → 期限切れリストが `(id, user_id, image_path, image_url)` で取得できる
- admin 一般設定画面で「期限切れ共有を今すぐ削除」ボタン押下 → 削除実行 (`/api/admin/share-cleanup` を経由、server 側で session 確認 + admin 検証後に service_role で削除)
- 削除前と削除後の Storage / DB を比較。response に `{ storage_deleted, db_deleted, storage_failed, fallback_recovered }` が含まれる
- **codex review 指摘 image_path NULL fallback 確認**: staging で `UPDATE shares SET image_path = NULL WHERE id = '<test_expired_share_id>'` (image_url は維持) → 「期限切れ共有を今すぐ削除」ボタン押下 → response の `fallback_recovered >= 1` になり、Storage / shares 行が両方とも削除されること
- **両方 NULL 確認**: staging で `UPDATE shares SET image_path = NULL, image_url = NULL WHERE id = '<other_expired_share_id>'` → ボタン押下 → DB 直接 DELETE され、Storage 側は触らないこと (画像なし share が安全に削除される)
- retention を 30 に変更 → 既存 shares の expires_at が `created_at + 30 days` に再計算されることを確認 (9-A 追加 trigger の動作確認)

**ユーザー手動作業**:
- 本番反映後、admin 一般設定画面の「期限切れ共有を今すぐ削除」ボタンを押下し、Storage / DB 双方から正しく削除されるか確認
- Cloudflare Cron Trigger は本 plan では設定しない (公開初期は手動運用、後で自動化が必要になった時点で同じ cleanup API を Cron から呼ぶ拡張を行う)

---

### PR 10: アカウント削除時に share-images Storage も削除 (中リスク)

**目的**: `delete_own_account` 実行時に、そのユーザーの share-images bucket 配下のファイルも削除する。Storage 削除は SQL ではなく Storage API 経由。

**codex review 指摘対応 (依存関係)**: PR10 は `public.shares.image_path` 列を SELECT して Storage 削除パスを決定する設計のため、PR 9 Phase 9a の migration apply (`shares.image_path` 列追加 + 既存行へのバックフィル) が production DB に完了している必要がある。**PR9 Phase 9a → PR9 Phase 9b → PR10 の順序を厳守** (Phase 9b は image_path INSERT を始めるコードなので、PR10 の動作確認に必要な「最新 share に image_path が入っている状態」を作る役目もある)。下の「Migration 順序と本番反映フロー」セクションの並列実行可能性記述も同様に更新済。

**設計**:
- 新規 API route `src/app/api/account/delete/route.ts` を作成
- 流れ (codex review 指摘対応: 順序逆転 — auth.admin.deleteUser を **先に** 成功させてから Storage cleanup を行う。逆だと deleteUser 失敗時にアカウントは残ったまま画像 / DB shares だけ消える矛盾状態が起きるため):
  1. Resolved Decision [admin auth pattern]「Bearer JWT 統一」に従い、client は `supabase.auth.getSession()` で取得した access_token を `Authorization: Bearer <token>` で送信。server は `requireBearerUser(request)` (admin チェックは不要、本人確認のみ) で JWT 検証して user.id を取得 (未認証なら 401)
  2. service_role (supabaseAdmin) で `SELECT id, image_path, image_url FROM public.shares WHERE user_id = $1` を取得し **メモリに保持** (`shareList`)。image_path NULL の行も image_url 共に pickup (fallback 抽出に使う)
  3. **auth.admin.deleteUser(user.id) を先に実行** (codex review 指摘対応):
     - 成功: auth.users 行削除 → FK CASCADE で profiles / decks / battles / deck_tunings / team_members / discord_connections / quality_score_snapshots / user_stage_history などが削除。shares.user_id は `ON DELETE SET NULL` (20260415000002_shares_table.sql) で **自動的に NULL 化** される
     - 失敗: 500 を返してリトライ案内 (`{ error: 'account delete failed', retryable: true }`)。**Storage は touch しない、shares 行も touch しない**。client がリトライすれば step 2 から再走 (idempotent)
  4. step 2 で取得した `shareList` の各 share について Storage path を解決:
     a. image_path IS NOT NULL → そのまま使う
     b. image_path IS NULL かつ image_url が `'%/storage/v1/object/public/share-images/%'` に一致 → image_url から `split_part(image_url, '/storage/v1/object/public/share-images/', 2)` で path を fallback 抽出 (`fallback_recovered` カウントに加算)。抽出値が '' / '/' なら fallback 失敗扱い
     c. image_path IS NULL かつ image_url IS NULL → 画像なし share、Storage 操作不要 (集合 `noImageIds` に追加)
     d. image_path IS NULL かつ image_url 不正形式 / fallback 失敗 → orphan として `failedIds` に追加 (DB 残置 + image_path/image_url 保持)
  5. 解決済 path を chunk (1000 件単位) して `supabase.storage.from('share-images').remove(paths)` を実行
     - Storage API の戻り値から、削除成功した path に対応する share id 集合 `successIds` を作る
     - 削除失敗した share id 集合 `failedIds` に追加 (path が見つからない/権限エラー 等)
     - 既知の "missing file" 系エラーは success 扱い (Supabase Storage `.remove()` は missing file を fail としない仕様)
  6. shares 行を Storage 削除成否で分岐処理する (codex review 指摘対応: 失敗分や image_path NULL 行を一律 DELETE すると orphan 画像が追跡不能になるため):
     a. `DELETE FROM public.shares WHERE id = ANY($successIds) OR id = ANY($noImageIds)` を実行
        - Storage 削除成功した行 + 最初から画像 URL/path 双方なし行のみ確実に削除
        - **`image_path IS NULL AND image_url IS NOT NULL` (Storage 解決不可) の行は DELETE しない**
     b. `UPDATE public.shares SET expires_at = now() WHERE id = ANY($failedIds)` を実行
        - **user_id は step 3 の FK SET NULL で既に NULL 化済** (auth.users 削除 → ON DELETE SET NULL CASCADE)
        - **expires_at を now()**: 即座に「期限切れ」状態にする → PR9 一般設定画面の「期限切れ共有を今すぐ削除」ボタンで再 cleanup 対象として拾える (Phase 9a で expires_at NOT NULL CHECK 済なので、UPDATE 後も制約満たす)
        - **image_path / image_url はそのまま残す**: orphan 画像を追跡可能な状態を維持。admin が再削除を試みれば cleanup できる (cleanup API 側にも image_url fallback 経路がある)
  7. response に `{ storage_deleted: number, storage_failed: number, fallback_recovered: number, orphan_share_ids: string[] }` を含める (account 削除そのものは成功している。Storage cleanup の結果のみ報告)
  8. 削除後の navigation: client は session cookie をクリアしてログイン画面へ。`storage_failed > 0` の場合は警告 toast を表示 (「アカウントは削除されました。一部の共有画像のクリーンアップが失敗しました。管理者にて再度処理を実施します。」) + ログ送信
- 注意: storage.list 経由だと storage 内に DB 行と紐付かない孤立ファイル (古い設計の残骸等) も取れるが、本 plan の方針は「DB shares.image_path を信頼の源とする」。storage 内の orphan は後の cleanup ジョブ (PR 9 の手動 cleanup ボタンを流用) で対応する
- Resolved Decision [delete RPC]「廃止 (DROP)」に従い、既存 `delete_own_account()` は migration で DROP する。旧 RPC が残ると別経路から呼ばれて share-images が orphan 化するリスクがあるため、公開前に一本化する。

**コード変更**:
- `src/lib/actions/account-actions.ts` の `deleteAccount`:
  - `await supabase.rpc('delete_own_account')` を Bearer JWT 経由 fetch に変更 (Resolved Decision [admin auth pattern] 対応):
    ```ts
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error("not signed in");
    const res = await fetch("/api/account/delete", {
      method: "POST",
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
    if (!res.ok) throw new Error(`delete failed: ${res.status}`);
    ```
- 新規 `src/app/api/account/delete/route.ts`:
  - `requireBearerUser(request)` (本人確認のみ、is_admin チェック不要) を使う
  - 9-C / 9-E の admin route と共通の Bearer JWT helper を再利用 (新規 helper として `src/lib/auth/require-bearer.ts` 等に切り出すと整理しやすい。/api/admin/* と /api/account/delete で共有)
- アカウント削除画面で確認ダイアログを既存通り表示
- 静的確認: 全 src 配下で `delete_own_account` 文字列が `database.types.ts` の型定義以外に残っていないこと

**新規 migration**: `20260516000001_drop_delete_own_account.sql`

```sql
-- Resolved Decision [delete RPC]「廃止 (DROP)」: Storage 画像削除を扱えない旧 RPC を完全削除
DROP FUNCTION IF EXISTS public.delete_own_account();
```

**順序**: コード (API route + deleteAccount 切替) を main 反映 → production DB で DROP migration を apply (旧経路の呼び出しが残っていないことを確認してから DROP)。CLAUDE.md「コード変更を伴う migration は main 反映後」を遵守。

**破壊リスク**: 中
- shares.image_path に古い設計の残骸 (path 不在 / バックフィル失敗) があると Storage 削除漏れ。PR9 のバックフィル後 + `derive_image_path_from_url` trigger 適用後に staging で `SELECT count(*) FROM shares WHERE image_url IS NOT NULL AND image_path IS NULL` が 0 件であることを確認
- Storage 部分失敗時: 失敗 share は `user_id = NULL` (auth.users 削除の FK SET NULL CASCADE 結果) + `expires_at = now()` で「orphan share」として shares に残置 → image_path / image_url を維持して orphan 画像を追跡可能にする。admin は PR9 一般設定画面の「期限切れ共有を今すぐ削除」ボタンで再 cleanup できる
- **auth.admin.deleteUser 失敗時** (codex review 指摘対応の順序変更): step 3 で **Storage と shares 行に一切触れる前** に deleteUser を試みるため、失敗してもアカウント / shares / Storage の整合性は維持される。client に 500 + retryable=true を返してリトライ案内。retry 時は step 2 から再走 (shareList を取り直す、idempotent)
- ロールバック手段: deleteUser 失敗時はそもそも DB / Storage に変更が起きていないので明示的なロールバック不要。Storage cleanup 部分失敗は admin 一般設定画面の cleanup ボタンで再試行できる設計に倒している

**staging 確認**:
- Test account を作り、share を 3〜5 件作成 (画像あり 2-3 件 + 画像なし 1-2 件、Storage と DB shares 双方に存在)
- 削除直前に `SELECT id, image_path, image_url FROM shares WHERE user_id = ?` の結果を記録
- アカウント削除実行
  - **`auth.users WHERE id = ?` が真っ先に消える** (codex review 指摘対応で順序逆転、step 3 の deleteUser が最初に実行される)
  - その後 Storage `share-images/<user_id>/` 配下のファイルが消える
  - 最後に `shares WHERE id = ANY(成功 ids)` が DELETE される (orphan として残るのは Storage 失敗分のみ)
  - decks / battles / deck_tunings 等の FK CASCADE 対象も deleteUser で消える
- 削除後のセッションは無効化、ログイン画面に戻る
- 失敗ケース確認 (codex review 指摘対応): storage 一部失敗時 (test 用に bucket 権限を一時的に絞る) →
  - `user_id IS NULL AND expires_at < now() AND (image_path IS NOT NULL OR image_url IS NOT NULL)` の orphan share が残ること (user_id NULL は FK SET NULL の結果、明示 UPDATE せず)
  - image_path / image_url はそのまま残っていること (`SELECT id, image_path, image_url FROM shares WHERE user_id IS NULL`)
  - その後 admin 一般設定画面で「期限切れ共有を今すぐ削除」ボタンを押し、bucket 権限を戻して再 cleanup → orphan share と Storage 画像が削除されること
- **codex review 指摘 image_path NULL fallback 確認**: staging で `UPDATE shares SET image_path = NULL WHERE id = '<test_share_id>'` (image_url は維持) → アカウント削除 → response の `fallback_recovered >= 1` になり、Storage / shares 行が両方とも削除されること
- **codex review 指摘 deleteUser 失敗時の整合性確認**: staging で test account の auth.users 行を service_role で削除済の状態にして API を呼ぶ (deleteUser が "User not found" で失敗) → response は 500 + retryable、shares / Storage は変更されないこと (削除前と同じレコード件数)

**ユーザー手動作業**:
- staging で test account を実際に作って削除 → 一連の flow を確認

---

## Migration 順序と本番反映フロー

PR (および Phase) ごとに以下を順次実行。各 Phase は独立した dev → main → production DB cycle として完結する:

1. **dev で実装** → commit / push (Claude 自動可)
2. **staging Supabase へ migration dry-run + apply** (ユーザーのローカルで `npm_config_cache=... npx supabase db push --db-url "$STAGING_DB_URL" --include-all --dry-run` → 確認後 apply)。コード変更のみの Phase はこのステップ skip
3. **dev preview で動作確認** (PR 別に下記 staging 確認項目を実施)
4. **ユーザー OK 指示** → main マージ → Cloudflare 本番デプロイ完了確認 (HTTP 200 安定)
5. **production DB に dry-run + apply** (ユーザー明示指示後のみ実行、`--dry-run` 結果をユーザーが確認してから apply)。コード変更のみの Phase はこのステップ skip
6. **production Advisor 再走査** (PR 別に効果確認、migration を含む Phase のみ)

**重要**: 1 つの PR 内で複数 Phase がある場合 (PR 6 / 7 / 9)、Phase ごとに上記 1〜6 を順番に完走させる。Phase 7a の production DB apply 完了を待ってから Phase 7b の dev 着手、のように順次直列で進める。Phase をまたいで並行すると順序問題 (codex review 指摘) が再発する。

PR 間の依存関係:
- **PR 4 → PR 5**: CHECK 制約 (deck_tunings.name 50字含む) を PR4 で先に張ってから、PR5 の dedupe SQL (28字 truncate + suffix で 50字以内に収まる前提) を apply。並列実行不可
- **PR 6 (Phase 6a → 6b → 6c)**: 旧コード互換のため 3 Phase 順序厳守。Phase 6a (trigger 追加、grant 維持) → Phase 6b (code rpc 削除) → Phase 6c (REVOKE + body 簡素化)。各 Phase は独立 dev → main → DB cycle
- **PR 7 (Phase 7a → 7b)**: Phase 7a (RPC migration apply、コード変更なし) → Phase 7b (stats-actions.ts コード切替)。順序逆だと新コードが未存在の RPC を呼んでランタイムエラー
- **PR 8 単独**: コードのみ、migration なし。他 PR と並列可能
- **PR 9 (Phase 9a → 9b)**: Phase 9a (DB migration: app_settings / shares.expires_at / shares.image_path / triggers / list_expired_shares RPC) → Phase 9b (ShareModal image_path INSERT + admin route/UI)。順序逆だと新コードが未存在 column に INSERT を試みて失敗
- **PR 10**: PR 9 Phase 9a / 9b の両方が完了してから着手。`shares.image_path` 列が存在し、新規 share に image_path が INSERT されている状態が前提。PR10 単独でコード + DROP migration を実装

並列実行可能性 (codex review 指摘対応で更新): **PR 8 のみ完全並列可能**。PR 4 + PR 5 は順次。PR 6 / PR 7 / PR 9 は各 PR 内で Phase 順序を守る前提で他 PR とは並列化可能だが、PR 10 は **必ず PR 9 完了後**。実際の運用ではユーザーの本番反映タイミング都合で全 PR を順次実装するのが望ましい (rollback 時の切り戻しが分かりやすいため)。

---

## 破壊リスク全体まとめ

| PR | リスク | 主な要因 | mitigation |
|---|---|---|---|
| PR 4 | 低 | CHECK 違反データが既存にあれば apply fail | preflight 0 件確認 |
| PR 5 | 中 | 既存重複あれば apply fail / fix 漏れで unique 違反 | preflight + fix SQL |
| PR 6 | 中 | trigger 経由 INSERT で隠れた副作用 / TS-DB ズレ期間 | staging で battle insert 全 game/format 確認 |
| PR 7 | 中 | RPC 結果が JS 集計と微妙にズレる (境界条件) | staging で 1-1 比較、draws/turn_order/tuning_null パターン網羅 |
| PR 8 | 中 | ページング state の重複 / 抜け | 100+件のテストデータで実機確認 |
| PR 9 | 中-高 | expires_at の即時切れ / dead link / retention 追従更新で大量 shares が想定外に即時期限切れ / 手動ボタン押し忘れによる Storage 容量増加 | 既存 shares への expires_at 初期化を staging で測定、retention 変更 trigger を staging の少量データで先に動作確認、ボタン押下時の削除件数プレビューで誤操作防止 |
| PR 10 | 中 | Storage 削除 / auth 削除の不整合 / タイムアウト | test account の実機削除 |

---

## staging 確認項目 (PR 横断)

各 PR の staging 確認項目に加え、PR が production に渡る直前に下記の最小スモークテストを必ず実行 (ユーザー):

- ログイン (Google / X / Email password)
- デッキ一覧 / 新規作成 / 編集 / アーカイブ
- battle 新規入力 / 編集 / 削除
- 個人統計画面 (全期間 + 期間指定)
- 全体統計画面
- チーム統計画面 (Discord 連携済アカウントで)
- admin 画面 (ユーザー一覧 / feedback / opponent_decks / 一般 (PR 9 後) )
- 共有画像生成 + X 投稿 (PR 9 後は expires_at が反映されること確認)
- アカウント削除フロー (PR 10 staging 時にテストアカウントで)

---

## ユーザー手動作業まとめ

| 項目 | 対象 PR | 内容 |
|---|---|---|
| staging DB dry-run + apply | 全 PR | `npm_config_cache=... npx supabase db push --db-url "$STAGING_DB_URL" --include-all --dry-run` → apply |
| production DB dry-run + apply | 全 PR | 同 `$PROD_DB_URL`、apply はユーザー明示指示後 |
| Supabase Advisor 再走査 | 全 PR (情報目的) | Dashboard → Database → Linter → Re-run |
| admin 一般設定画面の手動ボタン動作確認 | PR 9 | 本番反映後、admin 一般設定画面の「期限切れ共有を今すぐ削除」ボタン押下で Storage / DB 双方から削除されること、retention 変更で既存 shares の expires_at が再計算されることを確認 |
| staging で test account 作成→削除実機確認 | PR 10 | Storage / DB から完全に消えることを確認 |
| 既存重複デッキ / チューニング名の整理 | PR 5 | preflight で重複が見つかった場合のみ |

---

## 検証 SQL (staging / production 共通)

```sql
-- PR 4 適用後: CHECK 制約が active か
SELECT conname FROM pg_constraint
WHERE conname IN (
  'profiles_display_name_length_check',
  'decks_name_length_check',
  'battles_my_deck_name_length_check',
  'battles_opponent_deck_name_length_check',
  'battles_opponent_memo_length_check',
  'battles_tuning_name_length_check',
  'deck_tunings_name_length_check',
  'feedback_message_length_check',
  'feedback_category_check',
  'opponent_deck_master_name_length_check'
);
-- 期待: 10 行

-- PR 4 適用後: 新 index が存在
SELECT indexname FROM pg_indexes
WHERE indexname IN ('battles_user_game_format_fought_at_idx', 'battles_format_game_fought_at_idx');
-- 期待: 2 行

-- PR 5 適用後: unique index が存在
SELECT indexname FROM pg_indexes
WHERE indexname IN ('decks_active_name_unique_idx', 'deck_tunings_name_unique_idx');
-- 期待: 2 行

-- PR 6 検証 (codex review 指摘対応で Phase 別に書き分け): Phase 6a/6b では authenticated EXECUTE は
-- 維持されたまま (旧コード互換のため)、Phase 6c で初めて REVOKE される

-- === PR 6 Phase 6a 適用後 (trigger 追加、grant 維持) ===
SELECT tgname, tgenabled FROM pg_trigger WHERE tgname = 'battles_auto_add_opponent_deck';
-- 期待: 1 行、tgenabled='O' (trigger 有効)
SELECT has_function_privilege('authenticated', 'public.auto_add_opponent_deck(text, text, text)', 'EXECUTE');
-- 期待: true (Phase 6a では authenticated EXECUTE は維持、旧コードからの呼び出しを継続させる)

-- === PR 6 Phase 6b 適用後 (コード rpc 削除、DB は Phase 6a と同じ) ===
-- DB レベルの検証は Phase 6a と同じ。authenticated EXECUTE は引き続き true (REVOKE は Phase 6c)。
-- 別途、production の battle 記録が引き続き正常 (Cloudflare deploy 後 24-48h の error log monitor で確認)

-- === PR 6 Phase 6c 適用後 (REVOKE + body 簡素化) ===
SELECT tgname, tgenabled FROM pg_trigger WHERE tgname = 'battles_auto_add_opponent_deck';
-- 期待: 1 行、tgenabled='O' (trigger は引き続き active)
SELECT has_function_privilege('authenticated', 'public.auto_add_opponent_deck(text, text, text)', 'EXECUTE');
-- 期待: false (authenticated 直接呼び出し経路を REVOKE 済、trigger 経由のみ動作する状態)

-- PR 7 適用後: personal stats RPC の存在確認 (RPC body は auth.uid() を見るため Studio SQL Editor では
-- 0 行になる。実呼び出し検証は dev preview の DevTools Console から supabase.rpc(...) で行うこと、
-- codex review 指摘対応)
SELECT proname FROM pg_proc WHERE proname IN (
  'get_personal_my_deck_stats_range',
  'get_personal_opponent_deck_stats_range',
  'get_personal_turn_order_stats_range',
  'get_personal_deck_detail_stats_overall',
  'get_personal_deck_detail_stats_by_tuning',
  'get_personal_opponent_deck_detail_stats'
);
-- 期待: 6 行

-- PR 9 適用後: app_settings に share_retention_days が入っている
SELECT key, value FROM public.app_settings WHERE key = 'share_retention_days';

-- PR 9 適用後: validate_app_settings trigger が active か (codex review 指摘対応)
SELECT tgname, tgenabled FROM pg_trigger WHERE tgname = 'app_settings_validate';
-- 期待: tgenabled='O'

-- PR 9 適用後: shares_derive_image_path trigger が active か (codex review 指摘対応、Phase 9a/9b 間 orphan 防止)
SELECT tgname, tgenabled FROM pg_trigger WHERE tgname = 'shares_derive_image_path';
-- 期待: tgenabled='O'

-- PR 9 適用後: image_url があるのに image_path が NULL の行が残っていない (バックフィル + trigger 動作確認)
SELECT count(*) FROM public.shares WHERE image_url IS NOT NULL AND image_path IS NULL;
-- 期待: 0

-- PR 9 適用後: shares.expires_at が NOT NULL かつ created_at 以降 (codex review 指摘対応)
SELECT count(*) FROM public.shares
WHERE expires_at IS NULL OR expires_at < created_at;
-- 期待: 0 (NOT NULL 制約 + shares_expires_at_after_created_at_check で防御)

-- PR 9 適用後: NOT NULL / CHECK 制約の存在確認
SELECT conname FROM pg_constraint WHERE conname = 'shares_expires_at_after_created_at_check';
-- 期待: 1 行
SELECT is_nullable FROM information_schema.columns
WHERE table_schema='public' AND table_name='shares' AND column_name='expires_at';
-- 期待: 'NO'

-- PR 9 適用後: 期限切れ shares の件数
SELECT count(*) FROM public.list_expired_shares();
```

これらは Claude が Supabase MCP 経由で読み取り確認可能 (`mcp__plugin_supabase_supabase__execute_sql`)。

---

## 実装前確認事項 (回答済)

codex review 指摘対応: 当初 Q1〜Q7 として保留していた判断は全て下記 ## Resolved Decisions に反映済。本セクションは index 用途で残し、実装時は ## Resolved Decisions を一次参照する。

- Q1 (PR 9 cron 実装方式) → [PR9 cron 方式]: 手動運用 (admin ボタン)
- Q2 (PR 7 RPC の `p_max_stage` 渡し) → [p_max_stage]: 取らない
- Q3 (PR 5 重複自動 fix 方針) → [PR5 dedupe]: migration で自動 fix
- Q4 (PR 10 既存 `delete_own_account` の扱い) → [delete RPC]: 廃止 (DROP)
- Q5 (PR 4 既存 index 削除) → [PR4 cleanup]: 今回は触らない
- Q6 (PR 9 Storage 削除の単位) → [PR9 削除単位]: 一括削除 (手動ボタン押下時)
- Q7 (PR 9 retention 変更時の既存 shares への影響) → [PR9 retention]: 追従更新

---

## 既存 Resolved Decisions (前 plan からの引き継ぎ)

PR1〜PR3 で確定済の方針 (本 plan には直接影響しないが背景):
- is_admin REVOKE: 現状維持
- team_member: `is_my_team_member` 新設 + REVOKE 済
- PR 分割: PR 単位で段階反映 (本 plan も踏襲)
- unused index: 公開後 1 ヶ月後に production 統計で再評価
- lint silence: SQL COMMENT 方式
- auth_leaked_password: 保留

## Resolved Decisions

- [PR9 cron 方式] PR 9 の share-cleanup cron はどの方式で実装しますか? → 手動運用 (admin ボタン)
  - 共有保存期間は 90 日なので、公開初期から自動 cron 必須ではない
  - Storage 削除は SQL だけでなく Storage API `remove` が必要で、Cloudflare Cron / pg_net まで入れると検証範囲が広がりすぎる
  - まずは admin 一般設定画面に「期限切れ共有を今すぐ削除」ボタンと、削除対象件数プレビューを置く方針
  - 実装: admin 一般設定画面から手動実行 / server/service_role 経由で shares と share-images を削除 / Storage 画像削除は Supabase Storage API `remove` を使う
  - 後で自動化する場合は、この削除 API を Cloudflare Cron Trigger から呼ぶ形に拡張できるようにしておく
- [p_max_stage] PR 7 の個人統計 RPC で p_max_stage を取りますか? → 取らない
  - 個人統計 RPC は `auth.uid()` の自分のデータだけを見るため p_max_stage は不要
  - p_max_stage は global/team のような「集計対象ユーザーを絞る」用途の引数であり、個人統計には意味が薄い
  - signature 統一より、引数の意味が明確な方を優先する
- [PR5 dedupe] PR 5 で既存重複デッキ/チューニング名が見つかった場合、どう対処しますか? → migration で自動 fix
  - まだ一般公開前で、既存データが勝手に変わっても問題ない
  - staging / production の両方で migration が途中停止しない方を優先する
  - 方針:
    - active decks の重複は、同一 `user_id + game_title + format + lower(trim(name))` の中で、最も古い/主要な 1 件だけ active のまま残し、それ以外を `is_archived = true` にする
    - deck_tunings の重複は、同一 `deck_id + lower(trim(name))` の中で 1 件を残し、それ以外は名前に短い suffix を付けて重複解消する
  - 自動 fix 内容は migration コメントに明記する
- [delete RPC] PR 10 後の既存 `delete_own_account()` RPC の扱いは? → 廃止 (DROP)
  - 既存 RPC は DB/Auth 側の削除だけで Storage 画像削除を扱えない
  - 今後は Storage API `remove` を使う新しい API route 経由に統一する
  - RPC を残すと、旧経路から呼ばれて share-images が orphan になる可能性が残る
  - 公開前なので互換性より安全な一本化を優先
  - 方針 (codex review 第 5 回指摘対応で順序を本文と一致させる):
    - クライアントのアカウント削除処理は新 API route (Bearer JWT pattern) を呼ぶ
    - 新 API route の実行順序: **(1) shareList 取得 (image_path / image_url) → (2) auth.admin.deleteUser を先に成功させる (失敗時は Storage 触らず 500 retryable を返す) → (3) FK SET NULL CASCADE で shares.user_id 自動 NULL 化 → (4) Storage path 解決 (image_path 優先 + image_url fallback) → (5) Storage API `remove` chunk 実行 → (6) Storage 成功分は shares DELETE、失敗分は expires_at = now() で orphan 化し PR9 cleanup ボタンから再削除可能にする**
    - 旧設計 (Storage `remove` → ユーザー削除) は deleteUser 失敗時に「アカウント残存 + 画像/DB だけ消失」の矛盾状態を作るため逆順に修正
    - 既存 `delete_own_account()` は migration で DROP
    - 旧 RPC 呼び出しがコード上に残っていないことを静的確認する
- [PR4 cleanup] PR 4 で新複合 index 追加と同時に subsumed な既存 index を DROP しますか? → 今回は触らない
  - index 追加は安全寄りだが、既存 index 削除は実クエリへの影響が読み切れない
  - subsumed に見えても、別クエリ・別 `ORDER BY` で使われる可能性がある
  - unused_index は公開後 1 ヶ月の production 利用統計で再評価する方針 (前 plan の Resolved Decisions)
  - 今回は必要な複合 index の追加のみ行う
- [PR9 削除単位] PR 9 の share-cleanup の削除単位はどうしますか? → 一括削除 (手動ボタン押下時)
  - admin 一般設定画面の手動ボタンで期限切れ shares を一括 cleanup する
  - 対象件数プレビューを表示する
  - 実行時は expired shares を取得する
  - `image_url` があるものは Supabase Storage API `remove` で削除する
  - Storage 削除が成功したもの、または `image_url` が null のものだけ DB `shares` から削除する
  - Storage 削除に失敗したものは DB row を残し、失敗件数として UI / API レスポンスに返す
  - Storage `remove` は大量件数に備えて chunk 処理する (Supabase Storage API は 1000 件 / 呼び出し上限)
  - 公開初期なので soft-delete 2 段階は採用しない
  - 後で自動化する場合も、同じ cleanup API を再利用できる設計にする
- [PR9 retention] PR 9 で admin が retention を変更した時、既存 shares の expires_at は? → 追従更新
  - ストレージが圧迫している時に保存期限を短くしても、既存 share に効かないと運用上困る
  - 管理者が保存期間を変更したら、既存 shares の expires_at も `created_at + new_retention_days` に再計算する
  - その後、手動 cleanup を押せば短縮後の期限で古い share を削除できる
  - UI: 「保存期間を変更すると、既存共有の期限も再計算されます。短くすると既存共有 URL が早く削除対象になります。」と明記する
  - 設定変更後に期限切れ件数プレビューも更新する
- [PR7 tuning RPC shape] PR 7 の `get_personal_deck_detail_stats` のスキーマをどうしますか? → Overall + tuning 2 本に分割
  - 1 本 RPC + JSON aggregate は SQL が複雑になりレビューしづらい
  - Flat 1 本だと TS 側の再集計ロジックが多く残る
  - overall と tuning は責務が違うので、RPC を分けた方が検証しやすい
  - 方針:
    - `get_personal_deck_detail_stats_overall`: deck detail の overall 用、`opponent_deck_name` 単位で wins/losses/draws/total/win_rate/turn_order 系を返す
    - `get_personal_deck_detail_stats_by_tuning`: tuningStats 用、`COALESCE(tuning_name, '指定なし')` と `opponent_deck_name` 単位で同じ集計列を返す
    - TS 側は `Promise.all` で 2 本を並列実行し、`by_tuning` の結果を `tuningName` ごとに軽くグルーピングして既存の `{ overall, overallWins, ..., tuningStats }` return shape に合わせる
- [admin auth pattern] 新規 admin API route (/api/admin/share-cleanup, /api/admin/settings, /api/account/delete) の auth 方式は? → Bearer JWT 統一
  - 既存の /api/admin/limitless-sync と /api/discord/refresh-guilds が Bearer JWT 方式なので、実コードの既存パターンに合わせる
  - plan 当初は「SSR cookie 経由 (src/lib/supabase/server.ts の createServerClient)」と書いていたが、grep で実コードベース上で createServerClient/cookies path は未使用 (定義はあるが import 0 件) であり、「既存 admin route パターンに整合」の主張と矛盾していた (codex review 第 4 回指摘)
  - 方針:
    - client 側は `supabase.auth.getSession()` で access_token を取得し、`Authorization: Bearer <access_token>` を付けて fetch
    - server 側は `supabaseAdmin.auth.getUser(jwt)` でユーザー検証
    - admin route はその後 `profiles.is_admin` を service_role client で確認
    - `/api/account/delete` は admin route ではないので is_admin チェックは不要。同じ Bearer JWT で本人確認のみ
  - 共通 helper:
    - `requireBearerUser(request)`: JWT 検証して user を返す
    - `requireBearerAdmin(request)`: requireBearerUser 後に profiles.is_admin を確認 (false なら 403 throw)
    - `src/lib/auth/require-bearer.ts` (仮) に集約、新規 3 route と既存 admin route (将来移行時) で共用
  - service_role key は server route 内だけで使い、client に絶対出さない (getServerEnv('SUPABASE_SERVICE_ROLE_KEY') 経由)
  - SSR cookie 方式への統一リファクタは今回は含めず、将来必要になったら別 PR で検討する
- [PR8-pagination-policy] PR 8 の対戦履歴一覧のページング方式は? → 50 件/ページの cursor-based pagination
  - offset-based は途中で行が挿入されると重複/抜けが出るため不採用
  - cursor は直前ページ末尾の `(fought_at, id)` を保持し、次ページ取得時は `(fought_at, id) < (cursor_fought_at, cursor_id)` の tuple 比較で安定取得する
  - 順序は `.order('fought_at', { ascending: false }).order('id', { ascending: false })` で fought_at 同秒の battles も安定ソート
  - 内部で limit+1 件取得し、hasMore = (result.length > limit) で判定、`nextCursor = hasMore ? { foughtAt: lastRow.fought_at, id: lastRow.id } : null`
  - 日付・期間変更時は cursor を null に reset して再 fetch
  - 既存 `getBattlesByDateRange` は残し新規呼び出しから順次差し替え (互換性のため)

## 参考: ファイル参照
- 現行 stats 集計 (JS): `src/lib/actions/stats-actions.ts:4-43, 133-231, 297-383, 394-450`
- 現行 battles 取得: `src/lib/actions/battle-actions.ts:106-227`
- 現行 deck 重複 client check: `src/lib/actions/deck-actions.ts:34-46, 64-82, 107-137, 139-159`
- 現行 auto_add_opponent_deck 呼出: `src/lib/actions/battle-actions.ts:42-46`
- 現行 delete_own_account 呼出: `src/lib/actions/account-actions.ts:73-77`
- 現行 ShareModal upload: `src/components/share/ShareModal.tsx:127-145`
- 現行 share page server-side load: `src/app/share/[id]/page.tsx:29-43`
- 既存内部 API パターン: `src/app/api/internal/detection-scan/route.ts`
- 既存 wrangler 設定: `wrangler.jsonc`
- 直前 hardening migration: `supabase/migrations/20260511000001..20260511000005`
