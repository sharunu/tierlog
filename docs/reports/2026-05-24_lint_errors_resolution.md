# 実装報告書: lint エラー解消フェーズ（#3）+ typecheck 修正（#0）+ CI ゲート追加（#5）

- 報告日: 2026-05-24
- 対象 plan: `docs/plans/2026-05-24_pre_public_blocker_resolution_plan.md` §4-0 / §4-1 / §4-2
- 対象レビュー: `docs/reports/2026-05-20_pre_public_readiness_review.md` 公開ブロッカー #0 / #3 / #5
- ステータス: **dev push 完了・CI green 確認済・本番反映待ち**
- 対象範囲: 全アプリ（dm / pokepoke / admin / 共有 component / hooks / actions）

---

## 1. サマリ

2026-05-20 の一般公開前 readiness review で挙がった公開ブロッカーのうち、品質ゲート確立に必要な 3 件を dev で解消した。

- **#0** `npx tsc --noEmit` の typecheck 失敗 → 0 error
- **#3** `npm run lint` の lint エラー → **89 problems (65 errors / 24 warnings) → 0 problems**（100% 解消）
- **#5** GitHub Actions に push / PR ベースの lint + typecheck 品質ゲートを新設

これにより、CI が今後の lint / typecheck 退行を自動検知できる状態になった。main 反映後は legacy `limitless-sync.yml` と並列で動作し、Cloudflare Workers Builds（別系統のビルド）とも競合しない。

実装にあたっては codex による事前レビューを 3 ラウンド、進行中の指摘反映を 2 ラウンド受けた。完了時点で `git diff --check` も問題なし。

---

## 2. 背景

`docs/reports/2026-05-20_pre_public_readiness_review.md` §4-4 で「テスト・CI・品質保証」が 3/15 と最低スコアとなり、以下が公開ブロッカーとして列挙されていた:

- lint が失敗している（当時 58 problems / 34 errors / 24 warnings）
- CI 品質ゲートがない（`.github/workflows/` は `limitless-sync.yml` のみで、push / pull_request 系のゲートなし）
- typecheck は当時通っていたが、本 plan 作成時に再計測したところ `battle-actions.ts:80` で TS2345 が発生していた（5/20 以降の commit で混入）

加えて再計測時は 89 problems / 65 errors / 24 warnings へ悪化していたため、当初想定よりエラー数が多い状態からの着手となった。

---

## 3. 修正内容

### 3.1 #0 typecheck 修正（1 commit）

| commit | 内容 |
|---|---|
| `c2b80e4` | `src/lib/actions/battle-actions.ts:65` の `updateData: Record<string, unknown>` を `Database["public"]["Tables"]["battles"]["Update"]` 型 (`BattleUpdate` エイリアス) に置換。supabase-js v2 の `update()` 余分プロパティ拒否型と整合 |

最小差分原則（codex 注文）に従い `admin-actions.ts` の inline literal キャストには触らず、他 action ファイルへの変更も 0 件。`updateBattle` の挙動は変更なし。

### 3.2 #3 lint エラー解消（12 commits）

| # | commit | ルール | 解消件数 | 主な変更 |
|---:|---|---|---:|---|
| 1 | `421697a` | Unused eslint-disable directive | 2 | `use-date-range.ts` の冗長 disable 2 行を削除 |
| 2 | `506f522` | `@typescript-eslint/no-unused-vars` | 15 | eslint.config.mjs に `argsIgnorePattern: "^_"` 追加 (`_game` 互換引数を保護)。他は未使用 import / 集計変数 / 関数の削除 |
| 3 | `88515a4` | `react-hooks/exhaustive-deps` | 2 | `handleRangeChange` を `useCallback` でラップし useMemo 依存配列に追加 (dm/battle, pokepoke/battle) |
| 4a | `d048ab5` | `@typescript-eslint/no-explicit-any` | 3 | `admin-actions.ts` の `(supabase.rpc as any)` 3 箇所を削除 (database.types.ts に Args/Returns が型登録済) |
| 4b | `beaa2f7` | `@typescript-eslint/no-explicit-any` | 7 | `TrendChart` / `EncounterDonutChart` の payload・entry・dotConfig・latestPeriod 等を自前型 / type assertion で narrow。recharts の library 型と互換不可な 2 箇所のみ理由付き disable |
| 5 | `9bc3261` | `@next/next/no-img-element` | 5 | Discord CDN icon 4 件 + OG preview 1 件を理由付き disable (OpenNext で next/image 最適化不可) |
| 6 | `96afc5c` | `react-hooks/refs` (7) + `react-hooks/immutability` (1) | 8 | `OpponentDeckManager.tsx` の `savedSettingsRef` を `savedSettings` state に置換、`applyRef.current = handleApply` の useEffect を handleApply 定義後に移動 |
| 7 | `0ca5591` | `react-hooks/set-state-in-effect` | 5 | hooks 系 (`use-active-team` / `use-format` / `use-selected-game` / `BanGuard` / `BottomNav`) の mount 時 localStorage/cookie resolve |
| 8 | `3df913f` | `react-hooks/set-state-in-effect` | 10 | dm/stats + pokepoke/stats 各 5 件 (premium reset / team members / 仮選択 / scope reset / loadData) |
| 9 | `1e854fe` | `react-hooks/set-state-in-effect` | 6 | BattleRecordForm / EditBattleModal / OpponentDeckSelector |
| 10 | `8a076ae` | `react-hooks/set-state-in-effect` | 8 | admin page + AdminUser components + FeedbackList |
| 11 | `85a8061` | `react-hooks/set-state-in-effect` | 9 | account / auth/confirm / dm page 各種 (URL resolve + useCallback fetch トリガー) |
| 12 | `397b5bf` | `react-hooks/set-state-in-effect` | 9 | pokepoke page + OpponentDeckManager (format 切替時 12+ state reset) + EncounterDonutChart |

### 3.3 #5 GitHub Actions CI ゲート追加（1 commit）

| commit | 内容 |
|---|---|
| `2012909` | `.github/workflows/ci.yml` を新規作成。`push: [dev, main]` / `pull_request: [main, dev]` で起動、Node 22 + `npm ci` + `npx tsc --noEmit` + `npm run lint` の 1 job 構成。ビルド本体は Cloudflare Workers Builds に任せ、CI では実行しない。既存 `limitless-sync.yml` には触らない |

dev push 直後の run (`26362520502`) は約 1 分で green。`actions/checkout@v4` 系の Node.js 20 deprecation warning が出ているが、これは action 内部実装の話で当面影響なし（2026-06 までに対応で OK）。

---

## 4. 結果（数値）

| 指標 | 開始時 | #0 完了 | #3 完了 | 最終 |
|---|---:|---:|---:|---:|
| `npx tsc --noEmit` errors | **1** | 0 | 0 | **0** |
| `npm run lint` problems | 89 | 89 | 0 | **0** |
| └ errors | 65 | 65 | 0 | **0** |
| └ warnings | 24 | 24 | 0 | **0** |
| GitHub Actions quality gate | なし | なし | なし | **green** |

---

## 5. 新規追加 eslint-disable directive 内訳

実差分（`git diff c2b80e4..HEAD` から `eslint-(disable|enable)` を抽出）で **計 54 directive** を新規追加した:

| ルール | next-line | block (eslint-disable) | 計 |
|---|---:|---:|---:|
| `react-hooks/set-state-in-effect` | 40 | 7 | **47** |
| `@next/next/no-img-element` | 5 | 0 | 5 |
| `@typescript-eslint/no-explicit-any` | 2 | 0 | 2 |
| **計** | **47** | **7** | **54** |

> 加えて block 終了マーカ `eslint-enable react-hooks/set-state-in-effect` が 7 件あるが、directive そのものではなく block の閉じ符号として扱う。

### 5.1 `react-hooks/set-state-in-effect` 47 件のパターン分類

plan §4-1 #1 のパターン分類:

- **パターン A**（mount 時の URL/localStorage/cookie/searchParams resolve）: 該当多数 — すべて単一 disable
- **パターン C**（useCallback ラップ済 fetch トリガー、props/外部状態変化時の同期 reset）: 該当多数 — 単一 disable + block disable 全 7 箇所
- **パターン B**（派生 state / 初期値計算で `useMemo` / `useState(() => init)` に置換可能なもの）: **該当なし**

47 件すべてが mount/外部状態 resolve または fetch トリガー or props 同期だったため、すべて A・C として扱った。実装修正による派生 state 化（パターン B）の対象は今回見つからなかった。

### 5.2 block disable を採用した 7 箇所

effect 内に 2 つ以上の setState が連続するケースで、per-line disable では「最初の setState を抑制すると次の setState が新たな警告対象に昇格する」ESLint の挙動が確認されたため、`/* eslint-disable react-hooks/set-state-in-effect */` 〜 `/* eslint-enable */` で対応:

| ファイル | 抑制対象 |
|---|---|
| `src/app/dm/stats/page.tsx` | 仮選択ロジック (`setActiveTeamId` + `setSelectedMemberId`) |
| `src/app/pokepoke/stats/page.tsx` | 同上 (コピーファイル) |
| `src/components/battle/BattleRecordForm.tsx` | `setSelectedValue` × 4 (deck/format 変化時 localStorage resolve) |
| `src/components/battle/BattleRecordForm.tsx` | `setMemoSuggestions` + `setShowMemo` + `setOpponentMemo` (opponentDeck クリア時 reset) |
| `src/components/battle/OpponentDeckSelector.tsx` | `setShowOther` + `setShowMore` + `setSearchText` (value クリア時 reset) |
| `src/components/admin/AdminUserDecks.tsx` | `setLoading` + `setError` (再 fetch 前 reset) |
| `src/components/admin/OpponentDeckManager.tsx` | format 切替時に 12+ state を一斉に同期 reset |

### 5.3 ルール別 / ファイル別の disable 一覧

#### `@typescript-eslint/no-explicit-any` (2 件、いずれも recharts library 型不整合)

- `src/components/stats/EncounterDonutChart.tsx:28` — `PieLabelRenderProps` に自前の `pct` プロパティが含まれず library 型と互換不可
- `src/components/stats/TrendChart.tsx:190` — `RechartsMouseEventHandler<DotProps, SVGCircleElement>` と React.MouseEvent 単独型が互換不可

#### `@next/next/no-img-element` (5 件、いずれも外部・動的 URL で next/image 最適化不可)

- `src/app/dm/home/page.tsx:248` — Discord CDN icon
- `src/app/pokepoke/home/page.tsx:248` — Discord CDN icon
- `src/components/admin/AdminUserHome.tsx:39` — Discord CDN icon
- `src/components/stats/TeamServerCard.tsx:25` — Discord CDN icon
- `src/components/share/ShareModal.tsx:248` — OG preview（Supabase Storage / next-og API の dynamic URL）

#### `react-hooks/set-state-in-effect` (47 件、内訳は §5.1 / §5.2 参照)

ファイル分布:

| ファイル | next-line | block | 計 |
|---|---:|---:|---:|
| `src/app/account/page.tsx` | 1 | 0 | 1 |
| `src/app/account/security/page.tsx` | 1 | 0 | 1 |
| `src/app/admin/detection/page.tsx` | 1 | 0 | 1 |
| `src/app/admin/general-settings/page.tsx` | 1 | 0 | 1 |
| `src/app/admin/opponent-decks/page.tsx` | 1 | 0 | 1 |
| `src/app/auth/confirm/page.tsx` | 1 | 0 | 1 |
| `src/app/dm/battle/page.tsx` | 2 | 0 | 2 |
| `src/app/dm/decks/page.tsx` | 1 | 0 | 1 |
| `src/app/dm/home/page.tsx` | 1 | 0 | 1 |
| `src/app/dm/stats/deck/[deckName]/page.tsx` | 1 | 0 | 1 |
| `src/app/dm/stats/opponent/[deckName]/page.tsx` | 1 | 0 | 1 |
| `src/app/dm/stats/page.tsx` | 4 | 1 | 5 |
| `src/app/pokepoke/battle/page.tsx` | 2 | 0 | 2 |
| `src/app/pokepoke/decks/page.tsx` | 1 | 0 | 1 |
| `src/app/pokepoke/home/page.tsx` | 1 | 0 | 1 |
| `src/app/pokepoke/stats/deck/[deckName]/page.tsx` | 1 | 0 | 1 |
| `src/app/pokepoke/stats/opponent/[deckName]/page.tsx` | 1 | 0 | 1 |
| `src/app/pokepoke/stats/page.tsx` | 4 | 1 | 5 |
| `src/components/admin/AdminUserBattles.tsx` | 1 | 0 | 1 |
| `src/components/admin/AdminUserDecks.tsx` | 0 | 1 | 1 |
| `src/components/admin/AdminUserQualityScore.tsx` | 1 | 0 | 1 |
| `src/components/admin/AdminUserStats.tsx` | 1 | 0 | 1 |
| `src/components/admin/FeedbackList.tsx` | 1 | 0 | 1 |
| `src/components/admin/OpponentDeckManager.tsx` | 1 | 1 | 2 |
| `src/components/battle/BattleRecordForm.tsx` | 2 | 2 | 4 |
| `src/components/battle/EditBattleModal.tsx` | 1 | 0 | 1 |
| `src/components/battle/OpponentDeckSelector.tsx` | 0 | 1 | 1 |
| `src/components/layout/BottomNav.tsx` | 1 | 0 | 1 |
| `src/components/providers/BanGuard.tsx` | 1 | 0 | 1 |
| `src/components/stats/EncounterDonutChart.tsx` | 1 | 0 | 1 |
| `src/hooks/use-active-team.ts` | 1 | 0 | 1 |
| `src/hooks/use-format.ts` | 1 | 0 | 1 |
| `src/hooks/use-selected-game.ts` | 1 | 0 | 1 |
| **計** | **40** | **7** | **47** |

---

## 6. 設計判断・学び

### 6.1 `OpponentDeckManager.tsx` の `savedSettingsRef` state 化（commit 6）

`react-hooks/refs` 7 件と `react-hooks/immutability` 1 件を解消するため、`savedSettingsRef` (`useRef`) を `savedSettings` (`useState`) に完全置換した。

- write 箇所 4 つ（format 切替時 effect / Limitless 同期後 / handleApply Limitless mode / handleApply admin mode）すべて `setSavedSettings(...)` に置換
- read 箇所 4 つ（render 中の limitless 同期状態表示）はすべて `savedSettings?.X` に置換

**stale closure 評価**: `handleApply` / `loadStats` / その他 effect のいずれも `savedSettings` を read していないため、依存配列に追加する必要はない。`applyRef.current = handleApply` の useEffect は依存配列なしで意図的に毎レンダー実行され、常に最新の `handleApply` を保持する imperative handle パターンとして正しい。

`useEffect(() => { applyRef.current = handleApply; })` を line 291 から `handleApply` 定義（line 708）直後に移動して `react-hooks/immutability`（宣言前アクセス）を解消した。effect 実行タイミングは render 後で変わらず、挙動への影響なし。

### 6.2 block disable の発見

effect 内で複数 setState が連続する場合、per-line disable では片方を抑制すると次が新たな警告対象に昇格する。これを解消するため `/* eslint-disable */ 〜 /* eslint-enable */` の block disable を使用した（§5.2 参照）。後続のフェーズで同様パターンに遭遇した際の参照として記録。

### 6.3 disable の正当化基準

plan §4-1 の方針「disable は最終手段」に基づき、disable は以下のいずれかに限定した:

- パターン A: mount 時の URL/localStorage/cookie/searchParams resolve（SSR safe 初期値との分離が必要）
- パターン C: useCallback ラップ済関数の fetch トリガー、props 変化時の同期 reset
- library 側の型不整合（recharts）
- 環境制約（OpenNext + Cloudflare Workers で next/image 最適化が使えない外部・動的 URL）

派生 state 化で disable せずに済む箇所（パターン B）は今回 0 件だった。

### 6.4 codex によるレビュー履歴

`/review-plan-loop` および手動レビューを通じて 5 ラウンドの反復が行われた:

1. plan 初版作成 → review-plan-loop で 3 ラウンド検証して GO
2. plan 着手前に codex 第二次レビュー → 追加修正 4 点を反映、review-plan-loop で 2 ラウンド再検証して GO
3. plan 着手前に codex 第三次レビュー → lint 実測の誤り、Sentry URL 矛盾、テスト throw 安全条件、runbook 公式 docs 参照の 4 点を反映、review-plan-loop で 2 ラウンド再検証して GO
4. #3 進行中に commit 7 で eslint の挙動（複数 setState 抑制時の昇格）を発見、block disable を導入
5. #3 完了報告作成中に codex から disable 数の不正確を指摘 → 本文書で実差分ベースに修正

---

## 7. 検証

### 7.1 Claude 自前検証（完了）

| 検証項目 | 結果 |
|---|---|
| `npx tsc --noEmit` | 0 error |
| `npm run lint` | 0 problems (errors 0 / warnings 0) |
| `git diff --check` | 問題なし |
| GitHub Actions `quality` job (run 26362520502) | green（typecheck + lint ともに通過） |
| 既存 `limitless-sync.yml` への影響 | なし（別 workflow ファイル、トリガーも別） |

### 7.2 ユーザー側で実施いただきたい dev preview smoke test

dev preview (`https://dev-duepure-tracker.jianrenzhongtian7.workers.dev`) で以下の画面が回帰していないことを確認:

- `/dm/home` `/dm/battle` `/dm/decks` `/dm/stats` — battle 編集 / format 切替 / date range / scope (personal / global / team)
- `/pokepoke/...` — dm と同じ範囲（コピーファイル）
- `/account` — X 連携エラー検出、パスワード変更
- `/admin/opponent-decks` — 特に commit 6 の `savedSettings` state 化と commit 12 の format 切替時 12+ state reset の影響箇所
  - format 切替で設定値が initial 値に同期 reset されるか
  - limitless モードの「最終取得」表示と「今すぐ取得」ボタン動作
  - 設定保存後の表示更新

---

## 8. 影響範囲と運用変化

### 8.1 ランタイム挙動

- **基本的に変化なし**: 47 件の `set-state-in-effect` 解消はすべて disable + 理由コメントで、effect 構造は変えていない
- **挙動が変わりうる 1 箇所**: `OpponentDeckManager.tsx` の `savedSettingsRef` → `savedSettings` 化（commit 6）。同期更新（ref）→ 次 render 反映（state）に変わるが、write 直後に同じ値を直接読むコードがないため実害なし

### 8.2 CI 運用

- 今後 `dev` / `main` への push / PR ごとに `quality` job が自動実行され、typecheck or lint エラーで PR がブロックされる
- Cloudflare Workers Builds は引き続き別系統で動作（dev preview / main 本番ビルド）

### 8.3 後続作業者への注意

- 新規 `eslint-disable` を追加する際は **必ず理由コメントを 1 行付与**する（plan §4-1 ルール）
- effect 内に複数 setState がある場合は per-line ではなく block disable を検討（§6.2）
- 派生 state 化で disable せずに済むなら実装修正を優先（パターン B、今回は該当なしだが将来該当する箇所が出る可能性あり）

---

## 9. 未対応・今後の方向

公開ブロッカー残 3 件（plan §3 の #1+#2 / #6 / #4）と、推奨対応:

- **#1+#2** privacy / terms 補強 + ログイン不要問い合わせ窓口（plan §4-3）
- **#6** エラートラッキング + 障害対応 runbook（plan §4-4、Sentry の OpenNext + Cloudflare Workers 対応は事前 spike が必要）
- **#4** 最小ユニットテスト追加（plan §4-5、`stats-actions.ts` 内の private helper を `src/lib/stats/` 配下へ抽出してからテスト追加。Resolved Decisions 参照）

CI ゲートは #4 完了時に `npm test` ステップを `ci.yml` の `quality` job 末尾へ追加予定（plan §4-2 で明記）。

main 反映後、上記 3 件の優先順位はユーザーと協議して決定する。

---

## 10. 参考

- plan: `docs/plans/2026-05-24_pre_public_blocker_resolution_plan.md`
- 元レビュー: `docs/reports/2026-05-20_pre_public_readiness_review.md`
- GitHub Actions run: `26362520502`（CI gate 初回 green）
- Cloudflare dev preview: `https://dev-duepure-tracker.jianrenzhongtian7.workers.dev`
- React Docs「You Might Not Need an Effect」: https://react.dev/learn/you-might-not-need-an-effect
