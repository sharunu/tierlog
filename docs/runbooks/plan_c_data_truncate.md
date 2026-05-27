# runbook: Plan C C-6 既存 detection_alerts / quality_score_snapshots の TRUNCATE 手順

最終更新: 2026-05-27

## いつ使う

Plan C (`docs/plans/2026-05-27_plan_c_multi_game_db_scope.md`) の C-3 / C-5 migration が
staging / production に適用された後、既存の `detection_alerts.game_title = 'dm'` (default で埋まったもの)
と `quality_score_snapshots.game_title = 'dm'` (新規列追加で埋まったもの) のデータを
クリーンアップして再生成したい時に使う。

**前提**:

- Plan C C-1〜C-5 の migration がすべて適用済 (`supabase migration list` で確認)
- 既存 cron `daily-detection-scan` / `daily-quality-scoring` が稼働中 (新スキーマに対応した
  `cron_run_detection_scan` / `cron_run_quality_scoring` を呼ぶ)
- ユーザーから本 runbook に基づく TRUNCATE 指示がある

**やらないこと**:

- 自動 migration で TRUNCATE しない (RD-C6)。手動 SQL でのみ実行する
- 「ユーザーゼロだから損失なし」と断定しない。テストデータ・admin 手動投入データの可能性を
  preflight count で必ず確認する

## ステップ 0: 環境特定と connection 文字列の確認

operator (Claude / ユーザー) は、操作対象が staging か production かを必ず最初に確認する。
DB URL は **チャットには貼らず**、ローカル環境変数 (`STAGING_DB_URL` / `PROD_DB_URL`) で扱う。

```bash
# 確認のみ。実際の値は echo しない。
[[ -n "$STAGING_DB_URL" ]] && echo "STAGING_DB_URL set"
[[ -n "$PROD_DB_URL" ]] && echo "PROD_DB_URL set"
```

実行方法は以下のいずれか:

- Supabase MCP の `execute_sql` (project_id を staging / production で明示指定)
- `psql "$STAGING_DB_URL" -c "..."` をローカルで実行 (psql が手元にある場合)
- Supabase ダッシュボード SQL Editor (staging / production の project を選択)

## staging での運用フロー

### 1. preflight count (read-only)

```sql
-- 既存件数と game_title 分布を確認
SELECT game_title, count(*) FROM public.detection_alerts GROUP BY game_title;
SELECT game_title, count(*) FROM public.quality_score_snapshots GROUP BY game_title;

-- 未解決アラートの件数 (是非を判断する材料)
SELECT game_title, count(*) FILTER (WHERE is_resolved = false) AS unresolved,
       count(*) AS total
FROM public.detection_alerts
GROUP BY game_title;

-- snapshot の最終計算時刻
SELECT game_title, min(calculated_at), max(calculated_at), count(*)
FROM public.quality_score_snapshots
GROUP BY game_title;
```

→ ユーザーに件数と分布を報告。

### 2. ユーザー明示承認待ち

operator (Claude) は preflight 結果をユーザーに提示し、

- detection_alerts を TRUNCATE してよいか
- quality_score_snapshots を TRUNCATE してよいか

を個別に確認する。承認が得られなければここで停止。

### 3. pg_cron schedule の一時停止 (任意・推奨)

staging では失敗影響が小さいので skip 可能だが、TRUNCATE と cron 実行が重なると挙動が
読みにくいため、原則一時停止する。

```sql
-- 現状確認
SELECT jobid, jobname, schedule, active
FROM cron.job
WHERE jobname IN ('daily-detection-scan', 'daily-quality-scoring');

-- 一時停止 (unschedule)
SELECT cron.unschedule('daily-detection-scan');
SELECT cron.unschedule('daily-quality-scoring');
```

unschedule 直後に jobid を控えておく (再 schedule 時の参考)。
unschedule した時点で次回実行はキャンセルされる。

### 4. TRUNCATE 実行

```sql
TRUNCATE TABLE public.detection_alerts;
TRUNCATE TABLE public.quality_score_snapshots;
```

`CASCADE` は不要 (`detection_alerts` は他テーブルから FK 参照されない、
`quality_score_snapshots` も同様)。`detection_alerts(resolved_by)` の FK は
`profiles(id)` への外向き参照のみで、TRUNCATE 対象が参照される側ではない。

### 5. 即時 re-scan (gap を最小化する目的)

TRUNCATE 直後に同 SQL セッションで再生成を流す:

```sql
SELECT public.run_detection_scan();
SELECT public.run_quality_scoring(true);
```

- `run_detection_scan()` は内部で `_run_detection_scan_internal()` を呼び、
  Plan C C-3 の game × rule 二重ループで `detection_alerts` を game 別に INSERT する。
- `run_quality_scoring(true)` は内部で `_run_quality_scoring_internal(true)` を呼び、
  Plan C C-4 の game × user 二重ループで `quality_score_snapshots` を UPSERT し、
  user の MAX(score) で `profiles.stage` を更新する。

両 wrapper は admin / service_role でのみ呼べる。staging で SQL Editor から実行する場合は
admin profile を持つ user として接続するか、service_role key で接続する。

### 6. 再生成後の確認

```sql
SELECT game_title, count(*) FROM public.detection_alerts GROUP BY game_title;
SELECT game_title, count(*) FROM public.quality_score_snapshots GROUP BY game_title;

-- breakdown.max_score_game_title が含まれることを確認
SELECT user_id, game_title, total_score, breakdown->>'max_score_game_title' AS max_game
FROM public.quality_score_snapshots
LIMIT 10;
```

operator はこの結果をユーザーに報告。

### 7. pg_cron schedule の再開

step 3 で unschedule した場合は再 schedule する:

```sql
-- 元の schedule (20260509000001:730-741 の定義) を復元
SELECT cron.schedule(
  'daily-quality-scoring',
  '15 19 * * *',
  $$SELECT public.cron_run_quality_scoring()$$
);

SELECT cron.schedule(
  'daily-detection-scan',
  '30 19 * * *',
  $$SELECT public.cron_run_detection_scan()$$
);

-- 確認
SELECT jobid, jobname, schedule, active
FROM cron.job
WHERE jobname IN ('daily-detection-scan', 'daily-quality-scoring');
```

## production での運用フロー

staging とほぼ同じだが、以下の差分を厳守:

### A. 事前バックアップ確認 (production 必須)

Supabase ダッシュボード → Settings → Database → Point-in-Time Recovery / Backups で
最新バックアップ時刻を確認し、ユーザーに報告。`database-backup-restore.md` の手順に
従って復旧可能性を確認してから次に進む。

### B. ユーザー明示承認 (2 回必要)

1. preflight count 報告後の「TRUNCATE してよいか」承認
2. **バックアップ確認後の最終承認** (production はミスると復旧コスト大)

両方の承認が得られなければここで停止。

### C. pg_cron schedule の一時停止 (production では原則必須)

production では cron 次回実行と作業時間が重複する可能性が高いため、原則 unschedule する。
staging と同じ SQL を production で実行する。

### D. TRUNCATE 実行 + 即時 re-scan + 確認

staging step 4〜6 と同じ。SQL Editor または `psql "$PROD_DB_URL"` で実行。

`apply_migration` (Supabase MCP) では migration として履歴に残ってしまうため、
本 TRUNCATE は **`execute_sql`** または手動 SQL で実行する (自動 migration 化しない、
RD-C6)。

### E. pg_cron schedule の再開

staging step 7 と同じ。

### F. 再開後の確認

```sql
-- 再 schedule された job が次回実行を予定していることを確認
SELECT jobid, jobname, schedule, active
FROM cron.job
WHERE jobname IN ('daily-detection-scan', 'daily-quality-scoring');
```

## ロールバック (TRUNCATE の取り消し)

TRUNCATE 後のデータ復元は不可能。以下のいずれかで対応する:

- **staging**: `npm run staging:refresh -- --apply` (詳細は `staging-data-sync.md`) で
  production の global master と指定ユーザーの戦績を再同期できる。
  detection_alerts / quality_score_snapshots はこの sync 対象外なので、別途
  `run_detection_scan()` + `run_quality_scoring(true)` で再生成する。
- **production**: `database-backup-restore.md` の PITR 手順でバックアップから復旧する。
  TRUNCATE 直前の時刻に戻すことになるため、production 反映後に発生した他テーブルの
  更新も巻き戻る可能性がある。**事前確認が必須**。

## 検証チェックリスト

operator は完了報告に以下を含める:

- [ ] 環境 (staging / production) と connection method
- [ ] preflight count (game_title 分布)
- [ ] ユーザー承認のタイムスタンプ
- [ ] pg_cron unschedule 実行ログ (該当する場合)
- [ ] TRUNCATE 実行ログ
- [ ] 再生成 (`run_detection_scan()` / `run_quality_scoring(true)`) 実行ログと戻り値
- [ ] 再生成後 count (game_title 分布)
- [ ] pg_cron re-schedule 実行ログ
- [ ] 再開後の `cron.job` 状態

## 関連ドキュメント

- Plan C: `docs/plans/2026-05-27_plan_c_multi_game_db_scope.md` §6 C-6 (RD-C6)
- DB バックアップ: `docs/runbooks/database-backup-restore.md`
- Staging データ同期: `docs/runbooks/staging-data-sync.md`
- Supabase インシデント対応: `docs/runbooks/supabase-incident-response.md`
