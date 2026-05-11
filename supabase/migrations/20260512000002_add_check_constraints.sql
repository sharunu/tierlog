-- PR4 (Phase 2 hardening): CHECK 制約 (length / trim 後空文字 / enum) を全主要列に追加
--
-- 長さ上限に加え、length(trim(...)) で空文字 + 空白のみの値も拒否する。
-- preflight クエリで違反 0 件を staging で確認してから apply すること
-- (plan の PR4 preflight クエリ参照、各 SELECT が 0 件であること)。

-- ===== 文字列長さ + trim 後空文字 (NULL 許可は IS NULL OR ... のパターン) =====

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_display_name_length_check
  CHECK (
    display_name IS NULL
    OR (char_length(display_name) <= 50 AND char_length(trim(display_name)) >= 1)
  );

ALTER TABLE public.decks
  ADD CONSTRAINT decks_name_length_check
  CHECK (char_length(name) <= 80 AND char_length(trim(name)) >= 1);

ALTER TABLE public.battles
  ADD CONSTRAINT battles_my_deck_name_length_check
  CHECK (
    my_deck_name IS NULL
    OR (char_length(my_deck_name) <= 80 AND char_length(trim(my_deck_name)) >= 1)
  );

ALTER TABLE public.battles
  ADD CONSTRAINT battles_opponent_deck_name_length_check
  CHECK (char_length(opponent_deck_name) <= 80 AND char_length(trim(opponent_deck_name)) >= 1);

ALTER TABLE public.battles
  ADD CONSTRAINT battles_opponent_memo_length_check
  CHECK (
    opponent_memo IS NULL
    OR (char_length(opponent_memo) <= 500 AND char_length(trim(opponent_memo)) >= 1)
  );

-- battles.tuning_name (snapshot) も 50 字制限を強制 (deck_tunings.name と同じ上限)
ALTER TABLE public.battles
  ADD CONSTRAINT battles_tuning_name_length_check
  CHECK (
    tuning_name IS NULL
    OR (char_length(tuning_name) <= 50 AND char_length(trim(tuning_name)) >= 1)
  );

ALTER TABLE public.deck_tunings
  ADD CONSTRAINT deck_tunings_name_length_check
  CHECK (char_length(name) <= 50 AND char_length(trim(name)) >= 1);

ALTER TABLE public.feedback
  ADD CONSTRAINT feedback_message_length_check
  CHECK (char_length(message) <= 2000 AND char_length(trim(message)) >= 1);

-- ===== enum =====
ALTER TABLE public.feedback
  ADD CONSTRAINT feedback_category_check
  CHECK (category IN ('bug', 'feature', 'other'));

-- admin 入力経由でも DB 側で 80 字制限を強制
ALTER TABLE public.opponent_deck_master
  ADD CONSTRAINT opponent_deck_master_name_length_check
  CHECK (char_length(name) <= 80 AND char_length(trim(name)) >= 1);
