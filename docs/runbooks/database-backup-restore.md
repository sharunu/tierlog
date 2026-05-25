# runbook: Supabase Database バックアップ確認・復旧

最終更新: 2026-05-25

## いつ参照する

- 本番 DB でデータ消失・破壊が判明した時（戦績データ・ユーザーアカウント等）
- 計画的な DB マイグレーション（`supabase/migrations/`）の適用中・適用後に問題が判明した時
- ユーザー報告で「戦績が消えた」「アカウント情報が変わった」等が複数件あった時
- 開発者自身が DB に対する破壊的操作（DELETE / TRUNCATE / ALTER 等）を誤実行した時

## 最初の 5 分でやること（影響範囲の限定）

### 1. 書き込み停止の判断

データ消失・破壊が継続している疑いがあれば:

1. **追加破壊を止める**: 該当する RPC・migration の即時 rollback。コード側にバグがあれば最新 deploy を Cloudflare で 1 つ前にロールバック（`cloudflare-rollback.md` 参照）
2. 不要なら **書き込み停止までは不要**: Supabase は外部から書き込みを受け付け続けても良い場合が多い（影響範囲が限定的なら）

### 2. 影響範囲の確認

Supabase Dashboard → **Database** → Query Editor で:

```sql
-- 例: battles テーブルの直近 1 時間の新規レコード数
SELECT COUNT(*) FROM battles WHERE created_at > NOW() - INTERVAL '1 hour';

-- 例: 特定ユーザーの戦績数
SELECT user_id, COUNT(*) FROM battles GROUP BY user_id ORDER BY 2 DESC LIMIT 10;

-- 例: 削除疑惑のあるレコードの確認（論理削除カラムの状態など）
SELECT COUNT(*) FROM deck_tunings WHERE is_archived = true;
```

これらで影響を受けたテーブル・行数を把握する。

## バックアップの種類と利用可能範囲

### Supabase Free Plan（tierlog 想定）

- **Automated Backups**: Free Plan では **7 日間の point-in-time recovery (PITR) は未提供**。Daily backups のみ保持
- **Manual Backups**: 開発者が手動で `pg_dump` 等で取得することは可能
- 詳細: https://supabase.com/docs/guides/platform/backups （取得日 2026-05-25）

### Pro Plan 以上の場合

- 7 日間の PITR / Long-term retention が利用可能
- Dashboard → Database → **Backups** タブから復元可能

## 復旧手順

### A. Supabase Dashboard 経由（Pro Plan の PITR を使う場合）

1. Supabase Dashboard → 該当 project → **Database** → **Backups**
2. 復元したい時点（影響発生の直前）を選択
3. 「Restore」確認ダイアログを実行
4. 注意: 復元は **DB 全体を上書き**するため、復元先より新しいデータ（正常な書き込みも）は失われる
5. 影響範囲を限定したい場合は、別 project に復元してからクエリで差分マージする方が安全

### B. 手動バックアップからの復旧（Free Plan）

1. `pg_dump` で取得済の最新バックアップを確認
2. 影響を受けたテーブルのみ復元（全体上書きではなく差分マージ）
3. RLS / RPC / トリガーが新スキーマと整合しているか確認後、書き込み再開

### C. ロールフォワード（バックアップ復元しない）

DB の状態は変えず、コード側で「壊れたデータ」を扱える形に修正する判断もあり。例: 2026-05-22 tuning 論理削除化バグ修正の事例（`docs/reports/2026-05-22_tuning_logical_delete_snapshot_fix.md`）では、過去履歴のスナップショット破壊が判明したが、影響範囲が限定的で `is_archived` 論理削除 + コード側のセーフガードで対応した。

## 復旧後の確認

```sql
-- 復旧したデータの整合性確認
SELECT COUNT(*) FROM battles;
SELECT COUNT(*) FROM decks WHERE is_archived = false;
-- 主要テーブルが期待件数になっているか
```

加えて、tierlog.app の主要画面（home / stats / decks / account）で動作確認。

## 誰に通知する

- 運営者（個人開発のため自分自身）
- ユーザーデータに影響があった場合: `incident-communication-template.md` のテンプレートで X / Discord 周知

## 公式参照

- Supabase Backups: https://supabase.com/docs/guides/platform/backups （取得日 2026-05-25）
- Supabase migrations: https://supabase.com/docs/guides/deployment/database-migrations （取得日 2026-05-25）
- Supabase pg_dump 手順: https://supabase.com/docs/guides/database/extensions/pg_dump （取得日 2026-05-25）

## 関連 runbook

- `supabase-incident-response.md` — Supabase 側障害の判定
- `incident-communication-template.md` — ユーザー周知文
- `staging-data-sync.md` — 本番→staging データコピー（バックアップ確認の参考に）

## 関連報告書

- `docs/reports/2026-05-22_tuning_logical_delete_snapshot_fix.md` — DB 破壊バグの修正事例
