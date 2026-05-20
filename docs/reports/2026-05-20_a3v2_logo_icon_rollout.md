# A3 v2 タイトルロゴ / アプリアイコン 反映 実装報告書

- 作成日: 2026-05-20
- ステータス: **本番反映完了**（`https://tierlog.app` 稼働中・検証パス）
- 対象環境: Cloudflare Workers（production + dev preview）
- 関連 plan: `docs/plans/2026-05-20_a3v2_logo_icon_rollout.md`

---

## 1. 概要

Codex が作成した A3 v2 ブランドアセット（タイトルロゴ・アプリアイコン）を実アプリへ反映し、
あわせてログイン画面でのロゴ表示を 3 段階で調整した。全変更は `dev` で検証後に本番反映済み。

実施した 4 件の変更:

1. A3 v2 ロゴ / アプリアイコンへの全面刷新
2. ログイン画面タイトルロゴの表示サイズ拡大
3. タイトルロゴの viewBox を実描画範囲にタイト化（中央寄せ改善）
4. アプリアイコン内カード絵の垂直中央化

---

## 2. 背景

- 旧ロゴ（シンプルな 3 層マーク）から、A3 v2 デザイン（カードファン型マーク＋クラウン＋バトルログ線）へ刷新。
- v2 候補アセットは Codex が `-a3-v2` サフィックス付きで作成済み（SVG マスター 3 種＋事前レンダリング PNG）。
- 実装は plan を作成 →「`/review-plan-loop`（plan-critic 検証）」→ Codex レビュー → 承認後に着手、という手順で進めた。
- ロゴ反映後、ユーザーの実機確認フィードバックを受けて表示サイズ・中央寄せ・アイコン内位置を順次微調整した。

---

## 3. 実施内容

### 3-1. A3 v2 ロゴ / アプリアイコン刷新（commit `c36478c`）

**タイトルロゴ** — `src/components/brand/TierlogLogo.tsx`
- インライン SVG を A3 v2 デザインへ全面書き換え。カードファン型マーク（teal/blue/violet の 3 グラデ＋front カード＋クラウン＋ログ線＋ドロップシャドウ）を忠実移植。
- ワードマーク「Tierlog」は v2 の固定グラデーション（濃紺→青）を使わず `fill="currentColor"` を維持。`text-foreground` 経由でテーマ追従（ダーク=明色 / ライト=濃色）。
  - 理由: v2 のワードマークグラデは明背景前提のため、既定ダークテーマのログイン画面では濃紺部分が埋もれる。ユーザー判断で「テーマ追従色」を採用（plan §4-2）。
- `<defs>` の gradient/filter ID は `useId()` を `.replace(/[^a-zA-Z0-9]/g, "")` で正規化して接頭辞付与（複数描画時の ID 衝突回避＋`url(#...)` 参照の安全性）。

**アプリアイコン** — マスター SVG 上書き＋スクリプト再生成方式
- `public/icons/icon.svg`・`public/brand/tierlog-mark.svg`・`public/brand/tierlog-logo-horizontal.svg` を v2 内容で上書き（canonical ファイル名を維持）。
- `scripts/generate-pwa-icons.mjs`（sharp）で `apple-touch-icon.png`(180) / `icon-192x192.png` / `icon-512x512.png` / `tierlog-mark-1024.png` / `src/app/favicon.ico`(16/32/48 マルチ解像度 ICO) を再生成。
- `src/app/layout.tsx`・`public/manifest.json` は参照先がすべて canonical 名のため**編集不要**を確認。
- `public/sw.js` の `CACHE_NAME` を `tierlog-v1` → `tierlog-v2` に更新（旧アイコンのランタイムキャッシュ破棄）。
- 未追跡だった v1/v2 候補アセット 18 ファイルを整理（削除）。`public/brand`・`public/icons` は canonical のみに。

### 3-2. ログイン画面タイトルロゴ拡大（commit `78820cf`）

- `src/app/auth/page.tsx` の `TierlogLogo` 表示サイズを `h-10` → **`h-14 sm:h-16`**（スマホ 56px / PC 64px）。
- サブコピー「対戦記録・環境分析ツール」との余白を `mt-2` → `mt-3` に微調整。
- フォーム幅・ボタン・認証ロジック・OAuth は無変更。

### 3-3. タイトルロゴ viewBox 中央寄せ（commit `65e80b0`）

- A3 v2 ロゴは viewBox `0 0 760 200` の右側に透明余白が大きく、`mx-auto` 中央寄せ時にロゴが左へ寄って見えていた。
- ロゴの実描画範囲を測定:
  - マーク: sharp でピクセル走査 → 左端 26.3 / 右端 150.3
  - ワードマーク右端: Geist の実 TTF（`@vercel/og` 同梱 Regular・Google Fonts 取得の Black 900）の `hmtx` 字幅テーブルを直接解析し、weight 900「Tierlog」の可視右端 ≈ 474.5 を厳密算出
- `viewBox` を `0 0 760 200` → **`0 0 501 200`** にタイト化（左右余白とも約 26 で対称）。高さ 200 は据え置きのためロゴの実サイズは不変。

### 3-4. アプリアイコン カード絵中央化（commit `05111a0`）

- `icon.svg` のカードグループ `translate(22 52)` で、カード本体の幾何中心がアイコン中心（512）より約 35px 下にずれていた。
- カードグループの実描画範囲を測定（カード本体の垂直中心 546.8）。
- `translate(22 52)` → **`translate(22 12)`**（X=22・`scale(2.1)` 維持）。
  - カード本体の幾何中央化は Y≈17。下方向ドロップシャドウの視覚的重さを考慮し、中心よりわずかに上の Y=12 を 5 段階のレンダリング目視で採用。
- `generate-pwa-icons.mjs` で PWA アイコン・favicon を再生成。

---

## 4. 変更ファイル一覧

| ファイル | 内容 |
|---|---|
| `src/components/brand/TierlogLogo.tsx` | A3 v2 インライン SVG へ全面書き換え／viewBox を 0 0 501 200 にタイト化 |
| `src/app/auth/page.tsx` | ロゴ表示サイズ `h-14 sm:h-16`、サブコピー余白 `mt-3` |
| `public/icons/icon.svg` | A3 v2 デザイン／カードグループ `translate(22 12)` |
| `public/brand/tierlog-mark.svg` | A3 v2 デザイン |
| `public/brand/tierlog-logo-horizontal.svg` | A3 v2 デザイン |
| `public/icons/apple-touch-icon.png` / `icon-192x192.png` / `icon-512x512.png` | スクリプト再生成（v2・中央化） |
| `public/brand/tierlog-mark-1024.png` | スクリプト再生成（v2） |
| `src/app/favicon.ico` | スクリプト再生成（v2・16/32/48 マルチ解像度） |
| `public/sw.js` | `CACHE_NAME` を `tierlog-v2` へ |
| `docs/plans/2026-05-20_a3v2_logo_icon_rollout.md` | 反映 plan（新規） |

**編集しなかったもの**: `src/app/layout.tsx`（icons metadata は canonical 名参照のまま）、`public/manifest.json`（icons 設定変更不要）。

---

## 5. 主要な技術判断

- **ワードマークのテーマ追従**: v2 ロゴの固定グラデーション wordmark は明背景前提。アプリ内（既定ダークのログイン画面）での可読性を優先し `currentColor` を維持。グラデーション版はブランド SVG ファイルには残存。
- **アイコン生成パイプライン**: 事前レンダリング PNG の手コピーではなく、マスター SVG を上書きして `generate-pwa-icons.mjs` で再生成する方式を採用。favicon.ico の正しい生成（ローカルに ICO 変換ツールなし）と全アイコンの整合のため。
- **viewBox タイト化のための実フォント計測**: sharp が Geist の variable woff2 を描画できなかったため、TTF の `hmtx` テーブルを直接解析して weight 900 の字幅を厳密算出。
- **アイコン中央化のシャドウ補正**: ドロップシャドウが下方向に大きいため、カード本体を幾何中心より約 5px 上に置いて視覚的中央化。
- **`useId()` 正規化**: SVG の `url(#...)` 参照 ID 用に英数字のみへ正規化（記号除去）。SSR 出力で記号なし ID を確認済み。

---

## 6. 検証

Claude が自前実施した検証（ブラウザ不要分）:
- `npm run lint` / `eslint`（変更ファイル）— 指摘なし
- 再生成アイコンの寸法（`sips`）・`favicon.ico` 形式（`file`）・`manifest.json` JSON 妥当性
- 再生成 PNG と v2 デザインの目視一致、ダーク/ライト両テーマでのロゴレンダリング
- viewBox 中央寄せの幾何検証（実描画範囲と viewBox 中心の一致）＋ proxy フォントでのクリップ確認
- アイコンカード絵の中央配置をレンダリング目視（5 段階比較）
- dev / production の HTTP（静的アセット 200・content-type・サイズ）・SSR HTML（ロゴ markers）検証

ユーザーが実機確認:
- ログイン画面のロゴ（PC / スマホ、ダーク/ライト）、アプリアイコン（PWA / favicon）の見え方 — いずれも問題なしの確認を取得済み。

---

## 7. デプロイ履歴

| マージコミット | 内容 | 含むコミット |
|---|---|---|
| `e1cb39c` | A3 v2 ロゴ/アイコン刷新・ログイン画面ロゴ調整 | `c36478c` `78820cf` `65e80b0`（＋旧ロゴ docs `25a8a7b`） |
| `c162217` | アプリアイコン カード絵中央化 | `05111a0` |

いずれも `dev` で preview 検証 → ユーザー確認 → `main` マージで本番反映。本番不具合時は Cloudflare ダッシュボードの Rollback で復帰可能。

---

## 8. スコープ外・今後の課題

- **共有ページ header・OGP 画像へのロゴ反映**: 次フェーズ（本作業では未対応）。`src/app/api/og/[id]/route.tsx` は現状ロゴ非埋め込み。
- **`manifest.json` の `theme_color`（`#6366f1`）**: v2 パレット（teal/青/violet）とややズレるが、要望が「icons 設定」だったため今回は変更せず。将来パレット統一する場合の候補。
- **PWA インストール済みアイコンのキャッシュ**: 同一 URL でアイコンを差し替えたため、既存インストール済み端末は再インストールまで旧アイコンを保持し得る（新規インストールは即 v2）。OS 依存の既知挙動。
- **favicon 16px の密度**: v2 アイコンは情報量が多く 16px ではディテールが密になる。モダンブラウザは `icon.svg`（無段階）を使うため実害は限定的。簡略 favicon が必要なら別途対応可能。
