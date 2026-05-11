-- PR4 (Phase 2 hardening): battles 複合 index 追加
--
-- 主要 UI クエリのパターンに合わせた複合 index。
-- CREATE INDEX は SHARE lock を取るため production 適用は低トラフィック時に行う。

-- 主要 UI クエリ: user_id × game_title × format × 日付降順 + id (tiebreaker)
-- PR8 の cursor-based pagination が ORDER BY (fought_at DESC, id DESC) を使うので
-- index 末尾にも id DESC を含めて index-only walk を可能にする
CREATE INDEX IF NOT EXISTS battles_user_game_format_fought_at_idx
  ON public.battles(user_id, game_title, format, fought_at DESC, id DESC);

-- 統計 RPC 用 (global stats): format × game_title × 日付降順
CREATE INDEX IF NOT EXISTS battles_format_game_fought_at_idx
  ON public.battles(format, game_title, fought_at DESC);
