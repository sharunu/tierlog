import { createClient } from "@/lib/supabase/client";

export async function getEmail(): Promise<string> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return "";
  return user.email ?? "";
}

export async function getDisplayName(): Promise<string> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return "";

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
  if (!user) throw new Error("Not authenticated");

  const { error } = await supabase.rpc("update_my_display_name", { p_display_name: name });
  if (error) throw error;
}

export async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || !user.email) throw new Error("Not authenticated");

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
  if (!user) return "unknown";

  // 匿名ユーザーを確実に検出
  if (user.is_anonymous) return "anonymous";

  return user.app_metadata?.provider ?? "email";
}

export async function hasGoogleIdentity(): Promise<boolean> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
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
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) throw new Error("Not authenticated");

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
  if (!user) return { success: false, error: "not_authenticated" };

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
  if (!user) return 2;
  const { data } = await supabase
    .from("profiles").select("stage").eq("id", user.id).single();
  return data?.stage ?? 2;
}

export async function getMyQualityScore(): Promise<{
  totalScore: number;
  breakdown: Record<string, number>;
} | null> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase
    .from("quality_score_snapshots")
    .select("total_score, breakdown")
    .eq("user_id", user.id)
    .single();
  if (!data) return null;
  return { totalScore: data.total_score, breakdown: data.breakdown as Record<string, number> };
}
