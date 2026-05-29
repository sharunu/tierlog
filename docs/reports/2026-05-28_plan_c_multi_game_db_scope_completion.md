# 実装報告書: Plan C Multi-Game DB Scope 本番反映完了

- 報告日: 2026-05-28
- 対象 plan: `docs/plans/2026-05-27_plan_c_multi_game_db_scope.md`
- 元レポート: `docs/reports/2026-05-27_integrated_pre_public_monetization_audit.md` §4.4
- 前提 plan:
  - `docs/reports/2026-05-27_plan_a_public_launch_safety_completion.md` (Plan A 完了済、非破壊維持)
  - `docs/reports/2026-05-27_plan_b_observability_og_seo_completion.md` (Plan B 完了済、非破壊維持)
- ステータス: **dev 実装 + Codex 6 周反映 + staging 適用 + dev preview 検証 + main 反映 + production migration + production smoke test まで完了**
- 関連 commit (新しい順):
  - `183086c Merge branch 'dev'` (main 反映、2026-05-28)
  - `f51b679 fix(plan-c): Codex 第 6 回 P1 1 件を反映 (AdminUserQualityScore 内訳表示)`
  - `189694c fix(plan-c): Codex 第 5 回 P0 3 件を反映 (staging 適用前修正)`
  - `ad7715f feat(plan-c): multi-game DB scope hardening (C-1〜C-6)`
- DB migration: **4 ファイル** (staging + production 両方適用済)
  - `20260527000002_c1_team_member_summaries_game_scope.sql`
  - `20260527000003_c2_detection_game_scope.sql`
  - `20260527000004_c3_run_detection_scan_internal_game_loop.sql`
  - `20260527000005_c4_c5_quality_scoring_game_scope.sql`

---

## 1. サマリ

統合 audit (`2026-05-27_integrated_pre_public_monetization_audit.md`) §4.4 で指摘された「マルチゲーム DB スコープ混入」問題のうち、DB/RPC レイヤに該当する 6 件 (C-1 〜 C-6、すべて P1) を Plan C として実装し、本番 (`https://tierlog.app` + Supabase production project ref `asjqtqxvwipqmtpcatvz`) まで反映を完了した。

- **C-1 `get_team_member_summaries`**: `team_members → teams JOIN` で `teams.game_title` を解決し、`battles.game_title = teams.game_title` を AND してチームメンバー戦績集計時の dm/pokepoke 混入を防止 (呼び出し側変更なし、RD-C4)
- **C-2 detection 関数 game scope**: `detect_extreme_winrate` / `detect_rapid_input` / `detect_repetitive_pattern` に `(p_params jsonb, p_game_title text)` 必須 overload を追加 (default なし、RD-C7)。NOT EXISTS 内の `da.game_title = p_game_title` 追加で game 別 dedup (RD-C1)。旧 overload は `COMMENT ON FUNCTION` で DEPRECATED 明示、Phase 2 で DROP 予定 (RD-C8)
- **C-3 `_run_detection_scan_internal`**: `FOR rule × FOREACH game (ARRAY['dm', 'pokepoke'])` 二重ループ化 (RD-C2)、`INSERT INTO detection_alerts (..., game_title, ...) SELECT d.user_id, d.rule_key, v_game_title, d.details FROM detect_*(rule.params, v_game_title) d` で `d.rule_key` 経由統一 (Codex 第 2 回)、default 'dm' 張り付き問題を解消
- **C-4 + C-5 (同一 migration / 同一 transaction)**: `quality_score_snapshots.game_title text NOT NULL DEFAULT 'dm'` 列追加 + `(user_id, game_title)` UNIQUE 追加 + 旧 `(user_id)` UNIQUE を `pg_constraint` から動的 lookup で DROP + `_calculate_quality_score_internal(uuid, text)` 新 overload + 旧 overload を全 game MAX(score) wrapper 化 + `_run_quality_scoring_internal` を二段 loop (第 1 周 score 計算、第 2 周 snapshot UPSERT with metadata) に変更 (RD-C5、Codex 第 5 回)。`profiles.stage` 判定は全 game score の MAX(score) で実施 (RD-C3)
- **C-6 既存データ TRUNCATE 手順**: 自動 migration に含めず、`docs/runbooks/plan_c_data_truncate.md` に手動 runbook 化 (preflight count → 明示承認 → pg_cron 一時停止 → TRUNCATE → 即時 re-scan → cron 再開、RD-C6)

Plan C は plan-critic 13 反復 + Codex 6 回反映 (第 1-4 回: plan 確定、第 5 回: staging 適用前 P0 3 件、第 6 回: dev preview 後 P1 1 件) を経て、staging smoke test 6 項目 + production smoke test 6 項目すべてパス。**任意外部 game scope 漏れを許容する方向への後退なし**。Plan A / Plan B 完了済の領域 (shares 二段防御 / auth `game`/`next` / BanGuard / Sentry / OG / SEO / sitemap) は一切 touch せず非破壊で維持。

---

## 2. 実装内容

### 2.1 C-1: `get_team_member_summaries` の game scope 修正

#### 背景

統合 audit §4.4: `get_team_member_summaries(p_team_id)` は `format` / `game_title` で scope せず、`team_members` 経由でメンバーを取得した後 `battles` を `user_id` だけで集約していた。`teams` は `(discord_guild_id, game_title) UNIQUE` で dm/pokepoke 別 team として分離されているにもかかわらず、同一ユーザーの全 game の battles がチームメンバー概要で混入していた。

#### 変更ファイル

- `supabase/migrations/20260527000002_c1_team_member_summaries_game_scope.sql` (新規)
- `supabase/rollback/20260527000002_rollback.sql` (新規)

#### 実装ポイント

- `team_members tm → teams t (ON t.id = tm.team_id)` を JOIN で結合し、`teams.game_title` を解決
- `LEFT JOIN public.battles b ON b.user_id = tm.user_id AND b.game_title = t.game_title` で battles を game 別に絞り込み
- 既存の `is_team_member(p_team_id, auth.uid())` 権限ガードと `tm.hidden_at IS NULL` フィルタは維持
- `SECURITY DEFINER + SET search_path = '' + public.` 修飾の既存規約準拠
- 呼び出し側 `src/lib/actions/team-actions.ts:174` は引数変更なしのため touch なし

### 2.2 C-2: detection 関数の `p_game_title` 必須 overload 追加

#### 背景

統合 audit §4.4: `detect_extreme_winrate` / `detect_rapid_input` / `detect_repetitive_pattern` は `p_params jsonb` 単引数のみで `game_title` フィルタなし。`FROM public.battles b JOIN public.profiles p` のみで集計するため、ポケポケ専用 user の異常勝率が dm 側 admin UI で「dm として」誤検出される、dm/pokepoke 両方プレイするユーザーは合算で擬陽性が増える問題があった。

#### 変更ファイル

- `supabase/migrations/20260527000003_c2_detection_game_scope.sql` (新規)
- `supabase/rollback/20260527000003_rollback.sql` (新規)

#### 実装ポイント

- 各 `detect_*` に `(p_params jsonb, p_game_title text)` の **必須引数** 新 overload を追加 (default なし、RD-C7)
- 関数本体に `AND b.game_title = p_game_title` を battles WHERE 句に追加
- NOT EXISTS 内に `AND da.game_title = p_game_title` を追加し、既解決判定も game 別に分離 (RD-C1)
- `RETURNS TABLE (user_id uuid, rule_key text, details jsonb)` は既存と同じ 3 列
- `details` JSON に `'game_title': p_game_title` を追加 (admin UI / debug 用)
- 旧 overload (`p_params jsonb` のみ) は **本 plan では DROP せず** 互換性のため保持、ただし `COMMENT ON FUNCTION ... IS 'DEPRECATED in Plan C (2026-05-27): old single-arg overload retained for compatibility only. The runner (_run_detection_scan_internal) calls the 2-arg overload (p_params, p_game_title). Scheduled for DROP in Phase 2 after pg_proc / pg_depend confirms no remaining callers.'` を全 3 関数に適用 (RD-C8)
- `REVOKE ALL ... FROM PUBLIC, anon, authenticated / GRANT EXECUTE TO service_role` の既存 grant 戦略を新 overload にも適用

### 2.3 C-3: `_run_detection_scan_internal` の game × rule 二重ループ + `detection_alerts.game_title` 正値 INSERT

#### 背景

統合 audit §4.4: `_run_detection_scan_internal` は game 別ループなし、`INSERT INTO public.detection_alerts (user_id, rule_key, details)` で `game_title` 列を省略していたため、`detection_alerts.game_title` のテーブル default 'dm' に常に張り付いていた。

#### 変更ファイル

- `supabase/migrations/20260527000004_c3_run_detection_scan_internal_game_loop.sql` (新規)
- `supabase/rollback/20260527000004_rollback.sql` (新規)

#### 実装ポイント

- `v_game_titles text[] := ARRAY['dm', 'pokepoke']` をハードコード (RD-C2、`src/lib/games/index.ts` の `GAME_SLUGS` と同期必要、ASC 順記載で action 側 tie-break と一致)
- `FOR v_rule IN ... LOOP FOREACH v_game_title IN ARRAY v_game_titles LOOP` の二重ループ化
- 各 rule_key に対して C-2 で追加した detect_* の 2 引数 overload を呼び、`INSERT INTO public.detection_alerts (user_id, rule_key, game_title, details) SELECT d.user_id, d.rule_key, v_game_title, d.details FROM public.detect_*(rule.params, v_game_title) d` で **`d.rule_key` 経由統一** (Codex 第 2 回確定、二重供給は撤回)
- dedup は detect_* 内の NOT EXISTS に集約済 (RD-C1)、runner 側は orchestration のみ
- 未知の rule_key に対する `ELSE NULL` 分岐を追加 (将来 detection rule 追加時の安全弁)
- 既存規約準拠: `SECURITY DEFINER + SET search_path = '' + REVOKE ALL ... FROM PUBLIC, anon, authenticated, service_role`

### 2.4 C-4 + C-5: quality scoring 関数 + `quality_score_snapshots` schema (同一 migration / 同一 transaction)

#### 背景

統合 audit §4.4: quality scoring は user 単位で battles を全 game 横断集約し、他ゲーム戦績で `profiles.stage` が変動し得る。`quality_score_snapshots` は `(user_id)` UNIQUE で 1 ユーザー 1 行しか持てず、game 別 score の保存不能。

RD-C5 で「列追加 + 新 UNIQUE 追加 + 旧 UNIQUE DROP + quality scoring 関数差し替え」を **同一 migration / 同一 transaction** にまとめ、旧関数が `ON CONFLICT (user_id)` を参照したまま旧 UNIQUE だけ消える中間状態を排除する設計とした。

#### 変更ファイル

- `supabase/migrations/20260527000005_c4_c5_quality_scoring_game_scope.sql` (新規、`step 1〜7` を 1 ファイルに統合)
- `supabase/rollback/20260527000005_rollback.sql` (新規、step 7 → 6 → 5 → 4 → 3 → 2 → 1 の逆順 + pokepoke 行削除)
- `src/lib/actions/admin-actions.ts` (`getQualityScoreSnapshot` の `.single()` 撤去、後述 2.6)
- `src/lib/actions/account-actions.ts` (`getMyQualityScore` の `.single()` 撤去、後述 2.6)
- `src/components/admin/AdminUserQualityScore.tsx` (breakdown metadata 除外、後述 2.7)
- `src/lib/supabase/database.types.ts` (型反映)

#### 実装ポイント (step 順)

##### step 1: `quality_score_snapshots.game_title` 列追加 (additive)

```sql
ALTER TABLE public.quality_score_snapshots
  ADD COLUMN IF NOT EXISTS game_title text NOT NULL DEFAULT 'dm';
```

既存行は `game_title = 'dm'` で埋まる。idempotent。

##### step 2: 新 `(user_id, game_title)` UNIQUE 追加

```sql
ALTER TABLE public.quality_score_snapshots
  ADD CONSTRAINT quality_score_snapshots_user_game_unique UNIQUE (user_id, game_title);
```

既存行は各 user で `(user_id, 'dm')` の組合せが UNIQUE のため衝突なし。

##### step 3: 旧 `(user_id)` UNIQUE を動的 lookup で DROP

```sql
DO $$
DECLARE v_constraint_name text;
BEGIN
  SELECT conname INTO v_constraint_name
  FROM pg_constraint
  WHERE conrelid = 'public.quality_score_snapshots'::regclass
    AND contype = 'u'
    AND pg_get_constraintdef(oid) = 'UNIQUE (user_id)';

  IF v_constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.quality_score_snapshots DROP CONSTRAINT %I', v_constraint_name);
    RAISE NOTICE 'Plan C C-5: dropped legacy UNIQUE constraint % on quality_score_snapshots', v_constraint_name;
  END IF;
END $$;
```

- staging / production とも RAISE NOTICE で実 constraint 名 `quality_score_snapshots_user_id_key` を確認 (両環境一致、Postgres default 命名 `<table>_<column>_key`)
- `pg_get_constraintdef(oid) = 'UNIQUE (user_id)'` の完全一致で「user_id 単独 UNIQUE」のみ拾い、新 `(user_id, game_title)` UNIQUE を誤検出しない

##### step 4: `_calculate_quality_score_internal(p_user_id uuid, p_game_title text)` 新 overload 追加

quality scoring の game scope ポリシー (RD-C3 + Codex 第 1 回):

| Rule カテゴリ | 例 | game scope |
|---|---|---|
| **game-level rule (battle 系)** | `recent_battles` / `opponent_diversity` / `normal_winrate` / `normal_input_pace` / `extreme_winrate_q` / `repetitive_pattern_q` / `excessive_input` | `battles` を `user_id = p_user_id AND game_title = p_game_title` で絞る |
| **game-level rule (alert 系)** | `unresolved_alerts` | `detection_alerts` を `user_id = p_user_id AND game_title = p_game_title AND is_resolved = false` で絞る |
| **game-level rule (Discord)** | `discord_linked` | `discord_connections` を `user_id = p_user_id AND game_title = p_game_title` で絞る (CLAUDE.md「Discord 連携はゲーム別独立」整合) |
| **account-level rule** | `x_linked` (`profiles.x_user_id`) / `throwaway_suspect` / `long_term_user` (`profiles.created_at`) / `admin_bonus` (`quality_admin_bonus`) | game フィルタなし、user 単位で評価 |

##### step 5: `_calculate_quality_score_internal(p_user_id uuid)` 旧 overload を MAX(score) wrapper に差し替え

- 内部で各 `v_game_title` ごとに新 overload `(p_user_id, v_game_title)` を呼び、結果を `v_max_score IS NULL OR v_total > v_max_score` の first-eligible 方式で集約
- `v_max_score := 0` 初期化は **採らない** (Codex 第 5 回): 負値スコアでも正しく MAX として扱うため NULL 初期化に統一
- 戻り値の `breakdown` JSON に `max_score` と `max_score_game_title` を追加 (debug / verification 用、RD-C3)
- 旧 signature 維持のため `calculate_quality_score(p_user_id)` admin wrapper は変更なし、admin UI / `calculateSingleUserScore` action は互換

##### step 6: `_run_quality_scoring_internal(p_auto_update boolean)` を二段 loop に変更

Codex 第 5 回 P0 反映: snapshot.breakdown に `max_score` / `max_score_game_title` を確実に保存するため:

```
1 周目: 全 game の (total_score, breakdown) を v_game_scores jsonb に蓄積
        + v_max_score / v_max_game_title を first-eligible で追跡
2 周目: v_game_scores を FOREACH IN ARRAY v_game_titles で走査
        + breakdown || jsonb_build_object('max_score', ..., 'max_score_game_title', ...)
        + ON CONFLICT (user_id, game_title) DO UPDATE で UPSERT
stage 判定: v_max_score IS NOT NULL ガード後、MAX(score) で promote/demote
```

旧版の単一 loop + `v_max_score := 0` 初期化では:
- 負値スコアで MAX 判定 0 floor に張り付く
- snapshot.breakdown に max metadata が含まれない

を Codex 第 5 回で指摘され、本実装で解決。

##### step 7: `calculate_quality_score(p_user_id)` wrapper 維持

- signature 変更なし (admin UI / action 経路の互換性維持)
- 内部実装は step 5 で差し替えた旧 overload を呼び、戻り値の `total_score` は MAX(score) になる

### 2.5 C-6: 既存 detection_alerts / quality_score_snapshots TRUNCATE 手順 (runbook 化)

#### 設計判断 (RD-C6)

- **自動 migration に含めない**: C-3 / C-5 migration では既存行に対する TRUNCATE / 大量 UPDATE は行わない
- staging / production とも以下の順序を手動運用フローとして runbook 化:
  1. preflight count (`SELECT game_title, count(*) FROM ... GROUP BY game_title`)
  2. ユーザー明示承認 (production はバックアップ確認必須)
  3. pg_cron schedule の一時停止 (`cron.unschedule('daily-detection-scan')` / `cron.unschedule('daily-quality-scoring')`)
  4. 手動 TRUNCATE SQL (`TRUNCATE TABLE public.detection_alerts; TRUNCATE TABLE public.quality_score_snapshots;`)
  5. 即時 re-scan (`SELECT public.run_detection_scan(); SELECT public.run_quality_scoring(true);`)
  6. 再生成後の count 報告
  7. pg_cron schedule 再開
- 「ユーザーゼロだから損失なし」と断定しない (production / staging ともテストデータ・admin 手動投入データの可能性)

#### 変更ファイル

- `docs/runbooks/plan_c_data_truncate.md` (新規、staging / production フロー + ロールバック方針 + 検証チェックリスト)

### 2.6 actions: `.single()` 撤去 + tie-break 順序追加

#### 背景

C-5 で `quality_score_snapshots` が `(user_id, game_title)` 複合キーになり、1 user が複数行 (dm / pokepoke) を持つようになった。`getQualityScoreSnapshot(userId)` (admin) と `getMyQualityScore()` (account) は `.eq("user_id", ...).single()` で 1 行前提で SELECT していたため、C-5 後は PGRST116 で throw する。

#### 変更ファイル

- `src/lib/actions/admin-actions.ts:794` (`getQualityScoreSnapshot`)
- `src/lib/actions/account-actions.ts:174` (`getMyQualityScore`)

#### 実装ポイント

- `.single()` を撤去
- `.order("total_score", { ascending: false }).order("game_title", { ascending: true }).limit(1)` で全 game snapshot から `total_score` 最大 row を取得
- `game_title` ASC を secondary order として追加 (Codex 第 5 回 P0)、DB wrapper の `ARRAY['dm', 'pokepoke']` first-eligible 順 (= ASC) と挙動を一致させて同点時の非決定性を解消
- 既存戻り値 shape (`total_score` / `breakdown` / `calculated_at` for admin、`totalScore` / `breakdown` for account) は維持
- per-game 表示 / game filter 引数追加 は Phase 2 / admin UI 改善 に送る (RD-C3、§10.B)

### 2.7 admin UI: breakdown metadata 除外 + 型拡張

#### 背景

Codex 第 6 回 P1 指摘 (dev preview 後): C-4 で snapshot.breakdown に `max_score` (number) と `max_score_game_title` (string) を含めたため、`AdminUserQualityScore.tsx` の `Object.entries(snapshot.breakdown).map` が全 entry を numeric score として表示する経路で:

- `max_score_game_title: "pokepoke"` が「+pokepoke」のように文字列のまま score 行に出力される
- `max_score: 60` が `total_score` の重複行として表示される

#### 変更ファイル

- `src/components/admin/AdminUserQualityScore.tsx`
- `src/lib/actions/admin-actions.ts` (`calculateSingleUserScore` 戻り値型)
- `src/lib/actions/account-actions.ts` (`getMyQualityScore` 戻り値型)

#### 実装ポイント

```ts
const BREAKDOWN_METADATA_KEYS = new Set(["max_score", "max_score_game_title"]);
```

を `AdminUserQualityScore.tsx` に追加し、表示直前に filter:

```tsx
Object.entries(snapshot.breakdown)
  .filter((entry): entry is [string, number] =>
    !BREAKDOWN_METADATA_KEYS.has(entry[0]) && typeof entry[1] === "number"
  )
  .map(([key, value]) => (...))
```

- `snapshot.breakdown` 型 を `Record<string, number>` → `Record<string, number | string>`
- `calculateSingleUserScore` / `getMyQualityScore` の戻り値 breakdown 型も `Record<string, number | string>` に拡張
- snapshot 読み込み経路 (`getQualityScoreSnapshot`) と個別再計算経路 (`calculateSingleUserScore`) の両方で同じ filter ロジックを通すため表示崩れなし

### 2.8 `database.types.ts` 反映

- `quality_score_snapshots.Row/Insert/Update` に `game_title: string` 追加
- `_calculate_quality_score_internal` を `(p_user_id)` + `(p_game_title, p_user_id)` の overload union に拡張
- `detect_extreme_winrate` / `detect_rapid_input` / `detect_repetitive_pattern` を `(p_params)` + `(p_game_title, p_params)` の overload union に拡張
- `quality_score_snapshots_user_id_fkey` の `isOneToOne` を `true` → `false` に変更 (1 user で複数 game 行を持つようになったため)

---

## 3. main commit と本番反映

### 3.1 main 反映

| 項目 | 内容 |
|---|---|
| main HEAD before | `49ccd54 Merge branch 'dev'` (Plan B 反映後) |
| main HEAD after | **`183086c Merge branch 'dev'`** (Plan C 反映、2026-05-28) |
| merge strategy | 3-way merge (`ort` strategy) |
| 取り込まれた commit | `caed2e2` (Plan B 完了報告書) / `ad7715f` (Plan C C-1〜C-6) / `189694c` (Codex 第 5 回 P0 3 件) / `f51b679` (Codex 第 6 回 P1 1 件) |
| Cloudflare 本番デプロイ | push 12:27 → 4 分後の 12:31 に `https://tierlog.app` HTTP/2 200 確認 |

### 3.2 production migration 適用結果

- 適用方法: pg ドライバ直叩き (`npx supabase` SIGILL 回避、過去 Plan A 適用と同パターン、`docs/runbooks/staging-data-sync.md` および memory `supabase-migration-ops` 準拠)
- ref guard: `production ref (asjqtqxvwipqmtpcatvz): present` / `staging ref leakage: absent` を環境変数比較で確認後に適用
- secret は `.env.staging-sync.local` の `PROD_DB_URL` 経由のみで使用、チャット出力には漏れていない
- 一時スクリプト 3 ファイル (`/tmp/plan_c_prod_*.cjs`) は適用後に削除済

```
20260527000002 c1_team_member_summaries_game_scope              APPLIED
20260527000003 c2_detection_game_scope                          APPLIED
20260527000004 c3_run_detection_scan_internal_game_loop         APPLIED
20260527000005 c4_c5_quality_scoring_game_scope                 APPLIED
  [NOTICE] Plan C C-5: dropped legacy UNIQUE constraint
           quality_score_snapshots_user_id_key on quality_score_snapshots
```

旧 UNIQUE 名 (RAISE NOTICE 記録): **`quality_score_snapshots_user_id_key`** (staging と完全一致、Postgres default 命名 `<table>_<column>_key`)。

### 3.3 post-apply 構造確認

```
quality_score_snapshots constraints:
  quality_score_snapshots_pkey [p]                   PRIMARY KEY (id)
  quality_score_snapshots_user_game_unique [u]       UNIQUE (user_id, game_title)     ← 新
  quality_score_snapshots_user_id_fkey [f]           FK to profiles(id) CASCADE
  (旧 quality_score_snapshots_user_id_key 消滅)

quality_score_snapshots columns:
  id (uuid, NOT NULL)
  user_id (uuid, NOT NULL)
  total_score (integer, default=0, NOT NULL)
  breakdown (jsonb, default='{}', NOT NULL)
  calculated_at (timestamptz, default=now(), NOT NULL)
  game_title (text, default='dm', NOT NULL)                                          ← 新
```

---

## 4. production smoke test 結果

| # | 項目 | 結果 |
|---|---|---|
| 1 | pre-scan counts | `detection_alerts` dm=24 (Plan C 適用前の default 'dm' 既存) / `quality_score_snapshots` dm=7 (migration で default 'dm' 充填) |
| 2 | `SELECT public.run_detection_scan()` | **alerts=0** (新規 INSERT 0 件、既存 24 件の `is_resolved=false` alert により detect_* の NOT EXISTS dedup が抑止、game 別 dedup ロジックが正常動作) |
| 3 | `SELECT public.run_quality_scoring(true)` | `{calculated:14, promoted:0, demoted:0, threshold:100}` → **7 users × 2 games = 14 件 UPSERT** ✅、stage 変動 0 |
| 4-a | post-scan `quality_score_snapshots` | dm: 7, pokepoke: 7 (user × game 別 row 生成完了) |
| 4-b | `breakdown ? 'max_score_game_title'` 不在 row | **0** (全 14 行に metadata 入り) ✅ |
| 4-c | サンプル: `user=7387c697...` | dm total=**1010**, pokepoke total=**1015**, max_score=**1015**, max_score_game_title=**pokepoke** → 別 game 別 score を持つユーザーで MAX(score) 判定が正しく pokepoke 側を選択 ✅ |
| 4-d | サンプル: `user=05124794...` (dm=5, pokepoke=5 同点) | max_score_game_title=**dm** (ARRAY['dm','pokepoke'] tie-break 順) ✅ |
| 5 | post-scan detection_alerts | dm/rapid_input:5, dm/repetitive_pattern:19 (= 既存 24 件、新規 INSERT 0、整合) |
| 6-a | `get_team_member_summaries` 関数本体 | `JOIN public.teams t` + `b.game_title = t.game_title` 含む ✅ C-1 deployed |
| 6-b | `_run_detection_scan_internal` 関数本体 | `ARRAY['dm', 'pokepoke']` + `FOREACH v_game_title` 含む ✅ C-3 deployed |
| 6-c | overloads 8 件 | `detect_extreme_winrate/rapid_input/repetitive_pattern` の `(jsonb)` + `(jsonb, text)`、`_calculate_quality_score_internal` の `(uuid)` + `(uuid, text)` すべて存在 ✅ |
| 6-d | 旧 overload DEPRECATED COMMENT | `detect_*` の 3 関数全てに `'DEPRECATED in Plan C (2026-05-27)...'` 適用済 ✅ |

### 4.1 staging smoke test (本番反映前、参考)

production と同パターンで staging (project ref `uqndrkaxmbfjuiociuns`) でも全項目 OK 確認済:

- `run_detection_scan()` alerts=0 / `run_quality_scoring(true)` calculated=10 (5 users × 2 games)
- 旧 UNIQUE 名 `quality_score_snapshots_user_id_key` を NOTICE で確認
- `breakdown.max_score_game_title` 全行充填
- 負値スコア (`user=d4669... dm=-15, pokepoke=-15`) でも MAX(score) が `-15` として正しく扱われる (Codex 第 5 回 NULL 初期化方式)

---

## 5. 既知の保留事項 — 既存 detection_alerts 24 件 (C-6)

production preflight で `detection_alerts` 24 件 (全て `game_title='dm'` 固定) が確認された。これらは Plan C 適用前の default 'dm' で記録されたデータで、以下の可能性がある:

- **真に dm 戦績由来**: 該当ユーザーが dm の異常入力を行った正当な alert
- **誤分類 (pokepoke 由来)**: pokepoke 戦績の異常を旧 runner が `game_title` 列省略で INSERT したため default 'dm' に張り付いた可能性

現状の Plan C 後の挙動:

- 新規 alert は正しく `game_title` 別に INSERT される (C-3 deployed)
- detect_* の NOT EXISTS は `da.game_title = p_game_title` で game 別 dedup するため、既存 24 件は dm 側だけで dedup 効果を持つ
- pokepoke 側は dedup 抑止されないため、pokepoke ユーザーで再度異常が出れば新規 INSERT される (この場合 `detection_alerts.game_title='pokepoke'` で記録)

**今回は C-6 TRUNCATE を保留** (ユーザー指示)。誤分類を完全にクリーンアップするには:

1. `docs/runbooks/plan_c_data_truncate.md` の手順に従う
2. preflight count → 明示承認 → pg_cron 一時停止 → `TRUNCATE public.detection_alerts` (必要なら `quality_score_snapshots` も) → `run_detection_scan() + run_quality_scoring(true)` 即時 re-scan → cron 再開

または、誤分類を許容して上書きせず運用するのも選択肢 (新規 alert は正しく分類されるため、運用に支障が出るまで様子見も可)。**判断は別途**。

`quality_score_snapshots` の 14 件 (dm 7 + pokepoke 7) は smoke test で全行 metadata 入りで再生成済のため C-6 対象外。

---

## 6. Plan A / Plan B 非破壊確認

Plan C で touch していない領域 (Plan A / Plan B 完了済):

| Plan A / B の機能 | Plan C での影響 |
|---|---|
| A-1 `shares.image_url` 二段防御 (DB trigger + display sanitizer) | ✅ 影響なし。`shares` テーブル / `is_safe_share_image_url` / `sanitizeShareImageUrl` 一切 touch なし |
| A-2 legacy URL / `<HomeLink>` / `loading.tsx` / `global-error.tsx` / 文字化け修正 | ✅ 影響なし。UI / route 一切 touch なし |
| A-3 BanGuard retry + fail-open + `LoadingSpinner` | ✅ 影響なし。`BanGuard.tsx` touch なし |
| A-4 共有 / 未ログイン導線 `game/next` + open redirect 防御 | ✅ 影響なし。`auth/*` touch なし |
| B-1 Sentry scrubber / release / environment | ✅ 影響なし。`src/sentry-worker.ts` touch なし |
| B-2 OG ルートのフォント自前 + cache / fallback | ✅ 影響なし。`/api/og/[id]` touch なし |
| B-3 noindex / metadata / X-Robots-Tag / `<meta robots>` | ✅ 影響なし。`next.config.ts` / 公開ページ metadata touch なし |
| B-4 公開ランディング + sitemap + BanGuard exact + prefix 二段判定 | ✅ 影響なし |
| B-5 Observability runbook | ✅ 影響なし |
| B-6 法務 gap analysis | ✅ 影響なし |

Plan C 変更ファイル一覧 (commit `ad7715f` + `189694c` + `f51b679` の差分):

- 新規 migration 4 / 新規 rollback 4 (`supabase/migrations/2026052700000[2-5]*` / `supabase/rollback/2026052700000[2-5]*`)
- 新規 plan / 新規 runbook (`docs/plans/2026-05-27_plan_c_*.md` / `docs/runbooks/plan_c_data_truncate.md`)
- TypeScript 編集 4 ファイル (`src/lib/actions/account-actions.ts` / `src/lib/actions/admin-actions.ts` / `src/lib/supabase/database.types.ts` / `src/components/admin/AdminUserQualityScore.tsx`)

いずれも shares / auth / BanGuard / Sentry / OG / SEO 領域とは独立した DB レイヤ + 関連 admin/account action のみで、Plan A / Plan B 機能の後退はない。

---

## 7. 残スコープ (Phase 2 / Phase 3 / 別 plan)

### 7.1 Phase 2 (Plan E 等、Plan C 直後で着手可)

- **`detection_rules` / `quality_scoring_rules` / `quality_scoring_settings` の game 別化**: 現状グローバル設定で十分 (game 別ルールが必要になったら別 issue、§10.B)
- **admin UI で alert / snapshot の game_title フィルタ / 表示列追加**: 現在 admin UI は account-level 表示のみ (per-game 表示拡張、§10.B)
- **`team_members.game_title` redundant column**: `get_team_member_summaries` の JOIN コスト削減目的 (Plan C では JOIN で対応、§10.B)
- **`public.games (slug text PRIMARY KEY)` マスタテーブル化 + 動的取得**: detection scan / quality scoring runner が `ARRAY['dm', 'pokepoke']` ハードコードから DB master に移行 (新ゲーム追加運用の自動化、RD-C2 / §10.B)
- **detection 関数の旧 overload DROP**: Phase 2 contract migration として `DROP FUNCTION public.detect_*(jsonb)`。`pg_proc` / `pg_depend` で旧 overload に依存する未知 caller がいないことを確認してから DROP (RD-C8)

### 7.2 Plan D (Access Gate / Auth Expiry)

- ban / suspended / unpaid 強制
- `getUser()` 用途整理 / middleware session refresh
- **Plan C の `profiles.stage` 更新ロジック (MAX(score)) と接続するため、Plan D 設計時に再評価**
- stage を game 別に分離する案 (account-level stage 集約をやめる) は Plan D 以降の検討事項 (§10.B)

### 7.3 Plan E (Phase 2、運用改善)

- 初回オンボーディング
- `recharts` lazy loading
- Discord refresh token
- `npm test` 復旧

### 7.4 Phase 3 (Billing / Ads / Legal)

- Stripe 課金
- consent UI
- 特商法ページ
- GDPR / AdSense 対応

### 7.5 既存 24 件 detection_alerts の扱い (§5 再掲)

- C-6 TRUNCATE を実施するか、誤分類を許容して新規 alert のみ正しく分類するか別途判断

---

## 8. 反復履歴

### 8.1 plan 反復

- plan-critic 累計 **13 反復** (Plan A / Plan B と同パターン)
- Codex review **4 回** (第 1〜4 回): plan 確定
  - 第 1 回: RD-C4〜C-9 追加 (5 件確定)、§10.A 全件 resolved
  - 第 2 回: 文書整合 + 細部整理 (6 件、新規 RD なし)
  - 第 3 回: §5.1 / §5.2 / §12 整合
  - 第 4 回: snapshot caller 固定 + pg_cron 前提整理 + ヘッダ「完成 / 実装可能水準」
- 累計未解決質問: **0 件** (RD-C1〜C-9 で完結)

### 8.2 実装反復

- 実装初版 commit `ad7715f` (2026-05-27)
- Codex 第 5 回 (staging 適用前 P0 3 件、commit `189694c`):
  1. `_run_quality_scoring_internal` の `v_max_score := 0` 初期化問題 → NULL 初期化 first-eligible 方式
  2. snapshot.breakdown に `max_score` / `max_score_game_title` 不在 → 二段 loop で metadata 含めて UPSERT
  3. action の `.limit(1)` で同点時非決定的 → `.order("game_title", asc)` secondary order 追加
- Codex 第 6 回 (dev preview 後 P1 1 件、commit `f51b679`):
  1. `AdminUserQualityScore.tsx` で breakdown metadata が score 行に混入 → `BREAKDOWN_METADATA_KEYS` Set + `typeof === "number"` filter

Codex 第 6 回後の再レビューで GO 判定、staging 適用 → dev preview 実機確認 OK → 本番反映で完了。

---

## 9. 補足

- 本 plan は統合 audit §4.4 の「マルチゲーム DB スコープ混入」P1 6 件を解消するもの
- Plan A / Plan B 完了報告と整合しており、Plan A / Plan B が touch した領域には Plan C で再度触らない方針を完遂
- Plan D (Access Gate / Auth Expiry) は Plan C の `profiles.stage` 更新ロジックと接続するため、Plan C 完了後に着手する想定
- Phase 2 / Phase 3 は本 plan と独立して別途作成

Plan C 本番反映により、tierlog の DB / RPC レイヤにおける game scope 混入の主要経路 (team summary / detection 系 / quality scoring 系) はすべて閉じられた。新ゲーム追加時の運用は `src/lib/games/index.ts` + `_run_detection_scan_internal` / `_run_quality_scoring_internal` / `_calculate_quality_score_internal` の `v_game_titles ARRAY` を同期更新する形で対応可能 (Phase 2 で `public.games` マスタテーブル化を予告)。
