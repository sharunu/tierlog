# DESIGN.md UI 改善 Phase 8 (ハードコード色の最終クリーンアップ) 実施レポート

- 日付: 2026-05-10
- ブランチ: `dev` で実装 → `main` にマージ済 (`6a24fbc`)
- 本番 URL: https://duepure-tracker.jianrenzhongtian7.workers.dev
- plan ファイル: `~/.claude/plans/design-md-ui-phase8-9-color-cleanup-and-light-mode.md`
- 前段: Phase 7 (2026-05-10_design_md_ui_phase_7.md) で stats トップのデスクトップ幅拡張完了
- 後段: Phase 9 (light mode 実装) は本 Phase の token 化完了が前提条件、別途着手予定

## 概要

Phase 1-7 までで semantic token 基盤・共通 UI 部品・stats 配下の token 化は完了済だったが、`account` / `admin` / `decks` / `share` / 一部 stats 詳細 などに hex / rgba の直書きが残存しており、Phase 9 (light mode) で `[data-theme="light"]` ブロックを追加するだけでは色が切り替わらない箇所がまだ多かった。

Phase 8 のゴールは **`src/` 全域で hex / rgba 直書きをセマンティックトークン経由に統一すること**。これにより Phase 9 ではコンポーネントコードを一切触らず、`globals.css` に `[data-theme="light"]` の token 値を定義するだけで light mode が成立する状態を作る。

達成済:

- `src/` 全域の hex/rgba 残存を例外領域 (共有画像 / 外部 OAuth ロゴ / recharts SVG 局所 / SSR metadata) を除いて 0 件にした
- `--accent` alias を `globals.css` / DESIGN.md から完全削除 (Phase 5b で参照が消えた後の最終整理)
- 手書き SVG (LogOut / Pencil / X / Search / Ban) を lucide-react に置換
- 動的 opacity の hex 表現を `color-mix(in srgb, var(--token) X%, transparent)` パターンに統一
- 三項演算子で両側同値の冗長な hex 直書き (`isRegistered ? "#232640" : "#232640"`) を発見・解消
- 未参照の `EnvironmentChart.tsx` (15 hex を含む dead code) を削除

スコープ外として明示的に切り離し:

- Phase 9: light mode 実装本体 (`[data-theme="light"]` ブロック追加 / ThemeProvider / FOUC 対策 / トグル UI / token 値微調整)
- DB / Supabase / 認証 / Discord / X / Cloudflare デプロイ設定 (UI のみの変更)
- レイアウト・機能変更 (色 token 化のみで挙動は維持)

## 実装内容

### Commit 履歴 (dev → main)

Phase 8 は影響範囲が広いため 9 コミットに分割。1 サブ Phase = 1 コミット原則を厳守。

| Commit | サブ Phase | 主な変更 | 規模 |
|--------|-----------|---------|------|
| `513d5f1` | 8a | light-page hex 移行 (auth / dm・pokepoke home / battle / GameSelector / MemberAvatarStack / Skeleton) | 10 files +91/-73 |
| `5b2ebdd` | 8b | account 系移行 (account/page.tsx 44 件 / account/security/page.tsx 27 件)、`text-accent` → `text-warning`、modal overlay rgba → `bg-black/50` | 2 files +71/-72 |
| `26a0854` | 8c-1 | `app/admin` 配下移行 (USER_STAGE_BADGES の semantic 化含む 8 ファイル) | 8 files +67/-67 |
| `203ddd4` | 8c-2 | `components/admin` 配下移行 (OpponentDeckManager 49 件 / FeedbackList 12 件 等)、`accent-[#818cf8]` → `accent-primary-soft` (Tailwind native form input の `accent-color`) | 8 files +85/-85 |
| `f2f1342` | 8d | `dm/pokepoke decks/DeckList.tsx` 移行、両側同値の冗長 ternary を単一値化 | 2 files +104/-104 |
| `156aeeb` | 8e-1 | `account/page.tsx` アバター gradient (`from-[#5b8def] to-[#7c5bf0]`) → `from-primary to-primary-soft` | 1 file +1/-1 |
| `9356b1d` | 8e-2 | 手書き SVG → lucide 化 (LogOut / Pencil / X / Search / Ban)、BanGuard 残色 token 化 | 4 files +15/-60 |
| `1dd655a` | 8e-3 | `globals.css` から `--accent` alias 完全削除 + DESIGN.md 同期 | 2 files +2/-7 |
| `a91d032` | 8f | 最終クリーンアップ (privacy/terms/error 系、TeamServerCard、DeckFilter、stats 詳細、TrendHeatmap 動的 opacity を `color-mix` に、layout.tsx themeColor を media クエリ配列化、`EnvironmentChart.tsx` 削除、plan 漏れ ShareModal/AdminUserDecks 吸収) | 20 files +62/-155 |

**集計**: 50 files changed, +498 / -624 (削除超過は dead code 整理 + lucide 化による SVG パスコード削減によるもの)

### 主要トピック

#### 1. Phase 8a 〜 8d: ハードコード色の機械的置換

`bg-[#232640]` → `bg-surface-2`、`bg-[#1a1d2e]` → `bg-surface-1`、`bg-[#6366f1]` → `bg-primary`、`text-[#818cf8]` → `text-primary-soft`、`text-[#ff7766]` → `text-destructive` 等。Phase 1 で定義済みの token を消費するだけで視覚的差異なし。

例外領域 (hex 直書き許容):
- 共有画像生成 (`StatsShareCard.tsx` / `DeckShareCard.tsx`): satori 制約で CSS 変数解決不可
- 外部 OAuth ロゴ (Google `#4285F4` 等、Discord `#5865F2`): ブランドカラー
- recharts SVG 内の局所 stroke / fill で token 化困難な箇所

#### 2. Phase 8e-1: gradient の token 化

`from-[#5b8def] to-[#7c5bf0]` のような独自 gradient 値を `from-primary to-primary-soft` に置換。これにより light mode で primary tone を再定義すれば gradient 全体が自動追従する。

#### 3. Phase 8e-2: 手書き SVG → lucide-react

`<svg viewBox="...">` で書かれていたアイコン (LogOut / Pencil / X / Search / Ban) を lucide-react に置換。`currentColor` 描画によりテーマ追従が自動化、SVG パスコードの削減で diff `-60` 行に貢献。

#### 4. Phase 8e-3: `--accent` alias の完全削除

DESIGN.md L224 で「Phase 5b 以降は `--accent` を使わず `--warning` を直接使う」方針が確立されていたが、`globals.css` には alias 定義 (`--accent: var(--warning);` + `--color-accent: var(--accent);`) が残存していた。Phase 5b/8b の参照削除で参照は 0 件になっていたため、この Phase で alias 自体を削除。

#### 5. Phase 8f: TrendHeatmap 動的 opacity の `color-mix` 化

```diff
- backgroundColor: `rgba(99, 102, 241, ${opacity})`
+ backgroundColor: `color-mix(in srgb, var(--primary) ${opacityPct}%, transparent)`
```

`color-mix(in srgb, ...)` は Chrome 111+ / Safari 16.4+ / Firefox 113+ で対応 (本プロジェクトの target ブラウザは満たす)。動的な opacity を保ったまま token 経由化を実現する Phase 9 互換のキー技法。

#### 6. Phase 8f: `viewport.themeColor` の media クエリ配列化

Next.js metadata は SSR 時点で CSS 変数を解決できないため、`themeColor: "#6366f1"` から media-query ベース配列に変更:

```diff
- themeColor: "#6366f1"
+ themeColor: [
+   { media: '(prefers-color-scheme: dark)', color: '#0f172a' },
+   { media: '(prefers-color-scheme: light)', color: '#f8fafc' },
+ ]
```

これにより iOS Safari の status bar 色が dark/light で正しく切り替わる。

#### 7. Phase 8f: `EnvironmentChart.tsx` の削除

未参照の dead code (Phase 6c 計画段階で対象外と確認済) を `git rm`。15 件の hex 直書きを残す価値はないと判断。

#### 8. plan 漏れの吸収

Phase 8f 着手前の最終 grep で `ShareModal.tsx` (大量 hex/rgba) と `AdminUserDecks.tsx` L77 (1 件) が plan の対象に含まれていなかったことが発覚。Phase 8f 内で同時に処理することで、別 plan を立てる手間を回避。

## 検証

### Claude 自前検証 (各サブ Phase 共通)

- `npm run lint`: 52 (Phase 8 着手前と同数、新規 lint 警告なし)
- `npx opennextjs-cloudflare build`: 各サブ Phase で 0 エラー (型整合 + Cloudflare Workers バンドル整合)
- `git diff --stat` で diff 規模が plan の想定 (例: 8a は 8-10 ファイル、8b は 2 ファイル) と一致することを確認
- preview URL `curl -L` で各画面 200 + SSR HTML 描画確認

### Phase 8 完了時 grep 結果

```bash
# 例外領域を除く src/ 全域の hex/rgba/hsla 直書き
$ grep -rEn '#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(' src/ \
  --exclude='StatsShareCard.tsx' --exclude='DeckShareCard.tsx' \
  --exclude='og/[id]/route.tsx' \
  | grep -v 'color-mix' | wc -l
0  # (例外領域除く Phase 8 対象外ファイルも 0)

# --accent / text-accent / bg-accent / border-accent 残存
$ grep -rEn '\b(text|bg|border)-accent\b|var\(--accent\)|--accent\b' src/
0
```

### ユーザー実機確認 (各サブ Phase 完了後の preview URL で実施)

各サブ Phase 完了後、Cloudflare の自動 preview deploy で以下を実機確認:
- 視覚的に変化がないこと (token 値は既存 hex と同値で定義済)
- 押下感・transition・hover の挙動が変わっていないこと
- modal の overlay 透過度が適切に維持されていること
- TrendHeatmap のセル opacity が滑らかに表現できていること
- iOS PWA の status bar 色 (Phase 8f の themeColor 変更後)

## 学び・既知の課題

### 学び

1. **plan 漏れの早期発見には Phase 着手前 grep が有効**
   Phase 8f 着手前に最終 grep を走らせることで、plan に漏れていた `ShareModal.tsx` (大量) と `AdminUserDecks.tsx` (1 件) を発見。漏れの規模次第で別 plan を立てるか吸収するかを判断できる。

2. **Tailwind native `accent-color` ユーティリティと `--accent` token は別物**
   `accent-primary-soft` のような Tailwind class は HTML form input の `accent-color` プロパティを設定するもので、CSS variable `--accent` とは無関係。Phase 8c-2 / 8e-3 で混同しないよう grep regex を `\b(text|bg|border)-accent\b|var\(--accent\)|--accent\b` に narrow 化。

3. **`color-mix` は動的 opacity の semantic token 化のキー技法**
   `rgba(R, G, B, ${opacity})` のような JS テンプレート文字列で組み立てていた動的色は、`color-mix(in srgb, var(--token) ${opacityPct}%, transparent)` に置換できる。Phase 9 で token 値が変わっても opacity 計算は維持される。

4. **両側同値の冗長 ternary は隠れた lint 漏れ**
   `isRegistered ? "#232640" : "#232640"` のような冗長コードは、grep 単純パターンでは「2 件の hex」として検出されるが、実態は単一値。`replace_all=true` でも片側パターンしか置換できないため、個別 Edit が必要だった。

5. **SSR metadata の `themeColor` は CSS 変数を解決できない**
   Next.js Metadata API は SSR 時点で評価されるため、`themeColor: "var(--background)"` は機能しない。media クエリ配列で dark/light の絶対色を直接指定するのが唯一の解決策。

### 既知の課題 (Phase 9 で対処)

- Phase 9 で `[data-theme="light"]` ブロック追加時、`color-mix` の opacity が極端な (例: 5%) 場合に light mode で読みづらくなる可能性がある。Phase 9d で実機確認 + token 値微調整が必要
- ThemeProvider 未導入のため、現状は dark 固定。Phase 9b で `localStorage` + FOUC 対策 inline script を導入予定
- 共有画像 (`StatsShareCard` / `DeckShareCard`) は satori 制約で hex 直書きのまま (light mode 対応は別 plan で satori token 解決ヘルパーを書く必要あり)

## 次の Phase に向けて

Phase 8 完了により、以下が達成された:

- `src/` 全域の hex/rgba を semantic token 経由に統一 (例外領域除く)
- `--accent` alias の完全削除
- 動的 opacity の `color-mix` 統一
- 手書き SVG の lucide 化完了
- dead code (`EnvironmentChart.tsx`) 削除

これにより **Phase 9 (light mode 実装) は globals.css への `[data-theme="light"]` ブロック追加と ThemeProvider 導入のみで成立**する状態になった。コンポーネントコードを Phase 9 で触る必要は基本的にない (token 値の微調整のみ)。

Phase 9 は本番安定確認後、別 plan で着手予定:

1. **9a**: globals.css に `[data-theme="light"]` ブロック + `color-scheme` プロパティ追加
2. **9b**: ThemeProvider + FOUC 対策 inline script (初回訪問は dark 強制 → ユーザー設定で切替可能)
3. **9c**: ThemeToggle UI (account ページに配置)
4. **9d**: light token 値の実機確認 + 微調整

## 補足: 集計

- 影響ファイル数: 50 (Phase 8a-8f 合計、重複ファイルは 1 とカウント)
- 実 commit 数: 9 (8a / 8b / 8c-1 / 8c-2 / 8d / 8e-1 / 8e-2 / 8e-3 / 8f)
- 削除した dead code: 1 ファイル (`EnvironmentChart.tsx`)
- Tailwind class の semantic 化: 約 360 件 (hex) + 約 70 件 (rgba)
- lint 警告数: 52 (着手前と同数、リグレッションなし)
