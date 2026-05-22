# 実装報告書: チューニング論理削除化 — 対戦履歴スナップショット破壊バグ修正

- 報告日: 2026-05-22
- 対象 plan: `docs/plans/2026-05-21_tuning_logical_delete_snapshot_fix.md`
- ステータス: **本番反映完了・本番稼働確認済み**
- 対象ゲーム: dm / pokepoke 両方（共通コードで同時カバー）

---

## 1. サマリ

過去の対戦履歴が意図せず書き換わる不具合を修正した。

**不具合**: チューニング付きで記録した対戦履歴で、そのチューニングを使用デッキ管理画面から削除すると、過去履歴の `battles.my_deck_name` が記録時の名前ではなくデッキ改名後の現在名に置換され、`battles.tuning_name` が NULL に上書きされていた。

**修正**: `deck_tunings` を物理削除から論理削除（`is_archived`）へ変更。論理削除ではチューニング削除時に `battles` への副作用 UPDATE が発生しないため、過去履歴のスナップショットが構造的に保護される。あわせて履歴編集画面で、削除済み・改名済みチューニングを「記録時の選択肢」として表示できるようにした。

トリガー / FK / RLS は変更していない（論理削除化により副作用経路自体が消えるため）。

---

## 2. 不具合の根本原因

| # | 事象 | 根拠 |
|---|------|------|
| 1 | `deleteTuning()` が `deck_tunings` を物理 `delete()` していた | `src/lib/actions/deck-actions.ts` |
| 2 | `battles.tuning_id` は `deck_tunings(id) ON DELETE SET NULL` の FK を持つ | `20260314000001_add_deck_tunings.sql` |
| 3 | チューニング物理削除で DB 側が該当 `battles` 行の `tuning_id` を NULL に UPDATE | FK `ON DELETE SET NULL` の動作 |
| 4 | この `battles` UPDATE が `battles_normalize_deck_names` トリガ（`BEFORE INSERT OR UPDATE`）を発火させる | `20260426005407_strengthen_battles_rls.sql` |
| 5 | トリガは `my_deck_id` と `tuning_id` がともに不変の UPDATE でのみ OLD 名を保持。`tuning_id` が `uuid → NULL` に変化したため OLD 名保持分岐をスキップし、`decks` / `deck_tunings` から再正規化 | 同上 |

結果、`my_deck_name` は `decks.name`（改名後の現在名）に再正規化され、`tuning_name` は `tuning_id` が NULL のため NULL に上書きされた。デッキを改名していない場合でも `tuning_name` の NULL 化は必ず発生していた。

**影響期間**: トリガ導入（`20260426005407`、2026-04-26）以降、本修正の本番反映（2026-05-22）まで。

---

## 3. 修正内容

### 3.1 DB マイグレーション — `supabase/migrations/20260521000001_deck_tunings_logical_delete.sql`（新規）

追加専用（expand）マイグレーション。

1. `deck_tunings` に `is_archived boolean NOT NULL DEFAULT false` 列を追加（既存行はすべて active）。
2. 一意 index `deck_tunings_name_unique_idx` を全行対象から partial unique（`WHERE is_archived = false`）へ張り替え。アーカイブ済みチューニングと同名の active チューニングを再作成可能にするため（`decks_active_name_unique_idx` と同方式）。

適用時点では全行 `is_archived = false` かつ旧 index で一意性が保証済みのため、重複解消処理は不要だった（staging / production とも重複 0 組を事前確認）。

### 3.2 アプリケーションコード

| ファイル | 変更 |
|----------|------|
| `src/lib/supabase/database.types.ts` | `deck_tunings` の Row/Insert/Update に `is_archived` を追加 |
| `src/lib/actions/deck-actions.ts` | `deleteTuning()` を物理削除 → `is_archived = true` の論理削除へ。`getDecks()` を active なチューニングのみ返却（nested select + クライアント側 filter）。`createTuning()` / `updateTuning()` の重複チェックを `is_archived = false` 限定に |
| `src/components/battle/EditBattleModal.tsx` | 削除済み・改名済みチューニングを記録時スナップショット選択肢として表示。`recordedDeckExists` を id+記録時名の複合判定に変更。`recordedTuningStale`（チューニングが現存しない、または現存するが現在名が記録時名と異なる）を追加。単一センチネル `__snapshot__` 方式に統一 |
| `src/lib/actions/admin-actions.ts` | `getAdminUserDecks()` を active なチューニングのみ返却（管理画面をユーザー視点と揃える） |

### 3.3 意図的に変更しなかったもの

- **`normalize_battle_deck_names()` トリガ**: 論理削除化により削除時の `battles` UPDATE が消えるため副作用が止まる。INSERT 時・履歴編集での明示変更時の再正規化は正しい挙動として維持。
- **`battles.tuning_id` FK（`ON DELETE SET NULL`）**: `ON DELETE RESTRICT` 化も検討したが、`decks → auth.users` のカスケード削除経路をブロックしうるため不採用。
- **`battles` RLS**: INSERT/UPDATE の `WITH CHECK` の `EXISTS (deck_tunings ...)` に `is_archived = false` を追加してはならない（アーカイブ済みチューニングに紐づく履歴の編集が失敗するため）。論理削除では行が実在するため現行のまま通る。

---

## 4. 設計レビュー経緯

plan は `/review-plan-loop`（plan-critic subagent による検証ループ）と外部レビュー（codex）を複数ラウンド経て確定した。

- **plan-critic**: mechanical 指摘（migration ファイル名参照の精度、`sync-staging-data.mjs` の挙動誤認、RLS 行番号参照、CLAUDE.md 例外条項の表現）を自動修正。最終 GO。
- **codex レビューで反映した主な指摘**:
  - **P2**: ロールバック節 — 新コード稼働後にコードだけ rollback すると、旧 `getDecks()` が削除済みチューニングを再表示し旧 `deleteTuning()` の物理削除でバグが再発しうる。→ roll-forward 優先を明記。
  - **P3**: `EditBattleModal` の snapshot 判定を名前一致のみ → id+記録時名の複合判定へ。削除/改名済みデッキと同名の別デッキを後から作成したケースの誤判定を防止。
  - **追加**: チューニング改名のみ（`tuning_id` は active のまま名前が変わった）ケースも snapshot 扱いに（`recordedTuningStale`）。

**確定した決定事項（plan の Resolved Decisions）**:

| # | 論点 | 決定 |
|---|------|------|
| D1 | additive expand マイグレーションの production 適用順序 | code deploy 前に先行適用。CLAUDE.md / AGENTS.md に例外条項を追記済み |
| D2 | スナップショット選択肢の表示文言 | `(記録時)` で統一（既存 UI 準拠） |
| D3 | 既存破損データの方針 | (A) 前進保護のみ。既存破損の復旧は別作業として切り出し |
| D4 | `getAdminUserDecks` の active 限定 | 本修正に含める |

---

## 5. 検証

### 5.1 Claude 自前検証
- `npx tsc --noEmit` — エラーなし。
- `npm run lint` — 変更ファイルに新規指摘なし（既存の指摘は編集箇所外）。

### 5.2 staging（dev preview / staging DB）
- staging DB へ migration を適用し、`is_archived`（NOT NULL / DEFAULT false）・partial unique index の存在を検証。
- dev preview（`dev-duepure-tracker...workers.dev`）でユーザーが実機検証 — 問題なし。

### 5.3 production
- production DB へ migration を適用し、`is_archived`・partial unique index・`schema_migrations` 記録を検証。
- `main` マージ後、Cloudflare 本番デプロイ。`https://tierlog.app` でユーザーがスモーク確認 — 問題なし。

---

## 6. デプロイ記録

| 項目 | 内容 |
|------|------|
| 実装コミット | `d83d00c` `fix: チューニング削除を論理削除化し対戦履歴スナップショット破壊を修正`（6 ファイル） |
| 本番マージコミット | `8a93422` `Merge branch 'dev': tuning 論理削除化で対戦履歴スナップショット破壊を修正` |
| 適用順序 | **expand**: production DB マイグレーション先行適用 → `main` マージ（列不在 400 の窓を回避） |
| マイグレーション適用方式 | `npx supabase` が当環境で動作しないため `pg` ドライバ直叩き。project ref ガード（staging `uqndrkaxmbfjuiociuns` / production `asjqtqxvwipqmtpcatvz`）。staging は DDL のみ、production は DDL + `supabase_migrations.schema_migrations` 記録（repo との整合維持） |
| 内容一致確認 | マージ後 `git diff dev main` が空 — 本番は dev preview 検証済みの状態と完全一致 |

---

## 7. 残課題・既知の制約

- **既存破損データ（決定 D3 = 前進保護のみ）**: 2026-04-26〜本番反映（2026-05-22）の間にチューニング削除で破損した可能性のある過去履歴は、本修正では repair していない。`tuning_name` は NULL 上書き＋参照先行の物理削除により、ライブ DB からの正確な特定・復元は不可能。復旧が必要な場合は Supabase の Point-in-Time Recovery / バックアップ起点の別作業となる。影響範囲スコープ把握用の read-only クエリは plan §7.2 に記載。
- **ロールバック方針（plan §11）**: 新コード稼働後にアーカイブ行が発生した状態でコードだけ旧版へ rollback すると、旧 `getDecks()` が削除済みチューニングを再表示し旧 `deleteTuning()` の物理削除でバグが再発しうる。不具合時は roll-forward（前進修正）を優先する。DB の `is_archived` 列は据え置いてよい。
- **staging の migration 履歴ズレ**: staging DB の `schema_migrations` には既存のリネーム由来ズレがある（`supabase-migration-ops` メモ参照）。本マイグレーションは staging では DDL のみ適用したため、staging の履歴には `20260521000001` を記録していない。production 側は記録済みで repo と整合。

---

## 8. 変更ファイル一覧

```
supabase/migrations/20260521000001_deck_tunings_logical_delete.sql  (新規)
src/lib/supabase/database.types.ts
src/lib/actions/deck-actions.ts
src/components/battle/EditBattleModal.tsx
src/lib/actions/admin-actions.ts
docs/plans/2026-05-21_tuning_logical_delete_snapshot_fix.md          (新規 / 設計文書)
docs/reports/2026-05-22_tuning_logical_delete_snapshot_fix.md        (新規 / 本報告書)
```
