-- Plan C C-4 + C-5: quality_score_snapshots の game scope 化 + quality scoring 関数差し替え
--
-- 本 migration は RD-C5 に従い **同一 migration / 同一 transaction** で以下をまとめて適用する。
-- これにより、旧関数が `ON CONFLICT (user_id)` を参照したまま旧 UNIQUE だけ消える中間状態を排除する。
--
--   step 1: quality_score_snapshots.game_title text NOT NULL DEFAULT 'dm' 列追加 (additive)
--   step 2: (user_id, game_title) UNIQUE 制約追加
--   step 3: 旧 (user_id) UNIQUE 制約を pg_constraint から実名 lookup して DROP
--   step 4: _calculate_quality_score_internal(p_user_id, p_game_title) 新 overload 追加
--   step 5: _calculate_quality_score_internal(p_user_id) 旧 overload を全 game MAX(score) wrapper に差し替え
--   step 6: _run_quality_scoring_internal(p_auto_update) を game × user 二重ループ + ON CONFLICT (user_id, game_title)
--   step 7: calculate_quality_score(p_user_id) 公開 wrapper の grant 維持 (本体は step 5 の旧 overload を呼ぶ)
--
-- 既存規約準拠 (20260509000001 / 20260509000004 と同パターン):
--   - SECURITY DEFINER + SET search_path = '' + public. 修飾
--   - internal 関数は EXECUTE 全閉鎖 (REVOKE ALL FROM PUBLIC, anon, authenticated, service_role)
--   - 公開 wrapper (calculate_quality_score / run_quality_scoring) は authenticated, service_role に GRANT
--
-- 旧 UNIQUE 名 (想定): `quality_score_snapshots_user_id_key`
--   ※ 20260414000001:26 で `UNIQUE(user_id)` 列レベル UNIQUE を指定したため、
--     Postgres デフォルトの自動命名は `<table>_<column>_key` 形式。
--   ※ ただし staging / production の履歴によって命名が異なる可能性があるため、
--     step 3 では pg_constraint から動的に lookup して DROP する。
--     RAISE NOTICE で実 constraint 名がログに出るので、production 適用時に staging ログと照合できる。
--
-- 本 migration は明示的に BEGIN/COMMIT を書かない: Supabase の `supabase db push` は
-- 各 migration ファイルを単一 transaction で実行するため、PLAN C RD-C5 の要件
-- 「同一 transaction で完結」は自動的に満たされる。
-- (`supabase db push` のソースコード上、各 .sql ファイルは PostgreSQL 接続上で
--  `BEGIN; <file content>; COMMIT;` 相当のブロックとして適用される)

-- =============================================================================
-- step 1: quality_score_snapshots.game_title 列追加 (additive)
-- =============================================================================

ALTER TABLE public.quality_score_snapshots
  ADD COLUMN IF NOT EXISTS game_title text NOT NULL DEFAULT 'dm';

-- =============================================================================
-- step 2: (user_id, game_title) 複合 UNIQUE 追加
--   既存行は game_title = 'dm' で埋まるため、各 user で (user_id, 'dm') が
--   1 行ずつしかなく衝突しない。
-- =============================================================================

ALTER TABLE public.quality_score_snapshots
  ADD CONSTRAINT quality_score_snapshots_user_game_unique UNIQUE (user_id, game_title);

-- =============================================================================
-- step 3: 旧 (user_id) UNIQUE 制約を pg_constraint から動的 lookup して DROP
--   想定名は quality_score_snapshots_user_id_key だが、命名規約の差を吸収するため
--   動的 DROP で対応する。
--   - contype = 'u' (UNIQUE) のみ対象。PRIMARY KEY (id) には触れない。
--   - pg_get_constraintdef(oid) = 'UNIQUE (user_id)' で「user_id 単独 UNIQUE」のみ拾う。
--     新規追加した (user_id, game_title) UNIQUE は 'UNIQUE (user_id, game_title)' になるため
--     誤検出しない。
-- =============================================================================

DO $$
DECLARE
  v_constraint_name text;
BEGIN
  SELECT conname
  INTO v_constraint_name
  FROM pg_constraint
  WHERE conrelid = 'public.quality_score_snapshots'::regclass
    AND contype = 'u'
    AND pg_get_constraintdef(oid) = 'UNIQUE (user_id)';

  IF v_constraint_name IS NOT NULL THEN
    EXECUTE format(
      'ALTER TABLE public.quality_score_snapshots DROP CONSTRAINT %I',
      v_constraint_name
    );
    RAISE NOTICE 'Plan C C-5: dropped legacy UNIQUE constraint % on quality_score_snapshots', v_constraint_name;
  ELSE
    RAISE NOTICE 'Plan C C-5: no legacy UNIQUE (user_id) constraint found on quality_score_snapshots (likely already migrated)';
  END IF;
END $$;

-- =============================================================================
-- step 4: _calculate_quality_score_internal(p_user_id, p_game_title) 新 overload 追加
--   - battle / discord_connections / unresolved_alerts は game-level (p_game_title で絞る)
--   - admin bonus / X 連携 (x_user_id) は account-level (game_title では絞らない)
-- =============================================================================

CREATE OR REPLACE FUNCTION public._calculate_quality_score_internal(
  p_user_id uuid,
  p_game_title text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  rule record;
  v_score integer := 0;
  v_breakdown jsonb := '{}';
  v_profile record;
  v_matches boolean;
  v_battle_count bigint;
  v_win_count bigint;
  v_admin_bonus integer;
  v_rate numeric;
BEGIN
  -- プロフィール取得（ゲストは対象外）
  SELECT * INTO v_profile FROM public.profiles WHERE id = p_user_id AND is_guest = false;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('total_score', 0, 'breakdown', '{}'::jsonb, 'eligible', false);
  END IF;

  -- 有効なルールをループ
  FOR rule IN SELECT * FROM public.quality_scoring_rules WHERE is_enabled = true LOOP
    v_matches := false;

    CASE rule.rule_key

      -- account-level: x_user_id はゲーム共通属性
      WHEN 'x_linked' THEN
        v_matches := v_profile.x_user_id IS NOT NULL;

      -- game-level: discord_connections(user_id, game_title) は game 別独立
      WHEN 'discord_linked' THEN
        SELECT EXISTS (
          SELECT 1 FROM public.discord_connections
          WHERE user_id = p_user_id AND game_title = p_game_title
        ) INTO v_matches;

      -- account-level: アカウント作成日
      WHEN 'throwaway_suspect' THEN
        v_matches := v_profile.created_at > now() - ((rule.params->>'max_days')::integer || ' days')::interval;

      WHEN 'long_term_user' THEN
        v_matches := v_profile.created_at <= now() - ((rule.params->>'min_days')::integer || ' days')::interval;

      -- game-level: battle 系
      WHEN 'recent_battles' THEN
        SELECT COUNT(*) INTO v_battle_count
        FROM public.battles
        WHERE user_id = p_user_id
          AND game_title = p_game_title
          AND fought_at >= now() - ((rule.params->>'period_days')::integer || ' days')::interval;
        v_matches := v_battle_count >= (rule.params->>'min_battles')::integer;

      WHEN 'opponent_diversity' THEN
        WITH last_n AS (
          SELECT opponent_deck_name
          FROM public.battles
          WHERE user_id = p_user_id
            AND game_title = p_game_title
          ORDER BY fought_at DESC
          LIMIT (rule.params->>'last_n_battles')::integer
        )
        SELECT COUNT(DISTINCT opponent_deck_name) INTO v_battle_count FROM last_n;
        v_matches := v_battle_count >= (rule.params->>'min_distinct')::integer;

      WHEN 'normal_winrate' THEN
        SELECT COUNT(*), COUNT(*) FILTER (WHERE result = 'win')
        INTO v_battle_count, v_win_count
        FROM public.battles
        WHERE user_id = p_user_id AND game_title = p_game_title;
        IF v_battle_count >= (rule.params->>'min_battles')::integer THEN
          v_rate := v_win_count * 100.0 / v_battle_count;
          v_matches := v_rate >= (rule.params->>'min_rate')::numeric
                   AND v_rate <= (rule.params->>'max_rate')::numeric;
        END IF;

      WHEN 'normal_input_pace' THEN
        SELECT COUNT(*) INTO v_battle_count
        FROM public.battles
        WHERE user_id = p_user_id
          AND game_title = p_game_title
          AND fought_at >= now() - ((rule.params->>'window_hours')::integer || ' hours')::interval;
        v_matches := v_battle_count >= (rule.params->>'min_battles')::integer
                 AND v_battle_count <= (rule.params->>'max_battles')::integer;

      -- game-level: detection_alerts は game_title 別 INSERT (Plan C C-3)
      WHEN 'unresolved_alerts' THEN
        SELECT EXISTS (
          SELECT 1 FROM public.detection_alerts
          WHERE user_id = p_user_id
            AND game_title = p_game_title
            AND is_resolved = false
        ) INTO v_matches;

      WHEN 'extreme_winrate_q' THEN
        SELECT COUNT(*), COUNT(*) FILTER (WHERE result = 'win')
        INTO v_battle_count, v_win_count
        FROM public.battles
        WHERE user_id = p_user_id AND game_title = p_game_title;
        IF v_battle_count >= (rule.params->>'min_battles')::integer THEN
          v_rate := v_win_count * 100.0 / v_battle_count;
          v_matches := v_rate > (rule.params->>'high_rate')::numeric
                    OR v_rate < (rule.params->>'low_rate')::numeric;
        END IF;

      WHEN 'repetitive_pattern_q' THEN
        WITH numbered AS (
          SELECT
            opponent_deck_name, result, fought_at,
            ROW_NUMBER() OVER (ORDER BY fought_at) -
            ROW_NUMBER() OVER (PARTITION BY opponent_deck_name, result ORDER BY fought_at) AS grp
          FROM public.battles
          WHERE user_id = p_user_id AND game_title = p_game_title
        ),
        streaks AS (
          SELECT COUNT(*) AS streak_len
          FROM numbered
          GROUP BY opponent_deck_name, result, grp
          HAVING COUNT(*) >= (rule.params->>'max_consecutive')::integer
        )
        SELECT EXISTS (SELECT 1 FROM streaks) INTO v_matches;

      WHEN 'excessive_input' THEN
        SELECT COUNT(*) INTO v_battle_count
        FROM public.battles
        WHERE user_id = p_user_id
          AND game_title = p_game_title
          AND fought_at >= now() - ((rule.params->>'window_hours')::integer || ' hours')::interval;
        v_matches := v_battle_count >= (rule.params->>'max_battles')::integer;

      ELSE
        v_matches := false;

    END CASE;

    IF v_matches THEN
      v_score := v_score + rule.score;
      v_breakdown := v_breakdown || jsonb_build_object(rule.rule_key, rule.score);
    END IF;
  END LOOP;

  -- account-level: 管理者ボーナス加算 (game フィルタなし)
  SELECT score INTO v_admin_bonus FROM public.quality_admin_bonus WHERE user_id = p_user_id;
  IF v_admin_bonus IS NOT NULL THEN
    v_score := v_score + v_admin_bonus;
    v_breakdown := v_breakdown || jsonb_build_object('admin_bonus', v_admin_bonus);
  END IF;

  RETURN jsonb_build_object('total_score', v_score, 'breakdown', v_breakdown, 'eligible', true);
END;
$$;
REVOKE ALL ON FUNCTION public._calculate_quality_score_internal(uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;

-- =============================================================================
-- step 5: _calculate_quality_score_internal(p_user_id) 旧 overload を
--   「全 game の MAX(score)」を返す wrapper に差し替え (RD-C3)
--   - calculate_quality_score(p_user_id) 公開 wrapper の戻り値 shape (total_score / breakdown / eligible)
--     を維持しつつ、breakdown に max_score / max_score_game_title を含めて debug / verification 用とする。
--   - 旧 wrapper の戻り値が「全 game 合算」だった挙動から「MAX(score)」に変わるが、
--     admin UI (AdminUserQualityScore) は total_score を表示するだけなので互換。
-- =============================================================================

CREATE OR REPLACE FUNCTION public._calculate_quality_score_internal(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_game_title text;
  -- Plan C RD-C2: src/lib/games/index.ts の GAME_SLUGS と同期が必要。
  v_game_titles text[] := ARRAY['dm', 'pokepoke'];
  v_result jsonb;
  v_total integer;
  v_max_score integer := 0;
  v_max_breakdown jsonb := '{}'::jsonb;
  v_max_game_title text := NULL;
  v_eligible boolean := false;
BEGIN
  -- プロフィール存在確認 (ゲストは対象外)
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles WHERE id = p_user_id AND is_guest = false
  ) THEN
    RETURN jsonb_build_object('total_score', 0, 'breakdown', '{}'::jsonb, 'eligible', false);
  END IF;

  FOREACH v_game_title IN ARRAY v_game_titles
  LOOP
    v_result := public._calculate_quality_score_internal(p_user_id, v_game_title);

    IF (v_result->>'eligible')::boolean THEN
      v_eligible := true;
      v_total := (v_result->>'total_score')::integer;
      -- 同点時は最初に当たった game を優先 (v_max_game_title IS NULL の分岐で初回採用)
      IF v_max_game_title IS NULL OR v_total > v_max_score THEN
        v_max_score := v_total;
        v_max_breakdown := v_result->'breakdown';
        v_max_game_title := v_game_title;
      END IF;
    END IF;
  END LOOP;

  IF v_max_game_title IS NULL THEN
    v_max_game_title := 'dm';
  END IF;

  -- RD-C3: breakdown に max_score と max_score_game_title を含めて debug / verification 用
  v_max_breakdown := v_max_breakdown
    || jsonb_build_object(
      'max_score', v_max_score,
      'max_score_game_title', v_max_game_title
    );

  RETURN jsonb_build_object(
    'total_score', v_max_score,
    'breakdown', v_max_breakdown,
    'eligible', v_eligible
  );
END;
$$;
REVOKE ALL ON FUNCTION public._calculate_quality_score_internal(uuid)
  FROM PUBLIC, anon, authenticated, service_role;

-- =============================================================================
-- step 6: _run_quality_scoring_internal(p_auto_update) を game × user 二重ループに変更
--
--   Codex 第 5 回反映:
--   - v_max_score を NULL 初期化に変更し、wrapper 側と同じ first-eligible 方式で
--     負値スコアも正しく MAX として扱う (`v_max_game_title IS NULL OR v_total > v_max_score`)。
--     旧実装は v_max_score := 0 だったため、全 game の score が負値だと MAX(score) が
--     0 として誤判定される問題があった。
--   - **二段 loop** に変更:
--       * 第 1 周: 各 game の (total_score, breakdown) を v_game_scores jsonb に蓄積し、
--         v_max_score / v_max_game_title を確定する。
--       * 第 2 周: v_game_scores を走査して snapshot を UPSERT。
--         breakdown には **max_score / max_score_game_title を含めて** 保存し、
--         runbook の `SELECT breakdown->>'max_score_game_title'` 検証が通る形にする。
--   - v_game_titles は ASC 順 (`dm` → `pokepoke`) で記載 (RD-C2)。
--     これは action 側 (`getMyQualityScore` / `getQualityScoreSnapshot`) の
--     `.order("game_title", ascending: true)` tie-break と挙動を一致させる目的。
--     新ゲーム追加時は ASC 順を維持すること (alphabetic sort で挿入)。
-- =============================================================================

CREATE OR REPLACE FUNCTION public._run_quality_scoring_internal(p_auto_update boolean DEFAULT true)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user record;
  v_game_title text;
  -- RD-C2: src/lib/games/index.ts の GAME_SLUGS と同期。
  -- ASC 順で記載 (action 側 .order("game_title", asc) tie-break と一致させる目的)。
  v_game_titles text[] := ARRAY['dm', 'pokepoke'];
  v_result jsonb;
  v_total integer;
  v_threshold integer;
  v_max_score integer;
  v_max_game_title text;
  v_game_scores jsonb;          -- {game_title: {total_score, breakdown}}
  v_game_score_entry jsonb;
  v_breakdown_with_max jsonb;
  v_promoted integer := 0;
  v_demoted integer := 0;
  v_calculated integer := 0;
BEGIN
  -- 閾値取得
  SELECT (value#>>'{}')::integer INTO v_threshold
  FROM public.quality_scoring_settings WHERE key = 'threshold';
  IF v_threshold IS NULL THEN v_threshold := 40; END IF;

  FOR v_user IN
    SELECT id, stage FROM public.profiles WHERE is_guest = false
  LOOP
    -- NULL 初期化 (Codex 第 5 回): 負値スコアも正しく first-eligible で MAX として扱う
    v_max_score := NULL;
    v_max_game_title := NULL;
    v_game_scores := '{}'::jsonb;

    -- 第 1 周: 各 game の score 計算 + max 追跡 (snapshot UPSERT はまだしない)
    FOREACH v_game_title IN ARRAY v_game_titles
    LOOP
      v_result := public._calculate_quality_score_internal(v_user.id, v_game_title);

      IF (v_result->>'eligible')::boolean THEN
        v_total := (v_result->>'total_score')::integer;

        -- 第 2 周のために (total_score, breakdown) を蓄積
        v_game_scores := v_game_scores || jsonb_build_object(
          v_game_title,
          jsonb_build_object(
            'total_score', v_total,
            'breakdown', v_result->'breakdown'
          )
        );

        -- account-level の MAX(score) 追跡 (first-eligible or strictly greater)
        IF v_max_game_title IS NULL OR v_total > v_max_score THEN
          v_max_score := v_total;
          v_max_game_title := v_game_title;
        END IF;
      END IF;
    END LOOP;

    -- 第 2 周: snapshot UPSERT (breakdown に max_score / max_score_game_title を含めて保存)
    IF v_max_game_title IS NOT NULL THEN
      FOREACH v_game_title IN ARRAY v_game_titles
      LOOP
        v_game_score_entry := v_game_scores -> v_game_title;
        IF v_game_score_entry IS NOT NULL THEN
          v_total := (v_game_score_entry->>'total_score')::integer;
          v_breakdown_with_max := (v_game_score_entry->'breakdown')
            || jsonb_build_object(
              'max_score', v_max_score,
              'max_score_game_title', v_max_game_title
            );

          INSERT INTO public.quality_score_snapshots
            (user_id, game_title, total_score, breakdown, calculated_at)
          VALUES
            (v_user.id, v_game_title, v_total, v_breakdown_with_max, now())
          ON CONFLICT (user_id, game_title) DO UPDATE SET
            total_score = EXCLUDED.total_score,
            breakdown = EXCLUDED.breakdown,
            calculated_at = EXCLUDED.calculated_at;

          v_calculated := v_calculated + 1;
        END IF;
      END LOOP;
    END IF;

    -- ステージ自動遷移 (MAX(score) で判定。v_max_score IS NULL は全 game ineligible のためスキップ)
    IF p_auto_update AND v_max_score IS NOT NULL THEN
      IF v_max_score >= v_threshold AND v_user.stage = 2 THEN
        UPDATE public.profiles SET stage = 1 WHERE id = v_user.id;
        INSERT INTO public.user_stage_history (user_id, from_stage, to_stage, reason, changed_by)
        VALUES (v_user.id, 2, 1, '品質スコア自動昇格 (max_score=' || v_max_score || ', threshold=' || v_threshold || ')', v_user.id);
        v_promoted := v_promoted + 1;
      ELSIF v_max_score < v_threshold AND v_user.stage = 1 THEN
        UPDATE public.profiles SET stage = 2 WHERE id = v_user.id;
        INSERT INTO public.user_stage_history (user_id, from_stage, to_stage, reason, changed_by)
        VALUES (v_user.id, 1, 2, '品質スコア自動降格 (max_score=' || v_max_score || ', threshold=' || v_threshold || ')', v_user.id);
        v_demoted := v_demoted + 1;
      END IF;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'calculated', v_calculated,
    'promoted', v_promoted,
    'demoted', v_demoted,
    'threshold', v_threshold
  );
END;
$$;
REVOKE ALL ON FUNCTION public._run_quality_scoring_internal(boolean)
  FROM PUBLIC, anon, authenticated, service_role;

-- =============================================================================
-- step 7: calculate_quality_score(p_user_id) 公開 wrapper は CREATE OR REPLACE で
--   再定義し、内部実装 (step 5 の旧 overload を呼ぶ) は変更なし。grant も維持。
--   - admin UI からは calculate_quality_score(p_user_id) として既存 signature で呼ばれる。
--   - 戻り値は step 5 の新実装により MAX(score) になる (admin UI の表示は互換)。
-- =============================================================================

CREATE OR REPLACE FUNCTION public.calculate_quality_score(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT (
    auth.role() = 'service_role'
    OR (
      auth.uid() IS NOT NULL
      AND EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = true)
    )
  ) THEN
    RAISE EXCEPTION 'admin only' USING ERRCODE = '42501';
  END IF;
  RETURN public._calculate_quality_score_internal(p_user_id);
END;
$$;
REVOKE ALL ON FUNCTION public.calculate_quality_score(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.calculate_quality_score(uuid) TO authenticated, service_role;
