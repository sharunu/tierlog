# 実装報告書: auth ルーティング・露出ログ整理 (2026-05-10 第 2 セッション)

**日付**: 2026-05-10 (Sun)
**担当**: Claude Code (codex 外部レビュー併用)
**ブランチ**: `dev` → `main` (本番反映済 merge commit `dfd022e`)

---

## 概要

公開前準備の一環として、マルチゲーム化 (`/dm`, `/pokepoke`) で残っていた auth 動線の旧 `/battle` 直遷移と、本番ブラウザコンソールに露出していた X 連携デバッグログを整理した。

主要 2 タスク:

1. **auth 後遷移のマルチゲーム対応**: 5 箇所の `/battle` 直書きを `getRedirectGame()` helper 経由で `/{game}/battle` 化
2. **露出デバッグログ削除**: `[X link]` 系 3 行 (auth/callback) + `[syncX]` 系 2 行 (account-actions) 削除

middleware の `LEGACY_ROOTS` 308 救済が依然働いているため即座のユーザー影響はなかったが、本来正規 URL を最初から指すべきところを互換 redirect に依存しており、公開前に整理。

---

## レビューフロー

CLAUDE.md / memory `feedback_codex_review_flow` に従い、以下の往復検証を実施:

1. 初期スコープ調査 (auth / decks / share / middleware の現状確認)
2. **codex 第 1 ラウンド**: 初版 plan の「P0 / 即 404」フレーミングが過大 → middleware の 308 救済を見落とし。「公開前ルーティング整理 + デバッグログ削除」に格下げ
3. **codex 第 2 ラウンド**: helper 配置を `src/lib/games/context.tsx` 共有 export → 各 auth ファイル内ローカル関数に格下げ (blast radius 局所化)
4. **codex 第 3 ラウンド**: helper の解決順を cookie 単独 → `localStorage` → cookie → `DEFAULT_GAME` に変更 (`GameProvider` が両方に書いているため)
5. **codex 第 4 ラウンド**: cookie 値の `decodeURIComponent` を削除 (malformed 時 throw リスクが上回る、`isGameSlug` だけで十分)
6. plan-critic (`/review-plan-loop`) で検証 → GO 判定 (反復 1/3、Issues 0、evidence 10 件)
7. 実装 → 静的検証 (rg / tsc / lint / bundle inspection) → ユーザー実機確認 OK
8. main へ merge & push (本番自動デプロイ)

---

## 実装した commit (dev → main)

| Commit | Message | 主な変更 |
|---|---|---|
| `f391134` (dev) | fix(auth): 旧 /battle 直遷移を /{game}/battle 化 + 露出デバッグログ削除 | 3 ファイル, +37 / -10 |
| `dfd022e` (main) | Merge branch 'dev' | 本番反映 |

---

## 変更ファイル

### `src/app/auth/page.tsx`
- import 追加: `DEFAULT_GAME`, `isGameSlug`, `type GameSlug` from `@/lib/games`
- ローカル helper `getRedirectGame()` 追加:
  - `localStorage.getItem("selectedGame")` を `try/catch` で読む (private mode / quota 対策)
  - 失敗時は `document.cookie` regex で読む (`match?.[1] ?? null`)
  - どちらも不正/未設定なら `DEFAULT_GAME` (= `dm`)
- 3 箇所の `window.location.href = "/battle"` を `\`/${getRedirectGame()}/battle\`` に置換 (L28 / L53 / L78)

### `src/app/auth/callback/page.tsx`
- import + helper 追加 (auth/page.tsx と同形のローカル関数)
- 2 箇所の `/battle` 遷移を置換 (L75 SIGNED_IN 後 / L87 5秒タイムアウト fallback)
- `[X link]` 系 console.log 3 行削除 (L33 identities, L38 syncing, L42 no twitter)
- `link_x=true` / `x_link_pending` / `PASSWORD_RECOVERY` 分岐は変更なし

### `src/lib/actions/account-actions.ts`
- `[syncX] rpc error:` ログ削除 (L115、`return false` は維持)
- `[syncX] result:` ログ削除 (L119、`return ok ?? false` は維持)

### 触らなかったファイル (意図的)
- `src/middleware.ts` — `LEGACY_ROOTS` の 308 救済は外部リンク・古いブックマーク互換のため残す
- `src/components/battle/BattleRecordForm.tsx` — 既に `` href={`/${game}/decks`} `` 動的化済 (L270)
- `src/app/dm/decks/page.tsx` / `src/app/pokepoke/decks/page.tsx` — 戻るボタンは正しいスラッグで実装済
- `src/lib/pokepoke/limitless-sync.ts` — `console.warn` はリトライ警告で本番でも妥当
- `src/components/layout/BottomNav.tsx` — 独自に cookie 読み取り regex を持つが本タスクではリファクタしない

---

## 検証

### Claude 自前
- 静的 grep: `window.location.href = "/battle"` / `push("/battle"` / `href="/decks"` 0 件
- 静的 grep: `[X link]` / `[syncX]` 0 件
- `npx tsc --noEmit`: pass
- 編集 3 ファイル限定 `npm run lint`: 新規エラー・警告なし
- dev preview HTTP 200: `/auth`, `/dm/battle`, `/pokepoke/battle`
- middleware 308 救済が健在: `curl -I /battle` → `308 → /dm/battle`
- **bundle inspection** (実装が dev preview に確実に乗っているか直接確認):
  - `/auth` chunk `0dz5~lu5dqf7n.js`: `localStorage.getItem("selectedGame")` 1 件 + minified `/${o()}/battle` 3 件 (auth/page.tsx の L28/L53/L78 と一致)
  - `/auth/callback` chunk `14c47bpu07owb.js`: `/${...}/battle` 2 件 (L75/L87 と一致)
  - 全 chunk grep: `[X link]` / `[syncX]` 0 件

### ユーザー検証
- dev preview でログイン → `/dm/battle` 着地で画面正常表示

---

## 残タスク (公開前ハードニング、ドメイン取得時の別タスク)

ドメイン・正式アプリ名・問い合わせメールが確定してから一括対応する項目:

1. **規約・プライバシーポリシー更新** — マルチゲーム文言反映 + 連絡先（外部メール）整備
2. **未ログイン LP 追加** — `/` が `/{game}/home` に redirect されるため、初訪問者は説明なしで auth wall に当たる。SEO 流入・SNS 拡散の起点として必要
3. **Sentry / エラートラッキング導入** — 本番障害が現状無検知。ユーザー数増加で個別対応不能になる前に
4. **public/ ボイラープレート画像削除** — `next.svg` / `vercel.svg` / `globe.svg` / `window.svg` / `file.svg` 未使用
5. **PWA アイコン拡充** — `apple-touch-icon` (180x180) 等が未配置
6. **初回オンボーディング** — 初ログイン時のデッキ登録 → 対戦記録までの導線説明
7. **Discord guilds scope 必要性再確認** — 不要なら privacy 説明簡素化可能

これらは「思想判断」「外部アカウント作成」「画像制作」「ドメイン依存」のいずれかが絡むため、今回スコープから外した。

別系統の残タスク (公開とは独立):
- **Phase E2** — `share-images` の SELECT policy 削除 (本番 C3 安定確認後、目安 2026-05-24 頃)
- **Phase C 残部 lint** — 32 errors / 21 warnings (主因 `react-hooks/set-state-in-effect`)

---

## 学び / 振り返り

### codex 第 1 ラウンドの過大評価フィードバックが効いた
初版 plan は「P0 リグレッション / 即 404」と書いていたが、実際は `src/middleware.ts:6, 105-115` の `LEGACY_ROOTS` 308 救済が機能しており即 404 ではなかった。codex の「middleware が救済しているので即 404 ではない」指摘で適切な severity (P1 ルーティング整理) に格下げ。**仕様を記憶ベースで語る前にコードを当たる重要性** を再確認。

### Bundle inspection が browser 不要の検証として機能
`curl` で `/auth` HTML から chunk URL を抽出し、各 chunk を `grep` で検査することで、新コードの存在 (`localStorage.getItem("selectedGame")` / `/${...}/battle` の minified 形) と削除済みコードの不在 (`[X link]` / `[syncX]`) を browser 操作なしで確定できた。`feedback_self_verification` の実例として有効 — DevTools Network を開かなくても「実装が dev preview に乗っているか」「ログ露出が消えたか」をユーザー操作なしで保証可能。

### plan-critic + codex の重複なし運用
- **plan-critic**: 機械的整合性 (ファイル存在、行番号、import 整合、SQL 構文、既存パターン一致) を網羅検証 → 10 件の evidence で裏付け
- **codex**: 設計判断・暗黙挙動・運用観点 (helper 配置、解決順、`decodeURIComponent` throw リスク、middleware 308 救済の見落とし) を補完
- 両者の指摘は重複せず、4 ラウンドで効率的に plan が固まった
