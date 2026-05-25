# 実装報告書: 最小ユニットテスト導入（#4）

- 報告日: 2026-05-25
- 対象 plan: `docs/plans/2026-05-24_pre_public_blocker_resolution_plan.md` §4-5 #4-a / #4-b
- 対象レビュー: `docs/reports/2026-05-20_pre_public_readiness_review.md` §4-4 公開ブロッカー #4
- ステータス: **dev 完了、main 反映待ち**
- 対象範囲: 純関数 5 ファイル（純関数層の基幹ヘルパー）

---

## 1. サマリ

`#4` 「主要ロジックへの最小ユニットテスト追加」を完了。`vitest` を導入し、純関数 5 ファイルに `*.test.ts` を併置（計 **101 ケース全 pass**、547ms）。CI の `quality` job 末尾に `npm test` ステップを追加し、`push` / `pull_request` トリガーで lint + typecheck + test の 3 段ゲートが本番反映前に必ず走る状態を確立した。

実装は plan §4-5 通り 2 段階で:
- **#4-a (refactor)**: `stats-actions.ts` の private helper を `src/lib/stats/transform.ts` に抽出（挙動変更なし）
- **#4-b (test)**: vitest 導入 + 5 ファイル分のテスト追加 + CI 統合

これにより `docs/reports/2026-05-20_pre_public_readiness_review.md` で挙がった **公開ブロッカー 6 件 + #0 typecheck 赤信号がすべて解消** され、公開準備が整った状態となる。

---

## 2. #4-a refactor: helper 抽出（commit `20f68bb`）

### 抽出元と移動先

| 抽出元 | 移動先 |
|---|---|
| `src/lib/actions/stats-actions.ts` 内の private helper | `src/lib/stats/transform.ts`（新規） |

### 抽出対象

- 関数: `toN` / `toWinRate` / `mapDetailRow` / `rowToDetail`
- 型: `DetailRowBase` / `DetailRpcRow` / `OpponentDetail`

### `stats-actions.ts` の変更

- 上記 helper / 型の定義を削除
- `import { toN, toWinRate, mapDetailRow, rowToDetail, type DetailRpcRow, type OpponentDetail } from "@/lib/stats/transform"` を追加
- `OpponentDetail` は外部 import（`components/stats/MatchupTable.tsx` / `MatchupCard.tsx` / `lib/actions/admin-actions.ts`）の互換性維持のため、`export type { OpponentDetail }` で **re-export**

### 設計判断（plan §Resolved Decisions [stats helper場所]）

- 純関数層は `src/lib/stats/` に配置（actions は DB I/O 層として残す）
- 循環依存回避のため `src/lib/stats/` から `src/lib/actions/` への import は禁止
- `transform.ts` は `@/lib/battle/result-format` の `winRate` のみ外部依存（actions/ 経由ではない、循環依存なし）

### 挙動への影響

なし（純粋な module 分割）。`toN` / `toWinRate` / `mapDetailRow` / `rowToDetail` のロジックは無変更、全 call sites は引き続き同じ helper 経由で動作（import path のみ変更）。

---

## 3. #4-b test 導入（commit `77582b6`）

### ツール

- `vitest@^4.1.7` を devDependency に install
- `vitest.config.ts` 新規:
  - `environment: "node"`（Supabase / 外部 API 接続なし、純関数前提）
  - `@` alias 解決（`tsconfig.json` の `paths` と同じ参照パス）
  - `include: ["src/**/*.test.ts"]`（テストファイルは対象モジュールと併置）
  - coverage 設定は CI では後回し（最低限 lint + typecheck + test の 3 ジョブ通過を優先）
- `package.json` の `scripts` に `"test": "vitest run"` / `"test:watch": "vitest"` 追加

### テスト 5 ファイル / 101 ケース

| ファイル | ケース数 | カバー範囲 |
|---|---:|---|
| `src/lib/battle/result-format.test.ts` | 32 | `supportsDraw` / `formatWLT` / `formatWLTJa` / `resultLabel` / `winRate` / `winRateLabel` / `resultColorClass` / `resultBgClass` / `bumpWLD` |
| `src/lib/games/index.test.ts` | 16 | `GAMES` registry / `GAME_SLUGS` / `DEFAULT_GAME` / `APP_BRAND` / `isGameSlug` / `resolveGameFromPath` / `getGameMeta` + **format コードがゲーム間で重複しない**不変条件 |
| `src/lib/util/whitespace.test.ts` | 16 | `stripAllWhitespace` — ASCII whitespace / Unicode whitespace（U+3000 全角 / U+200B〜U+200D zero-width / U+FEFF BOM）+ **DB CHECK 制約との一致確認** |
| `src/lib/search/normalize.test.ts` | 21 | `normalizeQuery`（NFKC + lowercase + ひらがな→カタカナ） / `matchesQuery`（空クエリ / 正規化経由一致 / 複数候補） |
| `src/lib/stats/transform.test.ts` | 16 | `toN` / `toWinRate`（number / string / null / undefined ハンドリング） / `mapDetailRow` / `rowToDetail`（number / string / null draws / 分母 0 → null winRate） |
| **計** | **101** | |

### 設計方針（plan §4-5 / ユーザー指示）

- 純関数中心、Supabase 実 DB や外部 API には接続しない（Node environment 固定）
- 各テストファイルは対象モジュールと **同階層併置**（`src/lib/.../foo.test.ts` の形）
- `vitest.config.ts` の `@` alias で `tsconfig.json` の path と一致させ、import 互換性を保つ
- coverage 計測は本フェーズでは導入しない

### CI 統合（`.github/workflows/ci.yml`）

`quality` job に以下を追加:

```yaml
- name: Test (vitest)
  run: npm test
```

加えて job 名を `lint + typecheck` → `lint + typecheck + test` に更新。

これにより `dev` / `main` への push / PR で **3 段ゲート**（typecheck → lint → test）が必ず走る。

---

## 4. 検証結果

### ローカル

```
$ npm test
Test Files  5 passed (5)
Tests       101 passed (101)
Duration    547ms

$ npx tsc --noEmit
(0 error)

$ npm run lint
(0 errors / 0 warnings)
```

### GitHub Actions

- #4-a run `26400833295`: ✅ success（lint + typecheck）
- #4-b run `26401135634`: ✅ success（lint + typecheck + **test**、新規 step 含めて green）

---

## 5. 設計上の補足

### transform.ts の外部依存

- `@/lib/battle/result-format` から `winRate` のみ import
- これは循環依存にならない（`result-format.ts` は他に依存しない leaf module）

### 既存コードへの影響

- `OpponentDetail` 型を import している既存 3 ファイル（`MatchupTable.tsx` / `MatchupCard.tsx` / `admin-actions.ts`）は **無変更**（stats-actions.ts の re-export で互換性維持）
- `stats-actions.ts` 内で `winRate` を直接呼ぶ箇所が複数あったため、`winRate` の import は維持

### vitest 4.x の選定

- Next.js 16 / TypeScript 5.x / ESM 環境との親和性
- jest より軽量、設定がシンプル
- `@vitest/coverage-v8` 等で将来 coverage 追加可能（plan §4-5 で「coverage は CI では後回し」と明示）

---

## 6. 残作業

| # | 項目 | 状態 |
|---:|---|---|
| 1 | `--no-ff` で dev → main merge / push | ユーザー指示後 Claude 作業 |
| 2 | Cloudflare 自動ビルド完了の確認（3〜5 分） | ユーザー側 / Claude 自動再起動 |
| 3 | 本番健全性確認（`cloudflare-rollback.md` §1 の curl 3 件） | Claude / ユーザー |
| 4 | GitHub Actions の main push CI が `lint + typecheck + test` 全 step green であることの確認 | Claude / ユーザー |

main 反映後、公開ブロッカー解消フェーズはすべて完了する。

---

## 7. 公開ブロッカー全体の達成状況

| # | 項目 | 完了 commit (dev) | main 反映 |
|---:|---|---|---:|
| #0 | typecheck 修正 | `c2b80e4` | ✅ 反映済 |
| #1 | privacy 補強 | `94e3d0e` 等 | ✅ 反映済 |
| #2 | ログイン不要問い合わせ窓口 | `94e3d0e` 等 | ✅ 反映済 |
| #3 | lint エラー解消（89 → 0） | 12 commits | ✅ 反映済 |
| **#4** | **最小ユニットテスト追加（101 ケース）** | **`20f68bb` + `77582b6`** | **⏳ 本報告書の対象** |
| #5 | GitHub Actions CI ゲート | `2012909` (+ #4-b で test step 追加) | ✅ 反映済 |
| #6 | Sentry + runbook | `cdbf30c` (merge) | ✅ 反映済 |

`#4` を main 反映すれば、`docs/reports/2026-05-20_pre_public_readiness_review.md` で挙がった全件解消となる。

---

## 8. 関連 commit / 関連報告書

### dev branch の #4 関連 commits

| commit | 内容 |
|---|---|
| `20f68bb` | refactor(stats): stats-actions の純関数 helper を src/lib/stats/transform.ts に抽出 (#4-a) |
| `77582b6` | feat(test): vitest 導入 + 純関数ユニットテスト 5 ファイル追加 + CI 統合 (#4-b、#4 完了) |

### 関連報告書

- 元レビュー: `docs/reports/2026-05-20_pre_public_readiness_review.md` §4-4
- 直前報告書: `docs/reports/2026-05-25_sentry_runbook_implementation.md`（#6 完了報告書）
- spike: `docs/reports/2026-05-24_sentry_opennext_spike.md`

### plan

- `docs/plans/2026-05-24_pre_public_blocker_resolution_plan.md` §4-5 / §Resolved Decisions [stats helper場所]
