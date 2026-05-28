"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import {
  AUTH_EXPIRED_EVENT_NAME,
  AuthExpiredError,
  type AuthExpiredEventDetail,
} from "@/lib/errors/auth-expired-error";
import { isSafeInternalPath } from "@/lib/auth/redirect";

// Plan D / D-5 (RD-D5-1 + RD-D5-2):
//   AuthGuard は AuthExpiredError 系の event を listen して `/auth?next=<current>` へ
//   router.push する client component。BanGuard と並列配置し、責務を分離する:
//     - BanGuard: stage=4 / 認証なし時の BAN UI 表示
//     - AuthGuard: AuthExpiredError 発火時の auth redirect (UI 表示は無し)
//
// 三重経路 (RD-D5-2):
//   - 経路 1: catch ブロック内で `handleAuthExpiredError(e)` → CustomEvent 発火
//   - 経路 2: `window.unhandledrejection` listener (safety net、握りつぶし忘れ箇所をカバー)
//   - 経路 3: `window.addEventListener('tierlog:auth-expired', ...)` (本 component の主入口)
//
// 同一 redirect target への二重発火を防ぐため isRedirecting ref で de-duplication。
//
// next param 検証:
//   - 現在の pathname (+search) を next にする
//   - isSafeInternalPath (Plan A の open redirect helper) で検証し、安全でなければ next 省略

const PUBLIC_PREFIXES = ["/auth", "/terms", "/privacy", "/contact", "/share"] as const;
const EXACT_PUBLIC_PATHS = ["/"] as const;

function isPublicPath(pathname: string): boolean {
  if ((EXACT_PUBLIC_PATHS as readonly string[]).includes(pathname)) return true;
  return PUBLIC_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
}

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const isRedirecting = useRef(false);

  useEffect(() => {
    // Plan D / D-5 (Codex review 2 P2): pathname 変化のたびに isRedirecting をリセット。
    // 一度 redirect 発火後に router.push('/auth') した時点で pathname が変わり effect が再実行される。
    // ここで false に戻すことで:
    //  - /auth に着地 → public path で skip するが、その前にリセット (再ログイン後の取りこぼし回避)
    //  - 再ログイン後に protected path 再入 → 次回 expiry で再度 redirect 可能
    isRedirecting.current = false;

    // 公開ページ (/, /auth/*, /terms, /privacy, /contact, /share/*) では AuthGuard を作動させない。
    // BanGuard と同じ excluded list を維持し、auth 系のループを避ける。
    if (isPublicPath(pathname)) return;

    const redirectToAuth = (reason: string) => {
      if (isRedirecting.current) return;
      isRedirecting.current = true;

      // 現在の pathname + search を next に乗せて auth 後の復帰先にする。
      // 安全性は Plan A の isSafeInternalPath で検証 (外部 URL / /auth / /api 拒否)。
      const search = searchParams?.toString() ?? "";
      const candidate = search ? `${pathname}?${search}` : pathname;
      const nextParam = isSafeInternalPath(candidate) ? candidate : null;

      console.warn(`AuthGuard redirect: reason=${reason} next=${nextParam ?? "(none)"}`);

      const target = nextParam
        ? `/auth?next=${encodeURIComponent(nextParam)}`
        : "/auth";
      router.push(target);
    };

    // 経路 3: CustomEvent listener (経路 1 / 2 のいずれからも届く)
    const onCustom = (e: Event) => {
      const detail = (e as CustomEvent<AuthExpiredEventDetail>).detail;
      redirectToAuth(detail?.reason ?? "custom_event");
    };

    // 経路 2: unhandledrejection fallback (catch 忘れ safety net)
    const onUnhandled = (e: PromiseRejectionEvent) => {
      if (e.reason instanceof AuthExpiredError) {
        // unhandledrejection は browser console に default で出るが、AuthGuard が処理するので
        // 二重ログを避けるため preventDefault しておく。
        e.preventDefault();
        redirectToAuth(e.reason.reason);
      }
    };

    window.addEventListener(AUTH_EXPIRED_EVENT_NAME, onCustom);
    window.addEventListener("unhandledrejection", onUnhandled);

    return () => {
      window.removeEventListener(AUTH_EXPIRED_EVENT_NAME, onCustom);
      window.removeEventListener("unhandledrejection", onUnhandled);
    };
  }, [pathname, searchParams, router]);

  return <>{children}</>;
}
