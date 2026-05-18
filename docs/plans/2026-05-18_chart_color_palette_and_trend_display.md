# 2026-05-18 円グラフ・推移グラフの色分けと表示改善

## 目的

円グラフ (`EncounterDonutChart`) と推移グラフ (`TrendChart` / `TrendHeatmap`) の以下 3 つの課題を一括で解消する。

1. **色被り**: 現状の `colorForArchetype(deckName)` は deck 名 hash % 8 で `--chart-1`〜`--chart-8` を返すため、画面内に同色が頻発し見分けがつかない
2. **円グラフの UI 課題**: 小スライスでラベルがはみ出る / 非選択を暗くする強調方式が全体を暗くする / PC マウスで反応しないことがある
3. **ポケポケ推移グラフ・ヒートマップで対面デッキ名が英語表示**: `TrendChart` は `opponentDeckNameMap` を受けているが、`TrendHeatmap` は受けていないため行ラベル / tooltip が `name` (英語) のまま

## 問題詳細

### 現象 1: 色被り

- `src/lib/deck-archetype-colors.ts` の `colorForArchetype(deckName)` は deck 名のハッシュを `% 8` してパレット 8 色から返す
- 「同じデッキ名なら別グラフでも同じ色」を意図しているが、画面内のデッキ数が 8 を超えれば必ず被る (ハト ノ巣原理)
- ポケポケ stats では major/minor/other 分類で 10 件超表示されることが多く、円グラフ・推移グラフ・ヒートマップで色被りが日常的に発生
- ハッシュ衝突により 10 個未満でも被るケースあり (例: ハッシュ % 8 が 2 つの異なる deck で一致)

### 現象 2: 円グラフの UI 課題

`src/components/stats/EncounterDonutChart.tsx` の以下:

- L33-51 `renderLabel`: pct が小さくても `${pct}%` を表示。3% 未満の小スライスではテキストが扇形からはみ出して隣のスライスのラベルと重なる
- L229-236 Cell: `opacity={activeIndex >= 0 && activeIndex !== i ? 0.35 : 1}` で「他を暗くして 1 個を浮き上がらせる」方式。分布全体が暗くなって見づらい
- L222-223 Pie の `onMouseEnter`/`onMouseLeave`: Recharts の Pie 内 path に依存するため、cursor がスライス境界・label 上にあると拾えないことがある。タッチ用には L110-131 `getArcIndexFromPoint` で半径ベース判定があるが、マウスには適用されていない

### 現象 3: ポケポケ推移グラフ・ヒートマップの英語表示

- `src/components/stats/TrendChart.tsx` L84: `opponentDeckNameMap?` を受け、L69 / L243 で `displayDeckName(deck, opponentDeckNameMap)` を呼んでいる
- `src/components/stats/TrendHeatmap.tsx` L33: `data` のみ受け取り。L124 行ラベル / L99 tooltip は `{deck}` を生表示
- `src/app/pokepoke/stats/page.tsx` L409 は `TrendChart` に `opponentDeckNameMap` を渡しているが、L410 の `TrendHeatmap` には渡していない
- 結果: ポケポケでヒートマップ表示時、行ラベルと tooltip が `dragapult-ex` のような英語キー (`name`) のまま表示される

### 影響範囲

- dm (`opponent_deck_master.name = name_ja` のため日本語表示が壊れない) と pokepoke (`name` が英語、`name_ja` に日本語) で挙動が分かれる
- 公開前最終調整フェーズ (`memory/project_remaining_tasks_after_2026_05_09.md` ドメインバッチ) の見栄え改善として位置付け

## Preflight (確認済み事実、2026-05-18 時点)

### grep で確認した実コード状況

| 項目 | 結果 |
|---|---|
| `colorForArchetype` の use 箇所 | `EncounterDonutChart.tsx` (L6, L194) と `TrendChart.tsx` (L17, L106, L175, L218) の 2 ファイルのみ |
| `deck-archetype-colors` の他 import | 上記 2 ファイル以外なし |
| `var(--chart-8)` の使用 | `deck-archetype-colors.ts` (削除予定) と `chart-colors.ts` (書き換え予定) と `globals.css` 定義のみ。コンポーネント直接参照なし |
| 既存 `CHART_COLORS` (`src/lib/chart-colors.ts`) | 未使用 (grep 結果空)。削除 or 流用どちらも可能 |
| `--chart-9` 以降 | CSS 未定義 |
| `displayDeckName` | `src/lib/actions/opponent-deck-display.ts` L42 に存在、`nameMap` が undefined や key 未登録でも safe fallback で `name` を返す |
| `nameMapReady` (`pokepoke/stats/page.tsx` L78) | `personalStats` 部分の gate には使われているが、TrendChart 表示の gate には使われていない (= 初回 render で英語→ map 取得後日本語のチラつきが起き得るが、現状仕様として許容されている) |
| dm / admin の `TrendChart` / `TrendHeatmap` 呼び出し | `dm/stats/page.tsx` L393-394 と `admin/AdminUserStats.tsx` L227-228 はいずれも `opponentDeckNameMap` を渡していない (dm では name=name_ja のため不要) |

### 実装着手直前に再確認 (必須)

- `grep -rn "colorForArchetype\|deck-archetype-colors" src` で他 import が増えていないか
- `grep -rn "var(--chart-8)" src` で `globals.css` 以外の参照が増えていないか
- 上記が増えていれば本 plan を改訂してから着手

## スコープ

本 plan で扱う:

- パレット定義の再設計: `--chart-9` 〜 `--chart-12` と `--chart-other` を `globals.css` に追加 (light/dark 両方)
- `src/lib/chart-colors.ts` を 12 色パレット + `assignChartColors(names)` API に再構築
- `src/lib/deck-archetype-colors.ts` を削除
- `EncounterDonutChart.tsx`:
  - 色を `assignChartColors(data の name 配列)` に切り替え
  - 小スライス (`pct < 4`) の `${pct}%` ラベルを非表示
  - `Cell.opacity` の暗化を廃止
  - active 強調を `shape` callback で「`outerRadius + 6` に膨らます + `var(--background)` 境界線」へ
  - PC マウス対応を `pointermove`/`pointerleave` ベースの自前判定 (`getArcIndexFromPoint` を流用) に統合
  - 判定半径レンジを `innerRadius - 12` 〜 `outerRadius + 16` に拡張
- `TrendChart.tsx`: `assignChartColors(topDecks)` に切り替え、`deckColorMap` をそれで作る
- `TrendHeatmap.tsx`: `opponentDeckNameMap?` props 追加、行ラベル / tooltip で `displayDeckName(deck, opponentDeckNameMap)` を使用
- `pokepoke/stats/page.tsx` L410: `<TrendHeatmap>` に `opponentDeckNameMap` を渡す

本 plan で扱わない (必要になったら別 plan):

- dm / admin の `TrendChart` / `TrendHeatmap` に `opponentDeckNameMap` を渡す対応 (dm は表示変化なし、admin は呼び出し元側で nameMap 取得していないため別作業)
- `nameMapReady` を `TrendChart` / `TrendHeatmap` の render gate に使う改修 (現状 `TrendChart` の挙動を維持。チラつきが課題になれば別 issue)
- 円グラフ凡例 outline の色被り対策 (`assignChartColors` のユニーク色化で副次的に解決見込み)
- ヒートマップ (`TrendHeatmap`) のセル色 (現状は単一 `--primary` の opacity 段階表示) への deck 別色適用 — ヒートマップは「期間 × デッキ」の使用率を 1 色濃淡で見せる設計のため触らない

## 設計判断

### パレット数を 12 にする

- 円グラフは「上位 + その他」で最大 10 種、推移グラフ top 8、ヒートマップ top 10 が現状仕様
- 12 色なら現状仕様すべてをユニーク色でカバー可能
- 16 色は識別性 (人間の知覚的上限) と配色設計コストの双方で過剰
- ユーザー方針: 「12 色を超えるデッキが出た場合でも、色数都合で『その他』集約しない。12 色パレットを循環させる」 — `assignChartColors` 内で `paletteIdx % 12` 循環実装

### `その他` をパレットと分離

- ユーザー方針: 既存データとして存在する `その他` は固定グレー
- `--chart-other` を新規 token として light/dark に定義
- `assignChartColors` 内で name が `"その他"` の場合は固定で `CHART_OTHER_COLOR` を返し、palette idx を消費しない
- 通常パレット (`--chart-1` 〜 `--chart-12`) は「通常デッキ用」12 スロット

### `--chart-8` の意味付け変更

- 旧 `--chart-8` (#64748b Slate) は `deck-archetype-colors.ts` で「その他」用として使われていた
- 新仕様では `--chart-other` を新設してそちらが「その他」を担う
- `--chart-8` は通常パレットの 1 色 (Orange #f97316) に再割り当て
- grep で `--chart-8` のコンポーネント直接参照ゼロを確認済 (chart-colors.ts と deck-archetype-colors.ts のみ、両者とも本 plan で書き換え/削除対象)
- `--color-chart-8` (theme token, `globals.css` L147) は既存どおり `var(--chart-8)` を参照するため、theme 経由の参照があっても新色に追従

### パレット 12 色の hue 配置

「隣接スライス / 近い線で似た色が並ばない」順序を意識:

**注意**: 実装上 `:root` ブロック (globals.css L3-59) が dark テーマ、`[data-theme="light"]` ブロック (L65-) が light テーマ。以下の表は `dark` 列が `:root` の値、`light` 列が `[data-theme="light"]` の値。

| idx | 色名 | dark (`:root`) | light (`[data-theme="light"]`) |
|---|---|---|---|
| 1 | Indigo | #6366f1 | #4f46e5 |
| 2 | Amber | #f59e0b | #d97706 |
| 3 | Green | #22c55e | #16a34a |
| 4 | Red | #ef4444 | #dc2626 |
| 5 | Blue | #3b82f6 | #2563eb |
| 6 | Pink | #ec4899 | #db2777 |
| 7 | Teal | #14b8a6 | #0d9488 |
| 8 | Orange | #f97316 | #ea580c |
| 9 | Purple | #a855f7 | #9333ea |
| 10 | Lime | #84cc16 | #65a30d |
| 11 | Cyan | #06b6d4 | #0891b2 |
| 12 | Rose | #f43f5e | #e11d48 |
| other | Slate | #64748b | #475569 |

`--chart-1` 〜 `--chart-7` は既存値据え置き (旧仕様との視覚的継続性を保つ)。`--chart-8` を Slate → Orange に置き換え、`--chart-9` 〜 `--chart-12` を新規追加。`--chart-other` を Slate として独立 token 化。

dark/light の色対応は既存 `--chart-1`〜`--chart-7` のパターンを踏襲 (dark = Tailwind 500 系、light = Tailwind 600 系)。

隣接 hue の確認 (パイチャートで連続して並んだ時の識別性):
- 1-2: Indigo / Amber (補色寄り) ✓
- 2-3: Amber / Green ✓
- 3-4: Green / Red (補色) ✓
- 4-5: Red / Blue (補色寄り) ✓
- 5-6: Blue / Pink ✓
- 6-7: Pink / Teal (補色寄り) ✓
- 7-8: Teal / Orange (補色) ✓
- 8-9: Orange / Purple ✓
- 9-10: Purple / Lime (補色) ✓
- 10-11: Lime / Cyan ✓ (黄緑 / 水色、彩度差で識別可)
- 11-12: Cyan / Rose (補色寄り) ✓

### `assignChartColors` の API 仕様

```ts
export function assignChartColors(names: string[]): Map<string, string>
```

- 引数: 表示順の name 配列 (円グラフは sort 後の `data` の name 順、推移グラフは `topDecks` 順)
- 戻り値: name → CSS color string (`var(--chart-N)` 形式) の Map
- `"その他"` は palette idx を消費せず固定で `CHART_OTHER_COLOR` を返す
- それ以外の name は palette idx 順に `--chart-1` 〜 `--chart-12` を割り当て、超えたら `% 12` で循環
- 同一 name 重複は Map.set で 1 つに集約 (呼び出し元は unique 名前を渡す前提)

### 円グラフ active 強調を `shape` callback ベースに変更

- Recharts v3 の `<Pie>` には外部 state 駆動の `activeIndex` prop が存在せず、`activeShape` も内部 Tooltip activation でしか発火しない。本 plan は外部 `activeIndex` state を custom pointer 検出 (Step 4-10) で管理するため、Recharts 標準の `activeShape` 機構ではなく `shape` prop の render callback を使う
- `<Pie shape={renderSectorShape}>` の callback で `props.index === activeIndex` を比較し、active 時は `outerRadius + 6` Sector、非 active 時は通常 Sector を返す
- active 時 Sector に `stroke="var(--background)"` `strokeWidth={2}` で境界線を付ける (固定白ではなく background token を使うことで light/dark どちらでも識別可)
- 既存の `Cell.opacity` 暗化 (L233) は廃止 (`opacity` prop 自体を削除)
- 凡例側 (L266-298) の outline / 背景強調 (`activeIndex === i ? "bg-foreground/5" : ""` と `outline: 2px solid color`) は維持
- `Cell stroke` だけ (扇形を膨らまさない) のフォールバック方式は不採用 (PC マウスの体感改善が弱いため)

### 円グラフのホバー判定を pointer 統合

- 既存 `getArcIndexFromPoint` (L110-131) はタッチ用に作られているが、座標を渡せばマウスでも動く
- `pointermove` / `pointerleave` を `containerRef` に追加し、`e.pointerType !== "touch"` の場合に同じロジックで判定 (touch は既存 `handleTouchStart/Move/End` に任せる)
- Pie の `onMouseEnter`/`onMouseLeave` (L222-223) は削除 (重複発火を避ける)
- `getArcIndexFromPoint` の判定半径レンジを `innerRadius - 12` 〜 `outerRadius + 16` に拡張 (旧は `innerRadius` 〜 `outerRadius + 10`)
  - `innerRadius - 12` は中心穴の縁付近でもホバーが反応するようにするため
  - `outerRadius + 16` は label 文字位置までカバー (label 半径は `(innerRadius + outerRadius) / 2 = 67.5` だが、active 時に膨らんだ後の `outerRadius + 6` 位置までホバーを切らさないため余裕を持たせる)

### `TrendHeatmap` の nameMap propagation

- `opponentDeckNameMap?: OpponentDeckNameMap` を optional 追加
- 行ラベル (L124 `{deck}`) と tooltip (L99 `{tooltip.deck}`) を `displayDeckName(deck, opponentDeckNameMap)` でラップ
- 既存呼び出し元 (dm/stats, AdminUserStats) は引数省略で動く (optional のため互換性破壊なし)
- pokepoke stats のみ `opponentDeckNameMap={opponentDeckNameMap}` を追加

### 不採用方針

- **`assignChartColors` でグラフ間の color 一貫性を保つ**: 不採用。画面内ユニーク色の方が優先度高く、グラフ間で同じ deck が違う色になっても許容
- **16 色パレット**: 不採用。識別性低下と配色コスト増を考慮
- **`--chart-8` を後方互換のため残す + 新規 `--chart-13` 以降を追加**: 不採用。`--chart-8` のコンポーネント直接参照ゼロを確認済のため安全に再割り当て可能
- **dm/admin の TrendHeatmap にも nameMap 伝播**: 不採用 (ユーザー方針)。スコープを最小化
- **`nameMapReady` を TrendChart/TrendHeatmap render gate に使う**: 不採用。現状の TrendChart の挙動を維持。チラつきは fallback で raw 名前→ map 取得後日本語の差し替えで、現状機能上問題報告なし

## 実装ステップ

### Step 1: `globals.css` のパレット定義拡張

ファイル: `src/app/globals.css`

L37-44 (`:root` ブロック = dark テーマ、既存 `--chart-1` 〜 `--chart-8`) を以下に置き換え:

```css
  --chart-1: #6366f1;
  --chart-2: #f59e0b;
  --chart-3: #22c55e;
  --chart-4: #ef4444;
  --chart-5: #3b82f6;
  --chart-6: #ec4899;
  --chart-7: #14b8a6;
  --chart-8: #f97316;
  --chart-9: #a855f7;
  --chart-10: #84cc16;
  --chart-11: #06b6d4;
  --chart-12: #f43f5e;
  --chart-other: #64748b;
```

L96-103 (`[data-theme="light"]` ブロック = light テーマ、既存 `--chart-1` 〜 `--chart-8`) を以下に置き換え:

```css
  --chart-1: #4f46e5;
  --chart-2: #d97706;
  --chart-3: #16a34a;
  --chart-4: #dc2626;
  --chart-5: #2563eb;
  --chart-6: #db2777;
  --chart-7: #0d9488;
  --chart-8: #ea580c;
  --chart-9: #9333ea;
  --chart-10: #65a30d;
  --chart-11: #0891b2;
  --chart-12: #e11d48;
  --chart-other: #475569;
```

L140-147 (`@theme` 内の `--color-chart-N` token) を 12 色 + other に拡張:

```css
  --color-chart-1: var(--chart-1);
  --color-chart-2: var(--chart-2);
  --color-chart-3: var(--chart-3);
  --color-chart-4: var(--chart-4);
  --color-chart-5: var(--chart-5);
  --color-chart-6: var(--chart-6);
  --color-chart-7: var(--chart-7);
  --color-chart-8: var(--chart-8);
  --color-chart-9: var(--chart-9);
  --color-chart-10: var(--chart-10);
  --color-chart-11: var(--chart-11);
  --color-chart-12: var(--chart-12);
  --color-chart-other: var(--chart-other);
```

### Step 2: `chart-colors.ts` を `assignChartColors` API に再構築

ファイル: `src/lib/chart-colors.ts`

全置換:

```ts
export const CHART_PALETTE = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
  "var(--chart-6)",
  "var(--chart-7)",
  "var(--chart-8)",
  "var(--chart-9)",
  "var(--chart-10)",
  "var(--chart-11)",
  "var(--chart-12)",
] as const;

export const CHART_OTHER_COLOR = "var(--chart-other)";

const OTHER_NAME = "その他";

/**
 * 表示中の name 配列を受け取り、name → color の Map を返す。
 * "その他" は palette idx を消費せず固定で CHART_OTHER_COLOR を割り当てる。
 * 12 色を超える場合は CHART_PALETTE を % 12 で循環。
 * 呼び出し元は重複のない順序付き name 配列を渡す前提 (重複は Map.set で 1 つに集約)。
 */
export function assignChartColors(names: string[]): Map<string, string> {
  const map = new Map<string, string>();
  let paletteIdx = 0;
  for (const name of names) {
    if (name === OTHER_NAME) {
      map.set(name, CHART_OTHER_COLOR);
      continue;
    }
    map.set(name, CHART_PALETTE[paletteIdx % CHART_PALETTE.length]);
    paletteIdx++;
  }
  return map;
}
```

旧 `CHART_COLORS` `chartColorByIndex` export は削除 (grep 確認で使用箇所ゼロのため)。

### Step 3: `deck-archetype-colors.ts` を削除

```bash
rm src/lib/deck-archetype-colors.ts
```

### Step 4: `EncounterDonutChart.tsx` の改修

ファイル: `src/components/stats/EncounterDonutChart.tsx`

#### 4-1: import 変更 (L6)

```ts
import { assignChartColors } from "@/lib/chart-colors";
```

`colorForArchetype` import (旧 L6) を削除。

#### 4-2: `Sector` import を追加 (L3)

```ts
import { PieChart, Pie, Cell, ResponsiveContainer, Sector } from "recharts";
```

#### 4-3: `renderLabel` (L33-51) を小スライス非表示対応に変更

```tsx
const renderLabel = (props: any) => {
  const { cx, cy, midAngle, innerRadius, outerRadius, pct } = props;
  if (pct < 4) return null;
  const radius = (innerRadius + outerRadius) / 2;
  const x = cx + radius * Math.cos(-midAngle * RADIAN);
  const y = cy + radius * Math.sin(-midAngle * RADIAN);
  return (
    <text
      x={x}
      y={y}
      textAnchor="middle"
      fill="#fff"
      fontSize={11}
      fontWeight="bold"
      dominantBaseline="central"
    >
      {pct}%
    </text>
  );
};
```

#### 4-4: `renderSectorShape` を component 内で定義 (`getOverlayPosition` useCallback 直後)

Recharts v3 の `<Pie>` は外部 state 駆動の `activeIndex` prop を持たないため、`activeShape` ではなく `shape` callback 内で `props.index === activeIndex` を比較して active/非 active を切り替える。`activeIndex` state に依存するため `useCallback` で wrap し、component 内で定義する (module top-level では state 参照できない)。

```tsx
const renderSectorShape = useCallback((props: any) => {
  const { cx, cy, innerRadius, outerRadius, startAngle, endAngle, fill, index } = props;
  const isActive = index === activeIndex;
  return (
    <Sector
      cx={cx}
      cy={cy}
      innerRadius={innerRadius}
      outerRadius={isActive ? outerRadius + 6 : outerRadius}
      startAngle={startAngle}
      endAngle={endAngle}
      fill={fill}
      stroke={isActive ? "var(--background)" : "none"}
      strokeWidth={isActive ? 2 : 0}
    />
  );
}, [activeIndex]);
```

#### 4-5: `colorMap` を `useMemo` で生成 (L82 `data` 直後)

```tsx
const colorMap = useMemo(
  () => assignChartColors(data.map(d => d.name)),
  [data]
);
```

#### 4-6: `getColor` (L194) を `colorMap` 参照に変更

```tsx
const getColor = (name: string) => colorMap.get(name) ?? CHART_OTHER_COLOR;
```

`CHART_OTHER_COLOR` も `chart-colors` から import 追加。

#### 4-7: `<Pie>` (L212-228) の prop 修正

- `onMouseEnter` / `onMouseLeave` を削除
- `shape={renderSectorShape}` を追加 (`activeIndex` / `activeShape` prop は Recharts v3 では使えない)

```tsx
<Pie
  data={data}
  dataKey="value"
  cx="50%"
  cy="50%"
  innerRadius={innerRadius}
  outerRadius={outerRadius}
  stroke="none"
  startAngle={90}
  endAngle={-270}
  shape={renderSectorShape}
  onAnimationEnd={() => setAnimationDone(true)}
  isAnimationActive={!animationDone}
  label={renderLabel}
  labelLine={false}
>
```

#### 4-8: `<Cell>` (L229-236) の `opacity` を削除

```tsx
{data.map((entry, i) => (
  <Cell
    key={i}
    fill={getColor(entry.name)}
  />
))}
```

`opacity` と `style` を削除 (transition も不要)。

#### 4-9: `getArcIndexFromPoint` (L110-131) の判定半径レンジ拡張

```ts
if (r < innerRadius - 12 || r > outerRadius + 16) return -1;
```

(旧: `r < innerRadius || r > outerRadius + 10`)

#### 4-10: PC マウス対応の pointer ハンドラ追加

L155 `handleTouchEnd` の直後に追加:

```ts
const handlePointerMove = useCallback((e: PointerEvent) => {
  if (e.pointerType === "touch") return;
  const idx = getArcIndexFromPoint(e.clientX, e.clientY);
  if (idx !== activeIndexRef.current) {
    setActiveIndex(idx);
  }
}, [getArcIndexFromPoint]);

const handlePointerLeave = useCallback((e: PointerEvent) => {
  if (e.pointerType === "touch") return;
  setActiveIndex(-1);
}, []);
```

L159-170 の `useEffect` に pointer リスナーも追加:

```ts
useEffect(() => {
  const el = containerRef.current;
  if (!el) return;
  el.addEventListener("touchstart", handleTouchStart, { passive: false });
  el.addEventListener("touchmove", handleTouchMove, { passive: false });
  el.addEventListener("touchend", handleTouchEnd);
  el.addEventListener("pointermove", handlePointerMove);
  el.addEventListener("pointerleave", handlePointerLeave);
  return () => {
    el.removeEventListener("touchstart", handleTouchStart);
    el.removeEventListener("touchmove", handleTouchMove);
    el.removeEventListener("touchend", handleTouchEnd);
    el.removeEventListener("pointermove", handlePointerMove);
    el.removeEventListener("pointerleave", handlePointerLeave);
  };
}, [handleTouchStart, handleTouchMove, handleTouchEnd, handlePointerMove, handlePointerLeave]);
```

### Step 5: `TrendChart.tsx` の改修

ファイル: `src/components/stats/TrendChart.tsx`

#### 5-1: import 変更 (L17)

```ts
import { assignChartColors } from "@/lib/chart-colors";
```

`colorForArchetype` import を削除。

#### 5-2: `deckColorMap` 生成 (L104-107)

旧:
```ts
const deckColorMap = new Map<string, string>();
topDecks.forEach((deck) => {
  deckColorMap.set(deck, colorForArchetype(deck));
});
```

新:
```ts
const deckColorMap = assignChartColors(topDecks);
```

#### 5-3: `colorForArchetype(deck)` 呼び出しを `deckColorMap.get(deck)` に置換

- L175 `const color = colorForArchetype(deck);` → `const color = deckColorMap.get(deck) ?? "var(--muted-foreground)";`
- L218 同上

(L106 は Step 5-2 で消える)

### Step 6: `TrendHeatmap.tsx` の改修

ファイル: `src/components/stats/TrendHeatmap.tsx`

#### 6-1: import 追加 (L10 付近)

```ts
import {
  displayDeckName,
  type OpponentDeckNameMap,
} from "@/lib/actions/opponent-deck-display";
```

#### 6-2: props 拡張 (L33)

```ts
export function TrendHeatmap({
  data,
  opponentDeckNameMap,
}: {
  data: TrendDataPoint[];
  opponentDeckNameMap?: OpponentDeckNameMap;
}) {
```

#### 6-3: tooltip 行 (L99) を `displayDeckName` でラップ

```tsx
<div className="font-medium mb-0.5">{displayDeckName(tooltip.deck, opponentDeckNameMap)}</div>
```

#### 6-4: 行ラベル (L124) を `displayDeckName` でラップ

```tsx
{displayDeckName(deck, opponentDeckNameMap)}
```

### Step 7: `pokepoke/stats/page.tsx` の改修

ファイル: `src/app/pokepoke/stats/page.tsx`

L410 を以下に変更:

```tsx
: <TrendHeatmap data={filteredTrendData} opponentDeckNameMap={opponentDeckNameMap} />
```

### Step 8: 動作確認

#### Step 8-1: ローカル lint / build

```bash
npm run lint
npx opennextjs-cloudflare build
```

両方とも error なしを確認。

#### Step 8-2: 旧モジュール参照ゼロ確認

```bash
grep -rn "colorForArchetype\|deck-archetype-colors" src
grep -rn "CHART_COLORS\b\|chartColorByIndex" src
```

両方とも結果 0 件を確認 (chart-colors.ts 内の `CHART_PALETTE` `CHART_OTHER_COLOR` `assignChartColors` のみが残る)。

#### Step 8-3: dev push

```bash
git checkout dev
git add -A
git commit -m "feat(ui): #chart 色分け・推移グラフ表示改善 (12色パレット + shape callback active sector + Heatmap nameMap)"
git push origin dev
```

Cloudflare dev preview ビルド完了 (3〜5 分) を待つ。

#### Step 8-4: ユーザー確認 (ブラウザ必須)

ユーザーに以下を `https://dev-duepure-tracker.jianrenzhongtian7.workers.dev` で確認依頼:

**円グラフ (pokepoke / dm 両方)**:
- [ ] デッキ件数 ≤ 12 (+ その他) のケースで色被りなし
- [ ] デッキ件数 ≥ 13 のケースでは 12 色パレットが循環するため色被り自体は起き得る。その上で、隣接スライスで似た色が並んでいないか / 凡例の outline 強調 / tooltip / active sector の膨らみと境界線で識別できるか確認
- [ ] 4% 未満の小スライスで `${pct}%` ラベルが消えている / はみ出ない
- [ ] PC マウスホバーでスライスが膨らみ、境界線が付く / 反応漏れがない
- [ ] 非選択スライスが暗くならない
- [ ] タッチ操作 (スマホ) でも従来通り動作
- [ ] ダークモード / ライトモード切替で色の識別性 OK / active sector の境界線が両モードで見える

**推移グラフ (pokepoke / dm 両方)**:
- [ ] top 8 デッキの線色が画面内で被らない
- [ ] 凡例クリック / 線クリックで highlight 動作が従来通り
- [ ] ダーク / ライト両モードで識別性 OK

**ヒートマップ (pokepoke)**:
- [ ] 行ラベルが日本語表示 (`name_ja` がある deck は日本語、ない deck は raw name fallback)
- [ ] tooltip のデッキ名も日本語表示
- [ ] dm のヒートマップは従来通り (name=name_ja のため変化なし)

#### Step 8-5: ユーザー OK 後の本番反映 (別指示で実施)

ユーザーの「本番反映」明示指示後:

```bash
git checkout main
git pull origin main
git merge dev
git push origin main
git checkout dev
```

本 plan は DB スキーマ変更を含まないため、Supabase migration の適用は不要。

## リスク

### Recharts の `shape` callback 動作

- Recharts v3.7 の `<Pie>` は `activeIndex` prop を持たず、`activeShape` も内部 Tooltip activation でしか発火しないため、本 plan では `shape` prop の render callback で外部 `activeIndex` state と `props.index` を比較する方式を採用
- callback の引数形状 (`PieSectorShapeProps`: `cx, cy, innerRadius, outerRadius, startAngle, endAngle, fill, index, isActive` 等) は Recharts v3 で安定しているが、実装時に `package.json` でバージョンを再確認
- `isActive` フィールドも引数に含まれるが、これは Recharts 内部 hover が active と判定した時のみ true。本 plan では custom pointer 検出で外部 state を管理するため `isActive` ではなく `props.index === activeIndex` で判定
- 動かない場合のフォールバック: `<Cell>` に `stroke="var(--background)"` `strokeWidth={2}` を `activeIndex === i` の時だけ当てる方式 (扇形は膨らまないが境界線で識別)。ただし PC マウスの体感改善が弱くなるため第一選択にはしない

### `pointermove` イベントの touch 端末競合

- iOS Safari は `pointermove` 発火後すぐに `touchmove` も発火する場合がある
- `handlePointerMove` 冒頭で `e.pointerType === "touch"` ならリターンすることで重複処理を回避 (Step 4-10 の実装で対応済)

### light/dark で色識別性が変わる

- 提示色 (dark = Tailwind 500 系 / light = Tailwind 600 系) は既存 `--chart-1`〜`--chart-7` のパターンに合わせているが、active sector の `var(--background)` 境界線が dark で見えない懸念
- dark の `--background` は `globals.css` で `#0a0a0a` 系のはず → strokeWidth 2 で十分視認可能 (要動作確認)
- 万一視認性が低ければ `stroke="var(--border)"` や `stroke="rgba(255,255,255,0.6)"` 等への切替で対応

### `assignChartColors` の重複 name 入力

- 円グラフの `data` (sort 後) と推移グラフの `topDecks` はいずれも unique name 配列のため理論上重複は起きない
- 万一起きた場合は Map.set で後勝ち上書きされ、palette idx は重複分も消費される (slight な color skip が起きるが UI 崩壊なし)
- defensive な dedup は不要 (呼び出し元の責任)

### CSS 変数追加が opennextjs-cloudflare build で剥がれる可能性

- Tailwind の Just-In-Time mode で `--color-chart-9` 〜 `--color-chart-12` がクラス参照ゼロなら purge される懸念があるが、本変更で導入する CSS 変数は `globals.css` の `:root` / `@theme` に直書きするため Tailwind purge の対象外
- `var(--chart-N)` 形式で直接参照するため Tailwind class 経由ではない → 安全

## 検証

### Claude が自前で実施 (ユーザー依頼なし)

- `npm run lint` 通る
- `npx opennextjs-cloudflare build` 通る
- `grep -rn "colorForArchetype\|deck-archetype-colors" src` 結果 0
- `grep -rn "CHART_COLORS\b\|chartColorByIndex" src` 結果 0 (chart-colors.ts の `CHART_PALETTE` `assignChartColors` のみ残)
- `grep -rn "var(--chart-9)\|var(--chart-10)\|var(--chart-11)\|var(--chart-12)\|var(--chart-other)" src` で `chart-colors.ts` に存在することを確認
- TypeScript エラーなし (`tsc --noEmit` または build 内で確認)
- 静的レビュー: TrendHeatmap の props 互換性 (dm/admin が呼び出し側で引数省略しても動く)

### ユーザー必須 (ブラウザでの実機確認)

Step 8-4 のチェックリスト (円グラフ ホバー / 小スライスラベル / active sector 膨らみと境界線 / 12 色超過時の識別性 / 推移グラフ色被りなし / ヒートマップ日本語表示 / dark/light 両モード)。

## 完了条件

- [ ] Step 1-7 の全コード変更が dev branch に commit / push 済
- [ ] Step 8-1 ローカル lint/build 通過
- [ ] Step 8-2 grep 結果 0 件
- [ ] Step 8-3 dev push 完了
- [ ] Step 8-4 ユーザーが Cloudflare dev preview で全項目 OK 確認
- [ ] Step 8-5 (ユーザー本番反映指示後) main マージ + push 完了

## Resolved Decisions

- [Active 描画方式] Recharts v3 の `<Pie>` には外部 state 駆動の `activeIndex` prop が無いため、現プランの「custom pointer 検出 → activeShape で膨らます」設計は動作しません。どの代替策で実装しますか？ → shape callback + 外部 state
