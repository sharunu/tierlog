"use client";

import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { changePassword, getAuthProvider, deleteAccount, getDisplayName } from "@/lib/actions/account-actions";
import { BottomNav } from "@/components/layout/BottomNav";

function SecurityPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = createClient();

  const [pageLoading, setPageLoading] = useState(true);
  const [provider, setProvider] = useState("");
  const [displayName, setDisplayName] = useState("");

  // パスワード変更
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [passwordMessage, setPasswordMessage] = useState("");
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [isRecovery, setIsRecovery] = useState(false);

  // アカウント削除
  const [deleteStep, setDeleteStep] = useState(0);
  const [deleteConfirmName, setDeleteConfirmName] = useState("");
  const [deleteMessage, setDeleteMessage] = useState("");
  const [deleteLoading, setDeleteLoading] = useState(false);

  useEffect(() => {
    const load = async () => {
      try {
        const [prov, name] = await Promise.all([
          getAuthProvider(),
          getDisplayName(),
        ]);
        setProvider(prov);
        setDisplayName(name);
      } catch {
        console.error("Failed to load security data");
      } finally {
        setPageLoading(false);
      }
    };
    load();

    if (searchParams.get("recovery") === "true") {
      // URL searchParams から recovery フラグを検出して state に反映。
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setIsRecovery(true);
    }

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") {
        setIsRecovery(true);
      }
    });
    return () => subscription.unsubscribe();
  }, [supabase, searchParams]);

  const isSnsLogin = provider === "google" || provider === "twitter";
  const isGuest = provider === "anonymous" || provider === "unknown";

  const handleChangePassword = async () => {
    if (!isRecovery && !currentPassword) return;
    if (!newPassword) return;
    if (newPassword.length < 8) {
      setPasswordMessage("新しいパスワードは8文字以上にしてください");
      return;
    }
    setPasswordLoading(true);
    setPasswordMessage("");
    try {
      if (isRecovery) {
        const { error } = await supabase.auth.updateUser({ password: newPassword });
        if (error) throw error;
        setPasswordMessage("パスワードを設定しました");
        setIsRecovery(false);
      } else {
        await changePassword(currentPassword, newPassword);
        setPasswordMessage("パスワードを変更しました");
      }
      setCurrentPassword("");
      setNewPassword("");
    } catch {
      setPasswordMessage("パスワードの変更に失敗しました");
    }
    setPasswordLoading(false);
  };

  const handleDeleteAccount = async () => {
    setDeleteLoading(true);
    setDeleteMessage("");
    try {
      await deleteAccount();
      await supabase.auth.signOut();
      router.push("/auth");
    } catch {
      setDeleteMessage("アカウントの削除に失敗しました");
    }
    setDeleteLoading(false);
  };

  const confirmDisplayName = displayName || "";
  const isDeleteConfirmed = confirmDisplayName && deleteConfirmName === confirmDisplayName;

  if (pageLoading) {
    return (
      <>
        <div className="min-h-screen pb-20 px-4 pt-6 max-w-lg mx-auto">
          <div className="flex items-center gap-2 mb-5">
            <div className="animate-pulse rounded-[8px] bg-surface-2 h-5 w-32" />
          </div>
          <div className="space-y-4">
            <div className="animate-pulse rounded-[10px] bg-surface-2 h-32" />
            <div className="animate-pulse rounded-[10px] bg-surface-2 h-24" />
          </div>
        </div>
        <BottomNav />
      </>
    );
  }

  return (
    <>
      <div className="min-h-screen pb-20 px-4 pt-6 max-w-lg mx-auto">
        {/* 戻るヘッダー */}
        <Link href="/account" className="flex items-center gap-1 mb-5 text-muted-foreground hover:text-foreground transition-colors">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          <span className="text-[14px]">アカウント設定</span>
        </Link>

        <h1 className="text-[20px] font-medium mb-5">セキュリティ</h1>

        {/* パスワード変更カード */}
        <div className="bg-surface-2 rounded-[10px] px-4 py-[14px]">
          {isSnsLogin || isGuest ? (
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[14px]">パスワード変更</p>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  {isSnsLogin ? "SNSログイン中のため変更できません" : "ゲストアカウントではパスワードを設定できません"}
                </p>
              </div>
              <span className="text-[10px] bg-surface-1 text-muted-foreground px-2 py-0.5 rounded-full flex-shrink-0 ml-2">無効</span>
            </div>
          ) : (
            <div>
              <p className="text-[14px] mb-3">
                {isRecovery ? "新しいパスワードを設定" : "パスワード変更"}
              </p>
              {isRecovery && (
                <p className="text-[11px] text-primary-soft mb-3">
                  パスワードリセットメールからのアクセスです。新しいパスワードを設定してください。
                </p>
              )}
              <div className="space-y-2">
                {!isRecovery && (
                  <input
                    type="password"
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    className="w-full bg-surface-1 rounded-[6px] px-3 py-2 text-[14px] focus:outline-none"
                    style={{ border: "0.5px solid var(--border)" }}
                    placeholder="現在のパスワード"
                  />
                )}
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="w-full bg-surface-1 rounded-[6px] px-3 py-2 text-[14px] focus:outline-none"
                  style={{ border: "0.5px solid var(--border)" }}
                  placeholder="新しいパスワード（8文字以上）"
                />
                <button
                  onClick={handleChangePassword}
                  disabled={passwordLoading || (!isRecovery && !currentPassword) || !newPassword}
                  className="w-full bg-primary text-primary-foreground rounded-[6px] px-3 py-2 text-[13px] font-medium hover:opacity-90 disabled:opacity-50"
                >
                  {isRecovery ? "パスワードを設定" : "パスワードを変更"}
                </button>
              </div>
              {passwordMessage && (
                <p className="text-xs text-warning mt-2">{passwordMessage}</p>
              )}
            </div>
          )}
        </div>

        {/* アカウント削除カード */}
        {!isGuest && (
          <div className="mt-4">
            {deleteStep === 0 && (
              <div
                className="rounded-[10px] px-4 py-[14px] flex items-center justify-between cursor-pointer"
                style={{
                  backgroundColor: "color-mix(in srgb, var(--destructive) 6%, transparent)",
                  border: "0.5px solid color-mix(in srgb, var(--destructive) 20%, transparent)",
                }}
                onClick={() => { if (window.confirm("本当にアカウントを削除しますか？")) setDeleteStep(1); }}
              >
                <div>
                  <p className="text-[14px] text-destructive">アカウントを削除</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">すべてのデータが完全に削除されます</p>
                </div>
                <span className="text-destructive text-[18px] flex-shrink-0">&rsaquo;</span>
              </div>
            )}

            {deleteStep === 1 && (
              <div className="bg-surface-2 rounded-[10px] px-4 py-[14px] space-y-3" style={{ border: "0.5px solid color-mix(in srgb, var(--destructive) 40%, transparent)" }}>
                <p className="text-[14px] font-medium text-destructive">アカウント削除の確認</p>
                <p className="text-[11px] text-muted-foreground">
                  この操作は取り消せません。確認のためユーザー名を入力してください。
                </p>
                <p className="text-[12px] text-muted-foreground bg-surface-1 rounded-[6px] px-3 py-2" style={{ border: "0.5px solid var(--border)" }}>
                  {confirmDisplayName || "（未設定）"}
                </p>
                <input
                  type="text"
                  value={deleteConfirmName}
                  onChange={(e) => setDeleteConfirmName(e.target.value)}
                  className="w-full bg-surface-1 rounded-[6px] px-3 py-2 text-[14px] focus:outline-none"
                  style={{ border: "0.5px solid var(--border)" }}
                  placeholder="上記のユーザー名を入力"
                />
                {deleteMessage && (
                  <p className="text-xs text-destructive">{deleteMessage}</p>
                )}
                <div className="flex gap-2">
                  <button
                    onClick={() => { setDeleteStep(0); setDeleteConfirmName(""); setDeleteMessage(""); }}
                    className="flex-1 bg-surface-1 text-muted-foreground rounded-[6px] px-3 py-2 text-[13px] hover:opacity-80"
                    style={{ border: "0.5px solid var(--border)" }}
                  >
                    キャンセル
                  </button>
                  <button
                    onClick={handleDeleteAccount}
                    disabled={deleteLoading || !isDeleteConfirmed}
                    className="flex-1 bg-destructive text-white rounded-[6px] px-3 py-2 text-[13px] font-medium hover:opacity-90 disabled:opacity-50"
                  >
                    {deleteLoading ? "削除中..." : "削除する"}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
      <BottomNav />
    </>
  );
}

export default function SecurityPage() {
  return (
    <Suspense
      fallback={
        <><div className="min-h-screen pb-20 px-4 pt-6 max-w-lg mx-auto">
          <div className="animate-pulse rounded-[8px] bg-surface-2 h-5 w-32 mb-5" />
          <div className="space-y-4">
            <div className="animate-pulse rounded-[10px] bg-surface-2 h-32" />
            <div className="animate-pulse rounded-[10px] bg-surface-2 h-24" />
          </div>
        </div><BottomNav /></>
      }
    >
      <SecurityPageInner />
    </Suspense>
  );
}
