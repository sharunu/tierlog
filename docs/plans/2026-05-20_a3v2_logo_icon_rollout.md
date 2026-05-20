# A3 v2 タイトルロゴ / アプリアイコン 反映 plan

- 作成日: 2026-05-20
- ブランチ: `dev`（`main` 直 push 禁止）
- ステータス: **plan のみ。コード編集・ファイル変更は未実施。** `/review-plan-loop` → Codex レビュー → OK 後に実装。
- 確定済み判断: アプリ内ロゴのワードマークは **テーマ追従色（`currentColor`）** で描画する（2026-05-20 ユーザー選択 / Option 1）。

---

## 1. ゴール

Codex 作成済みの A3 v2 候補アセットを実アプリへ反映する。

1. アプリ内タイトルロゴ（`TierlogLogo` コンポーネント）を A3 v2 デザインへ差し替える。
2. PWA / manifest / apple touch icon / favicon / metadata のアプリアイコンを A3 v2 へ差し替える。
3. 既存の参照ファイル名（canonical 名）を維持し、v2 はそこへ上書きコピー／再生成する。

### やりたいこと対応表

| # | ユーザー要望 | 対応 |
|---|---|---|
| 1 | アプリ内タイトルロゴを A3 v2 へ | Part B（`TierlogLogo.tsx` を v2 へ全面書き換え） |
| 2 | PWA/manifest/apple-touch/favicon/metadata アイコンを A3 v2 へ | Part A（マスター SVG 上書き＋生成スクリプト実行） |
| 3 | 参照ファイル名を保ち v2 を canonical 名へコピー/置換 | Part A の方針。`layout.tsx`/`manifest.json` は**変更不要** |
| 4 | `TierlogLogo.tsx`（インライン SVG）の更新要否 | **要更新**（現状は旧デザイン。Part B で v2 へ書き換え） |
| 5 | `manifest.json` と `layout.tsx` の icons 設定確認 | **確認済み・変更不要**（§5 参照） |
| 6 | 検証項目 | §7 検証 |

---

## 2. 調査済みの現状（事実確認）

### 2-1. アプリ内ロゴ
- `src/components/brand/TierlogLogo.tsx`（全 57 行）はインライン SVG コンポーネント。`viewBox="0 0 760 200"`、旧 3 層マーク＋`<text fill="currentColor">`。
- 使用箇所は **`src/app/auth/page.tsx` の 1 箇所のみ**:
  - 9 行目 `import { TierlogLogo } from "@/components/brand/TierlogLogo";`
  - 132 行目 `<TierlogLogo className="mx-auto h-10 w-auto text-foreground" />`
- `tierlog-logo-horizontal*.svg` / `tierlog-mark*` をコードから参照している箇所は無い（`TierlogLogo.tsx:9` のコメントのみ）。

### 2-2. アイコン生成パイプライン
- `scripts/generate-pwa-icons.mjs`（全 62 行）が存在。`sharp` で SVG マスターから生成する:
  - マスター: `public/icons/icon.svg`, `public/brand/tierlog-mark.svg`
  - 生成物: `public/icons/apple-touch-icon.png`(180) / `icon-192x192.png` / `icon-512x512.png` / `public/brand/tierlog-mark-1024.png`(1024) / `src/app/favicon.ico`（16/32/48 のマルチ解像度 ICO）
  - 実行コマンド: `npx --yes --package=sharp@^0.33 -- node scripts/generate-pwa-icons.mjs`
- ローカル: Node v22.16.0。`sharp` はプロジェクト依存に未登録（スクリプトが `npx --package` で都度取得）。ImageMagick 無し、`sips`（macOS 標準）のみ。

### 2-3. metadata / manifest（現状の参照先）
- `src/app/layout.tsx` 31〜37 行 `icons`:
  - `icon: [{ url: "/favicon.ico" }, { url: "/icons/icon.svg", type: "image/svg+xml" }]`
  - `apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" }]`
  - 30 行 `manifest: "/manifest.json"`
- `public/manifest.json` 10〜23 行 `icons`: `/icons/icon-192x192.png` と `/icons/icon-512x512.png`（いずれも `"purpose": "any maskable"`）。
- favicon 実体は **`src/app/favicon.ico`**（Next.js App Router の規約ファイル / 既に commit 済 / 2281 bytes）。`public/favicon.ico` は存在しない。
- → **参照先はすべて canonical 名。v2 を canonical 名へ上書きすれば `layout.tsx`・`manifest.json` の編集は不要。**

### 2-4. Service Worker
- `public/sw.js`: `CACHE_NAME = "tierlog-v1"`。precache は `/manifest.json` のみ。png/svg/ico は fetch ハンドラで **network-first** ランタイムキャッシュ。

### 2-5. OG 画像
- `src/app/api/og/[id]/route.tsx` はロゴ／マークを埋め込んでいない（テキスト＋グラフのみ）→ 本作業の影響なし。
- 共有ページ header・OG 画像へのロゴ反映は「次フェーズ」（メモ `tierlog-horizontal-logo-rollout` 記載）→ **本 plan のスコープ外**。

### 2-6. A3 v2 候補アセット（Codex 作成済 / 全 18 ファイルが git 未追跡 `??`）
v1（`-a3`）9 ファイル＋v2（`-a3-v2`）9 ファイル。v2 の SVG マスター 3 種を確認済み:
- `public/brand/tierlog-logo-horizontal-a3-v2.svg`: `viewBox="0 0 760 200"`（現行と同一）。カードファン型マーク（teal/blue/violet/front の 4 グラデ＋lines グラデ＋word グラデ＋影フィルタ 2 種）。マークは `translate(5 11) scale(0.36)`。ワードマーク `<text x="170" y="127" font-size="88" font-weight="900">`、塗りは `url(#…-word)`（**濃紺→青の固定グラデ＝明背景前提**）。
- `public/icons/icon-a3-v2.svg`: `viewBox="0 0 1024 1024"`。濃紺角丸背景＋カードファン。アプリアイコン用フルブリード。
- `public/brand/tierlog-mark-a3-v2.svg`: `viewBox="0 0 512 512"`。背景なし（透過）のカードファン。

---

## 3. スコープ

### 対象
- `src/components/brand/TierlogLogo.tsx`（ロゴを v2 へ）
- `public/icons/icon.svg`・`public/brand/tierlog-mark.svg`・`public/brand/tierlog-logo-horizontal.svg`（マスター SVG を v2 へ上書き）
- 生成物: `public/icons/apple-touch-icon.png` / `icon-192x192.png` / `icon-512x512.png`、`public/brand/tierlog-mark-1024.png`、`src/app/favicon.ico`（スクリプトで再生成）
- 未追跡 v1/v2 候補ファイル 18 個の整理（削除）

### 対象外（今回触らない）
- `src/app/auth/page.tsx`（ロゴ呼び出しは現状維持。レイアウト変更なし）
- `src/app/layout.tsx` / `public/manifest.json` の icons 設定（canonical 名のまま＝編集不要）
- 共有ページ header・OG 画像へのロゴ反映（次フェーズ）
- `manifest.json` の `theme_color`(`#6366f1`) / `background_color`、`layout.tsx` の `viewport.themeColor` の v2 パレット調整（要望は「icons」設定。色調整は scope 外。§8-注記）
- 認証フロー関連（`client.ts` / `middleware.ts` / `auth/callback`）— 本作業は表示資産のみで一切触れない

---

## 4. 採用方針（決定事項）

### 4-1. アイコン: マスター SVG 上書き＋生成スクリプト方式
v2 候補の事前レンダリング済み PNG を各 canonical 名へ手コピーするのではなく、**マスター SVG（`icon.svg` / `tierlog-mark.svg`）を v2 で上書きし `generate-pwa-icons.mjs` を実行**する。

理由:
- `favicon.ico` は v2 候補に `.ico` が無く（`favicon-a3-v2-32x32.png` のみ）、ローカルに ICO 変換ツール（ImageMagick 等）も無い。スクリプトは ICO を自前生成するため、**favicon.ico を正しく v2 化するにはスクリプト実行が必須**。
- スクリプトを動かす以上、`icon.svg` は v2 である必要がある。同じマスターから 192/512/apple も生成すれば全アイコンの整合が保証される。
- リポジトリ既定のパイプラインに沿う。
- canonical ファイル名が完全に保たれ、要望 #3 を満たす。

### 4-2. ロゴ: `TierlogLogo.tsx` を v2 デザインのインライン SVG へ全面書き換え
`<img>` 参照ではなくインライン SVG を採用する。理由:
- ワードマークの Geist フォントを `var(--font-geist-sans)` で確実に適用するため（`<img>` 内 SVG はページの `@font-face` を読めず代替フォントになる）。
- ワードマークを `currentColor` でテーマ追従させるため（ユーザー確定方針）。

**ワードマークの扱い（確定）**: v2 のカードファン型マーク（グラデーション・影）は忠実に再現。「Tierlog」文字のみ v2 の `word` グラデーションを使わず `fill="currentColor"` とし、`text-foreground` 経由でテーマ追従（ダーク=明色／ライト=濃色）させる。ログイン画面のレイアウト変更なし。
- 文字グラデーションはアプリ内では再現しないが、ブランド SVG ファイル（`tierlog-logo-horizontal.svg`）には v2 のまま残るため、明背景用途では引き続き利用可能。

---

## 5. 変更対象ファイル一覧

| ファイル | 操作 | 追跡状態 |
|---|---|---|
| `public/icons/icon.svg` | v2 内容で上書き（`icon-a3-v2.svg` をコピー） | 追跡済→変更 |
| `public/brand/tierlog-mark.svg` | v2 内容で上書き（`tierlog-mark-a3-v2.svg` をコピー） | 追跡済→変更 |
| `public/brand/tierlog-logo-horizontal.svg` | v2 内容で上書き（`tierlog-logo-horizontal-a3-v2.svg` をコピー / ブランド資産整合用） | 追跡済→変更 |
| `public/icons/apple-touch-icon.png` | スクリプトで再生成 | 追跡済→変更 |
| `public/icons/icon-192x192.png` | スクリプトで再生成 | 追跡済→変更 |
| `public/icons/icon-512x512.png` | スクリプトで再生成 | 追跡済→変更 |
| `public/brand/tierlog-mark-1024.png` | スクリプトで再生成 | 追跡済→変更 |
| `src/app/favicon.ico` | スクリプトで再生成 | 追跡済→変更 |
| `src/components/brand/TierlogLogo.tsx` | v2 デザインへ全面書き換え | 追跡済→変更 |
| 未追跡候補 18 ファイル（§6 Part C） | 削除 | 未追跡→削除 |
| `public/sw.js` | （任意）`CACHE_NAME` を `tierlog-v2` へ | 追跡済→変更（任意） |

**編集しない（確認のみ）**: `src/app/layout.tsx`、`public/manifest.json`、`src/app/auth/page.tsx`。

---

## 6. 作業手順

> 実装は Codex レビュー OK 後。すべてローカル `~/Desktop/GitHub/tierlog`、`dev` ブランチ上で実施。

### Part A — アプリアイコン / PWA / favicon

**A-1〜A-3. マスター SVG を v2 内容で上書き**
```bash
cp public/icons/icon-a3-v2.svg                       public/icons/icon.svg
cp public/brand/tierlog-mark-a3-v2.svg               public/brand/tierlog-mark.svg
cp public/brand/tierlog-logo-horizontal-a3-v2.svg    public/brand/tierlog-logo-horizontal.svg
```

**A-4. PWA アイコン／favicon を再生成**
```bash
npx --yes --package=sharp@^0.33 -- node scripts/generate-pwa-icons.mjs
```
→ `apple-touch-icon.png` / `icon-192x192.png` / `icon-512x512.png` / `tierlog-mark-1024.png` / `src/app/favicon.ico` が v2 から再生成される。

**A-5. `layout.tsx` / `manifest.json` の確認（編集なし）**
- 参照先がすべて canonical 名（`/favicon.ico`, `/icons/icon.svg`, `/icons/apple-touch-icon.png`, `/icons/icon-192x192.png`, `/icons/icon-512x512.png`）であることを再確認し、**編集不要**であることを実装報告に明記する。

### Part B — アプリ内タイトルロゴ

**B-1. `src/components/brand/TierlogLogo.tsx` を v2 デザインへ書き換え**

方針:
- `viewBox="0 0 760 200"` は維持（`width`/`height` 属性は付けない。サイズは呼び出し側 `className` で指定）。
- v2 ロゴ SVG（`tierlog-logo-horizontal-a3-v2.svg`）のマーク（カードファン）部分を忠実に移植。
- `<defs>` の全 ID（teal/blue/violet/front/lines グラデ＋影フィルタ）は `useId()` で接頭辞付与し、複数描画時の ID 衝突を防止。
- ワードマークは v2 の `word` グラデと `word-shadow` フィルタを**使わず**、`<text fill="currentColor">` で描画（`fontSize=88` / `fontWeight=900` / `fontFamily: var(--font-geist-sans), …`）。
- `role="img"` + `<title>`（アクセシブルネーム）を維持。コメントを A3 v2 由来へ更新。

書き換え後の想定コード（実装時の最終確定版）:
```tsx
import { useId } from "react";

type Props = {
  className?: string;
  // SVG <title> の内容（アクセシブルネーム）。デフォルト "Tierlog"
  title?: string;
};

// Tierlog 横長ロゴ（インライン SVG / A3 v2 デザイン）。元素材: public/brand/tierlog-logo-horizontal.svg
// カードファン型マークは v2 のグラデーション/影を忠実再現する。
// wordmark は currentColor で親の text 色に追従（ダーク=明色 / ライト=濃色）。
// <svg> には width/height を付けず viewBox のみ。サイズは呼び出し側 className（h-* + w-auto）で指定する。
export function TierlogLogo({ className, title = "Tierlog" }: Props) {
  const uid = useId();
  const id = (key: string) => `${uid}-${key}`;

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 760 200"
      role="img"
      aria-labelledby={`${uid}-title`}
      preserveAspectRatio="xMidYMid meet"
      className={className}
    >
      <title id={`${uid}-title`}>{title}</title>
      <defs>
        <linearGradient id={id("teal")} x1="76" y1="126" x2="252" y2="372" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#3fe6d2" />
          <stop offset="1" stopColor="#0c7fa5" />
        </linearGradient>
        <linearGradient id={id("blue")} x1="126" y1="98" x2="300" y2="354" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#2f7cff" />
          <stop offset="1" stopColor="#143aa3" />
        </linearGradient>
        <linearGradient id={id("violet")} x1="228" y1="112" x2="382" y2="360" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#7a6cff" />
          <stop offset="1" stopColor="#3a2a90" />
        </linearGradient>
        <linearGradient id={id("front")} x1="180" y1="86" x2="350" y2="364" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#102958" />
          <stop offset="0.56" stopColor="#0b1b40" />
          <stop offset="1" stopColor="#06112d" />
        </linearGradient>
        <linearGradient id={id("lines")} x1="214" y1="268" x2="308" y2="330" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#3fe6d2" />
          <stop offset="0.5" stopColor="#38bdf8" />
          <stop offset="1" stopColor="#6d5dfc" />
        </linearGradient>
        <filter id={id("shadow")} x="-20%" y="-20%" width="140%" height="150%" colorInterpolationFilters="sRGB">
          <feDropShadow dx="0" dy="6" stdDeviation="6" floodColor="#020617" floodOpacity="0.15" />
        </filter>
      </defs>
      <g transform="translate(5 11) scale(0.36)" filter={`url(#${id("shadow")})`}>
        <rect x="90" y="139" width="156" height="238" rx="25" fill={`url(#${id("teal")})`} stroke="#fbfdff" strokeWidth="9" transform="rotate(-15 168 258)" />
        <rect x="135" y="112" width="158" height="247" rx="25" fill={`url(#${id("blue")})`} stroke="#fbfdff" strokeWidth="9" transform="rotate(-7 214 236)" />
        <rect x="223" y="122" width="158" height="247" rx="25" fill={`url(#${id("violet")})`} stroke="#fbfdff" strokeWidth="9" transform="rotate(9 302 246)" />
        <g transform="rotate(4 262 228)">
          <rect x="171" y="88" width="184" height="274" rx="27" fill={`url(#${id("front")})`} stroke="#fbfdff" strokeWidth="9" />
          <path fill="#ffffff" d="M214 187l25 23 23-51 24 51 26-23-11 71h-76l-11-71z" />
          <rect x="228" y="269" width="70" height="10" rx="5" fill="#f8fbff" opacity="0.96" />
          <rect x="215" y="299" width="96" height="11" rx="5.5" fill={`url(#${id("lines")})`} />
          <rect x="224" y="329" width="78" height="11" rx="5.5" fill={`url(#${id("lines")})`} opacity="0.9" />
          <rect x="236" y="359" width="55" height="11" rx="5.5" fill={`url(#${id("lines")})`} opacity="0.78" />
          <path fill="#ffffff" opacity="0.06" d="M180 99h166v58L180 251V99z" />
        </g>
      </g>
      <text
        x="170"
        y="127"
        fill="currentColor"
        style={{ fontFamily: "var(--font-geist-sans), Inter, Arial, Helvetica, sans-serif" }}
        fontSize="88"
        fontWeight="900"
        letterSpacing="0"
      >
        Tierlog
      </text>
    </svg>
  );
}
```

**B-2. `src/app/auth/page.tsx` — 変更なし**
- `<TierlogLogo className="mx-auto h-10 w-auto text-foreground" />` のまま。`text-foreground` がワードマークの `currentColor` を駆動。
- `viewBox` 不変のため `h-10 w-auto` の描画フットプリントは現状と同等。最終的な見え方は §7 のビジュアル確認で担保。

### Part C — 候補ファイルの整理（クリーンアップ）

A・B の検証完了後、未追跡（`??`）の v1/v2 候補 18 ファイルを削除し作業ツリーを canonical のみに戻す。すべて未追跡＝git 履歴に影響なし。v2 の内容は canonical ファイルに取り込み済み（commit される）。

削除対象:
- v1（`-a3`）9: `public/brand/tierlog-logo-horizontal-a3.{svg,png}`, `public/brand/tierlog-mark-a3.svg`, `public/brand/tierlog-mark-a3-1024.png`, `public/icons/icon-a3.svg`, `public/icons/icon-a3-192x192.png`, `public/icons/icon-a3-512x512.png`, `public/icons/apple-touch-icon-a3.png`, `public/icons/favicon-a3-32x32.png`
- v2（`-a3-v2`）9: `public/brand/tierlog-logo-horizontal-a3-v2.{svg,png}`, `public/brand/tierlog-mark-a3-v2.svg`, `public/brand/tierlog-mark-a3-v2-1024.png`, `public/icons/icon-a3-v2.svg`, `public/icons/icon-a3-v2-192x192.png`, `public/icons/icon-a3-v2-512x512.png`, `public/icons/apple-touch-icon-a3-v2.png`, `public/icons/favicon-a3-v2-32x32.png`

注: v2 PNG を commit 済みブランド資産として残したい意向があればレビュー時に指摘。残す場合は canonical 名へリネームして追跡対象にする。

**C-任意. `public/sw.js`**: `CACHE_NAME` を `tierlog-v1` → `tierlog-v2` へ。静的資産は network-first のため必須ではないが、旧アイコンのキャッシュエントリを次回 activate で確実に破棄できる。

### コミット / デプロイ
1. `git add` 対象: 変更された canonical ファイル（`icon.svg`, `tierlog-mark.svg`, `tierlog-logo-horizontal.svg`, `apple-touch-icon.png`, `icon-192x192.png`, `icon-512x512.png`, `tierlog-mark-1024.png`, `src/app/favicon.ico`）＋ `TierlogLogo.tsx`（＋任意で `sw.js`）。18 候補は未追跡のため削除＝差分に出ない。
2. `git commit` → `git push origin dev`。
3. Cloudflare が dev プレビューをビルド（3〜5 分）。
4. `https://dev-duepure-tracker.jianrenzhongtian7.workers.dev` でユーザー確認。
5. ユーザーの「本番反映」明示指示後に `main` へ merge・push。

---

## 7. 検証方法

### 7-1. Claude が自前で実施（ブラウザ不要）
- **lint**: `npm run lint` がパスする。
- **manifest JSON 妥当性**: `node -e "JSON.parse(require('fs').readFileSync('public/manifest.json','utf8'))"`。
- **生成 PNG の寸法**: `sips -g pixelWidth -g pixelHeight` で `apple-touch-icon.png`=180、`icon-192x192.png`=192、`icon-512x512.png`=512、`tierlog-mark-1024.png`=1024 を確認。
- **favicon.ico**: `file src/app/favicon.ico` が `MS Windows icon resource` を返し、16/32/48 を含むことを確認。
- **再生成 PNG の品質比較**: スクリプト生成の PNG と Codex 事前レンダリング PNG（`-a3-v2`）を Claude が目視比較し、グラデーション・`feDropShadow` の sharp(librsvg) レンダリングが忠実か確認（候補削除前に実施）。
- **favicon 16px 可読性**: 再生成された 16px favicon を目視し、v2 アイコンの細部（カードファン＋クラウン＋ログ線）が潰れて識別不能になっていないか確認。
- **maskable セーフゾーン**: `icon-192x192.png` / `icon-512x512.png` でカードファン本体が中央 80% セーフゾーン内に収まり、OS マスクで主要要素が欠けないか確認（縁の装飾ストロークの欠けは不可視のため許容）。
- **ロゴ静的レビュー**: `TierlogLogo.tsx` の SVG ID がすべて `useId()` 接頭辞付き（重複なし）、`var(--font-geist-sans)` 使用、`viewBox 0 0 760 200` 維持を確認。
- **SSR HTML**: dev push 後、`curl -s <dev>/auth` でログインページ HTML 内にインライン `<svg … viewBox="0 0 760 200"` と `Tierlog` テキストが出力されることを確認。
- **静的資産 HTTP**: `curl -sI <dev>/icons/icon-192x192.png`（同 512/`apple-touch-icon.png`/`icon.svg`/`/favicon.ico`/`/manifest.json`）が 200＋正しい `content-type` を返すことを確認。
- （任意）`npx opennextjs-cloudflare build` でビルドが通ることを確認（TSX/SVG エラー検出）。

### 7-2. ユーザーに依頼（実機ブラウザ必須）
- ログイン画面（dev プレビュー）を **ダーク／ライト両テーマ** で開き、ロゴのワードマークが可読・マーク配色が正しい・`h-10` のサイズ感が違和感ないこと。
- ブラウザのタブ favicon が v2 になっていること。
- DevTools → Application → Manifest で 192/512 の v2 アイコンが読み込まれ、エラーが無いこと。
- iOS Safari「ホーム画面に追加」で apple-touch-icon が v2 になること。
- Android / デスクトップ PWA インストールでアイコンが v2 になること（既存インストール済み環境は §8-1 のキャッシュ挙動に留意）。
- 既存の PWA インストールプロンプト（`InstallPrompt`）が従来どおり動作すること。

---

## 8. リスク・注意点

1. **PWA インストール済みアイコンのキャッシュ**: 同一 URL でアイコン内容を差し替えるため、既にインストール済みの PWA / OS ランチャーは再インストールまで旧アイコンを保持し得る。新規インストールは即 v2。仕様として記録（ブロッカーではない）。強制更新が必要になれば manifest アイコン URL のバージョンクエリ等を別途検討（ただし「ファイル名維持」方針と相反するため今回はしない）。
2. **favicon 16px の可読性**: v2 `icon.svg` は情報量が多く（カードファン＋クラウン＋ログ線＋グロー）、16px ではディテールが潰れ得る。§7-1 で確認し、判読不能なら favicon 専用の簡略マーク採用を検討（エスカレーション）。なお 16px は `favicon.ico` のみで、モダンブラウザは `icon.svg` を使うため実害は限定的。
3. **sharp(librsvg) のレンダリング忠実度**: `generate-pwa-icons.mjs` は sharp でラスタライズする。v2 SVG は `feDropShadow`・複数 `linearGradient`・`stroke-opacity` を使う。librsvg は対応するが Codex の事前レンダリングと微差が出る可能性。候補削除前に §7-1 で目視比較。
4. **SVG `<defs>` ID 衝突**: v2 SVG は固定 ID（`tierlog-logo-a3-v2-teal` 等）。コンポーネント化で複数描画した際の衝突を防ぐため、全 ID を `useId()` で名前空間化（B-1 に織り込み済み）。
5. **ワードマークのフォント**: インライン `<text>` は `var(--font-geist-sans)` を使用（next/font が公開する CSS 変数）。`<img>` 方式を採らない根拠でもある。
6. **maskable セーフゾーン**: `manifest.json` は `"purpose": "any maskable"`。v2 アイコンの回転カードが縁に寄るため、セーフゾーン外なら OS マスクで欠ける。§7-1 で確認。欠けが問題なら「any」と「maskable」を別エントリに分割する案があるが manifest 改修を伴うため、その場合は指摘・再計画。なお `"any maskable"` 併用自体は既存仕様で本作業の変更点ではない。
7. **`npx --package=sharp` のネットワーク依存**: スクリプト初回実行時に npm から sharp を取得（ローカルにネットワーク必要）。Cloudflare ビルドはこのスクリプトを実行せず、生成物（commit 済）を使う。
8. **Service Worker の旧キャッシュ**: `sw.js` は png/svg/ico を network-first でランタイムキャッシュ。オンラインなら更新版を取得し、オフライン時のみ旧版。任意で `CACHE_NAME` を `tierlog-v2` へ更新すれば次回 activate で旧エントリを破棄（優先度低）。
9. **認証フロー非変更**: 本作業は表示資産（`TierlogLogo` ＋静的アイコン）のみ。`client.ts` / `middleware.ts` / `auth/callback` は触れず、CLAUDE.md の auth 変更禁止に抵触しない。
10. **テーマカラーは scope 外**: `manifest.json` の `theme_color`(`#6366f1`) は v2 パレット（teal/青/violet）とややズレるが、要望は「icons」設定であり今回は変更しない。将来パレット統一する場合の候補として記録のみ。
11. **plan ドキュメント**: 本ファイルは `docs/plans/` に未追跡で作成。commit 要否は既存運用（直近コミットは plan/report を commit している）に倣い実装時に判断。

---

## 9. ロールバック

- dev プレビュー段階: `git checkout dev` 上の commit を `git revert` または該当ファイルを `git checkout` で復元。
- 本番反映後に不具合: Cloudflare ダッシュボード → Deployments → 過去デプロイの **Rollback** ボタンで数秒で復帰。
- 変更はすべて静的資産＋1 コンポーネントに閉じており、DB マイグレーション・auth 変更を伴わないため切り戻しは容易。

---

## 10. 実装前プロセス

1. 本 plan を `/review-plan-loop docs/plans/2026-05-20_a3v2_logo_icon_rollout.md` で plan-critic 検証 → GO まで修正。
2. GO 後、本 plan を Codex にレビュー依頼。
3. Codex の OK 後に実装着手（§6 の手順）。
