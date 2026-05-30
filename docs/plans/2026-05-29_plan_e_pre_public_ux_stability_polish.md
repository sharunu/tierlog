# Plan E: Pre-Public UX / Stability Polish

- 作成日: 2026-05-29
- 対象ブランチ: `dev`（実装は別チャットで着手予定。本 plan ファイルは plan 作成のみ）
- 前提 plan（すべて本番反映済）:
  - Plan A: Public Launch Safety（Storage-only share images / auth game next / BanGuard fail-open 等）
  - Plan B: Observability / OG / SEO（Sentry / OG 動的画像 / sitemap / robots）
  - Plan C: Multi-Game DB Scope（`game_title` スコープ / format コード一意 / read-RPC は p_format / write-RPC は p_game_title / quality scoring stage）
  - Plan D: Access Gate / Auth Expiry（`account_access_state` / requireBearer requireActiveUser / AuthExpiredError + AuthGuard / BanGuard 並列）
- 性格: **公開前の UX 仕上げと安定性・検証強化**。新機能追加ではなく、実装済み機能の磨き込み。
- **重要な構造的特性: 本 plan は DB migration を一切伴わない**（client コード / CI 設定 / unit test / build script / docs のみ）。production DB 変更なし。Plan C の C-6 既存 `detection_alerts` 24 件（TRUNCATE / rescan 判断）には一切触れない。

---

## 0. 目的とスコープ

### 含めるもの（本 plan で実施）

| ID | 内容 | 優先度 | 領域 |
|---|---|---|---|
| E-1 | lint 25 件（`react-hooks/set-state-in-effect`）解消 + `eslint-plugin-react-hooks` version 整合（CI blind spot 解消） | P1 | 安定性 / 品質 |
| E-2 | Plan D auth helper の純関数 unit test 追加（`isMissingFunctionError` / `AuthExpiredError` / `handleAuthExpiredError`） | P1 | 安定性 / 品質 |
| E-3 | Onboarding / 空状態 polish（deck 0 件導線 + empty-state CTA 一貫化、dm / pokepoke 両対応） | P1 | UX |
| E-4 | Discord 連携 UX のエラー表示改善（client 側のみ） | P1 / P2 | UX |
| E-5 | パフォーマンス / 体感速度（client 側のみ、schema 改修なし） | P2 | 体感速度 |
| E-6 | build marker（git SHA）注入 + live build 判定 runbook | P1 | 検証 / 運用 |

### 含めないもの（別 plan / 別フェーズ）

- **C-6 既存 `detection_alerts` 24 件の TRUNCATE / rescan 判断**（最後に別途判断する。本 plan では一切触れない）
- **DB migration / production DB スキーマ変更**（本 plan は migration ゼロ。新スキーマが必要になる施策は別 plan）
- **component / hook test 基盤（jsdom / React Testing Library）導入**（RD-E2、effort・設計判断が大きく Plan E に混ぜると scope 膨張）
- **action / route の integration test 化**（RD-E2）
- **初回 welcome ウィザード / 強制 redirect / Discord 中心 home の全面 redesign**（RD-E3、UX 設計・文言・状態管理が膨らむ）
- **`/api/discord/callback` の redirect 意味論変更・error reason 差別化**（RD-E7、auth-sensitive route。本 plan は client 表示改善のみ）
- **OpenNext build を CI に追加 / CI-CD 全体の再設計**（RD-E4、時間・キャッシュ・環境差分調整が必要で別 plan）
- **unbounded query への `.limit()` 付与で RPC 改修が必要なもの**（RD-E6、SECURITY DEFINER RPC = migration を伴うため Plan E では investigate のみ）
- **Next.js / OpenNext のアップグレード**（本 plan の対象外）

---

## 1. 関連 plan との依存関係

| Plan | 関係 | Plan E での扱い |
|---|---|---|
| Plan A | share image / auth next / BanGuard fail-open | §7 で非破壊確認。E-3/E-4 が触る画面に BanGuard / auth next が乗るため挙動不変を保証 |
| Plan B | Sentry / OG / SEO | §7 で非破壊確認。E-6 の build marker meta は Plan B の robots/OG meta と共存（別 meta） |
| Plan C | `game_title` スコープ / format 一意 / read-RPC は p_format | E-5 が `stats-actions.ts` の read RPC を触るが **p_format スコープを維持**（p_game_title を足さない）。§7 で確認 |
| Plan D | `account_access_state` / requireBearer / AuthExpiredError / AuthGuard / BanGuard 並列 | E-2 が auth helper を test、E-4 が AuthExpiredError 連動を強化。**契約・挙動は不変**。§7 で確認 |

本 plan は Plan A〜D の **挙動を一切変えず**、その上の UX・安定性・検証を磨く位置づけ。

---

## 2. プロジェクト固有ルールの厳守事項（CLAUDE.md / AGENTS.md）

本 plan の実装時に特に効くもの:

1. **`main` 直 push 禁止**。全変更は `dev` で実装・動作確認 → ユーザーの「本番反映」明示指示後に `main` merge。
2. **既存 auth 設定（implicit flow / X・Google ログイン / `middleware.ts` / `client.ts`）は変更しない**。`auth/callback/page.tsx` は既存 SIGNED_IN 処理を変更せず新イベント分岐追加のみ可。
   - → **E-6 の build marker は `middleware.ts` を触らない**（meta tag 方式を採用、RD-E5）。
3. **認可判断で `getUser()` を `getSession()` に置換しない**（Plan D 制約）。
   - → E-4 が触る `handleDiscordConnect` の `getSession()` は **access_token 取得用**であり認可判断ではない（既存・変更しない）。
4. **URL をコード内にハードコードしない**。`process.env.NEXT_PUBLIC_APP_URL` 経由、client 動的 URL は `window.location.origin`。
5. **ランタイム Secret を `process.env` から直接読まない**。`getServerEnv()` 経由。`NEXT_PUBLIC_*` は build 時 inline なので `process.env` 可。
   - → E-6 の `NEXT_PUBLIC_BUILD_SHA` は build 時 inline の public 値（git SHA = 非 secret）。RD-E4 の「secret 非漏洩確認」を §6 E-6 で実施。
6. **修正前に必ず既存コードを読む**。
7. **検証は Claude が可能な限り自前で実施**（lint / tsc / vitest / `opennextjs-cloudflare build` / curl / 静的レビュー）。ユーザー依頼は実機ブラウザ必須項目のみ。
8. **lint / test 通過でも OpenNext build は落ちうる**（memory: cloudflare-build-verification）。失敗ビルドは preview URL から不可視 → **check-run で必ず確認**。Plan D で `useSearchParams` を Suspense 境界で包まず本番 build が落ちた前例（commit `041b565`）あり → E-3/E-4 で client component を触る際は同種の build 落ちに注意。

---

## 3. 現状調査（2026-05-29 実測）

### 3.1 lint / CI の現状（E-1 の根拠）

- **`npm run lint`（local）= 25 problems（25 errors / 0 warnings）、全件 `react-hooks/set-state-in-effect`**。
- **CI は green**（`gh run list --branch dev`：直近 5 commit すべて conclusion=success）。
- **矛盾の原因 = version skew**:
  - local `node_modules`: `eslint-plugin-react-hooks@7.1.1` / `eslint@9.39.4`
  - `package-lock.json` pin: `eslint-plugin-react-hooks@7.0.1` / `eslint@9.39.3`
  - `eslint-plugin-react-hooks` は `package.json` に直接宣言が無く、`eslint-config-next@16.2.6` 経由の **transitive dep**。`^` 範囲で local の `npm install` が 7.1.1 に解決、lockfile は 7.0.1 のまま。
  - CI は `npm ci`（`.github/workflows/ci.yml:23`）で lockfile 厳守 → 7.0.1 → `set-state-in-effect` が緩く 0 件。local は 7.1.1 → 25 件。
  - **= CI lint ゲートに blind spot。lockfile が将来 7.1.x に更新された瞬間 CI が突然 red 化する。公開前に解消すべき。**
- 25 件の分布（12 ファイル）:
  - `src/app/account/page.tsx:79`
  - `src/app/account/security/page.tsx:56`
  - `src/app/admin/general-settings/page.tsx:81`
  - `src/app/dm/home/page.tsx:90` / `src/app/pokepoke/home/page.tsx:90`
  - `src/app/dm/stats/page.tsx:57,108,119,128,243` / `src/app/pokepoke/stats/page.tsx:57,109,120,129,248`
  - `src/components/admin/AdminUserBattles.tsx:50` / `AdminUserStats.tsx:123` / `FeedbackList.tsx:44` / `OpponentDeckManager.tsx:303,344`
  - `src/components/battle/BattleRecordForm.tsx:100,115,129,157` / `EditBattleModal.tsx:113`
- パターンの大半は「mount 時 / 外部状態（format / decks 等）変化時に localStorage・cookie・fetch 結果を `setState` で同期反映」する effect（例: `BattleRecordForm.tsx:95-162`、`dm/home/page.tsx:87-91` の `loadData()` 呼び出し）。2026-05-24 の lint 解消フェーズ（89→0）でも同種を refactor / 理由付き block disable で処理した前例あり（`docs/reports/2026-05-24_lint_errors_resolution.md` §3.2 項 7-9）。

### 3.2 test の現状（E-2 の根拠）

- `npm test`（vitest run）= **8 files / 149 cases pass**（`vitest.config.ts` は `environment: node`、`src/**/*.test.ts` のみ、純関数のみ）。
- 既存 test: `auth/redirect` / `battle/result-format` / `games/index` / `og/fonts` / `search/normalize` / `share/image-url` / `stats/transform` / `util/whitespace`。
- **未 test の穴**: component（64）/ hooks（6）/ `lib/actions/*`（I/O）/ API route / **Plan D の `lib/auth/require-bearer.ts`・`lib/errors/auth-expired-error.ts`**。
- E-2 対象は **I/O なしで書ける Plan D auth helper の純関数のみ**（RD-E2）:
  - `isMissingFunctionError({code,message})`（`require-bearer.ts:142-154`）: PGRST202 / "Could not find the function" / "schema cache" / "function"+"does not exist" → true、それ以外 false。純粋・分岐網羅容易。
  - `AuthExpiredError`（`auth-expired-error.ts:24-31`）: `message = "auth_expired: <reason>"` / `name = "AuthExpiredError"` / `reason` 保持。
  - `handleAuthExpiredError(error)`（`auth-expired-error.ts:39-50`）: SSR（`typeof window === 'undefined'`）で false / `instanceof AuthExpiredError` で `CustomEvent(tierlog:auth-expired)` dispatch + true / それ以外 false。

### 3.3 Onboarding / 空状態の現状（E-3 の根拠）

- **deck 0 件で battle フォームが無言で機能不全**:
  - `BattleRecordForm.tsx:136-140`: `decks.length > 0 ? setSelectedValue(decks[0].id) : setSelectedValue("")`。
  - `handleSubmit`（`:164-167`）: `if (!deckId || !cleanedOpponent) return;` → deck 0 件だと `deckId` 空で **submit が無言で何もしない**。ユーザーには「壊れている」ように見える。
  - battle 空状態（`BattleTabsView.tsx:258-271`）は「対戦を記録する」で input タブへ切替する CTA はあるが、その先の deck 0 件問題に未対応。
- **empty-state CTA が不統一**:
  - 良い例: `BattleTabsView.tsx:258-271`（CTA あり）。
  - 不足: `BattleHistoryList.tsx:60-65`（「対戦履歴がありません」プレーンテキスト、CTA なし）、`DeckList.tsx:243-246`（「デッキを追加してください」だが追加導線への誘導が弱い）。
- **dm / pokepoke の home / decks / battle は near-identical**（例: `dm/home/page.tsx` と `pokepoke/home/page.tsx`）。→ 改善は両方に同品質で適用する必要あり。
- post-login の着地は `resolveAuthRedirectTarget`（`lib/auth/redirect.ts`）で `next` 優先・fallback `/${game}/battle`。**RD-E3 により redirect ロジック自体は変更しない**（強制 redirect なし）。

### 3.4 Discord 連携 UX の現状（E-4 の根拠）

`src/app/dm/home/page.tsx`（pokepoke も同一構造）:

- `handleDiscordConnect`（`:144-165`）: `/api/discord/start` 失敗時に **`alert()`（:159）**でブロッキング表示。`getSession()`（:146）は **Bearer token 取得用**で認可判断ではない（既存）。
- `handleDisconnect`（`:167-177`）: `const ok = await disconnectDiscord()`。`ok` が false でも **エラー表示なし**、`setDisconnecting(false)` するだけ → 失敗が無言。ユーザーは解除成功と誤認しうる。
- `handleManualRefresh`（`:191-199`）: `refreshGuilds()` 失敗時 **無言**。さらに `getMyTeamsWithVisibility()`（:195）が **catch 無し** → JWT 失効時に `AuthExpiredError` が unhandledrejection 経路（Plan D 経路 2）頼みになり、明示 catch（経路 1）が漏れている。
- `handleToggleVisibility`（`:179-189`）: `ok` false でも無言。
- API route 側（`/api/discord/{start,callback,refresh-guilds}`）は Plan D の access gate（requireBearer / callback inline `account_access_state`）が既に入っている。**callback の redirect 意味論・error 種別の差別化は本 plan では変更しない**（RD-E7）。

### 3.5 パフォーマンス / 体感速度の現状（E-5 の根拠）

- **stats RPC の waterfall**:
  - `getGlobalStatsByRange`（`stats-actions.ts:407-454`）: `get_global_my_deck_stats_range` + `get_global_opponent_deck_stats_range` を `Promise.all`（:407-410）した後、**`get_global_turn_order_stats_range` を別 await（:434）** = 直列。turn-order の params は独立（同じ start/end/format/maxStage）なので **3 本目を Promise.all に統合可能**（schema・RPC signature 不変、p_format スコープ維持）。
  - `getTeamStatsByRange`（同ファイル、team 版）も同型の waterfall。
- **mount 時メタデータの非並列**: stats ページ初期化で複数の独立 read（teams / stage / auth provider / X status / premium 可視）を逐次取得する箇所、home で `auth.getUser()` 後に `getDiscordConnection()` を直列する箇所。`Promise.all` 化で短縮可能。
- **loading flash**: range / format 変更時に skeleton/spinner が出て直前データが消える flash。初回ロード時のみ skeleton、フィルタ変更時は前データを残す方式で改善可能。
- **loading.tsx はルート 1 個のみ**（`src/app/loading.tsx`）。各画面の loading 状態は client component 内の state で表現（既存）。
- **unbounded query**: global/team の opponent-deck・trend は SECURITY DEFINER RPC 由来で、`.limit()` 付与には **RPC 改修 = migration が必要**。→ **RD-E6 により Plan E では実装せず investigate のみ**（no schema change を維持）。

### 3.6 build 検証の現状（E-6 の根拠）

- **build marker は存在しない**。git SHA / build id を HTML・header に出していない。稼働ビルドの判別は curl での staging 汚染検出（`dev-duepure-tracker` / staging Supabase ref の有無）に依存（`docs/runbooks/cloudflare-rollback.md`）。
- `scripts/prepare-cloudflare-env.sh`: `WORKERS_CI_BRANCH`（or `CF_PAGES_BRANCH`）を検出し dev で `STAGING_NEXT_PUBLIC_*` → `NEXT_PUBLIC_*` を写し `NEXT_PUBLIC_SUPABASE_ENV=staging` を設定。**ここに build SHA 注入を追加できる**。
- Cloudflare Workers Builds 公式の git 変数（2026-05-29 WebFetch 確認、`developers.cloudflare.com/workers/ci-cd/builds/configuration/`）:
  - **`WORKERS_CI_COMMIT_SHA`**: current commit の SHA1（**full 40 桁**）。
  - **`WORKERS_CI_BRANCH`**: branch 名。
- Sentry の `resolveRelease` は runtime binding `CF_VERSION_METADATA`（deployment version id）を使用（Plan B）。これは git SHA とは別物。**build marker は git SHA を使う**（人間が `git log` と突合しやすい）。
- CI（`ci.yml`）は lint + typecheck + test のみ。**OpenNext build は CI 非対象**（Cloudflare Workers Builds が別系統で実施）。RD-E4 により本 plan では CI に build を足さない。

---

## 4. 問題の分類

### 4.1 公開前に直すべきもの（本 plan で実施）

- lint 25 件（local 赤 / CI green の blind spot）→ E-1
- Plan D auth helper の test 未整備（security-critical かつ直近で build/deploy 事故あり）→ E-2
- deck 0 件で battle フォームが無言で機能不全 → E-3
- Discord 連携の失敗が無言（alert / 解除失敗 / refresh 失敗 / refresh 時 auth-expired catch 漏れ）→ E-4
- 稼働ビルドを live で判別できない（build marker 不在）→ E-6

### 4.2 P2 / 後回しでよいもの（本 plan で軽く触れる or investigate）

- stats RPC waterfall・mount メタデータ並列化・loading flash → E-5（client 側のみ、低リスクなら実施）
- empty-state CTA の文言統一（機能影響小）→ E-3 に含める
- Discord callback の error 種別差別化（auth-sensitive、別途）→ §10.B
- unbounded query への `.limit()`（RPC 改修 = migration 必要）→ §10.B / investigate

### 4.3 誤検知または現状維持

- 「lint は 0 件のはず」（2026-05-24 報告ベースの誤解）→ **現状 25 件が正**（version skew が原因、3.1 参照）。
- BanGuard fail-open / AuthGuard / account_access_state の挙動 → **正しく動作、変更しない**（§7）。
- post-login redirect が `/battle` fallback → 仕様。RD-E3 で **変更しない**。
- `handleDiscordConnect` の `getSession()` → token 取得用で認可判断ではない。**現状維持**。

---

## 5. 実装方針

### 5.1 DB migration 不要（本 plan の前提）

- E-1〜E-6 は **client コード / `package.json` + `package-lock.json`（E-1 の version exact pin）/ unit test / build script / docs** のみ。**`ci.yml` は変更しない**（lockfile が CI の `npm ci` install 内容を支配するため、ci.yml を触らずに 7.1.1 を CI へ反映できる）。
- **Supabase migration / production DB 変更は一切なし**。よって「expand → code → contract」順序や C-6 detection_alerts の論点は **本 plan では発生しない**。
- production DB に依存する検証（MCP read-only 等）も不要。

### 5.2 dev → preview 検証 → 本番反映の順序

1. `dev` で E-1〜E-6 を実装。
2. local で `npm run lint`（0 期待）/ `npx tsc --noEmit` / `npm test`（新規 auth-helper test 含め pass）を確認。
3. **risky な client/build 変更（E-3/E-4/E-6）は local で `npx opennextjs-cloudflare build` を通す**（OpenNext build 落ち防止、Plan D `041b565` の前例）。
4. `dev` push → **Cloudflare check-run の成否を必ず確認**（preview URL では失敗ビルドが不可視）。
5. preview URL（`https://dev-duepure-tracker.jianrenzhongtian7.workers.dev`）で UX を確認。**E-6 の build marker を curl して稼働 SHA を確認**。
6. ユーザーの「本番反映」明示指示後に `main` merge → push → 本番でも build marker を curl 確認。

### 5.3 rollback 方針

- DB 変更が無いため rollback は **Cloudflare Deployments の Rollback ボタン（git 起因のコード巻き戻し）だけで完結**。
- lockfile 変更（E-1）は revert commit で戻せる。

### 5.4 build 安全（client component を触る E-3/E-4/E-6 の必須事項）

- `useSearchParams` / `usePathname` 等を新規に使う場合は **Suspense 境界で包む**（Plan D `041b565` の本番 build 失敗の再発防止）。E-3/E-4 は既存 component への追記が中心で、原則 新規 `useSearchParams` は追加しない方針。
- E-6 の `layout.tsx` meta 追加は server component 側の静的 meta（`NEXT_PUBLIC_BUILD_SHA` の build 時 inline）であり client hook を増やさない。

---

## 6. サブタスク詳細

### E-1: lint 25 件（`set-state-in-effect`）解消 + `eslint-plugin-react-hooks` version 整合（P1）

**目的**: local 赤 / CI green の blind spot を解消し、公開前に lint を 0 にしたうえで **CI でも同じ厳格度（7.1.x）で検知できる**状態にする（RD-E1）。

**手順（順序重要 — lockfile bump と 25 件修正は同一 push に含める）**:

1. **version 整合**: `eslint-plugin-react-hooks` を **明示 devDependency として `package.json` に追加**（local が既に解決している `7.1.1` に **exact pin**＝`"eslint-plugin-react-hooks": "7.1.1"`。caret/range は付けない — local/CI skew を構造的に潰すのが目的なので固定する）。`npm install` で `package-lock.json` を再生成し、lockfile を **7.1.1** に固定。
   - これで CI の `npm ci` も 7.1.1 を入れ、以後 `set-state-in-effect` を CI が検知する。
   - 補足: `eslint` 本体の patch skew（9.39.3 vs 9.39.4）は原因ではないが、lockfile 再生成時に整合させてよい。
   - **注意**: bump 後に lint を再実行し、25 件以外の新規エラーが出ないことを確認（local は既に 7.1.1 なので 25 件が全集合だが、lockfile 再生成で他 transitive が動く可能性を排除）。
2. **25 件修正（refactor 優先・disable は最小範囲のみ、RD-E1）**:
   - **refactor 可能な箇所**: setState を effect 外へ（イベントハンドラ / 派生 state / `useMemo` / mount 時 lazy initializer / ref）に移せるものは移す。2026-05-24 報告 §3.2 の前例（hooks 系の mount 時 resolve を `useState` 初期化や `useCallback` 整理で解消）に倣う。
   - **やむを得ない箇所**: 「mount 時 / 外部状態変化時に localStorage・cookie・fetch 結果を同期反映する」`useEffect`（例: `BattleRecordForm.tsx:95-162`、`dm/home:87-91` の `loadData()`、stats ページの format/range resolve）は React 19 / App Router 上やむを得ないため、**理由コメント付きの行単位 / block 単位の最小 disable** を許可。
   - **禁止**: file 全体 disable / blanket disable（RD-E1）。`/* eslint-disable */`（ファイル先頭）や広域 disable は使わない。
3. **dm / pokepoke 等価ファイルは同一方針**で処理（`dm/stats` と `pokepoke/stats`、`dm/home` と `pokepoke/home` は同じ修正を当てる）。
4. **挙動不変**: いずれも描画結果・state 遷移を変えない（リファクタ or 抑制のみ）。特に **Plan D 関連（`dm/home:90` の `loadData` は AuthGuard 連動経路、stats）と Plan C スコープ（stats）に副作用を出さない**。

**完了条件**: `npm run lint` = 0 / `npx tsc --noEmit` = 0 / `npm test` pass / lockfile に `eslint-plugin-react-hooks@7.1.x` / CI green。disable は最小範囲かつ全件に理由コメント。

**触るファイル**: `package.json` / `package-lock.json` + 3.1 記載の 12 ファイル。

---

### E-2: Plan D auth helper の純関数 unit test 追加（P1）

**目的**: security-critical かつ I/O なしで書ける Plan D helper を回帰から守る（RD-E2）。jsdom / RTL / integration は導入しない。

**追加 test**:

1. `src/lib/auth/require-bearer.test.ts` — `isMissingFunctionError` のみ（`requireBearer` 本体は I/O のため対象外）:
   - `code === "PGRST202"` → true
   - message に "Could not find the function" / "schema cache" / "function ... does not exist" → true
   - 通常エラー（network / permission 等）→ false
   - `code` null・`message` null/空 → false（境界）
2. `src/lib/errors/auth-expired-error.test.ts`:
   - `AuthExpiredError`: `name === "AuthExpiredError"` / `message === "auth_expired: <reason>"` / `reason` 保持 / `instanceof Error`。
   - `handleAuthExpiredError`:
     - SSR 想定（`window` 未定義のまま）→ false、event dispatch されない。
     - `window` を stub（`globalThis.window = { dispatchEvent: vi.fn() }`、`CustomEvent` は Node 22 の global を利用）した状態で `AuthExpiredError` を渡す → true、`dispatchEvent` が `tierlog:auth-expired` + `detail.reason` で 1 回呼ばれる。test 後に `window` stub を復元。
     - 非 `AuthExpiredError`（通常 Error / 文字列）→ false。

**完了条件**: `npm test` で新規 2 ファイルが pass、既存 149 ケースを壊さない。`environment: node` のまま（jsdom 不要）。

**触るファイル**: `src/lib/auth/require-bearer.test.ts`（新規）/ `src/lib/errors/auth-expired-error.test.ts`（新規）。

---

### E-3: Onboarding / 空状態 polish（dm / pokepoke 両対応）（P1）

**目的**: 新規ユーザーが「次に何をすればよいか」分かる状態にする。**強制 redirect・welcome ウィザード・home redesign はしない**（RD-E3）。

**サブ項目**:

- **E-3a（最優先）: deck 0 件で battle が無言で機能不全になる問題**:
  - `BattleRecordForm.tsx` で `decks.length === 0` を検出し、フォームの代わりに **「先にデッキを登録してください」+ デッキ登録への導線**（decks タブ / ページへのリンク or ボタン）を表示。
  - もしくは battle 空状態（`BattleTabsView.tsx:258-271`）の CTA を deck 0 件時に「デッキを登録する」に切り替える。どちらの層で出すかは実装時に最小変更で決定（フォーム層が確実）。
  - 既存の deck あり時の挙動は不変。
- **E-3b: empty-state CTA の一貫化**:
  - `BattleHistoryList.tsx:60-65`（プレーンテキスト）→ 「対戦を記録する」等の CTA / 入力導線を付与。
  - `DeckList.tsx:243-246`（「デッキを追加してください」）→ 追加 UI への誘導を強化（文言 / 視認性）。
  - stats / home の zero-data 表示の文言・CTA を battle 空状態と整合させる。
- **E-3c: dm / pokepoke 同品質**: 上記をすべて両ゲームに適用（near-identical ファイルなので差分が片側だけにならないよう注意）。

**非破壊**: redirect ロジック（`lib/auth/redirect.ts`）変更なし。BanGuard / AuthGuard が乗る画面なので挙動不変を §7 で確認。新規 `useSearchParams` を増やさない（build 安全）。

**完了条件**: deck 0 件の新規ユーザーが battle 画面で「デッキ登録が先」と分かり導線をたどれる。空状態 CTA が dm/pokepoke で統一。lint/tsc/test/OpenNext build pass。

**触る候補ファイル**: `src/components/battle/BattleRecordForm.tsx` / `BattleTabsView.tsx` / `BattleHistoryList.tsx` / `src/app/dm/decks/DeckList.tsx` / `src/app/pokepoke/decks/DeckList.tsx` / 必要に応じ home・stats の zero-data 箇所。

---

### E-4: Discord 連携 UX のエラー表示改善（client 側のみ）（P1 / P2）

**目的**: 連携系の失敗が無言にならないようにし、Plan D の AuthExpiredError 連動を漏れなくする。**`/api/discord/*` route と OAuth flow・access gate の挙動は変更しない**（RD-E7）。

**サブ項目**（`src/app/dm/home/page.tsx` + `src/app/pokepoke/home/page.tsx`）:

- **E-4a: `handleDiscordConnect`（:159）の `alert()` を非ブロッキング表示に**（inline エラー state / 既存 toast 系があればそれ）。
- **E-4b: `handleDisconnect`（:167-177）の失敗を surface**: `disconnectDiscord()` が false / throw の時にエラー表示。`AuthExpiredError` は `handleAuthExpiredError(e)` で経路 1 に流す。
- **E-4c: `handleManualRefresh`（:191-199）**: `refreshGuilds()` 失敗時にエラー表示。`getMyTeamsWithVisibility()`（:195）を try/catch で包み、`AuthExpiredError` は `handleAuthExpiredError(e)` 経由（経路 1 漏れの解消）。
- **E-4d（任意）: `handleToggleVisibility`（:179-189）** の失敗 surface も同方針で揃える。
- **既存の `?discord=connected` / `?discord=error` バナー**（home 上部）はそのまま活用。文言の微改善は可だが **callback 側の redirect 種別は変えない**。

**非破壊**: `getSession()`（token 取得）は維持（認可判断への置換ではない）。requireBearer / account_access_state / callback の挙動不変。

**完了条件**: 連携開始失敗 / 解除失敗 / refresh 失敗が画面で分かる。refresh 中の JWT 失効が AuthGuard redirect に正しく流れる。dm/pokepoke 両対応。lint/tsc/test/OpenNext build pass。

**触る候補ファイル**: `src/app/dm/home/page.tsx` / `src/app/pokepoke/home/page.tsx`（必要なら共通のエラー表示 util）。

---

### E-5: パフォーマンス / 体感速度（client 側のみ、schema 改修なし）（P2）

**目的**: 低リスクな client 側の体感速度改善。**RPC signature / schema は変えない。Plan C の read-RPC p_format スコープを維持**（RD-E6）。

**サブ項目**:

- **E-5a: stats RPC waterfall 統合**: `getGlobalStatsByRange`（`stats-actions.ts:407-454`）の `get_global_turn_order_stats_range`（:434）を先頭の `Promise.all`（:407）に統合（3 本並列）。`getTeamStatsByRange`（team 版）も同様。**params 不変（p_format 維持）、結果整形ロジック不変**。
- **E-5b: mount 時メタデータ並列化**: stats / home で逐次 await している独立 read を `Promise.all` 化。**呼び出し順依存が無いことを各 call site で確認してから**実施。
- **E-5c: loading flash 抑制**: range / format 変更時に「初回ロードのみ skeleton、フィルタ変更時は前データを残す」方針へ（client state の出し分けのみ）。
- **investigate のみ（実装しない）**: unbounded opponent-deck / trend query への `.limit()`。SECURITY DEFINER RPC 改修 = migration を伴うため **Plan E では実装せず、別 plan 候補として §10.B に記録**。

**非破壊**: schema / RPC 不変。Plan C スコープ不変。Plan D gate 不変。E-1 と同じく stats ページを触るため、**E-1 の後に / または同時に整合**（同ファイルの set-state 修正と競合しないよう順序管理）。

**完了条件**: stats 初期表示が体感で速くなる（waterfall 解消）。フィルタ変更時の flash 軽減。回帰なし。lint/tsc/test/OpenNext build pass。

**触る候補ファイル**: `src/lib/actions/stats-actions.ts` / `src/app/dm/stats/page.tsx` / `src/app/pokepoke/stats/page.tsx` / `src/app/dm/home/page.tsx` / `src/app/pokepoke/home/page.tsx`。

---

### E-6: build marker（git SHA）注入 + live build 判定 runbook（P1）

**目的**: dev preview / production で「今どの git SHA が live か」を curl で確実に判定できるようにする（RD-E4 / RD-E5）。**`middleware.ts` を触らない**（CLAUDE.md 制約）。

**方式（RD-E5: meta tag 方式）**:

1. **build script**: `scripts/prepare-cloudflare-env.sh` に build SHA の export を追加（**12 桁に統一**）:
   - 元 SHA = `WORKERS_CI_COMMIT_SHA`（Cloudflare、full 40 桁）、無ければ local fallback `git rev-parse HEAD`（取れなければ `unknown`）。
   - **先頭 12 桁に truncate して export**（POSIX sh、`cut -c1-12`）。例:
     ```sh
     raw_sha="${WORKERS_CI_COMMIT_SHA:-$(git rev-parse HEAD 2>/dev/null || echo unknown)}"
     export NEXT_PUBLIC_BUILD_SHA="$(printf '%s' "$raw_sha" | cut -c1-12)"
     ```
   - これで Cloudflare（full→12 桁）も local（full→12 桁）も **常に 12 桁**で揃う。branch 分岐の内外どちらでも常に export する（staging / production 両方で marker を出す）。
2. **meta 出力**: `src/app/layout.tsx` の `<head>` 相当に静的 meta を追加（例: `<meta name="x-tierlog-build" content={process.env.NEXT_PUBLIC_BUILD_SHA ?? "unknown"} />`）。
   - `NEXT_PUBLIC_BUILD_SHA` は build 時 inline されるため、HTML を curl すれば稼働 SHA が見える（client hook 不要 = build 安全、§5.4）。
   - **secret 非漏洩確認（RD-E4）**: 出すのは **12 桁 git SHA のみ**。env 全体や内部設定は出さない。`NEXT_PUBLIC_SUPABASE_ENV` 等の既存 public 値と同列の非 secret。
3. **runbook**: `docs/runbooks/live-build-verification.md`（新規）に手順を明文化:
   - dev preview / production の HTML を curl → `x-tierlog-build` meta から **稼働 SHA（12 桁）**を取得 → `git rev-parse --short=12 HEAD`（push した commit の先頭 12 桁）と **完全一致**で突合（full SHA の先頭 12 桁 prefix 一致に相当）。
   - 既存の staging 汚染 curl チェック（`dev-duepure-tracker` / staging Supabase ref）と Cloudflare check-run 確認を併記（`cloudflare-rollback.md` と相互参照）。
   - 「preview URL が旧ビルドを serve している疑い」時の確定手順（marker SHA が push した SHA と一致するか）を記載。
4. （任意・要確認）`next.config` の `headers()` で `X-Tierlog-Build` レスポンスヘッダも出す案は、OpenNext がヘッダを honor するか build で確認できた場合のみ追加。**primary は meta tag**（確実・低リスク）。

**非破壊**: `middleware.ts` 不変。Plan B の OG / robots meta と別 meta なので干渉なし。`NEXT_PUBLIC_*` の追加は build 変数なので Cloudflare の Build variables 側に登録不要（git 由来の値）だが、**Cloudflare Workers Builds 環境で `WORKERS_CI_COMMIT_SHA` が実際に注入されるか preview deploy で確認**。

**完了条件**: dev preview / production の HTML を curl して稼働 git SHA が判別できる。runbook に手順が揃う。secret 非漏洩。lint/tsc/test/OpenNext build pass。

**触るファイル**: `scripts/prepare-cloudflare-env.sh` / `src/app/layout.tsx` / `docs/runbooks/live-build-verification.md`（新規）。

---

## 7. Plan A / B / C / D 非破壊確認

E-1〜E-6 が下記を **壊さない**ことを実装時に git diff と動作で確認する。

### Plan A
- **share image（Storage-only）**: `lib/share/image-url.ts` の `sanitizeShareImageUrl` / Storage path scheme（`/storage/v1/object/public/share-images/`）不変。Plan E は share を触らない。
- **auth next**: `lib/auth/redirect.ts` の `isSafeInternalPath` / `resolveAuthRedirectTarget` 不変（E-3 は redirect を変えない）。
- **BanGuard fail-open + retry**: `components/providers/BanGuard.tsx` の fail-open / retry backoff `[300,800]` / public path bypass / `stage===4` 判定 不変。E-1 が stats/home を触るが BanGuard 自体は触らない。

### Plan B
- **Sentry**: `sentry-worker.ts` の beforeSend scrubber / `sendDefaultPii: false` / environment・release 解決 不変。
- **OG**: `api/og/[id]/route.tsx` の `runtime="nodejs"` / fallback `/og-default.png` / 1200x630 / cache header 不変。
- **SEO**: `sitemap.ts` / `robots.ts` / `layout.tsx` の robots ロジック 不変。**E-6 の build meta は別 meta**で OG/robots と干渉しない。

### Plan C
- **format 一意 / read-RPC は p_format**: **E-5a の waterfall 統合で RPC params を変えない**（p_format のみ、p_game_title を足さない）。`game_title` スコープ・quality scoring stage 不変。

### Plan D
- **account_access_state / requireBearer / requireActiveUser**: 挙動不変。E-2 は test 追加のみ（実装変更なし）。
- **AuthExpiredError / handleAuthExpiredError / `tierlog:auth-expired` / AuthGuard 三重経路**: 不変。**E-4 はこの仕組みに乗る（経路 1 の catch 追加）だけ**で、event 名・class・helper を変えない。
- **AuthGuard の Suspense 境界**: 不変（E-3/E-4 で新規 `useSearchParams` を増やさない）。
- **BanGuard と AuthGuard の並列**（`layout.tsx`）: nesting 不変。

---

## 8. 統合検証（Plan E 全体）

Claude が自前で実施（ブラウザ不要）:

1. `npm run lint` → **0 problems**（E-1）。
2. `npx tsc --noEmit` → 0 error。
3. `npm test` → 既存 149 + E-2 新規分すべて pass。
4. `node -e "require('eslint-plugin-react-hooks/package.json').version"` と `package-lock.json` が **7.1.x で一致**（E-1）。
5. `npx opennextjs-cloudflare build` を local で通す（E-3/E-4/E-6 の client/build 変更が OpenNext build を壊さないこと）。
6. `dev` push 後、**Cloudflare check-run の成否を確認**（失敗ビルドは preview URL から不可視）。
7. preview URL を curl して **`x-tierlog-build` meta の SHA が push した SHA と一致**（E-6）。
8. `git diff` で Plan A〜D の保護ファイル（§7）に意図しない変更が無いこと。

ユーザー必須（実機ブラウザ）:
- deck 0 件アカウントで battle 画面の導線体感（E-3a）。
- Discord 連携開始失敗 / 解除 / refresh のエラー表示体感（E-4）。
- stats のフィルタ変更時 flash 軽減の体感（E-5c）。

---

## 9. 実装順序（推奨）

1. **E-1（lint + version 整合）を最初に**。以後の全変更が同じ厳格度の lint 下で書かれ、stats/battle/home の set-state 修正が E-3/E-4/E-5 と競合しないよう先に土台を固める。
2. **E-2（auth helper test）**。独立・低リスク。E-4 が AuthExpiredError に乗る前に helper 契約を test で固定。
3. **E-6（build marker）**。独立。以後の dev push で稼働 SHA を確認しながら進められる。
4. **E-3（空状態）→ E-4（Discord UX）**。UI 改善。E-1 後のファイルに対して当てる。
5. **E-5（perf）を最後に**。stats を触る E-1 と整合済みの状態で waterfall 統合 / 並列化 / flash 抑制。

各段階で `dev` push → check-run 確認 → preview 確認を挟む。

---

## 10. 未解決質問

### 10.A 実装着手前に解くべき質問

**該当なし**（lint / test / onboarding / 検証強化の 4 点は 2026-05-29 の AskUserQuestion で RD-E1〜E4 として確定済）。

### 10.B 後回しでよい質問（別 plan / 別フェーズ）

- **C-6 既存 `detection_alerts` 24 件**の TRUNCATE / rescan 判断（最後に別途）。
- **Discord callback の error 種別差別化**（`?discord=error_banned` 等）: auth-sensitive route の変更を伴うため別途。
- **unbounded opponent-deck / trend query の `.limit()`**: SECURITY DEFINER RPC 改修 = migration を伴うため別 plan。
- **component / hook test 基盤（jsdom / RTL）導入**と action/route integration test: 別 plan。
- **OpenNext build を CI に追加**: 時間・キャッシュ・環境差分調整が必要なため別 plan。

---

## 11. ローカル検証コマンド（Plan E 統合）

```bash
# 静的検証
npm run lint              # E-1: 0 problems 期待
npx tsc --noEmit          # 0 error
npm test                  # E-2: 既存 + 新規 auth-helper test pass

# version 整合確認 (E-1)
node -e "console.log(require('eslint-plugin-react-hooks/package.json').version)"
node -e "const l=require('./package-lock.json'); for(const k of Object.keys(l.packages||{})) if(/eslint-plugin-react-hooks/.test(k)) console.log(k,l.packages[k].version)"

# set-state-in-effect disable が最小範囲か (E-1)
git grep -n "eslint-disable.*set-state-in-effect"

# OpenNext build を local で通す (E-3/E-4/E-6)
npx opennextjs-cloudflare build

# build marker 確認 (E-6) — dev push 後。meta の値は 12 桁
curl -s https://dev-duepure-tracker.jianrenzhongtian7.workers.dev | grep -o 'x-tierlog-build[^>]*'
# 本番反映後
curl -s https://tierlog.app | grep -o 'x-tierlog-build[^>]*'
# 稼働 SHA(12桁) と push した commit を突合 (完全一致を確認)
git rev-parse --short=12 HEAD

# Plan A〜D 保護ファイルに意図しない差分が無いか (§7)
git diff --stat
git diff src/lib/share/image-url.ts src/lib/auth/redirect.ts src/components/providers/BanGuard.tsx \
         src/components/providers/AuthGuard.tsx src/lib/auth/require-bearer.ts src/sentry-worker.ts \
         src/app/api/og/[id]/route.tsx src/app/sitemap.ts src/app/robots.ts middleware.ts
```

---

## 12. Codex にレビューさせるべき観点

1. **E-1 の disable が最小範囲か / 挙動不変か**: file 全体 disable が無いか、refactor で消せた箇所を安易に disable していないか、setState 抑制が描画結果を変えていないか。特に `dm/home:90`（AuthGuard 連動の `loadData`）と stats（Plan C スコープ）に副作用が無いか。
2. **E-1 の lockfile bump 妥当性**: `eslint-plugin-react-hooks@7.1.x` pin が `eslint-config-next@16.2.6` と矛盾しないか、CI が 7.1.x で 0 になるか、他 transitive に波及しないか。
3. **E-2 の test が純粋性を保っているか**: `handleAuthExpiredError` の window stub / restore が他 test を汚染しないか、`environment: node` のままで成立するか。
4. **E-3 の deck 0 件導線が既存フローを壊さないか**: deck あり時の挙動不変、dm/pokepoke 両方に当たっているか、redirect を変えていないか。
5. **E-4 が Plan D の AuthExpiredError 契約に正しく乗っているか**: 経路 1（`handleAuthExpiredError`）の使い方が正しいか、`getSession()` を認可判断に転用していないか、callback の挙動を変えていないか。
6. **E-5 が Plan C スコープを破っていないか**: waterfall 統合で p_format のみ維持し p_game_title を足していないか、並列化で順序依存を壊していないか、turn-order 結果整形が不変か。
7. **E-6 が secret を漏らさないか / middleware を触っていないか**: meta に出るのが **12 桁 git SHA のみ**か、full SHA を script で確実に 12 桁 truncate できているか、`WORKERS_CI_COMMIT_SHA` が Cloudflare build で実際に取れるか、build 安全（client hook 非増加）か。
8. **build 落ち**: E-3/E-4/E-6 で `useSearchParams` 等を Suspense 無しで足していないか（Plan D `041b565` 再発防止）。

---

## 13. 想定タイムライン（参考）

| 段階 | 作業 | 目安 |
|---|---|---|
| 1 | E-1（lockfile + 25 件） | 0.5〜1 日 |
| 2 | E-2（auth helper test） | 0.5 日 |
| 3 | E-6（build marker + runbook） | 0.5 日 |
| 4 | E-3（空状態 polish dm/pokepoke） | 0.5〜1 日 |
| 5 | E-4（Discord UX） | 0.5 日 |
| 6 | E-5（perf） | 0.5 日 |
| - | 統合検証 + preview 確認 + 本番反映 | 0.5 日 |

DB migration が無いため Plan A〜D より短い見込み。

---

## 14. レビュー / 反映フロー

1. 本 plan を `/review-plan-loop` で plan-critic に検証 → 機械的指摘は自動修正、判断要は AskUserQuestion で escalate（着手前の 4 点は RD-E1〜E4 で解決済）。
2. plan-critic GO 後、Codex レビュー（§12 の観点）→ 反映 → 再 GO。
3. plan ファイルを `dev` に commit/push（Plan A〜D と同じ運用）。
4. 実装は別チャットで `dev` 上で実施 → preview 確認 → ユーザー「本番反映」指示後に `main` merge。

---

## 15. 補足

- 本 plan は **DB を一切触らない**ため、Plan A〜D で最もリスクが低い。検証も local（lint/tsc/test/OpenNext build/curl）でほぼ完結する。
- E-1 の version 整合は「local だけ赤」という再発しやすい状態を構造的に潰すもので、公開後の品質ゲート維持に効く。
- E-6 の build marker は、Plan D で経験した「preview/本番がどのビルドか分からない」事故クラスへの恒久対策（curl 1 発で稼働 SHA 判別）。

---

## Resolved Decisions

- **RD-E1（lint 25 件）**: 全 25 件修正 + `eslint-plugin-react-hooks` version 整合（`package.json` に `eslint-plugin-react-hooks` を **`7.1.1` exact pin**（caret なし）で追加し lockfile を 7.1.1 に固定、CI でも検知。`ci.yml` は触らない）。refactor 優先、mount 時 data load 等やむを得ない箇所は理由付きの最小範囲 disable を許可、**file 全体 / blanket disable は禁止**。lockfile / package manager 整合も plan に含める。目的は「local 赤 / CI green の blind spot」を公開前に解消すること。
- **RD-E2（test 範囲）**: Plan D auth helper の純関数のみ（`isMissingFunctionError` / `AuthExpiredError` / `handleAuthExpiredError`）。**jsdom / RTL の component test 基盤・action/route integration・既存 util の機会的拡大はしない**。
- **RD-E3（onboarding）**: 空状態 polish のみ。deck 0 件時の battle 導線、empty-state CTA 一貫化、dm/pokepoke 同品質。**初回 welcome ウィザード新設 / 強制 redirect / 大きな onboarding flow / Discord 中心 home の全面 redesign はしない**。
- **RD-E4（検証強化）**: build marker（git SHA → header または meta）+ live build 判定 runbook。**OpenNext build を CI に追加しない / CI-CD 全体再設計しない / Cloudflare dashboard 操作前提の手順に依存しない**。marker が secret・内部情報を漏らさないことを確認。
- **RD-E5（build marker 方式）**: meta tag 方式を primary とする。`scripts/prepare-cloudflare-env.sh` で `NEXT_PUBLIC_BUILD_SHA` を **12 桁に統一**して build 時 inline（`WORKERS_CI_COMMIT_SHA` の full 40 桁を `cut -c1-12`、local は `git rev-parse HEAD` の先頭 12 桁 fallback）し、`layout.tsx` の静的 meta に出す。検証は meta の 12 桁と `git rev-parse --short=12 HEAD` の完全一致で突合。**`middleware.ts` は触らない**（CLAUDE.md 制約）。Cloudflare 変数名は 2026-05-29 公式ドキュメントで確認済（`WORKERS_CI_COMMIT_SHA` = full SHA / `WORKERS_CI_BRANCH`）。`next.config` の response header 案は OpenNext が honor する場合のみ任意追加。
- **RD-E6（perf 範囲）**: stats turn-order waterfall 統合 + mount 時メタデータ並列化 + loading flash 抑制（いずれも client 側、RPC/schema 不変、Plan C の p_format スコープ維持）。**unbounded query への `.limit()` は SECURITY DEFINER RPC 改修 = migration を伴うため Plan E では実装せず investigate のみ**（§10.B）。
- **RD-E7（Discord 範囲）**: client 側のエラー表示改善のみ（alert→非ブロッキング、disconnect/refresh 失敗 surface、refresh 時の `AuthExpiredError` を経路 1 で catch）。**`/api/discord/callback` の redirect 意味論・error reason 差別化は変更しない**（auth-sensitive、§10.B）。`getSession()` は token 取得用で認可判断への転用ではない（現状維持）。
- **RD-E8（DB 非接触）**: Plan E 全体で **DB migration・production DB 変更・C-6 detection_alerts に一切触れない**。rollback は Cloudflare Deployments のコード巻き戻しで完結。
