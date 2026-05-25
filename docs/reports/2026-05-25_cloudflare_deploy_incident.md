# インシデント報告書: Cloudflare Workers Deploy 誤操作による dev コード本番展開（2026-05-25）

- 報告日: 2026-05-25
- 発生日: 2026-05-25（JST）
- 発生フェーズ: `#6-b Phase 4`（Sentry 動作検証中）
- 影響範囲: 本番 `tierlog.app` の配信 JS に一時的に staging Supabase project ref / dev preview URL が混入
- 復旧: ユーザーが Cloudflare の deployment rollback で復旧確認済
- ステータス: **復旧完了 / 再発防止策を実装中**

---

## 1. サマリ

`#6-b Phase 4` の Sentry 動作検証中、ユーザーが Cloudflare Dashboard の Variables and Secrets で `SENTRY_DSN` Runtime variable を追加した際、誤って **Deploy** ボタンを押下した。Cloudflare Workers Builds の Deploy ボタンは「現在の最新ビルド」を本番に展開する設計のため、その時点で最新だった **dev branch のビルド**（Phase 3 系 commit 由来）が本番 `tierlog.app` に展開された。

dev branch のビルドは `scripts/prepare-cloudflare-env.sh` で `STAGING_NEXT_PUBLIC_*` を `NEXT_PUBLIC_*` に写すため staging Supabase を参照する。結果として、tierlog.app の配信 JS に staging Supabase project ref `uqndrkaxmbfjuiociuns` と dev preview URL `dev-duepure-tracker.jianrenzhongtian7.workers.dev` が混入し、tierlog.app/auth からログインすると dev preview 側に遷移する状況になった。

ユーザーが Cloudflare の deployment rollback 機能を使い、production active を `b475291f`（Merge branch 'dev' / main、git main の過去 deployment）に戻して復旧。Codex 側で配信 JS から該当文字列の消失を確認済。

git main branch tip 自体は `886ef4e`（Merge branch 'dev' = #1+#2 反映）のままで変化なし。Cloudflare の active deployment が git main の過去地点を指している状態（git main tip と Cloudflare active deployment が一時的に乖離）。次の main merge/push で同期する。

---

## 2. CLAUDE.md 既存ルールとの整合

CLAUDE.md にこの事故が予測・警告されていた:

> ⚠️ Cloudflare ダッシュボードの「Deploy」ボタンについて
> Variables and Secrets画面で環境変数を保存する際、**「Save」と「Deploy」の2つのボタン**がある：
> - **Save**: 変数を保存するだけ。次のビルド時から反映。**通常はこれを使う**。
> - **Deploy**: 変数保存に加え、**現在の最新ビルドを即座に本番デプロイする**。これを押すと、プレビュー環境のビルド（dev ブランチ由来）を本番として展開してしまい、**git main と本番が不一致になる事故**が起きる。
>
> **環境変数を追加・変更する時は「Save」のみを使う**ようユーザーに案内すること。

→ まさにこの事故が発生。CLAUDE.md の既存ルールは正しく、再徹底が必要。

---

## 3. 経緯（時系列）

1. **#6-b Phase 4 着手**: Sentry Custom Worker (`a6e7952`) → throw endpoint (`3c6271e`) → captureException + flush (`78ba41e`) → 診断 JSON (`8c190f8`) → empty commit (`fe0ab55`) の流れで dev push
2. **SENTRY_DSN 追加 + Deploy 誤押下**: ユーザーが Cloudflare Dashboard で Runtime variable `SENTRY_DSN` を追加する際、Save ではなく Deploy をクリック
3. **dev コードの本番展開**: その時点の「最新ビルド」（dev branch の Phase 3 系 commit 由来）が本番に展開
4. **影響発生**: tierlog.app/auth の配信 JS に staging Supabase project ref / dev preview URL が混入
5. **検出**: Codex 側で tierlog.app/auth の JS bundle を curl 解析し、`uqndrkaxmbfjuiociuns` の存在を確認
6. **復旧操作**: ユーザーが Cloudflare deployment rollback で `b475291f` に戻す
7. **復旧確認**: Codex 側で以下を確認
   - https://tierlog.app/ → 200
   - https://tierlog.app/auth → 200
   - tierlog.app/auth の配信 JS から `dev-duepure-tracker` 文字列 消失
   - tierlog.app/auth の配信 JS から `uqndrkaxmbfjuiociuns`（staging Supabase ref） 消失

---

## 4. Claude 側の検証ミス（反省）

Phase 3 push 直後に Claude が「本番は main コード由来」と判定した際、根拠としたのは CSP `connect-src` に `*.ingest.sentry.io` が含まれないことだった。しかしこの判定は誤りだった可能性が高い:

- **Phase 3 (`a6e7952`) の `next.config.ts` は CSP に `*.ingest.sentry.io` を追加していなかった**（Phase 2 で追加された変更が Phase 2 revert で消えた後、Phase 3 では復活させていなかった）
- → CSP では main / dev コードを切り分けられない状態だった
- 本来確認すべきだったのは:
  - 配信 JS / HTML 内の Supabase project ref（production と staging で異なる）
  - 配信 JS / HTML 内の `dev-duepure-tracker.*.workers.dev` URL の有無
- これらの確認をしていれば事故を早期発見できた可能性

検証手順の不備として認識し、Phase 5 runbook に組み込む。

---

## 5. 影響評価

### 5.1 ユーザーへの影響

- 本番 `tierlog.app` は HTTP 200 で応答していたため、サイトダウンには見えていない
- ただし、ログイン経路から dev preview 側に遷移するため、**ログイン中のユーザーは staging Supabase の DB を参照** していた可能性
- staging Supabase は production DB と別の DB で、production ユーザーの戦績データは存在しない（または古い snapshot）
- → ログインしようとした実ユーザーから「データが表示されない」「ログインできない」等の影響を受けた可能性あり
- 影響時間: SENTRY_DSN 追加 + Deploy 押下時刻から rollback 完了まで（ユーザー対応で短時間）

### 5.2 データ整合性

- production Supabase DB への書き込みは発生せず（dev preview コードは staging Supabase を参照するため）
- staging Supabase DB への書き込みは発生した可能性（実ユーザーが操作した場合）
- → production DB 側のデータ整合性は保たれている。staging DB 側に予期せぬデータが書かれている可能性は低い（限られた時間 + 限られたユーザー）

### 5.3 セキュリティ

- staging Supabase のキー（`STAGING_NEXT_PUBLIC_SUPABASE_ANON_KEY`）が一時的に本番 JS bundle に inline で配信された
- ただしこれは Build variable で、staging 環境用の anon key であり、production には影響しない
- staging anon key の漏洩リスク = staging DB へ匿名アクセス可能になる程度（既知の anon key として運用されている）
- → セキュリティ事故ではないが、staging が本番から到達可能になっていたという構造的問題は残る

---

## 6. 復旧確認の詳細

ユーザーが Codex 側で実行:

```bash
curl -sI https://tierlog.app/
# → HTTP 200

curl -sI https://tierlog.app/auth
# → HTTP 200

curl -s https://tierlog.app/auth | grep -c 'dev-duepure-tracker'
# → 0

curl -s https://tierlog.app/auth | grep -c 'uqndrkaxmbfjuiociuns'
# → 0
```

→ 本番は main コード由来の正常状態に復旧。

---

## 7. 再発防止策

### 7.1 Cloudflare Dashboard 操作ルール（CLAUDE.md 既存、再徹底）

- **Variables and Secrets の変更は Save のみ**
- **Deploy ボタンは絶対に押さない**
- 変数を追加・変更後、即座に反映したい場合 → **`git commit --allow-empty -m "..." && git push origin <branch>`** で再ビルド trigger（Cloudflare Workers Builds が自動でビルド + deploy）
- Cloudflare Dashboard 上の Deploy / Retry build ボタンは「最新ビルド = dev branch のビルド」を本番に展開するリスクがあるため、ユーザー操作では原則使わない

### 7.2 本番展開状態の検証コマンド（Phase 5 runbook 化候補）

CSP / HTTP 200 だけでは不十分。以下を本番反映直後の必須チェックとする:

```bash
# 1. HTTP ステータス
curl -sI https://tierlog.app/auth | head -3

# 2. dev preview URL の混入チェック（本番なら 0 件であるべき）
curl -s https://tierlog.app/auth | grep -c 'dev-duepure-tracker'

# 3. staging Supabase ref の混入チェック（本番なら 0 件であるべき）
curl -s https://tierlog.app/auth | grep -c 'uqndrkaxmbfjuiociuns'

# 4. （Sentry 導入後）Sentry CSP の有無
curl -sI https://tierlog.app | grep -i content-security-policy | grep -o 'ingest.sentry'
```

Phase 5 で作成する `cloudflare-rollback.md` runbook にこれを含める。

### 7.3 Sentry 動作検証方針の変更（案 D 採用）

`plan §Resolved Decisions [Sentry env 分離]` に従い、dev preview に SENTRY_DSN を渡す Cloudflare Dashboard 操作は **今後行わない**。

代わりに **ローカル wrangler preview** で Sentry SDK の疎通を確認する案 D に切り替え:

- `npm run preview` で `opennextjs-cloudflare build && opennextjs-cloudflare preview` を実行
- `.dev.vars`（gitignore 対象）に `SENTRY_DSN` と `INTERNAL_API_KEY` を記載
- localhost で `/api/internal/sentry-test` を叩いて Sentry Issues に届くか確認
- 確認 OK 後、検証 endpoint を削除する commit を push（dev branch 内で完結）
- production への SENTRY_DSN 反映は **Save のみ** + 通常の main merge/push で行う

これにより Cloudflare Dashboard の Deploy 誤操作リスクを構造的に排除。

---

## 8. 関連 commit

dev branch の流れ:

| commit | 内容 | main 反映 |
|---|---|---|
| `686e5de` | Phase 1: compatibility_date 2025-08-16 更新 | 未反映 |
| `3375103` | Phase 2: @sentry/nextjs SDK install（後に revert） | revert で main に流さず |
| `0aca978` | Phase 2.5: eslint cleanup | 未反映 |
| `2f7eb42` | Revert Phase 2 | 未反映 |
| `a6e7952` | Phase 3: Sentry Custom Worker パターン導入 | 未反映 |
| `3c6271e` | Phase 4: 検証 endpoint 追加（throw） | **dev 内完結予定（main に流さない）** |
| `78ba41e` | Phase 4: captureException + flush 切替 | 同上 |
| `8c190f8` | Phase 4: 診断 JSON モード | 同上 |
| `fe0ab55` | empty commit（再ビルド trigger 試行） | 同上 |

main branch の状態:
- git tip: `886ef4e`（前回 main 反映の merge commit、#1+#2 反映済）
- Cloudflare active deployment: `b475291f`（rollback 先、過去の `Merge branch 'dev' / main`）
- 一時的乖離。次の main merge/push で同期予定

---

## 9. 今後の進め方（ユーザー指示の Step 1〜6）

1. ✅ **本 incident report の作成**（Step 1）
2. ⏳ **Cloudflare dev preview での Sentry DSN 検証を中断**（Step 2）— 本 incident 以降、Cloudflare Dashboard で Runtime variable の追加・編集を行う検証フローは止める
3. ⏳ **ローカル OpenNext / Wrangler preview で検証**（Step 3）— `.dev.vars` で SENTRY_DSN / INTERNAL_API_KEY を渡し、localhost で `/api/internal/sentry-test` を叩く
4. ⏳ **ローカル検証 OK 後、検証 endpoint 削除 commit を push**（Step 4）— main に流さない
5. ⏳ **production への DSN 反映は Save のみ + 通常の main merge/push**（Step 5）— Cloudflare Deploy ボタンは使わない
6. ⏳ **Phase 5 runbook に本 incident を反映**（Step 6）— Deploy 誤操作リスク、rollback 手順、本番健全性確認手順を runbook 化

---

## 10. 参考

- plan: `docs/plans/2026-05-24_pre_public_blocker_resolution_plan.md` §4-4 #6-b / §Resolved Decisions [Sentry env 分離]
- spike report: `docs/reports/2026-05-24_sentry_opennext_spike.md` §5.2 / §13-B
- CLAUDE.md: 「Cloudflare ダッシュボードの『Deploy』ボタンについて」（既存警告）
