import { createClient } from "@/lib/supabase/client";
import { AuthExpiredError } from "@/lib/errors/auth-expired-error";

export async function submitFeedback(
  category: "bug" | "feature" | "other",
  message: string
): Promise<void> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  // Plan D / D-5: 重要操作 → AuthExpiredError (AuthGuard が catch して /auth へ redirect)
  if (!user) throw new AuthExpiredError("submitFeedback");

  const { error } = await supabase
    .from("feedback")
    .insert({ user_id: user.id, category, message });

  if (error) throw error;
}
