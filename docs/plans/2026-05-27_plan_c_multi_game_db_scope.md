# Plan C: Multi-Game DB Scope

- 作成日: 2026-05-27
- 作成者: Claude Code (Opus 4.7)
- 元レポート: `docs/reports/2026-05-27_integrated_pre_public_monetization_audit.md` §4.4
- Plan A 完了報告: `docs/reports/2026-05-27_plan_a_public_launch_safety_completion.md`
- Plan B 完了報告: `docs/reports/2026-05-27_plan_b_observability_og_seo_completion.md`
- ステータス: **完成 / 実装可能水準** (plan-critic 累計 13 反復 + Codex 第 1 回 / 第 2 回 / 第 3 回 / 第 4 回指摘反映完了、未解決質問ゼロ、設計矛盾ゼロ)
- 想定ブランチ: `dev`
- **本 plan ファイルの取り扱い**:
  - 本 plan は **plan 作成専用チャット** で作成。実装は **別チャット** で開始する設計。
  - **本 plan 作成チャットでは実装に入らない**。コード編集 / DB 変更 / migration 適用 / commit / push / 外部サービス操作 / Supabase ダッシュボード操作は一切しない。plan ファイル編集のみ。
  - **production Supabase DB への操作は禁止**。staging DB への変更も本 plan 作成チャットでは行わない。
  - 実装着手は、ユーザーが別チャットで「実装してください」と明示指示した時点から開始する。`AGENTS.md` / `CLAUDE.md` / 本 plan §2 を実装チャットで再度参照する。

---

## 0. 目的とスコープ

統合 audit §4.4 (P1: マルチゲーム DB スコープ混入) で指摘された、`get_team_member_summaries` / detection 系 / quality scoring 系 の game scope 漏れを実装可能な単位に整理する。Plan A (UI / route 中心 + `shares.image_url` 二段防御) / Plan B (Sentry / OG / SEO) が本番反映済の前提で、それらを **壊さずに** DB / RPC レイヤの game_title 分離を進める。

### 含めるもの

- C-1 `get_team_member_summaries` の game scope 修正 (チームメンバー戦績集計時に dm/pokepoke 混入を防ぐ) (P1)
- C-2 detection 関数 (`detect_extreme_winrate` / `detect_rapid_input` / `detect_repetitive_pattern`) の game_title 対応 (P1)
- C-3 `_run_detection_scan_internal` の game × rule 二重ループ化 + `detection_alerts.game_title` を default 'dm' から脱却 (P1)
- C-4 `_calculate_quality_score_internal` / `_run_quality_scoring_internal` の game scope 化 (P1)
- C-5 `quality_score_snapshots` のキーに `game_title` 追加 (`(user_id, game_title) UNIQUE`) (P1)
- C-6 既存 detection_alerts / quality_score_snapshots の data migration 方針確定 (一般公開前なのでクリーンスタート可能か Resolved Decisions で確定) (P1)

### 含めないもの (別 plan)

- **Plan A / Plan B で完了済の再実装は禁止**: `shares.image_url` 二段防御 / legacy URL / `<HomeLink />` / BanGuard retry+fail-open / 共通 `LoadingSpinner` / `loading.tsx` / `global-error.tsx` / `auth/page.tsx` の `game/next` 引き継ぎ / `open redirect helper` / Sentry scrubber / OG フォント自前 / public landing / sitemap 整理 / B-3 `X-Robots-Tag` / `/share/[id]` `robots: noindex,follow` / B-4-e BanGuard exact + prefix 二段判定。
- 読み取り系 RPC (`get_*_stats_range` / `get_*_detail_stats` / `get_*_trend_range` 等) への `p_game_title` 追加: **本 plan では実施しない**。AGENTS.md の方針通り、`p_format` で game scope される前提を維持する。
- 書き込み系 RPC `auto_add_opponent_deck` / `recalculate_opponent_decks` / `run_daily_opponent_deck_batch` / `sync_team_membership` への `p_game_title` 追加: **既に実装済** (multi_game_stage1a-c migration で完了)。本 plan では再修正しない。
- format code がゲーム間で重複しないこと: **既存方針として維持**。崩す対応は Plan C ではなく別 plan に分離。
- `detection_rules` / `quality_scoring_rules` / `quality_scoring_settings` のグローバル設定を game 別にする: **本 plan では実施しない** (グローバル設定として継続。game 別化が必要になったら Phase 2 で別 issue 化)。詳細は §10.B 参照。
- Plan D (Access Gate / Auth Expiry): ban / suspended / unpaid 強制、`getUser()` 用途整理、middleware session refresh は別 plan。
- Plan E (Phase 2): 初回オンボーディング / `recharts` lazy / Discord refresh / `npm test` 復旧。
- Phase 3 (Billing / Ads / Legal): Stripe / consent UI / 特商法ページ。

---

## 1. 関連 plan との依存関係

| Plan | 内容 | Plan C との関係 |
|---|---|---|
| **Plan A (完了)** | UI/route + `shares.image_url` 二段防御 | 非依存。Plan C は DB/RPC レイヤのみで Plan A の UI / route 既存挙動を変更しない |
| **Plan B (完了)** | Sentry / OG / SEO | 非依存。Plan C は `next.config.ts` / Sentry / OG route を touch しない |
| **Plan C (本 plan)** | Multi-Game DB Scope | — |
| Plan D: Access Gate / Auth Expiry | ban / suspended / unpaid 強制、middleware session refresh | 関連あり。**Plan C の quality scoring が `profiles.stage` を更新する経路は Plan D の access gate と接続する**ため、Plan D 設計時に再評価。Plan C は現行の `profiles.stage` 更新ロジックを game-scoped に修正するのみ |
| Plan E (Phase 2) | onboarding / perf / Discord / test 復旧 | Plan C 後 |
| Phase 3 plan | billing / ads / consent / legal | 独立 |

**実装順序の推奨**: Plan B 完了後、Plan C を独立して進められる。Plan D は Plan C 完了後に着手するのが安全 (quality scoring → stage → access gate の経路整合性を取りやすい)。

---

## 2. プロジェクト固有ルールの厳守事項

`AGENTS.md` / `CLAUDE.md` から本 plan に直結する制約:

- **`main` への直接 push 禁止**。全変更を `dev` ブランチで実装し、ユーザーの「本番反映」明示指示を待ってから `main` へ merge する。
- **`dev` への commit/push は実装完了時点で Claude が自動実施可**。本番影響なし。
- **production Supabase DB 変更は禁止**。本 plan 作成チャットでは staging DB への変更もしない。
- **production migration 適用はユーザーの明示指示があるまで禁止**。staging 適用 → dev preview 検証 → ユーザー承認 → production 適用の順序を厳守。
- **既存本番コードに無害な additive expand migration** (例: nullable / default 付きの列追加、既存挙動を変えない追加テーブル / 列) は、staging 適用 + dev preview 検証 + ユーザーの明示承認があれば code deploy 前に production 先行適用可。**破壊的変更 (制約強化 / 列削除 / 既存値変換) は本 plan では避け**、必要なら expand → code deploy → contract の分割手順で扱う。
- **既存 auth 設定 (implicit flow / `client.ts` / `middleware.ts` / `auth/callback/page.tsx`) は変更しない**。
- **`getUser()` を `getSession()` に一括置換しない**。
- **任意外部 `image_url` を再許可する方向に戻さない** (Plan A の二段防御を維持)。
- **Plan A / Plan B 完了済の機能 (`shares.image_url`, auth `game`/`next`, BanGuard retry+fail-open, legacy URL, Sentry scrubber, OG フォント自前, public landing, noindex, `<HomeLink>`, `loading.tsx`/`global-error.tsx`) は再実装しない**。
- **URL ハードコード禁止**。`process.env.NEXT_PUBLIC_APP_URL` か `window.location.origin` 経由。
- **Runtime secret は `getServerEnv()` 経由**。
- **読み取り系 RPC全体への `p_game_title` 追加は禁止**。`p_format` で game scope される前提を維持。format code 重複の前提を崩す対応は別 plan。
- **Cloudflare / Supabase / Sentry 等の外部サービス dashboard 操作は本 plan 作成チャットでは実施しない**。
- **dashboard 操作手順を plan に含める場合は、必ず公式ドキュメント確認 (WebFetch) を前提条件として明記する**。

---

## 3. 現状調査

### 3.1 関連 migrations / SQL functions

| 領域 | ファイル / 関数 | 現状 game_title 対応 |
|---|---|---|
| Team summary | `supabase/migrations/20260424000001_security_hardening_additive.sql:375` の `public.get_team_member_summaries(p_team_id uuid)` (最新版) | **❌ format / game_title フィルタなし**。`team_id` 経由でメンバー取得後、`battles` を全 game 横断で集約 |
| Detection 関数 | `supabase/migrations/20260509000001_secure_rpc_permissions.sql:211-` の `detect_extreme_winrate(p_params jsonb)` / `detect_rapid_input(p_params jsonb)` / `detect_repetitive_pattern(p_params jsonb)` (SECDEF 化最新版) | **❌ `p_params` のみで game_title フィルタなし**。`FROM public.battles b JOIN public.profiles p` のみ |
| Detection runner | 同 migration の `public._run_detection_scan_internal()` | **❌** game 別ループなし。`INSERT INTO public.detection_alerts (user_id, rule_key, details)` で game_title 未指定 → default `'dm'` に固定 |
| Quality scoring | 同 migration の `public._calculate_quality_score_internal(p_user_id uuid)` (L371) / `public._run_quality_scoring_internal(p_auto_update boolean)` (L535) | **❌ user 単位で battles を全 game 横断で集約**。`profiles.stage` を user 単位で更新 |
| detection_alerts スキーマ | `supabase/migrations/20260419000001_multi_game_stage1a_schema.sql:15-18` で `game_title text NOT NULL DEFAULT 'dm'` 追加済 + `alerts_game_idx` インデックス済 | ✅ スキーマは対応済。しかし runner が常に default 'dm' を使う |
| teams スキーマ | `supabase/migrations/20260419000001:11` で `game_title text NOT NULL DEFAULT 'dm'` 追加、`(discord_guild_id, game_title) UNIQUE` 制約済 | ✅ 対応済。dm/pokepoke で別 team が作られる |
| team_members スキーマ | `supabase/migrations/20260406000001_discord_teams.sql:25` 由来、`(team_id, user_id) UNIQUE` | **❌ `game_title` 列なし**。`get_team_member_summaries` で混入が起きる根本原因 |
| opponent_deck_master スキーマ | `supabase/migrations/20260419000001:8` で `game_title text NOT NULL DEFAULT 'dm'` 追加、`(name, format, game_title) UNIQUE` | ✅ 対応済 |
| opponent_deck_settings | `supabase/migrations/20260419000001` 系で `game_title` 列追加 + UNIQUE 制約見直し済 | ✅ 対応済 |
| quality_score_snapshots | `supabase/migrations/20260414000001_quality_scoring.sql:20` 由来、`user_id` PRIMARY KEY または UNIQUE | **❌ `game_title` 列なし**。1 ユーザー 1 行で全 game 混在の score を保持 |
| detection_rules | `supabase/migrations/20260412000007_user_stages.sql:17` 由来 | グローバル設定として継続 (game_title 列なし、本 plan スコープ外) |
| quality_scoring_rules | `supabase/migrations/20260414000001:6` 由来 | グローバル設定として継続 (game_title 列なし、本 plan スコープ外) |
| quality_scoring_settings | `supabase/migrations/20260414000001:41` 由来 | グローバル設定として継続 (game_title 列なし、本 plan スコープ外) |

### 3.2 関連 actions / admin UI / scripts

| ファイル | 関連箇所 | Plan C 影響 |
|---|---|---|
| `src/lib/actions/team-actions.ts:174` | `supabase.rpc("get_team_member_summaries", { p_team_id })` 呼び出し | **C-1 で呼び出し側引数を追加するか判断**。team JOIN 経由で teams.game_title を解決する方式なら client 側変更不要 |
| `src/app/api/internal/detection-scan/route.ts:22` | `supabase.rpc("run_detection_scan")` (cron / admin 用、Args: never) | **C-3 で wrapper signature を維持** (cron で `Args: never` 前提のため引数追加不可)。内部で `_run_detection_scan_internal()` が game × rule の二重ループで全 game を回る形にする |
| `src/lib/actions/admin-actions.ts:734` | `supabase.rpc("run_detection_scan")` (admin 手動実行) | 同上、wrapper signature 維持 |
| `src/lib/actions/admin-actions.ts:854` | `supabase.rpc("run_quality_scoring", { p_auto_update })` | **C-4 で wrapper signature を維持**。内部で `_run_quality_scoring_internal` が game × user を回る形にする |
| `src/lib/actions/admin-actions.ts:863` | `supabase.rpc("calculate_quality_score", { p_user_id })` (admin 手動) | **C-4 で `p_user_id` のみ維持**。内部で全 game の score を更新する方式 |
| `src/lib/actions/admin-actions.ts:689-722` | `from("detection_alerts").select / update` (admin alert 管理 UI) | **C-3 で `game_title` フィールドが正しく入る** ため admin UI 側変更不要 (列を表示するなら別途) |
| `src/lib/actions/admin-actions.ts:794` | `from("quality_score_snapshots").select("*").eq("user_id", userId).single()` (admin の `getQualityScoreSnapshot`) | **C-5 で複合キー化されると `.single()` が PGRST116 で throw する**。C-5 と同 PR で **`.single()` を撤去**し、全件取得 → `total_score` 最大 row を既存 UI shape で返す形に修正 (Codex 第 4 回確定、RD-C3 account-level MAX と整合、§6 C-5 リスク 2 参照) |
| `src/lib/actions/account-actions.ts:174-188` | `from("quality_score_snapshots").select("total_score, breakdown").eq("user_id", user.id).single()` (ユーザー用 `getMyQualityScore`) | **C-5 で複合キー化されると `.single()` が PGRST116 で throw する**。C-5 と同 PR で **`.single()` を撤去**し、自分の全 game snapshot から `total_score` 最大 row を返す形に修正 (既存戻り値 shape `total_score, breakdown` 維持、`breakdown.max_score_game_title` 経由で game 別情報を参照可能、§6 C-5 リスク 2 参照) |
| `src/lib/supabase/database.types.ts` | RPC / table 型定義 (autogen) | **C 全体で型再生成必要** (`supabase gen types typescript` 等、実装チャットで実施) |

### 3.3 game_title / format / team_id / discord_guild / opponent deck の関連整理

```
discord_guild_id
  └─> teams (discord_guild_id, game_title) UNIQUE
       └─> team_id (uuid)
            └─> team_members (team_id, user_id) UNIQUE
                 └─> user_id
                      └─> battles (user_id, format, game_title, opponent_deck_name, ...)
                            ↑ ここで game_title が分離されているが、team_members 経由で参照する時に
                              team.game_title と battles.game_title を AND しないと混入する
```

`opponent_deck_master` / `opponent_deck_settings` は `(name, format, game_title)` UNIQUE で分離済、format 内では game 重複なし前提。

---

## 4. 問題の分類

### 4.1 公開前に直すべきもの (本 plan で実施)

- C-1: `get_team_member_summaries` の game scope 修正
- C-2: detection 関数の game_title 対応
- C-3: `_run_detection_scan_internal` の game × rule 二重ループ + `detection_alerts.game_title` 正しい値 INSERT
- C-4: `_calculate_quality_score_internal` / `_run_quality_scoring_internal` の game scope 化
- C-5: `quality_score_snapshots` のキーに `game_title` 追加
- C-6: 既存 detection_alerts / quality_score_snapshots の data migration 方針確定

### 4.2 staging で検証すべきもの

- 全 6 サブタスクの staging 適用後、dev preview で:
  - team summary でメンバー戦績が game 別になる
  - detection_alerts が正しい game_title で INSERT される
  - quality scoring が user × game ごとに別 score を生成する
  - admin alert 管理 UI で game_title が正しく表示される (列追加するなら別途、本 plan では admin UI 拡張は不要)
  - 既存の Plan A / Plan B 機能が壊れていない (`shares.image_url` / auth / OG / SEO / Sentry)

### 4.3 Phase 2 以降でよいもの

- `detection_rules` / `quality_scoring_rules` / `quality_scoring_settings` の game 別化 (現状グローバル設定で十分、game 別ルールが必要になったら別 issue)
- admin UI で alert の game_title フィルタ / 表示列追加 (Plan C の DB 修正後、UX 改善として別 issue)
- `team_members` に `game_title` 列を redundant に持たせる schema 整備 (`get_team_member_summaries` の JOIN コストを下げたい場合、本 plan では JOIN で対応)

### 4.4 誤検知または現状維持でよいもの

- 読み取り系 RPC (`get_*_stats_range` 等) は `p_format` で game scope される前提 (AGENTS.md 既存方針)。**format code 重複がない限り問題なし**。本 plan で `p_game_title` を追加しない。
- 書き込み系 RPC (`auto_add_opponent_deck` / `recalculate_opponent_decks` / `run_daily_opponent_deck_batch` / `sync_team_membership`) は既に `p_game_title` 対応済。
- `opponent_deck_master` / `opponent_deck_settings` の game_title 分離は完了済。

---

## 5. 実装方針 (migration 安全順序)

### 5.1 expand → code → contract の原則

本 plan の DB 変更は **原則として additive expand** とし、列削除 / 制約強化での既存行拒否などの破壊的変更は避ける。**ただし C-4 + C-5 は RD-C5 で確定した例外**として、列追加 + 新 UNIQUE 追加 + 旧 UNIQUE DROP + quality scoring 関数差し替えを **同一 migration / 同一 transaction で実施**する (旧関数が `ON CONFLICT (user_id)` を参照したまま旧 UNIQUE だけ消える中間状態を排除するため、UNIQUE キー変更を expand-only にせず DROP まで含める)。

| 種別 | 内容 | expand / contract |
|---|---|---|
| 関数追加・置換 | `get_team_member_summaries` / `detect_*` / `_run_detection_scan_internal` / `_calculate_quality_score_internal` / `_run_quality_scoring_internal` を `CREATE OR REPLACE` で更新 | expand (旧シグネチャを維持したまま実装変更、または新 overload を追加して旧版は後で DROP) |
| 列追加 | `quality_score_snapshots.game_title text NOT NULL DEFAULT 'dm'` を追加 | expand (nullable / default 付き、既存行は 'dm' で埋まる) |
| UNIQUE 制約変更 | `quality_score_snapshots` の UNIQUE を `(user_id)` から `(user_id, game_title)` へ変更 | **同一 migration / 同一 transaction で完結 (RD-C5 で確定)**: 列追加 + 新 UNIQUE 追加 + 旧 UNIQUE DROP + quality scoring 関数差し替えを 1 migration ファイルに統合し、旧関数が旧 UNIQUE を参照したまま消える中間状態を作らない。`pg_constraint` で実 constraint 名を確認してから DROP |
| データ補完 | 既存 detection_alerts の `game_title` は default 'dm' で既に埋まっている。既存 quality_score_snapshots の `game_title` も新規列追加時 default 'dm' で埋まる | additive。データ削除はしない |

### 5.2 staging 適用 → dev preview 検証 → production 適用順序

CLAUDE.md / Plan A / Plan B 既存ルール厳守:

1. (Claude) **migration ファイルを `supabase/migrations/` に追加** (実装チャット)
2. (Claude) **staging DB 適用** (`npx supabase db push --db-url "$STAGING_DB_URL" --include-all` または supabase MCP の `apply_migration`、実装チャット側で判断)
3. (Claude) staging で migration list 確認 + smoke test (SQL レベル) を実施
4. (Claude) **コード変更** (`team-actions.ts` 等、必要なら) を `dev` branch に commit → push → Cloudflare dev preview build
5. (ユーザー) dev preview (`https://dev-duepure-tracker.jianrenzhongtian7.workers.dev`) で動作確認:
   - team summary 画面でゲーム別戦績が正しく出る
   - admin detection / quality scoring 画面で違和感なし
   - Plan A / Plan B 機能の regression なし
6. (ユーザー) 「本番反映」明示指示
7. (Claude) `git checkout main && git merge dev && git push origin main` → Cloudflare 本番デプロイ
8. (ユーザー) 本番デプロイ確認後、**Supabase production 適用の明示指示**
9. (Claude) **production DB 適用** (`npx supabase db push --db-url "$PROD_DB_URL"` または MCP)
10. (Claude) production で migration list + smoke test
11. (Claude) `git checkout dev` で dev に戻す

**順序の必須性**:

- **C-1 / C-2 の関数置換**は実質 read-only な関数本体 (SELECT のみ) を `CREATE OR REPLACE` で差し替えるだけで、置換そのものは書き込みを伴わない。**Code 先 / Migration 後** どちらの順序でも安全。
- **C-3 の `_run_detection_scan_internal()` も関数置換は read-only** だが、**置換後の関数実行時は `detection_alerts` への INSERT を伴う**。そのため:
  - 関数差し替え migration の適用順序は Code 先 / Migration 後どちらでも安全。
  - **既存 pg_cron 前提** (Codex 第 4 回確定): `cron_run_detection_scan` / `cron_run_quality_scoring` は既存 migration で pg_cron schedule 済 (daily 等)。production migration 適用後は **既存 cron が自動実行されうる** 状態が通常運用となる。これは新ロジックでも継続して許容する。
  - `run_detection_scan()` の **smoke test や手動 scan 実行は staging / production の本番化前に意図したタイミングで** 行う (Cloudflare deploy 直後 + DB migration 適用直後の dev preview 検証フェーズで明示、§5.2 step 4-5)。
  - **C-6 TRUNCATE 作業中の cron 競合回避**: TRUNCATE 直後の再生成タイミングと cron 実行が重なると挙動が読みにくいため、必要に応じて **TRUNCATE 作業中だけ pg_cron schedule を一時停止 → TRUNCATE + 即時手動 re-scan → schedule を再開** する手順を C-6 runbook に明記する (詳細は §6 C-6 実装方針参照)。
- **C-4 と C-5 は同一 migration / 同一 transaction に統合する** (RD-C5 で確定)。`quality_score_snapshots.game_title` 列追加 + 新 UNIQUE 追加 + 旧 `(user_id)` UNIQUE DROP + quality scoring 関数 (`_calculate_quality_score_internal` / `_run_quality_scoring_internal` / `calculate_quality_score`) の差し替えを 1 migration ファイルに集約し、`pg_constraint` で実 constraint 名を確認してから DROP。旧関数が `ON CONFLICT (user_id)` を参照したまま旧 UNIQUE だけ消える中間状態を排除する。
- C-6 のデータ移行 (TRUNCATE) は **自動 migration には含めず**、staging / production とも preflight count → 明示承認 → 手動 SQL/runbook の順で運用する (RD-C6 で確定)。production / staging ともテストデータが存在しうるため「ユーザーゼロだから損失なし」と断定せず、件数確認とユーザー承認を必須化。

### 5.3 rollback 方針

各 migration ファイルとペアで `supabase/rollback/<timestamp>_rollback.sql` を作成 (Plan A の `20260527000001_rollback.sql` と同じ命名):

| migration | rollback 内容 |
|---|---|
| C-1 / C-2 / C-3 関数置換 | 旧関数定義に `CREATE OR REPLACE FUNCTION ... AS ` で戻す SQL を rollback ファイルに保存 |
| C-4 + C-5 統合 migration (quality scoring 関数 + `quality_score_snapshots` schema) | (1) quality scoring 関数 (`_calculate_quality_score_internal` / `_run_quality_scoring_internal` / `calculate_quality_score`) を旧定義に戻す → (2) `pg_constraint` クエリ結果コメントに残した旧 constraint 名で `ADD CONSTRAINT` (旧 `(user_id)` UNIQUE 復元) → (3) 新 `(user_id, game_title)` UNIQUE を `DROP CONSTRAINT` → (4) `ALTER TABLE DROP COLUMN game_title` の逆順で実行。同一 transaction で実施 |

Cloudflare コード rollback は Deployments ダッシュボードで前 deploy に戻す。

---

## 6. サブタスク詳細

### C-1: `get_team_member_summaries` の game scope 修正 (P1)

#### 背景 / 解決したい穴

統合 audit §4.4: 「`get_team_member_summaries(p_team_id)` は `format` / `game_title` で scope せず、同一ユーザーの dm/pokepoke 戦績がチームメンバー概要で混ざる」。

`teams` テーブルは `(discord_guild_id, game_title) UNIQUE` で dm/pokepoke 別 team として分離されている (`20260419000001_multi_game_stage1a_schema.sql:23`)。`team_members` は `(team_id, user_id) UNIQUE` のため、`team_id` 経由でメンバーを取得した時点で「その team が dm か pokepoke か」は `teams.game_title` から決まる。

しかし現行 `get_team_member_summaries(p_team_id)` は `battles` を user_id だけで集約し、`team.game_title` でフィルタしていない → 同一ユーザーの全 game の battles が混入する。

#### 対象ファイル候補

- `supabase/migrations/2026MMDD00000N_team_member_summaries_game_scope.sql` (新規 migration)
- `supabase/rollback/2026MMDD00000N_rollback.sql` (rollback)
- `src/lib/actions/team-actions.ts` (呼び出し側、後述の方式によっては変更不要)
- `src/lib/supabase/database.types.ts` (型再生成、後述の方式によっては変更不要)

#### 実装方針

**採用方式 (RD-C4 で確定済、Resolved Decisions 節を参照)**: `team_id` から teams JOIN で `teams.game_title` (および必要なら `teams.format` 相当の対応 format) を解決し、battles を AND する方式。**呼び出し側 (`team-actions.ts`) の引数追加は不要** (`p_team_id` のみで完結)。

実装パターン (擬似 SQL):

```sql
CREATE OR REPLACE FUNCTION public.get_team_member_summaries(p_team_id uuid)
RETURNS TABLE (
  user_id uuid,
  discord_username text,
  wins bigint,
  losses bigint,
  draws bigint,
  total bigint
) LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  -- 既存セマンティクス維持: メンバー以外からの呼び出しを拒否
  IF NOT public.is_team_member(p_team_id, auth.uid()) THEN
    RAISE EXCEPTION 'not a team member' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT
    tm.user_id,
    tm.discord_username,
    COALESCE(COUNT(*) FILTER (WHERE b.result = 'win'), 0) AS wins,
    COALESCE(COUNT(*) FILTER (WHERE b.result = 'loss'), 0) AS losses,
    COALESCE(COUNT(*) FILTER (WHERE b.result = 'draw'), 0) AS draws,
    COALESCE(COUNT(b.id), 0) AS total
  FROM public.team_members tm
  JOIN public.teams t ON t.id = tm.team_id
  LEFT JOIN public.battles b
    ON b.user_id = tm.user_id
    AND b.game_title = t.game_title  -- ★ team の game_title と一致する battles のみ集計
  WHERE tm.team_id = p_team_id
    AND tm.hidden_at IS NULL  -- 既存セマンティクス維持 (個人非表示設定)
  GROUP BY tm.user_id, tm.discord_username
  ORDER BY COALESCE(COUNT(b.id), 0) DESC;
END;
$$;
```

- `team_members → teams` JOIN で `t.game_title` を解決し、`battles.game_title` と AND することで、team が dm なら dm の battles のみ、pokepoke なら pokepoke の battles のみが集計対象になる。
- 既存 SECURITY DEFINER + `SET search_path = ''` パターンを維持 (`20260509000004_secdef_hardening_phase_a.sql` の規約準拠)。
- 既存 `REVOKE ALL` + `GRANT EXECUTE TO authenticated` 既存 grant も維持。

#### 検証方法

| 確認項目 | 手順 | 期待結果 |
|---|---|---|
| dm team の summary | staging で dm の `team_id` を用意し、メンバーが dm/pokepoke 両方の battle を持つ状態で `SELECT * FROM public.get_team_member_summaries('<dm_team_id>')` | dm の battles のみが集計に含まれ、pokepoke の battles は除外される |
| pokepoke team の summary | 同上で `pokepoke_team_id` | pokepoke の battles のみが集計に含まれる |
| 既存呼び出し側 | `src/lib/actions/team-actions.ts:174` の `getTeamMemberSummaries` がそのまま動く (引数追加なし) | dev preview の team 画面で集計値が表示される、エラーなし |
| `npm test -- --run` | 既存テストが pass | 既存 client core ロジック regression なし |

#### リスク / rollback

- **リスク 1**: 既存 fixture が dm のみで pokepoke battles がない場合、集計値の変化が見えない。staging で意図的に pokepoke battle を追加して検証する。
- **リスク 2**: team が `game_title` を持たない fixture (旧 multi_game_stage1a 適用前のデータ) があると JOIN で NULL になる。`20260419000001` で `NOT NULL DEFAULT 'dm'` が設定済のため staging / production で発生しないはず。
- **rollback**: rollback SQL で旧 `CREATE OR REPLACE FUNCTION` で戻す。client 側は引数変更なしのため code rollback 不要。

#### Plan A / Plan B との依存関係

- Plan A の `shares.image_url` / auth / BanGuard には影響なし。
- Plan B の Sentry / OG / SEO には影響なし。
- `team-actions.ts:174` の呼び出し側引数を **変更しない方式** を採るため、上記 Plan A / B が touch した auth / route 周辺には影響なし。

---

### C-2: detection 関数の game_title 対応 (P1)

#### 背景 / 解決したい穴

統合 audit §4.4: `detect_extreme_winrate` / `detect_rapid_input` / `detect_repetitive_pattern` は `p_params jsonb` のみで `game_title` フィルタなし。`FROM public.battles b JOIN public.profiles p` のみで、user 単位の全 game 横断集計で異常判定をかける。

結果: ポケポケ専用 user の異常勝率が dm 側 admin UI で「dm として」誤検出される、dm/pokepoke 両方プレイするユーザーは合算で擬陽性が増える。

#### 対象ファイル候補

- `supabase/migrations/2026MMDD00000N_detection_game_scope.sql` (新規 migration)
- `supabase/rollback/2026MMDD00000N_rollback.sql`
- 関数: `public.detect_extreme_winrate(p_params jsonb, p_game_title text)` / `public.detect_rapid_input(...)` / `public.detect_repetitive_pattern(...)` の **新シグネチャ** を追加 (overload)
- `src/lib/supabase/database.types.ts` (型再生成)

#### 実装方針

**採用方式 (RD-C7 で確定済、Resolved Decisions 節を参照)**: `p_game_title text` を **2 番目の必須引数**として追加し、`battles b WHERE b.game_title = p_game_title` を AND する。**default 'dm' は付けない** (誤呼び出し時の混入を防ぐため、明示必須化)。

**旧 overload の扱い (Codex 第 1 回指摘で明示化、RD-C8)**:

- 旧 overload (`p_params jsonb` のみ) は本 plan では **互換性のため一時的に残す** が、以下の運用上の扱いに統一する:
  - **runner (`_run_detection_scan_internal`) は新 overload (`p_params jsonb, p_game_title text`) のみを呼ぶ**。旧 overload は runner から参照しない (C-3 で runner を新 overload に切り替え)。
  - 旧 overload は **非推奨 / runner 未使用 / 将来 DROP 対象** であることを関数定義の COMMENT (`COMMENT ON FUNCTION ... IS '...DEPRECATED in Plan C, scheduled for DROP in Phase 2...';`) に明記する。
  - 旧 overload は Phase 2 で contract migration として DROP する (本 plan では DROP しない)。Phase 2 で旧 overload に依存する未知の caller がいないことを `pg_proc` / `pg_depend` で確認してから DROP。
- **RETURNS TABLE 形は新旧で揃える**: 既存 `detect_*` の戻り型 `RETURNS TABLE (user_id uuid, rule_key text, details jsonb)` を新 overload でも維持する (3 列)。本文 §6 C-2 擬似 SQL は本反復で 3 列形 + SELECT 句に `'extreme_winrate'::text AS rule_key` を含める形に修正済。
- **rule_key 方針の統一 (Codex 第 2 回確定)**: `_run_detection_scan_internal` 側の INSERT 文は **`d.rule_key` 経由**で統一する (`v_rule.rule_key` リテラル供給は撤回):
  ```sql
  INSERT INTO public.detection_alerts (user_id, rule_key, game_title, details)
  SELECT d.user_id, d.rule_key, v_game_title, d.details
  FROM public.detect_extreme_winrate(v_rule.params, v_game_title) d;
  ```
  - detect_* 関数本体が固定リテラル (`'extreme_winrate'::text` 等) で 3 列目を返すため、runner 側は `d.rule_key` をそのまま INSERT すれば良い。
  - 二重方針 (`v_rule.rule_key` リテラル供給 + `d.rule_key` 二重化) は採らない。
  - §6 C-3 擬似 SQL も `d.rule_key` 経由に統一済 (本反復で修正)。

実装パターン (擬似 SQL):

```sql
-- 新 overload: 必須 p_game_title 追加
CREATE OR REPLACE FUNCTION public.detect_extreme_winrate(
  p_params jsonb,
  p_game_title text
)
RETURNS TABLE (user_id uuid, rule_key text, details jsonb) AS $$
DECLARE
  v_min_battles int := COALESCE((p_params->>'min_battles')::int, 30);
  v_threshold numeric := COALESCE((p_params->>'threshold')::numeric, 0.80);
  v_window_days int := COALESCE((p_params->>'window_days')::int, 30);
BEGIN
  RETURN QUERY
  SELECT
    b.user_id,
    'extreme_winrate'::text AS rule_key,
    jsonb_build_object(
      'winrate', AVG(CASE WHEN b.result = 'win' THEN 1.0 ELSE 0.0 END),
      'battle_count', COUNT(b.id),
      'window_days', v_window_days,
      'game_title', p_game_title
    ) AS details
  FROM public.battles b
  JOIN public.profiles p ON p.id = b.user_id
  WHERE p.stage IN (1, 2, 3)  -- 既存ロジック維持 (20260509000001:235)
    AND b.fought_at >= (now() - (v_window_days || ' days')::interval)
    AND b.game_title = p_game_title  -- ★ 追加: game scope
    AND NOT EXISTS (
      SELECT 1 FROM public.detection_alerts da
      WHERE da.user_id = b.user_id
        AND da.rule_key = 'extreme_winrate'
        AND da.game_title = p_game_title  -- ★ 追加: 既解決判定も game_title で分離
        AND da.is_resolved = false
    )
  GROUP BY b.user_id
  HAVING COUNT(b.id) >= v_min_battles
     AND AVG(CASE WHEN b.result = 'win' THEN 1.0 ELSE 0.0 END) >= v_threshold;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';
```

`detect_rapid_input` / `detect_repetitive_pattern` も同様のパターンで `p_game_title text` を追加し、`b.game_title = p_game_title` AND を加える。

#### 検証方法

| 確認項目 | 手順 | 期待結果 |
|---|---|---|
| dm のみで異常勝率 | staging で dm に 100 戦 95 勝の user を作り、pokepoke は 0 戦の状態で `SELECT public.detect_extreme_winrate('{}'::jsonb, 'dm')` | user が検出される (`details.game_title = 'dm'`) |
| pokepoke 検出 | 同 user の pokepoke battles を 0 → 詳細なし、`SELECT public.detect_extreme_winrate('{}'::jsonb, 'pokepoke')` | user が検出されない (battles 0 件) |
| 混在ユーザー | dm 50 戦 25 勝、pokepoke 50 戦 45 勝の user で `SELECT public.detect_extreme_winrate('{}'::jsonb, 'pokepoke')` | pokepoke のみで判定し、user が pokepoke 異常勝率として検出される (dm 合算では検出されなかった想定) |
| 旧 overload | `SELECT public.detect_extreme_winrate('{}'::jsonb)` | 旧シグネチャがまだ存在し、従来通り全 game 横断で集計する (本 plan では旧 overload を残す) |

#### リスク / rollback

- **リスク 1**: 旧 overload が残っている間、誤って `_run_detection_scan_internal` が旧版を呼び続ける可能性 → C-3 で `_run_detection_scan_internal` を新版に切り替えることで対処。
- **リスク 2**: detection_alerts の details に `game_title` が含まれない既存行と新規行の差分。既存行は data migration で `details.game_title = 'dm'` を補完するか、admin UI 側で安全に解釈する。
- **rollback**: rollback SQL で新 overload を DROP する (`DROP FUNCTION public.detect_extreme_winrate(jsonb, text);` 等)。旧 overload は維持されているため runner は引き続き動く。

#### Plan A / Plan B との依存関係

- 影響なし。detection 関数は admin / cron 経路のみ。

---

### C-3: `_run_detection_scan_internal` の game × rule 二重ループ + `detection_alerts.game_title` 正値 INSERT (P1)

#### 背景 / 解決したい穴

統合 audit §4.4: 「`_run_detection_scan_internal` は game 別ループなし、`INSERT INTO public.detection_alerts (user_id, rule_key, details)` で game_title 未指定 → default `'dm'` に固定」。

`detection_alerts.game_title` 列は `20260419000001` で追加済 + default `'dm'` + NOT NULL のため、INSERT で省略すると常に `'dm'` で記録される → ポケポケ専用 user の alert も dm として記録される。

#### 対象ファイル候補

- `supabase/migrations/2026MMDD00000N_run_detection_scan_internal_game_loop.sql`
- `supabase/rollback/2026MMDD00000N_rollback.sql`
- 関数: `public._run_detection_scan_internal()` の `CREATE OR REPLACE`
- (wrapper の signature は変更しない: `run_detection_scan()` / `cron_run_detection_scan()` は `Args: never` 維持)

#### 実装方針

**採用方式 (RD-C1 / RD-C2 で確定済、Resolved Decisions 節を参照)**: `_run_detection_scan_internal` 内で **game_title × rule_key の二重ループ**にし、各 game ごとに detection 関数 (C-2 で新 overload 追加済) を呼んで `detection_alerts` を `(user_id, rule_key, game_title, details)` で INSERT する。dedup は RD-C1 に従い detect_* 内集約、game 一覧は RD-C2 に従いハードコード配列。

ゲーム一覧は **ハードコード `('dm', 'pokepoke')` で十分** (本 plan の規模を抑えるため、`src/lib/games/index.ts` の `GAME_SLUGS` と同等のものを SQL 側で持つ)。将来 game が追加された時は migration で配列を更新する (Phase 2 で `games` テーブル等を導入するなら別 issue)。

実装パターン (擬似 SQL):

```sql
CREATE OR REPLACE FUNCTION public._run_detection_scan_internal()
RETURNS int AS $$
DECLARE
  v_rule public.detection_rules%ROWTYPE;
  v_game_title text;
  v_alert_count int := 0;
  v_row_count int := 0;
  -- ★ ハードコード一覧 (RD-C2): `src/lib/games/index.ts` の `GAME_SLUGS` と同期が必要。
  -- 新ゲーム追加時はこの SQL 配列も migration で更新すること。
  -- Phase 2 で `public.games` マスタテーブル化 + 動的取得を検討予定 (§10.B 参照)。
  v_game_titles text[] := ARRAY['dm', 'pokepoke'];
BEGIN
  FOR v_rule IN
    SELECT * FROM public.detection_rules WHERE is_enabled = true
  LOOP
    FOREACH v_game_title IN ARRAY v_game_titles
    LOOP
      -- rule_key に応じて detect_* 関数を呼ぶ
      -- RD-C1: dedup は detect_* 関数内の NOT EXISTS (da.game_title = p_game_title AND da.is_resolved = false)
      -- に集約済。runner 側は orchestration のみで、別個の NOT EXISTS ガードは追加しない。
      -- created_at 7 日 sliding window が必要な場合は detect_* 側に追加する (20260424000004 の意図確認後)。
      -- RD-C8 / Codex 第 2 回確定: rule_key は detect_* 戻り値 `d.rule_key` 経由で統一
      -- (`v_rule.rule_key` リテラル供給は撤回、二重方針を残さない)。
      IF v_rule.rule_key = 'extreme_winrate' THEN
        INSERT INTO public.detection_alerts (user_id, rule_key, game_title, details)
        SELECT d.user_id, d.rule_key, v_game_title, d.details
        FROM public.detect_extreme_winrate(v_rule.params, v_game_title) d;
      ELSIF v_rule.rule_key = 'rapid_input' THEN
        INSERT INTO public.detection_alerts (user_id, rule_key, game_title, details)
        SELECT d.user_id, d.rule_key, v_game_title, d.details
        FROM public.detect_rapid_input(v_rule.params, v_game_title) d;
      ELSIF v_rule.rule_key = 'repetitive_pattern' THEN
        INSERT INTO public.detection_alerts (user_id, rule_key, game_title, details)
        SELECT d.user_id, d.rule_key, v_game_title, d.details
        FROM public.detect_repetitive_pattern(v_rule.params, v_game_title) d;
      END IF;

      GET DIAGNOSTICS v_row_count = ROW_COUNT;
      v_alert_count := v_alert_count + v_row_count;
    END LOOP;
  END LOOP;

  RETURN v_alert_count;  -- 累積件数 (game × rule の全 INSERT 合計)
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';
```

#### 検証方法

| 確認項目 | 手順 | 期待結果 |
|---|---|---|
| pokepoke 専用 user の alert | staging で pokepoke の 100 戦 95 勝 user を作り、`SELECT public.run_detection_scan()` | `detection_alerts` に `game_title = 'pokepoke'` で 1 件 INSERT される (旧版では `game_title = 'dm'` で誤記録されていた) |
| dm 専用 user の alert | dm の 100 戦 95 勝 user で同上 | `game_title = 'dm'` で 1 件 INSERT |
| 重複 alert 抑止 (game 別) | 同じ user × rule で 1 日内に 2 回 scan を実行 | 2 回目は INSERT されない (`NOT EXISTS ... is_resolved = false` で抑止)。ただし dm と pokepoke 別 game なら別 alert として扱う |
| 既存 alert の game_title | 既存 default 'dm' alert は **そのまま** (C-6 でデータ移行方針を確定) | 既存行は変更されない |

#### リスク / rollback

- **リスク 1**: ハードコードした game 一覧 (`['dm', 'pokepoke']`) が将来 game 追加時に更新漏れになる。**コメントで Plan E (Phase 2) で `games` テーブル化を予告**しておく。
- **リスク 2**: 既存 detection_alerts の `game_title = 'dm'` データが、実は pokepoke ユーザーのもので誤分類されている場合、C-6 のデータ移行方針が必要。RD-C6 (§6 C-6) に従い、production / staging とも preflight count + ユーザー明示承認後に手動 TRUNCATE + 再 scan を実施する (自動 migration には含めない)。
- **rollback**: 旧 `_run_detection_scan_internal` 定義に戻す rollback SQL。

#### Plan A / Plan B との依存関係

- 影響なし。detection_alerts は admin 経路のみで、Plan A / B が touch した UI route 周辺には影響なし。

---

### C-4: `_calculate_quality_score_internal` / `_run_quality_scoring_internal` の game scope 化 (P1)

#### 背景 / 解決したい穴

統合 audit §4.4: 「quality scoring はユーザー単位で battles を集約し、他ゲーム戦績で `profiles.stage` が変動し得る」。

現行は `_calculate_quality_score_internal(p_user_id uuid)` が user 単位で全 game の battles を集計し、1 つの score を計算する。`profiles.stage` は user 単位で更新され、user × game の組み合わせを区別しない。

結果: pokepoke 専用 user の品質スコアが dm 戦績ゼロで計算されて低くなり、dm/pokepoke 両方プレイするユーザーは合算スコアで判定される。

#### 対象ファイル候補

- `supabase/migrations/2026MMDD00000N_quality_scoring_game_scope.sql`
- `supabase/rollback/2026MMDD00000N_rollback.sql`
- 関数: `public._calculate_quality_score_internal(p_user_id uuid, p_game_title text)` の新 overload
- 関数: `public._run_quality_scoring_internal(p_auto_update boolean)` の `CREATE OR REPLACE` (内部で game × user の二重ループ)
- (wrapper の signature: `calculate_quality_score(p_user_id)` / `run_quality_scoring(p_auto_update)` / `cron_run_quality_scoring()` は維持)

#### 実装方針

**採用方式 (RD-C3 [stage aggregation] で確定済、Resolved Decisions 節を参照)**:

**quality scoring の game scope ポリシー (Codex 第 1 回指摘で明示化)**:

`_calculate_quality_score_internal(p_user_id, p_game_title)` 内で参照する各種 rule の game scope は、以下のカテゴリに分けて扱う:

| Rule カテゴリ | 例 | game scope |
|---|---|---|
| **game-level rule (battle 系)** | `recent_battles`、`opponent_diversity`、`normal_winrate`、`normal_input_pace`、`extreme_winrate_q`、`repetitive_pattern_q`、`excessive_input` | `battles` を `user_id = p_user_id AND game_title = p_game_title` でフィルタして集計 |
| **game-level rule (alert 系)** | `unresolved_alerts` (= 未解決の detection_alerts 数) | `detection_alerts` を `user_id = p_user_id AND game_title = p_game_title AND is_resolved = false` でフィルタして集計 (RD-C1 で detection_alerts が game_title 別 INSERT されるため、quality score 側も game 別で参照する) |
| **game-level rule (Discord 連携系)** | `discord_linked` | `discord_connections` を `user_id = p_user_id AND game_title = p_game_title` でフィルタ。`discord_connections` は `(user_id, game_title) UNIQUE` で game 別に独立しているため (CLAUDE.md 「Discord 連携はゲーム別独立」参照)、game 別 score 計算では当該 game の連携有無のみを評価する |
| **account-level rule** | `quality_admin_bonus` (admin 手動加点)、X 連携系 (`profiles.x_user_id` 由来) など | user 単位の値を **全 game で共通参照** する。`p_game_title` でフィルタしない。理由: admin bonus と X 連携は account-level 属性で、game 単位に分割する意味がない |

**実装手順**:

1. `_calculate_quality_score_internal` に **新 overload** `(p_user_id uuid, p_game_title text)` を追加し、内部の game-level rule 集計に `AND b.game_title = p_game_title` / `AND da.game_title = p_game_title` / `AND dc.game_title = p_game_title` を追加する。account-level rule (admin bonus / X 連携) はフィルタを追加せず user 単位で評価する。
2. `_run_quality_scoring_internal` を **game × user の二重ループ**に変更し、各 (user, game) ごとに新 overload を呼んで `quality_score_snapshots` に **`(user_id, game_title)` 複合キー**で UPSERT する (C-5 で UNIQUE 制約も追加)。
3. wrapper `calculate_quality_score(p_user_id)` は **後方互換性のため** 旧シグネチャ (`p_user_id` のみ) を維持する。**RD-C3 で確定**: 内部で全 game の score を計算し、`MAX(score)` を `total_score` として返す。`breakdown` JSON には全 game 合算の rule breakdown に加え、`max_score`（= 返す total_score と同値）と `max_score_game_title`（最大値を出した game の slug）を含めて debug / verification 用にする。
4. `profiles.stage` の更新ロジック (`_run_quality_scoring_internal` 内の昇格/降格判定) は **RD-C3 で確定**: user × game 別の score を `quality_score_snapshots` に保存した後、その user の **全 game score の `MAX(score)`** を閾値と比較して `profiles.stage` を更新する。`dm` score 固定だと pokepoke 専用ユーザーが不当に降格しうるため避ける。stage を game 別に分離する案 (account-level 集約をやめる) は Phase 2 / Plan D 以降の検討事項として §10.B に残す。

#### 検証方法

| 確認項目 | 手順 | 期待結果 |
|---|---|---|
| dm 専用 user の score | staging で dm の 100 戦 user で `SELECT public._calculate_quality_score_internal('<user_id>', 'dm')` | 100 戦のデータで計算された score が返る |
| pokepoke 専用 user の score | 同じ user で `('<user_id>', 'pokepoke')` を呼ぶ | pokepoke battles 0 件で計算された score (= 低スコア) が返る |
| snapshot (game 別保存) | `_run_quality_scoring_internal(true)` 実行後、`SELECT * FROM quality_score_snapshots WHERE user_id = '<user_id>'` | 2 行 (dm 用 + pokepoke 用) が返る、それぞれ独立した `total_score` / `breakdown` |
| **profiles.stage 判定 (MAX(score))** (RD-C3) | dm 50 戦 30 勝 + pokepoke 100 戦 95 勝 の user に対して `_run_quality_scoring_internal(true)` 実行 | `profiles.stage` は **両 game の score の MAX で判定** され、pokepoke の高 score が反映される (dm 単独だと降格しうるが MAX(score) で救済される) |
| `breakdown` に max_score 含む (RD-C3) | snapshot の `breakdown` JSON を確認 | `max_score` (= total_score と同値) と `max_score_game_title` (最大値を出した game slug) が含まれる |
| `calculate_quality_score(p_user_id)` wrapper | 旧 signature `(p_user_id uuid)` のみで呼び出し | 全 game 計算後の MAX(score) が `total_score` として返る、`breakdown.max_score_game_title` も含まれる |

#### リスク / rollback

- **リスク 1**: 既存 `quality_score_snapshots` が `(user_id) UNIQUE` のため、新 overload で UPSERT すると衝突する。**C-5 で UNIQUE を `(user_id, game_title)` に変更してから C-4 を本番適用** する順序が必須。
- **リスク 2**: 旧 wrapper `calculate_quality_score(p_user_id)` の戻り値が変わると admin UI が壊れる。**旧 wrapper signature (`p_user_id` のみ) は維持** し、戻り値は RD-C3 準拠で全 game の MAX(score) を返す。admin UI が `total_score` のスカラを表示する前提なら互換、game 別 breakdown を将来 UI に出す場合は `breakdown.max_score_game_title` を参照すれば良い。
- **rollback**: 旧 `_calculate_quality_score_internal` / `_run_quality_scoring_internal` 定義に戻す rollback SQL。

#### Plan A / Plan B との依存関係

- 影響なし。

---

### C-5: `quality_score_snapshots.game_title` 列追加 + 新 UNIQUE 制約 (P1)

#### 背景 / 解決したい穴

C-4 で user × game 別 snapshot を生成するには `quality_score_snapshots` のキーを `(user_id, game_title)` に変更する必要がある。現行は `(user_id)` の UNIQUE PRIMARY KEY のため、1 行しか持てない。

#### 対象ファイル候補

- `supabase/migrations/2026MMDD00000N_quality_score_snapshots_game_title.sql`
- `supabase/rollback/2026MMDD00000N_rollback.sql`
- `src/lib/supabase/database.types.ts` (型再生成)

#### 実装方針

**採用方式 (RD-C5 で確定済、Resolved Decisions 節を参照)**: 列追加 + 新 UNIQUE 追加 + 旧 UNIQUE DROP + 関数差し替え (`_calculate_quality_score_internal` / `_run_quality_scoring_internal` / `calculate_quality_score`) を **同一 migration / 同一 transaction にまとめて** 適用する。旧関数が `ON CONFLICT (user_id)` を参照したまま旧 UNIQUE だけ消える中間状態を作らない。

```sql
-- step 1: 列追加 (additive)
ALTER TABLE public.quality_score_snapshots
ADD COLUMN game_title text NOT NULL DEFAULT 'dm';

-- step 2: 新 UNIQUE 追加 (旧 UNIQUE はこの時点ではまだ残す)
ALTER TABLE public.quality_score_snapshots
ADD CONSTRAINT quality_score_snapshots_user_game_unique UNIQUE (user_id, game_title);

-- step 3: 旧 (user_id) UNIQUE / PRIMARY KEY を DROP
--   実装時は `pg_constraint` で実 constraint 名を確認してから DROP する:
--     SELECT conname, contype, pg_get_constraintdef(oid)
--     FROM pg_constraint
--     WHERE conrelid = 'public.quality_score_snapshots'::regclass
--       AND contype IN ('u', 'p')
--       AND (
--             pg_get_constraintdef(oid) LIKE 'UNIQUE (user_id)%'
--         OR  pg_get_constraintdef(oid) LIKE 'PRIMARY KEY (user_id)%'
--       );
--   ※ WHERE 句で `conrelid` フィルタと OR 句を分離するため、OR 全体を括弧で括る (Codex 第 2 回指摘で確定)。
--   括弧なしだと `AND contype IN (...) AND LIKE 'UNIQUE'... OR LIKE 'PRIMARY KEY'...` の右側 OR が
--   全 schema の constraint を拾い、対象テーブル外の UNIQUE / PRIMARY KEY が誤検出される。
--   migration ファイル冒頭にこの SELECT 結果 (例: `quality_score_snapshots_user_id_key`) を
--   コメントとして記載し、DROP CONSTRAINT に実名を埋める。
ALTER TABLE public.quality_score_snapshots
DROP CONSTRAINT <pg_constraint で確認した実 constraint 名>;

-- step 4: 関数差し替え (`_calculate_quality_score_internal` の新 overload、
--   `_run_quality_scoring_internal` の game × user 二重ループ + ON CONFLICT (user_id, game_title) UPSERT、
--   `calculate_quality_score(p_user_id)` wrapper の MAX(score) 戻り値) を `CREATE OR REPLACE` で同一 migration に含める。
--   step 3 の旧 UNIQUE DROP と step 4 の関数差し替えが同一 transaction で commit されることで、
--   旧関数が旧 UNIQUE を参照する中間状態を作らない。
CREATE OR REPLACE FUNCTION public._calculate_quality_score_internal(p_user_id uuid, p_game_title text) ...;
CREATE OR REPLACE FUNCTION public._run_quality_scoring_internal(p_auto_update boolean) ...;
CREATE OR REPLACE FUNCTION public.calculate_quality_score(p_user_id uuid) ...;
```

- 列追加 (step 1) は既存行を `game_title = 'dm'` で埋める (data migration なし)。
- 新 UNIQUE 追加 (step 2) で既存行は衝突しない (各 user に 1 行しかなく、すべて `game_title = 'dm'` で `(user_id, 'dm')` の組合せが UNIQUE)。
- 旧 UNIQUE DROP (step 3) と関数差し替え (step 4) を **同一 migration / 同一 transaction** にまとめることで、旧関数が `ON CONFLICT (user_id)` を参照したまま旧 UNIQUE だけ消える中間状態を排除する。
- `pg_constraint` で実 constraint 名を確認するのは、Postgres / Supabase が UNIQUE 制約を `<table>_<column>_key` 形式で自動生成するが、PRIMARY KEY 化されている場合は `<table>_pkey` になる等、命名規約が schema 履歴によって異なる可能性があるため。確認結果をコメントとして migration に残し、レビュアーが diff で実名を見られるようにする。

#### 検証方法

| 確認項目 | 手順 | 期待結果 |
|---|---|---|
| 列追加確認 | staging で `\d quality_score_snapshots` (または `SELECT column_name FROM information_schema.columns`) | `game_title text NOT NULL DEFAULT 'dm'` が存在 |
| 既存行の値 | `SELECT user_id, game_title FROM quality_score_snapshots LIMIT 10` | すべて `game_title = 'dm'` |
| 新 UNIQUE | 同じ `(user_id, 'dm')` で 2 行目を INSERT 試行 | UNIQUE 違反で拒否される |
| C-4 連動 | C-4 適用後に `_run_quality_scoring_internal(true)` を実行 | 各 user に対して dm 用 1 行 + pokepoke 用 1 行が UPSERT される |

#### リスク / rollback

- **リスク 1**: 旧 UNIQUE と新 UNIQUE の共存期間で `(user_id)` 単独 UNIQUE が `(user_id, 'dm')` と `(user_id, 'pokepoke')` を同時に持てない → **同一 transaction / migration で旧 UNIQUE DROP + 関数差し替えを完了** することでこの中間状態を排除する (RD-C5 で確定)。staging で migration 全体を transaction 内で smoke test して DROP CONSTRAINT が想定の constraint 名で動作することを確認する。
- **rollback**: rollback SQL で `step 4 の関数を旧定義に戻す → step 3 で DROP した制約を ADD CONSTRAINT で復元 → step 2 の新 UNIQUE DROP → step 1 の列 DROP` の逆順で実行 (これも同一 transaction)。旧 constraint 名は step 3 の pg_constraint クエリ結果コメントから取得して rollback SQL に埋め込む。
- **リスク 2 (snapshot caller 破綻、admin / 自分用ともに影響)**: `quality_score_snapshots` を `.eq("user_id", ...).single()` で 1 行前提で参照している箇所が 2 つある: (a) `src/lib/actions/admin-actions.ts:794` の `getQualityScoreSnapshot(userId)` (admin 用、`src/components/admin/AdminUserQualityScore.tsx` から呼ばれる)、(b) `src/lib/actions/account-actions.ts:174-188` の `getMyQualityScore()` (ユーザー自身用、現時点で UI から未呼び出しでも公開 API として残り、将来呼び出されれば壊れる)。C-5 後の複合キー化で複数行 (dm + pokepoke) を返すと両者とも PGRST116 で throw する。

  **修正方針 (Codex 第 4 回で確定、RD-C3 の account-level MAX(score) と整合)**:
  - **`.single()` は使わない** (両関数とも)。
  - **`getQualityScoreSnapshot(userId)`**: `quality_score_snapshots` を `eq("user_id", userId)` で **全件取得** し、`total_score` が最大の row を **既存 UI shape で返す** (admin UI の prop 型を維持)。必要に応じて `game_title` および `breakdown.max_score_game_title` を **追加情報として返却 object に含める** (admin UI 側はまず game_title 表示を行わず、表示するなら別 issue)。
  - **`getMyQualityScore()`**: 自分自身の全 game snapshot を取得し、`total_score` が最大の row を返す。**既存戻り値 shape (`total_score, breakdown`) はなるべく維持**。`breakdown.max_score_game_title` は既に含まれるため client 側で参照可能。
  - **per-game 表示 / game filter 引数追加 / 全 game 一覧表示 は Phase 2 / admin UI 改善 に送る** (本 plan スコープ外、§10.B に追加)。

  §3.2 関連 actions 表にも `admin-actions.ts:794` と `account-actions.ts:174` の行を追加し、影響範囲を明記済。

#### Plan A / Plan B との依存関係

- 影響なし。

---

### C-6: 既存 detection_alerts / quality_score_snapshots の data migration 方針 (P1)

#### 背景 / 解決したい穴

C-3 / C-5 適用時点で既存の `detection_alerts.game_title = 'dm'` (default で埋まったもの) と `quality_score_snapshots.game_title = 'dm'` (新規列追加で埋まったもの) のデータが残る。これらが実は pokepoke ユーザーのデータだった場合、誤分類のまま運用される。

一般公開前ではあるが、**production / staging ともテストデータ・admin による手動投入データが存在しうる**ため「ユーザーゼロだから損失なし」と断定しない。実際の件数を確認した上でユーザーが明示承認した場合のみ TRUNCATE を実行する。

#### 対象ファイル候補

- **migration には含めない** (Codex 第 1 回指摘で確定、RD-C6)。C-3 / C-5 の schema / function 変更 migration は **TRUNCATE を含まない**。
- 手動 SQL 実行用の runbook: `docs/runbooks/plan_c_data_truncate.md` (新規、staging / production の preflight count + 明示承認手順 + TRUNCATE SQL + 再 scan 手順を runbook 化)

#### 実装方針 (RD-C6 で確定済、Resolved Decisions 節を参照)

**TRUNCATE は自動 migration に入れない**。代わりに以下の手動運用フローを runbook 化する。

**前提 (Codex 第 4 回確定)**: 既存 migration で `cron_run_detection_scan` / `cron_run_quality_scoring` が pg_cron schedule 済。**TRUNCATE 前後で cron と競合しないよう、preflight / 承認 / (必要なら cron 一時停止) / truncate / immediate re-scan / count 確認 / (必要なら cron 再開) を一連の手順として扱う**。

##### staging での運用フロー

1. (Claude) preflight count: `SELECT game_title, count(*) FROM public.detection_alerts GROUP BY game_title;` と `SELECT game_title, count(*) FROM public.quality_score_snapshots GROUP BY game_title;` を staging で実行し、現状件数と game_title 分布をユーザーに報告。
2. (ユーザー) 件数を確認し、TRUNCATE してよいか明示承認。
3. (Claude) **必要に応じて pg_cron schedule を一時停止** (例: `SELECT cron.unschedule('daily-detection-scan');` / `SELECT cron.unschedule('daily-quality-scoring');`)。stop の必要性は cron 次回実行時刻と作業時間の重複可能性から判断。staging では失敗時の影響が小さいので skip も可。
4. (Claude) 承認後、staging で `TRUNCATE TABLE public.detection_alerts; TRUNCATE TABLE public.quality_score_snapshots;` を手動実行。
5. (Claude) **即時に** `SELECT public.run_detection_scan(); SELECT public.run_quality_scoring(true);` で手動再生成 (TRUNCATE → re-scan を 1 セットとして実行、間に cron が走らないよう近接させる)。
6. (Claude) 再生成後の count と game_title 分布を確認してユーザーに報告。
7. (Claude) step 3 で cron を停止した場合は **schedule を再開** (`SELECT cron.schedule(...)`)。

##### production での運用フロー

1. (Claude) production preflight count を実行し、ユーザーに報告。
2. (ユーザー) **バックアップ確認 (Supabase ダッシュボード PITR 等)** + **明示承認** を経て TRUNCATE 指示。
3. (Claude) **必要に応じて pg_cron schedule を一時停止** (production では cron 次回実行と作業時間が重複する可能性が高いため、原則 stop を推奨)。
4. (Claude) production で TRUNCATE を手動実行 (`apply_migration` ではなく `execute_sql` 単発)。
5. (Claude) **即時に** `SELECT public.run_detection_scan(); SELECT public.run_quality_scoring(true);` で手動再生成 (TRUNCATE 直後の cron 競合を防ぐ目的で近接実行)。
6. (Claude) 再生成後の count と game_title 分布を確認してユーザーに報告。
7. (Claude) step 3 で cron を停止した場合は **schedule を再開**。再開後の cron 次回実行は通常運用として許容 (新規 alert / snapshot を追加生成する正常動作)。

##### 案 (B 案 / C 案、参考)

- **案 B (保守的、保持)**: 既存データを保持 (default 'dm' で固定)。実装後の `_run_*_internal` 再実行で新規 alert / snapshot が混在生成される。「dm 固定の古い alert と pokepoke 含む新規 alert の混在」を運用上許容できる場合のみ採用 (案 A が破棄された時の fallback)。
- **案 C (細かい migration)**: 既存 alert / snapshot の game_title を user の battles から推定して埋め直す。**実装複雑度高、本 plan では非推奨**。

#### 検証方法

| 確認項目 | 手順 | 期待結果 |
|---|---|---|
| staging preflight count | Claude が `SELECT game_title, count(*) ... GROUP BY game_title` を実行 | game_title 別の件数がユーザーに報告される |
| staging TRUNCATE 後の再生成 | ユーザー承認 → 手動 TRUNCATE → `run_detection_scan()` + `run_quality_scoring(true)` | game_title ごとに新規 alert / snapshot が生成される |
| production preflight count | 同上を production で実行 | 同上、バックアップ確認後にユーザー再承認 |
| production TRUNCATE 後の再生成 | ユーザー再承認 → 手動 TRUNCATE + 再 scan | 同上 |

#### リスク / rollback

- **リスク 1 (production テストデータ損失)**: 「ユーザーゼロ = データなし」と断定せず、admin による手動投入や開発時のテストデータが残っている可能性を考慮。**preflight count + バックアップ確認 + ユーザー明示承認** を必須化することで対処。
- **リスク 2 (再生成忘れ)**: TRUNCATE 後に再 scan を忘れると admin UI で alert / snapshot がゼロになる。runbook に「TRUNCATE 後すぐに `run_detection_scan()` + `run_quality_scoring(true)` を実行」を明記、再生成後の count 確認まで 1 手順として扱う。
- **rollback**: TRUNCATE 後のデータ復元は不可。Supabase PITR (Point-in-Time Recovery) でバックアップから復旧する必要があり、production では事前にバックアップ確認を必須化。staging では `npm run staging:refresh -- --apply` で源データから再同期可能。

#### Plan A / Plan B との依存関係

- 影響なし。

---

## 7. Plan A / Plan B との非破壊確認

| Plan A / B の機能 | Plan C での影響 |
|---|---|
| A-1 `shares.image_url` 二段防御 (DB trigger + display sanitizer) | ✅ 影響なし。Plan C は `shares` テーブル / `is_safe_share_image_url` / `sanitizeShareImageUrl` を touch しない |
| A-2 legacy URL / `<HomeLink>` / `loading.tsx` / `global-error.tsx` / 文字化け修正 | ✅ 影響なし。Plan C は UI / route を touch しない |
| A-3 BanGuard retry + fail-open + `LoadingSpinner` | ✅ 影響なし。Plan C は `BanGuard.tsx` を touch しない |
| A-4 共有 / 未ログイン導線 `game/next` + open redirect 防御 | ✅ 影響なし。Plan C は `auth/*` を touch しない |
| B-1 Sentry scrubber / release / environment | ✅ 影響なし。Plan C は `src/sentry-worker.ts` を touch しない |
| B-2 OG ルートのフォント自前 + cache / fallback | ✅ 影響なし。Plan C は `/api/og/[id]` を touch しない |
| B-3 noindex / metadata 整備 | ✅ 影響なし。Plan C は `next.config.ts` / 公開ページ metadata を touch しない |
| B-4 公開ランディング + sitemap + BanGuard B-4-e | ✅ 影響なし |
| B-5 Observability runbook | ✅ 影響なし。Plan C 完了後に runbook 補強する可能性あり (admin alert 運用) |
| B-6 法務 gap analysis | ✅ 影響なし |

---

## 8. 統合検証 (Plan C 全体)

サブタスク個別検証の他に、Plan C 全体反映後の統合検証:

| カテゴリ | 検証内容 |
|---|---|
| Team summary | dm/pokepoke 両方の battles を持つ user で、`get_team_member_summaries('<dm_team>')` が dm 戦績のみ、`get_team_member_summaries('<pokepoke_team>')` が pokepoke 戦績のみを返す |
| Detection | dm の異常勝率と pokepoke の異常勝率を **別の alert** として独立に検出。`detection_alerts.game_title` が `'dm'` / `'pokepoke'` で正しく分かれる |
| Quality scoring | `quality_score_snapshots` に user × game 別の 2 行 (or N 行) が生成される。`profiles.stage` 更新ロジックは **RD-C3 で確定**: 全 game score の **`MAX(score)`** で判定する (現状維持ではない)。`breakdown` に `max_score` / `max_score_game_title` が含まれる。Plan D に保留するのは **stage の game 別分離 (account-level stage 集約をやめる案)** のみ |
| Wrapper signature | `run_detection_scan()` / `run_quality_scoring(p_auto_update)` / `calculate_quality_score(p_user_id)` の wrapper signature は変更なし、admin / cron 経路は変更なし |
| 既存 Plan A/B 機能 | `shares` / auth / OG / SEO / Sentry / landing / BanGuard / loading が引き続き動く |
| 既存読み取り系 RPC | `get_*_stats_range` / `get_*_detail_stats` 等は `p_format` で動作、本 plan で変更なし |

#### Claude Code が自前で実施できる検証

- `npm run lint` / `npx tsc --noEmit` / `npm test -- --run`
- 静的読解: migration SQL の構文、`CREATE OR REPLACE FUNCTION` の SECDEF / `SET search_path` / REVOKE / GRANT パターン
- staging DB read-only preflight: Supabase MCP の `list_tables` / `execute_sql` (SELECT のみ) で:
  - 関連テーブル `team_members` / `teams` / `detection_alerts` / `quality_score_snapshots` のスキーマ確認
  - 既存 alert / snapshot の game_title 分布
- `git grep` で関連 RPC 呼び出し箇所が変更必要かどうかの確認

#### ユーザーのブラウザ実機確認が必要

- dev preview で team summary 画面、admin detection / quality scoring 画面を実機操作
- staging DB に dm / pokepoke 両方の fixture を作って動作確認
- 本番反映後の smoke test (admin 経路、cron 実行結果)

---

## 9. 実装順序 (推奨)

依存関係とリスクから次の順序を推奨:

1. **C-1** (`get_team_member_summaries`)
   - 単一関数置換、wrapper signature 変更なし、最も低リスク。
   - team JOIN 経由で teams.game_title を解決する方式のため、呼び出し側変更不要。
   - 完了時間目安: **0.5 日**。

2. **C-2** (detection 関数の game_title 対応)
   - 新 overload 追加、旧 overload 維持 (本 plan では DROP しない)。
   - 完了時間目安: **0.5 日**。

3. **C-4 + C-5 (統合 migration)** (RD-C5 で確定、同一 migration / 同一 transaction)
   - `quality_score_snapshots.game_title` 列追加 + 新 UNIQUE `(user_id, game_title)` 追加 + 旧 `(user_id)` UNIQUE DROP + quality scoring 関数 (`_calculate_quality_score_internal` / `_run_quality_scoring_internal` / `calculate_quality_score`) 差し替えを **1 migration ファイルに集約**。
   - 旧関数が `ON CONFLICT (user_id)` を参照したまま旧 UNIQUE だけ消える中間状態を排除する。
   - `pg_constraint` で実 constraint 名を確認してから DROP。`admin-actions.ts:794` / `account-actions.ts:174` の `.single()` 呼び出し側も同 PR で修正。
   - 完了時間目安: **1 日** (migration + 関数 + caller 修正 + smoke test)。

4. **C-3** (`_run_detection_scan_internal` 二重ループ)
   - C-2 の新 overload を使う。
   - 完了時間目安: **0.5 日**。

5. **C-6** (既存データの TRUNCATE、自動 migration なし)
   - 全 schema / 関数 migration 適用後に実施。
   - 自動 migration には含めず、staging / production とも preflight count → ユーザー明示承認 → 手動 TRUNCATE → `run_detection_scan()` + `run_quality_scoring(true)` 再 scan の順で運用 (RD-C6)。
   - 完了時間目安: **0.5 日** (preflight + ユーザー承認待ち + truncate + 再 scan + 確認)。

**並行実行**: C-1 / C-2 / C-3 は SQL レベルで独立、staging 適用 / dev preview 検証は順次。**C-4 と C-5 は分割せず同一 migration で扱う**。C-6 は最後。

各サブタスクは原則 **別 migration ファイル** で実装。**ただし C-4 + C-5 は同一 migration / 同一 transaction として 1 ファイルに集約する (RD-C5 例外)**。1 PR で全件 commit するか、サブタスク別 PR にするかは実装チャットで判断。

---

## 10. 未解決質問

### 10.A 実装着手前に解くべき質問 (要ユーザー判断、Resolved Decisions として永続化予定)

**該当なし**。Codex 第 1 回レビューで以下 5 件すべて確定済 (RD-C4 〜 RD-C8 として Resolved Decisions に追加):

- **C-1 実装方式** → **RD-C4 で確定**: team JOIN で `teams.game_title` を解決し battles と AND (呼び出し側変更なし)。
- **C-2 必須/optional** → **RD-C7 で確定**: detection 関数の `p_game_title` は **必須引数**、default 'dm' は付けない (誤呼び出し時の混入防止)。
- **C-5 旧 UNIQUE DROP** → **RD-C5 で確定**: Plan C 内で同一 migration / 同一 transaction にて DROP + 関数差し替え。pg_constraint で実 constraint 名確認。
- **C-6 データ migration** → **RD-C6 で確定**: TRUNCATE は **自動 migration に入れず**、staging / production とも preflight count → 明示承認 → 手動 SQL/runbook で実行。「ユーザーゼロだから損失なし」と断定しない。
- **plan commit タイミング** → **RD-C9 で確定**: Codex 指摘反映 + plan-critic GO 後に dev commit 可。Plan A / Plan B と同じパターン。

### 10.B 後回しでよい質問 (Phase 2 / Phase 3 で扱う)

1. `detection_rules` / `quality_scoring_rules` / `quality_scoring_settings` の game 別化 (Phase 2)
2. admin UI で alert の game_title フィルタ / 表示列追加 (Phase 2、Plan C 完了後の UX 改善)
3. `team_members` に `game_title` 列を redundant に持たせる schema 整備 (Phase 2、JOIN コスト削減目的)
4. `games` テーブル化と detection scan の動的 game リスト取得 (Phase 2、game 追加運用)
5. `profiles.stage` 判定ロジックの game 別精緻化 (Plan D の access gate と併せて)
6. detection / quality scoring の cron schedule 調整 (Phase 2、運用負荷次第)
7. **`getQualityScoreSnapshot` / `getMyQualityScore` の per-game 表示拡張** (Codex 第 4 回確定で Phase 2 送り): admin UI で user × game 別の全 snapshot 一覧を表示、ユーザー自身用にも game 別 score を表示する UI 改善。Plan C では「`.single()` 撤去 + `total_score` 最大 row 返却 + 既存 UI shape 維持」で account-level UX を確保し、game 別表示は別 issue として切り出す

---

## 11. ローカル検証コマンド (Plan C 統合)

```bash
# 静的検証
npm run lint
npx tsc --noEmit
npm test -- --run

# 関数定義の grep
grep -rn "FUNCTION public.get_team_member_summaries" supabase/migrations/
grep -rn "FUNCTION.*detect_extreme_winrate\|detect_rapid_input\|detect_repetitive_pattern" supabase/migrations/
grep -rn "FUNCTION.*_calculate_quality_score_internal\|_run_quality_scoring_internal\|_run_detection_scan_internal" supabase/migrations/

# 呼び出し側
git grep -n "get_team_member_summaries\|run_detection_scan\|run_quality_scoring\|calculate_quality_score" src/

# detection_alerts / quality_score_snapshots スキーマ確認 (staging MCP read-only)
# Supabase MCP: list_tables(["public"])
# Supabase MCP: execute_sql で SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_name IN ('detection_alerts', 'quality_score_snapshots');

# staging で既存 alert / snapshot の分布確認 (read-only)
# SELECT game_title, count(*) FROM detection_alerts GROUP BY game_title;
# SELECT game_title, count(*) FROM quality_score_snapshots GROUP BY game_title;
```

---

## 12. Codex にレビューさせるべき観点

`/review-plan-loop` で plan-critic を回した後、Codex に本 plan を渡してレビュー依頼する際の観点リスト:

1. **game scope の過不足**
   - C-1〜C-4 で対象とした関数以外に game scope 漏れがある RPC / クエリが残っていないか
   - admin UI の alert 一覧 / 詳細表示で game_title が正しく扱われるか (本 plan で admin UI 拡張は別 issue だが、現状でも壊れないか)
   - team detail / opponent stats / personal stats などの他経路で混入リスクが残っていないか
2. **`p_game_title` を追加すべき / すべきでない RPC の判定**
   - C-2 detection で必須引数化する判断 (Resolved Decisions **§RD-C7** = 必須化、default 'dm' なし)
   - ゲーム一覧を SQL 配列ハードコードにする判断 (Resolved Decisions **§RD-C2** = `ARRAY['dm', 'pokepoke']` + `src/lib/games/index.ts` 同期コメント)
   - 読み取り系 RPC (`get_*_stats_range` 等) に追加しない判断 (AGENTS.md 既存方針) が plan で明確か
   - 書き込み系 RPC (`auto_add_opponent_deck` 等) は既に対応済の確認
3. **RLS / SECURITY DEFINER / search_path**
   - `CREATE OR REPLACE FUNCTION` で SECURITY DEFINER + `SET search_path = ''` + `public.` 修飾が網羅されているか (`20260424000001_security_hardening_additive.sql` / `20260509000004_secdef_hardening_phase_a.sql` の既存規約準拠)
   - 新 overload に対する `REVOKE ALL ... GRANT EXECUTE TO authenticated` (または `service_role` のみ) の grant 設定
4. **staging / production migration 順序**
   - C-5 (列 + 新 UNIQUE + 旧 UNIQUE DROP) が staging で安全に通るか (既存行に対する制約強化の検証)
   - C-3 / C-4 / C-5 の依存関係 (C-5 → C-4 → C-3 の順) が migration timestamp で正しく順序付けされているか
   - production 適用時の rollback SQL が動作するか
5. **existing data への影響**
   - C-5 列追加で既存行が `game_title = 'dm'` で埋まる挙動が問題ないか
   - C-6 truncate の運用妥当性: production / staging ともテストデータ・admin による手動投入データが存在しうるため、preflight count + ユーザー明示承認制 (RD-C6) で十分か。「一般公開前 = ユーザーゼロ」と断定しない
   - 既存 detection_alerts (default 'dm') が pokepoke ユーザーのものだった場合の取り扱い
6. **Plan A/B 非破壊性**
   - `shares.image_url` / auth / BanGuard / Sentry / OG / SEO / landing を touch していないこと
   - `next.config.ts` / `middleware.ts` / `client.ts` / `sentry-worker.ts` / `api/og/[id]` / `auth/page.tsx` / `auth/callback/page.tsx` を touch していないこと
   - `src/lib/share/image-url.ts` / `src/lib/auth/redirect.ts` / `src/components/providers/BanGuard.tsx` / `src/components/layout/HomeLink.tsx` を touch していないこと
7. **ハードコード game リスト**
   - C-3 で `v_game_titles text[] := ARRAY['dm', 'pokepoke']` のハードコードが将来 game 追加時に更新漏れを起こす可能性 → Phase 2 で `games` テーブル化を予告するコメント
8. **wrapper signature 維持**
   - `run_detection_scan()` / `run_quality_scoring(p_auto_update)` / `cron_run_*` / `calculate_quality_score(p_user_id)` の旧 signature が維持されているか (cron / admin 経路の `Args: never` / 既存呼び出し側の引数構造を変更しない)
9. **`profiles.stage` 更新ロジック**
   - C-4 で game 別 score を保存し、stage 判定は **全 game score の `MAX(score)`** で実施する判断 (RD-C3 で確定、現状維持ではない)
   - `breakdown` JSON に `max_score` / `max_score_game_title` を debug / verification 用に含める判断
   - Plan D に保留するのは **stage の game 別分離 (account-level stage 集約をやめる案)** のみ。本 plan ではこれ以上踏み込まない

---

## 13. 想定タイムライン (参考)

| サブタスク | 実装 + smoke | staging 適用 + dev preview 検証 | production 反映 |
|---|---|---|---|
| C-1 | 0.5 日 | 0.5 日 | 0.5 日 |
| C-2 | 0.5 日 | 0.5 日 (C-3 と並行) | 0.5 日 |
| C-4 + C-5 (統合 migration) | 1 日 (migration + 関数 + caller 修正 + smoke test) | 0.5 日 | 0.5 日 |
| C-3 | 0.5 日 | 0.5 日 (C-2 後) | 0.5 日 |
| C-6 | 0.25 日 (truncate + 再 scan) | — | 0.25 日 |
| 合計 | 約 3 日 | 約 2 日 | 約 2 日 |

Codex レビュー / plan-critic 反復を含めると **1.5〜2 週間** が現実的なバッファ。

---

## 14. レビュー / 反映フロー

1. 本 plan ファイル作成 (完了時点)
2. `/review-plan-loop docs/plans/2026-05-27_plan_c_multi_game_db_scope.md` で plan-critic にレビューさせ、指摘を反映 → GO 判定まで反復
3. ユーザーが Codex に本 plan を渡してレビュー → Codex 指摘を Claude Code 側で反映 → 再度 plan-critic で差分レビュー (Plan A / Plan B と同じパターン)
4. ユーザー承認後、別チャットで実装着手 (本 plan 作成チャットでは実装に入らない)
5. 実装後の検証 (Plan C 全体 §8) → user 承認 → production 反映

---

## 15. 補足

- 本 plan は統合 audit §4.4 のうち実装可能な単位を整理したもの。
- Plan A / Plan B 完了報告と整合しており、Plan A / Plan B が touch した領域には Plan C で再度触らない。
- Plan D (Access Gate / Auth Expiry) は Plan C の `profiles.stage` 更新ロジックと接続するため、Plan C 完了後に着手する想定。
- Phase 2 (Plan E) / Phase 3 (Billing / Ads / Legal) は本 plan と独立して別途作成。

---

## Resolved Decisions

review-plan-loop 反復中にユーザー承認された判断事項を永続化する。本文の関連 section は本セクションを最終正とする。

### RD-C1 [C-3 dedup location] detection alert の重複防止ロジック集約先 → **detect_* 関数本体に集約 (案 1)**

採用方針:

- **各 `detect_extreme_winrate` / `detect_rapid_input` / `detect_repetitive_pattern` 関数内**の既存 NOT EXISTS / duplicate guard に `da.game_title = p_game_title AND da.is_resolved = false` を **明示追加**する。
- `_run_detection_scan_internal` 側は **各 detect_* に `p_game_title` を渡す orchestration のみ**に留め、別個の NOT EXISTS dedup は追加しない (runner 側 dedup は撤回)。
- 重複防止は各 detection rule の意味論に近いため、`detect_*` 単体を呼んだ場合にも dedup が効く設計を維持。

理由:

- runner 側だけに寄せると、admin RPC / 手動検証 / debug で `detect_*` を直接呼んだ場合に未解決 alert の重複 INSERT を防げない。
- 既存構造に近く、Plan C では game_title 条件追加にスコープを絞りやすい。
- runner 側で別種の横断 dedup や sliding window を入れるのは Phase 2 以降。

### RD-C2 [game list source] `_run_detection_scan_internal` 内のゲーム一覧 → **SQL 配列ハードコード (案 1)**

採用方針:

- **`_run_detection_scan_internal` 内で `v_game_titles text[] := ARRAY['dm', 'pokepoke']` をハードコード**する。
- migration ファイル冒頭と関数定義コメントに **「新ゲーム追加時は `src/lib/games/index.ts` の `GAME_SLUGS` だけでなく、この SQL 配列も更新が必要」と明記**する。
- Phase 2 で `public.games (slug text PRIMARY KEY)` マスタ化または DB 側 game registry 化を検討対象として plan §10.B に残す。

理由:

- Plan C では game scope 漏れの修正に集中し、games マスタ新設まではスコープを広げない方が安全。
- `battles.game_title` からの動的取得は、battles がまだ存在しないゲームで scan が走らない問題があり、新ゲーム追加直後の検証漏れが起きる。
- 現時点のゲームは `dm` / `pokepoke` の 2 つで固定なので、Plan C では明示配列で十分。

### RD-C3 [stage aggregation] `profiles.stage` 自動昇格/降格判定の game 別 score 集約方式 → **全 game の最大値で判定 (案 3)**

採用方針:

- user × game 別 score は `quality_score_snapshots` に保存する (C-5 のキー追加で対応)。
- `_run_quality_scoring_internal` での `profiles.stage` 昇格 / 降格判定には、**その user の全 game score の `MAX(score)` を使う**。
- `_calculate_quality_score_internal` の戻り値 (snapshot に保存される `breakdown` JSON) には `max_score` と `max_score_game_title` を debug / snapshot / verification 用に含める。
- `calculate_quality_score(p_user_id)` wrapper の戻り値は max ベース (account-level) で統一。
- 将来的に stage を game 別に分離する案は Phase 2 / Plan D 以降の検討事項として §10.B に残す。

理由:

- `profiles.stage` は現状 user / account-level の属性なので、user × game 別 score を最終的に account-level へ集約する必要がある。
- 「dm score 固定」だと pokepoke 専用ユーザーが dm score 0 扱いになり、不当に降格しうるため避けたい。
- 「全 game 最大値」は「いずれかの game が閾値超過で昇格」と実質近いが、`MAX(score)` として扱う方がログ・検証・将来の説明がしやすい。
- Plan D に保留すると、Plan C 後も pokepoke 側の quality scoring が stage 判定に反映されない状態が残るため、Plan C で集約方針まで決めておく方が現実的。

(以下に Codex 第 1 回反映で追加した RD-C4 〜 RD-C9)

### RD-C4 [C-1 implementation] `get_team_member_summaries` の game scope 修正方式 → **team JOIN で `teams.game_title` を解決 (案 A)**

採用方針 (Codex 第 1 回指摘で確定):

- `team_members → teams` JOIN で `teams.game_title` を取得し、`battles.game_title = teams.game_title` を AND する。
- 呼び出し側 (`src/lib/actions/team-actions.ts:174`) の `supabase.rpc("get_team_member_summaries", { p_team_id })` は **変更不要**。
- 旧 `is_team_member` 権限チェックと `tm.hidden_at IS NULL` フィルタは既存セマンティクス維持。
- `p_game_title text` 必須引数追加 (案 B) は採らない。client 側を一切触らない最小差分が好ましいため。

### RD-C5 [C-5 unique drop] `quality_score_snapshots` 旧 `(user_id)` UNIQUE DROP のタイミング → **Plan C 内で同一 migration / 同一 transaction にて実施**

採用方針 (Codex 第 1 回指摘で確定):

- 列追加 / 新 UNIQUE 追加 / 旧 UNIQUE DROP / 関数差し替え (`_calculate_quality_score_internal` / `_run_quality_scoring_internal` / `calculate_quality_score`) を **同一 migration / 同一 transaction** にまとめる。
- 旧関数が `ON CONFLICT (user_id)` を参照したまま旧 UNIQUE だけ消える **中間状態を作らない** ことを保証する。
- 実装時は `pg_constraint` で実 constraint 名を確認してから DROP (`SELECT conname, contype, pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid = 'public.quality_score_snapshots'::regclass AND contype IN ('u', 'p');`)。確認結果を migration ファイル冒頭にコメントで残す。
- Phase 2 への送り (案 B) は採らない。expand-only で旧 UNIQUE が残ると `(user_id, 'dm')` と `(user_id, 'pokepoke')` を同時に持てず C-4 の UPSERT が衝突するため。

### RD-C6 [C-6 data migration] 既存 detection_alerts / quality_score_snapshots の TRUNCATE 方針 → **migration に入れず、手動 SQL/runbook で明示承認制**

採用方針 (Codex 第 1 回指摘で確定):

- C-3 / C-5 の schema / function 変更 migration には **TRUNCATE を含めない**。
- staging / production とも以下の順序を手動運用フローとして runbook 化:
  1. preflight count: `SELECT game_title, count(*) FROM detection_alerts GROUP BY game_title;` 等で件数報告
  2. ユーザー明示承認 (バックアップ確認 production 必須)
  3. 手動 TRUNCATE SQL 実行
  4. `run_detection_scan()` / `run_quality_scoring(true)` で再生成
  5. 再生成後の count 報告
- **「ユーザーゼロだから損失なし」と断定しない**: production / staging ともテストデータ・admin による手動投入データが存在しうるため、preflight count による事実確認を必須化。
- runbook ファイル: `docs/runbooks/plan_c_data_truncate.md` (Plan C 実装時に新規作成)。

### RD-C7 [C-2 required arg] detection 関数の `p_game_title` 引数 → **必須引数、default 'dm' は付けない**

採用方針 (Codex 第 1 回指摘で確定):

- `detect_extreme_winrate(p_params jsonb, p_game_title text)` のように `p_game_title text` を **2 番目の必須引数**として追加 (default 値なし)。
- `p_game_title text DEFAULT 'dm'` のように optional default を付ける案は **採らない**。理由: 誤呼び出し時に `game_title = 'dm'` の偽陽性検出が発生し、Codex レビューの「detection が dm に張り付く」根本原因の再発リスクがあるため。
- runner (`_run_detection_scan_internal`) は新 overload を **必ず** `(p_params, p_game_title)` の 2 引数で呼ぶ (RD-C8)。

### RD-C8 [C-2 old overload] detection 関数の旧 overload の扱い → **互換のため一時的に残すが非推奨・runner未使用・Phase 2 で DROP 対象**

採用方針 (Codex 第 1 回指摘で確定):

- 旧 overload (`p_params jsonb` のみ、`p_game_title` なし) は Plan C では **DROP しない** が、運用上以下を統一する:
  - **`_run_detection_scan_internal` は新 overload のみを呼ぶ**。旧 overload は runner から参照されない。
  - 関数定義に `COMMENT ON FUNCTION ... IS 'DEPRECATED in Plan C, scheduled for DROP in Phase 2. Use the 2-arg overload (p_params, p_game_title) instead.';` を付与し、admin / 開発者が判別できるようにする。
  - Phase 2 で contract migration として旧 overload を DROP。Phase 2 着手時に `pg_proc` / `pg_depend` で旧 overload に依存する未知の caller がないことを確認してから実行。
- 新 overload の `RETURNS TABLE` は既存と揃える: `RETURNS TABLE (user_id uuid, rule_key text, details jsonb)` (3 列)。本文 §6 C-2 擬似 SQL の 2 列 (`user_id`, `details`) は **既存と不整合**のため、実装時は 3 列に揃える。

### RD-C9 [plan commit timing] 本 plan ファイルの dev branch commit タイミング → **Codex レビュー反映 + plan-critic GO 後に dev commit 可**

採用方針 (Codex 第 1 回指摘で確定):

- 本 plan 作成チャットでの commit は **Codex 第 1 回指摘反映 + plan-critic GO 後** に実施可。Plan A / Plan B と同じパターン。
- main merge / main push は **絶対にしない** (実装着手後の Plan A / Plan B 完了報告と同じ運用)。
- 実装は別チャットで開始する。

---

## 本文への RD 反映 (cross-ref)

- **§6 C-2 (detection 関数)**: RD-C1 で確定。各 detect_* 関数の既存 NOT EXISTS に `da.game_title = p_game_title AND da.is_resolved = false` を明示追加する。本文 §6 C-2 擬似 SQL は反復 1 で既に NOT EXISTS + game_title フィルタ込みに修正済。
- **§6 C-3 (`_run_detection_scan_internal`)**: RD-C1 + RD-C2 で確定。dedup は detect_* に集約し runner 側は orchestration のみ、`v_game_titles` は `ARRAY['dm', 'pokepoke']` ハードコード + 同期必要コメント明記。本文 §6 C-3 擬似 SQL に「runner 側 NOT EXISTS は detect_* 内に移動」「同期コメント追加」を反映する更新が必要。
- **§6 C-4 (`_calculate_quality_score_internal` / `_run_quality_scoring_internal`)**: RD-C3 で確定。stage 判定に `MAX(score)` 採用、`breakdown` に `max_score` / `max_score_game_title` を含める。本文 §6 C-4 の wrapper 戻り値方針と stage 判定ロジックを更新する必要がある。
- **§10.A 未解決質問**: RD-C1 〜 RD-C9 で全件 resolved。§10.A は「該当なし」に整理済 (Codex 第 1 回反映)。
- **§10.B**: Phase 2 で games マスタ化、Plan D で stage の game 別分離を検討する旨を追記。
- **§6 C-1 (`get_team_member_summaries`)**: **RD-C4** で確定 (team JOIN 方式、呼び出し側変更なし)。
- **§6 C-2 (detection 関数)**: **RD-C7** + **RD-C8** で確定 (`p_game_title` 必須、旧 overload は非推奨で Phase 2 DROP)。
- **§6 C-4 (quality scoring)**: **RD-C3** + Codex 第 1 回 quality scoring game scope ポリシーで確定 (battle / alert / discord は game-level、admin bonus / X 連携は account-level)。`profiles.stage` 判定は MAX(score) で実施 (現状維持ではない)。Plan D に保留するのは stage の game 別分離のみ。
- **§6 C-5 (`quality_score_snapshots`)**: **RD-C5** で確定 (Plan C 内で同一 migration / 同一 transaction にて旧 UNIQUE DROP + 関数差し替え、pg_constraint で実 constraint 名確認)。
- **§6 C-6 (data migration)**: **RD-C6** で確定 (TRUNCATE は migration に入れず、手動 SQL/runbook で明示承認制)。

---

## Codex Review Feedback

### Codex Review 第 1 回 (2026-05-27)

主要 7 点を反映 (本ターン):

| # | Codex 第 1 回指摘 | plan 反映先 | 反映内容 |
|---|---|---|---|
| 1 | `quality_score_snapshots` 旧 UNIQUE DROP 方針統一 (Phase 2 送りではなく Plan C 内、同一 transaction、pg_constraint で実 constraint 名確認) | §6 C-5 / RD-C5 | 列追加 + 新 UNIQUE + 旧 UNIQUE DROP + 関数差し替えを同一 migration / 同一 transaction で実施、pg_constraint クエリを migration コメントとして残す方針を確定 |
| 2 | C-6 TRUNCATE を自動 migration から外し、手動 runbook + 明示承認制に | §6 C-6 / RD-C6 | TRUNCATE は migration に含めず、staging / production とも preflight count → 明示承認 → 手動 SQL/runbook で実行。「ユーザーゼロだから損失なし」を断定しない |
| 3 | §10.A 全 5 件を resolved に | §10.A / RD-C4-9 | RD-C4 (C-1 team JOIN) / RD-C5 (C-5 同時 DROP) / RD-C6 (C-6 手動 runbook) / RD-C7 (C-2 p_game_title 必須) / RD-C8 (C-2 旧 overload 非推奨) / RD-C9 (plan commit タイミング) を追加。§10.A は「該当なし」に |
| 4 | RD-C3 と C-4 本文/検証表を同期 (現状維持ではなく MAX(score) で判定、Plan D 残しは game 別分離のみ) | §6 C-4 検証表 | 検証表に MAX(score) 判定行 + `breakdown` に `max_score` / `max_score_game_title` 含む行 + wrapper 戻り値が MAX(score) になる行を追加 |
| 5 | quality scoring の game scope 明示 (battle / discord_connections / unresolved_alerts は game-level、admin bonus / X 連携は account-level) | §6 C-4 実装方針 (新規 quality scoring game scope ポリシー表) | game-level rule (battle / alert / discord) と account-level rule (admin bonus / X 連携) を表形式で明示 |
| 6 | detection 関数 signature / 旧 overload 方針 (runner は新 overload を必ず呼ぶ、旧 overload は非推奨、`RETURNS TABLE` は既存 3 列に揃える) | §6 C-2 / RD-C7 / RD-C8 | runner は新 overload のみ呼び出し、旧 overload は COMMENT で DEPRECATED 表示 + Phase 2 で DROP。`RETURNS TABLE (user_id, rule_key, details)` の 3 列に揃える方針を確定 |
| 7 | ヘッダステータスを「Codex レビュー指摘反映中」に | ヘッダ | 「ドラフト (Codex レビュー前)」を「Codex レビュー第 1 回指摘反映中」に更新 |

**Codex 第 1 回反映の結果**:

- §10.A の未解決質問が **全件 resolved** され、実装着手前のオープン質問ゼロ。
- C-5 / C-6 の安全な migration 順序 + 手動運用が runbook 化される設計に確定。
- detection 関数の game scope が必須化され、quality scoring の game scope ポリシー (game-level vs account-level) が明示。
- Resolved Decisions は累計 **9 件** に拡張 (RD-C1〜RD-C9)。

### Codex Review 第 2 回 (2026-05-27、第 1 回反映後の追加レビュー)

主要 6 点を反映 (本ターン、**新規 RD なし、文書整合 + 細部の整理**):

| # | Codex 第 2 回指摘 | plan 反映先 | 反映内容 |
|---|---|---|---|
| 1 | 旧 UNIQUE DROP の Phase 2 送り記述を全箇所削除し RD-C5 と統一 | §5.1 UNIQUE 制約変更行 / §5.2 順序の必須性 / §5.3 rollback 表 | §5.1 の expand-contract 二段表記を「同一 migration / 同一 transaction で完結 (RD-C5)」に書き換え。§5.2 の「C-5 は expand のみ」を撤回し、C-4 + C-5 統合 migration の必須性を明記。§5.3 rollback 表で C-4 + C-5 統合 migration の rollback 順序 (関数差し戻し → 旧 UNIQUE 復元 → 新 UNIQUE DROP → 列 DROP) を明記 |
| 2 | §9 実装順序を RD-C5 と同期 (C-5 + C-4 同一 migration) | §9 実装順序 | C-4 と C-5 を別エントリから「**C-4 + C-5 (統合 migration)**」に統合。「各サブタスクは別 migration ファイル推奨、ただし C-4 + C-5 は同一 migration / 同一 transaction (RD-C5 例外)」を明記 |
| 3 | §8 統合検証 Quality scoring 行を RD-C3 同期 (現状維持 → MAX(score)) | §8 統合検証表 | 「`profiles.stage` 更新ロジックは現状維持」を「RD-C3 で確定: 全 game score の MAX(score) で判定、`breakdown` に `max_score` / `max_score_game_title` を含む。Plan D に保留するのは stage の game 別分離のみ」に書き換え |
| 4 | detection 関数 rule_key 方針統一 (`d.rule_key` vs `v_rule.rule_key` の二重方針撤回) | §6 C-2 (RD-C8 説明) + §6 C-3 擬似 SQL | runner 側 INSERT 文を **`d.rule_key` 経由に統一**、`v_rule.rule_key` リテラル供給を撤回。§6 C-2 の「二重化しなくて済む」記述を「`d.rule_key` で統一」「`v_rule.rule_key` 供給は採らない」に書き換え。§6 C-3 擬似 SQL 3 行を `d.rule_key` 経由に変更 |
| 5 | §C-5 pg_constraint 確認 SQL の WHERE 括弧追加 | §6 C-5 採用方式 SQL コメント | OR 句を括弧で括り、対象テーブル外の constraint を誤検出しない形に修正。括弧なしの場合の誤動作を注記 |
| 6 | §12 Codex 観点で「一般公開前 = ユーザーゼロ」表現を RD-C6 と統一 | §12 観点 5 | 「C-6 truncate 案 A で本番に影響するデータがないか (一般公開前 = ユーザーゼロの確認)」を「production / staging ともテストデータ・admin による手動投入データが存在しうるため、preflight count + ユーザー明示承認制 (RD-C6) で十分か」に書き換え |

**Codex 第 2 回反映の結果**:

- 設計変更ゼロ、新規 RD なし。RD-C5 / RD-C6 / RD-C8 / RD-C3 と本文の整合のみ。
- C-4 + C-5 が **必ず同一 migration / 同一 transaction で適用される** ことが §5.1 / §5.2 / §5.3 / §9 の 4 箇所で一貫して明示。
- detection 関数 rule_key 方針が `d.rule_key` 経由に統一され、二重方針消失。
- `pg_constraint` クエリの WHERE 括弧で誤検出リスクが解消。
- 「一般公開前 = ユーザーゼロ」断定表現が plan 全体から排除。

### Codex Review 第 3 回 (2026-05-27、第 2 回反映後の文書整合最終整理)

主要 4 点を反映 (本ターン、**新規 RD なし、文書整合のみ**):

| # | Codex 第 3 回指摘 | plan 反映先 | 反映内容 |
|---|---|---|---|
| 1 | §5.1 原則文を RD-C5 例外明記に修正 (「すべて additive expand」「UNIQUE キー変更は避ける」が RD-C5 と矛盾) | §5.1 expand → code → contract の原則 | 「原則として additive expand」+「C-4 + C-5 は RD-C5 で確定した例外として、UNIQUE キー変更 (DROP まで含む) を同一 migration / 同一 transaction で実施」と明記 |
| 2 | §5.2 C-1〜C-3 read-only 説明を正確化 (C-3 `_run_detection_scan_internal` は実行時に `detection_alerts` への INSERT を伴う) | §5.2 順序の必須性 | C-1 / C-2 と C-3 を分離: C-1 / C-2 は関数本体 SELECT のみで Code / Migration 順序非依存。C-3 は **関数置換は read-only だが、実行 (`run_detection_scan()` smoke / 手動 scan) は書き込みを伴うため staging / production の本番化前に意図したタイミングで実行**、production 実行はユーザー承認後の手動限定 |
| 3 | §12 Codex 観点 2 の RD 参照を修正 | §12 観点 2 | 「C-2 必須引数化 (Resolved Decisions §RD-C2)」を「**§RD-C7** = 必須化、default 'dm' なし」に修正。ゲーム一覧ハードコードは **§RD-C2** で別 bullet 明記 |
| 4 | ヘッダステータス更新 | ヘッダ | 「Codex レビュー第 2 回指摘反映中」→「**Codex 第 2 回反映済 / 第 3 回レビュー指摘反映中**」に更新 (plan-critic 累計 12 反復 + 第 1 〜 第 3 回反映完了) |

**Codex 第 3 回反映の結果**:

- 設計変更ゼロ、新規 RD なし。§5.1 / §5.2 / §12 の文書整合のみ。
- §5.1 が RD-C5 例外を **正面から明記** する形になり、「すべて additive expand」断定表現が排除された。
- §5.2 の read-only 表現が **関数置換 vs 関数実行** で分離され、`run_detection_scan()` 実行タイミングの慎重さが明文化された。
- §12 観点 2 の RD 番号誤参照が解消 (RD-C2 → RD-C7、RD-C2 は別 bullet で正しく参照)。

### Codex Review 第 4 回 (2026-05-27、第 3 回反映後の最終判断固定)

主要 3 点を反映 (本ターン、**新規 RD なし、判断の固定と pg_cron 前提整理のみ**):

| # | Codex 第 4 回指摘 | plan 反映先 | 反映内容 |
|---|---|---|---|
| 1 | snapshot caller の修正方針確定 (game フィルタ付き vs 全 game 取得 + 集約の二択を撤回) | §6 C-5 リスク 2 / §3.2 caller 表 / §10.B | `getQualityScoreSnapshot(userId)` と `getMyQualityScore()` を **`.single()` 撤去 + 全件取得 → `total_score` 最大 row 返却** に統一 (RD-C3 account-level MAX と整合)。既存 UI shape は維持し、`breakdown.max_score_game_title` を追加情報として返却 object に含めて可。per-game 表示 / game filter 引数追加 は **Phase 2 / admin UI 改善** に送る (§10.B 追加) |
| 2 | production cron 前提の整理 (「手動実行限定」表現撤回) | §5.2 順序の必須性 + §6 C-6 staging / production フロー | 「既存 cron が自動実行されうる。C-6 TRUNCATE 後の再生成は手動即時実行、その後の cron は通常運用として許容」を明記。TRUNCATE 作業中の cron 競合回避手順 (preflight / 承認 / pg_cron 一時停止 / truncate / immediate re-scan / count 確認 / cron 再開) を staging / production の両フローに反映 |
| 3 | ヘッダステータスを「完成 / 実装可能水準」へ | ヘッダ | 「Codex 第 2 回反映済 / 第 3 回レビュー指摘反映中」を「**完成 / 実装可能水準** (plan-critic 累計 13 反復 + Codex 第 1〜4 回反映完了、未解決質問ゼロ、設計矛盾ゼロ)」に更新 |

**Codex 第 4 回反映の結果**:

- 設計変更ゼロ、新規 RD なし。snapshot caller 二択の固定 + pg_cron 前提整理 + ヘッダステータス更新のみ。
- snapshot caller 修正方針が **「`.single()` 撤去 + 全件取得 + `total_score` 最大 row + 既存 UI shape 維持」** で確定し、admin UI / account UI への regression リスクが明確化。
- pg_cron 前提が plan 全体で **「自動実行されうる正常運用」** として扱われ、「production 手動限定」断定表現が排除。
- TRUNCATE 作業中の cron 競合回避手順が runbook 化される設計に確定。

### Codex Review 第 5 回 (2026-05-28、実装 commit 後の追加レビュー)

主要 3 点を実装側で反映 (本ターン、**新規 RD なし、`20260527000005` migration + actions の細部修正のみ**):

| # | Codex 第 5 回指摘 | 反映先 | 反映内容 |
|---|---|---|---|
| 1 | `_run_quality_scoring_internal` の `v_max_score := 0` 初期化問題 (全 game の score が負値なら MAX(score) が 0 に張り付く、RD-C3 に反する) | `supabase/migrations/20260527000005_c4_c5_quality_scoring_game_scope.sql` step 6 | `v_max_score` / `v_max_game_title` を **NULL 初期化** に変更し、wrapper と同じ `v_max_game_title IS NULL OR v_total > v_max_score` の first-eligible 方式に統一。stage 判定も `v_max_score IS NOT NULL` でガード |
| 2 | snapshot.breakdown に `max_score` / `max_score_game_title` が含まれず、plan / runbook の検証手順 (`SELECT breakdown->>'max_score_game_title'`) と矛盾していた | `supabase/migrations/20260527000005_c4_c5_quality_scoring_game_scope.sql` step 6 | 第 1 周で各 game の (total_score, breakdown) を `v_game_scores` jsonb に蓄積し、第 2 周で snapshot UPSERT 時に breakdown に `max_score` / `max_score_game_title` を含めて保存する **二段 loop** に変更。runbook の `SELECT user_id, game_title, total_score, breakdown->>'max_score_game_title'` 検証が通る形に |
| 3 | `getMyQualityScore` / `getQualityScoreSnapshot` の `.order("total_score", desc)` のみで `.limit(1)` していたため、同点時に返る game が非決定的 | `src/lib/actions/account-actions.ts` / `src/lib/actions/admin-actions.ts` | `.order("game_title", { ascending: true })` を secondary order として追加し、DB wrapper の `ARRAY['dm', 'pokepoke']` first-eligible 順 (= ASC) と挙動を一致させる。migration コメントに「v_game_titles は ASC 順で記載 (action 側 tie-break と一致させる目的)」を追記 |

**Codex 第 5 回反映の結果**:

- 設計変更ゼロ、新規 RD なし。**実装側の `20260527000005` migration を 1 ファイル + actions 2 ファイルを編集**。
- 負値スコアの取り扱いが wrapper / runner 間で一貫し、RD-C3 の MAX(score) 判定が「0 floor 付き」ではなく「真の MAX」になる。
- snapshot breakdown に max_score / max_score_game_title が確実に含まれ、`docs/runbooks/plan_c_data_truncate.md` 内の検証 SELECT が staging / production で意図通りに動く。
- 同点時の tie-break が DB と client 側で揃い、admin UI / account UI の表示が安定。
- staging DB migration 適用前に修正完了。`20260527000005` migration はまだ staging に適用していないため、ファイル直接編集で問題なし (履歴の整合性は維持)。
