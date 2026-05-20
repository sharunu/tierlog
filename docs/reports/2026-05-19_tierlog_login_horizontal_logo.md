# Tierlog 横長ロゴをログイン画面に反映 — 完了報告

- 実施日: 2026-05-20（Plan 作成: 2026-05-19）
- 実装 commit: `2b51b64`（dev）
- 本番反映 commit: `13d2693`（`2b51b64` を `main` へ merge、`8873b28 → 13d2693`）
- 本番 URL: <https://tierlog.app/auth>
- Plan: `docs/plans/2026-05-19_tierlog_login_horizontal_logo.md`
- 関連 memory: [[tierlog-horizontal-logo-rollout]]

## 完了サマリー

| フェーズ | 内容 | 結果 |
|---|---|---|
| 1 | Plan 作成 + review-plan-loop で plan-critic 反復検証 | ✅ GO |
| 2 | Codex 外部レビュー（2 巡・計 4 指摘）を反映 | ✅ |
| 3 | コード実装（新規 1 + 編集 1 ファイル）| ✅ |
| 4 | 検証（ESLint / tsc / lint 切り分け / grep / 本番 curl）| ✅ |
| 5 | dev preview 検証（Claude 自前 + ユーザー実機）| ✅ |
| 6 | 本番反映（`13d2693`）、本番 SSR HTML 確認 | ✅ |
| 7 | 後日対応（共有ページ・OG画像）| 次フェーズ、memory 登録済 |

## コード変更範囲（2 ファイル + Plan、commit `2b51b64`）

- **新規** `src/components/brand/TierlogLogo.tsx` — 横長ロゴのインライン SVG React コンポーネント。`public/brand/tierlog-logo-horizontal.svg` のパス・transform・mark 色を忠実コピーし、wordmark のみ `fill="currentColor"` 化。props は `className` / `title` の 2 つ。`useId()` 由来 id の `<title>` + `aria-labelledby` + `role="img"` で a11y を提供。`<svg>` は width/height 属性なし・viewBox のみ。`"use client"` なし（純粋関数）。
- **編集** `src/app/auth/page.tsx` — `<h1 ...>Tierlog</h1>` 見出しを `<TierlogLogo className="mx-auto h-10 w-auto text-foreground" />` に置換、import 1 行追加。`<div className="text-center">` ラッパとサブコピー `<p>対戦記録・環境分析ツール</p>` は維持。
- `docs/plans/2026-05-19_tierlog_login_horizontal_logo.md` — Plan（レビュー反映後の最終版、同一 commit に同梱）

**変更対象外**: 共有ページ / OG画像 / home / battle / stats / BottomNav / account / terms / privacy / `src/lib/games` / `layout.tsx`、および既存 SVG 素材 `public/brand/tierlog-logo-horizontal.svg`（将来用途のため残置）。

## 確定方針（ユーザー指示）

| ID | 内容 |
|---|---|
| D1 | テーマ対応はインライン SVG の React コンポーネント化（`<img>` 方式・2 バリアント方式は不採用）|
| D2 | スコープはログイン画面 `/auth` のみ |
| D3 | wordmark は `currentColor` で `text-foreground` 追従 |
| D4 | mark 3 段の色（`#6366f1` / `#0f172a` / 白 stroke）は基本維持 |
| D5 | サブコピー「対戦記録・環境分析ツール」維持 |
| D6 | ロゴ高さ 40px（`h-10`）|
| D7 | a11y は `<title>` + `aria-labelledby` |

## 注目すべき出来事

### 1. review-plan-loop / plan-critic が初回未ロード（ディレクトリ取り違え）

作業を親ディレクトリ `~/Desktop/GitHub` で開始したため、project-local の `.claude/commands/` `.claude/agents/` が読み込まれず `/review-plan-loop`・`plan-critic` が使用不可だった。正しい `~/Desktop/GitHub/tierlog` でセッション再開後に解決。

### 2. Codex 外部レビュー 2 巡で計 4 指摘を反映

- **1 巡目**（review-plan-loop iter 3 に投入。plan-critic が実コードベース照合で全件 mechanical 判定 → 自動修正）:
  - `svg_sizing_inconsistency` — §5.1 の `width="100%"` 記述が実装例コード（viewBox のみ）と矛盾 → 「width/height 属性なし + viewBox のみ + 呼び出し側 `h-10 w-auto`」に統一
  - `a11y_api_ambiguity` — `aria-label` prop が未使用の dead prop → props を `title` 1 本に集約
  - `plan_file_commit_inconsistency` — §9 の `git add` に plan ファイルが含まれず → 追加（リポジトリ慣行どおり）
- **2 巡目**（loop GO 後に受領。ユーザー指示によりループを介さず直接修正）:
  - §5.4 の置換漏れ確認 grep `h1>Tierlog<` は、`<h1>` と `Tierlog` が別行整形だと実装前から 0 件＝誤検知 → 行表示で目視確認する方式に修正

### 3. ダークテーマでの mark 中央段（既知トレードオフ）

mark 中央 path の `fill="#0f172a"` はダークテーマ背景 `--background: #0f172a` と同色のため、中央段が背景に溶け白 stroke の輪郭のみになる。D4「mark 色は基本維持」のユーザー指示どおり実装し、ユーザー実機確認で「許容範囲」と判定。

### 4. サンドボックス下で再帰 grep が停止

検証中、サンドボックス環境で `grep -r`（再帰）が途中停止する事象。`dangerouslyDisableSandbox`（読み取り専用 grep のためリスクなし）で実行して回避。実装・commit には影響なし。

## 検証エビデンス

### Claude 自前検証

- `npx eslint src/components/brand/TierlogLogo.tsx src/app/auth/page.tsx` — exit 0、エラーなし
- `npx tsc --noEmit` — 出力なし、型エラーなし
- `npm run lint`（全体）— exit 1 だが出力は全て既存負債（`react-hooks/set-state-in-effect` / `no-unused-vars`）。今回の 2 ファイルは出力に不在 → **新規エラー 0**
- §5.4 grep — リブランド残骸 0 / `auth/page.tsx` の `<h1>` 置換済 / `TierlogLogo` 参照 3 箇所（定義 + import + 使用）

### 本番 SSR HTML 検証（`https://tierlog.app/auth`、デプロイ後）

```
curl -sS https://tierlog.app/auth | grep ...
  viewBox="0 0 760 200"
  fill="currentColor" style="font-family:var(--font-geist-sans), Inter, Arial, sans-serif" font-size="82" font-weight="800" letter-spacing="0">Tierlog<
```

→ インライン SVG ロゴ（viewBox / `currentColor` wordmark / Geist フォント）が本番 SSR HTML に出力されていることを確認。

### ユーザー実機検証（dev preview）

`https://dev-duepure-tracker.jianrenzhongtian7.workers.dev/auth` で確認、いずれも OK:
横長ロゴ表示 / ダークテーマで wordmark 可読 / mark 中央段の見え方は許容範囲 / ライトテーマ / モバイル幅で過大でない・サブコピーとの間隔。

## 後日対応（次フェーズ）

memory [[tierlog-horizontal-logo-rollout]] に登録済:

- 共有ページ `src/app/share/[id]/page.tsx` の header へのロゴ反映 — 背景 `bg-slate-950` 固定（テーマ非追従）への色対応、`gameMeta.trackerName` との二重ブランディング回避が必要
- OG画像（`src/app/api/og/[id]/route.tsx` の `next/og` `ImageResponse`）へのロゴ反映 — Satori の外部 SVG / CSS 変数フォント制約への対応が必要、別 plan 推奨

## review-plan-loop 履歴

計 4 反復で GO 到達（judgment escalation は全反復 0 件）:

- iter 1: NO-GO — mechanical 2（`line_number_reference_drift`：行番号参照のドリフト / `title_id_value_inconsistency`：a11y id 指定の不整合）→ 自動修正
- iter 2: ✅ GO
- （Codex 1 巡目レビューを投入）
- iter 3: NO-GO — mechanical 3（`svg_sizing_inconsistency` / `a11y_api_ambiguity` / `plan_file_commit_inconsistency`）→ 自動修正
- iter 4: ✅ GO

Codex 2 巡目（§5.4 grep）は loop GO 後の受領のため、ループを介さず直接修正してから実装着手。

## 参照

- Plan: `docs/plans/2026-05-19_tierlog_login_horizontal_logo.md`
- ロゴ素材: `public/brand/tierlog-logo-horizontal.svg`
- 前段タスク: `docs/reports/2026-05-19_tierlog_rebrand.md`（ブランドリネーム本体）
- 関連 memory: [[tierlog-horizontal-logo-rollout]] — 横長ロゴの次フェーズ反映先（共有ページ・OG画像）
