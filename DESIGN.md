# DESIGN.md

このドキュメントは、デュエプレトラッカーのUI/ビジュアルデザインを改善・レビューするための設計メモです。
外部公開テンプレートの流用ではなく、現状のアプリ構造と利用文脈に合わせて作成しています。

この文書はデザイン面の判断基準を定めるものです。開発フロー、ブランチ運用、認証、デプロイ、DB操作などのルールは `AGENTS.md` / `CLAUDE.md` を優先します。

## Product Position

デュエプレトラッカーは、対戦後すぐに記録し、蓄積した戦績から環境と自分の傾向を読むための競技プレイヤー向けツールです。

目指す印象:

- 静かで集中できる
- 入力が速い
- 数値が読みやすい
- 毎日使っても疲れない
- 複数ゲームに対応してもUIの学習コストが増えない

避ける印象:

- ランディングページ風の派手さ
- 装飾が主役になるゲームメディア風
- 情報密度が低すぎるSaaS風
- 色数やグラデーションで意味が曖昧になる画面
- 画面ごとに別アプリのように見えるUI

## Core Principles

### 1. Record Fast

対戦記録画面では、見た目の華やかさより入力速度を優先する。

- 使用デッキ、対面デッキ、先攻/後攻、勝敗の順序を崩さない
- 主操作は親指で押しやすい位置とサイズにする
- WIN / LOSE / DRAW は画面内で最も迷わないボタンにする
- 記録完了後は次の入力へ自然に戻れる状態にする

### 2. Show The Answer First

分析画面では、詳細表より先に「今どうなのか」が分かる構成にする。

- 総合勝率、対戦数、先攻/後攻差、主要対面分布を上位に置く
- 詳細リストは結論を補足する情報として扱う
- グラフは装飾ではなく比較・変化・偏りを読むために使う
- データが少ない時は、不確実さが伝わる空状態にする

### 3. Color Has Meaning

色は意味を持つ時だけ使う。

- Primary: 選択中、主操作、現在地
- Success: 勝ち、共有中、正常
- Warning: 注意、DRAW、判定が中立に近い値
- Destructive: 負け、削除、解除、エラー
- Muted: 補助情報、非アクティブ、説明文

同じ意味の色を画面によって変えない。色だけで状態を伝えず、ラベル・形・配置でも判別できるようにする。

### 4. Dense But Calm

このアプリは情報ツールなので、一定の情報密度は必要。ただし、詰め込みすぎて読みにくくしない。

- 主要画面はモバイルで片手操作しやすい密度を基準にする
- 数値とラベルの位置を揃えて、視線移動を少なくする
- カードを乱用せず、関連情報のまとまりにだけ使う
- 余白は大きく飾るためではなく、読み取り単位を分けるために使う

### 5. One App, Multiple Games

ゲームごとの個性は出してよいが、基本UIは共通にする。

- 画面構成、ナビゲーション、フォーム、分析パターンはゲーム間で揃える
- ゲーム差分は名称、フォーマット、デッキ候補、表示文言に閉じ込める
- 当面はゲームごとの差し色を導入しない。どのゲームでも同じデザイン色を使う
- 新ゲーム追加時にデザインをコピー改変し続けない

## Visual Direction

### Base Theme

現状はダークUIを基準に設計する。背景は暗く、カード・入力欄・セグメント・ナビゲーションで階層を作る。

将来的にライトモードをアプリ内トグルで実装する予定がある。新規UIはダーク固定の色を直接書かず、必ずsemantic token経由で色を指定する。OS設定追従だけを前提にせず、アプリ側のテーマ状態が最終的に勝つ設計にする。

推奨方向:

- 背景は黒に近すぎないニュートラルな暗色
- カードは背景より少し明るい程度
- 境界線は強すぎず、面の差と組み合わせる
- Primaryの紫青は主操作に限定し、画面全体を紫一色にしない
- 勝敗色は鮮やかすぎないが、即座に判別できる強さを保つ
- WIN / LOSE / DRAW はグラデーションではなく、`--success` / `--destructive` / `--warning` のフラットな面を基本にする

### Typography

日本語UIとして、読みやすさと数字の比較しやすさを優先する。

- ページタイトル: 20px前後、太さは強め
- セクション見出し: 15-16px、短く具体的に
- 通常本文: 13-14px
- 補助文: 11-12px
- 主要数値: 18-28px
- テーブル/リスト数値: 桁位置を揃える

文字サイズをviewport幅で拡縮しない。長いデッキ名やサーバー名は折り返し・省略・詳細遷移のいずれかで破綻を防ぐ。

### Shape And Spacing

角丸と余白は控えめに統一する。

- 小ボタン/チップ: 6-8px
- 入力欄/カード: 8-10px
- モーダル/ボトムシート: 12-16px
- 主要タップ領域: 高さ40px以上、重要操作は44px以上
- ページ左右余白: モバイルでは16pxを基本
- セクション間余白: 16px前後
- 関連項目の内側余白: 8-12px

カード内カードは原則避ける。どうしても必要な場合は、内側を面ではなく区切り線・薄い背景差・余白で表現する。

## Design Tokens

実装時は可能な限り `globals.css` のCSS変数、または共通UIコンポーネント経由で色・余白・角丸を使う。各コンポーネント内に類似色を直書きし続けない。

本リポジトリは Tailwind v4 の `@theme inline` を使っている。新しい色トークンを追加したら、`:root` だけでなく `@theme inline` にも `--color-*` として露出させ、`bg-surface-1` のようなTailwind utilityから使える状態にする。

### Naming Policy

既存トークンを壊さず、段階的に拡張する。

- `--background` / `--foreground` / `--card` / `--card-foreground` / `--primary` / `--primary-foreground` / `--success` / `--muted` / `--muted-foreground` / `--border` は維持する
- `--destructive` は危険操作・LOSE・エラー系の意味色として維持する。`--danger` は追加しない
- `--warning` を追加し、DRAW・注意・中立寄りの判定に使う
- `--accent` は新規UIでは使わない。移行期間中は `--warning` と同値のlegacy aliasとして扱う。既存参照がすべて `--warning` 等へ置換され、`rg "accent|--accent"` で利用箇所がなくなった段階でaliasを削除する
- `--surface-1` / `--surface-2` / `--surface-3` を追加し、カード、入力欄、選択面の階層を表現する
- 現状頻出している `#1a1d2e` は `--surface-1` に集約する。`--card` は既存互換として残し、新規の外枠カード背景は `--surface-1` を使う
- surface系の上に載る通常テキストは `--foreground` を使う。現時点では `--surface-*-foreground` は増やさない
- `--border` は既存互換の既定borderとして残し、必要に応じて `--border-subtle` / `--border-strong` を使い分ける
- ゲーム別の `--game-accent` は当面追加しない。ゲームの識別はテキスト、フォーマット、ページ文脈で行う

初期値の方向性:

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
  --accent: var(--warning);
  --destructive: #ef4444;
  --muted: #334155;
  --muted-foreground: #94a3b8;
  --border: #334155;
  --border-subtle: rgba(100, 116, 139, 0.3);
  --border-strong: #475569;
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
  --color-accent: var(--accent);
  --color-destructive: var(--destructive);
  --color-muted: var(--muted);
  --color-muted-foreground: var(--muted-foreground);
  --color-border: var(--border);
  --color-border-subtle: var(--border-subtle);
  --color-border-strong: var(--border-strong);
}
```

ライトモード実装時は、`html` または `body` に `data-theme="light"` / `data-theme="dark"` を付け、同じsemantic tokenに別値を入れる。コンポーネント側はテーマ名を見ず、常にtokenを参照する。

## Components

### Page Shell

各主要画面は共通のページ枠を使う。

- モバイル: `max-width` は現在の `max-w-lg` 相当を基本
- 分析画面や詳細画面は、タブレット/デスクトップで広げる余地を残す
- `BottomNav` がある画面は、下部ナビゲーション分の余白として現在の `pb-20` 相当をPageShell側で確保する
- adminなど `BottomNav` がない画面は、PageShellの `bottomNav={false}` 相当で余白を切り替える
- ページタイトル、右上操作、フォーマット選択の配置を揃える

### Bottom Navigation

下部ナビはアプリの現在地を示す最重要コンポーネント。

- アイコンは lucide-react を優先し、手書きSVGを増やさない
- アクティブ状態は色、ラベル太さ、インジケータの組み合わせで示す
- 3つのゲーム内タブ + 1つの共通アカウントタブの4タブ構造を維持する
- 背景は十分に濃くし、コンテンツと混ざらないようにする

### Buttons

ボタンは役割で見た目を分ける。

- Primary: 記録、保存、接続、主要な次アクション
- Secondary: 管理、フィルタ、範囲変更
- Ghost: 解除、閉じる、補助リンク
- Destructive: 削除、連携解除など取り返しにくい操作
- Result: WIN / LOSE / DRAW の専用ボタン

テキストだけの小さすぎるボタンは、重要操作には使わない。アイコンだけの操作には必ず `title` またはアクセシブルな名前を付ける。

Resultボタンは、テーマ切替に耐えるようにグラデーションではなくsemantic tokenのフラットな背景で表現する。押下感は明度差、border、scale、shadowで補う。

実装は共通 `Button` のvariantとして扱い、`<Button variant="result" tone="win|loss|draw">` を基本形にする。必要に応じて薄いwrapperとして `ResultButton` を作ってもよいが、独自の色・余白・押下表現は持たせない。

### Segmented Controls

フォーマット、スコープ、ビュー切替などは共通のSegmented Controlを使う。

- 選択中はPrimaryの面で示す
- 非選択はMuted Foreground
- disabledは透明度とカーソルで示す
- 丸み、内側余白、高さを揃える

対象:

- `FormatSelector`: ND / AD、RANKED / RANDOM
- `ScopeSelector`: 自分のみ / Discord / 全ユーザー
- `ViewSelector`: サマリー / 推移
- `BattleTabsView`: 入力 / 履歴

既存の `FormatSelector` / `ScopeSelector` / `ViewSelector` / `BattleTabsView` は、段階的に共通 `SegmentedControl` へ統合する。画面ごとの差は `variant` や `size` で吸収し、別々の色・角丸・borderを増やさない。

### Cards And Surfaces

カードは情報のまとまりを作るために使う。

- 1カードに1つの主目的
- タイトル、補助文、操作、数値の配置を揃える
- 枠線と背景差を両方強くしすぎない
- カードの中でさらにカードを積まない
- クリック可能カードはホバー/押下状態を持つ

### Forms

入力フォームは速さとミス防止を優先する。

- ラベルは短く、入力欄の近くに置く
- select/input/chipの高さと角丸を揃える
- 候補チップは選択状態が明確に分かるようにする
- 入力必須の不足状態は、ボタンdisabledだけでなく画面の流れでも分かるようにする

### Charts

グラフは比較対象と読み取り目的を明確にする。

- 勝率色は `getWinRateColor` など共通関数で統一する
- 凡例、ツールチップ、中心数値の階層を揃える
- 円グラフは構成比、折れ線は推移、ヒートマップは偏りに使う
- 小さい画面でラベルが重なる場合は、表示数や凡例側の情報量を調整する

### Empty And Loading States

空状態と読み込み状態は画面の品質に直結する。

- Skeletonは実際のレイアウトに近い形にする
- 空状態では次の行動を1つだけ提示する
- エラーは原因が分からない場合でも、再試行可能かどうかを伝える
- スピナーだけの長時間待機は避ける

## Page Patterns

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

- フィルタ類が多いので、同じ高さ・同じ角丸・同じ選択表現に揃える
- グローバル/チーム/自分の差はラベルで明確にする
- 有料/優良ユーザー限定UIは目立たせすぎず、利用可否は分かりやすくする
- デスクトップ幅では分析カードやグラフの横並びを検討する

### Decks

デッキ管理は、記録画面の入力速度を支える補助画面。

優先情報:

1. 登録済みデッキ
2. チューニング/バリエーション
3. 追加・編集・削除
4. 並び替え

改善時の観点:

- 対戦記録画面に戻った時の選択しやすさを重視する
- デッキ名が長い場合でもリストが崩れないようにする
- 編集/削除は誤操作しにくい配置にする

### Account

アカウントは設定と接続状態を確認する画面。

優先情報:

1. ログイン状態
2. 連携状態
3. セキュリティ
4. 管理/フィードバック導線

改善時の観点:

- 重要な危険操作はDestructiveとして一貫した見た目にする
- 設定項目はカード乱用ではなく、セクションと行で整理する

### Share Images

共有カードはアプリ本体より少し演出してよい。ただし、数値の読みやすさを最優先する。

- 共有画像はSNS上で一目で勝率・勝敗・期間が読めること
- アプリ本体と完全一致しなくてよいが、色とタイポグラフィの関係性は保つ
- 画像生成用コンポーネントではCSS制約が異なるため、通常UI部品と無理に共通化しない

## Responsive Rules

### Mobile

モバイルを第一基準にする。

- 主要操作は44px以上
- 下部ナビとボトムシートのsafe areaを考慮する
- 横スクロールを発生させない
- 長いデッキ名は省略し、必要なら詳細画面で読む

### Tablet / Desktop

データ閲覧画面では広い幅を活かす。

- 入力画面はモバイル幅のままでもよい
- 分析画面は2カラム化を検討する
- グラフとリストを横並びにするときは、主従関係を明確にする
- `max-w-lg` 固定が読み取りを妨げる画面は、画面単位で広げる

## Accessibility

最低限守ること:

- 文字と背景のコントラストを確保する
- 色だけで勝敗・選択・エラーを伝えない
- ボタンには意味のあるラベルを付ける
- アイコンだけのボタンには `title` または `aria-label` を付ける
- タブ/セグメントはキーボード操作と `aria-selected` を意識する
- disabled状態は見た目と属性の両方で示す

## Implementation Guidelines

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

既存の `Skeleton` は継続利用し、必要に応じてvariantを増やす。`SegmentedControl` / `Button` / `IconButton` / `Chip` / `Field` は新規または既存統合として整備し、現在の個別実装を段階的に吸収する。

既存画面を改善する時は、まず似たUIが他画面にもないか確認する。1画面だけの最適化で全体の一貫性を壊さない。

### Avoid Hard-Coded Visual Values

新規・改修時は以下を避ける。

- コンポーネント内の近似色直書き
- 似た角丸値の乱立
- 同じ用途のボタンを別classで再実装
- 手書きSVGアイコンの追加
- 画面ごとに異なるセグメントUI

新規PRでは、外部ブランド色や共有画像生成などの例外を除き、新しいhex / rgba / hslaの直書きを増やさない。必要な色はtokenに昇格し、`@theme inline` にも露出させる。

例外:

- 共有画像生成コンポーネント
- 外部ブランド色が必要なOAuth/Discord/X/Googleボタン
- グラフライブラリ都合で局所的なstyle指定が必要な箇所

### Icons

アイコンは `lucide-react` を優先する。

- Home: `Home`
- Battle: `Swords` または `PlusCircle`
- Stats: `BarChart3`
- Account: `User`
- Refresh: `RefreshCw`
- Search: `Search`
- Edit: `Pencil`
- Close/Delete: `X`
- Back: `ChevronLeft`

ブランドロゴやサービス固有ロゴは例外。

## Review Checklist

UI変更のレビュー時は以下を確認する。

### Product Fit

- 対戦記録が速くなっているか
- 分析の結論が読みやすくなっているか
- 装飾が主操作を邪魔していないか
- 複数ゲーム対応の共通性を壊していないか

### Visual Consistency

- 色の意味が既存ルールと一致しているか
- 角丸、余白、境界線が近いUI同士で揃っているか
- セグメント、チップ、ボタンの選択状態が統一されているか
- 新しいハードコード色が増えすぎていないか
- ライトモード予定に反して、dark固定の色指定が増えていないか

### Layout

- モバイルで文字やボタンが重ならないか
- 下部ナビとコンテンツが干渉しないか
- 長いデッキ名・サーバー名・ユーザー名で崩れないか
- デスクトップ幅で不自然に狭すぎないか

### Interaction

- 主操作が十分なタップ領域を持っているか
- disabled / loading / success / error が分かるか
- 誤操作しやすい削除・解除に確認または明確なDestructive表現があるか
- タブやモーダルがキーボード/スクリーンリーダー上で破綻しないか

### Data Display

- 勝率、勝敗数、対戦数の関係が分かりやすいか
- グラフの色と凡例が対応しているか
- 0件・少数件・大量件の各状態で読めるか
- 集計条件が画面上で確認できるか

### Verification

- Claudeが可能な範囲で、静的確認、lint、ローカル画面確認、スクリーンショット確認を行う
- ユーザー確認が必要なのは、実機ブラウザでの見え方、操作感、テーマ切替の体感確認などに絞る

## Claude Code Review Prompt

Claude Codeにこのデザイン草案をレビューさせる場合は、次の観点で依頼する。

```text
DESIGN.mdをレビューしてください。
目的は、デュエプレトラッカーのUI改善方針として実装者が迷わず参照できる状態にすることです。

確認してほしい点:
- 現状のNext.js/React/Tailwind実装と矛盾していないか
- Tailwind v4 / @theme inline / semantic token方針と矛盾していないか
- ルールが抽象的すぎず、実装判断に使える粒度になっているか
- 対戦記録、分析、ホーム、デッキ管理の優先順位が妥当か
- ライトモードをアプリ内トグルで実装する前提に耐えるか
- ゲーム別accentを導入しない方針が一貫しているか
- 今後の共通UIコンポーネント化に向けた指針が不足していないか
- AGENTS.md / CLAUDE.mdの開発ルールと衝突していないか

出力形式:
1. Must Fix
2. Should Improve
3. Nice To Have
4. 最終的に採用してよいか
```

## First Improvement Candidates

初回のUI改善は、以下の順で小さく進める。

1. `globals.css` の色トークンを `surface-*` / `border-*` まで拡張する
2. `SegmentedControl` を共通化し、Format / Scope / View / Battle tabs に適用する
3. BottomNavをlucide-react化し、アクティブ状態を統一する
4. `Button` / `IconButton` / `Chip` を共通化する
5. 対戦記録画面のカード・入力欄・結果ボタンを整理する
6. 分析画面の上部サマリーとフィルタ群を整理する
7. `/{game}/stats` トップのサマリー画面だけ、デスクトップ幅のレイアウト拡張を検討する

この順番は、見た目の改善と今後の保守性を同時に進めるための推奨であり、機能追加や緊急修正より優先されるものではありません。
