-- PR1: discord_oauth_states テーブルの設計意図を DB カタログに記録
--
-- 背景:
--   Supabase Performance Lint の `rls_enabled_no_policy` INFO が discord_oauth_states に
--   出ているが、これは `20260424000001_security_hardening_additive.sql` で意図的に作成した状態
--   (RLS 有効 + policy 未作成 + REVOKE ALL FROM PUBLIC, anon, authenticated)。
--   service_role 経由 (Discord OAuth callback の API route) でのみアクセスする短命 nonce テーブル。
--
-- 目的:
--   設計意図を `COMMENT ON TABLE` で DB カタログに永続化する。
--   `COMMENT` は Supabase Advisor の lint scan を直接抑止する機能ではないため、
--   Advisor の INFO 通知は再走査でも残存する可能性を許容する。
--   Dashboard 上の Lint Exception (`lint_ignore` 登録) は使わない (git 履歴に意図を残せないため)。

COMMENT ON TABLE public.discord_oauth_states IS
  'RLS enabled with no policy intentionally: service_role 経由 (Discord OAuth callback API route) のみアクセスする短命 nonce テーブル。anon/authenticated は REVOKE ALL で二重拒否。詳細: supabase/migrations/20260424000001_security_hardening_additive.sql';

-- ロールバック用 SQL (必要時に手動で流す):
--
--   COMMENT ON TABLE public.discord_oauth_states IS NULL;
