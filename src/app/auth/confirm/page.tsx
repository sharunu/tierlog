"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export default function AuthConfirmPage() {
  const [error, setError] = useState("");
  const errorSetRef = useRef(false);

  useEffect(() => {
    const supabase = createClient();

    // Handle code in query params (PKCE flow from email verification)
    const url = new URL(window.location.href);
    const code = url.searchParams.get("code");
    if (code) {
      supabase.auth.exchangeCodeForSession(code).then(({ error }) => {
        if (error) {
          errorSetRef.current = true;
          setError("リンクが無効または期限切れです。もう一度パスワードリセットをお試しください。");
        }
      });
    }

    // Handle hash fragment tokens (implicit flow)
    // supabase-js auto-detects hash fragment tokens via detectSessionInUrl
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        if (event === "PASSWORD_RECOVERY" && session) {
          window.location.href = "/account?recovery=true";
        }
        if (event === "SIGNED_IN" && session) {
          window.location.href = "/account";
        }
      }
    );

    // Check for error in hash fragment
    const hash = window.location.hash;
    if (hash.includes("error=")) {
      const params = new URLSearchParams(hash.substring(1));
      const errorDesc = params.get("error_description");
      errorSetRef.current = true;
      // URL hash fragment から error params を検出して error state に反映。
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setError(errorDesc
        ? "リンクが無効または期限切れです。もう一度パスワードリセットをお試しください。"
        : "エラーが発生しました。");
    }

    // Fallback timeout
    const timeout = setTimeout(async () => {
      if (errorSetRef.current) return; // Already showing error
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        window.location.href = "/account";
      } else {
        errorSetRef.current = true;
        setError("リンクが無効または期限切れです。もう一度パスワードリセットをお試しください。");
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
      <p className="text-muted-foreground">認証処理中...</p>
    </div>
  );
}
