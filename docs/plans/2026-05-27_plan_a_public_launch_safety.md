# Plan A: Public Launch Safety (一般公開前必須修正)

- 作成日: 2026-05-27
- 作成者: Claude Code (Opus 4.7)
- 元レポート: `docs/reports/2026-05-27_integrated_pre_public_monetization_audit.md`
- 対応する統合レポート Findings: 4.1 (P0), 4.3 (P1), 4.9 (P1), 4.10 (P1)
- ステータス: **完成 (実装可能水準)**。plan-critic 6 反復 + Codex 3 周 (第 1 回 / 第 2 回 / 最終) を経て、未解決質問なし
- 想定ブランチ: `dev`
- **本 plan ファイルの取り扱い** (Codex 最終指摘 4):
  - 本 plan は **plan 作成専用チャット** で作成された。実装は **別チャットで、不要なコンテキストを持たない状態** で開始する設計。
  - 実装チャットは **本 plan ファイル単独を読むだけで作業可能** な状態を維持する (本ファイルから外部参照する文書は §0 / §1 / §10.A / 「Codex Review Feedback」セクションで列挙済)。
  - **本 plan 作成チャットでは実装には入らない**。コード編集 / DB 変更 / commit / push / 外部サービス操作は一切しない。plan ファイル編集のみ。
  - 実装着手は、ユーザーが別チャットで「実装してください」と明示指示した時点から開始する。CLAUDE.md / AGENTS.md / §2 「プロジェクト固有ルールの厳守事項」を実装チャットで再度参照すること。

---

## 0. 目的とスコープ

統合レポート §7 の「Plan A: Public Launch Safety」に対応する実装 plan。一般公開当日に「壊れている」「危険な動作」「ブランド毀損」を出さないために必須となる、UI / route 中心の修正を対象とする。

含めるもの:

- A-1 `shares.image_url` 任意外部 URL 保存・表示・redirect の拒否 (P0)
- A-2 legacy URL / game slug なし遷移 / 文字化け / `loading.tsx` / `global-error.tsx` (P1)
- A-3 `BanGuard` 白画面解消 (P1)
- A-4 共有/未ログイン導線で `game` / `next` を引き継ぐ (P1)

含めないもの (別 plan):

- ban / suspended / unpaid の共通 access gate (統合レポート 4.2) → Plan D
- マルチゲーム DB スコープ (4.4) → Plan C
- Sentry / OG フォント / SEO / sitemap / noindex (4.5, 4.6, 4.7) → Plan B
- auth 失効 silent empty 化、`getUser()` 用途別整理、middleware session refresh (4.8, 4.12) → Plan D
- share expiry / DB error 分離 / public GET cache (4.11) → 別 plan (Plan B 同梱を想定)。Plan A の helper に触る場合のみ後述「§8 オプションサブタスク」で言及
- `auto_add_opponent_deck_trigger` safe-hatch (4.13) → Plan C と一緒の DB plan
- 初回オンボーディング (4.14) → Phase 2 の Plan E
- billing / ads / legal (§5) → Phase 3 の別 plan

---

## 1. 関連 plan との依存関係

| Plan | 内容 | Plan A との関係 |
|---|---|---|
| **Plan A (本 plan)** | UI/route 修正 + shares.image_url 制限 | — |
| Plan B: Observability / OG / SEO | Sentry scrubber, OG フォント、root landing, sitemap, noindex | 独立。並行可。Plan A の `loading.tsx` / `global-error.tsx` 追加で error 発生時 Sentry にイベントが飛ぶようになると Plan B の scrubber 整備の必要性が増す |
| Plan C: Multi-Game DB Scope | `get_team_member_summaries` / detection / quality scoring の game scope | 独立。並行可。ただし migration を含むため staging 適用順序は調整が必要 |
| Plan D: Access Gate / Auth Expiry | ban / suspended access gate、`getUser()` 用途別整理、`if (!user) return []` 統一 | 関連あり。**Plan A の `BanGuard` 修正は表層 (try/catch/finally と UI 表示) に留め、stage判定/gate構造の根本設計は Plan D に委ねる**。Plan A が先行する場合は Plan D で再修正される前提で進める |
| Plan E (Phase 2): onboarding / perf / Discord / test 復旧 | 初回戦績登録、`recharts` lazy 化、Discord refresh handling | Plan A 後 |
| 収益化 plan (Phase 3) | billing / ads / legal | Plan A 完了後の別フェーズ |

実装順序の推奨:

1. **Plan A** (本 plan) を先に実装・本番反映 → ブロッカー P0 を塞ぐ
2. Plan B / Plan C を並行で進める (Plan C は DB migration を含むため staging 検証期間が長い)
3. Plan D は Plan A の `BanGuard` 修正・`if (!user) return []` 周辺を上書き再設計する想定で、Plan A 反映後の挙動を見てから着手

---

## 2. プロジェクト固有ルールの厳守事項

`AGENTS.md` / `CLAUDE.md` から本 plan に直結する制約:

- **`main` への直接 push 禁止**。全変更を `dev` ブランチで実装し、ユーザーの「本番反映」明示指示を待ってから `main` へ merge する。
- **`dev` への commit/push は実装完了時点で Claude が自動実施可**。本番影響なし。
- **`npx supabase db push` は production 適用前にユーザー明示指示を待つ**。staging 適用は dry-run → 件数確認 → `--apply` の順。
- **本 plan の DB migration (A-1) は additive expand**。既存本番コードに無害な additive expand migration は staging 適用 + dev preview 検証 + ユーザーの明示承認があれば code deploy 前に production 先行適用可。ただし trigger は RAISE EXCEPTION で新規 INSERT を拒否する破壊的副作用があるため、後述 §5 の判断ポイントで「code deploy と同時または後」を選ぶ。
- **既存 auth 設定 (implicit flow / `client.ts` / `middleware.ts` / `auth/callback/page.tsx` の SIGNED_IN 処理) は変更しない**。`auth/callback` は新しいイベント分岐の追加のみ可。
- **`getUser()` を `getSession()` に一括置換しない**。本 plan の BanGuard 修正は既存の `supabase.auth.getUser()` 呼び出しを維持。
- **URL ハードコード禁止**。`process.env.NEXT_PUBLIC_APP_URL` か `window.location.origin` 経由。
- **Runtime secret は `getServerEnv()` 経由**。本 plan の DB 接続は service_role を直接扱わない (既存 helper のみ利用)。
- **Cloudflare / Supabase ダッシュボード操作案内が出る場合は公式ドキュメント確認を plan に含める**。本 plan では原則ダッシュボード操作不要 (DB migration 適用のみ)。

---

## 3. サブタスク詳細

### A-1: `shares.image_url` 任意外部 URL の拒否 (P0)

#### 対象ファイル

- DB:
  - 新規 migration: `supabase/migrations/2026MMDD000001_shares_image_url_storage_only.sql` (BEFORE INSERT/UPDATE trigger + 任意で CHECK constraint)
- アプリ:
  - `src/app/api/og/[id]/route.tsx` (L384-388 の `Response.redirect(storedImageUrl, 302)` を sanitize)
  - `src/app/share/[id]/page.tsx` (L81 / L134 の `share.image_url ?? /api/og/${id}` を sanitize)
  - 新規 helper: `src/lib/share/image-url.ts` (sanitizer)
- 任意: `src/components/share/ShareModal.tsx` (現状の INSERT 形式は変更不要、検証はサーバー側 trigger で実施)

#### 変更方針 (DB 二段防御 + display sanitizer)

**方針確定**: DB 側 trigger と display 側 sanitizer の **二段防御**。クライアントから `image_url` 受け取りを完全廃止する第三案は ShareModal の image upload フローと大きく衝突するため Plan A スコープを超える。

##### DB 側 (BEFORE INSERT trigger)

- `shares.image_url` に対し BEFORE INSERT/UPDATE trigger を追加。
- 許可条件は次の **すべて** を満たすこと:
  1. `image_url IS NULL` (画像なし share。OG fallback 経路)
  2. または `image_url` が `${NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/share-images/` で始まる Storage public URL。
  3. かつ pathname が `share-images/<user_id>/...` の形で、`<user_id>` 部が INSERT 対象行の `user_id` と一致。
- 違反時は `RAISE EXCEPTION 'shares.image_url must point to share-images/<user_id>/ in Supabase Storage'`。
- 補助関数として `public.is_safe_share_image_url(p_image_url text, p_user_id uuid) returns boolean` を `SECURITY DEFINER` で定義し、`SET search_path = ''` を付与 (既存 secdef hardening 方針 §`20260509000004_secdef_hardening_phase_a.sql` 準拠)。
- `NEXT_PUBLIC_SUPABASE_URL` の値は migration 内で hard-code せず、`app_settings` (`20260515000001_app_settings_and_shares_expiry.sql` で導入済、`key text PK / value jsonb` の key-value テーブル) に `key = 'storage_public_url_prefix'` の **新規行**を INSERT し、`SELECT (value#>>'{}') FROM public.app_settings WHERE key = 'storage_public_url_prefix'` で取得する方式 (既存 `set_shares_expires_at` と同じ pattern)。列追加 (`ALTER TABLE ... ADD COLUMN`) は既存 key-value 設計と矛盾するため不可。**RD-1 で確定済方式**。
- 既存行に対する CHECK constraint は **追加しない**。staging に prod fixture を同期した時に既存外部 URL 行が存在する可能性があるため、新規 INSERT/UPDATE のみで防御し、既存行は display sanitizer で防ぐ。
- **`storage_public_url_prefix` 値の妥当性検証** (`validate_app_settings` trigger 新分岐):
  - 型: jsonb scalar string (`(value#>>'{}')::text` で取り出した結果が text)。
  - 形式: `https://` で始まる。
  - 必須末尾: `/storage/v1/object/public/share-images/` で **末尾 slash 含む** こと。
  - `validate_app_settings` (`20260515000001` で `share_retention_days` のみ厳格 validate している既存 trigger) に **新分岐**を追加: `IF NEW.key = 'storage_public_url_prefix' THEN ... 上記検証 ... END IF;`。値が不正なら `RAISE EXCEPTION` で `app_settings` の INSERT/UPDATE を拒否。
- **初回 INSERT 時点で validation を効かせる仕組み** (Codex 再レビュー指摘 2):
  - 順序設計上、`storage_public_url_prefix` 行 INSERT は trigger migration 適用より前 (staging step 1 / production step 9) に行われる。初回 INSERT 時点では `validate_app_settings` の新分岐がまだ存在しないため、不正な値の混入を検知できない。
  - 対策: trigger migration ファイル (`2026MMDD000001_shares_image_url_storage_only.sql`) 内で `validate_app_settings` 関数を `CREATE OR REPLACE` で更新した直後に、**既存の `storage_public_url_prefix` 行に対して validation を強制再評価する SQL** を埋め込む。具体的には次のいずれか:
    - 案 (a): `UPDATE public.app_settings SET value = value WHERE key = 'storage_public_url_prefix';` (no-op に見える UPDATE で BEFORE UPDATE trigger を発火させ、新 validation を走らせる。違反値が入っていれば migration 自体が `RAISE EXCEPTION` で失敗)
    - 案 (b): `DO $$ DECLARE v_val text; BEGIN SELECT (value#>>'{}') INTO v_val FROM public.app_settings WHERE key = 'storage_public_url_prefix'; IF v_val IS NULL OR NOT (v_val LIKE 'https://%' AND v_val LIKE '%/storage/v1/object/public/share-images/') THEN RAISE EXCEPTION 'invalid or missing storage_public_url_prefix: %', v_val; END IF; END $$;`
  - **推奨: 案 (a)** (DRY: validation ロジックを `validate_app_settings` に一本化、二重メンテ回避)。
  - 行が存在しない場合 (= staging で INSERT を忘れた場合) は UPDATE が 0 件 affected で no-op、migration は成功してしまう。その場合は trigger 関数 `is_safe_share_image_url` の fail-closed (NULL/空 → RAISE EXCEPTION) が `shares` への新規 INSERT すべてを拒否するため、運用上は早期検知される。さらに保険として migration 末尾に `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM public.app_settings WHERE key = 'storage_public_url_prefix') THEN RAISE EXCEPTION 'storage_public_url_prefix row missing in app_settings — INSERT it before applying this migration'; END IF; END $$;` を追加することを推奨する。
- **prefix 未設定時の `is_safe_share_image_url` 挙動 (fail-closed)**:
  - `SELECT (value#>>'{}') INTO v_prefix FROM public.app_settings WHERE key = 'storage_public_url_prefix';` で取得し、`v_prefix IS NULL` または空文字なら `RAISE EXCEPTION 'storage_public_url_prefix not configured in app_settings'` で **すべての shares INSERT/UPDATE を拒否**する。
  - 理由: prefix 未設定で trigger を有効化すると「prefix チェックがスキップされて任意 URL が通る」失敗パターンになりかねない。fail-closed (= INSERT 拒否) のほうが安全。staging/production 適用順序ステップ 1 / 9 を必ず先に実行することで運用上もカバーする (§A-1 「staging / production 適用順序」参照)。
- **Storage path 妥当性検証 (trigger 関数 `is_safe_share_image_url` 内)**:
  - URL が `v_prefix` で始まることを確認 (`starts_with(NEW.image_url, v_prefix)`)。
  - prefix 除去後の残り pathname が `<user_id>/...` 形式であり、`<user_id>` 部が INSERT/UPDATE 対象行の `NEW.user_id` と一致することを確認。
  - クエリ文字列やフラグメント (`?...`、`#...`) を含む場合は拒否 (Storage public URL に query は付かない)。
  - 違反時は `RAISE EXCEPTION 'shares.image_url must point to share-images/<user_id>/ under storage_public_url_prefix'`。

##### display 側 (sanitizer helper) — RD-2 反映: prefix + user_id 一致 (defense-in-depth)

- 新規 `src/lib/share/image-url.ts` に `sanitizeShareImageUrl(imageUrl: string | null | undefined, opts: { allowedPrefix: string, shareUserId: string }): string | null` を実装。
- 許可条件 (すべて満たすこと):
  1. `imageUrl` が `null` (= 画像なし share、OG fallback 経路) → そのまま `null` を返す。
  2. または `imageUrl` が `opts.allowedPrefix` で始まる。
  3. かつ prefix 除去後の残り pathname が `${opts.shareUserId}/...` の形 (1 階層目が `shareUserId` と完全一致)。
  4. かつ クエリ文字列 (`?`) / フラグメント (`#`) を含まない。
- 拒否: 上記いずれか違反は `null` を返す (= fallback to `/api/og/${id}` の next/og 自己生成)。
- `allowedPrefix` は `process.env.NEXT_PUBLIC_SUPABASE_URL + "/storage/v1/object/public/share-images/"` を呼び出し側で組み立てて渡す (helper 自体は URL 環境変数を直接読まない = テスト容易)。
- **Supabase SELECT 列の変更**: 以下 2 ファイルで `user_id` を SELECT 列に追加 (現状 `share_type, share_data, image_url, game_title` のみ → `share_type, share_data, image_url, game_title, user_id`):
  - `src/app/api/og/[id]/route.tsx` (現状 L374-378 の `.select()`)
  - `src/app/share/[id]/page.tsx` (`loadShare` 関数の `.select()`)
- 呼び出し側変更:
  - `src/app/api/og/[id]/route.tsx` L385-388: `const safeImageUrl = sanitizeShareImageUrl(share.image_url, { allowedPrefix, shareUserId: share.user_id })`、`null` なら fall through で next/og 生成へ。
  - `src/app/share/[id]/page.tsx` L81 / L134: `const safeImageUrl = sanitizeShareImageUrl(share.image_url, { allowedPrefix, shareUserId: share.user_id })`、`const ogImageUrl = safeImageUrl ?? \`${appUrl}/api/og/${id}\`` に置換。
- helper に対し vitest テストを追加 (`src/lib/share/image-url.test.ts`)。テストケース:
  - `null` 入力 → `null`
  - 正規 Storage URL (prefix 一致 + user_id 一致) → そのまま返る
  - 別 user_id 配下の Storage URL → `null` (defense-in-depth)
  - 外部 URL (例 `https://malicious.example/track.png`) → `null`
  - prefix は一致するが query 付き → `null`
  - prefix は一致するが fragment 付き → `null`
  - prefix 一致前に protocol-relative (`//`) 等の混入 → `null`
- **役割分離** (RD-2):
  - **DB trigger** (`is_safe_share_image_url`): write-time 防御。新規 INSERT/UPDATE で外部 URL や他 user_id pathname を拒否。
  - **display sanitizer** (`sanitizeShareImageUrl`): read-time 防御。trigger 適用前に既存行へ混入した外部 URL や他 user_id 配下 Storage URL も表示時に止める。

##### 却下した案

- **案 (a) DB CHECK constraint のみ**: 既存 prod 行に外部 URL が混入している可能性 (Cloudflare deploy 前の旧 ShareModal 経路) を staging 同期で取り込んだ際に CHECK constraint 追加が失敗する。
- **案 (c) `image_url` 列をクライアントから受けない**: 既に `derive_image_path_from_url` trigger (`20260515000001`) と `image_path` 列で半分この方向に動いているが、ShareModal フローの change request が大きく Plan A スコープを超える。Plan A 反映後に「Plan B もしくは Phase 2 plan で `image_url` 廃止」を提案する。

#### DB migration の有無

**あり**。1 ファイル: `2026MMDD000001_shares_image_url_storage_only.sql`

- additive expand: trigger 追加のみ。既存 schema は変更しない。
- 既存行 / 既存コードへの破壊的影響なし。
- ただし新規 INSERT に対しては RAISE EXCEPTION で拒否する副作用があるため、ShareModal が正規パス (Storage URL) を送る前提が崩れていないことを **staging で必ず検証**してから production 適用。

#### staging / production 適用順序 (CLAUDE.md「expand → code deploy → contract」準拠)

CLAUDE.md は「コード変更を伴うマイグレーションは原則として `main` への本番反映が完了してから実行する」「既存本番コードが参照せず旧コードに無害な additive expand migration は code deploy 前に production DB へ先行適用してよい」と定める。

本 trigger は **既存コードを壊さないが、新規 INSERT を拒否する副作用** がある。判断:

- staging 適用後に dev preview で ShareModal の正規パスが通ることを確認 → これが「code 側との互換性確認」に相当する。
- production 適用は **本 plan の display sanitizer code deploy と同じタイミングまたは後**。理由: trigger を先行適用しても production code は依然として `image_url` を無検証で返すため、display 側に書かれた既存外部 URL 行は塞がらない。display sanitizer まで揃って初めて P0 が塞がる。

順序 (RD-1 「行 INSERT を trigger 適用前」に従う):

1. (Claude) **staging で `app_settings` 行 INSERT を先に実行** (trigger 適用前の必須前提)。SQL:
   ```sql
   INSERT INTO public.app_settings (key, value, description)
   VALUES (
     'storage_public_url_prefix',
     '"https://uqndrkaxmbfjuiociuns.supabase.co/storage/v1/object/public/share-images/"'::jsonb,
     'is_safe_share_image_url が許容する Supabase Storage public URL prefix。末尾 slash 必須。'
   )
   ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, description = EXCLUDED.description, updated_at = now();
   ```
   実行後 `SELECT value FROM public.app_settings WHERE key = 'storage_public_url_prefix';` で値を確認。
2. (Claude) staging DB に trigger migration 適用 (`npx supabase db push --db-url "$STAGING_DB_URL" --include-all`)
3. (Claude) staging で migration list 確認 (`npx supabase migration list --db-url "$STAGING_DB_URL"`) + trigger 動作 smoke test (service_role で外部 URL INSERT → RAISE EXCEPTION 確認)
4. (Claude) code 変更 (display sanitizer + helper + テスト) を `dev` branch に commit → push → Cloudflare dev preview build
5. (ユーザー) dev preview (`https://dev-duepure-tracker.jianrenzhongtian7.workers.dev`) で動作確認:
   - 正常 share 作成 → Storage URL の image_url で表示される
   - dev preview DB に外部 URL の image_url 行を **手動 INSERT** (service_role) して trigger が RAISE EXCEPTION で拒否することを確認
   - 既存に外部 URL 行が混入している場合 (今は staging に無いはずだが) は display sanitizer が `null` を返し、`/api/og/[id]` 経由で next/og が画像生成
6. (ユーザー) 「本番反映」明示指示
7. (Claude) `git checkout main && git merge dev && git push origin main` → Cloudflare 本番デプロイ
8. (ユーザー) 本番デプロイ確認後、Supabase production への `app_settings` 行 INSERT と trigger 適用の明示指示
9. (Claude) **production で `app_settings` 行 INSERT を先に実行** (staging と同じ SQL、ただし URL prefix は production project ref に変更 = `https://<prod-project-ref>.supabase.co/storage/v1/object/public/share-images/`)
10. (Claude) production DB に trigger migration 適用 (`npx supabase db push --db-url "$PROD_DB_URL" --include-all`)
11. (Claude) production で migration list と動作確認 (service_role で外部 URL INSERT → RAISE EXCEPTION 確認)
12. (Claude) `git checkout dev` で dev に戻す

**順序の必須性**: ステップ 1 (app_settings INSERT) を ステップ 2 (trigger migration 適用) より先に実行する必要がある。理由:

- trigger 関数 `is_safe_share_image_url` は `SELECT (value#>>'{}') FROM public.app_settings WHERE key = 'storage_public_url_prefix'` で prefix を取得する。
- 行が存在しない時の挙動を migration 側で明示する: trigger 関数内で **`v_prefix IS NULL` の場合は `RAISE EXCEPTION 'storage_public_url_prefix not configured'`** (fail-closed)。これは「prefix 未設定で新規 INSERT が無差別に通る」事故を防ぐため。
- staging で行 INSERT を忘れて trigger 適用すると **既存正規 share の INSERT すべてが拒否される** 障害が出るため、順序を逆にしてはいけない。

**注意**: ステップ 7 (code deploy) と ステップ 10 (production trigger 適用) の **順序は code 先 → DB 後** を採る (display sanitizer が code 側に揃ってから DB 側で write-time も塞ぐ二段防御の完成順序)。**ただし** ステップ 9 (production app_settings INSERT) は **ステップ 10 (trigger 適用) より必ず先**。ステップ 7 (code deploy) より前後どちらでも OK。

#### dev preview での検証方法

| 確認項目 | 手順 | 期待結果 |
|---|---|---|
| 正常 share 作成 | 認証済みユーザーで `/dm/stats` 等から share 作成 | OGP 画像が Storage URL で表示される |
| 外部 URL 拒否 (DB) | staging DB に service_role で `INSERT INTO shares (id, share_type, share_data, user_id, game_title, image_url) VALUES (..., 'https://malicious.example/track.png')` | trigger が RAISE EXCEPTION で拒否 |
| display sanitizer | staging に外部 URL の image_url 行を service_role で **直接挿入** (trigger を一時 DISABLE して挿入) し、`/share/<id>` と `/api/og/<id>` をブラウザで表示 | `/share/<id>` の OGP image が `/api/og/<id>` 経由になる、`/api/og/<id>` が next/og 自己生成画像を返す |
| 既存 Storage URL share | 既存の正常 share 行で `/share/<id>` と `/api/og/<id>` を表示 | 従来通り表示される |

#### ローカル検証コマンド

```bash
# 既存 lint / type / test
npm run lint
npx tsc --noEmit
npm test -- --run

# helper のテスト (新規追加分が pass すること)
npm test -- --run src/lib/share/image-url.test.ts

# staging migration list
export STAGING_DB_URL='...'
npm_config_cache=/private/tmp/npm-cache npx supabase migration list --db-url "$STAGING_DB_URL"

# SSR レベル HTML 確認
curl -sL https://dev-duepure-tracker.jianrenzhongtian7.workers.dev/share/<id> | grep og:image
curl -I https://dev-duepure-tracker.jianrenzhongtian7.workers.dev/api/og/<id>

# 既存 grep: legacy URL / hardcoded URL の混入確認
git grep -n 'tierlog\.app\|workers\.dev' src/
```

#### rollback 方針

- **DB**: trigger を `DROP TRIGGER IF EXISTS ... ; DROP FUNCTION IF EXISTS public.is_safe_share_image_url(...);` で削除する rollback migration を `supabase/rollback/<同 timestamp>_rollback.sql` に同梱。Cloudflare ロールバック (Deployments → Rollback) で code を戻した後、必要なら DB rollback を手動で適用。
- **コード**: 通常の `git revert` または Cloudflare Deployments の Rollback ボタンで前 deploy に戻す。display sanitizer が無い状態では DB trigger だけで P0 が塞がるため、コード rollback 後も外部 URL の新規保存は防げる (`image_url` が null になるが OG fallback で表示は崩れない)。

#### 実装時に注意すべきリスク

1. **既存 prod 行の外部 URL 混入**: 公開前なので一般ユーザーはいないが、開発過程の test share 行に外部 URL が紛れている可能性は低い。staging 同期時に確認する。
2. **Supabase Storage URL の prefix 変動**: Supabase Cloud の `${project}.supabase.co/storage/v1/object/public/...` 形式は安定だが、将来 Custom Domain (例 `storage.tierlog.app`) を有効化した場合は prefix が変わる。**§10.A (Resolved) で「現時点では対応不要、将来 custom domain を使う場合に再検討」として確定済**。再検討時は **DB 側 `app_settings.storage_public_url_prefix` と display sanitizer の `allowedPrefix` source (呼び出し側で組み立てる文字列) の両方を同じ値に揃える** 必要がある (DB / display の prefix source が乖離すると read-time と write-time の判定が食い違うため)。env 切り替えだけで完結する保証はないことを Plan A スコープ外の運用要件として明記。
3. **trigger の SECURITY DEFINER**: `SET search_path = ''` 必須 (既存 SECDEF hardening 方針)。`public.is_safe_share_image_url` 内で `text` operator 等は `pg_catalog.` 修飾を付ける。
4. **trigger の `app_settings` 依存**: **RD-1 通り `app_settings.storage_public_url_prefix` を一次正** とする (key-value テーブルの新規行 INSERT 方式)。`current_setting('app.settings.supabase_url', true)` は採用しない (RD-1 で棄却済、§Resolved Decisions RD-1 「棄却した案」参照)。`storage_public_url_prefix` 行が未設定の状態で trigger が動作した場合は、`is_safe_share_image_url` 内で **fail-closed** (`RAISE EXCEPTION 'storage_public_url_prefix not configured in app_settings'`) により **すべての shares INSERT/UPDATE を拒否** する設計 (§A-1 DB 側「prefix 未設定時の `is_safe_share_image_url` 挙動」参照)。
5. **display sanitizer の SSR/CSR 一貫性**: `share/[id]/page.tsx` は Server Component。`process.env.NEXT_PUBLIC_SUPABASE_URL` は build-time inline されるため SSR 側でも正しく見える。
6. **next/og の Node.js runtime**: `/api/og/[id]/route.tsx` は `runtime = "nodejs"` を維持。OpenNext の nodejs_compat 上で動作。

---

### A-2: legacy URL / game slug / 文字化け / `loading.tsx` / `global-error.tsx` (P1)

#### 対象ファイル

- `src/app/error.tsx` (L34: `href="/home"` → 動的 game slug)
- `src/app/not-found.tsx` (L14: `href="/home"` → 動的 game slug)
- `src/app/dm/home/page.tsx` (L200: `/stats?scope=team&member=...` → `/dm/stats?...`)
- `src/app/pokepoke/home/page.tsx` (L200: 同上 → `/pokepoke/stats?...`)
- `src/components/stats/MyDeckStatsSection.tsx` (slug なし stats push)
- `src/components/stats/OpponentDeckStatsSection.tsx` (slug なし stats push)
- `src/app/account/page.tsx` (L97: `更��に失敗` の U+FFFD 修正)
- 新規 `src/app/loading.tsx`
- 新規 `src/app/global-error.tsx`

#### 変更方針

- **error.tsx / not-found.tsx** (RD-3 反映: pathname 優先 + `useSelectedGame()` ready 待ち + 共通 `<HomeLink />` コンポーネント):
  - 新規 `src/components/layout/HomeLink.tsx` (client component) を作成し、`error.tsx` と `not-found.tsx` の両方で再利用する。
  - `<HomeLink />` のロジック (優先度順):
    1. **pathname 優先**: `usePathname()` で取得した現在 path に `dm` / `pokepoke` 等の game slug が **先頭セグメント**として含まれる場合は、その slug で `/${slug}/home` を生成。判定は `src/lib/games/index.ts` の GAMES registry から `Object.values(GAMES).map(g => g.slug)` で取得した allowlist と比較。
    2. **`useSelectedGame()` fallback**: pathname から game が取れない場合 (例 `/account`、`/foo`) のみ `useSelectedGame()` の `{ game, ready }` を使う。
    3. **`!ready` 中**: ボタンを `disabled` + 「読み込み中…」spinner 表示 (A-2 で導入する `loading.tsx` の spinner component を再利用)。一瞬 `/dm/home` を出してから書き換える「フリッカー許容」案は採らない。
    4. **legacy `/home` リンクは生成しない**: middleware redirect 任せ案 (`/home` を維持して LEGACY_ROOTS 308 で吸収) は採らない。統合レポート §4.3 が「legacy URL を生成し続けている状態は綺麗ではない」と指摘済のため、根本対応する。
  - `error.tsx` は client component 必須 (Next.js App Router 規約)。既存 `<Link href="/home">` を `<HomeLink />` に置換。
  - `not-found.tsx` は Server / Client どちらでも可だが、`<HomeLink />` を埋め込む形にするため client component 化する (または `not-found.tsx` を Server のまま `<HomeLink />` だけが client、の構成でもよい — どちらも可)。
  - **判断ポイント**: `not-found.tsx` を server のままにする場合、`next/headers` の `cookies()` で `selectedGame` を読む併用案もあるが、本 plan では「`<HomeLink />` 共通化で完全に client 側に寄せる」方針を採る (理由: pathname ベースのロジックが共通化しやすく、SSR でも client component を埋め込めるため互換性問題なし)。
- **home page member tap**: `dm/home/page.tsx` は `/dm/stats?scope=team&member=...`、`pokepoke/home/page.tsx` は `/pokepoke/stats?...` にハードコード。両ファイルが game-specific なので game 直書きで OK (将来の共通化は Plan E に委ねる)。
- **stats sections**: `MyDeckStatsSection` / `OpponentDeckStatsSection` は既に `game: string` prop を受けている (統合レポート §3.8 で確認済、実装上は型 `string`)。本 plan では `game: GameSlug` への narrowing は行わず、呼び出し元で `/${game}/stats/...` を組み立てる。型を絞りたい場合は別 PR で `GameSlug` に変更する。`router.push(\`/${game}/stats/...\`)` に変更。
- **account/page.tsx:97**: U+FFFD を「新」に置換し、`ユーザー名の更新に失敗しました` に修正。エディタの UTF-8 設定確認。
- **loading.tsx**: 軽量 spinner + Tierlog ロゴ (既存 `src/components/brand/TierlogLogo.tsx` を再利用)。SSR fallback として `<html>` / `<body>` は含めない (root layout が包む)。
- **global-error.tsx**: root layout 自体が throw した場合の最終 fallback。`<html><body>` を独自に持つ必要あり (Next.js App Router の規約)。inline minimum CSS で「一時的なエラー」を表示し、`reset()` ボタンと `/` リンクを置く。Sentry capture は Plan B で追加するため、本 plan では `console.error` のみ。

#### DB migration の有無

なし。

#### dev preview での検証方法

| 確認項目 | 手順 | 期待結果 |
|---|---|---|
| error.tsx ホーム遷移 | dev preview で意図的 throw (例えば `/dm/home` で API モック失敗) → error 画面 → ホームに戻る | `/dm/home` (or `selectedGame` 由来 slug) へ遷移 |
| not-found ホーム遷移 | dev preview で `/foo` 等の存在しないパス → ホームに戻る | 同上 |
| home member tap | dev preview の `/dm/home` でチームメンバー名 tap | アドレスバーが最初から `/dm/stats?scope=team&member=...` |
| stats section | `/dm/stats` のデッキカード tap | `/dm/stats/deck/<name>` (game-scoped) |
| account 文字化け | dev preview で account name 更新を強制失敗 | `ユーザー名の更新に失敗しました` (文字化けなし) |
| loading.tsx | navigation 直後の suspense fallback | spinner + ロゴが見える (白画面なし) |
| global-error.tsx | root layout を強制 throw (ローカル `next dev` で確認) | 一時的エラー画面が出る |

#### ローカル検証コマンド

```bash
npm run lint
npx tsc --noEmit
npm test -- --run

# 文字化け再混入の検出 (U+FFFD = 0xEF 0xBF 0xBD)
LC_ALL=C grep -rn $'\xef\xbf\xbd' src/

# legacy URL 残置の検出
git grep -n '"/home"' src/
git grep -nE 'router\.push\(`?/(home|battle|decks|stats)' src/

# loading.tsx / global-error.tsx の存在
ls src/app/loading.tsx src/app/global-error.tsx
```

#### rollback 方針

- 通常の `git revert` で戻す。DB 変更なし。

#### 実装時に注意すべきリスク

1. **client component と server component の混在**: `error.tsx` は client 必須、`not-found.tsx` は server でも client でも可。`useSelectedGame()` は client 側 hook なので、`not-found.tsx` を server にする場合は `next/headers` の `cookies()` を使う。両方を統一する必要はないが、コード レビューで混乱しないよう各ファイル先頭にコメントを残す。
2. **`global-error.tsx` の規約**: Next.js App Router 15+ は global-error の中に `<html>` `<body>` を独自に書く必要がある。Tailwind は読み込まれないので inline style で最低限の見栄えを作る。
3. **stats sections の game prop 整合**: 既に `game: GameSlug` で受けている前提だが、コール元 (`MyDeckStatsSection` を呼ぶ親) で正しく渡しているか確認。Plan A での grep:
   ```bash
   git grep -n 'MyDeckStatsSection\|OpponentDeckStatsSection' src/
   ```
4. **PWA `start_url`**: `public/manifest.json` の `start_url: "/"` は本 plan のスコープ外 (Plan B の root landing 整備で扱う)。
5. **`selectedGame` cookie 未設定時のデフォルト**: `useSelectedGame()` のデフォルトは `dm`。新規ユーザーや SNS 流入が pokepoke 共有経由の場合は A-4 で `game` query param 経由で cookie に set する想定。

---

### A-3: `BanGuard` 白画面解消 (P1)

#### 対象ファイル

- `src/components/providers/BanGuard.tsx`

#### 変更方針

`getUser()` / `getUserStage()` が reject した場合に `isBanned === null` のままで render が空になる現象を解消する (RD-4 反映: リトライ + 最終 fail-open)。

- `useEffect` 内の Promise chain を **リトライ付き try/catch** に書き換える:
  - `supabase.auth.getUser()` / `getUserStage()` のいずれかが throw/reject した場合、**1〜2 回 backoff 付きでリトライ** する。
  - backoff: 1 回目 retry を 300ms 後、2 回目 retry を 800ms 後 (簡易固定値。`AbortController` で unmount 時 cancel 可能にする)。
  - リトライ用 helper を `useEffect` 内 inline で実装するか、`src/lib/auth/with-retry.ts` のような小さい utility に切り出すかは実装時判断 (本 plan では inline を推奨、再利用要件が出たら切り出し)。
- **成功時** (リトライ含む): 従来通り `setIsBanned(stage === 4)`。
- **最終 fail-open** (リトライ全敗時): `console.error("BanGuard auth/stage failed after retries:", e)` + `setIsBanned(false)` で通常 UI を表示。
  - 理由: ban 判定が取れなかった時に全画面停止させると、Supabase 一時障害で全ユーザーがアプリ使用不能になる。
  - **責務分離**: BanGuard は UX レイヤであり、最終的なセキュリティ境界にしない。ban / suspended / unpaid の本当の強制は **Plan D の DB/RLS/API access gate で担保** する。
- **既存挙動の維持**:
  - `getUser()` が正常に返って `user` が無い / `user.is_anonymous === true` の場合は現行通り `window.location.href = "/auth"` redirect + `supabase.auth.signOut()`。
  - `stage === 4` (BAN) が取得できた場合は現行通り BAN 画面を表示。
  - fail-open は **取得失敗時だけ** に限定。明示的に ban と判定できたユーザーを通すことはない。
- **リトライ中 / 初期 loading 中の UI**: `isBanned === null` 中の `return null` を、軽量 spinner + 「読み込み中」表示に変更。spinner は A-2 で新設する `loading.tsx` の共通 spinner component (`src/components/layout/LoadingSpinner.tsx` 等で切り出し想定) を再利用。
- **ログ**: fail-open 発火時は `console.error` で非機密ログ (user_id を含めず) を残す。Sentry capture は Plan B で追加 (本 plan では console のみ)。
- **既存の supabase.auth.getUser() 呼び出しは維持**。`getSession()` への置換は禁止 (CLAUDE.md / Codex 指摘 §0.1)。
- **layout.tsx は変更しない** (CLAUDE.md「既存 auth/middleware/client.ts は変更しない」の精神に沿う)。BanGuard 自身で spinner を出す。

#### DB migration の有無

なし。

#### dev preview での検証方法

| 確認項目 | 手順 | 期待結果 |
|---|---|---|
| 正常 (非 BAN) | ログイン済みユーザーで `/dm/home` 等を開く | 通常 UI が表示される |
| BAN ユーザー | stage=4 ユーザーで開く | BAN 画面が表示される (既存挙動) |
| Auth 失敗 mock | DevTools の Network タブで Supabase auth エンドポイントを block して `/dm/home` リロード | 白画面ではなく通常 UI が出る (fail-open)。console.error にエラーログ |
| getUserStage 失敗 mock | 同上で `/rest/v1/rpc/...` をブロック | 同上 |

#### ローカル検証コマンド

```bash
npm run lint
npx tsc --noEmit
npm test -- --run
```

#### rollback 方針

- 通常の `git revert`。

#### 実装時に注意すべきリスク

1. **fail-open の判断**: ban されているユーザーが Supabase 一時障害で通常 UI に通過することを許容する設計。これは「BAN 判定が常に取れる前提に立つよりも、UX 維持を優先」する選択。Plan D で正式な access gate を入れる際に再検討する。
2. **既存 EXCLUDED_PATHS の維持**: `["/auth", "/terms", "/privacy", "/contact", "/share"]` は変更しない。
3. **`eslint-disable react-hooks/set-state-in-effect`**: 既存コメントは維持。BanGuard の structure 上 set-state-in-effect は不可避。
4. **anonymous user 処理**: 既存の `if (!user || user.is_anonymous)` 分岐は維持。`window.location.href = "/auth"` 直接遷移も維持 (Plan D で見直し)。

---

### A-4: 共有 / 未ログイン導線で `game` / `next` を引き継ぐ (P1)

#### 対象ファイル

- `src/app/share/[id]/page.tsx` (「アプリで開く」ボタン or リンクの href)
- `src/app/auth/page.tsx` (`searchParams` で `game` / `next` を受ける)
- `src/app/auth/callback/page.tsx` (既存 SIGNED_IN 処理は変更せず、新分岐で `next` パラメータを read してリダイレクト先を決定)
- 新規 helper: `src/lib/auth/redirect.ts` (`next` の許可 origin 判定)

#### 変更方針

- **share ページ**: 「アプリで開く」を `/auth?game=${share.game_title}&next=/${game}/home` 等にする。未ログイン者にもサービス全体像が伝わるよう Plan B でランディング整備するが、本 plan ではまず `game` / `next` の引き継ぎだけ実装。
- **auth ページ**: `src/app/auth/page.tsx` は client component (`"use client"` + `dynamic = "force-dynamic"`) のため、page-level `searchParams` prop は受けられない。`useSearchParams()` (next/navigation) フック経由で `game` / `next` を取得する。`game` は `GameSlug` (dm / pokepoke 等) としてバリデーション、不正値は無視。`next` は **内部 URL のみ許可** (open redirect 防止、詳細仕様は後段「open redirect helper 仕様」参照)。同様に `auth/callback/page.tsx` も client component なので、現行の `new URLSearchParams(window.location.search)` を維持しつつ `next` 取得を追加する。
- **OAuth redirectTo に検証済 game/next を付与する** (Codex 指摘):
  - 現状 `auth/page.tsx:56` の `signInWithOAuth({ options: { redirectTo: \`${window.location.origin}/auth/callback\` } })` は `/auth/callback` 固定で、`/auth?game=...&next=...` で受けた値が OAuth provider を介した callback URL に渡らない。
  - 修正方針: `signInWithOAuth` 呼び出し時に **検証済の `game` / `next` を URLSearchParams で組み立てて redirectTo に付与**する。実装パターン: `const cbUrl = new URL("/auth/callback", window.location.origin); if (validatedGame) cbUrl.searchParams.set("game", validatedGame); if (validatedNext) cbUrl.searchParams.set("next", validatedNext); ... { redirectTo: cbUrl.toString() }`
  - 検証は **二段で実施** する: (a) `auth/page.tsx` 側 = redirectTo 組み立て前、(b) `auth/callback/page.tsx` 側 = 受信時 (callback URL は外部からも叩けるため受信側でも再検証必須)。
  - `next` の長さ上限を 512 文字程度に設定し、provider 側でクエリが破損するリスクを下げる (Supabase Auth 側の制限ではなく一般的な URL 長安全マージン)。
- **auth/callback と SIGNED_IN/fallback の resolved target 共有** (Codex 指摘):
  - 既存 `SIGNED_IN` イベントの処理は変更しない (CLAUDE.md 厳守)。callback 内で `URLSearchParams(window.location.search).get("game")` / `.get("next")` を読み、再検証する (helper 共通利用)。
  - 現状 `auth/callback/page.tsx` の SIGNED_IN ハンドラ (L81-88) と fallback timeout ハンドラ (L97-100) はそれぞれ `/${getRedirectGame()}/battle` をハードコードしているため、`next` 反映漏れの危険がある。修正方針: **callback ファイル先頭で `const validatedSearchGame = isGameSlug(searchParams.get("game")) ? (searchParams.get("game") as GameSlug) : null; const defaultGame = validatedSearchGame ?? getRedirectGame(); const resolvedTarget = resolveAuthRedirectTarget(searchParams, defaultGame);` を 1 度だけ算出し、SIGNED_IN ハンドラと fallback timeout の両方で `window.location.href = resolvedTarget` を呼ぶ**。`defaultGame` 引数の組み立て規則は本セクション末尾の「`getRedirectGame()` の game 解決源について」と一致させる。
  - resolved target の優先順位:
    1. 検証済 `next` が内部 URL として有効 → `next` へ遷移
    2. それ以外 → 既存 default (`/${getRedirectGame()}/battle`) へ遷移
  - default の `/battle` は **現状維持** (auth/page.tsx の 3 箇所 + auth/callback/page.tsx の 2 箇所すべて)。`/home` へ寄せたい場合は別 PR で検討。
- **email/password 経路 (signup/login) でも同じ resolvedTarget を共有する** (Codex 再レビュー指摘 1):
  - `auth/page.tsx` の `/${getRedirectGame()}/battle` ハードコードは **3 箇所**: L45 (`onAuthStateChange` の SIGNED_IN 分岐) / L70 (`signInWithPassword` 成功時) / L95 (`signUp` 成功時、メール確認不要時)。これらは OAuth と email/password の **どちらの経路でも発火** する。
  - `/auth?game=...&next=...` で着地したユーザーが email/password でログイン (または signup から自動 sign-in) した場合、現状では `next` が無視されて `/${game}/battle` に固定遷移してしまう。
  - 修正方針: **`auth/page.tsx` のページ component 内で `const searchParams = useSearchParams(); const validatedSearchGame = isGameSlug(searchParams.get("game")) ? (searchParams.get("game") as GameSlug) : null; const defaultGame = validatedSearchGame ?? getRedirectGame(); const resolvedTarget = resolveAuthRedirectTarget(searchParams, defaultGame);` を 1 度算出し、上記 3 箇所すべてで `window.location.href = resolvedTarget` を使う**。`defaultGame` 引数の組み立て規則は本セクション末尾の「`getRedirectGame()` の game 解決源について」と一致させる。
  - `useSearchParams()` の戻り値は React 依存上 hook ルール内で取得し、最新の `searchParams` 変動に追従させる (URL を `?` で書き換えた場合などのため `useEffect` 内で再算出するパターンも検討、ただし `/auth` 滞在中の query 変動は通常起きないので 1 度算出で OK)。
  - email confirm 経由 (`auth/confirm/page.tsx`) は本 plan のスコープ外。confirm 後の自動遷移先は別 plan で扱う (現状では既存挙動を変更しない)。
- **`getRedirectGame()` の game 解決源について**: 現状 `auth/page.tsx` / `auth/callback/page.tsx` の `getRedirectGame()` は cookie `selectedGame` を読む。`/auth?game=...` で受けた `game` を **`getRedirectGame()` より優先**するため、`resolveAuthRedirectTarget` の `defaultGame` 引数には「`searchParams.game` で検証成功した値 || `getRedirectGame()`」の順で渡す。詳細は §A-4 後段「open redirect helper 仕様」の `resolveAuthRedirectTarget` シグネチャ参照。
- **`game` cookie の set**: auth ページから game を受け取った時点で `selectedGame` cookie を該当 game に書き換え (既存 `useSelectedGame` 経由)。callback 完了時にも再 set。

#### open redirect helper 仕様 (RD-3 / Codex 指摘 4 反映で確定)

新規 `src/lib/auth/redirect.ts` に以下 2 関数 + 1 型を実装:

1. `isSafeInternalPath(next: string | null | undefined): boolean`
2. `resolveAuthRedirectTarget(searchParams: ReadOnlySearchParamsLike, defaultGame: GameSlug): string`
3. `type ReadOnlySearchParamsLike = { get(name: string): string | null }` (最小 interface)

**引数型の設計意図** (Codex 最終指摘 1):

- `auth/page.tsx` (client component) は `useSearchParams()` から `ReadonlyURLSearchParams` (Next.js `next/navigation` の型) を受ける。
- `auth/callback/page.tsx` (client component) は `new URLSearchParams(window.location.search)` から `URLSearchParams` (DOM 標準) を組み立てる。
- 両者を 1 つの helper で受けるため、`URLSearchParams` 固定型ではなく `get(name: string): string | null` を満たす最小 interface (`ReadOnlySearchParamsLike`) で受ける。
- 構造的サブタイピングで `URLSearchParams` / `ReadonlyURLSearchParams` の両方が assignable になる。helper 内では `.get("game")` `.get("next")` のみ呼び出し、mutation メソッド (`.set`/`.delete`/`.append`) は呼ばない設計を厳守する。
- 単体テストでは `new URLSearchParams("game=dm&next=/dm/home")` で生成した値を helper に渡せばよい (`ReadonlyURLSearchParams` を mock する必要なし)。

##### `isSafeInternalPath` の判定ロジック (すべて満たすこと)

1. `next` が non-null かつ length が 1〜512 文字。
2. **malformed percent encoding 拒否** (Codex 再レビュー指摘 4): `decodeURIComponent(next)` を `try/catch` でラップし、**URI malformed** (`URIError`) が throw された場合は **即 `false` を返す**。例: `/%`、`/%E0%A4%A` (途中で切れた 3-byte UTF-8 sequence)、`/%G0` (16 進数でない文字) などは parser を fail させ攻撃 vector になり得るため、入力段で reject する。
3. **decode 後も同じ検証を通すこと**: `decodeURIComponent(next)` で URL-encoded 文字を展開してから 4-9 を再検証する (`%2F%2Fevil` のような encoded protocol-relative を弾く)。
4. **先頭文字検証**: `/` で始まる、かつ `//` で始まらない (protocol-relative `//host/path` を弾く)。
5. **外部 URL 拒否**: `http:`、`https:`、`ftp:`、`javascript:`、`data:`、`mailto:` 等の **スキーム指定** を含まない。`indexOf(':') === -1` または `:` の位置が最初の `/` より後にしか出ない、を判定基準とする (簡易には `^\/[^\/]` で始まることを正規表現で確認)。
6. **backslash 拒否**: `\\` を含まない (Windows path 形式や RFC3986 違反の attack vector を防止)。
7. **制御文字拒否**: 制御文字 (`\x00`〜`\x1F`、`\x7F`) を含まない。decode 前後の両方で確認 (`%00`、`%0D%0A` 等を decode した結果も含む)。
8. **`/auth` 配下を許可しない**: `next` が `/auth` または `/auth/...` で始まる場合は拒否 (`/auth?next=/auth?next=...` の無限ループ防止)。
9. **`/api` 配下を許可しない**: API endpoint への直接遷移は意味がないため `/api` または `/api/...` で始まる場合は拒否。

違反すれば `false` を返す → 呼び出し側は default fallback を使う。

##### `resolveAuthRedirectTarget` の挙動

```
入力: searchParams (ReadOnlySearchParamsLike), defaultGame (GameSlug)
1. next = searchParams.get("next")
2. if isSafeInternalPath(next) → return next
3. else → return `/${defaultGame}/battle` (既存 default 維持)
```

- `auth/callback/page.tsx` 既存 `new URLSearchParams(window.location.search)` と `auth/page.tsx` 新規 `useSearchParams()` (`ReadonlyURLSearchParams` を返す Next.js hook) の **両方をそのまま渡せる**。型 cast 不要、`URLSearchParams` 固定型にしない。

##### redirect helper の単体テスト (`src/lib/auth/redirect.test.ts`)

- 正常 internal path (`/dm/battle`、`/pokepoke/home`) → 返る
- `null` / 空文字 / 513 文字以上 → default fallback
- `//evil.example/path` (protocol-relative) → default fallback
- `%2F%2Fevil.example` (encoded protocol-relative) → default fallback
- `http://evil.example` → default fallback
- `javascript:alert(1)` → default fallback
- `/auth?next=/auth?next=/...` (auth ループ) → default fallback
- `/api/internal/...` → default fallback
- `/dm\\battle` (backslash 混入) → default fallback
- 制御文字 (`\x00`、`\x0d\x0a`) 混入 → default fallback
- **malformed percent encoding** (Codex 再レビュー指摘 4 のテストケース):
  - `/%` (単独 percent、後続なし) → default fallback (`URIError`)
  - `/%E0%A4%A` (3-byte UTF-8 sequence の途中切れ) → default fallback (`URIError`)
  - `/%G0` (16 進数でない文字) → default fallback (`URIError`)
  - `/%2F%` (有効 + 無効の混在) → default fallback (`URIError`)
  - `/dm/%C0%AF` (overlong encoding) → default fallback (`URIError`、または decode 後の追加検証で fallback)

#### DB migration の有無

なし。

#### dev preview での検証方法

| 確認項目 | 手順 | 期待結果 |
|---|---|---|
| share → ログイン (pokepoke) | Cookie/localStorage を空にし、pokepoke 共有 URL から「アプリで開く」 | `/auth?game=pokepoke&next=...` に遷移、ログイン後に pokepoke の意図画面へ |
| share → ログイン (dm) | 同上で dm 共有 URL | dm 系画面へ |
| open redirect 防止 | `/auth?next=https://malicious.example` に直接アクセスしてログイン | callback 後にデフォルト `/${game}/home` へ遷移、malicious URL へは飛ばない |
| `next` protocol-relative | `/auth?next=//malicious.example` | 同上 (拒否) |
| `next` 内部 URL | `/auth?next=/dm/battle` | callback 後に `/dm/battle` へ |
| game cookie 上書き | dm にログイン中、`/auth?game=pokepoke&next=...` でログアウト → 再ログイン | `selectedGame` cookie が `pokepoke` になる |
| **OAuth query 付き callback の許可 — Google** (Codex 最終指摘 2) | Cookie/localStorage を空にし、`/auth?game=pokepoke&next=/pokepoke/battle` から **Google OAuth** ログイン | provider 認証完了後 `/auth/callback?game=pokepoke&next=/pokepoke/battle` に redirect され、resolved target 通り `/pokepoke/battle` へ最終遷移 |
| **OAuth query 付き callback の許可 — X** | 同上で **X (Twitter) OAuth** ログイン | 同上。X provider 経由でも query が保持されること |
| **email/password 経路の resolvedTarget 反映** (Codex 第 2 回指摘 1) | Cookie/localStorage を空にし、`/auth?game=pokepoke&next=/pokepoke/battle` から **email/password** で signup → 自動 sign-in | onAuthStateChange SIGNED_IN / signInWithPassword / signUp の 3 経路すべてで `/pokepoke/battle` へ遷移 (default `/dm/battle` に固定されない) |

##### Supabase Auth Redirect URLs 設定の確認 (Codex 最終指摘 2)

OAuth provider 経由の callback URL に **query parameter を付ける設計** (`/auth/callback?game=...&next=...`) のため、Supabase Auth の「**Redirect URLs**」設定で query 付き URL が許可されているか確認が必要。

- **このチャットでは Supabase ダッシュボード操作・設定変更を一切しない**。確認・変更は **実装チャット側** で実施する。
- **実装チャット側の手順** (実装着手フェーズで遵守すること):
  1. 着手前に Supabase 公式ドキュメント「Redirect URLs」「Wildcard URL pattern」を WebFetch で取得し、query 付き URL がワイルドカード `**` で許可されるか / 完全一致が必要か を確認する (AGENTS.md「外部サービスのダッシュボード UI・操作手順を案内する前に必ず WebFetch で公式ドキュメントの該当ページを取得してから回答すること」厳守)。
  2. Supabase ダッシュボード (staging project ref `uqndrkaxmbfjuiociuns` / production project ref) の Authentication → URL Configuration → Redirect URLs を確認:
     - `https://dev-duepure-tracker.jianrenzhongtian7.workers.dev/auth/callback**` のようなワイルドカード登録があるか
     - 無ければ `https://dev-duepure-tracker.jianrenzhongtian7.workers.dev/auth/callback` だけでなく query を許す形を追加する
  3. production も同様に `https://tierlog.app/auth/callback**` の許可確認。
- **dev preview での実機検証** (上記表の 3 行で実施):
  - dev preview で Google / X OAuth のフローを通し、provider 経由の callback URL が query 付きでも Supabase Auth に reject されないこと。
  - reject される場合 (Supabase 側設定不足) は実装チャットで Redirect URLs 設定を追加してから再検証。

#### ローカル検証コマンド

```bash
npm run lint
npx tsc --noEmit
npm test -- --run

# helper テストの実行
npm test -- --run src/lib/auth/redirect.test.ts

# open redirect 残置の grep (ハードコード URL 経由のリダイレクト)
git grep -nE 'router\.push\(searchParams|window\.location\.href.*searchParams' src/
```

#### rollback 方針

- 通常の `git revert`。

#### 実装時に注意すべきリスク

1. **既存 SIGNED_IN 処理を壊さない**: CLAUDE.md 厳守。callback 内では「`next` パラメータがあれば優先」の分岐を新規追加するのみ。既存 redirect 先 (例えば `/${game}/home`) は default として残す。
2. **localStorage `x_link_pending`**: 既存の X 連携 pending フラグ処理 (auth/callback) は触らない。
3. **`game` slug の正当性**: `src/lib/games/index.ts` の `GAMES` から取得した slug 一覧で whitelist する。CLAUDE.md「format コードがゲーム間で重複しない」は format 側の話で、game slug 自体は dm/pokepoke の 2 件のみだが、将来追加に備え helper 化。
4. **anonymous session の扱い**: `BanGuard` で signOut される anonymous user が `/auth?next=...` に来た時、`next` を覚えたままにすると signOut 後 / signIn 後で混乱する。`next` は callback 1 回で消費し、localStorage 等に永続化しない。
5. **PWA でのリダイレクト**: PWA standalone モードでは window.location.href の遷移挙動が若干異なる場合がある。本 plan では従来通り `router.push` 推奨。

---

## 4. 実装順序 (推奨)

依存関係と DB migration リスクから次の順序を推奨:

1. **A-2** (legacy URL / 文字化け / loading / global-error)
   - DB 変更なし、最小リスク。Plan A 全体の "smoke test" として最初に reviewer feedback を回収。
2. **A-3** (BanGuard)
   - DB 変更なし、UI 改善のみ。A-2 の loading component を共通化できるなら A-2 と同 PR でも OK。
3. **A-4** (share/auth game/next)
   - DB 変更なし。redirect helper のテスト整備が必要。
4. **A-1** (shares.image_url)
   - **DB migration を含むため最後**。staging 適用 → dev preview 検証 → user 承認 → production 適用の最も慎重なフロー。
   - display sanitizer の code deploy を先に main へ反映 → DB migration を production 適用、の順がより安全。

各サブタスクは別 PR にすることを推奨 (review-plan-loop の Codex 観点で「PR が大きすぎる」が出にくい)。または A-2 + A-3 を 1 PR、A-4 を 1 PR、A-1 を 1 PR の計 3 PR。

---

## 5. DB migration の判断ポイント

A-1 の trigger を production にいつ適用するか:

| 案 | 順序 | メリット | デメリット |
|---|---|---|---|
| **(推奨)** Code 先、Migration 後 | display sanitizer code を main → production deploy → trigger を production 適用 | display 側で先に塞ぐので、trigger 適用前でも新規攻撃には耐える | trigger 適用までの間、新規 INSERT は依然として外部 URL を許す (display 側で読み捨てるが DB には残る) |
| Migration 先、Code 後 | trigger を production 適用 → code を main deploy | DB 側で完全に塞ぐ | code 未デプロイ時 (本番 code 旧版) は trigger の RAISE EXCEPTION で新規 share 作成が失敗するリスク。ShareModal は Storage URL しか送らないので実害は出にくいが、`image_url` 列を明示 INSERT する経路は要確認 |
| 同時 | コードを main deploy したら即 production migration 適用 | 一致 | オペレーション窓口が短く運用負荷 |

**判断: 推奨 (Code 先、Migration 後)**。理由:

- ShareModal は元々 Storage URL のみ送る (display sanitizer 入れる前から既に正規パス)。
- display sanitizer 入れた時点で「外部 URL が DB に残っていても表示されない」状態になる。
- その後 trigger を production 適用すれば「新規 INSERT も DB 側で拒否」が追加される。
- 順序を逆にすると、code 未反映状態で staging-like なバグ (`image_url` 列を明示 INSERT する別経路があった場合の混乱) が production に出る可能性。

---

## 6. 統合検証 (Plan A 全体)

サブタスク個別検証の他に、Plan A 全体反映後の統合検証:

| カテゴリ | 検証内容 |
|---|---|
| Security | 外部 URL の image_url INSERT が DB で拒否、display sanitizer が既存外部 URL を fallback |
| UX | error/not-found から legacy URL に飛ばない、文字化けなし、白画面なし、loading 表示あり |
| Game context | dm/pokepoke 共有 URL からログインしても意図画面に着地、cookie 上書き正常 |
| 既存機能の非破壊 | 通常 share 作成、通常ログイン、X/Discord 連携、stats 表示、戦績登録、admin 画面、PWA、Cloudflare Web Analytics (`NEXT_PUBLIC_CF_BEACON_TOKEN`) |
| Performance | OG 画像生成の TTFB が劇的に変わらない (Plan B の Google Fonts 廃止までは TTFB 改善は限定的) |

#### Claude Code が自前で実施できる検証

- `npm run lint` / `npx tsc --noEmit` / `npm test -- --run`
- `curl -sL` で SSR HTML 取得、`<meta og:image>` / `<title>` 確認
- `curl -I` で response header / status code 確認
- staging DB に対して `npx supabase migration list --db-url "$STAGING_DB_URL"` の dry-run
- staging DB に service_role で `INSERT` を投げて trigger 動作確認 (read-only と言いつつ test fixture insert は許容範囲、ただし `dry-run のみ` がより安全)
- `git grep` による legacy URL / `getSession()` 直置換 / `tierlog.app` ハードコード残置検出

#### ユーザーのブラウザ実機確認が必要

- dev preview (`https://dev-duepure-tracker.jianrenzhongtian7.workers.dev`) で実際に share 作成・閲覧
- DevTools Network タブで Supabase auth endpoint を意図的に block して BanGuard fail-open を再現
- PWA インストール後の挙動
- X / Discord で share URL を貼って OGP プレビュー
- Cookie/localStorage を空にして share URL から auth フローを通過

---

## 7. Codex にレビューさせるべき観点

`/review-plan-loop` で plan-critic を回した後、人間 (ユーザー) が Codex に再レビュー依頼する際の観点リスト:

1. **A-1 の trigger 設計**
   - `is_safe_share_image_url` の URL prefix 取得方法 (env vs app_settings vs current_setting) の妥当性
   - SECURITY DEFINER + `SET search_path = ''` の網羅性 (`20260509000004_secdef_hardening_phase_a.sql` 等の既存ルール準拠か)
   - Cloudflare Workers から service_role で staging に test insert する手順がリスクを生まないか
   - 既存 prod fixture (staging に同期した時) に外部 URL の image_url 行が混入していた場合の trigger 後の挙動
2. **A-1 の display sanitizer**
   - `process.env.NEXT_PUBLIC_SUPABASE_URL` を呼び出し側で組み立てる方式の SSR/CSR 一貫性
   - Custom Domain Storage (将来) のサポート方針
3. **A-2 の `not-found.tsx` の server / client 判定**
   - `cookies()` を使う server component 化が他副作用を生まないか
4. **A-3 の fail-open**
   - ban 判定取れない時の fail-open がセキュリティ上許容範囲か (DB レイヤの RLS / is_admin で再検証されることを前提とした設計判断)
5. **A-4 の `next` パラメータ open redirect 防止**
   - `startsWith('/')` && !`startsWith('//')` だけで十分か (URL-encoded `%2F%2F` 等の bypass がないか)
   - localStorage に永続化しない設計の妥当性
6. **DB migration 適用順序**
   - Code 先 → Migration 後の順序が CLAUDE.md「additive expand は code deploy 前に production 先行適用してよい」のガイドと矛盾しないか
   - rollback 時の手順が明確か
7. **Plan A と Plan D の責務分離**
   - BanGuard 修正を Plan A の表層対応に留め、Plan D で再設計する前提が技術的に成立するか
8. **既存 auth / middleware への影響**
   - `middleware.ts` を一切触らない方針で「session refresh 動かない」(統合レポート 4.12) を Plan A で残置する判断が妥当か
9. **想定外の副作用**
   - `loading.tsx` 追加で既存 navigation の挙動 (Suspense boundary) が壊れないか
   - `global-error.tsx` が Cloudflare Workers の OpenNext build で正しく bundle されるか

---

## 8. オプションサブタスク (P2 / 同じ helper に触る場合のみ)

統合レポート §4.11 (P2: share expiry / DB error / public GET) は原則 Plan B か別 plan で扱う。ただし以下の条件に該当する場合のみ Plan A 内のサブタスクとして同梱:

- **A-1 の display sanitizer helper に `expires_at` チェックを同居させる**: 一つの helper で「URL sanitize + expiry check」を行う設計に倒すと、`/share/[id]` `/api/og/[id]` の両方で expiry 失効 share の公開を停止できる。
- ただし `expires_at` の意味論 (Supabase Storage 側の cleanup タイミング、`expires_at < now()` の判定基準) は別議論が必要で、レポート §4.11 でも別タスク化を推奨。

**結論**: 本 plan では同梱しない。helper のシグネチャは将来 expiry を追加しやすい形 (`sanitizeShareImageUrl(...)` 単独 → 将来 `getDisplayableShare(...)` のような統合 helper に拡張する余地を残す) で書く。

---

## 9. ローカル検証コマンド (Plan A 統合)

**事前確認**: `npm test` は環境次第で起動不能になる既知ブロッカーあり。実装着手前に下記「§9.1 npm test 既知ブロッカー」を解消してから検証に進む。

```bash
# 静的検証 (全サブタスク共通)
npm run lint
npx tsc --noEmit
npm test -- --run

# 新規 test ファイル
npm test -- --run src/lib/share/image-url.test.ts
npm test -- --run src/lib/auth/redirect.test.ts

# 文字化け再混入 (A-2)
LC_ALL=C grep -rn $'\xef\xbf\xbd' src/

# legacy URL 残置 (A-2)
git grep -n '"/home"' src/
git grep -nE 'router\.push\(`?/(home|battle|decks|stats)' src/

# ハードコード URL (全サブタスク)
git grep -nE 'tierlog\.app|jianrenzhongtian7\.workers\.dev|uqndrkaxmbfjuiociuns\.supabase\.co' src/

# `getSession()` 一括置換になっていないか (Codex 指摘の防止)
git grep -n 'supabase\.auth\.getSession()' src/lib/actions/

# staging DB migration の dry-run (A-1)
export STAGING_DB_URL='...'  # 環境変数 / 1Password から
npm_config_cache=/private/tmp/npm-cache npx supabase migration list --db-url "$STAGING_DB_URL"

# dev preview の OG image 動作確認 (A-1)
curl -sL https://dev-duepure-tracker.jianrenzhongtian7.workers.dev/share/<id> | grep -E 'og:image|<title'
curl -I https://dev-duepure-tracker.jianrenzhongtian7.workers.dev/api/og/<id>
```

### 9.1 `npm test` 既知ブロッカー (Codex 指摘 5)

**現象**: Codex レビュー時の環境で `@rolldown/binding-darwin-arm64` 欠落により `npm test` が起動不能になる事象を確認。Claude Code 側のローカル環境 (macOS Apple Silicon) では `node_modules/@rolldown/binding-darwin-x64` のみインストールされており、`arm64` binding が欠落している。今この瞬間は `npm test` が `5 passed (5) / 101 passed (101)` で動作しているが、CI / 他の開発環境 / 依存再インストール後に再現する可能性が残っている。

**復旧手順 (実装着手前に実施)**:

```bash
# 1. node_modules を clean install
rm -rf node_modules package-lock.json
npm install

# または rolldown だけ rebuild
npm rebuild

# または arm64 binding を明示インストール
npm i --save-optional @rolldown/binding-darwin-arm64

# 2. test が起動できることを確認
npm test -- --run
```

**Plan A スコープ判断**: 本 plan の検証は `npm test` が動作する環境で実施することを **必須** とする。Plan A 自体では vitest 依存の修正は行わないが、新規追加する `image-url.test.ts` / `redirect.test.ts` を確実に走らせるため、上記復旧手順を最初の subtask (A-2 着手前) に挟む。復旧できない場合は Plan A 着手をブロックし、別 plan (Phase 2 の Plan E: test 復旧含む) で先行解消する。

**CI への波及**: `.github/workflows/ci.yml` の `npm test` job が Linux runner で動く場合、ローカル arm64 binding 欠落とは別の依存解決経路になる。実装着手前に Linux runner / macOS arm64 runner の双方で動作することを確認すること。

---

## 10. 未解決質問

### 10.A Resolved (= 解決済、Resolved Decisions / 本文 / Codex review 反映で確定)

| 元の番号 | 内容 | 解決経路 |
|---|---|---|
| §10-1 (旧) | A-1 `is_safe_share_image_url` 内 URL prefix 取得方法 | **RD-1** で確定: `app_settings` (既存 key-value テーブル) に `key='storage_public_url_prefix'` 行 INSERT 方式。schema 変更なし |
| §10-3 (旧) | A-3 BanGuard fail-open vs fail-closed | **RD-4** で確定: リトライ + 最終 fail-open。Plan D で正式 access gate を入れる前段の暫定設計 |
| §10-4 (旧) | A-4 open redirect 防止の厳密度 | **Codex 指摘 4** で確定: `decodeURIComponent` 後検証 + 外部 URL/protocol-relative/backslash/制御文字拒否 + `/auth`・`/api` 配下拒否 + malformed percent encoding 拒否。§A-4 「open redirect helper 仕様」参照 |
| §10.B-1 (旧) | A-1 Supabase Custom Domain Storage の将来サポート | **Codex 最終指摘 3 で確定**: 現時点では対応不要。将来 Custom Domain (例 `storage.tierlog.app`) を使う場合に再検討。再検討時は **DB 側 `app_settings.storage_public_url_prefix` の値差し替えに加え、display sanitizer の `allowedPrefix` source (呼び出し側で組み立てる文字列) も同じ値に揃える** 必要がある。env 切り替えだけで完結すると **断定しない** (DB / display の prefix source が同期されないと read-time と write-time の判定が食い違う)。Plan A スコープ外、将来の運用変更時に対応 |
| §10.B-2 (旧) | A-1 production migration の適用時期 | **Codex 最終指摘 3 で確定**: 本 plan §A-1 「staging / production 適用順序」通り「**Code 先 → Migration 後**」。CLAUDE.md「expand → code deploy → contract」と整合。実装チャット側でこの順序を遵守する |
| §10.B-3 (旧) | plan-critic と Codex の観点合流方法 | **Codex 最終指摘 3 で確定**: 今回の **`plan-critic → Codex → plan-critic`** フロー (Claude Code 起案 → plan-critic 反復で GO → Codex review → Claude Code 反映 → plan-critic 差分レビュー) を **Plan A 以降の標準フローとして記録**。Plan B/C/D も同じパターンで進める |
| §10.B-4 (旧) | 本 plan ファイルの dev branch commit タイミング | **Codex 最終指摘 3 で確定**: Plan A 単体で commit してよい。**ただしこのチャット (plan 作成専用) では commit/push しない**。実装チャットまたはユーザーの明示指示後に commit する |

### 10.B 未解決

**該当なし**。Plan A の全 open questions は Resolved Decisions / Codex review (第 1〜最終) で解決済。実装チャットは §10.A の解決済方針と本文の確定方針に従って着手できる。

---

## 11. 想定タイムライン (参考)

各サブタスクの所要 (Codex レビュー / plan-critic 反復は含まず):

| サブタスク | 実装 | dev preview 検証 | production 反映 |
|---|---|---|---|
| A-2 | 0.5 日 | 0.5 日 | 0.5 日 |
| A-3 | 0.5 日 | 0.5 日 | 0.5 日 |
| A-4 | 1 日 | 0.5 日 | 0.5 日 |
| A-1 | 1-1.5 日 | 1 日 (staging migration 含む) | 1 日 (migration 適用含む) |
| 合計 | 3-3.5 日 | 2.5 日 | 2.5 日 |

review-plan-loop 反復と Codex レビュー反映を含めると **1-2 週間** が現実的なバッファ。

---

## 12. レビュー / 反映フロー

1. 本 plan ファイル作成 (完了時点)
2. `/review-plan-loop docs/plans/2026-05-27_plan_a_public_launch_safety.md` を実行 → plan-critic の指摘を反映 → GO 判定まで反復
3. ユーザーが Codex に本 plan を渡してレビュー → Codex 指摘を Claude Code 側で反映
4. ユーザー承認後、実装着手 (ただし本 plan の依頼スコープでは実装には入らない)
5. 実装後の検証 (Plan A 全体 §6) → user 承認 → production 反映

---

## 13. 補足

- 本 plan は統合レポート §7 の「Plan A: Public Launch Safety」を詳細化したもの。Plan B / C / D は別 plan として後続作成。
- Plan B / C / D の概要は統合レポート §7 を参照。本 plan §1 でも依存関係を整理済。
- 本 plan に「収益化 (Stripe / 広告)」や「Plan E (onboarding / perf)」は含めない。これらは Phase 2 / 3 で別 plan 化。

---

## Resolved Decisions

review-plan-loop 反復中にユーザー承認された判断事項を永続化する。本文の関連 section は本セクションを最終正とする。

### RD-1 [prefix source] A-1 の `is_safe_share_image_url` 内 Storage URL prefix 解決方法 → **app_settings + 環境別 UPDATE**

採用方針:

- `app_settings` テーブル (`20260515000001` で導入済、`key text PRIMARY KEY, value jsonb` の key-value 形式) に `key = 'storage_public_url_prefix'` の **新規行**を INSERT する。schema 変更 (`ALTER TABLE ... ADD COLUMN`) は不要 — 既存テーブルがそのまま使える。staging / production それぞれで `INSERT INTO public.app_settings (key, value, description) VALUES ('storage_public_url_prefix', '"<env固有URL>/storage/v1/object/public/share-images/"'::jsonb, '...') ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value` を A-1 trigger 適用より前に実行する手順を runbook に記載する。
- staging / production それぞれで初期値を手動 `UPDATE` する手順を runbook (`docs/runbooks/`) に追加し、PR で本 plan と一緒に commit する。
- production DB への `UPDATE` および trigger 適用は **ユーザーの明示承認後にのみ実施**。staging で先に設定し、`/share/[id]` と `/api/og/[id]` の両方で動作確認してから production へ進める。
- 中長期方針として、`image_url` 列そのものを信頼する設計から **`image_path` を source of truth にして server/helper 側で public URL を生成する** 方向に寄せる (Plan A スコープ外、Phase 2 plan で扱う)。
- trigger (write-time) と display sanitizer (read-time) は **両方** が `/api/og/[id]` と `/share/[id]` を守る境界として設計する (RD-2 と整合)。

棄却した案:

- `current_setting('app.settings.supabase_url', true)`: Supabase Cloud で自動 set されるか未確認、賭けにしたくない。
- 環境別 migration の二重管理: CLAUDE.md の expand → contract 手順が複雑化、後続作業 (staging→production) のミス源。

### RD-2 [sanitizer scope] A-1 display sanitizer の検証範囲 → **prefix + user_id 一致 (defense-in-depth)**

採用方針:

- `src/app/share/[id]/page.tsx` と `src/app/api/og/[id]/route.tsx` の Supabase SELECT に **`user_id` 列を追加** する。
- `src/lib/share/image-url.ts` の `sanitizeShareImageUrl(...)` シグネチャを `(imageUrl, opts: { allowedPrefix: string, shareUserId: string })` に変更し、pathname が `share-images/${shareUserId}/...` に収まることを検証する。
- 検証失敗 (URL prefix 不一致 / user_id 不一致 / 不正 URL) 時は `null` を返し、呼び出し側は `null` を fallback OG/image (`/api/og/${id}` の next/og 自己生成) に置き換える。
- 役割分離:
  - **DB trigger** (`is_safe_share_image_url`): write-time 防御。新規 INSERT/UPDATE で外部 URL や他 user_id pathname を拒否。
  - **display sanitizer**: read-time 防御。trigger 適用前に既存行へ混入した外部 URL や他 user_id 配下の Storage URL も表示時に止める。

理由: trigger だけでは過去行や bypass 経路を防げず、display sanitizer だけでは新規 INSERT を制限できない。二段で揃えて公開前の defense-in-depth を確立する。

### RD-3 [selectedGame ready] A-2 error.tsx / not-found.tsx の `useSelectedGame()` `ready` flag 扱い → **ready 待ち + disable (+ pathname 優先)**

採用方針 (優先度順):

1. **pathname 優先**: 現在の `pathname` (`usePathname()`) に `dm` / `pokepoke` などの game slug が含まれる場合は、その slug を優先して `/${game}/home` を生成する。
2. **`useSelectedGame()` fallback**: pathname から game が取れない場合 (例: `/account`、`/foo` 等) のみ `useSelectedGame()` の `ready` を待つ。
3. **`!ready` 中の UI**: 「ホームに戻る」ボタンを `disabled` + 「読み込み中…」表示にする。一瞬 `/dm/home` を表示する案 (フリッカー許容) は採らない。
4. **legacy `/home` は維持しない**: middleware redirect 任せ案は採らない (統合レポート §4.3 が「legacy URL を生成している状態は綺麗ではない」と指摘済、根本対応する)。

実装方針:

- `error.tsx` (client component) と `not-found.tsx` (server/client どちらでも可) で共通利用する `<HomeLink />` の小さな client component を `src/components/layout/HomeLink.tsx` に切り出す。
- `HomeLink` 内で `usePathname()` + `useSelectedGame()` を組み合わせて遷移先 slug を解決。

### RD-4 [BanGuard fail] A-3 BanGuard で auth/stage 取得失敗時の振る舞い → **リトライ + 最終 fail-open**

採用方針:

- **リトライ**: `supabase.auth.getUser()` / `getUserStage()` が throw/reject した場合、1〜2 回だけ短い backoff (例: 300ms → 800ms) 付きでリトライする。
- **リトライ中の UI**: 永続 `null` ではなく、短時間の loading / spinner を表示する (A-2 で導入する `loading.tsx` の component を再利用)。
- **最終 fail-open**: リトライ後も取得できない場合は `setIsBanned(false)` で通常 UI を表示する。
- **既存挙動の維持**:
  - `getUser()` が正常に返って `user` が無い / anonymous の場合は現行通り `/auth` redirect + signOut。
  - `stage === 4` が取得できた場合は現行通り BAN 画面を表示。
- **ログ**: fail-open 時は `console.error` で非機密ログを残す。Sentry capture は Plan B で追加。
- **責務分離**: BanGuard は UX レイヤであり、最終的なセキュリティ境界にしない。ban / suspended / unpaid の本当の強制は Plan D の DB/RLS/API access gate で担保する。

理由: 即 fail-open だと一時 network ノイズで誤 fail-open が増える。短いリトライを挟むことで一時的揺れに耐えつつ、持続障害時には UX 維持を優先する。

---

## 本文への RD 反映 (cross-ref)

本文の関連 section は今後 RD-1 / RD-2 / RD-3 / RD-4 を一次正として参照する:

- §A-1 「変更方針」「DB 側」「display 側」: RD-1 + RD-2 で確定。`app_settings` (既存 key-value テーブル) への `key='storage_public_url_prefix'` 行 INSERT (schema 変更不要) と sanitizer の user_id 一致検証を実装に含める。
- §A-2 「変更方針」「error.tsx / not-found.tsx」: RD-3 で確定。`<HomeLink />` 共通コンポーネント化と pathname 優先を実装に含める。
- §A-3 「変更方針」: RD-4 で確定。リトライロジックと loading UI を実装に含める。
- §5 「DB migration の判断ポイント」: RD-1 により `app_settings` への `key='storage_public_url_prefix'` 行 INSERT (新規 migration ではなく runbook 手順) を A-1 trigger 適用より先に実行する手順を加味する。
- §10 「未解決質問」: §10-1 / §10-3 / §10-4 は RD-1 / RD-4 / Codex 指摘 4 で resolved。残り 4 件 (§10.B-1 Custom Domain Storage / §10.B-2 production migration 適用時期 / §10.B-3 plan-critic と Codex 観点合流 / §10.B-4 plan ファイル commit タイミング) は **Codex 最終指摘 3 ですべて resolved** として §10.A に移動済。現状 **§10.B は「該当なし」**、Plan A の open question ゼロ。

---

## Codex Review Feedback (2026-05-27)

Codex が plan-critic 反復 3 (GO) 後に追加で実施した review で 5 点の修正指示。すべて反映済。

| # | Codex 指摘 | 反映先 | 反映内容 |
|---|---|---|---|
| 1 | A-4 OAuth `signInWithOAuth` の `redirectTo` が `/auth/callback` 固定で、`/auth?game=...&next=...` で受けた値が provider 経由の callback に届かない | §A-4 「変更方針」「OAuth redirectTo に検証済 game/next を付与する」+ 「auth/callback と SIGNED_IN/fallback の resolved target 共有」 | `signInWithOAuth` 呼び出し時に `URLSearchParams` で組み立てた callback URL を redirectTo に渡す。`auth/callback` 側では SIGNED_IN ハンドラと fallback timeout の両方で **同じ `resolvedTarget`** を使うパターンに変更 |
| 2 | A-1 RD-1 の「trigger 適用前に `app_settings` 行 INSERT」と本文の staging/production 適用順序の **migration 先** 記述が矛盾 | §A-1 「staging / production 適用順序」 | staging/production それぞれで **`app_settings` 行 INSERT を trigger 適用より先** に実行する順序に統一。さらに prefix 未設定時の trigger 挙動 (fail-closed) と value 妥当性検証 (`validate_app_settings` trigger 新分岐) を §A-1 DB 側に明記 |
| 3 | RD-1〜RD-4 が本文に反映されていない (display sanitizer 本文が prefix-only のまま、A-2 本文に `<HomeLink />` 記述なし、A-3 本文に retry 記述なし) | §A-1 「display 側」/ §A-2 「error.tsx / not-found.tsx」/ §A-3 「変更方針」 | display sanitizer 本文を prefix + user_id 一致 + SELECT 列追加 + テスト一覧へ更新 / A-2 を `<HomeLink />` 共通コンポーネント + pathname 優先 + ready 待ち UI へ更新 / A-3 を 1〜2 回 backoff リトライ + 最終 fail-open + 既存挙動維持 + Plan D 委譲へ更新 |
| 4 | A-4 open redirect helper の仕様確定 (decode 後検証、外部 URL / protocol-relative / backslash / 制御文字 / `/auth`・`/api` 配下を拒否) | §A-4 「open redirect helper 仕様」 (新規セクション) | `isSafeInternalPath` の 8 条件 + `resolveAuthRedirectTarget` のシグネチャ + 単体テストケース 10 件を確定 |
| 5 | `npm test` が `@rolldown/binding-darwin-arm64` 欠落で起動不能になる既知ブロッカー | §9.1 「`npm test` 既知ブロッカー (Codex 指摘 5)」 (新規セクション) | 復旧手順 (`rm -rf node_modules` → `npm install`、または `npm rebuild`、または binding 明示インストール) + Plan A 着手前に解消する方針 + CI 波及確認を追記 |

**Codex 指摘以外の追加変更**:

- §10 を §10.A (Resolved) / §10.B (未解決) に二分割し、解決済み質問を Resolved 表へ移動。
- 「本文への RD 反映 (cross-ref)」セクションを更新し、解決経路 (RD or Codex 指摘) を明示。

### Codex Review 第 2 回 (2026-05-27、第 1 回反映後の追加レビュー)

Codex が第 1 回 review 反映後に追加で実施した review で 4 点の修正指示。すべて反映済。

| # | Codex 第 2 回指摘 | plan 反映先 | 反映内容 |
|---|---|---|---|
| 1 | A-4 で email/password 経路 (`onAuthStateChange` / `signInWithPassword` / `signUp`) にも resolvedTarget を共有 | §A-4 「email/password 経路 (signup/login) でも同じ resolvedTarget を共有する」(新規 bullet) | `auth/page.tsx` の `/${getRedirectGame()}/battle` ハードコード 3 箇所 (L45 / L70 / L95) すべてで `resolveAuthRedirectTarget` 経由に統一する方針を明記。`useSearchParams()` で取得した `searchParams` を page component 内で 1 度算出し、3 箇所で `window.location.href = resolvedTarget` を使う。`getRedirectGame()` の `defaultGame` 引数には「`searchParams.game` 検証成功値 || `getRedirectGame()`」の順で渡す |
| 2 | `storage_public_url_prefix` の初回 INSERT 時点では `validate_app_settings` の新分岐がまだ無いため validation が効かない | §A-1 「初回 INSERT 時点で validation を効かせる仕組み」(新規 bullet) | trigger migration ファイル内で `validate_app_settings` を `CREATE OR REPLACE` で更新した直後に、案 (a) `UPDATE public.app_settings SET value = value WHERE key = 'storage_public_url_prefix';` で BEFORE UPDATE trigger を発火させ新 validation を強制再評価。案 (b) `DO $$ ... END $$;` block での明示検証も提示。推奨は案 (a) (DRY)。さらに行 missing 検出用に `DO $$ BEGIN IF NOT EXISTS (...) THEN RAISE EXCEPTION ...; END IF; END $$;` を migration 末尾に追加 |
| 3 | A-1 本文の `current_setting` 候補を削除 (app_settings 方式で確定済) | §A-1 「変更方針」「DB 側」(冒頭の bullet) | 「または最低限 `current_setting('app.settings.supabase_url', true)` を見る方式を検討する。**未解決質問 §10 参照**」の文を削除し、「**RD-1 で確定済方式**」に置換 |
| 4 | open redirect helper に malformed percent encoding の拒否を明記 + テストケース追加 | §A-4 「open redirect helper 仕様」「`isSafeInternalPath` の判定ロジック」+ 「redirect helper の単体テスト」 | 条件 2 として「malformed percent encoding 拒否: `decodeURIComponent(next)` を `try/catch` でラップし `URIError` 時は即 `false`」を追加。テストケースに `/%`、`/%E0%A4%A`、`/%G0`、`/%2F%`、`/dm/%C0%AF` (overlong encoding) の 5 件を追加 |

### Codex Review 第 3 回 (最終、2026-05-27)

Codex が第 2 回反映後の plan を最終レビューし、実装着手前に必須の 4 点を指摘。すべて反映済。本反映をもって Plan A は **実装可能水準** に到達 (実装は別チャットで実施)。

| # | Codex 最終指摘 | plan 反映先 | 反映内容 |
|---|---|---|---|
| 1 | `resolveAuthRedirectTarget` の引数型を `ReadonlyURLSearchParams` 互換にする | §A-4 「open redirect helper 仕様」のシグネチャ + 「`resolveAuthRedirectTarget` の挙動」 | `(searchParams: URLSearchParams, defaultGame: GameSlug): string` → `(searchParams: ReadOnlySearchParamsLike, defaultGame: GameSlug): string` に変更。`type ReadOnlySearchParamsLike = { get(name: string): string | null }` (最小 interface) を helper 内で定義。`auth/callback/page.tsx` の既存 `new URLSearchParams(window.location.search)` と `auth/page.tsx` 新規 `useSearchParams()` (`ReadonlyURLSearchParams`) の **両方をそのまま渡せる** ことを明記 |
| 2 | OAuth `redirectTo` の query 付き callback URL を Supabase Auth Redirect URLs が許可するか確認 | §A-4 dev preview 検証表 (Google / X / email/password の 3 行追加) + 「Supabase Auth Redirect URLs 設定の確認」(新規サブセクション) | dev preview 検証に Google OAuth / X OAuth / email/password の 3 経路で query 付き callback が正しく resolved target へ最終遷移することを追加。Supabase ダッシュボード操作は **本 plan 作成チャットでは行わず**、**実装チャット側で公式ドキュメント (`Redirect URLs` / `Wildcard URL pattern`) を WebFetch 確認後** に staging/production の Authentication → URL Configuration を確認・調整する手順を明記 |
| 3 | §10.B の未解決質問 4 件を解決済みに整理 | §10.A (Resolved 表に 4 行追加) + §10.B 「該当なし」 | (1) Custom Domain Storage は現時点対応不要、将来 custom domain を使う場合に再検討 (DB `app_settings` と display sanitizer の prefix source を同じ値に揃える必要があり、env 切り替えだけで完結すると断定しない) / (2) production migration 適用時期は「Code 先 → Migration 後」確定 / (3) plan-critic と Codex の合流方法は `plan-critic → Codex → plan-critic` を標準フロー化 / (4) plan ファイル commit タイミングは Plan A 単体で commit 可、ただし本チャットでは commit/push しない |
| 4 | plan 全体の整合確認 (Resolved Decisions / Codex Review Feedback / §10 矛盾なし、「実装に入らない」明示、実装者が Plan A 単独で作業可能) | ヘッダ「**本 plan ファイルの取り扱い**」(新規) + 本セクションでの整合確認記述 | 「実装には入らない」「本 plan ファイル単独で実装可能」「実装は別チャット」を冒頭で明示。Resolved Decisions / Codex Review 3 周 / §10 の全箇所が一貫していることを反復 6 で plan-critic 確認済 (反復 6 verdict: GO) |

#### 整合確認 (Codex 最終指摘 4)

本 plan 反映後の整合状況:

- **Resolved Decisions (RD-1〜RD-4)** と **Codex Review Feedback (第 1 回 / 第 2 回 / 最終)** と **§10.A (Resolved)** は同じ判断を **異なる切り口** で記述している (前者は判断単位 / 中央は指摘単位 / 後者は元質問単位)。各箇所間で **矛盾なし** (反復 6 plan-critic 確認済)。
- **本文の §A-1 / §A-2 / §A-3 / §A-4** は上記 3 セクションを参照する一次正として書かれている (§13 「本文への RD 反映 (cross-ref)」で対応関係を明示)。
- **「実装に入らない」明示**: ヘッダ「本 plan ファイルの取り扱い」 + §11 「想定タイムライン」 + §12 「レビュー / 反映フロー」の 3 箇所で言及。
- **Plan A 単独で実装可能** な情報の網羅性: 対象ファイル / 変更方針 / DB migration 順序 / 検証方法 / rollback / リスク / Codex 観点 / 未解決質問なし、を §3 サブタスク詳細 + §4 実装順序 + §5 DB migration 判断 + §6 統合検証 + §9 ローカル検証コマンド + §10.A Resolved 表で完備。実装者は本 plan + `AGENTS.md` / `CLAUDE.md` の読了で着手可能。
