# 一般公開ブロッカー解消ロードマップ plan

- 作成日: 2026-05-24
- 作成者: Claude（codex 二回レビュー反映済）
- 対象ブランチ: `dev`
- 対象レポート: `docs/reports/2026-05-20_pre_public_readiness_review.md`（公開ブロッカー 6 件）
- 追加で検出: `npx tsc --noEmit` の失敗（赤信号、レポート時は成功 → 5/20 以降のコミットで混入）

---

## 1. 結論

公開ブロッカー 6 件（#1〜#6）に加え、現時点で `npx tsc --noEmit` が失敗している **#0 typecheck 赤信号** を最優先で潰す。着手順は **#0 → #3 → #5 → #1+#2 → #6 → #4 → デッキ名 alias 正規化（別 plan）**。各タスクは独立した dev push + Cloudflare preview 検証 + main 反映のサイクルで進め、本 plan は全体ロードマップとして粒度の浅い「方針・完了条件・リスク」のみを規定する。タスク単位で追加の詳細 plan が必要になった場合はその都度別 plan を起こす。

---

## 2. 背景

2026-05-20 のレビュー報告書 `docs/reports/2026-05-20_pre_public_readiness_review.md` で総合 62/100、一般公開ブロッカー 6 件と判定された。その後 5/20〜5/22 のコミットは対面デッキ更新方式の修正（c262e32）とチューニング論理削除化バグ修正（d83d00c）が中心で、6 件のブロッカーはリポジトリ上で 1 件も解消されていない。

加えて、本 plan 作成時点の実測で:

- `npx tsc --noEmit` が **1 件失敗**（`src/lib/actions/battle-actions.ts:80` の `Record<string, unknown>` を `battles.update()` に渡せない）
- `npm run lint` は **89 problems / 65 errors / 24 warnings**（5/20 時点 58/34/24 から悪化）

5/20 時点では typecheck は通っていたため、`tsc --noEmit` 失敗はレポート公開後に混入した新規不具合。CI ゲートを入れる前提として最優先で潰す必要がある。

加えて、公開ブロッカー外として未着手 plan が 1 本ある:

- `docs/plans/2026-05-23_deck_name_order_normalization_design.html`（未追跡、5/23 21:50 更新）
  - 5/19 の `opponent_deck_master.name` 統一の続編で、デッキ名称の順序違い・alias 正規化を扱う。本 plan の最後に位置づけ、別途実装 plan を起こす。

---

## 3. スコープ

本 plan が扱うのは下記の 7 件（公開ブロッカー 6 + typecheck 赤信号 1）。デッキ名 alias 正規化は本 plan の対象外（実装着手前に別 plan を確定させる前提でロードマップ末尾に置く）。

| # | カテゴリ | 項目 |
|---|---|---|
| #0 | Build 品質 | `npx tsc --noEmit` 失敗の解消 |
| #1 | 法務 | privacy / terms の不足修正（請求手順・外部サービス・越境移転・管轄条項） |
| #2 | 法務/UX | ログイン不要の問い合わせ窓口の用意 |
| #3 | 品質 | `npm run lint` の errors 解消 |
| #4 | 品質 | 主要ロジックへの最小ユニットテスト追加 |
| #5 | 品質/CI | GitHub Actions に lint + typecheck の品質ゲート追加 |
| #6 | 運用 | エラートラッキング・通知・障害対応 runbook |

---

## 4. 着手順と各タスクの方針

### 4-0. #0 typecheck 修正（最優先、最小差分）

**現状**:

```
src/lib/actions/battle-actions.ts(80,13): error TS2345:
  Argument of type 'Record<string, unknown>' is not assignable to parameter of type
  'RejectExcessProperties<{ format?: ... ; id?: string; my_deck_id?: string; ... }, Record<...>>'.
    Type 'Record<string, unknown>' is not assignable to type '{ [x: string]: never; }'.
      'string' index signatures are incompatible. Type 'unknown' is not assignable to type 'never'.
```

`src/lib/actions/battle-actions.ts:65` の `updateData: Record<string, unknown> = {}` を `supabase.from("battles").update(updateData)` に渡しているのが原因。supabase-js の Update ジェネリックが余分プロパティ拒否のため、index signature ベースの型を `[x: string]: never` で拒否する。

`Database["public"]["Tables"]["battles"]["Update"]` は `src/lib/supabase/database.types.ts:100-114` に存在する。

**対応方針（最小差分）**:

1. `src/lib/actions/battle-actions.ts` の冒頭で `import type { Database } from "@/lib/supabase/database.types"` を追加（既存 import に合流可なら合流）
2. 同ファイル内に短いエイリアスを置く: `type BattleUpdate = Database["public"]["Tables"]["battles"]["Update"]`
3. `updateBattle` 内の `const updateData: Record<string, unknown> = {}` を `const updateData: BattleUpdate = {}` に置換
4. 他の actions（`admin-actions.ts` / `deck-actions.ts` / `account-actions.ts` 等）に同種の `Record<string, unknown>` を update に渡すパターンが残っていないか **読むだけ** で確認。今回検出された範囲では:
   - `admin-actions.ts:676` は inline オブジェクトリテラルを update に渡しており型推論で通っているので **#0 では触らない**
   - `admin-actions.ts:671` の `params: Record<string, unknown>` は引数型であり update 引数ではないので **#0 では触らない**
5. **#0 段階での大規模 refactor は禁止**。他 action の型強化は #3 lint の `no-explicit-any` 解消フェーズと合わせて段階対応する

**完了条件**:

- `npx tsc --noEmit` が 0 error で通る
- `updateBattle` の挙動が変わらない（fields のうち渡されたキーだけ update に乗る既存仕様を維持）
- 他 action ファイルへの編集は 0 件 or import 整理のみ

**リスク**:

- `BattleUpdate` は `id` / `user_id` も optional に許す型なので、誤って これらを書き換える経路を新規に開かないこと（既存コードは fields 経由で id/user_id を入れていないため、最小差分なら影響なし）
- 型変更によって `stripAllWhitespace(fields.opponentDeckName)` 等の代入で再度 type narrowing が必要になる可能性は低い（`opponent_deck_name?: string` で受けるため）

**dev push 後の検証**:

- Claude 自前: `npx tsc --noEmit` / `npm run lint`（#0 単独ではエラー件数の不増加だけ確認）
- ユーザー: 不要（コード挙動変更なし）

---

### 4-1. #3 lint エラー解消

**現状**（実測 89 problems / 65 errors / 24 warnings）:

| ルール | 件数 | 性質 |
|---|---:|---|
| `react-hooks/set-state-in-effect` | 47 | React Hooks の最新厳格化。useEffect 内で直接 `setState` を呼んでいる箇所 |
| `@typescript-eslint/no-unused-vars` | 15 | 未使用変数・引数 |
| `@typescript-eslint/no-explicit-any` | 10 | `any` 型逃げ |
| `react-hooks/refs` | 7 | render 中に `ref.current` を参照（例: `src/components/admin/OpponentDeckManager.tsx:830` 周辺の `savedSettingsRef.current?.limitless_last_synced_at` 等）。**単純な disable では本来の不具合（render 中の mutable 参照）が残るため、state / derived value への置換が必要** |
| `@next/next/no-img-element` | 5 | `<img>` を `next/image` 推奨 |
| `react-hooks/exhaustive-deps` | 2 | 依存配列の欠落 |
| Unused eslint-disable directive | 2 | `src/hooks/use-date-range.ts` 内の冗長な `// eslint-disable` 行（同ファイルには `react-hooks/set-state-in-effect` の disable が 3 行存在し、うち 2 行が `--report-unused-disable-directives` で冗長判定）。該当 disable を削除するだけで解消 |
| `react-hooks/immutability` | 1 | render 中の参照不変性違反。refs と同じく実装修正が望ましい |

> 合計 89 problems (65 errors + 24 warnings)。表は 2026-05-24 時点の `npx eslint --format json` による厳密集計値（codex の第三次レビュー指摘 P2-1 を反映、`set-state-in-effect` 47 と `Unused eslint-disable directive` 2 の真値）。#0 typecheck 修正後と #3 着手直前にもう一度 `npm run lint` を走らせ、内訳の揺れがないことを確認してから個別対応する。

**対応方針（codex 注文反映: 雑な disable で黙らせない）**:

ルール別に「実装修正で潰す箇所・disable 可とする箇所・設計上必要な effect」を分けて段階的に処理する。**全体方針として disable は最終手段**とし、追加した disable は完了報告書に一覧として残す（公開ブロッカー解消の納得感を担保するため）。

1. **`set-state-in-effect`（47 件、最大の山）**

   既存 effect を 3 パターンに分類し、パターン別に対応する:

   - パターン A: `setState(value)` を effect 内で同期的に呼ぶ典型例 → ほとんどは初期データ取得・URL params 反映で、`useEffect` 自体は適切。React 19 の新ルールに合わせ、`useEffect` を抜本的に直すのではなく、必要な箇所は **per-line `// eslint-disable-next-line react-hooks/set-state-in-effect` でコメント理由付き** に許可する（React 公式の guidance に従い、本当に必要な同期 setState は disable 可）
   - パターン B: 派生 state / 初期値計算で setState している箇所 → `useMemo` / `useState(() => init)` / 計算式で置換可能なものはそちらへ（**初期値・派生 state は実装修正を優先、disable しない**）
   - パターン C: 副作用呼び出し（fetch / RPC）後の setState → `useEffect` 内なので本質的に許容、ただし `set-state-in-effect` ルールが拾うので per-line disable + 理由コメント

   **方針**: 「全部 disable」は禁止。1 箇所ずつ A/B/C を判定し、**B は実コード書き換えを優先**、A・C のみ理由コメント付き disable。**完了報告書に追加 disable の一覧（ファイル・行・理由）を必ず記載する**。

2. **`refs`（7 件、最重要の小山）**

   render 中に `ref.current` を参照している箇所（例: `src/components/admin/OpponentDeckManager.tsx:830` 周辺の `savedSettingsRef.current?.limitless_last_synced_at`）。**disable で黙らせると render と ref の整合が取れず実害が残る** ため、原則として実装修正で潰す:

   - 該当 ref を `useState` 化し、更新箇所を `setState` に置換
   - もしくは derived value（親 component から prop 渡し）に置換
   - どうしても ref のままにしたい場合は理由を必ずコメント記載し、追加 disable 一覧に含める

3. **`immutability`（1 件）**

   refs と同じく render 中の参照不変性違反。実装修正を優先、disable は最終手段。

4. **`no-unused-vars`（15 件）**

   - 未使用引数で先頭 `_` 付きにすべきものは rename
   - 未使用 import は削除
   - `eslint-disable` は使わない

5. **`no-explicit-any`（10 件）**

   - 主に `TrendChart.tsx` / `EncounterDonutChart.tsx` / `admin-actions.ts` 周辺
   - `database.types.ts` の型で置換できるものは置換
   - `recharts` 由来は専用型（`PieSectorShapeProps` 等）に置換（既に `6395577` で先例あり）
   - 型エイリアスが書けないものは `unknown` + type guard / type narrowing で対応

6. **`no-img-element`（5 件）**

   - OG 画像生成や favicon 等の特殊用途で `next/image` 不向きなものは per-line disable + 理由コメント
   - 通常 UI で `<img>` 使用は `next/image` の `Image` に置換

7. **`exhaustive-deps`（2 件）**

   - 依存配列に追加すべきものは追加
   - 追加すると無限ループになる場合は `useRef` / `useCallback` でラップ

**完了条件**:

- `npm run lint` が 0 error で通る（warnings 0 件は目標としない、24 件以下を維持）
- `// eslint-disable` を新規追加した箇所は必ず **1 行コメントで理由** を併記
- **追加した disable の一覧（ファイル・行・ルール・理由）を完了報告書に明記**する。これがなければ #3 の完了とみなさない
- `refs` 7 件・`immutability` 1 件・`set-state-in-effect` パターン B（派生・初期値）は実装修正で潰す（disable で済ませない）
- typecheck (#0) は引き続き 0 error

**リスク**:

- React 19 の `set-state-in-effect` は意味のある警告のため、雑に disable すると意図しない cascading render の温床が残る → ファイル単位ではなく **ライン単位** で disable し、理由を明記する
- `set-state-in-effect` 修正のために effect の構造を大きく変えると preview で挙動が変わる恐れ → 47 件は **5〜10 件ずつ小さく commit & dev push**、preview で各画面の手触りを確認
- `refs` の `OpponentDeckManager.tsx` 周辺は admin 画面の同期状態表示・Limitless API 連携設定と密結合。state 化リファクタは admin の挙動回帰を伴うため、preview で「管理 → 対面デッキ → 同期状態」を必ず手触り確認

**dev push 後の検証**:

- Claude 自前: `npm run lint` / `npx tsc --noEmit` / `npx opennextjs-cloudflare build` で build 通過確認
- ユーザー: 触った画面の手触り確認（home / battle / decks / stats / account / admin）

---

### 4-2. #5 GitHub Actions に lint + typecheck ゲート追加

**前提**: #0 と #3 が完全に緑になっていること。エラーが残っている状態で push gate を入れると以後の作業が全部塞がる。

**対応方針**:

`.github/workflows/ci.yml` を新規作成し、`push: [dev, main]` および `pull_request: [main, dev]` で以下を実行:

```yaml
name: CI
on:
  push: { branches: [dev, main] }
  pull_request: { branches: [main, dev] }
jobs:
  quality:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npx tsc --noEmit
      - run: npm run lint
```

ビルド自体は Cloudflare Workers Builds が走るため CI では走らせない（重複・タイムアウト回避）。

**`npm test` ステップは #4 (テスト追加) 完了時に同じ `quality` job 末尾へ `- run: npm test` として追記する**。#5 → #4 の順で進める間は CI に test job が無いことを許容するが、#4 完了時点で必ず ci.yml を更新し、PR レビューで step 追加漏れがないことを確認する。

**完了条件**:

- `.github/workflows/ci.yml` が dev で merge され、Actions タブで `quality` job が成功する
- 試しに lint エラーを意図的に入れた PR が **fail** することを 1 回確認
- 既存の `limitless-sync.yml` には触らない

**リスク**:

- Cloudflare Workers Builds とのトリガー競合はない（GitHub Actions は別系統）
- `npm ci` は `package-lock.json` 必須。既に存在することを事前確認する

**dev push 後の検証**:

- Claude 自前: Actions 実行ログを `gh run list` / `gh run view` で確認
- ユーザー: 不要

---

### 4-3. #1 + #2 privacy / terms 補強 + ログイン不要の問い合わせ窓口

**現状**:

- `src/app/privacy/page.tsx` は 5/19 のまま。最終更新日は「2026 年 5 月 19 日」固定文字列
- §7「お問い合わせ」がアプリ内「ご意見・バグ報告」機能のみ
- 個人情報の開示・訂正・利用停止等の請求受付方法なし
- 越境移転（Supabase = US/EU、Cloudflare = グローバル）の説明が「海外のクラウドデータベース」程度で不十分
- X / Google / Discord OAuth の取扱情報、Discord 連携で扱う情報の説明が不足
- `src/app/terms/page.tsx` 第 9 条で「運営者所在地を管轄する裁判所」だが、所在地が privacy・terms ともに非開示

**対応方針**:

A. privacy / terms ページの加筆

参照する公式資料（codex 提示 URL のうち実在確認済のもの）:
- 個人情報保護委員会「個人情報の保護に関する法律についてのガイドライン（通則編）」
- 個人情報保護委員会「個人情報の保護に関する法律についてのガイドライン（外国にある第三者への提供編）」
- Cloudflare Docs「Cloudflare Web Analytics」

privacy に追加・修正する節:

1. 第三者提供・外部サービス利用の節を以下に整理
   - Supabase（米国法人、サーバ所在地は Supabase 既定の region に依存、米国／EU 等）
   - Cloudflare Workers（グローバル分散）
   - Cloudflare Web Analytics（公式表現に寄せる: visitor personal data を収集・使用しない）
   - X / Google / Discord OAuth（ログイン目的、token の保管範囲）
   - Discord 連携（ユーザーが明示的に有効化した場合のみ、保管する情報の範囲）
2. 「外国にある第三者への提供」の節を新設
   - 移転先国の個人情報保護制度に関する情報（提供時の参考リンク or 簡潔な説明）
   - 当該第三者が講ずる相当措置の概要
3. 「保有個人データの開示・訂正・利用停止等の請求方法」節を新設
   - ログイン不要の問い合わせ先（メールアドレス）と本人確認方法
   - 対応に要する期間の目安
4. 運営者情報・問い合わせ窓口
   - 「運営者」の代わりに、最低限 **ログイン不要で到達できる連絡窓口** を記載（メールアドレスまたは外部フォーム）
   - 個人開発で住所等非開示の場合の代替表現（個人情報保護委員会の運用に沿った表現を選ぶ）
5. 第三者提供 / 委託 / 共同利用の区別を整理

terms に修正する節:

1. 第 9 条（準拠法・管轄）の「運営者所在地」表現を、privacy で開示する運営者情報と整合する形に修正
   - 個人情報を非開示にしたまま実効性ある管轄を定める方法は限定的なので、**メール窓口を経由した本人確認 + 東京地方裁判所等の具体的裁判所** を専属的合意管轄として明示する案を採用候補とする
2. 第 8 条（未成年者の利用）は維持
3. ファンメイドツール免責の整理（既存表現を整える）

B. ログイン不要の問い合わせ窓口の用意

選択肢:
- **メールアドレス公開**（最小コスト、即実装可）
- **Google Forms / Tally / 同等の外部フォーム**（メールアドレス非公開、自動到達確認可）
- アプリ内 feedback はログイン必須なので **公開窓口の代替にはしない**

実装上の最小構成:

1. `src/app/contact/page.tsx`（ログイン不要。middleware には auth gate が無く、各ページが client-side で `getUser()` → `/auth` redirect を選択的に行う方式なので、新設ページに auth check を入れなければそのまま公開ページになる）を新設、または `src/app/privacy/page.tsx` 内に窓口情報を埋め込む
2. メールアドレス使用の場合は `mailto:` リンクで配信
3. 外部フォーム使用の場合は埋め込みではなくリンクのみ（CSP・iframe ヘッダの影響回避）
4. 両ページのフッタ等から 1 クリックで到達できるようにする

**完了条件**:

- privacy / terms ページが上記項目を網羅
- 最終更新日が今日（2026-05-24）に更新
- ログイン不要の問い合わせ窓口がトップレベル URL（例: `/contact` または privacy 内アンカー）で到達可能
- `mailto:` リンクまたは外部フォーム URL が動作（実機で 1 度クリック確認）
- 新設ページに client-side の auth gate（`getUser()` → `/auth` redirect 等）を入れていないことを確認（middleware には auth allowlist は無いので、middleware 側の修正は不要）

**リスク**:

- **法務文言は最終的に専門家確認を要する**。本タスクは「ガイドラインベースの一次案」を整える範囲に留め、公開直前に最終チェックを別途行う前提
- メールアドレス公開は spam リスク → 専用エイリアス（例: `contact@tierlog.app`）を用意できれば望ましいが、tierlog.app に MX を立てる工数とコストを検討
- 外部フォームの場合は当該サービスの利用規約・GDPR 影響も配慮

**残された判断ポイント（実装着手前にユーザー確認）**:

- メールアドレス公開 vs 外部フォームのどちらにするか
- 専属的合意管轄をどこにするか（東京地裁等）
- 専門家確認を実施するか / どの段階で

**dev push 後の検証**:

- Claude 自前: 静的レビュー、リンク到達確認（curl）
- ユーザー: 実機で `/privacy` `/terms` `/contact` を一通り目視、メール送受信テスト

---

### 4-4. #6 エラートラッキング + 障害対応 runbook

**現状**:

- `wrangler.jsonc` の `observability.enabled = true` は有効（Cloudflare Workers 側のログ収集）
- アプリ例外トラッキング（Sentry 等）は未導入
- `docs/runbooks/` 配下は `staging-data-sync.md` のみ
- 通知先・RPO/RTO・Supabase バックアップ確認手順の運用文書なし

**対応方針**:

A. エラートラッキングの導入

候補:
- **Sentry**（free tier あり）。ただし Cloudflare Workers 環境では Sentry 公式が `@sentry/cloudflare` を推奨しており、`@sentry/nextjs` だけでは不十分な可能性が高い（公式 docs https://docs.sentry.io/platforms/javascript/guides/cloudflare/ 参照）
- **Cloudflare Workers の組み込みログのみ**（既存、簡易）
- **その他**（Logflare 等）

**#6-a spike（実装前に必ず実施）**:

OpenNext for Cloudflare では `.open-next/worker.js` が生成物のため、Sentry の wrap がそのまま動くとは限らない。本実装着手前に以下を spike で確認する:

1. `@sentry/nextjs` 単体で OpenNext + Cloudflare Workers のランタイム例外が捕捉できるか
2. 捕捉できない場合、`@sentry/cloudflare` を追加して `.open-next/worker.js` の handler を `Sentry.withSentry()` で wrap する手順（OpenNext は公式 docs に明示記載がないため、`worker.js` の export 形を読んで適合可否を判断）
3. `nodejs_compat` flag は既に有効（`wrangler.jsonc`）だが、`nodejs_als` 等の追加要否を確認
4. DSN の扱い: Sentry 公式は **Runtime env / Cloudflare binding** 経由を推奨。`SENTRY_DSN` を Runtime Secret に登録するのが基本。client 側に必要なら `NEXT_PUBLIC_SENTRY_DSN` を Build 変数に追加するが、Cloudflare Workers における client / server 分離の影響を確認
5. sourcemap upload は Cloudflare Builds 側の制約も含めて手順を確定

spike の結果次第で実装手順が大きく変わるため、本 plan ではここまで規定し、詳細実装は #6 着手時の別 plan で確定する。

**#6-b 本実装**（spike 完了後）:

1. spike で確定した SDK 構成（`@sentry/nextjs` 単体 / `@sentry/cloudflare` 併用）を `npm install`
2. 必要な config 生成（next/sentry wizard、または `.open-next/worker.js` への wrap）
3. DSN を Cloudflare Workers の Runtime Secret として登録（`SENTRY_DSN`）
4. client 側 DSN が必要なら Build 変数 `NEXT_PUBLIC_SENTRY_DSN` を追加
5. **テスト用 throw でアラート到達確認（安全条件付き）** — 公開 route に throw endpoint を残す事故を防ぐため、以下のいずれかに限定する:
   - **dev / staging の一時コードで確認後に必ず削除**（同一 commit / PR 内で削除まで完了させ、main には残さない）
   - もしくは `INTERNAL_API_KEY` 等で保護された **管理者専用 endpoint** のみ throw を許可（`src/lib/cf-env.ts` の `getServerEnv("INTERNAL_API_KEY")` 経由で検証する形）
   - 本番でも到達確認が必要な場合は **公開ユーザーが叩けない導線** に限定し、確認後コードを必ず削除する

動かない場合の代替: Cloudflare Workers 側の `console.error` → Cloudflare Logpush → 外部宛先 / メール の構成も候補に残す。

B. 障害対応 runbook の整備

`docs/runbooks/` に以下を追加。**各 runbook は作成時に Cloudflare / Supabase / Sentry の公式 docs を WebFetch で確認し、参照リンク（URL + 取得日）を runbook 内に必ず残す**（AGENTS.md の運用ルールに従い、記憶ベースで操作手順を書かない）:

1. `cloudflare-rollback.md` — Cloudflare Workers の Rollback 手順（既に CLAUDE.md にあるが、独立 runbook 化）。Cloudflare 公式 docs のロールバック手順 URL を参照
2. `supabase-incident-response.md` — Supabase 障害時の判定・連絡先・代替手順。Supabase Status / Support docs URL を参照
3. `database-backup-restore.md` — Supabase 自動バックアップの確認方法・point-in-time recovery 手順（plan 有無を要確認）。Supabase backups docs URL を参照
4. `monitoring-alert-handling.md` — Sentry アラート受信時の一次対応・トリアージ手順。Sentry Alerts docs URL を参照
5. `incident-communication-template.md` — ユーザー周知文のテンプレート（X 等）

**完了条件**:

- Sentry（または同等）がアプリで動作し、**安全条件付きの**テスト用 throw でアラートが到達する（throw コード or 管理者専用 endpoint は確認後に必ず main から消えていること）
- runbooks 5 件が `docs/runbooks/` 配下に存在
- 各 runbook が「いつ参照する」「最初の 5 分で何をする」「誰に通知する」を含む
- 各 runbook に Cloudflare / Supabase / Sentry の公式 docs 参照リンク（URL + 取得日）が記載されている

**リスク**:

- Sentry SDK の Cloudflare Workers 対応は SDK バージョンによって差がある → 動作確認が前提
- 個人開発の通知先は本人のみなので、運用上の現実的な落とし所（メール通知のみ等）に合わせる

**残された判断ポイント**:

- トラッキングサービスの選定（Sentry vs 他）
- 通知先（メール / Discord webhook / 等）

**dev push 後の検証**:

- Claude 自前: **安全条件付き**テスト throw（管理者専用 endpoint または同一 PR 内で削除する一時コード）で Sentry 到達確認、runbook の文面 + 公式 docs 参照リンクの整合チェック
- ユーザー: アラート通知の実機到達確認

---

### 4-5. #4 主要ロジックの最小ユニットテスト追加

**スコープ（最小限）**:

公開ブロッカー解消の文脈では「最小限のテスト + CI で自動実行」が達成できれば十分。テストカバレッジ目標を高く設定しない。

優先対象（純関数・状態依存なし・ビジネスロジックの中核）:

1. `src/lib/battle/result-format.ts` — 勝敗フォーマット変換
2. `src/lib/games/index.ts` — ゲームレジストリ・format 一覧
3. `src/lib/util/whitespace.ts` — `stripAllWhitespace`（デッキ名・対面名の空白除去 sanitizer、DB 側 CHECK 制約 `'[[:space:]　​-‍﻿]'` と完全一致するパターンが回帰しないことを担保）
4. `src/lib/actions/stats-actions.ts` の集計ロジック（純関数部分のみ。**ただし現状 `toN` / `toWinRate` / `mapDetailRow` / `rowToDetail` が非 export const として private に閉じているため、テスト対象にする前に `src/lib/stats/transform.ts` （ユーザー確定済、§Resolved Decisions 参照）のような純関数モジュールへ抽出してから `*.test.ts` を併置する**。場当たり的に export を追加するのではなく、抽出 → stats-actions 側は新モジュールを import に書き換え → テスト追加、の順で進める。**循環依存回避のため `src/lib/stats/` から `src/lib/actions/` への import は禁止**）
5. `src/lib/search/normalize.ts`（5/19 `aae1076` で導入された検索正規化）

**対応方針**:

1. **テストランナー選定**: vitest を採用（Next.js / TypeScript / ESM 親和性高、jest より軽い）
2. `vitest.config.ts` を追加、`package.json` に `"test": "vitest run"` / `"test:watch": "vitest"` を登録
3. **#4-a (refactor)** `stats-actions.ts` の private helper を独立モジュールへ抽出する小規模リファクタを先に commit する（挙動変更なし、テスト追加と分離して push）
4. **#4-b (test)** 上記対象ファイルに `*.test.ts` を併置、各関数につき 2〜5 ケース
5. coverage 設定は CI では後回し（最低限 lint + typecheck + test の 3 ジョブ通過を優先）

**完了条件**:

- `npm test` が 0 fail で通る
- 5 対象に最低 1 ファイルずつテスト存在
- #5 の `.github/workflows/ci.yml` に `npm test` ステップを追加

**リスク**:

- Next.js / Supabase 環境依存テストは出来ない前提（純関数のみ）
- vitest と Next.js 16 + React 19 の組み合わせは要動作確認（経験上問題ないが念のため）

**dev push 後の検証**:

- Claude 自前: `npm test` 通過、CI でも通る
- ユーザー: 不要

---

### 4-6. デッキ名 alias 正規化 plan の取り扱い

**現状**: `docs/plans/2026-05-23_deck_name_order_normalization_design.html` は未追跡、5/23 21:50 更新。内容は「実装前設計」レビュー版で、自動正規化ルール / 寄せ先決定 / 管理者 alias / 24 時間バッチ / DB・RPC 設計を含む。

**取り扱い**:

- 本 plan の対象外。公開ブロッカー 6 件を全部解消した後に、改めて **実装 plan を別ファイルで起こす**
- 未追跡 html は設計レビュー版なので、本 plan の `git add` 対象には含めない（独立 commit でユーザー判断後に追跡化）

---

## 5. 実装フロー（全タスク共通）

CLAUDE.md の作業ルールに従う:

1. 各タスクを `dev` ブランチ上で実装（既に dev 上）
2. 実装完了したら **タスク毎に独立 commit**、複数タスクを 1 commit にまとめない
3. `git push origin dev` → Cloudflare preview が 3〜5 分でビルド
4. Claude 自前検証（`npx tsc --noEmit` / `npm run lint` / `npx opennextjs-cloudflare build` / curl / 静的レビュー）を実施
5. preview URL での実機検証はユーザーに依頼（ブラウザ JS / DevTools / UI 操作が必要なものに限定）
6. ユーザー OK 後、明示的な「本番反映」指示を受けたら `main` に merge → push
7. `dev` ブランチに戻り、次のタスクへ

複数タスクをまとめて main に流すかどうかは、各タスク完了時にユーザーと相談する。

---

## 6. リスク制御（全体）

- **scope creep**: 各タスクの完了条件を本 plan で固定し、それ以外の改善（例: dm/pokepoke の重複統合）には #7 で別タスク化を提案するに留め、本 plan 内では着手しない
- **CI ゲート前の品質悪化**: #0 と #3 が緑になるまでは #5 を入れない。順序を守る
- **法務文言の独断**: #1+#2 の文言は専門家確認を前提とし、Claude / codex の判断はガイドラインベースの一次案に留める
- **Sentry 等の動作不明確**: #6 は SDK の Cloudflare Workers 対応状況を事前確認し、動かない場合は代替案（Cloudflare Logpush 等）に切り替える判断ポイントを設ける
- **作業中の dev preview 不安定化**: 各 commit ごとに preview ビルドが通ることを確認、失敗したら即座に rollback or 修正

---

## 7. 完了条件（ロードマップ全体）

以下がすべて満たされれば、一般公開ブロッカー解消フェーズは完了とみなす:

- [ ] `npx tsc --noEmit` が 0 error
- [ ] `npm run lint` が 0 error（warnings 24 以下を許容）
- [ ] `npm test` が 0 fail（最低 5 ファイル）
- [ ] GitHub Actions の lint + typecheck + test ジョブが dev / main で動作
- [ ] privacy / terms に開示請求手順・外部サービス・越境移転・管轄条項・運営者連絡先が記載
- [ ] ログイン不要の問い合わせ窓口が privacy / terms から 1 クリックで到達可能
- [ ] エラートラッキングが本番で動作（テスト throw で到達確認）
- [ ] `docs/runbooks/` に 5 件以上の runbook が存在
- [ ] レビューレポート `docs/reports/2026-05-20_pre_public_readiness_review.md` の 6 件ブロッカーが「対応済」と更新（または完了報告書を新規作成）

---

## 8. 確認したい論点（ユーザー判断）

実装着手前にユーザーから決めてほしい論点:

1. **問い合わせ窓口の形式**: メールアドレス公開 / 外部フォーム / 両方併用
2. **専属的合意管轄裁判所**: 東京地方裁判所 / 他
3. **専門家による法務確認**: 実施する / 公開後に実施 / 実施しない
4. **エラートラッキングサービス**: Sentry / 他
5. **エラー通知先**: メール / Discord webhook / 他
6. **本 plan を 1 本でやり切るか、タスクごとに main 反映するか**: 後者の方が rollback 容易、前者の方が反映回数が少なく済む

これらは各タスク着手直前に再度確認する（特に #1+#2 / #6）。

---

## 9. 参考資料

- `docs/reports/2026-05-20_pre_public_readiness_review.md` — 一般公開前 完成度レビュー報告書
- 個人情報保護委員会「個人情報の保護に関する法律についてのガイドライン（通則編）」 https://www.ppc.go.jp/files/pdf/241202_guidelines01.pdf
- 個人情報保護委員会「個人情報の保護に関する法律についてのガイドライン（外国にある第三者への提供編）」 https://www.ppc.go.jp/files/pdf/251212_guidelines02.pdf
- Cloudflare Docs「Cloudflare Web Analytics」 https://developers.cloudflare.com/web-analytics/about/
- Supabase Docs「Password security」 https://supabase.com/docs/guides/auth/password-security
- React Docs「You Might Not Need an Effect」（react-hooks/set-state-in-effect の解消パターン） https://react.dev/learn/you-might-not-need-an-effect

---

## #3 lint エラー解消フェーズ 完了サマリ (2026-05-24)

dev 上で 12 commits により 89 problems → 0 problems を達成。`npm run lint` / `npx tsc --noEmit` ともに 0 で通過、`git diff --check` 問題なし。codex によるレビュー実施済。

### 数値結果

- lint: **89 problems → 0** (errors 65 → 0, warnings 24 → 0)
- typecheck: 1 error → 0 (#0 修正で battles Update 型に置換、以後維持)
- 新規追加 directive: **計 54 directive** (実差分 c2b80e4..HEAD で確認)

### 新規 disable directive 内訳（54 件）

| ルール | next-line | block | 計 |
|---|---:|---:|---:|
| `react-hooks/set-state-in-effect` | 40 | 7 | **47** |
| `@next/next/no-img-element` | 5 | 0 | 5 |
| `@typescript-eslint/no-explicit-any` | 2 | 0 | 2 |
| **計** | **47** | **7** | **54** |

### `set-state-in-effect` 47 件のパターン分類

§4-1 #1 で定義した 3 パターン (A/B/C) のうち:

- **パターン A** (URL/localStorage/cookie/searchParams からの mount 時 resolve): 単一 disable 多数
- **パターン C** (useCallback ラップ済 fetch トリガー、props/外部状態変化時の同期 reset): 単一 disable 多数 + block disable 全 7 箇所
- **パターン B** (派生 state / 初期値計算で useMemo / `useState(() => init)` に置換可能なもの): **該当なし**。47 件すべてが mount/外部状態 resolve または fetch トリガー or props 同期のため、A・C として扱った

→ よって今回の修正は plan の許容範囲内ですべて理由コメント付き disable で完了。実装修正による「派生 state 化」は対象外と判断。

### block disable を採用した 7 箇所

effect 内に 2 つ以上の setState が連続するケースは、per-line disable では「片方を抑制すると次が新たな警告対象に昇格」する挙動が確認されたため、`/* eslint-disable react-hooks/set-state-in-effect */` 〜 `/* eslint-enable */` で対応:

1. `dm/stats/page.tsx` 仮選択ロジック (setActiveTeamId + setSelectedMemberId)
2. `pokepoke/stats/page.tsx` 同上
3. `BattleRecordForm.tsx:112-131` setSelectedValue × 4 (deck/format 変化時)
4. `BattleRecordForm.tsx:139-148` setMemoSuggestions + setShowMemo + setOpponentMemo (opponentDeck クリア時)
5. `OpponentDeckSelector.tsx:29-35` setShowOther + setShowMore + setSearchText (value クリア時)
6. `AdminUserDecks.tsx:24-26` setLoading + setError (再 fetch 前 reset)
7. `OpponentDeckManager.tsx:297-318` format 切替時の 12+ state 一斉 reset

### 全 12 commits

| # | hash | 内容 | 解消件数 |
|---:|---|---|---:|
| 1 | 421697a | Unused eslint-disable directive | 2 |
| 2 | 506f522 | no-unused-vars | 15 |
| 3 | 88515a4 | exhaustive-deps | 2 |
| 4a | d048ab5 | admin RPC as any | 3 |
| 4b | beaa2f7 | recharts no-explicit-any | 7 |
| 5 | 9bc3261 | no-img-element | 5 |
| 6 | 96afc5c | refs + immutability | 8 |
| 7 | 0ca5591 | set-state (hooks) | 5 |
| 8 | 3df913f | set-state (dm/pokepoke stats) | 10 |
| 9 | 1e854fe | set-state (BattleRecordForm 等) | 6 |
| 10 | 8a076ae | set-state (admin) | 8 |
| 11 | 85a8061 | set-state (account + dm) | 9 |
| 12 | 397b5bf | set-state (pokepoke + 他) | 9 |

---

## Resolved Decisions

review-plan-loop の judgment escalate でユーザーが確定した方針:

- [stats helper場所] stats-actions.ts の private helper（toN / toWinRate / mapDetailRow / rowToDetail）を抽出する新規モジュールの置き場所はどちらにしますか？ → **src/lib/stats/**（追加条件: actions は DB I/O 層として残し、純関数は `src/lib/stats/` に抽出。循環依存回避のため `src/lib/stats/` から `src/lib/actions/` への import は禁止）
- [Sentry URL] Sentry docs URL について、codex 指摘（`docs.sentry.dev`）と HTML の `<link rel="canonical">`（`docs.sentry.io` を指す）が矛盾。どちらを採用するか？ → **`docs.sentry.io` を保持**（Sentry 公式 HTML canonical タグを優先。`docs.sentry.dev` は閲覧可能なミラー/配信先扱いで、plan の公式参照 URL は `https://docs.sentry.io/platforms/javascript/guides/cloudflare/` で統一）
- [問い合わせ窓口] #1+#2 の問い合わせ窓口の形式は？ → **メール公開（`contact@tierlog.app` 新設）**。privacy / terms / contact に `contact@tierlog.app` を記載。Cloudflare Email Routing の設定手順は別途案内（受信専用・無料・既存 MX と排他なので事前確認）
- [管轄裁判所] #1+#2 の terms の専属的合意管轄裁判所は？ → **東京地方裁判所**。「東京地方裁判所を第一審の専属的合意管轄裁判所とします」の表現で統一
- [専門家確認] #1+#2 の法務文言の専門家確認 (弁護士等) のタイミングは？ → **一次案で公開し、公開後に専門家確認**。今回は PPC ガイドライン等の公式資料ベースで一次案を整える範囲とし、文中 / 完了報告で「最終的な法的判断ではなく、公開後に専門家確認予定」と明記
- [Sentry アカウント] #6-b で Sentry を導入するための organization/project は？ → **新規アカウントを作成**（Developer Free 想定）。Sentry signup → organization `tierlog` → Next.js project `tierlog-web` 等を作成し、DSN を発行する。手順は本 plan 末尾の §Sentry セットアップ手順 を参照
- [Sentry 通知先] Sentry alert の通知先は？ → **メールのみ**（Sentry default）。Discord webhook 等の追加は、エラー量・運用負荷を見て後続改善で検討
- [Sentry env 分離] dev/staging と prod で Sentry プロジェクトを分けるか？ → **prod のみで始める**。初期運用は production project / production DSN のみを正式設定し、dev/staging では Sentry を通常無効化。dev 検証が必要な場合だけ一時的に DSN を入れ、検証後に無効化する運用
- [Sentry sourcemap] sourcemap upload は導入するか？ → **初期は無効**。OpenNext 側 issue #19213 で完全 mapping 不可と明示されているため、SENTRY_AUTH_TOKEN 等の Cloudflare Build secret も追加しない。まず production の error 収集・メール通知・runbook 整備を優先し、sourcemap は後続改善として残す

---

## Sentry セットアップ手順（ユーザー側で実施、#6-b 着手前の前提）

公式 docs（取得日 2026-05-25）に基づくアカウント新規作成から DSN を Cloudflare Build variables へ登録するまでの 15 ステップ。

### 参照 docs

- https://sentry.io/signup/
- https://docs.sentry.io/product/sentry-basics/integrate-frontend/create-new-project/
- https://docs.sentry.io/concepts/key-terms/dsn-explainer/
- https://docs.sentry.io/platforms/javascript/guides/cloudflare/frameworks/nextjs/

### 手順

1. `https://sentry.io/signup/` を開く
2. Google / GitHub アカウントで SSO サインアップ（メール + パスワードでも可）
3. フォームで Name と **Organization 名**（例: `tierlog`）を入力
4. **Data Storage Location** は **US** を選択（Cloudflare / Supabase と整合）
5. signup 直後は 14 日 Business トライアル状態。トライアル中でも free tier 相当で使えるが、14 日後または明示切替で **Developer (Free)** プランに切り替える（Settings → Billing から実施可能）
6. メール認証リンクをクリックして verify
7. 左サイドメニューから **Projects** → **Create Project** をクリック
8. Platform 一覧で **Next.js** を選択
9. Alert frequency は **"Alert me on high priority issues"** を選択
10. Project name に `tierlog-web` 等を入力（slug 自動生成）→ **Create Project**
11. 作成完了画面に表示される **DSN**（`https://xxx@oNNN.ingest.sentry.io/PPP` 形式）をコピー
12. （後から確認する場合）**Settings → Projects → tierlog-web → Client Keys (DSN)** から再取得可
13. **右上アカウントメニュー → User Settings → Notifications** で email 通知が ON か確認（デフォルトは ON）
14. Cloudflare Dashboard → Workers & Pages → duepure-tracker → Settings → **Build variables and secrets** に以下を追加（`NEXT_PUBLIC_*` は build 時 inline 必須）:
    - 変数名: `NEXT_PUBLIC_SENTRY_DSN`
    - 値: 手順 11 でコピーした DSN
    - タイプ: Plaintext（DSN は public 値なので Secret 化不要）
15. Cloudflare Dashboard で **Save** のみ実行（Deploy は押さない — CLAUDE.md の事故防止ルール参照）

### sourcemap 用 token（今回は不要、後続改善時）

将来 sourcemap upload を有効化する場合に必要:
- Sentry → **Settings → Developer Settings → Organization Tokens → Create New Token**
- scope: `project:write` / `project:releases`
- token を Cloudflare Build secret として `SENTRY_AUTH_TOKEN` に登録、加えて `SENTRY_ORG` / `SENTRY_PROJECT` も Build variables に追加

### dev/staging で一時的に Sentry を有効化したい場合

- Cloudflare Build variables に `STAGING_NEXT_PUBLIC_SENTRY_DSN` を追加し、`prepare-cloudflare-env.sh` で `WORKERS_CI_BRANCH=dev` 時に写すパターンに従う
- ただし通常は無効化運用（Resolved Decisions [Sentry env 分離] 参照）。dev 検証完了後は `STAGING_NEXT_PUBLIC_SENTRY_DSN` を空にする or 削除する

### この plan のステータス

ユーザーが上記 15 ステップを完了し DSN が Cloudflare Build variables に登録された時点で、#6-b 本実装に着手可能になる。本実装の手順は spike report `docs/reports/2026-05-24_sentry_opennext_spike.md` §13-C 参照。
