# DESIGN.md

このドキュメントは、デュエプレトラッカーのUI/ビジュアルデザインを改善・レビューするための設計基準です。
外部のDESIGN.mdを流用するものではなく、公開デザイン文書の調査結果を参考にしながら、本アプリの用途、既存コード、運用ルールに合わせて再構成しています。

開発フロー、ブランチ運用、認証、デプロイ、DB操作などは `AGENTS.md` / `CLAUDE.md` を優先します。この文書はデザイン判断、UI実装、レビュー観点だけを扱います。

## 1. Product Overview

### Product Role

デュエプレトラッカーは、競技カードゲームの対戦後すぐに記録し、蓄積した戦績から環境と自分の傾向を読むためのWebアプリです。

主な利用シーン:

- スマホで対戦終了直後に、使用デッキ、対面デッキ、先攻/後攻、勝敗を5-10秒で記録する
- 連戦中に、1戦ごとに素早く記録して次の対戦へ戻る
- 勝率、対面分布、先攻/後攻差、推移を見てデッキ選択や調整を判断する
- Discordサーバー単位で戦績を共有し、チームの傾向を読む

### Desired Impression

- 静かで集中できる
- 入力が速い
- 数値が読みやすい
- 毎日使っても疲れない
- 競技ツールとして信頼できる
- 複数ゲームに対応しても学習コストが増えない

### Avoid

- ランディングページ風の派手さ
- 装飾が主役になるゲームメディア風
- 情報密度が低すぎるSaaS風
- 色数やグラデーションで意味が曖昧になる画面
- 画面ごとに別アプリのように見えるUI
- 実装者ごとに解釈が変わる抽象的な指示

### Reference Influences

公開デザイン文書調査では、次の方向性だけを参考にする。

- Linear / Raycast / ClickHouse系: 静かなダークUI、surface階層、影に頼らない奥行き
- shadcn/ui / Tailwind v4: semantic token、`@theme inline`、CSS変数ベースのテーマ
- shadcn/ui Charts / Datadog / GitLab Pajamas / Datawrapper / Tremor: チャート色、KPI階層、データ可視化アクセシビリティ
- Material Design / Apple HIG / NN/g / Smashing Magazine / Zuko: モバイル操作、タップ領域、フォーム速度、スマートデフォルト

外部文書の文章、数値、色を無条件にコピーしない。必ず本アプリの実装と利用文脈に合わせて採用する。

## 2. Design Principles

### 1. Record Fast

対戦記録画面では、見た目の華やかさより入力速度を優先する。

- 使用デッキ、対面デッキ、先攻/後攻、勝敗の順序を崩さない
- 直前に使ったゲーム、フォーマット、使用デッキをデフォルトとして再利用する
- 候補が少ない選択は、selectよりチップ、セグメント、ボタンで提示する
- WIN / LOSE / DRAW は画面内で最も迷わない操作にする
- 記録完了後は短いフィードバックを出し、次の入力へ自然に戻る

### 2. Show The Answer First

分析画面では、詳細表より先に「今どうなのか」が分かる構成にする。

- 集計条件、総合勝率、対戦数、先攻/後攻差、主要対面分布を上位に置く
- 詳細リストは結論を補足する情報として扱う
- グラフは装飾ではなく、比較、変化、偏りを読むために使う
- データが少ない時は、不確実さが伝わる空状態にする

### 3. Color Has Meaning

色は意味を持つ時だけ使う。

- Primary: 選択中、主操作、現在地
- Success: 勝ち、共有中、正常
- Warning: DRAW、注意、中立寄りの判定
- Destructive: 負け、削除、解除、エラー
- Muted: 補助情報、非アクティブ、説明文
- Chart: データ系列、デッキarchetype、構成比

色だけで状態を伝えない。ラベル、形、配置、アイコン、数値も組み合わせる。

### 4. Dense But Calm

このアプリは情報ツールなので、一定の情報密度は必要。ただし、詰め込みすぎて読みにくくしない。

- 主要画面はモバイルで片手操作しやすい密度を基準にする
- 数値とラベルの位置を揃え、視線移動を少なくする
- カードを乱用せず、関連情報のまとまりにだけ使う
- 余白は飾りではなく、読み取り単位を分けるために使う

### 5. One App, Multiple Games

ゲームごとの個性は出してよいが、基本UIは共通にする。

- 画面構成、ナビゲーション、フォーム、分析パターンはゲーム間で揃える
- ゲーム差分は名称、フォーマット、デッキ候補、表示文言に閉じ込める
- 当面はゲームごとの差し色を導入しない。どのゲームでも同じデザイン色を使う
- 新ゲーム追加時にデザインをコピー改変し続けない

## 3. Visual Theme

### Theme Direction

現状はdark-firstで設計する。将来的にライトモードをアプリ内トグルで実装する予定があるため、新規UIはダーク固定の色を直接書かず、semantic token経由で色を指定する。

推奨方向:

- 背景は黒に近すぎないニュートラルな暗色
- surfaceは3階層程度で十分にする
- 影よりもsurface差、border、余白で奥行きを作る
- Primaryの紫青は主操作と現在地に限定する
- 勝敗色は即座に判別できる強さを保つ
- WIN / LOSE / DRAW はグラデーションではなく、semantic tokenのフラットな面を基本にする

### Depth Model

奥行きは次の順で表現する。

1. Background: アプリ全体の基底
2. Surface 1: カード、ナビ、モーダル外枠
3. Surface 2: 入力欄、チップ、内側の選択面
4. Surface 3: hover、selected-adjacent、少し強い面
5. Overlay: モーダル背景、ボトムシート背後

影は控えめに使う。ダークUIでは強いshadowより、borderとsurface差の方が安定する。

### Theme Switching

ライトモード実装時は、`html` または `body` に `data-theme="light"` / `data-theme="dark"` を付け、同じsemantic tokenに別値を入れる。コンポーネント側はテーマ名を見ず、常にtokenを参照する。

OS設定追従だけを前提にしない。アプリ内トグルの設定が最終的に勝つ設計にする。

ライトモード実装時は、背景、surface、border、status色だけでなく、`--chart-*` もテーマ別に再定義する。現在のダークUI向けチャート色をライトUIへそのまま流用する前提にしない。

## 4. Design Tokens

### Token Policy

実装時は `src/app/globals.css` のCSS変数、または共通UIコンポーネント経由で色、余白、角丸を使う。

本リポジトリは Tailwind v4 の `@theme inline` を使っている。新しい色トークンを追加したら、`:root` だけでなく `@theme inline` にも `--color-*` として露出させる。

新規PRでは、外部ブランド色や共有画像生成などの例外を除き、新しいhex / rgba / hslaの直書きを増やさない。

### Color Tokens

既存トークンを壊さず、段階的に拡張する。

```css
:root {
  --background: #0f172a;
  --foreground: #e2e8f0;

  --card: #1e293b;
  --card-foreground: #e2e8f0;

  --surface-1: #1a1d2e;
  --surface-2: #232640;
  --surface-3: #2a2d48;

  --primary: #6366f1;
  --primary-foreground: #ffffff;

  --success: #22c55e;
  --warning: #f59e0b;
  --destructive: #ef4444;

  --accent: var(--warning);

  --muted: #334155;
  --muted-foreground: #94a3b8;

  --border: #334155;
  --border-subtle: rgba(100, 116, 139, 0.3);
  --border-strong: #475569;

  --chart-1: #6366f1;
  --chart-2: #f59e0b;
  --chart-3: #22c55e;
  --chart-4: #ef4444;
  --chart-5: #3b82f6;
  --chart-6: #ec4899;
  --chart-7: #14b8a6;
  --chart-8: #64748b;
}

@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-card: var(--card);
  --color-card-foreground: var(--card-foreground);
  --color-surface-1: var(--surface-1);
  --color-surface-2: var(--surface-2);
  --color-surface-3: var(--surface-3);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-success: var(--success);
  --color-warning: var(--warning);
  --color-destructive: var(--destructive);
  --color-accent: var(--accent);
  --color-muted: var(--muted);
  --color-muted-foreground: var(--muted-foreground);
  --color-border: var(--border);
  --color-border-subtle: var(--border-subtle);
  --color-border-strong: var(--border-strong);
  --color-chart-1: var(--chart-1);
  --color-chart-2: var(--chart-2);
  --color-chart-3: var(--chart-3);
  --color-chart-4: var(--chart-4);
  --color-chart-5: var(--chart-5);
  --color-chart-6: var(--chart-6);
  --color-chart-7: var(--chart-7);
  --color-chart-8: var(--chart-8);
}
```

### Migration Rules

- `--background` / `--foreground` / `--card` / `--card-foreground` / `--primary` / `--primary-foreground` / `--success` / `--muted` / `--muted-foreground` / `--border` は維持する
- `--destructive` は危険操作、LOSE、エラー系の意味色として維持する。`--danger` は追加しない
- `--warning` を追加し、DRAW、注意、中立寄りの判定に使う
- `--accent` は新規UIでは使わない。移行期間中は `--warning` と同値のlegacy aliasとして扱う。既存参照がすべて `--warning` 等へ置換され、`rg "accent|--accent"` で利用箇所がなくなった段階でaliasを削除する
- 現状頻出している `#1a1d2e` は `--surface-1` に集約する
- `--card` は当面 `#1e293b` の既存互換tokenとして維持する。`bg-card` / `text-card-foreground` 参照が `--surface-1` 系へ十分に置換された段階で、`--card: var(--surface-1)` のaliasへ切り替える
- surface系の通常テキストは `--foreground` を使う。現時点では `--surface-*-foreground` は増やさない
- ゲーム別の `--game-accent` は当面追加しない
- `--chart-*` はdark / lightで別値を持てるsemantic tokenとして扱う。チャート実装側で固定hexを直接参照しない

### Status Colors

勝敗やエラーの色は、ゲームや画面によって変えない。

- WIN: `--success`
- LOSE: `--destructive`
- DRAW: `--warning`
- Error: `--destructive`
- Shared / connected / ok: `--success`
- Disabled / unavailable: `--muted-foreground` + opacity

Destructiveは危険操作を意味する。LOSE表示では目立たせてよいが、削除や連携解除では確認導線と組み合わせる。

## 5. Typography

### Type Direction

日本語UIとして、読みやすさと数字の比較しやすさを優先する。現状の Geist Sans / Geist Mono を維持する。

文字サイズをviewport幅で拡縮しない。長いデッキ名、サーバー名、ユーザー名は折り返し、省略、詳細遷移のいずれかで破綻を防ぐ。

### Scale

- Page title: 20px前後、強めのweight
- Section title: 15-16px、短く具体的に
- Body: 13-14px
- Secondary text: 11-12px
- KPI label: 11-12px
- KPI value: 20-28px
- Table/list numeric value: 13-16px
- Caption: 10-11px

### Numeric Rules

- 勝率、勝敗数、件数、順位は桁位置を揃える
- 数値の比較が主目的の箇所では `font-mono` または Tailwind v4 の `tabular-nums` utility を検討する
- パーセント記号は数値より弱く見せる
- `--` や `0件` は低彩度で表示し、実データと区別する

## 6. Layout, Spacing, Shape

### Spacing

- ページ左右余白: モバイルでは16pxを基本
- セクション間余白: 16px前後
- カード内余白: 12-16px
- 関連項目の内側余白: 8-12px
- チップ間余白: 6-8px
- 下部ナビあり画面: `pb-20` 相当を確保

余白は情報の関係性を示すために使う。装飾的な余白拡大は避ける。

### Shape

- 小ボタン / チップ: 6-8px
- 入力欄 / カード: 8-10px
- モーダル / ボトムシート: 12-16px
- Active pill / avatar / icon badge: full radius可

カード内カードは原則避ける。どうしても必要な場合は、内側を面ではなく区切り線、薄い背景差、余白で表現する。

### Touch Targets

- 通常操作: 40px以上
- 重要操作: 44px以上
- WIN / LOSE / DRAW: 44px以上、可能なら48px以上
- アイコンボタン: 視覚サイズが小さくてもタップ領域は40px以上
- 隣接する重要操作の間には十分な余白を置く

対戦記録の主操作は親指が届きやすい下寄りに置く。ただしBottomNavと干渉させない。

## 7. Core Components

### PageShell

各主要画面は共通のページ枠を使う。

- モバイル: `max-w-lg` 相当を基本
- 分析画面や詳細画面は、タブレット/デスクトップで広げる余地を残す
- `BottomNav` がある画面は、下部ナビゲーション分の余白として `pb-20` 相当をPageShell側で確保する
- adminなど `BottomNav` がない画面は、`bottomNav={false}` 相当で余白を切り替える
- ページタイトル、右上操作、フォーマット選択の配置を揃える

### BottomNav

下部ナビはアプリの現在地を示す最重要コンポーネント。

- 3つのゲーム内タブ + 1つの共通アカウントタブの4タブ構造を維持する
- アイコンは `lucide-react` を優先し、手書きSVGを増やさない
- Active状態は色、ラベル太さ、インジケータまたはpillの組み合わせで示す
- アイコンだけではなくラベルも表示する
- 背景は `--surface-1`、境界線は `--border-subtle` を基本にする
- iOS PWAのsafe areaを考慮する

現状は `src/components/layout/BottomNav.tsx` に手書きSVGが残っている。Phase 3で `lucide-react` へ置換し、以後はローカル手書きSVGを増やさない。

推奨アイコン:

- Home: `Home`
- Battle: `Swords` または `PlusCircle`
- Stats: `BarChart3`
- Account: `User`

### Button

ボタンは役割で見た目を分ける。

- Primary: 記録、保存、接続、主要な次アクション
- Secondary: 管理、フィルタ、範囲変更
- Ghost: 閉じる、補助リンク、軽い操作
- Destructive: 削除、連携解除など取り返しにくい操作
- Result: WIN / LOSE / DRAW の専用操作

Resultボタンは共通 `Button` のvariantとして扱う。

```tsx
<Button variant="result" tone="win">WIN</Button>
<Button variant="result" tone="loss">LOSE</Button>
<Button variant="result" tone="draw">DRAW</Button>
```

必要に応じて薄いwrapperとして `ResultButton` を作ってもよいが、独自の色、余白、押下表現は持たせない。

Resultボタンの押下表現は、グラデーションではなく `active:scale-95`、明度差、border、focus ringなどで補う。

### IconButton

- `aria-label` 必須
- アイコンはlucide-reactを優先
- 視覚的に小さくてもタップ領域は40px以上
- 削除系はDestructive toneを使う

### SegmentedControl

フォーマット、スコープ、ビュー切替などは共通のSegmentedControlを使う。

対象:

- `FormatSelector`: ND / AD、RANKED / RANDOM
- `ScopeSelector`: 自分のみ / Discord / 全ユーザー
- `ViewSelector`: サマリー / 推移
- `BattleTabsView`: 入力 / 履歴
- 先攻 / 後攻

ルール:

- iPhone幅では5セグメント以下を基本にする
- 選択中はPrimaryの面、border、またはpillで示す
- disabledは属性と見た目の両方で示す
- `aria-selected` / `aria-controls` を壊さない
- 画面ごとの差は `variant` や `size` で吸収し、別々の色・角丸・borderを増やさない

### Surface / Card

カードは情報のまとまりを作るために使う。

- 1カードに1つの主目的
- タイトル、補助文、操作、数値の配置を揃える
- 枠線と背景差を両方強くしすぎない
- クリック可能カードはhover / pressed状態を持つ
- surface上の通常テキストは `--foreground`

### Form Controls

入力フォームは速さとミス防止を優先する。

- ラベルは短く、入力欄の近くに置く
- placeholderをラベル代わりにしない
- select / input / chip の高さと角丸を揃える
- 候補チップは選択状態が明確に分かるようにする
- 入力必須の不足状態は、ボタンdisabledだけでなく画面の流れでも分かるようにする
- 入力中の検証は邪魔にならないタイミングで行う

### Empty / Loading / Toast

- Skeletonは実際のレイアウトに近い形にする
- 空状態では次の行動を1つだけ提示する
- エラーは再試行可能かどうかを伝える
- スピナーだけの長時間待機は避ける
- 記録完了はtoastで短く伝える
- 取り消し可能な操作にはUndoを検討する

## 8. Data Visualization

### Chart Purpose

グラフは比較対象と読み取り目的を明確にする。

- Donut: 対面分布、構成比
- Line: 勝率や使用率の推移
- Heatmap: 期間やデッキの偏り
- Table / Bar list: 多数のデッキ比較
- KPI card: 現在の結論

円グラフは系列が多すぎると読みにくい。7カテゴリを超える場合は「その他」に集約するか、Bar list / Tableへ切り替える。

### Chart Colors

チャート色は `--chart-*` tokenまたは共通関数経由で使う。

- 同じdeck archetypeは、画面をまたいでも同じ色にする
- 色の割り当ては表示順だけに依存させない
- 重要でない系列、サンプルが少ない系列、その他はmuted寄りにする
- 勝率は50%付近を中立として、低い値と高い値が分かる表現にする
- 赤と緑だけに依存しない。ラベル、アイコン、数値も併用する

archetypeの固定色は、まず `src/lib` 側のhelperまたはregistryで `archetype -> --chart-*` の対応を安定させる。初期のデザイン反映ではDBカラムを追加しない。実際の画面確認後、管理画面で色を調整したいなどの要件が明確になった場合にのみDB化を検討する。

### Win Rate Display

勝率表示は次の階層で扱う。

- 主要勝率: 大きく表示し、勝敗数と対戦数を近くに置く
- リスト勝率: 数値、色、件数を同じ行に揃える
- 少数サンプル: 強い色を避け、件数表示で不確実さを補う
- null / 未計測: `--` とmuted色

`getWinRateColor` などの共通ヘルパーを新設し、画面ごとに閾値や色を変えない。

### Recharts Rules

- `ResponsiveContainer` には安定した高さを与える
- 小画面でラベルが重なる場合は、ラベル数を減らすか凡例側に寄せる
- 可能な箇所では shadcn/ui Charts の `accessibilityLayer` 相当を採用する。直接Rechartsを使う場合は `role="img"` と意味のある `aria-label` を付ける
- SVG内の局所的なhexは例外として許容するが、意味色やUI色はtoken化する
- 凡例、ツールチップ、中心数値の階層を揃える

### KPI Pattern

KPIは次の三層を基本にする。

1. Label: muted、短く
2. Value: 大きく、読みやすく
3. Context: 勝敗数、期間、前回差、件数

直近成績の履歴帯やsparklineは有効。ただし、入力画面では装飾より速度を優先する。

## 9. Mobile Interaction

### Fast Record Flow

対戦記録は次の順序を守る。

1. 使用デッキ
2. 対面デッキ
3. 先攻/後攻
4. WIN / LOSE / DRAW

スマートデフォルト:

- 直近のゲーム、フォーマット、使用デッキを保持する
- 対面デッキ入力後、勝敗ボタンへ自然に進める
- 対面候補は主要候補を先に出し、検索やその他は必要時だけ開く
- 連戦中にリセットすべき値と保持すべき値を分ける

連戦中は、ゲーム、フォーマット、使用デッキは保持する。対面デッキ、先攻/後攻、WIN / LOSE / DRAW は記録後にリセットし、誤連続登録を防ぐ。

### Bottom Sheet / Modal

モバイルで候補が多い選択は、必要に応じてボトムシート化する。

- 閉じるボタンを明示する
- スワイプだけに依存しない
- 背景タップで閉じる場合も、誤操作しにくい配置にする
- 下部ナビと重ならない

### Feedback

- 記録完了: 短いtoast
- 保存失敗: 原因が分からなくても再試行可能性を伝える
- 削除や連携解除: 確認を入れる
- disabled: なぜ押せないかが文脈で分かるようにする

## 10. Page Patterns

### Home

ホームは「現在の状態」と「次にすること」を示す場所。

優先情報:

1. 現在のゲーム
2. Discord連携状態
3. 共有中サーバー
4. チームメンバーの概況
5. 対戦記録への導線

改善時の観点:

- Discord未連携時のカードは説明より行動を強くする
- 連携済み時はアカウント情報より共有状態を主役にする
- サーバー一覧は共有中/非共有の差を明確にする

### Battle Record

対戦記録は最重要の入力画面。

優先情報:

1. 今日/指定範囲のミニ成績
2. 使用デッキ
3. 対面デッキ
4. 先攻/後攻
5. WIN / LOSE / DRAW

改善時の観点:

- WIN / LOSE / DRAW は他の操作より大きく、色の意味も固定する
- 対面デッキ候補は主要候補を先に出し、詳細検索は必要時だけ開く
- 履歴タブへの切替は明確にするが、入力フォームを邪魔しない
- 記録後のフィードバックは短く、次入力を妨げない

### Stats

分析は「結論 -> 分解 -> 詳細」の順で読む画面。

優先情報:

1. 集計条件: format / scope / date range
2. 総合勝率、勝敗数、対戦数
3. 対面分布
4. 先攻/後攻差
5. 使用デッキ別
6. 対面デッキ別
7. 推移

改善時の観点:

- フィルタ類は同じ高さ、同じ角丸、同じ選択表現に揃える
- グローバル / チーム / 自分の差はラベルで明確にする
- 有料 / 優良ユーザー限定UIは目立たせすぎず、利用可否は分かりやすくする
- デスクトップ幅では、共通基盤が固まってから2カラム化を検討する

### Decks

デッキ管理は、記録画面の入力速度を支える補助画面。

優先情報:

1. 登録済みデッキ
2. チューニング / バリエーション
3. 追加 / 編集 / 削除
4. 並び替え

改善時の観点:

- 対戦記録画面に戻った時の選択しやすさを重視する
- デッキ名が長い場合でもリストが崩れないようにする
- 編集 / 削除は誤操作しにくい配置にする

### Account

アカウントは設定と接続状態を確認する画面。

優先情報:

1. ログイン状態
2. 連携状態
3. セキュリティ
4. 管理 / フィードバック導線

改善時の観点:

- 重要な危険操作はDestructiveとして一貫した見た目にする
- 設定項目はカード乱用ではなく、セクションと行で整理する

### Share Images

共有カードはアプリ本体より少し演出してよい。ただし、数値の読みやすさを最優先する。

- SNS上で一目で勝率、勝敗、期間が読めること
- アプリ本体と完全一致しなくてよいが、色とタイポグラフィの関係性は保つ
- 画像生成用コンポーネントではCSS制約が異なるため、通常UI部品と無理に共通化しない

## 11. Responsive And Accessibility

### Mobile

モバイルを第一基準にする。

- 主要操作は44px以上
- 下部ナビとボトムシートのsafe areaを考慮する
- 横スクロールを発生させない
- 長いデッキ名は省略し、必要なら詳細画面で読む
- BottomNavは3-5タブの範囲に収める

### Tablet / Desktop

データ閲覧画面では広い幅を活かす。

- 入力画面はモバイル幅のままでもよい
- 分析画面は共通基盤が固まった後で2カラム化を検討する
- グラフとリストを横並びにするときは、主従関係を明確にする
- `max-w-lg` 固定が読み取りを妨げる画面は、画面単位で広げる

### Accessibility

最低限守ること:

- 通常テキストはWCAG AA相当のコントラストを目指す
- 小さいテキストは4.5:1以上を目安にする
- 大きい数値やチャート内大型ラベルは3:1以上を目安にする
- データ可視化の隣接色は3:1程度の識別性を目指す
- 色だけで勝敗、選択、エラーを伝えない
- アイコンだけのボタンには `aria-label` を付ける
- タブ / セグメントはキーボード操作と `aria-selected` を意識する
- disabled状態は見た目と属性の両方で示す

## 12. Implementation Rules

### Prefer Shared Components

以下の共通化を優先する。

- `PageShell`
- `Surface` / `Card`
- `Button`
- `IconButton`
- `SegmentedControl`
- `Chip`
- `Field`
- `StatRow`
- `EmptyState`
- `Skeleton`
- `FilterBar`

既存の `Skeleton` は継続利用し、必要に応じてvariantを増やす。`SegmentedControl` / `Button` / `IconButton` / `Chip` / `Field` は新規または既存統合として整備し、現在の個別実装を段階的に吸収する。

### Avoid New Hard-Coded Visuals

新規・改修時は以下を避ける。

- コンポーネント内の近似色直書き
- 似た角丸値の乱立
- 同じ用途のボタンを別classで再実装
- 手書きSVGアイコンの追加
- 画面ごとに異なるセグメントUI

アイコンはlucide-reactを優先する。よく使う対応:

- Refresh: `RefreshCw`
- Search: `Search`
- Edit: `Pencil`
- Close / Delete: `X` または `Trash2`
- Back: `ChevronLeft`
- Add: `Plus`
- Settings: `Settings`

例外:

- 共有画像生成コンポーネント
- 外部ブランド色が必要なOAuth / Discord / X / Googleボタン
- グラフライブラリ都合で局所的なstyle指定が必要な箇所

### File Scope

UI改善では、触る範囲をPhaseごとに限定する。

- token拡張だけのPhaseでは `globals.css` 以外を触らない
- 共通部品追加Phaseでは、既存画面の置換を最小限にする
- 対戦記録、分析、アカウント、共有画像を同じPRで混ぜない
- 認証、DB、Supabase RPC、デプロイ設定には触らない

### Validation Commands

通常検証:

```bash
npm run lint
```

広範囲に影響するUI基盤変更後:

```bash
npx opennextjs-cloudflare build
```

使わない:

```bash
npm run build
npm run deploy
```

`npm run build` / `npm run deploy` は通常不要。Cloudflareの自動ビルドとOpenNext検証を優先する。

## 13. Review Checklist

### Product Fit

- 対戦記録が速くなっているか
- 分析の結論が読みやすくなっているか
- 装飾が主操作を邪魔していないか
- 複数ゲーム対応の共通性を壊していないか

### Visual Consistency

- 色の意味が既存ルールと一致しているか
- 角丸、余白、境界線が近いUI同士で揃っているか
- セグメント、チップ、ボタンの選択状態が統一されているか
- 新しいハードコード色が増えていないか
- ライトモード予定に反して、dark固定の色指定が増えていないか

### Data Display

- 勝率、勝敗数、対戦数の関係が分かりやすいか
- 同じdeck archetypeが画面をまたいで同じ色になっているか
- グラフの色と凡例が対応しているか
- 0件、少数件、大量件の各状態で読めるか
- 集計条件が画面上で確認できるか

### Interaction

- 主操作が十分なタップ領域を持っているか
- disabled / loading / success / error が分かるか
- 誤操作しやすい削除・解除に確認または明確なDestructive表現があるか
- タブやモーダルがキーボード / スクリーンリーダー上で破綻しないか

### Layout

- モバイルで文字やボタンが重ならないか
- 下部ナビとコンテンツが干渉しないか
- 長いデッキ名、サーバー名、ユーザー名で崩れないか
- デスクトップ幅で不自然に狭すぎないか

### Verification

- Claudeが可能な範囲で、静的確認、lint、ローカル画面確認、スクリーンショット確認を行う
- token、共通コンポーネント、レイアウト基盤など広範囲に影響する変更後のみ、`npx opennextjs-cloudflare build` も実行する
- ユーザー確認が必要なのは、実機ブラウザでの見え方、操作感、テーマ切替の体感確認などに絞る

## 14. First Improvement Order

初回のUI改善は、以下の順で小さく進める。

1. `globals.css` の色トークンを `surface-*` / `warning` / `border-*` / `chart-*` まで拡張する
2. `SegmentedControl` を共通化し、Format / Scope / View / Battle tabs に適用する
3. BottomNavをlucide-react化し、アクティブ状態を統一する
4. `Button` / `IconButton` / `Chip` を共通化する
5. 対戦記録画面のカード、入力欄、結果ボタンを整理する
6. 分析画面のフィルタ、KPI、チャート色、`getWinRateColor` などの共通ヘルパーを整理する
7. `/{game}/stats` トップのサマリー画面だけ、デスクトップ幅のレイアウト拡張を検討する

この順番は、見た目の改善と今後の保守性を同時に進めるための推奨であり、機能追加や緊急修正より優先されるものではありません。

## 15. Claude Code Review Prompt

Claude Codeにこのデザイン文書をレビューさせる場合は、次の観点で依頼する。

```text
DESIGN.mdをレビューしてください。
目的は、デュエプレトラッカーのUI改善方針として実装者が迷わず参照できる状態にすることです。

確認してほしい点:
- 現状のNext.js/React/Tailwind実装と矛盾していないか
- Tailwind v4 / @theme inline / semantic token方針と矛盾していないか
- 対戦記録、分析、ホーム、デッキ管理の優先順位が妥当か
- ライトモードをアプリ内トグルで実装する前提に耐えるか
- ゲーム別accentを導入しない方針が一貫しているか
- データ可視化の色、KPI、少数サンプル表現の指針が実装可能か
- モバイル高速入力の指針が具体的か
- AGENTS.md / CLAUDE.mdの開発ルールと衝突していないか

出力形式:
1. Must Fix
2. Should Improve
3. Nice To Have
4. 最終的に採用してよいか
```
