# runbook: Supabase 障害時の初動対応

最終更新: 2026-05-25

## いつ参照する

- `tierlog.app` でユーザー認証が断続的に失敗する時
- 戦績画面で「データ取得失敗」が多発するとユーザー報告がある時
- Sentry にデータベース関連の例外が多発している時（`PGRST*` / `Supabase` keyword 含む）
- 自分自身が tierlog.app を開いた時に Supabase 接続エラーが見えた時

## 最初の 5 分でやること

### 1. Supabase 公式 Status の確認

```bash
open https://status.supabase.com/
```

または `curl -sI https://status.supabase.com/api/v2/status.json` で API 経由で取得。

- **All Systems Operational** 表示: Supabase 全体は正常 → tierlog 個別 project の問題かコード側問題
- **Partial Outage / Major Outage**: Supabase 側の広域障害 → ユーザー通知 + 復旧待ち

### 2. tierlog の Supabase project 個別確認

1. Supabase Dashboard (https://supabase.com/dashboard) にログイン
2. **Production project** (project ref: tierlog 本番、CLAUDE.md にあるはず) を選択
3. Dashboard 左下のステータスインジケータ / 上部の Health バナーを確認
4. **Database** タブ → Query Editor で `SELECT 1` を実行して接続確認

### 3. tierlog 側の影響範囲確認

```bash
# 認証エンドポイントが応答するか (Supabase Auth)
curl -sI https://tierlog.app/auth | head -3

# 統計ページが応答するか (Supabase DB)
curl -sI https://tierlog.app/dm/stats | head -3
```

両方 HTTP 200 でも、Supabase RLS や RPC が落ちると client 側でエラーになるため、最終的には Sentry や手元ブラウザでの動作確認も必要。

### 4. 代替手段の判断

- Supabase 側障害が継続中: ユーザー通知（`incident-communication-template.md` 参照）+ 復旧待ち
- tierlog コード側の問題が疑われる: 直近 commit の確認 + 必要なら `cloudflare-rollback.md` の手順

## 誰に通知する

- 運営者（個人開発のため自分自身）
- Supabase 側障害が継続中、または tierlog 単体で復旧不能と判明した場合: X 等でユーザーへ広報

## 公式 Status / Support ページ

- Supabase Status: https://status.supabase.com/ （取得日 2026-05-25）
- Supabase Support: https://supabase.com/support （取得日 2026-05-25、Free plan は community サポートのみ）
- Supabase Dashboard: https://supabase.com/dashboard （取得日 2026-05-25）

## 補足: tierlog の Supabase 構成

- 本番環境: production project（CLAUDE.md 記載）。Cloudflare の Build variables に `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` 等として登録済
- 検証環境: staging project (ref: `uqndrkaxmbfjuiociuns`)。dev branch ビルド時に `STAGING_NEXT_PUBLIC_*` 経由で写される
- production / staging 共通 DB ではない（CLAUDE.md / staging-data-sync.md 参照）

## 関連 runbook

- `database-backup-restore.md` — データ消失時の復旧
- `incident-communication-template.md` — ユーザー周知文
- `cloudflare-rollback.md` — Cloudflare 側障害との切り分け
- `staging-data-sync.md` — 本番→staging の手動データ同期
