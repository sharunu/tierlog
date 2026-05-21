# チューニング論理削除化 — 対戦履歴スナップショット破壊バグ修正 plan

作成日: 2026-05-21
対象不具合: チューニング削除で過去戦績の `battles.my_deck_name` / `battles.tuning_name` が破壊される

---

## 1. 背景と不具合の根本原因

### 1.1 再現手順

1. チューニング付きの使用デッキで対戦記録を登録する
2. その使用デッキのデッキ名称を変更する
3. そのチューニングを使用デッキ管理画面から削除する

→ チューニング付きで記録した過去履歴の `battles.my_deck_name` が記録時の名前ではなくデッキ改名後の現在名に置き換わる。`battles.tuning_name` は NULL に上書きされる。

### 1.2 原因チェーン（コードで確認済み）

| # | 事象 | 根拠 |
|---|------|------|
| 1 | `deleteTuning()` は `deck_tunings` を物理 `delete()` する | `src/lib/actions/deck-actions.ts:175-183` |
| 2 | `battles.tuning_id` は `deck_tunings(id) ON DELETE SET NULL` の FK を持つ | `supabase/migrations/20260314000001_add_deck_tunings.sql:17` |
| 3 | tuning 物理削除で DB 側が該当 `battles` 行の `tuning_id` を NULL に UPDATE する | FK の `ON DELETE SET NULL` 動作 |
| 4 | この `battles` UPDATE が `battles_normalize_deck_names` トリガを発火させる | `supabase/migrations/20260426005407_strengthen_battles_rls.sql:114-117`（`BEFORE INSERT OR UPDATE`） |
| 5 | トリガーは `tuning_id` が変化した UPDATE では「OLD 名保持」分岐をスキップし再正規化する | 同 `:85-109` |

トリガー本体（`20260426005407_strengthen_battles_rls.sql:85-109`）:

```sql
IF TG_OP = 'UPDATE'
   AND NEW.my_deck_id IS NOT DISTINCT FROM OLD.my_deck_id
   AND NEW.tuning_id  IS NOT DISTINCT FROM OLD.tuning_id THEN
  NEW.my_deck_name := OLD.my_deck_name;   -- スナップショット保持
  NEW.tuning_name  := OLD.tuning_name;
  RETURN NEW;
END IF;
-- ↑をスキップした場合に再正規化:
SELECT name INTO NEW.my_deck_name FROM public.decks WHERE id = NEW.my_deck_id;
IF NEW.tuning_id IS NOT NULL THEN
  SELECT name INTO NEW.tuning_name FROM public.deck_tunings WHERE id = NEW.tuning_id;
ELSE
  NEW.tuning_name := NULL;
END IF;
```

FK の `SET NULL` による UPDATE では `tuning_id` が `uuid → NULL` に変化する（`IS DISTINCT`）。よって OLD 名保持分岐をスキップし:

- `my_deck_name` ← `decks.name`（**改名後の現在名**）に再正規化される
- `tuning_id` は NULL なので `tuning_name` ← **NULL** に上書きされる

これがスナップショット破壊の二重の実害。デッキ改名をしていない場合でも `tuning_name` の NULL 化は必ず起きる（`my_deck_name` の見た目変化は改名時のみ顕在化）。

### 1.3 破壊の発生期間

トリガー `battles_normalize_deck_names` は `20260426005407`（2026-04-26）で導入。**2026-04-26 以降に DeckList の「削除」ボタンで battle 履歴を持つ tuning を削除した全ユーザー**が影響対象。`dm` / `pokepoke` 両方に影響する（`deleteTuning` は共通 action）。

---

## 2. 修正方針（概要）

`decks` の削除が `is_archived` 論理削除であるのと同様に、**`deck_tunings` も物理削除をやめて論理削除に寄せる**。論理削除なら tuning 削除時に `battles` への UPDATE が一切発生せず、トリガーが発火しないため、スナップショットは構造的に保護される。

| 層 | 変更 |
|----|------|
| DB | `deck_tunings.is_archived boolean NOT NULL DEFAULT false` 追加 / 一意 index を partial 化 |
| action | `deleteTuning()` を `is_archived=true` UPDATE 化 / `getDecks()` で active のみ返却 / `createTuning`・`updateTuning` の重複チェックを active 限定に |
| 型 | `database.types.ts` の `deck_tunings` に `is_archived` を反映 |
| UI | `EditBattleModal` に「削除済み・改名された tuning やデッキを記録時スナップショット選択肢として表示」ロジックを追加 |
| トリガー | **変更不要**（§6 で論証） |
| FK | **変更不要**（`ON DELETE SET NULL` を維持。§6.2 で論証） |

論理削除に寄せることで、tuning 削除後も「記録時の選択肢」として履歴編集画面で再表示でき、過去戦績の by-tuning 集計（`battles.tuning_name` スナップショット参照）も保持される。

---

## 3. 影響範囲

### 3.1 変更するファイル

| ファイル | 変更内容 |
|----------|----------|
| `supabase/migrations/20260521000001_deck_tunings_logical_delete.sql` | 新規。列追加 + index 張り替え |
| `src/lib/supabase/database.types.ts` | `deck_tunings` の Row/Insert/Update に `is_archived` を追加 |
| `src/lib/actions/deck-actions.ts` | `getDecks` / `createTuning` / `updateTuning` / `deleteTuning` |
| `src/components/battle/EditBattleModal.tsx` | スナップショット選択肢ロジック拡張 |
| `src/lib/actions/admin-actions.ts` | `getAdminUserDecks` の tuning 取得を active 限定に（§Resolved Decisions D4 で実施確定） |

### 3.2 変更しないファイル（確認済み・無影響）

- `src/components/battle/BattleRecordForm.tsx` — `getDecks()` の戻り値を使うのみ。active 限定化は自動で反映。localStorage 復元（`:112-131`）は存在しない tuningId をデッキへフォールバックする既存ロジックで吸収。**変更不要**。
- `src/components/battle/BattleHistoryList.tsx` — 履歴行は `b.my_deck_name` / `b.tuning_name`（スナップショット列）を直接描画（`:107-108, 142-149`）。修正後はスナップショットが保持されるため正しく表示。保存後 `onRefresh()` で DB 再取得するためトリガー結果も反映。**変更不要**。
- `src/app/{dm,pokepoke}/decks/DeckList.tsx` — `handleDeleteTuning` は `deleteTuning()` 呼び出し後ローカル state から除外（`:206-217`）。論理削除でも UI 上は同じ挙動（`getDecks` が archived を除外）。**変更不要**。
- `src/app/{dm,pokepoke}/battle/page.tsx` — `getDecks()` を呼ぶのみ。**変更不要**。
- stats 系 RPC（`get_personal_deck_detail_stats_by_tuning` 等） — `battles.tuning_name` スナップショットを `GROUP BY COALESCE(b.tuning_name, '指定なし')` で集計（`20260514000001_personal_stats_rpcs.sql:231,258`）。`deck_tunings` を live JOIN しない。**変更不要**（むしろ修正後はスナップショット保持で集計が正しくなる副次効果あり）。
- `battles` RLS / `normalize_battle_deck_names` トリガー / `battles.tuning_id` FK — §6 参照、**変更しない**。

### 3.3 マルチゲーム

`deleteTuning` / `getDecks` / `createTuning` / `updateTuning` は `src/lib/actions/deck-actions.ts` の共通 action。`EditBattleModal` は `src/components/battle/` の共通コンポーネント（`dm`/`pokepoke` 双方の battle ページが `BattleTabsView → BattleHistoryList → EditBattleModal` で利用）。よって**ファイル単位の修正で両ゲームを同時にカバー**し、ゲーム別の重複改修は不要。`deck_tunings` は `game_title` 列を持つ（`20260419000001`）が `is_archived` は行単位フラグでゲーム非依存。

---

## 4. DB マイグレーション

### 4.1 新規ファイル `supabase/migrations/20260521000001_deck_tunings_logical_delete.sql`

```sql
-- deck_tunings の論理削除化 (battles スナップショット破壊バグ修正)
--
-- 背景:
--   deleteTuning() が deck_tunings を物理 DELETE していたため、battles.tuning_id
--   (FK: deck_tunings(id) ON DELETE SET NULL) が DB 側で NULL 化される。この battles
--   UPDATE が battles_normalize_deck_names トリガを発火させ、tuning_id が変化した
--   UPDATE では OLD 名保持分岐をスキップして my_deck_name / tuning_name を
--   decks / deck_tunings から再正規化してしまう。結果、過去戦績の my_deck_name が
--   デッキ改名後の現在名に置換され、tuning_name は NULL に上書きされる。
--
-- 本マイグレーションは追加専用 (expand)。現在稼働中の prod コードを壊さない:
--   - is_archived を DEFAULT false で追加 → 既存行は全て active
--   - 一意制約を「active な tuning のみ」を対象とする partial index へ張り替え
--     (decks_active_name_unique_idx と同じ方式 / 20260513000001_unique_decks_and_tunings.sql)

-- 1. is_archived 列追加
ALTER TABLE public.deck_tunings
  ADD COLUMN is_archived boolean NOT NULL DEFAULT false;

-- 2. 一意 index を partial 化
--    旧 (20260513000001_unique_decks_and_tunings.sql:85-86): UNIQUE (deck_id, lower(trim(name)))  -- 全行対象
--    新:                        UNIQUE (deck_id, lower(trim(name))) WHERE is_archived = false
--    → アーカイブ済み tuning と同名の active tuning を再作成可能にする
--      (decks_active_name_unique_idx と同じ挙動)
--    適用時点では全行 is_archived=false かつ旧 index で一意性が保証済みのため、
--    重複解消処理 (20260513000001 が行ったような dedupe) は不要。
DROP INDEX IF EXISTS public.deck_tunings_name_unique_idx;
CREATE UNIQUE INDEX deck_tunings_name_unique_idx
  ON public.deck_tunings (deck_id, lower(trim(name)))
  WHERE is_archived = false;
```

### 4.2 設計上の判断

- **partial index 必須**: 現行 `deck_tunings_name_unique_idx`（`20260513000001_unique_decks_and_tunings.sql:85-86`）は全行対象。論理削除でアーカイブ行が残ると、同名 tuning の再作成が一意制約違反になる。`WHERE is_archived = false` 化で `decks_active_name_unique_idx`（`20260513000001_unique_decks_and_tunings.sql:81-83`）と同じ挙動に揃える。
- **重複解消不要**: 適用時点では全行が `is_archived=false`、かつ旧 index で `(deck_id, lower(trim(name)))` の一意性が保証済み。partial index 作成は必ず成功する。
- **`battles.tuning_id` FK は変更しない**: `ON DELETE SET NULL` を維持（理由は §6.2）。
- **トリガーは変更しない**（理由は §6.1）。
- **`battles` RLS は変更しない**（理由は §6.3）。

---

## 5. アプリケーションコード修正

### 5.1 `database.types.ts` — `deck_tunings` 型に `is_archived` を追加

`src/lib/supabase/database.types.ts:139-173` の `deck_tunings` ブロックに追加:

- `Row`: `is_archived: boolean`
- `Insert`: `is_archived?: boolean`
- `Update`: `is_archived?: boolean`

> 型更新はコード修正の**ハード依存**。`getDecks` の `.select(...is_archived)`、`deleteTuning` の `.update({ is_archived: true })`、`createTuning`/`updateTuning` の `.eq("is_archived", false)` がいずれも型エラーになるため、コード変更前に型を反映する必要がある。staging へマイグレーション適用後に型再生成（Supabase の型生成）するか、boolean 1 列のため手編集でも可。

### 5.2 `deck-actions.ts`

**`getDecks()`（`:5-26`）— active な tuning のみ返却**

- nested select に `is_archived` を追加: `.select("*, deck_tunings(id, name, sort_order, is_archived)")`
- `.map()` 内で archived を除外してから既存ソート:

```ts
return (data ?? []).map((d) => ({
  ...d,
  deck_tunings: (d.deck_tunings ?? [])
    .filter((t) => !t.is_archived)
    .sort((a, b) => a.sort_order - b.sort_order),
}));
```

> PostgREST の embedded resource フィルタ（`.eq("deck_tunings.is_archived", false)`）ではなく、取得後のクライアント側 filter を採用する。embedded フィルタの親行残存挙動への依存を避け、確実かつ可読にするため。返却 tuning オブジェクトに残る `is_archived` フィールドは無害（消費側の型 `{id,name,sort_order}` への代入は構造的部分型で問題なし。気になる場合は明示マップで除去可・任意）。

**`deleteTuning()`（`:175-183`）— 物理削除を論理削除へ**

```ts
export async function deleteTuning(id: string) {
  const supabase = createClient();
  const { error } = await supabase
    .from("deck_tunings")
    .update({ is_archived: true })
    .eq("id", id);
  if (error) throw new Error(error.message);
}
```

> RLS: `deck_tunings` の UPDATE は `"Users can update own deck tunings"` policy（`20260511000004_consolidate_admin_select_policies.sql` で FOR ALL から 4 policy へ分割された UPDATE 専用 policy）が `USING`/`WITH CHECK` ともに「`decks.user_id = auth.uid()`（所有者）」のみを検査。所有者の `is_archived` UPDATE は許可される。**RLS 変更不要**。

**`createTuning()`（`:121-151`）— 重複チェックを active 限定に**

`:124-129` の dup チェックに `.eq("is_archived", false)` を追加。これがないとアーカイブ済み同名 tuning が検出され「同じ名前のチューニングが既に登録されています」で再作成が誤って弾かれる（partial unique index は再作成を許可するのに JS 側で阻むと不整合）。

> `nextOrder` 算出（`:135-141`、`MAX(sort_order)`）は archived 行を含めても単調増加するだけで害なし。**変更不要**。

**`updateTuning()`（`:153-173`）— 重複チェックを active 限定に**

`:159-166` の dup チェックに `.eq("is_archived", false)` を追加。

### 5.3 `EditBattleModal.tsx` — 削除済み・改名された tuning のスナップショット選択肢

現状（`:67-142`）は **デッキ単位**のスナップショットのみ対応:
- `recordedDeckExists = decks.some(d => d.name === battle.my_deck_name)`（名前一致判定）
- `false` のとき `__snapshot__:<name>` 選択肢を 1 つ追加し、保存時に `battle.*` を保持

問題 (i): **デッキは存在するが tuning だけが archived/不在**のケースが未対応。`initialValue` が `${deckId}:${battle.tuning_id}` になるが `deckOptions` に該当値が無く、`<select>` が不整合状態になる。

問題 (ii): 現状の `recordedDeckExists` は**名前一致のみ**（`decks.some(d => d.name === battle.my_deck_name)`）。削除/改名済みの元デッキと**同名の別 active デッキ**を後から作成できる（partial unique index は active のみを制約するため同名再作成が可能）ため、名前一致だけだと「記録時 snapshot 不要」と誤判定し、`battle.my_deck_id` が `deckOptions` に存在しない `<select>` になりうる。→ `id` + 記録時名の複合判定へ変更する。

問題 (iii): **tuning 改名のみ**のケースが未対応。`battle.tuning_id` は active のままだが `deck_tunings.name` が改名され `battle.tuning_name`（記録時スナップショット）と一致しない場合、素朴な「id 不在」判定だけだと「tuning は現存する」とみなし通常選択肢（**現在名**）を初期選択にしてしまう。tuning 改名単体では `tuning_id` 不変のためトリガー OLD 名保持分岐が効き `battles.tuning_name` は記録時名のまま保持され、履歴一覧も記録時名を表示する。よって編集画面の初期選択も記録時名 `デッキ名 / チューニング名(記録時)` に揃える方が一貫する。→ tuning 判定を「id 不在」だけでなく「id は在るが現在名が記録時名と異なる」も snapshot 扱いに拡張する。

**修正方針（最小差分・単一センチネル方式）**

1. コンポーネント先頭（`useState` 群より前）で active tuning の `id→tuning` マップと「記録時 tuning が現存しない/改名されたか」を算出:

```ts
// active tuning を id→tuning で引けるようにする (name 比較に使うため Set ではなく Map)。
// Tuning は EditBattleModal.tsx 既存のローカル型 (:12)。
const activeTuningById = new Map<string, Tuning>();
for (const d of decks) for (const t of (d.deck_tunings ?? [])) activeTuningById.set(t.id, t);

// 記録時デッキが「同一 active デッキ ID かつ記録時名と一致」で現存するか。
// 名前一致のみだと、削除/改名済み元デッキと同名の別 active デッキを
// 後から作成したケースで誤判定するため id + name の複合判定にする。
const recordedDeckExists = decks.some(
  (d) => d.id === battle.my_deck_id && d.name === battle.my_deck_name
);
// 記録時 tuning が「現存しない」または「現存するが現在名が記録時名と異なる(改名)」
// なら snapshot 扱い。改名単体でも battles.tuning_name は記録時名で保持される設計
// （tuning_id 不変 → トリガー OLD 名保持分岐）のため、編集画面でも記録時名を
// 初期選択にして履歴一覧と一貫させる。
const recordedTuningStale =
  battle.tuning_id != null &&
  (!activeTuningById.has(battle.tuning_id) ||
    activeTuningById.get(battle.tuning_id)!.name !== battle.tuning_name);
const needsSnapshot = !recordedDeckExists || recordedTuningStale;
```

2. `initialValue` を単一センチネル `"__snapshot__"` に統一:

```ts
const initialValue = needsSnapshot
  ? "__snapshot__"
  : battle.tuning_id
    ? `${battle.my_deck_id}:${battle.tuning_id}`
    : battle.my_deck_id;
```

3. `deckOptions` 先頭に**スナップショット選択肢を 1 つだけ**追加（既存 `:104-109` を置換）。表示文言は既存の削除済みデッキ表示ルール `(記録時)` に合わせ、tuning がある場合はデッキ名 / チューニング名で表示:

```ts
if (needsSnapshot) {
  const snapshotLabel = battle.tuning_name
    ? `${battle.my_deck_name} / ${battle.tuning_name}(記録時)`
    : `${battle.my_deck_name}(記録時)`;
  deckOptions.push({ value: "__snapshot__", label: snapshotLabel });
}
```

4. `handleSave`（`:131-142`）の判定を `startsWith("__snapshot__:")` → `=== "__snapshot__"` に変更（保持ロジック本体は既存のまま）:

```ts
if (selectedValue === "__snapshot__") {
  deckId = battle.my_deck_id;
  tuningId = battle.tuning_id ?? null;
  myDeckName = battle.my_deck_name;
  tuningName = battle.tuning_name ?? null;
} else {
  const parsed = parseDeckSelection(selectedValue);
  // ...既存どおり...
}
```

**動作トレース（修正後）**

- *スナップショット選択のまま保存*（result のみ変更等）: `updateBattle` が `my_deck_id`/`tuning_id` を OLD と同値で送る → トリガーは `my_deck_id`/`tuning_id` ともに `IS NOT DISTINCT` → **OLD 名保持分岐** → スナップショット維持。✓
- *明示的に別の active デッキ/tuning へ変更*: `my_deck_id` または `tuning_id` が変化 → トリガー再正規化分岐 → その 1 件のみ現在の選択内容に更新。✓（要件「明示変更は更新が正しい挙動」を満たす）
- *tuning 改名のみ（id は active のまま）*: `recordedTuningStale=true` により snapshot 選択肢 `デッキ名 / チューニング名(記録時)` を初期選択。そのまま保存しても `tuning_id` 不変のためトリガー OLD 名保持分岐で `tuning_name` は記録時名を維持。なお同一 `tuning_id` を選び直しても（現在名の通常選択肢でも）`tuning_id` が変わらない限りトリガーが記録時名を保持するため `tuning_name` は改名後の名前には変わらない — これは「同じ tuning を使った履歴」のスナップショット不変性として正しい挙動。別 tuning へ切り替えた場合のみ再正規化される。✓
- *RLS*: 論理削除なので archived tuning 行は実在 → `battles` UPDATE の `WITH CHECK` の `EXISTS (deck_tunings WHERE id=tuning_id AND deck_id=my_deck_id)`（`20260426005407:74-81`）は通る。✓

> 既存のデッキ単位スナップショット選択肢のラベルも、tuning がある場合は `デッキ名 / チューニング名(記録時)` に強化される（従来は `デッキ名(記録時)` のみで tuning 名が落ちていた）。要件で求められた表示と整合する意図的な改善。

### 5.4 `admin-actions.ts` — `getAdminUserDecks`（実装に含める → §Resolved Decisions D4）

`getAdminUserDecks`（`:387` 付近）の `.select("id, name, sort_order, deck_tunings(id, name, sort_order)")` は archived フィルタなし。管理画面はユーザー本人の active ビューと揃える方が混乱が少ないため、`getDecks` と同様に nested select へ `is_archived` を足し、取得後 `.map` で archived を除外する。**決定済み（D4）: 本修正に含める**。

---

## 6. 既存トリガー / FK / RLS の扱い

### 6.1 `normalize_battle_deck_names()` トリガー — 変更不要

論理削除化により tuning 削除時に `battles` への UPDATE が一切発生しない（`UPDATE deck_tunings SET is_archived=true` は `battles` に波及しない）。トリガーは `BEFORE INSERT OR UPDATE ON battles` なので**発火しなくなり、副作用が止まる**。

トリガーの再正規化分岐が残るのは (a) INSERT（新規記録、現在名スナップショットが正しい）、(b) `my_deck_id`/`tuning_id` が変化した UPDATE（履歴編集での明示変更、その 1 件のみ更新が正しい）— いずれも正しい挙動。よって**トリガー本体の migration 修正は不要**。

残存リスク: 将来 `deck_tunings` を物理 DELETE する経路（手動 SQL・将来の管理ツール等）が再導入されると同じ破壊が再発する。アプリコード上の削除経路は `deleteTuning` のみ（`dm`/`pokepoke` の `DeckList` が利用、grep 確認済み）で本修正により論理削除化されるため、現時点では許容。

### 6.2 `battles.tuning_id` FK — `ON DELETE SET NULL` を維持

防御強化として FK を `ON DELETE RESTRICT` 等に変更する案を検討したが**不採用**:
- `deck_tunings.deck_id → decks(id) ON DELETE CASCADE` および `decks → auth.users` のカスケード経路が存在。管理者が Supabase ダッシュボードでユーザーを物理削除する際、`deck_tunings` のカスケード削除が `battles.tuning_id` の `RESTRICT` でブロックされ、アカウント削除カスケードが失敗しうる。
- 論理削除はアプリコード層で完結する正しい修正レイヤであり、FK 変更は副作用が大きい。

よって `ON DELETE SET NULL` を据え置く。

### 6.3 `battles` RLS — 変更しない（重要な「変えてはいけない」点）

`battles` の INSERT/UPDATE `WITH CHECK`（`20260426005407:41-82`）に含まれる
`tuning_id IS NULL OR EXISTS (deck_tunings WHERE id=tuning_id AND deck_id=my_deck_id)`
に `is_archived = false` を**追加してはならない**。追加すると、archived tuning に紐づく履歴を編集（スナップショット保持で `tuning_id` を維持したまま保存）する際に `WITH CHECK` が失敗する。論理削除では archived 行が実在するため現行 RLS のまま通る。

---

## 7. 既に破損した履歴データの扱い

### 7.1 復旧可能性の評価（重要・正直な結論）

2026-04-26〜本修正デプロイまでの間に発生した破損は、**ライブ DB から正確な特定も `tuning_name` の復元も不可能**:

- `tuning_name` は NULL に上書き済み、かつ参照先 `deck_tunings` 行は物理削除済み → 元の値はライブ DB のどこにも残っていない。
- `tuning_id` も NULL 化済み。
- `my_deck_name` は改名後の現在名に上書き済み → 記録時の名前は失われている。
- 検出も困難: 破損行（`tuning_id IS NULL, tuning_name IS NULL`）は「もともと tuning 無しで記録した行」と DB 上区別できない。マーカーが存在しない。

### 7.2 影響範囲スコープ把握用クエリ（read-only / 正確な検出器ではない）

ユーザー指示後に Claude が staging / production に対し read-only で実行可能。

```sql
-- (a) 現在 tuning 参照が生きている battles 件数（修正後は保護される対象）
SELECT game_title, count(*) AS battles_with_tuning
FROM public.battles WHERE tuning_id IS NOT NULL GROUP BY game_title;

-- (b) 改名された可能性のあるデッキ（複数の my_deck_name スナップショットを持つ）
--     ※ 破損行はこの集合内に紛れるが、改名後の正当なスナップショットとも区別不可
SELECT user_id, my_deck_id,
       count(DISTINCT my_deck_name) AS distinct_names,
       array_agg(DISTINCT my_deck_name) AS names
FROM public.battles
GROUP BY user_id, my_deck_id
HAVING count(DISTINCT my_deck_name) > 1;
```

これらは「どのデッキを見るべきか」のスコープ把握に留まり、破損行のピンポイント特定はできない。

### 7.3 対応方針（決定済み → §Resolved Decisions D3）

唯一の正確な復旧手段は Supabase の Point-in-Time Recovery / 日次バックアップ（production プランで有効な場合）から破損前スナップショットを別インスタンスへ復元し、対象 `battles` の `tuning_id`/`tuning_name`/`my_deck_name` と `deck_tunings` 行を抽出してマージし戻すこと。各行の破損時刻が不明なため作業は重く、運用判断が必要。

**決定: (A) 前進保護のみ**。本修正で新規破損を構造的に止めることを優先し、既存破損データは損失として受容する。正確復旧（PITR/バックアップ起点の復元・マージ）は重いため、本 plan のスコープ外の別作業として切り出す。§7.2 のスコープ把握クエリは、ユーザーが後日復旧要否を判断する際の材料として残す。

**production DB への repair / migration はユーザーの明示指示後のみ実施**（CLAUDE.md 準拠）。

---

## 8. 検証手順

### 8.1 Claude が自前で実施（ブラウザ不要）

- `npm run lint`
- 型チェック（`npx tsc --noEmit` または `npx opennextjs-cloudflare build`）— `is_archived` 型反映漏れの検出
- 静的レビュー: §6 のトリガー/FK/RLS 不変条件の確認
- staging へマイグレーション適用後、Supabase MCP（read-only）または `npx supabase migration list` で `deck_tunings.is_archived` 列と partial index `deck_tunings_name_unique_idx` の存在確認
- §7.2 のスコープ把握クエリ（指示後・read-only）

### 8.2 ユーザーが dev preview（staging DB）で実機確認

`https://dev-duepure-tracker.jianrenzhongtian7.workers.dev` で:

1. **バグ再現シナリオ（dm）**: tuning 付きで対戦記録 → デッキ改名 → tuning 削除 → 履歴一覧で `my_deck_name`/`tuning_name` が**記録時のまま**であること
2. **履歴編集 / snapshot 表示**: 上記 battle を編集 → `デッキ名 / チューニング名(記録時)` のスナップショット選択肢が表示・初期選択されること。result のみ変更して保存 → スナップショット保持。加えて以下も確認:
   - **デッキ名衝突**: 記録時デッキを改名（または削除）した後に**同名の別デッキを新規作成**し元 battle を編集 → 新デッキと誤マッチせず記録時スナップショット選択肢が出ること（§5.3 問題(ii) / id+name 複合判定）
   - **tuning 改名**: tuning を**改名のみ**（DeckList で削除せず名前変更）した後、その tuning を使った battle を編集 → `tuning_id` が active のままでも、現在名ではなく**記録時名 `デッキ名 / チューニング名(記録時)` が初期選択**になり、履歴一覧の表示（記録時名）と一致すること（§5.3 問題(iii) / `recordedTuningStale`）
3. **明示変更**: 同 battle を別の active デッキ/tuning に変更して保存 → その 1 件が現在の選択内容に更新されること
4. **DeckList**: 削除した tuning が一覧から消えること / 同名 tuning を再作成できること
5. **stats**: by-tuning 集計で archived tuning の過去戦績がその名前のまま残ること
6. **pokepoke** で 1〜5 の主要点を確認（共通コードだが念のため）

---

## 9. デプロイ順序

本マイグレーションは**追加専用（expand）**。新コードは `is_archived` 列を参照するため、列が存在しない状態で新コードが動くと PostgREST が 400 を返し decks/battle 画面が壊れる。よって**マイグレーションがコード反映と同時かそれ以前**である必要がある。

> ✅ 順序方針（決定済み → §Resolved Decisions）: CLAUDE.md / AGENTS.md の禁止事項セクション（`npx supabase db push` 項目）および `## Supabaseマイグレーション` セクションに「既存本番コードが参照せず旧コードに無害な additive expand migration（nullable/default 付きの列追加等）は、staging 適用・dev preview 検証後、ユーザーの明示承認がある場合に限り code deploy 前に production DB へ先行適用してよい」例外条項が反映済み。本件 `deck_tunings.is_archived` 追加はこの例外に該当するため、production マイグレーションを main マージより**先行**適用する。
>
> 例外の適用範囲は **additive expand に限定**する。破壊的変更・制約強化（NOT NULL 追加 / CHECK 追加等）・列削除・既存値変換は例外に含めず、従来どおり「本番コード反映後」または「expand → code deploy → contract の分割手順」で扱う。本マイグレーション（§4.1）は `ADD COLUMN ... DEFAULT false` と index 張り替えのみで、既存値変換も制約強化も含まないため範囲内。

### staging（dev preview 検証用）

1. ローカル `dev` ブランチで migration + コード + 型を commit
2. **staging DB へマイグレーション適用**（dev preview は staging DB 参照）
   ```bash
   export STAGING_DB_URL='postgresql://...'   # チャットに貼らない
   npm_config_cache=/private/tmp/npm-cache npx supabase db push --db-url "$STAGING_DB_URL" --include-all
   npm_config_cache=/private/tmp/npm-cache npx supabase migration list --db-url "$STAGING_DB_URL"
   ```
3. `git push origin dev` → Cloudflare dev preview ビルド（3〜5分）
4. §8.2 をユーザーが検証

### production（ユーザーの「本番反映」明示指示後のみ）

5. **production DB へマイグレーション適用**（expand のため code deploy 前に適用。現行 prod コードは `is_archived` 非参照のため無害）。migration list / 件数確認後に実行
6. `git checkout main && git pull && git merge dev && git push origin main` → Cloudflare 本番デプロイ
7. `git checkout dev` に戻す

---

## 10. 要決定事項（D1〜D4 すべて解決済み）

下表は判断の経緯。確定内容は末尾 §Resolved Decisions を参照。実装着手前の未決事項は無い。

| # | 論点 | 確定 |
|---|------|------|
| D1 | （解決済み → §Resolved Decisions）production マイグレーション適用順序 | expand 先行で確定。CLAUDE.md / AGENTS.md に例外条項追記済み |
| D2 | （解決済み → §Resolved Decisions）スナップショット選択肢の表示文言 | `(記録時)` で統一（既存 UI 準拠） |
| D3 | （解決済み → §Resolved Decisions）既存破損データ（§7）の方針 | (A) 前進保護のみ。既存破損の復旧は別作業として切り出し |
| D4 | （解決済み → §Resolved Decisions）`getAdminUserDecks` を active tuning 限定にするか | 限定する（本修正に含める） |

---

## 11. リスクとロールバック

- **リスク（最大）**: デプロイ順序ミス（コード先行 → 列不在）で decks/battle 画面が 400 で壊れる。→ §9 の expand 順序を厳守。
- **リスク（中）**: `EditBattleModal` のスナップショット判定ロジック。→ §8.2 の手動確認でカバー。
- **ロールバック / roll-forward 方針**:
  - コード: Cloudflare Dashboard → Deployments → Rollback で 1 クリック数秒。
  - **production マイグレーション先行直後（`is_archived=true` の行がまだ 0 件）の窓**では、現行（旧）コードに対して完全に無害 — 全行 `is_archived=false` のため partial index は旧 full index と等価、`getDecks()` の出力も不変。この「列だけ先行・コード未反映」状態は安全。
  - **新コード稼働後（`is_archived=true` の tuning が発生した後）にコードだけ旧版へ rollback すると非互換になる**: 旧 `getDecks()` は `is_archived` を見ないため**削除済み tuning を再表示**し、旧 `deleteTuning()` は**物理削除**のため、ユーザーが再表示された tuning を削除すると本 plan が塞いだ FK `SET NULL` → trigger 経由のスナップショット破壊が**再発しうる**。
  - したがって**新コード稼働後の不具合対応は roll-forward（前進修正）を最優先**とする。コード rollback はやむを得ない緊急回避に限定し、その短時間はユーザーに tuning 削除を控えてもらう等の運用注意を伴う。
  - DB 列 drop は非推奨: archived 行が存在する状態で `is_archived` を drop し旧 full unique index を復元すると、同名 active+archived ペアで一意制約違反になりうる。ロールバック時も列は据え置く。
- **後方互換（安全な窓の限定）**: 旧コードが新スキーマ上で安全に動くのは「`is_archived=true` の行が 0 件の間」（= production マイグレーション先行 〜 新コード反映までの窓）に限る。この窓内では `deleteTuning` の物理 DELETE も partial index も旧挙動と等価。新コード反映後（archived 行が発生した後）は上記のとおり旧コードへの後退は非互換になる点に注意。

---

## 12. 実装チェックリスト

- [ ] `supabase/migrations/20260521000001_deck_tunings_logical_delete.sql` 作成（§4.1）
- [ ] `database.types.ts` の `deck_tunings` に `is_archived` 反映（§5.1）
- [ ] `deck-actions.ts`: `getDecks` を active tuning 限定に（§5.2）
- [ ] `deck-actions.ts`: `deleteTuning` を `is_archived=true` UPDATE 化（§5.2）
- [ ] `deck-actions.ts`: `createTuning` / `updateTuning` の重複チェックに `is_archived=false`（§5.2）
- [ ] `EditBattleModal.tsx`: スナップショット選択肢ロジック拡張（§5.3）
- [ ] `admin-actions.ts` `getAdminUserDecks` を active tuning 限定に（§5.4 / D4 決定済み）
- [ ] トリガー / `battles.tuning_id` FK / `battles` RLS は**変更しない**ことを確認（§6）
- [ ] `scripts/sync-staging-data.mjs` の `deck_tunings` 取り扱い確認（`selectAll` が `select("*")` で全列取得するため `is_archived` は列追加後自動的にコピー対象に含まれる。スクリプト側の追加対応は不要）
- [ ] `npm run lint` / 型チェック green
- [ ] staging 適用 → dev push → §8.2 検証 → ユーザー OK → 本番（§9）

---

## Resolved Decisions

review-plan-loop で escalate された判断の確定記録。実装時はこの決定に従う。

- **[migration順序] is_archived 列追加（additive expand）の production マイグレーション適用タイミング → 「CLAUDE.md 側を改訂」（選択肢 3）**
  - ユーザーが AGENTS.md / CLAUDE.md に「additive expand 列追加（DEFAULT 値付き・旧本番コードが参照しないもの）は code deploy 前に production 適用してよい」例外条項を追記済み。
  - 本件 `deck_tunings.is_archived` 追加はこの例外に該当 → production の additive expand マイグレーションを main 反映より**先行**適用する（§9）。
  - 適用フロー: staging 適用 → dev preview 検証 → ユーザー承認 → production へ expand マイグレーション先行適用 → main 反映。
  - production DB への適用は従来どおりユーザーの明示指示後のみ。
  - 例外の適用範囲は **additive expand に限定**。破壊的変更・制約強化・列削除・既存値変換は例外に含めず、従来手順（本番コード反映後 / expand → code deploy → contract の分割）で扱う。

- **[D2 表示文言] 削除済み tuning / デッキのスナップショット選択肢の表示文言 → `(記録時)` で統一**
  - 既存の削除済みデッキ表示ルール（`${battle.my_deck_name}(記録時)`）に合わせる。tuning ありの場合は `デッキ名 / チューニング名(記録時)`。タスク例の `(対戦記録時)` は採用せず、既存 UI 準拠を優先する。

- **[D3 既存破損データ] §7 の既存破損履歴の方針 → (A) 前進保護のみ**
  - 本修正で新規破損を構造的に止めることを優先。既存破損データの正確復旧（PITR/バックアップ起点の復元・マージ）は重いため、本 plan のスコープ外の別作業として切り出す。
  - §7.2 のスコープ把握クエリは後日の復旧要否判断の材料として残置。production への repair はユーザー明示指示後のみ。

- **[D4 admin 一貫性] `getAdminUserDecks` を active tuning 限定にするか → 限定する（本修正に含める）**
  - 管理画面でも通常ユーザー視点（active のみ）と揃え、archived tuning が混在しないようにする。`getDecks` と同じく nested select + `.map` filter で実装（§5.4）。
