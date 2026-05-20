# Tierlog 横長ロゴをログイン画面に反映する Plan

- 作成日: 2026-05-19
- 作成者: Claude (orchestrator)
- レビュー方式: `/review-plan-loop` で plan-critic 反復 → GO
- ステータス: Draft
- 関連 plan / memory:
  - `docs/plans/2026-05-19_tierlog_rebrand.md` (リブランド本体。本 Plan はその UI 仕上げの 1 ステップ)
  - `tierlog-lint-debt.md` (auto-memory: `npm run lint` は既存負債で fail することがある)

---

## 1. 背景・目的

- アイコン類（favicon / PWA / apple-touch-icon）と横長ロゴ素材 `public/brand/tierlog-logo-horizontal.svg` は実装・dev/main 反映済み。
- しかしアプリ内 UI ではまだ横長ロゴを使っておらず、ログイン画面では `<h1>Tierlog</h1>` のプレーンテキスト見出しで表現している。
- ブランドが最も自然に映える「ログイン画面」にのみ横長ロゴを反映し、ブランド初接触の体験を強化する。
- 共有ページ等への展開は今回スコープ外（次フェーズで検討）。

## 2. 確定方針（ユーザー指示で確定済）

| ID | 項目 | 確定内容 |
|---|---|---|
| D1 | テーマ対応方式 | **インライン SVG を React コンポーネント化**（`<img>` で外部 SVG を読む方式や 2 バリアント方式は不採用）|
| D2 | スコープ | **ログイン画面 `/auth` のみ**。共有ページ・home/battle/stats/BottomNav/account/terms/privacy/OG画像は触らない |
| D3 | wordmark 色 | `fill="currentColor"` にして親の `text-foreground` に追従させる |
| D4 | mark 色 | 既存の `#6366f1` / `#0f172a` / 白 stroke を**基本維持**（リスクは §6 で記載） |
| D5 | サブコピー | 「対戦記録・環境分析ツール」は維持 |
| D6 | ロゴ高さ | モバイルで大きすぎないよう **36〜44px 程度**（最終値は本 Plan §5.3 で確定）|
| D7 | a11y | `aria-label="Tierlog"` または `<title>` で alt 相当を提供 |

## 3. 完了済（本 Plan のスコープ外）

- favicon / PWA icon / apple-touch-icon / manifest 用アイコン整備
- 横長ロゴ SVG 素材 `public/brand/tierlog-logo-horizontal.svg` の作成・配置
- `tierlog.app` 独自ドメイン移行・ブランドリネーム（`2026-05-19_tierlog_rebrand.md` で完了済）

## 4. 本 Plan のスコープ外（明示）

以下は今回**触らない**:

- `src/app/share/[id]/page.tsx` の header（共有ランディング）
- `src/components/share/StatsShareCard.tsx` / `DeckShareCard.tsx`（OG画像内 trackerName 表記）
- `src/app/{dm,pokepoke}/home/page.tsx`（ゲームホーム見出し / `GameSelector`）
- `src/app/{dm,pokepoke}/battle/page.tsx` / `stats/page.tsx`（高密度画面）
- `src/components/layout/BottomNav.tsx`
- `src/app/account/page.tsx` / `account/security/`
- `src/app/terms/page.tsx` / `src/app/privacy/page.tsx`
- `src/app/not-found.tsx` / `src/app/error.tsx`
- `src/components/pwa/InstallPrompt.tsx`
- `src/lib/games/index.ts`（`APP_BRAND.name` / `trackerName` テキスト識別子は維持）
- `src/app/layout.tsx`（metadata の `SITE_NAME` はテキスト維持）
- `public/brand/tierlog-logo-horizontal.svg` 既存ファイル（インライン化は別ファイルで実施。SVG ファイルは将来の reference / OG fallback 用途として残す）

## 5. コード実装（Claude 作業、dev ブランチで実施）

### 5.1 新規ファイル: `src/components/brand/TierlogLogo.tsx`

`public/brand/tierlog-logo-horizontal.svg` の構造をベースにした React コンポーネント。

**設計**:

- viewBox は元 SVG と同じ `0 0 760 200`（アスペクト比 3.8:1）
- props で外部から `className` / `title` をカスタマイズ可能にする（最低限）。a11y 名は `<title>` 要素 + `aria-labelledby` に一本化し、`aria-label` を SVG へ直付けする props は設けない（入口を 1 つに集約）
- wordmark `<text>` の `fill` は `currentColor` に変更し、親要素の `color`（Tailwind の `text-foreground` 経由）に追従
- font-family: 元 SVG は `font-family="Geist, Inter, Arial, sans-serif"` だが、`next/font/google` の `Geist` は CSS 変数 `--font-geist-sans` 経由でしか名前解決できない。インライン SVG の `<text>` で同 font を使うため `style={{ fontFamily: "var(--font-geist-sans), Inter, Arial, sans-serif" }}` を `<text>` に付ける（Inter / Arial フォールバック維持）
- mark の 3 段（`#6366f1` / `#0f172a` / `#6366f1`）と白 stroke は**そのまま維持**（D4）。`stroke="#ffffff"` / `stroke-width="44"` / `stroke-linejoin="round"`
- a11y: `role="img"` を付与し、`<title>` 要素を内包して `aria-labelledby={titleId}`（`titleId` は `useId()` 由来の動的値）で関連付ける。固定文字列 id（元 SVG の `id="title"` 等）は使わない（同一ページ複数描画時の衝突回避）
- `<title>` の id 衝突を避けるため、`useId()` でユニーク ID を生成（同一ページに複数描画される将来拡張への保険）
- ハイドレーション安全のため、コンポーネント自体はサーバ・クライアントどちらでも動く純粋関数。`"use client"` は付けない（React の `useId` は RSC 互換）
- height は呼び出し側で `className`（Tailwind の `h-*`）で指定する。コンポーネント側 `<svg>` には `width` / `height` 属性を **付けず** `viewBox="0 0 760 200"` のみを持たせる。これにより呼び出し側 `h-10` で高さ 40px が決まり、`w-auto` が viewBox のアスペクト比（3.8:1）から幅を自動算出する。aspect-ratio 保持のため `preserveAspectRatio="xMidYMid meet"`（デフォルト）も明示する

**コンポーネント API（提案）**:

```tsx
type Props = {
  className?: string;       // Tailwind 等で外形サイズ・色を指定
  title?: string;           // SVG の <title> 内容 = a11y 名（デフォルト "Tierlog"）
};
export function TierlogLogo({ className, title = "Tierlog" }: Props) { ... }
```

**インライン SVG 内容（要点のみ。実装時に元 SVG から忠実コピー）**:

```tsx
<svg
  xmlns="http://www.w3.org/2000/svg"
  viewBox="0 0 760 200"
  role="img"
  aria-labelledby={titleId}
  className={className}
>
  <title id={titleId}>{title}</title>
  <g transform="translate(24 18) scale(0.16)" stroke="#ffffff" strokeWidth="44" strokeLinejoin="round">
    <path fill="#6366f1" d="M536 532 L806 667 Q834 680 806 693 L536 828 Q512 840 488 828 L218 693 Q190 680 218 667 L488 532 Q512 520 536 532 Z" />
    <path fill="#0f172a" d="M536 352 L806 487 Q834 500 806 513 L536 648 Q512 660 488 648 L218 513 Q190 500 218 487 L488 352 Q512 340 536 352 Z" />
    <path fill="#6366f1" d="M536 172 L806 307 Q834 320 806 333 L536 468 Q512 480 488 468 L218 333 Q190 320 218 307 L488 172 Q512 160 536 172 Z" />
  </g>
  <text
    x="210"
    y="122"
    fill="currentColor"
    style={{ fontFamily: "var(--font-geist-sans), Inter, Arial, sans-serif" }}
    fontSize="82"
    fontWeight="800"
    letterSpacing="0"
  >
    Tierlog
  </text>
</svg>
```

備考: 元 SVG では `font-family` 属性で指定していたが、JSX では `style` で CSS 変数を解決させる。`fontFamily` を JSX 属性として渡しても CSS 変数は `style` 内でないと評価されないため `style` 経由。

### 5.2 改修: `src/app/auth/page.tsx`

差分は最小化する。具体的な置換:

- 既存の import 群（`createClient` / `@/lib/games` の import 直後）に `import { TierlogLogo } from "@/components/brand/TierlogLogo";` を追加
- 既存の見出しブロック（`<div className="text-center">` 内の `<h1 className="text-[24px] font-bold text-foreground">Tierlog</h1>` とサブコピー `<p>` を含む div）を以下に置換:

```tsx
<div className="text-center">
  <TierlogLogo className="mx-auto h-10 w-auto text-foreground" />
  <p className="text-[13px] text-muted-foreground mt-2">
    対戦記録・環境分析ツール
  </p>
</div>
```

- `h-10`（Tailwind 既定で 40px）を採用（D6 の 36〜44px 中央値）
- `w-auto` は SVG の viewBox 比から自動で 152px 幅になる（aspect-ratio 3.8:1）
- `text-foreground` で `currentColor` → `--foreground` に追従させる
- `mx-auto` で中央寄せ（親 `<div className="text-center">` で text-align center だが SVG はテキストではないので `mx-auto` で確実にセンタリング）
- 既存のサブコピー `<p>対戦記録・環境分析ツール</p>` は変更しない（D5）

### 5.3 高さ最終値の根拠（D6）

- 旧 `<h1 className="text-[24px] font-bold">` のレンダー高は 24px×1em line-height 程度 ≈ 32px。視覚的に「やや大きめにブランドを置く」意図のためロゴ採用機に**少し拡大**して 40px を採用
- 36px だと旧テキストとほぼ同じで地味、44px だと `max-w-sm` (384px) 内でやや存在感過剰のリスクあり
- 40px = `h-10` は Tailwind 既定クラスでメンテ性も高い
- 異論があれば §「Resolved Decisions」で記録し変更可能

### 5.4 検証段の grep（実装時に Claude が自前で実施）

- `grep -rn "デュエプレトラッカー\|ゲーム戦績トラッカー" src/` → 0 件であることを再確認（リブランド残骸チェック、本 Plan 範囲外だが整合性確認）
- `rg -n "<h1|Tierlog|TierlogLogo" src/app/auth/page.tsx`（`rg` が無ければ `grep -nE`）の出力を目視確認する。`<h1>` タグと `Tierlog` 文字列が別行に整形されていると固定パターンの「0 件」判定が誤って置換漏れなしと出るため、件数判定ではなく行表示で確認する。実装後の期待状態: 旧ブランド見出し `<h1 ...>Tierlog</h1>` が出力に現れない / `TierlogLogo` が import と JSX 使用の 2 行 / 残る `Tierlog` 文字列は `TierlogLogo` 参照・import パス由来のみ
- `grep -rn "TierlogLogo" src/` → `TierlogLogo.tsx` 定義と `auth/page.tsx` import の 2 箇所のみ

## 6. リスク・懸念点

### 6.1 ダーク背景での mark 中央段の見え方（既知のトレードオフ）

- mark 中央の path は `fill="#0f172a"`。ダークテーマ背景 `--background: #0f172a` と**完全に一致**するため、中央段は背景に溶け込み「白 stroke のみの中抜き」状態になる
- 視覚的には 3 段カードのうち中央が透ける形になるが、白 stroke で輪郭は維持されるため**意図的な装飾**と読める範囲
- ユーザー指示 D4「基本維持」に従いそのまま実装する。ライトテーマでは中央段が `#0f172a` の濃紺で明瞭、両テーマで mark のシルエットは保たれる
- 検証で「ダークで明らかに違和感」となった場合のみフォローアップ（中央段を `#1e293b` 等に調整、または `currentColor` 化）を別 Plan で検討

### 6.2 Geist フォントの解決

- `<text>` 要素は CSS フォントを参照可能だが、SSR 初回描画では Web フォント未ロード時に Inter / Arial にフォールバックする可能性
- `next/font/google` は font-display を制御するため大きな FOUT は起きにくい想定
- フォントが落ち着くまでロゴが微妙に揺れる可能性はあるが、ログイン画面の性質上致命的ではない
- 検証で著しいレイアウトシフトが見られた場合のみ、`font-display: optional` 化や fontSize 微調整を検討

### 6.3 ハイドレーション

- `useId()` はサーバ・クライアントで安定値を返すため、id 衝突や hydration mismatch は起きない見込み
- `"use client"` は付けない方針（純粋関数のため）

### 6.4 既存 lint 負債（auto-memory `tierlog-lint-debt.md` 参照）

- `npm run lint` は本 Plan の改修と無関係に既存負債で fail することがある
- 今回触れる **2 ファイル**（`src/components/brand/TierlogLogo.tsx` 新規 / `src/app/auth/page.tsx` 編集）に対してのみ `npx eslint <path>` でピンポイントに走らせる
- `npm run lint` 全体実行も行うが、fail した場合は出力差分を見て**今回起因 / 既存負債**を切り分けてユーザーに報告（CLAUDE.md「検証は Claude が自前で実施」方針に沿う）

### 6.5 サブコピーとの間隔

- 既存 `<h1>Tierlog</h1>` の自然な行間に対し、ロゴは高さ 40px の塊なのでサブコピーとの間隔感が変わる可能性
- 既存 `mt-2`（8px）はそのまま維持。実機目視で問題があれば微調整

## 7. 変更ファイル一覧

### 新規

- `src/components/brand/TierlogLogo.tsx`

### 編集

- `src/app/auth/page.tsx`（import 追加 1 行、見出しブロック差し替え）

### 触らない

§4 に列挙。特に:
- `public/brand/tierlog-logo-horizontal.svg`（静的 SVG ファイルは将来用途のため残す）
- `src/lib/games/index.ts` の `APP_BRAND` / `trackerName`
- `src/app/layout.tsx` の `SITE_NAME`

## 8. 検証方法

### 8.1 Claude が自前で実施

| 項目 | コマンド・手段 |
|---|---|
| 新規 / 編集 2 ファイルの ESLint | `npx eslint src/components/brand/TierlogLogo.tsx src/app/auth/page.tsx` |
| プロジェクト全体の lint | `npm run lint`（既存負債で fail する場合は今回起因か切り分けて報告）|
| TypeScript 型チェック | `npx tsc --noEmit`（auth page の prop / TierlogLogo の型整合）|
| インライン SVG の DOM 出力 | `curl -s https://dev-...workers.dev/auth \| grep -i 'viewbox="0 0 760 200"'` で SSR HTML 内に SVG が含まれるか確認 |
| dev preview push 後の自動デプロイ | Cloudflare Workers Builds が dev ブランチを自動ビルド（3〜5 分） |

### 8.2 ユーザー必須（実機ブラウザでないと判定不能）

- プレビュー URL `https://dev-duepure-tracker.jianrenzhongtian7.workers.dev/auth` を開く
- **ダークテーマ** で wordmark が読めるか / mark のシルエットに違和感がないか
- **ライトテーマ** で wordmark が `#0f172a` 相当の濃紺で表示されるか / mark 中央段が `#0f172a` で明瞭か
- モバイル幅（iPhone 標準 390px / Android 360px）でロゴが過剰に大きくないか
- サブコピーとの間隔が破綻していないか
- ハードリロードで Geist 未ロード時の初回表示も確認

## 9. ロールアウト手順

CLAUDE.md / AGENTS.md のフローに従う:

1. dev ブランチ上で本 Plan の §5 を実装
2. `git add src/components/brand/TierlogLogo.tsx src/app/auth/page.tsx docs/plans/2026-05-19_tierlog_login_horizontal_logo.md`（plan ファイルも Resolved Decisions 履歴ごと stage。`git add .` は禁止、対象明示）
3. `git commit -m "..."`（メッセージ案: `feat(auth): replace Tierlog heading with horizontal logo component`）
4. `git push origin dev` → Cloudflare が dev preview を自動ビルド（3〜5 分）
5. ユーザーが §8.2 を実機検証
6. OK 指示後、ユーザーの「本番反映」明示指示があってから `git checkout main && git merge dev && git push origin main`
7. 完了後 `git checkout dev` で dev に戻る

**main への直接 push は禁止**。ユーザー明示指示なしに main 操作は一切行わない。

## 10. Resolved Decisions

（plan-critic / AskUserQuestion で確定した判断はここに追記される）
