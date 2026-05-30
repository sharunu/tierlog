# 実装報告書: Plan E Pre-Public UX / Stability Polish 本番反映完了

- 報告日: 2026-05-30
- 対象 plan: `docs/plans/2026-05-29_plan_e_pre_public_ux_stability_polish.md`
- 前提 plan（すべて本番反映済・非破壊維持）:
  - Plan A: Public Launch Safety（`docs/reports/2026-05-27_plan_a_public_launch_safety_completion.md`）
  - Plan B: Observability / OG / SEO
  - Plan C: Multi-Game DB Scope（`docs/reports/2026-05-28_plan_c_multi_game_db_scope_completion.md`）
  - Plan D: Access Gate / Auth Expiry（`docs/reports/2026-05-29_plan_d_access_gate_auth_expiry_completion.md`）
- ステータス: **dev 実装 + Codex review (P0/P1 なし・P2 1 件反映) + dev preview 検証 + main 反映 + 本番 build success + 本番 marker / smoke 確認まで完了**
- 性格: 公開前の UX 仕上げと安定性・検証強化。**DB migration を一切伴わない**（client コード / build script / unit test / docs のみ）。Plan A〜D の挙動は非破壊で維持。
- 関連 commit（新しい順）:
  - `0037b77 Merge branch 'dev'`（**main 本番反映**、Cloudflare build green、本番 live、2026-05-30。short=12 = `0037b77492c1`）
  - `e480660 fix(plan-e): Codex P2 反映 — handleDiscordConnect の getSession null を AuthExpiredError 経路へ`
  - `72ae12f feat(plan-e): Pre-Public UX / Stability Polish (E-1〜E-6)`

---

## 1. サマリ

公開前の UX 仕上げ・安定性・検証強化を行う Plan E（E-1〜E-6）を dev で実装し、Codex review（P0/P1 なし・P2 1 件を反映）を経て、dev preview 検証後に main `0037b77` で本番反映した。**DB migration はゼロ**で、production DB / staging DB のスキーマ変更・C-6 既存 `detection_alerts` 24 件には一切触れていない。

主要成果:
- **E-1**: lint 25 件（`react-hooks/set-state-in-effect`）を解消し、`eslint-plugin-react-hooks` を **7.1.1 exact pin** で固定。「local 赤 / CI green」の blind spot を構造的に解消（CI も 7.1.1 で検知）。
- **E-2**: Plan D auth helper の純関数 unit test を追加（test 149 → 161）。
- **E-3**: deck 0 件時に battle フォームが無言で機能不全になる問題を修正（「先にデッキ登録」導線）+ 空状態 CTA 一貫化（dm/pokepoke 両対応）。
- **E-4**: Discord 連携 UX のエラー表示改善（`alert()` → 非ブロッキング表示、失敗 surface、AuthExpiredError 連動）。
- **E-5**: stats RPC waterfall の Promise.all 統合 + loading flash 抑制（RPC/schema 不変、p_format スコープ維持）。
- **E-6**: build marker（git SHA）注入 + live build 判定 runbook。本番/preview で稼働 commit を curl 1 発で判別可能に。

---

## 2. 実装内容（E-1〜E-6）

### E-1: lint 25 件解消 + `eslint-plugin-react-hooks` version 整合

**背景**: local `node_modules` は `eslint-plugin-react-hooks@7.1.1`、lockfile は `7.0.1`（`eslint-config-next` 経由の transitive dep、`^` 範囲で skew）。CI は `npm ci`（lockfile 厳守）で 7.0.1 を入れるため lint 0 件・green だが、local は 7.1.1 で 25 件赤。lockfile が将来 7.1.x に上がった瞬間 CI が突然 red 化する blind spot だった。

**対応**:
- `package.json` の devDependencies に **`"eslint-plugin-react-hooks": "7.1.1"`（exact pin、caret なし）**を明示追加し、`package-lock.json` を 7.1.1 に固定。lockfile 差分は当該 1 件のみで他 transitive は不動。これで CI の `npm ci` も 7.1.1 を入れ、以後 `set-state-in-effect` を CI が検知する。
- 25 件の disable を **最小範囲で復元**。これらは commit `0aca978`（2026-05-25、Sentry install 後に plugin が 7.0.1 へ再解決され unused 判定で削除されていた）が削除した directive 群であり、`git revert` で正確に復元。単一 setState は `// eslint-disable-next-line`、同一 effect 内に複数 setState がある箇所は `/* eslint-disable */ … /* eslint-enable */` ブロック、全件 理由コメント付き。**file 全体 disable / blanket disable は不使用**。
- これらは 2026-05-24 lint 解消フェーズ（`docs/reports/2026-05-24_lint_errors_resolution.md`）で「派生 state 化不可（pattern A/C: mount 時 URL/localStorage/cookie resolve・外部状態同期 reset・useCallback fetch トリガー）」と確定済の同型ケースで、plan が disable を許可した範囲。挙動不変（描画結果・state 遷移を変えない）。

**触ったファイル**: `package.json` / `package-lock.json` + 12 ファイル（`account/page.tsx` / `account/security/page.tsx` / `admin/general-settings/page.tsx` / `dm/home` / `pokepoke/home` / `dm/stats` / `pokepoke/stats` / `AdminUserBattles` / `AdminUserStats` / `FeedbackList` / `OpponentDeckManager` / `BattleRecordForm` / `EditBattleModal`）。

### E-2: Plan D auth helper の純関数 unit test 追加

I/O なしで書ける Plan D helper の純関数のみを test（jsdom / RTL / integration は不導入、`environment: node` 維持）。

- `src/lib/auth/require-bearer.test.ts` — `isMissingFunctionError`（PGRST202 / "Could not find the function" / "schema cache" / "function"+"does not exist" → true、network/permission・null/空 → false、境界網羅）。
- `src/lib/errors/auth-expired-error.test.ts` — `AuthExpiredError`（name / message `auth_expired: <reason>` / reason 保持 / instanceof Error）、`handleAuthExpiredError`（SSR=false・dispatch なし / `window` を `vi.stubGlobal` で stub し AuthExpiredError → true + `tierlog:auth-expired` を `detail.reason` 付きで 1 回 dispatch / 非 AuthExpiredError → false）。`vi.unstubAllGlobals` で復元し他 test を汚染しない。

**結果**: test 8 files / 149 → **10 files / 161 pass**（+12）。

### E-3: Onboarding / 空状態 polish（dm/pokepoke 両対応）

- **E-3a（最優先）**: `BattleRecordForm.tsx` で `decks.length === 0` のとき、フォームの代わりに「まずは使用デッキを登録しましょう」+「デッキを登録する」導線（`/{game}/decks`）を表示。従来は deck 0 件だと `handleSubmit` の `if (!deckId …) return;` で **submit が無言で何もしない**機能不全だった。全 hooks の後の early return なので hooks 順序は不変。
- **E-3b**: 空状態 CTA の一貫化。`BattleHistoryList.tsx` の「対戦履歴がありません」プレーンテキストを、readOnly（admin）/ deck フィルタ文脈に応じた一貫文言（カード化）へ。`DeckList.tsx`（dm/pokepoke）の空状態を「下の『デッキを追加』から登録」へ誘導。
- `BattleRecordForm` / `BattleHistoryList` は共有コンポーネントのため dm/pokepoke 両対応、`DeckList` は両ファイル個別に同一変更。redirect ロジック（`lib/auth/redirect.ts`）は不変、welcome ウィザード・強制 redirect・home redesign はしない。

### E-4: Discord 連携 UX のエラー表示改善（client 側のみ）

`src/app/dm/home/page.tsx` / `pokepoke/home/page.tsx`:
- **E-4a**: `handleDiscordConnect` の `alert()` を**非ブロッキング inline banner**（dismiss 可、`role="alert"`）へ。
- **E-4b**: `handleDisconnect` の失敗（`disconnectDiscord()` が false / throw）を surface。`AuthExpiredError` は `handleAuthExpiredError(e)` で経路 1 へ。
- **E-4c**: `handleManualRefresh` の `refreshGuilds()` 失敗を surface。`getMyTeamsWithVisibility()` を try/catch で包み、JWT 失効時の **`AuthExpiredError` を経路 1 で捕捉**（従来は経路 2 の unhandledrejection 頼みだった）。
- **E-4d**: `handleToggleVisibility` の失敗も同方針で surface。
- `getSession()` は **Bearer token 取得用**のまま（認可判断に転用せず、Plan D 制約遵守）。`/api/discord/*` route の挙動・callback の redirect 意味論・access gate は不変。

### E-5: パフォーマンス / 体感速度（client 側のみ、schema 改修なし）

- **E-5a**: `getGlobalStatsByRange` / `getTeamStatsByRange`（`stats-actions.ts`）の turn-order RPC（`get_global_turn_order_stats_range` / `get_team_turn_order_stats_range`）を先頭の `Promise.all` に統合し **3 本並列化**（従来は別 await で直列）。params は既存と同一（**p_format スコープ維持、p_game_title は足さない**）、結果整形ロジック不変。
- **E-5c**: stats の loading flash 抑制。`loadedKey`(scope+view) を導入し、skeleton は「初回 or データソース（scope/view）切替時のみ」表示、同一 scope+view 内の format/range/filter 変更では前データを残す（別 scope データの誤表示は回避）。dm/pokepoke 両対応。
- **E-5b（調査結果）**: stats の mount メタデータ取得は既に並列（fire-and-forget）、home の `auth.getUser()` → `getDiscordConnection()` は実依存（conn は valid user 前提）のため、plan の「順序依存が無いことを確認してから」条件に従い追加並列化はしない。
- **investigate のみ（不実装）**: unbounded opponent-deck / trend query への `.limit()` は SECURITY DEFINER RPC 改修 = migration を伴うため Plan E では実装せず（別 plan 候補）。

### E-6: build marker（git SHA）注入 + live build 判定 runbook

- `scripts/prepare-cloudflare-env.sh` に `NEXT_PUBLIC_BUILD_SHA` の export を追加（**12 桁統一**）。Cloudflare は `WORKERS_CI_COMMIT_SHA`（full 40 桁、2026-05-29 公式 docs で確認）を `cut -c1-12`、local fallback は `git rev-parse HEAD` の先頭 12 桁、取れなければ `unknown`。branch 分岐の外で常時 export（staging / production 両方で marker を出す）。
- `src/app/layout.tsx` の `metadata.other` で `<meta name="x-tierlog-build" content={NEXT_PUBLIC_BUILD_SHA ?? "unknown"} />` を SSR HTML に出力。build 時 inline のため curl で稼働 SHA が判別でき、client hook を増やさない（build 安全）。出すのは**非 secret な 12 桁 git SHA のみ**。
- `docs/runbooks/live-build-verification.md`（新規）: curl → SHA 突合（`git rev-parse --short=12 HEAD` と完全一致）、Cloudflare check-run 確認、「旧ビルド serve 疑い」の確定手順、staging 汚染チェックとの併用を明文化。
- **`middleware.ts` は不変**（CLAUDE.md 制約）。Plan B の OG / robots meta とは別 meta で干渉なし。

---

## 3. Codex review 結果と P2 修正

- **P0 / P1: なし**。
- **P2（1 件、反映済 `e480660`）**: `handleDiscordConnect`（dm/home・pokepoke/home）で `getSession()` が null（JWT 失効等で token 取得不可）のとき無言 return しており、失効後に「Discordと連携する」を押すと無反応になりうる問題。Plan D / D-5 経路 1 に流すよう修正:
  - `AuthExpiredError` を import に追加。
  - `if (!session) { handleAuthExpiredError(new AuthExpiredError("discord_connect")); return; }` を dm / pokepoke 両方に適用。
  - `getSession()` は依然 token 取得用であり、認可判断は `/api/discord/start` の `requireBearer`（`getUser` 検証）が担うため Plan D 制約に抵触しない。
- 修正後の Codex 再レビューで追加指摘なし。dm/pokepoke home の正規化 diff は既存差分（game slug / draws 表示）のみで、P2 修正は両ファイル完全一致。

---

## 4. dev preview 確認結果（dev `e480660`）

Claude 自前検証（ブラウザ不要）:

| 検証 | 結果 |
|---|---|
| `npm run lint` | **0 problems** |
| `npx tsc --noEmit` | **0 error** |
| `npm test` | **161 passed**（149 + E-2 新規 12） |
| `npx opennextjs-cloudflare build` | **成功**（`.open-next/worker.js` 生成、Suspense/useSearchParams 起因の build 落ちなし）。prerendered HTML に `x-tierlog-build` meta = 12 桁 SHA を確認 |
| `eslint-plugin-react-hooks` version | **7.1.1**（package.json / package-lock / node_modules 一致） |
| set-state-in-effect disable | next-line / block のみ、file 全体 disable なし |
| dev push 後 Cloudflare `Workers Builds` + CI | **両 success** |
| dev preview `x-tierlog-build` marker | 期待 `e48066083f94` ＝ **一致**（preview URL 目視ではなく build status + marker で live 判定） |
| 主要 11 ページ smoke | 全 **200** |
| Plan E 重点（live source + client chunk） | deck-0 CTA / discord_connect AuthExpiredError / stats `loadedKey` の存在を確認 |

ユーザー実機確認（ブラウザ必須）: deck 0 件アカウントでの CTA 実描画 / JWT 失効時の Discord 連携 → `/auth` redirect / stats フィルタ変更時の flash 軽減 — いずれもユーザー側で問題なしと判断。

---

## 5. 本番反映結果

- **手順**: `git checkout main && git pull origin main`（Already up to date）→ `git merge dev --no-edit`（main は dev と分岐のため **merge commit `0037b77`** 作成）→ `git push origin main`（初回 network reset → 再試行で成功 `1ad5657..0037b77`）→ Cloudflare 本番 build → 本番 marker / smoke 確認 → `git checkout dev`。
- **main HEAD**: `0037b77492c125717d562bb0fd83293a0e2eff75`（short=12 = **`0037b77492c1`**）。merge 対象は Plan D 完了報告 + Plan E plan/impl/P2 の 4 commit のみ。

| 確認項目 | 結果 |
|---|---|
| Cloudflare `Workers Builds: duepure-tracker`（commit `0037b77`） | **completed / success** |
| GitHub Actions `lint + typecheck + test`（同 commit） | **completed / success** |
| 本番 `https://tierlog.app` の `x-tierlog-build` marker | 期待 `0037b77492c1`（= main HEAD 12 桁、merge commit のため `e480660` ではない）＝ **一致（初回 MATCH）** |
| 本番主要 11 ページ smoke（`/` `/dm/home` `/dm/battle` `/dm/decks` `/dm/stats` `/pokepoke/home` `/pokepoke/battle` `/pokepoke/decks` `/pokepoke/stats` `/account` `/auth`） | 全 **200** |
| 本番が dev/staging ビルドを誤 serve していないか | `dev-duepure-tracker` ref が `/` `/auth` ともに **0 件**（+ marker = main merge commit）→ 正しい本番ビルドを serve |

build 失敗での停止フロー（D-2/D-3 時の旧ビルド serve 確認）には入っていない。

---

## 6. Plan A〜D 保護対象 regression なし

`git diff 1ad5657..0037b77`（旧 main → 新 main）で以下の保護ファイルの差分が**空**であることを確認:

`src/lib/share/image-url.ts` / `src/lib/auth/redirect.ts` / `src/components/providers/BanGuard.tsx` / `src/components/providers/AuthGuard.tsx` / `src/lib/auth/require-bearer.ts`（E-2 で test を追加したが本体不変）/ `src/sentry-worker.ts` / `src/app/api/og/[id]/route.tsx` / `src/app/sitemap.ts` / `src/app/robots.ts` / **`src/middleware.ts`** / `src/app/auth/callback/page.tsx` / `src/lib/supabase/client.ts`

- Plan A（share image storage-only / auth next / BanGuard fail-open）、Plan B（Sentry / OG / SEO）、Plan C（read-RPC は p_format スコープ・game_title 分離）、Plan D（account_access_state / requireBearer / AuthExpiredError / AuthGuard）の挙動・契約は不変。
- E-5a の waterfall 統合は RPC params を変えず（p_format のみ、p_game_title 不追加）、Plan C スコープを破っていない。E-4 は Plan D の AuthExpiredError 仕組みに**乗るだけ**（event 名 / class / helper を変えない）。

---

## 7. DB / C-6

- **DB migration ゼロ**: `1ad5657..0037b77` で `supabase/migrations/` の変更なし。production DB / staging DB のスキーマ変更は一切なし。
- **C-6 既存 `detection_alerts` 24 件は不触**: Plan E diff 内に `detection_alerts` への言及ゼロ。TRUNCATE / rescan 判断は引き続き別途。

---

## 8. rollback 方針

Plan E は **DB を一切触らない**ため、万一の本番不具合時の rollback は **Cloudflare Deployments のコード rollback のみで完結**する（migration の巻き戻し不要）:

1. Cloudflare Dashboard → Workers & Pages → duepure-tracker → Deployments
2. 直前の正常 deployment を **Rollback**（数秒で本番反映）
3. `docs/runbooks/cloudflare-rollback.md` §1 の curl チェック（`dev-duepure-tracker` / staging ref が 0）と `docs/runbooks/live-build-verification.md` の marker 突合で復旧確認

lockfile 変更（E-1）も revert commit で戻せる。

---

## 9. 関連ファイル / commit

- plan: `docs/plans/2026-05-29_plan_e_pre_public_ux_stability_polish.md`
- 新規 runbook: `docs/runbooks/live-build-verification.md`
- 新規 test: `src/lib/auth/require-bearer.test.ts` / `src/lib/errors/auth-expired-error.test.ts`
- commit: `72ae12f`（本体）→ `e480660`（Codex P2）→ `0037b77`（main 本番反映 merge commit）
- 本番 live marker: `0037b77492c1`（`https://tierlog.app` の `x-tierlog-build` meta）
