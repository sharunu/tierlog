// Plan D / D-5: AuthExpiredError + handleAuthExpiredError helper
//
// 目的:
//   JWT 失効・未認証時に lib/actions/ が「空配列 / null / false / throw Error」を混在させると
//   UI 側で「本当にデータがゼロ」と「auth 切れ」が区別できず、戦績ゼロ表示が出る誤解 UX が起きる。
//   D-5 では UI 表示用 / 認可重要操作系のフローで `AuthExpiredError` を throw し、
//   AuthGuard で `/auth?next=<current>` に redirect させる。
//
// 三重経路 (RD-D5-2):
//   - 経路 1 (明示 event): catch ブロック内で `handleAuthExpiredError(e)` を呼ぶ。
//     `error instanceof AuthExpiredError` なら CustomEvent を dispatch して true。
//     catch で握りつぶす箇所でも 1 行追加するだけで AuthGuard まで届く。
//   - 経路 2 (unhandledrejection fallback): AuthGuard 側で `unhandledrejection` listener も登録。
//     経路 1 を忘れた箇所の safety net。
//   - 経路 3 (CustomEvent listener): AuthGuard が `tierlog:auth-expired` event を listen して
//     router.push('/auth?next=...').

export const AUTH_EXPIRED_EVENT_NAME = "tierlog:auth-expired" as const;

export interface AuthExpiredEventDetail {
  reason: string;
}

export class AuthExpiredError extends Error {
  readonly reason: string;
  constructor(reason: string) {
    super(`auth_expired: ${reason}`);
    this.name = "AuthExpiredError";
    this.reason = reason;
  }
}

/**
 * catch ブロック内で 1 行呼ぶだけで AuthGuard まで届ける helper。
 * 戻り値: AuthExpiredError なら true (呼び出し側は通常 early return)、それ以外なら false。
 *
 * SSR (typeof window === 'undefined') では noop で false。
 */
export function handleAuthExpiredError(error: unknown): boolean {
  if (typeof window === "undefined") return false;
  if (error instanceof AuthExpiredError) {
    window.dispatchEvent(
      new CustomEvent<AuthExpiredEventDetail>(AUTH_EXPIRED_EVENT_NAME, {
        detail: { reason: error.reason },
      }),
    );
    return true;
  }
  return false;
}
