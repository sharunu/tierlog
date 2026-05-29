import { createClient } from "@/lib/supabase/client";
import { AuthExpiredError } from "@/lib/errors/auth-expired-error";

// Plan D / D-5: if (!user) の用途別 3 分類
//   - UI 表示用 (getEmail / getDisplayName) → throw AuthExpiredError
//   - 重要操作 (updateDisplayName / changePassword / unlinkXAccount / deleteAccount) → throw AuthExpiredError
//   - Optional state (getAuthProvider / hasGoogleIdentity / getXConnectionStatus / getUserStage / getMyQualityScore)
//     → 現状維持 (null / false / "unknown" / 2 などのデフォルト値を返す)
// getUserStage は BanGuard が fail-open 用途で呼ぶため throw に変えない (return 2 維持)。

export async function getEmail(): Promise<string> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  // Plan D / D-5: UI 表示用 → AuthExpiredError
  if (!user) throw new AuthExpiredError("getEmail");
  return user.email ?? "";
}

export async function getDisplayName(): Promise<string> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  // Plan D / D-5: UI 表示用 → AuthExpiredError
  if (!user) throw new AuthExpiredError("getDisplayName");

  const { data } = await supabase
    .from("profiles")
    .select("display_name")
    .eq("id", user.id)
    .single();

  return data?.display_name ?? "";
}

export async function updateDisplayName(name: string): Promise<void> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  // Plan D / D-5: 重要操作 → AuthExpiredError
  if (!user) throw new AuthExpiredError("updateDisplayName");

  const { error } = await supabase.rpc("update_my_display_name", { p_display_name: name });
  if (error) throw error;
}

export async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  // Plan D / D-5: 重要操作 → AuthExpiredError
  if (!user || !user.email) throw new AuthExpiredError("changePassword");

  // 現在のパスワードを検証
  const { error: signInError } = await supabase.auth.signInWithPassword({
    email: user.email,
    password: currentPassword,
  });
  if (signInError) throw new Error("現在のパスワードが正しくありません");

  // 新パスワードを設定
  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) throw error;
}

export async function getAuthProvider(): Promise<string> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  // Plan D / D-5: Optional state (security 画面で provider 表示用、未認証時の "unknown" は意味ある値)
  if (!user) return "unknown";

  // 匿名ユーザーを確実に検出
  if (user.is_anonymous) return "anonymous";

  return user.app_metadata?.provider ?? "email";
}

export async function hasGoogleIdentity(): Promise<boolean> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  // Plan D / D-5: Optional state (Google identity の有無を確認、未認証時は false が意味ある)
  if (!user) return false;
  // identities が未取得/空のケースに備えて app_metadata の provider/providers も fallback で見る
  const fromIdentities = (user.identities ?? []).some((i) => i.provider === "google");
  const fromProvider = user.app_metadata?.provider === "google";
  const providersArr = user.app_metadata?.providers;
  const fromProvidersArr = Array.isArray(providersArr) && (providersArr as unknown[]).includes("google");
  return fromIdentities || fromProvider || fromProvidersArr;
}

export async function deleteAccount(): Promise<void> {
  // PR10 Phase A: rpc("delete_own_account") から /api/account/delete (Bearer JWT) へ切替。
  // 旧 RPC は Phase B で DROP 予定。
  // 順序: shares パス収集 → Storage list → auth.admin.deleteUser → 成功時のみ Storage 削除。
  // 呼び出し側 (security/page.tsx) は成功後に supabase.auth.signOut() + /auth リダイレクト済。
  // Plan D / D-5: 重要操作 → AuthExpiredError (API 側は RD-D4-1 で stage=4 でも opt-out 許可)
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) throw new AuthExpiredError("deleteAccount");

  const res = await fetch("/api/account/delete", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.access_token}`,
    },
  });

  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as {
      error?: string;
      reason?: string;
    };
    throw new Error(`${res.status}: ${body.reason ?? body.error ?? "delete failed"}`);
  }
}

// --- X連携関連 ---

export async function getXConnectionStatus(): Promise<{
  isConnected: boolean;
  xUsername: string | null;
  source: "login" | "linked" | null;
}> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  // Plan D / D-5: Optional state (X 連携状態取得、未認証時は無接続表示で OK)
  if (!user) return { isConnected: false, xUsername: null, source: null };

  const { data: profile } = await supabase
    .from("profiles")
    .select("x_user_id, x_username")
    .eq("id", user.id)
    .single();

  if (profile?.x_username) {
    // 実際のidentitiesを確認: Twitterが唯一のidentityの場合のみ "login"
    const identities = user.identities ?? [];
    const isTwitterOnly = identities.length > 0 && identities.every(i => i.provider === "twitter");
    const source = isTwitterOnly ? "login" : "linked";
    return { isConnected: true, xUsername: profile.x_username, source };
  }

  return { isConnected: false, xUsername: null, source: null };
}

export async function syncXAccountFromAuth(): Promise<boolean> {
  const supabase = createClient();
  // sync_my_x_connection は auth.identities から server 側で読み取る。
  // クライアント入力値を信用しないため、ユーザーが自分の profile に任意の X 名を
  // 書き込むことはできない。
  const { data: ok, error } = await supabase.rpc("sync_my_x_connection");

  if (error) {
    return false;
  }

  return ok ?? false;
}

export async function unlinkXAccount(): Promise<{ success: boolean; error?: string }> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  // Plan D / D-5: 重要操作 → AuthExpiredError
  if (!user) throw new AuthExpiredError("unlinkXAccount");

  // Auth層からTwitter identityを削除
  const twitterIdentity = user.identities?.find(i => i.provider === "twitter");
  if (twitterIdentity) {
    // 唯一のidentityの場合は解除不可（ログインできなくなる）
    if (user.identities && user.identities.length <= 1) {
      return { success: false, error: "only_identity" };
    }
    const { error } = await supabase.auth.unlinkIdentity(twitterIdentity);
    if (error) return { success: false, error: error.message };
  }

  // DB 更新（clear_my_x_connection は auth.uid() 本人の行のみクリア）
  await supabase.rpc("clear_my_x_connection");

  return { success: true };
}

export async function getUserStage(): Promise<number> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  // Plan D / D-5: Optional state を維持 (BanGuard が呼ぶ際、fail-open + retry 設計のため
  // throw すると BanGuard の retry loop と AuthGuard redirect が二重発火する。
  // 既存 BanGuard 側で !user ハンドリング済みのため、ここでは return 2 を維持)
  if (!user) return 2;
  const { data } = await supabase
    .from("profiles").select("stage").eq("id", user.id).single();
  return data?.stage ?? 2;
}

export async function getMyQualityScore(): Promise<{
  totalScore: number;
  // Plan C C-5: breakdown には rule_key=>score (number) の他に
  // max_score (number) と max_score_game_title (string) が含まれる (RD-C3)。
  // 表示側で metadata key 除外 + typeof number ガードが必要。
  breakdown: Record<string, number | string>;
} | null> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  // Plan D / D-5: Optional state (quality score は未計算なら null、UI で「未計算」表示)
  if (!user) return null;
  // Plan C C-5: quality_score_snapshots は (user_id, game_title) 複合キーになったため、
  // 自分の全 game snapshot から total_score 最大の row を返す (RD-C3 account-level MAX(score) と整合)。
  // 既存戻り値 shape (totalScore / breakdown) は維持。breakdown.max_score_game_title で
  // 最大値を出した game slug が参照可能 (per-game 表示拡張は Phase 2)。
  // game_title ASC を secondary order として追加し、同点時の戻り値を安定化
  // (DB wrapper の ARRAY['dm', 'pokepoke'] first-eligible 順 = ASC と一致させる、Codex 第 5 回)。
  const { data } = await supabase
    .from("quality_score_snapshots")
    .select("total_score, breakdown")
    .eq("user_id", user.id)
    .order("total_score", { ascending: false })
    .order("game_title", { ascending: true })
    .limit(1);
  if (!data || data.length === 0) return null;
  const row = data[0];
  return { totalScore: row.total_score, breakdown: row.breakdown as Record<string, number | string> };
}
