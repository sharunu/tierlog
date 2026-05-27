"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { syncXAccountFromAuth } from "@/lib/actions/account-actions";
import { DEFAULT_GAME, isGameSlug, type GameSlug } from "@/lib/games";
import { resolveAuthRedirectTarget } from "@/lib/auth/redirect";

function getRedirectGame(): GameSlug {
  if (typeof window === "undefined") return DEFAULT_GAME;

  try {
    const stored = window.localStorage.getItem("selectedGame");
    if (isGameSlug(stored)) return stored;
  } catch {
    // ignore (private mode / quota exceeded)
  }

  const match = document.cookie.match(/(?:^|; )selectedGame=([^;]+)/);
  const cookieGame = match?.[1] ?? null;
  return isGameSlug(cookieGame) ? cookieGame : DEFAULT_GAME;
}

function persistSelectedGame(game: GameSlug) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem("selectedGame", game);
  } catch {
    // ignore (private mode / quota exceeded)
  }
  try {
    document.cookie = `selectedGame=${game}; path=/; max-age=31536000; samesite=lax`;
  } catch {
    // ignore
  }
}

export default function AuthCallbackPage() {
  const [error, setError] = useState("");

  useEffect(() => {
    const supabase = createClient();
    const searchParams = new URLSearchParams(window.location.search);

    // OAuth provider 経由の callback では /auth から受けた game / next が query に乗る。
    // callback URL は外部からも叩けるため、受信側でも必ず再検証する。
    const rawGame = searchParams.get("game");
    const validatedSearchGame: GameSlug | null = isGameSlug(rawGame) ? rawGame : null;
    if (validatedSearchGame) {
      persistSelectedGame(validatedSearchGame);
    }
    const defaultGame: GameSlug = validatedSearchGame ?? getRedirectGame();
    const resolvedTarget = resolveAuthRedirectTarget(searchParams, defaultGame);

    // linkIdentity 完了後: ?link_x=true パラメータがある場合
    if (searchParams.get("link_x") === "true") {
      const handleLink = async () => {
        // supabase-jsの初期化（hash fragment処理含む）を待つ
        await new Promise<void>((resolve) => {
          const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
            if (event === "INITIAL_SESSION" || event === "SIGNED_IN" || event === "TOKEN_REFRESHED") {
              subscription.unsubscribe();
              resolve();
            }
          });
          setTimeout(() => { subscription.unsubscribe(); resolve(); }, 3000);
        });

        // セッションを最新化
        await supabase.auth.refreshSession();

        // サーバーから最新のユーザー情報を取得
        const { data: { user } } = await supabase.auth.getUser();

        if (user) {
          const tw = user.identities?.find((i: { provider: string }) => i.provider === "twitter");
          if (tw) {
            // RPC 側で auth.identities から読み取り、クライアント入力値を信用しない
            await supabase.rpc("sync_my_x_connection");
          } else {
            localStorage.removeItem('x_link_pending');
            window.location.href = "/account?x_link_error=conflict";
            return;
          }
        }

        localStorage.removeItem('x_link_pending');
        window.location.href = "/account";
      };
      handleLink();
      return;
    }

    // X連携失敗検出: linkIdentityが失敗してlink_x=trueパラメータが失われた場合
    const xLinkPending = localStorage.getItem('x_link_pending');
    if (xLinkPending) {
      localStorage.removeItem('x_link_pending');
      window.location.href = "/account?x_link_error=conflict";
      return;
    }

    // supabase-js auto-detects hash fragment tokens
    // Listen for auth state change
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (event === "SIGNED_IN" && session) {
          // anonymousセッション復元は無視
          if (session.user?.is_anonymous) {
            await supabase.auth.signOut();
            return;
          }
          await syncXAccountFromAuth();
          window.location.href = resolvedTarget;
        }
        if (event === "PASSWORD_RECOVERY" && session) {
          window.location.href = "/account";
        }
      }
    );

    // Fallback: check session after a delay
    const timeout = setTimeout(async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        window.location.href = resolvedTarget;
      } else {
        setError("ログインに失敗しました。もう一度お試しください。");
      }
    }, 5000);

    return () => {
      subscription.unsubscribe();
      clearTimeout(timeout);
    };
  }, []);

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="text-center space-y-4">
          <p className="text-destructive text-sm">{error}</p>
          <a href="/auth" className="text-primary underline text-sm">
            ログイン画面に戻る
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center">
      <p className="text-muted-foreground">ログイン処理中...</p>
    </div>
  );
}
