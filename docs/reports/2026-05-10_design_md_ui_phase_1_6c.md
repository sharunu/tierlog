# DESIGN.md UI 改善 plan Phase 1-6c 実施レポート

- 日付: 2026-05-10
- ブランチ: `dev` で実装 → `main` にマージ済 (`4aa1400`)
- 本番 URL: https://duepure-tracker.jianrenzhongtian7.workers.dev
- plan ファイル: `~/.claude/plans/design-md-ui-plan-enchanted-map.md`
- DESIGN.md: 本セッション開始時に大規模改訂済 (799 行)

## 概要

DESIGN.md の "First Improvement Order" (L766-774) に沿い、UI 全体を semantic token / 共通プリミティブ / lucide-react / a11y 整備で底上げした。Phase 1 から 6c までの 10 サブ Phase を 1 セッションで完走し、main へマージ・本番反映済。

ゴール (達成済):

- モバイル UI の一貫性
- semantic token 化 (chart / win-rate を含む)
- 共通部品化 (SegmentedControl / Button / IconButton / Chip / Surface / PageShell / FilterBar)
- chart helper / archetype registry 整備
- recharts a11y 最低ライン (`role="img"` + 意味のある `aria-label`)
- ライトモード予定への配慮 (全色 token 経由、参照側で hex 直書きを増やさない)

スコープ外として明示的に切り離した:

- Phase 7 (stats トップのデスクトップ幅拡張)
- account / admin / auth / share / home のハードコード色残存
- `--accent` alias の最終削除
- dm / pokepoke の重複コード解消
- shadcn/ui Charts 導入

## Phase 別実装内容

| Phase | Commit | 主な変更 | 規模 |
|-------|--------|---------|------|
| 1 | `a6ca58f` | globals.css の `:root` と `@theme inline` を 33 token (surface-1/2/3, warning, accent alias, border-subtle/strong, chart-1〜8, win-rate-high/mid-high/mid/mid-low/low/empty) に拡張 | 1 file +66/-4 |
| 2 | `a8ae7be` | `SegmentedControl` 新規。FormatSelector / ScopeSelector / ViewSelector / BattleTabsView の内部実装を吸収。外部 API は完全維持。`#1a1d35` ハードコード撤去 (`bg-surface-2` 初使用) | 5 files +195/-94 |
| 3 | `e1ddbd6` | BottomNav の手書き 4 SVG を lucide-react (`Home` / `PlusCircle` / `BarChart3` / `User`) に置換。背景・active・inactive・dot・border をすべて token 化。`safe-bottom` no-op を `pb-[env(safe-area-inset-bottom)]` で実体化。各タブに `aria-label` + active link に `aria-current="page"` | 1 file +26/-66 |
| 4 | `8844dc4` | `Button` (variant primary/secondary/ghost/destructive/result, tone win/loss/draw, size sm/md/lg, loading + spinner, fullWidth, focus-visible ring), `IconButton` (aria-label TypeScript 必須化), `Chip` (default/selected + aria-pressed) を新規追加。DeckList の自由入力「追加」ボタンを pilot 置換。他 24 ボタンは Phase 5/6 で吸収する方針で touch しない | 4 files +177/-14 |
| 5a | `c127a4d` | `Surface` 新規 (raised/subtle tone, sm/md padding)。BattleRecordForm の 3 つのインライン style カードを Surface 化、select/memo パネル/turn order ボタン/MemoIcon stroke をすべて token に。MiniStats のハードコード色 token 化 + recharts `<LineChart>` ルートに `role="img"` + 意味のある aria-label。`text-gray-500` 4 箇所を `text-muted-foreground` に統一 | 3 files +224/-218 |
| 5b | `931a53b` | WIN/LOSE/DRAW 3 ボタンを `<Button variant="result" tone="win\|draw\|loss">` に置換。`linear-gradient(...)` 撤廃、フラット背景 + `min-h-[48px]` (DESIGN.md L296) + `active:scale-95`。`text-accent` / `bg-accent` / `border-accent` 6 箇所 (result-format.ts 2, PersonalStatsTable 1, EditBattleModal 3) を warning token に書換 | 4 files +23/-28 |
| 5c | `e029a3e` | OpponentDeckSelector / MemoSuggestionButton / EditBattleModal / BattleHistoryList / BattleTabsView の hex を全て token 化。手書き SVG (Search / X / Trash2) を lucide に置換。空状態 CTA を `<Button variant="primary">` 化。各 IconButton に aria-label。BattleIntervalModal は既に token 化済で touch 不要 | 5 files +124/-236 |
| 6a | `c37b993` | `src/lib/chart-colors.ts` (`CHART_COLORS` array + `chartColorByIndex`)、`src/lib/deck-archetype-colors.ts` (`colorForArchetype` registry + name hash fallback) を新規追加。`getWinRateColor` を `var(--win-rate-*)` 返却に変更。関数 API 維持で 13 callers は無修正で動作。`stats-utils.ts` の `COLORS` は avatar-utils 互換のため旧 hex 維持 | 3 files +37/-6 |
| 6b | `a3fc473` | `FilterBar` 新規 (flex-col gap-3 wrapper)。EncounterDonutChart で `OTHER_COLOR` + `COLORS` index 廃止 → `colorForArchetype(name)` で archetype 同色性保証 (DESIGN.md L431)、`role="img"` + 意味のある aria-label。TurnOrderCards inline style → token (warning/primary/muted-foreground)。ShareButton 全色 token 化、X-gate modal CTA を `bg-primary` に。dm/pokepoke stats トップの skeleton/guest banner/premium toggle を token 化、DateRange + Scope を `<FilterBar>` で wrap | 6 files +120/-102 |
| 6c | `1b13252` | `PageShell` 新規 (`min-h-screen pb-20 px-4 pt-6 max-w-lg mx-auto space-y-4` を吸収)。TrendChart で local `COLORS` 廃止 → `colorForArchetype` 統合、CartesianGrid stroke / axis fill を CSS 変数に、`role="img"` + aria-label。TrendHeatmap 全色 token 化 + wrapper に `role="img"` + aria-label (cell heat colors は visualization 例外)。MatchupTable の inline style 全廃 → Tailwind class、label colors を token に。TuningStatsSection の expand 部分を token 化 + `aria-expanded` 追加。dm/pokepoke の deck/opponent サブ詳細ページ 4 つに PageShell 適用 | 9 files +147/-207 |

## 累計変更規模

main への merge commit (`4aa1400`) 集計:

- **40 files changed**
- **+2,040 / -952** (純増 +1,088)
- 新規ファイル 11:
  - `DESIGN.md` (本 plan ベース)
  - `docs/reports/2026-05-10_routing_log_cleanup.md` (前セッション分)
  - `src/components/ui/Button.tsx`
  - `src/components/ui/IconButton.tsx`
  - `src/components/ui/Chip.tsx`
  - `src/components/ui/SegmentedControl.tsx`
  - `src/components/ui/Surface.tsx`
  - `src/components/ui/PageShell.tsx`
  - `src/components/stats/FilterBar.tsx`
  - `src/lib/chart-colors.ts`
  - `src/lib/deck-archetype-colors.ts`

行数削減効果が大きい file:

- BattleRecordForm: -218/+187 (Surface 化 + token 統合)
- BattleHistoryList / EditBattleModal / OpponentDeckSelector / MemoSuggestionButton: 5 file 合計 -236/+124 (約 53% 削減)
- TrendChart: -128 行 (-65, +63 ベース、local COLORS / inline style 削除)

## 検証戦略

各 Phase で次の手順を踏襲:

1. `npm run lint` で 0 エラー (各 Phase 必須)
2. 広範囲影響 Phase (Phase 2 / 3 / 4 / 5a / 6a / 6b / 6c) は加えて `npx opennextjs-cloudflare build` を Workers 互換確認のため実行
3. Plan ごとに指定された grep (target hex / a11y attrs) で 0 件確認
4. preview URL を `curl -L` で 200 + SSR HTML 描画確認
5. dev push → Cloudflare 自動 preview デプロイ → ユーザー実機確認
6. ユーザー OK で次 Phase 着手

`npm run build` / `npm run deploy` は CLAUDE.md L111 + DESIGN.md L708-715 通り **使用しない**。Cloudflare の自動ビルドに委譲。

最終 lint state: **52 problems (32 errors, 20 warnings)**。Phase 1〜6c の累計で増減なし。既存の `use-selected-game` setState-in-effect / `admin-actions` `any` 型 / `battle-actions` 未使用変数 は本 plan の範囲外。

## 反映プロセス

- 各 Phase 完了後の dev push は Claude が自動実施 (CLAUDE.md L120)
- ユーザー実機確認 OK → 次 Phase
- Phase 6c 完了時点でユーザー一括承認、main マージ・push を実施
- main commit `dfd022e..4aa1400` で本番自動デプロイ (3-5 分)
- ロールバックが必要な場合は Cloudflare ダッシュボード Deployments から 1 クリック (CLAUDE.md 記載)

## レビューループ

plan 確定までに 2 回の `/review-plan-loop` + codex 4 回のレビューを実施:

- 1st review-plan-loop: 6 mechanical 自動修正 + 2 judgment 解決 (Phase 7 別 plan, 色置換段階, build verify)
- 2nd review-plan-loop: 5 mechanical 自動修正 + 2 judgment 解決 (BattleSelector アイコン PlusCircle, MiniStats Phase 5a 統合)
- codex review #1〜4: Phase 2 grep 範囲、Phase 6b 共有コンポーネント波及、Phase 6c grep 範囲、BottomNav safe-area 過剰、TrendHeatmap 仕様、admin パス、Phase 5c rollback 件数 等を pre-implementation で修正

特に役立ったのは「実画面で同じ archetype 名が画面をまたいで同色になるように colorForArchetype helper で hash fallback する」設計。Phase 6a で helper を整え、Phase 6b/6c で消費する 2 段構えにしたことで、影響範囲を分離できた。

## 残課題 (別 plan 候補)

- **Phase 7**: `/{game}/stats` トップのデスクトップ幅レイアウト拡張 (`max-w-lg lg:max-w-4xl`, 2 カラム)。共通基盤 (PageShell / FilterBar) が固まったので着手可能
- **未着手領域のハードコード色置換**: `src/app/account/**` 19 ファイル、`src/app/admin/**`, `src/app/auth/**`, `src/app/share/**` (例外領域除く), `src/components/home/**`
- **`--accent` alias 削除**: account / admin に残る `text-accent` / `bg-accent` を warning に書換した後、`globals.css` の `--accent: var(--warning)` alias を削除
- **dm / pokepoke 重複解消**: stats/page.tsx 547 行構造重複は機能差分の温床。別 plan の refactor として扱う
- **PageShell 全画面適用**: 現状 stats サブ詳細のみ。home / battle / account / admin にも展開可能
- **shadcn/ui Charts 導入検討**: Phase 6b/6c で `role="img"` + aria-label のフォールバック対応済。実画面確認後に accessibilityLayer 採用が必要なら別 plan
- **EnvironmentChart.tsx**: 現状未参照 (Glob/Grep で確認済)。未使用コンポーネント整理として削除候補
- **archetype registry の主要デッキ網羅**: 現在「その他」のみ登録。実画面確認しながら主要 archetype を追記、または管理画面化検討 (DESIGN.md L437)

## 学び

- **plan-critic + codex の二重レビュー**は実装前のミス検出に効果的。特に「対象ファイルが実コードと一致するか」「grep 検証範囲が広すぎないか」の機械的チェックは critic で、設計判断 (例: archetype 同色性、shadcn/ui 導入の是非) は codex で取る役割分担が機能した
- **token 体系の役割分離** (`--chart-*` / `--win-rate-*` / `--success/warning/destructive`) を明確化することで、Phase 6 の chart helper / archetype registry / win-rate gradient が衝突なく共存できた。chart 系列 ≠ 状態色 ≠ 勝率階調 という DESIGN.md L427-448 の方針は実装段階で具体的なメリットになった
- **Phase ごとの commit 粒度**を「1 Phase = 1 commit」で守ったことで、git revert 単位が明確になり、ロールバック観点も plan 段階で整理できた。Cloudflare ダッシュボードロールバックも 1 クリック単位で対応できる
- **「外部 API 維持で内部実装だけ吸収」**パターン (Phase 2 SegmentedControl, Phase 6a getWinRateColor) は、呼び出し側 8〜13 箇所を touch せずに済むので diff が小さく、回帰リスクが大幅に下がった
- **Plan で「pilot 1 個のみ置換」を明記**すること (Phase 4) により、共通プリミティブ追加 PR と消費 PR を分離でき、各 Phase の意図が明確になった
