# 対面デッキリスト 更新方式ロジック修正

作成日: 2026-05-20 / 対象ブランチ: dev

## 1. 概要・ゴール

「対面デッキリスト」(`opponent_deck_master`) の更新方式 3 パターンのうち 2 つを修正する。

| # | 更新方式 (`management_mode`) | 修正内容 |
|---|---|---|
| 1 | 管理者依存 (`admin`) | 未登録デッキ名が対戦記録で入力されたとき、現状 `other`/`無効` で追加されるのを `other`/`有効` で追加するよう変更 |
| 2 | ユーザー入力依存 (`auto`) | 現状「閾値方式」のみのカテゴリ分類に「デッキ数固定方式」を追加し、管理画面で選択可能にする |
| 3 | limitless依存 (`limitless`) | **修正しない** (確認のみ) |

## 2. 現状調査結果

### 2.1 RPC / トリガーの最新定義 (grep 確認済)

- `auto_add_opponent_deck(text,text,text)` — 最新定義: `supabase/migrations/20260513000003_auto_add_opponent_deck_revoke.sql` 9-57 行
- `_recalculate_opponent_decks_internal(text,text)` — 唯一の定義: `supabase/migrations/20260426005408_secdef_search_path.sql` 106-220 行
- `recalculate_opponent_decks(text,text)` — 最新本体: 同 225-242 行 (admin 判定後に internal helper を `PERFORM`)
- `run_daily_opponent_deck_batch()` — 最新本体: 同 247-263 行 (4 つの format/game を internal helper で順次処理)
- `battles AFTER INSERT` トリガー `battles_auto_add_opponent_deck` → `trg_battles_auto_add_opponent_deck()` → `auto_add_opponent_deck()` — `supabase/migrations/20260513000002_auto_add_opponent_deck_trigger.sql` 10-31 行
- `20260426050849` / `20260512000001` は上記 RPC を **再定義しない** (コメント参照・GRANT のみ)

### 2.2 Pattern 1 の現状: `auto_add_opponent_deck` (`20260513000003` 9-57 行)

対戦記録 INSERT → トリガー → `auto_add_opponent_deck()`。新規デッキの INSERT 分岐 (49-55 行):

```sql
IF v_mode = 'auto' THEN
  INSERT ... VALUES (p_deck_name, ..., 'other', true,  v_max_sort + 10, now());
ELSE
  INSERT ... VALUES (p_deck_name, ..., 'other', false, v_max_sort + 10, now());
END IF;
```

`ELSE` 分岐が **`admin` と `limitless` の両モードで共有**されており、両方とも `is_active=false` で追加される。`auto` のみ `is_active=true`。
→ Pattern 1 は「`admin` だけ `true` にし、`limitless` は `false` のまま」にする必要があるため、分岐の分離が必須。

既存デッキの UPDATE 分岐 (37-43 行) は `is_active = CASE WHEN v_mode='auto' THEN true ELSE is_active END` で、`admin`/`limitless` は既存値を据え置く。**本件のスコープは「リストに無いデッキ名 = 新規 INSERT」のみ**なので、この UPDATE 分岐は変更しない。

### 2.3 Pattern 2 の現状: `_recalculate_opponent_decks_internal` (`20260426005408` 106-220 行)

`auto` モードのカテゴリ分類は **閾値方式のみ**:

```sql
UPDATE ... SET category = CASE
  WHEN du.usage_rate >= v_settings.major_threshold THEN 'major'
  WHEN du.usage_rate >= v_settings.minor_threshold THEN 'minor'
  ELSE 'other'
END ...
```

処理順は「分類 → sort_order 振り直し → 無効化 (`disable_period_days` 超過)」。
`usage_rate = (battle_count + admin_bonus_count) * 100 / (期間内総対戦数 + 有効デッキの admin_bonus_count 合計)`。

呼び出し元は `recalculate_opponent_decks` ラッパ (管理画面「変更内容反映」) と `run_daily_opponent_deck_batch` (日次 cron)。どちらも `_recalculate_opponent_decks_internal` を `PERFORM` するだけなので、**internal helper の修正だけで両経路に反映される** (ラッパ 2 つは変更不要)。

### 2.4 流用元: limitless の固定件数方式 (`20260519000002_canonicalize_opponent_deck_name.sql` 296-317 行)

`apply_limitless_snapshot` 内の `classification_method = 'fixed_count'` 分岐:

```sql
WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY limitless_share DESC NULLS LAST, name_en ASC) AS rn
  FROM opponent_deck_master WHERE ... AND source='limitless' AND is_active = true
)
UPDATE opponent_deck_master odm SET category = CASE
  WHEN r.rn <= v_settings.major_fixed_count THEN 'major'
  WHEN r.rn <= v_settings.major_fixed_count + v_settings.minor_fixed_count THEN 'minor'
  ELSE 'other'
END FROM ranked r WHERE odm.id = r.id;
```

**流用可否の調査結論: 流用可能。ただし以下 2 点の差し替えが必要。**

1. **ソートキー**: limitless は `limitless_share` で順位付け。`auto` モードに `limitless_share` は無いため、`battle_count + admin_bonus_count` (使用数) 降順に差し替える。tie-break は `name ASC` (既存 sort_order ロジックと同じ)。
2. **無効化との順序**: limitless はスナップショット非掲載行を `is_active=false` にした **後** に分類する (`20260519000002_canonicalize_opponent_deck_name.sql` 276-317 行)。`auto` の固定件数方式でも「固定枠を有効デッキだけで埋める」ため、無効化を分類より **前** に実行する必要がある (詳細 §5.2)。

`classification_method` / `major_fixed_count` / `minor_fixed_count` カラムは `opponent_deck_settings` に**既に存在** (`20260421000001_limitless_sync.sql` 26-29 行、`NOT NULL` + デフォルト `'threshold'`/`5`/`10`)。limitless 専用ではなく汎用カラム。CHECK 制約も `('threshold','fixed_count')` で両モード許容。
→ **DB スキーマ変更・データ backfill は不要。** 全 `auto` フォーマットの行は既に `classification_method='threshold'` を持つため、migration 適用直後の挙動は不変。

### 2.5 管理画面 UI の現状: `src/components/admin/OpponentDeckManager.tsx`

- `Mode` 型 (39 行): `"admin" | "auto" | "limitless"`
- `Settings` 型 (67-79 行): `classification_method?` / `major_fixed_count?` / `minor_fixed_count?` を**既に保持**
- state (254-269 行): `majorThresholdStr` `minorThresholdStr` `usagePeriodStr` `disablePeriodStr` `classificationMethod` `majorFixedCountStr` `minorFixedCountStr` を**既に定義**
- format 切替時の同期 effect (293-314 行): 上記 state を `initialSettings` から復元済
- **limitless モード UI (822-895 行)**: 「分類方式」ラジオ (閾値方式 / デッキ数固定方式) + 条件付きで閾値入力 or デッキ数入力 — これが流用テンプレート
- **auto モード UI (962-1003 行)**: 「設定」カードに `major閾値(%)` `minor閾値(%)` `算出期間(日)` `無効化期間(日)` の 4 入力 + 「試し計算」ボタンのみ。**分類方式の選択 UI が無い**
- `handleApply` (545-676 行): **全モード共通で先頭 (553-562 行)** に `updateOpponentDeckSettings` を呼び、`classification_method`/`major_fixed_count`/`minor_fixed_count` を含めて保存済。`mode==='auto'` では最後に `recalculateOpponentDecks` を呼ぶ (640 行) → **保存経路は既に完成しており、auto モードでも追加実装不要**
- `handleTrialCalc` (499-542 行): クライアント側プレビュー。**閾値方式のみ**でカテゴリ計算
- ヘルプ文 (770-779 行): 「■ ユーザー入力依存」に「カテゴリと並び順は使用率に基づいて自動計算されます」とあり、固定件数方式追加後は記述更新が望ましい

### 2.6 関連 actions: `src/lib/actions/admin-actions.ts`

- `updateOpponentDeckSettings` (141-162 行): `classification_method`/`major_fixed_count`/`minor_fixed_count` を**既に受け付ける**
- `recalculateOpponentDecks` (254-261 行): `recalculate_opponent_decks` RPC 呼び出し
- `getOpponentDeckStatsForAdmin` (286-339 行): `select("*")` で `last_used_at`/`created_at`/`admin_bonus_count` 含む全列取得 → 試し計算用データは揃っている

`database.types.ts` の `opponent_deck_settings` 型は上記 3 カラムを既に含む。**型再生成は不要** (スキーマ変更なし)。

## Resolved Decisions

- [適用範囲] Pattern 1 の有効化変更は `management_mode='admin'` のみに限定する。`management_mode='limitless'` のフォーマット (ポケポケ RANKED/RANDOM) では未登録デッキ名は従来通り `other`/`無効` で追加し、limitless 依存の挙動は変更しない。`auto_add_opponent_deck` の新規 INSERT 分岐を `admin`/`auto` (有効) と `limitless` (無効) に分離する。
- [0件デッキ扱い] デッキ数固定方式で、算出期間中の `battle_count + admin_bonus_count` が 0 のデッキは、固定件数の枠が余っていても major/minor に昇格させず `other` 固定にする (ゼロ使用 floor)。admin が意図的に分類へ入れたい場合は `admin_bonus_count` を付与すれば 0 件扱いではなくなる。Limitless 依存 (`apply_limitless_snapshot`) の固定件数ロジックは変更しない。

## 3. 変更ファイル一覧

| ファイル | 種別 | 変更内容 |
|---|---|---|
| `supabase/migrations/20260520000001_opponent_deck_update_method_changes.sql` | 新規 | `auto_add_opponent_deck` と `_recalculate_opponent_decks_internal` を `CREATE OR REPLACE` |
| `src/components/admin/OpponentDeckManager.tsx` | 編集 | auto モード「設定」カードに分類方式 UI 追加 / `handleTrialCalc` を固定件数方式対応 / ヘルプ文更新 |

`recalculate_opponent_decks` / `run_daily_opponent_deck_batch` / `apply_limitless_snapshot` / `admin-actions.ts` / `battle-actions.ts` / `database.types.ts` は**変更不要**。

## 4. Pattern 1 改修: `auto_add_opponent_deck`

`20260513000003` 9-57 行の本体をベースに、新規 INSERT 分岐を `admin/auto` (有効) と `limitless` (無効) に分離する。`CREATE OR REPLACE` のため既存の権限 (trigger owner のみ) は保持されるが、posture 明示のため `REVOKE` を再宣言する。

```sql
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
  v_is_active boolean;
BEGIN
  IF p_deck_name IS NULL OR length(trim(p_deck_name)) = 0 OR length(p_deck_name) > 80 THEN
    RETURN;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.opponent_deck_settings s
    WHERE s.format = p_format AND s.game_title = p_game_title
  ) THEN
    RETURN;
  END IF;

  SELECT management_mode INTO v_mode
  FROM public.opponent_deck_settings
  WHERE format = p_format AND game_title = p_game_title;

  -- 既存デッキ更新 (変更なし): last_used_at 更新 + auto モードのみ無効→有効
  UPDATE public.opponent_deck_master
  SET last_used_at = now(),
      is_active = CASE WHEN v_mode = 'auto' THEN true ELSE is_active END
  WHERE name = p_deck_name
    AND format = p_format
    AND game_title = p_game_title;
  IF FOUND THEN RETURN; END IF;

  -- 新規追加
  SELECT COALESCE(MAX(sort_order), 0) INTO v_max_sort
  FROM public.opponent_deck_master
  WHERE format = p_format AND game_title = p_game_title;

  -- ★ Pattern 1 変更点:
  --   auto  : true  (従来通り)
  --   admin : true  (旧 false → true。本件の修正)
  --   limitless: false (従来通り。Resolved Decisions [適用範囲] に従い不変)
  v_is_active := (v_mode IN ('auto', 'admin'));

  INSERT INTO public.opponent_deck_master
    (name, format, game_title, category, is_active, sort_order, last_used_at)
  VALUES
    (p_deck_name, p_format, p_game_title, 'other', v_is_active, v_max_sort + 10, now());
END;
$func$;

REVOKE ALL ON FUNCTION public.auto_add_opponent_deck(text, text, text)
  FROM PUBLIC, anon, authenticated, service_role;
-- trigger (owner 権限) 経由のみ呼ばれる。直接 EXECUTE 経路は付与しない。
```

補足:
- `v_mode` は settings 行存在チェック済 + `management_mode` が `NOT NULL` のため NULL にならない。
- `v_mode IN ('auto','admin')` の明示形を採用 (`<> 'limitless'` ではなく)。将来 4 つ目のモードが追加された場合に「無効で追加」が保守的デフォルトになるため。
- `category` は 3 モードとも `'other'` のまま (変更なし)。

## 5. Pattern 2 改修

### 5.1 DB: `_recalculate_opponent_decks_internal`

`20260426005408` 106-220 行をベースに `classification_method` で分岐させる。**閾値方式の分類ロジック・sort_order ロジックは既存と同一**にし、固定件数方式の分岐を追加する。無効化文は方式により実行位置を変える (§5.2)。`v_denominator = 0` の早期 return は閾値方式のみに限定する (固定件数方式は分母非依存で、全体 0 件のときも floor と無効化を実行させる必要があるため。詳細 §5.2)。

```sql
CREATE OR REPLACE FUNCTION public._recalculate_opponent_decks_internal(
  p_format text,
  p_game_title text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $func$
DECLARE
  v_settings record;
  v_total_battles bigint;
  v_total_bonus bigint;
  v_denominator bigint;
  v_start_date timestamptz;
BEGIN
  SELECT * INTO v_settings
  FROM public.opponent_deck_settings
  WHERE format = p_format AND game_title = p_game_title;

  IF v_settings IS NULL THEN RETURN; END IF;
  IF v_settings.management_mode <> 'auto' THEN RETURN; END IF;

  v_start_date := now() - (v_settings.usage_period_days || ' days')::interval;

  SELECT COUNT(*) INTO v_total_battles
  FROM public.battles
  WHERE format = p_format AND game_title = p_game_title AND fought_at >= v_start_date;

  SELECT COALESCE(SUM(admin_bonus_count), 0) INTO v_total_bonus
  FROM public.opponent_deck_master
  WHERE format = p_format AND game_title = p_game_title AND is_active = true;

  v_denominator := v_total_battles + v_total_bonus;
  -- 早期 return は閾値方式のみ: usage_rate の分母に v_denominator を使うため 0 だと除算不能。
  -- 固定件数方式は v_denominator に依存せず、全体 0 件のとき (期間内対戦 0 + admin_bonus 合計 0)
  -- も「0 件デッキは other」floor と無効化を必ず実行する必要があるため早期 return しない
  -- (Resolved Decisions [0件デッキ扱い])。
  IF v_settings.classification_method <> 'fixed_count' AND v_denominator = 0 THEN
    RETURN;
  END IF;

  IF v_settings.classification_method = 'fixed_count' THEN
    -- ===== デッキ数固定方式 (今回追加) =====
    -- (A) 無効化を分類より先に実行: 固定枠を有効デッキだけで埋めるため (§5.2)
    UPDATE public.opponent_deck_master SET is_active = false
    WHERE format = p_format AND game_title = p_game_title AND is_active = true
      AND last_used_at IS NOT NULL
      AND last_used_at < now() - (v_settings.disable_period_days || ' days')::interval;
    UPDATE public.opponent_deck_master SET is_active = false
    WHERE format = p_format AND game_title = p_game_title AND is_active = true
      AND last_used_at IS NULL
      AND created_at < now() - (v_settings.disable_period_days || ' days')::interval;

    -- (B) 使用数 (battle_count + admin_bonus_count) 降順で順位付け。
    --     使用数 0 のデッキは順位に関係なく other (Resolved Decisions [0件デッキ扱い])。
    WITH deck_usage AS (
      SELECT odm.id, odm.name,
        (COALESCE(bc.cnt, 0) + odm.admin_bonus_count) AS total_usage
      FROM public.opponent_deck_master odm
      LEFT JOIN (
        SELECT opponent_deck_name, COUNT(*) AS cnt
        FROM public.battles
        WHERE format = p_format AND game_title = p_game_title AND fought_at >= v_start_date
        GROUP BY opponent_deck_name
      ) bc ON bc.opponent_deck_name = odm.name
      WHERE odm.format = p_format AND odm.game_title = p_game_title AND odm.is_active = true
    ),
    ranked AS (
      SELECT id, total_usage,
        ROW_NUMBER() OVER (ORDER BY total_usage DESC, name ASC) AS rn
      FROM deck_usage
    )
    UPDATE public.opponent_deck_master odm
    SET category = CASE
      WHEN r.total_usage = 0 THEN 'other'
      WHEN r.rn <= v_settings.major_fixed_count THEN 'major'
      WHEN r.rn <= v_settings.major_fixed_count + v_settings.minor_fixed_count THEN 'minor'
      ELSE 'other'
    END
    FROM ranked r
    WHERE odm.id = r.id;
  ELSE
    -- ===== 閾値方式 (既存ロジック・変更なし。20260426005408 147-173 行と同一) =====
    WITH deck_usage AS (
      SELECT odm.id, odm.admin_bonus_count,
        COALESCE(bc.cnt, 0) AS battle_count,
        (COALESCE(bc.cnt, 0) + odm.admin_bonus_count) * 100.0 / v_denominator AS usage_rate
      FROM public.opponent_deck_master odm
      LEFT JOIN (
        SELECT opponent_deck_name, COUNT(*) AS cnt
        FROM public.battles
        WHERE format = p_format AND game_title = p_game_title AND fought_at >= v_start_date
        GROUP BY opponent_deck_name
      ) bc ON bc.opponent_deck_name = odm.name
      WHERE odm.format = p_format AND odm.game_title = p_game_title AND odm.is_active = true
    )
    UPDATE public.opponent_deck_master odm
    SET category = CASE
      WHEN du.usage_rate >= v_settings.major_threshold THEN 'major'
      WHEN du.usage_rate >= v_settings.minor_threshold THEN 'minor'
      ELSE 'other'
    END
    FROM deck_usage du
    WHERE odm.id = du.id;
  END IF;

  -- ===== sort_order 振り直し (両方式共通。20260426005408 175-200 行と同一) =====
  WITH ranked AS (
    SELECT odm.id,
      ROW_NUMBER() OVER (
        ORDER BY
          CASE odm.category WHEN 'major' THEN 0 WHEN 'minor' THEN 1 ELSE 2 END,
          (COALESCE(bc.cnt, 0) + odm.admin_bonus_count) DESC,
          odm.name ASC
      ) AS new_order
    FROM public.opponent_deck_master odm
    LEFT JOIN (
      SELECT opponent_deck_name, COUNT(*) AS cnt
      FROM public.battles
      WHERE format = p_format AND game_title = p_game_title AND fought_at >= v_start_date
      GROUP BY opponent_deck_name
    ) bc ON bc.opponent_deck_name = odm.name
    WHERE odm.format = p_format AND odm.game_title = p_game_title AND odm.is_active = true
  )
  UPDATE public.opponent_deck_master odm
  SET sort_order = r.new_order
  FROM ranked r
  WHERE odm.id = r.id;

  -- ===== 閾値方式のみ最後に無効化 (fixed_count は (A) で実施済) =====
  IF v_settings.classification_method <> 'fixed_count' THEN
    UPDATE public.opponent_deck_master SET is_active = false
    WHERE format = p_format AND game_title = p_game_title AND is_active = true
      AND last_used_at IS NOT NULL
      AND last_used_at < now() - (v_settings.disable_period_days || ' days')::interval;
    UPDATE public.opponent_deck_master SET is_active = false
    WHERE format = p_format AND game_title = p_game_title AND is_active = true
      AND last_used_at IS NULL
      AND created_at < now() - (v_settings.disable_period_days || ' days')::interval;
  END IF;
END;
$func$;

REVOKE ALL ON FUNCTION public._recalculate_opponent_decks_internal(text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._recalculate_opponent_decks_internal(text, text)
  TO service_role;
```

### 5.2 無効化と分類の順序について (設計判断)

固定件数方式では「上位 N 件を major」とするため、N 件を**有効デッキだけ**で数える必要がある。無効化を分類後に行うと、stale デッキ (`admin_bonus_count` 付きで `last_used_at` が古い等) が major 枠を消費した直後に無効化され、表示上の有効 major が N 未満になる。これを避け、limitless 同期 (非掲載行を先に無効化してから分類) と挙動を揃えるため、固定件数方式では**無効化を分類より前**に実行する。

閾値方式は分類がデッキ単位独立のため順序非依存。既存の「分類 → sort → 無効化」順を厳密に維持する (`IF classification_method <> 'fixed_count'` ガードは閾値方式では常に真)。閾値方式の挙動は実質変わらない。唯一の差は「無効化されたデッキの `category` 値」が、固定件数方式では再計算前の値で残る点だが、無効デッキはユーザー画面に出ない (`get_opponent_deck_suggestions` は `is_active=true` のみ) ため実害なし。

**`v_denominator = 0` 時の扱い**: 期間内対戦 0 件かつ有効デッキの `admin_bonus_count` 合計 0 のとき `v_denominator = 0` になる。閾値方式は `usage_rate` の分母に `v_denominator` を使うため除算不能で、かつ分類対象が実質無いため早期 return する (既存挙動)。一方、固定件数方式は `v_denominator` を一切使わず使用数 (`battle_count + admin_bonus_count`) で順位付けするため、全体 0 件でも「全 0 件デッキ → `other`」floor と無効化を必ず実行する必要がある。よって早期 return には `classification_method <> 'fixed_count'` 条件を加え閾値方式限定とする。これにより、以前 major/minor だった 0 件デッキが固定件数方式で再計算されず残る事象を防ぐ (Resolved Decisions [0件デッキ扱い] と整合)。

### 5.3 UI: `OpponentDeckManager.tsx` auto モード「設定」カード

現状の auto モード「設定」カード (962-1003 行) を、limitless モードの「分類方式」ブロック (822-895 行) と同等の構成に拡張する。**`算出期間(日)` `無効化期間(日)` の入力は残す** (指示通り)。

変更後の「設定」カード構成:
1. 「分類方式」ラジオ: `閾値方式` / `デッキ数固定方式` (limitless の 825-856 行と同じ JSX パターン。`classificationMethod` state を読み書き、`setDirty(true)`)
2. 条件付き表示:
   - `classificationMethod === 'threshold'` → `major閾値(%)` `minor閾値(%)` の 2 入力 (現状の `majorThresholdStr`/`minorThresholdStr` 入力を流用)
   - `classificationMethod === 'fixed_count'` → `majorデッキ数` `minorデッキ数` の 2 入力 (`majorFixedCountStr`/`minorFixedCountStr`。limitless の 874-890 行と同じ)
3. **常時表示**: `算出期間(日)` `無効化期間(日)` の 2 入力 (現状の `usagePeriodStr`/`disablePeriodStr` 入力をそのまま維持)
4. 「試し計算」ボタン + 注記テキスト (現状維持)

state・型・format 切替同期 effect・`handleApply` の保存処理は**すべて既存のものを流用** (§2.5)。新規 state 追加は不要。`handleApply` は全モードで `updateOpponentDeckSettings` に 3 カラムを渡し済 (553-562 行)、auto モードでは `recalculateOpponentDecks` も呼ぶ (640 行) ため、保存 → 再計算経路はそのまま機能する。

### 5.4 UI: `handleTrialCalc` を固定件数方式対応 (499-542 行)

「試し計算」はクライアント側プレビュー (DB 書き込みなし)。現状は閾値方式のみ。`classificationMethod` で分岐させる:

- `threshold`: 現状ロジックを維持 (`denominator === 0` 時は各デッキを現状維持する既存の短絡もそのまま)。
- `fixed_count`:
  1. 各デッキの `battle_count` を `getBattleCountsForPeriod` 結果から取得し、`usage_rate` も表示用に算出する (`denominator > 0` のときのみ算出、0 なら 0%)。
  2. 有効 (`is_active`) かつ未削除のデッキのうち `battle_count + admin_bonus_count > 0` のものを、使用数降順 → 名前昇順で順位付け。
  3. 上位 `majorFixedCountStr` 件 → `major`、続く `minorFixedCountStr` 件 → `minor`、残り → `other`。
  4. 上記対象外のデッキ: 有効かつ未削除で使用数 0 のものは `other` (floor)。無効・削除済みデッキは既存 `category` を維持 (現状の閾値方式試し計算が無効デッキを触らないのと同じ扱い)。
  5. 表示用ソートは現状 (524-532 行) と同じ (有効優先 → category 順 → 使用率降順 → 名前昇順)。
  6. 固定件数方式の分類は `denominator` を使わず使用数で順位付けするため、`denominator === 0` でも短絡せず floor を適用する (DB 側 §5.1「固定件数方式は早期 return しない」と挙動を揃え、全体 0 件時は全有効デッキが `other`)。

`handleTrialCalc` は無効化を simulate しない (現状の閾値方式試し計算も同様)。固定件数方式のプレビューは「無効化前の有効デッキ」で順位付けするため、実 recalc (無効化後に順位付け) と僅差が出る可能性がある。これは既存の試し計算の忠実度と同レベルであり、注記テキストの「目安」表現で許容する。

### 5.5 UI: ヘルプ文の更新 (770-779 行)

「■ ユーザー入力依存」のヘルプ文に固定件数方式の説明を 1 行追加 (例: 「分類方式は『閾値方式』(使用率で判定) と『デッキ数固定方式』(使用数上位から固定件数で判定) を選択できます」)。軽微な追従修正。

## 6. Pattern 3: limitless依存

`apply_limitless_snapshot` (`20260519000002_canonicalize_opponent_deck_name.sql`)・`management_mode='limitless'` 関連は**一切変更しない**。本計画で限定的に関係するのは:
- `auto_add_opponent_deck` の `limitless` モード新規 INSERT が `is_active=false` のまま (§4 で明示的に維持)。
- limitless モード UI (822-895 行) は変更しない (auto モード UI のテンプレートとして参照するのみ)。

## 7. マイグレーションファイル

新規 `supabase/migrations/20260520000001_opponent_deck_update_method_changes.sql`:
- 冒頭コメントで変更概要 (Pattern 1 + Pattern 2、limitless 非対象) を記述。
- セクション 1: `auto_add_opponent_deck` (§4 の SQL)。
- セクション 2: `_recalculate_opponent_decks_internal` (§5.1 の SQL)。
- ファイル名のタイムスタンプ `20260520000001` は既存最新 `20260519000003` の次。

スキーマ変更 (`ALTER TABLE` / 新カラム) は無いため `BEGIN/COMMIT` トランザクションは必須ではないが、2 関数の差し替えを束ねるため `BEGIN; ... COMMIT;` で囲む方針。

## 8. デプロイ順序

CLAUDE.md「コード変更を伴うマイグレーションは必ず main への本番反映が完了してから実行する」に従う:

1. `dev` ブランチで UI 変更 + migration ファイルを commit / push (実装完了後 Claude が自動実施)。
2. Cloudflare dev preview ビルド完了後、**staging DB に migration を適用** (`npx supabase db push --db-url "$STAGING_DB_URL" --include-all`)、`supabase migration list` で確認。
3. dev preview + staging で動作確認 (§9)。
4. ユーザーの「本番反映」明示指示 → `main` マージ → 本番コードデプロイ。
5. 本番コードデプロイ完了後、ユーザーの明示指示を得て **production DB に migration を適用**。

順序逆転リスクの評価:
- migration 先行 (コード未デプロイ): `auto` フォーマットは全行 `classification_method='threshold'` であり、固定件数を選べる UI も未デプロイのため挙動不変。`auto_add` の admin 有効化はコード非依存で即有効。→ 破壊なし。
- コード先行 (migration 未適用): 新 UI で `auto` フォーマットに固定件数方式を選べるが、DB 側 `_recalculate_opponent_decks_internal` は閾値方式のまま。設定は保存されるが migration 適用まで分類に反映されない。「試し計算」結果と実 recalc が一時的に不一致になるのみ。→ 破壊なし。**main 反映直後に production migration を適用すればこの窓は最小化される。**

## 9. 検証計画

### 9.1 Claude が自前で実施

- `npm run lint` — UI 変更の lint 通過。
- `npx opennextjs-cloudflare build` (または `npm run build`) — ビルド通過。
- migration SQL の静的レビュー (search_path / SECURITY DEFINER / REVOKE-GRANT / 既存定義との diff)。
- staging DB へ migration 適用 + `supabase migration list` で適用確認。
- Supabase MCP (read-only) で staging の関数定義を `pg_get_functiondef` で確認。
- staging で制御された検証 (staging 限定。`auto_add_opponent_deck` は全ロールから REVOKE 済でトリガー経由のみ実行可、`recalculate_opponent_decks` ラッパは `is_admin_user()` が `auth.uid()` を要求するため、いずれも直接 RPC 呼び出しはせず以下の経路で検証する):
  - Pattern 1: `admin`/`auto`/`limitless` 各モードのテスト用フォーマットに対し、`battles` へ制御された INSERT を行い (privileged SQL で RLS バイパス)、AFTER INSERT トリガー `battles_auto_add_opponent_deck` 経由で `auto_add_opponent_deck` を発火させ、`opponent_deck_master` に追加された新規行の `is_active`/`category` を確認 (admin → `other`/`true`、auto → `other`/`true`、limitless → `other`/`false`)。検証後はテスト INSERT した `battles` 行・生成された `opponent_deck_master` 行を削除し staging を原状復帰する。
  - Pattern 2: `auto` フォーマットの `classification_method` を `fixed_count` に設定し、内部ヘルパー `_recalculate_opponent_decks_internal('<format>','<game>')` を直接呼んで (service_role に GRANT 済・admin 判定なし) 検証する。確認項目: 使用数上位 N 件の `category`、使用数 0 デッキの `other` floor、全体 0 件 (`v_denominator = 0`) のとき全有効デッキが `other` 化されること。`classification_method='threshold'` のままでの再計算結果が従来と一致することも確認。

### 9.2 ユーザーに依頼 (実ブラウザ必須)

- dev preview の `/admin/opponent-decks` で auto モードの「分類方式」ラジオ切替・固定件数入力・「試し計算」プレビューの体感確認。
- 実際に対戦記録で未登録デッキ名を入力 (admin モードのフォーマット) し、対面候補に有効状態で出ることの確認。

## 10. 影響範囲・非対象

非対象 (変更しない):
- `apply_limitless_snapshot` および `management_mode='limitless'` の挙動全般 (Pattern 3)。
- `auto_add_opponent_deck` の既存デッキ UPDATE 分岐 (スコープは新規 INSERT のみ)。
- `recalculate_opponent_decks` ラッパ / `run_daily_opponent_deck_batch` (internal helper を呼ぶだけ)。
- `admin` モードへの固定件数方式追加 (admin はカテゴリ手動管理であり分類方式の概念が無い)。
- `database.types.ts` (スキーマ変更なし)。
- `battle-actions.ts` の `recordBattle` (トリガー経由で `auto_add` が動くため変更不要)。

影響を受けるユーザー体験:
- admin モードのフォーマットで未登録デッキが対戦記録に入ると、即座に対面候補 (有効) として表示されるようになる。
- auto モードのフォーマットで管理者が「デッキ数固定方式」を選べるようになる。

## 11. リスクと留意点

- **閾値方式パスの restructure**: 無効化文を `IF classification_method <> 'fixed_count'` ガード下に移動し、`v_denominator = 0` 早期 return にも同条件を付ける。閾値方式フォーマットでは両条件とも常に真のため挙動不変だが、migration diff レビュー時に「閾値方式の分類 SQL・sort SQL・無効化 SQL が既存と同一」かつ「閾値方式の早期 return が従来通り (denominator 0 で何もせず return)」であることを必ず確認する。
- **0 件 floor と固定枠**: 固定件数方式で有効デッキ数が `major_fixed_count + minor_fixed_count` 未満かつ 0 件デッキが多い場合、major/minor が設定件数より少なくなる (例: 非 0 デッキが 3 件で `major_fixed_count=5` なら major は 3 件)。全体 0 件 (`v_denominator = 0`) のときは全有効デッキが `other` になる (§5.1/§5.2 — 固定件数方式は早期 return しない)。いずれも Resolved Decisions [0件デッキ扱い] に沿った意図的挙動。
- **試し計算と実 recalc の僅差**: §5.4 の通り無効化非 simulate に起因。許容。
- **migration とコードの順序窓**: §8 の通り破壊は無いが、本番では main 反映直後に migration 適用を推奨。
- production DB への migration 適用はユーザーの明示指示が必須 (CLAUDE.md)。
