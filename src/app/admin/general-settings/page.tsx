"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, Settings, Trash2 } from "lucide-react";

import { createClient } from "@/lib/supabase/client";

type SettingsResp = {
  share_retention_days: number | null;
  updated_at: string | null;
};

type CleanupPreviewResp = {
  count: number;
  storage_targets: number;
  orphan_rows: number;
};

type CleanupExecResp = {
  ok: boolean;
  deleted: number;
  storage_deleted: number;
  storage_warnings: string[];
};

async function callApi<T>(path: string, init?: RequestInit): Promise<T> {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) throw new Error("not_authenticated");
  const res = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.access_token}`,
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as {
      error?: string;
      reason?: string;
    };
    throw new Error(`${res.status}: ${body.reason ?? body.error ?? "request_failed"}`);
  }
  return (await res.json()) as T;
}

export default function GeneralSettingsPage() {
  const router = useRouter();
  const [currentDays, setCurrentDays] = useState<number | null>(null);
  const [input, setInput] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState<CleanupPreviewResp | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [cleaning, setCleaning] = useState(false);
  const [cleanResult, setCleanResult] = useState<CleanupExecResp | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);

  const loadSettings = useCallback(() => {
    setLoading(true);
    callApi<SettingsResp>("/api/admin/settings")
      .then((r) => {
        setCurrentDays(r.share_retention_days);
        setInput(String(r.share_retention_days ?? 90));
        setLoading(false);
      })
      .catch((e: unknown) => {
        setError(`設定の取得に失敗しました: ${e instanceof Error ? e.message : String(e)}`);
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  const handleSave = async () => {
    setError(null);
    setSavedMessage(null);
    const n = parseInt(input, 10);
    if (Number.isNaN(n) || n < 1 || n > 3650) {
      setError("1〜3650 の整数を入力してください");
      return;
    }
    setSaving(true);
    try {
      await callApi("/api/admin/settings", {
        method: "POST",
        body: JSON.stringify({ share_retention_days: n }),
      });
      setCurrentDays(n);
      setSavedMessage(`保存しました。既存の共有データの有効期限も ${n} 日に追従更新されます`);
    } catch (e: unknown) {
      setError(`保存に失敗しました: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSaving(false);
    }
  };

  const handlePreview = async () => {
    setError(null);
    setCleanResult(null);
    setPreviewLoading(true);
    try {
      const r = await callApi<CleanupPreviewResp>("/api/admin/share-cleanup");
      setPreview(r);
    } catch (e: unknown) {
      setError(`プレビューに失敗しました: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleCleanup = async () => {
    if (!preview || preview.count === 0) return;
    if (!window.confirm(`期限切れの共有データ ${preview.count} 件を削除します。よろしいですか?`)) return;
    setError(null);
    setCleaning(true);
    try {
      const r = await callApi<CleanupExecResp>("/api/admin/share-cleanup", {
        method: "POST",
      });
      setCleanResult(r);
      setPreview(null);
    } catch (e: unknown) {
      setError(`削除に失敗しました: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setCleaning(false);
    }
  };

  return (
    <div className="min-h-screen px-4 pt-6 pb-8 max-w-lg mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <button
          onClick={() => router.push("/admin")}
          className="text-muted-foreground hover:text-foreground"
          aria-label="戻る"
        >
          <ChevronLeft size={20} />
        </button>
        <h1 className="text-[20px] font-medium">一般設定</h1>
      </div>

      {error && (
        <div
          role="alert"
          className="mb-4 rounded-[8px] px-3 py-3 bg-destructive/10 text-destructive text-[13px]"
          style={{ border: "0.5px solid color-mix(in srgb, var(--destructive) 40%, transparent)" }}
        >
          {error}
        </div>
      )}

      <section className="mb-4 bg-surface-2 rounded-[10px] p-4">
        <div className="flex items-center gap-2 mb-2">
          <Settings size={18} className="text-primary" />
          <h2 className="text-[14px] font-medium">共有データ保存期間</h2>
        </div>
        <p className="text-[12px] text-muted-foreground mb-3">
          X 投稿用に生成される共有データ (DB レコード + Storage 画像) を保持する日数。
          1〜3650 の整数で指定します。値を変更すると、既存の共有データの有効期限も追従更新されます。
        </p>
        {loading ? (
          <div className="animate-pulse rounded-[8px] bg-surface-1 h-10" />
        ) : (
          <>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={1}
                max={3650}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                className="w-24 rounded-[8px] bg-surface-1 px-3 py-2 text-[13px]"
                style={{ border: "0.5px solid var(--border-subtle)" }}
                aria-label="保存期間 (日)"
              />
              <span className="text-[12px] text-muted-foreground">日</span>
              <button
                onClick={handleSave}
                disabled={saving}
                className="ml-auto px-3 py-2 rounded-[8px] bg-primary text-primary-foreground text-[12px] font-medium disabled:opacity-50"
              >
                {saving ? "保存中..." : "保存"}
              </button>
            </div>
            {currentDays !== null && (
              <p className="text-[11px] text-muted-foreground mt-2">
                現在の設定値: <span className="text-foreground">{currentDays} 日</span>
              </p>
            )}
            {savedMessage && (
              <p className="text-[11px] text-success mt-2">{savedMessage}</p>
            )}
          </>
        )}
      </section>

      <section className="bg-surface-2 rounded-[10px] p-4">
        <div className="flex items-center gap-2 mb-2">
          <Trash2 size={18} className="text-destructive" />
          <h2 className="text-[14px] font-medium">期限切れ共有データの削除</h2>
        </div>
        <p className="text-[12px] text-muted-foreground mb-3">
          保存期間を超えた共有データを一括削除します。DB 行と Storage 画像の両方を削除します。
          公開初期は自動 cron を持たず、ここから手動で実行する運用です。
        </p>

        <div className="flex flex-col gap-2">
          <button
            onClick={handlePreview}
            disabled={previewLoading || cleaning}
            className="rounded-[8px] bg-surface-1 px-3 py-2 text-[12px] font-medium disabled:opacity-50"
            style={{ border: "0.5px solid var(--border-subtle)" }}
          >
            {previewLoading ? "確認中..." : "対象件数を確認"}
          </button>

          {preview && (
            <div
              className="rounded-[8px] bg-surface-1 p-3 text-[12px] space-y-1"
              style={{ border: "0.5px solid var(--border-subtle)" }}
            >
              <p>
                対象件数: <span className="font-medium">{preview.count}</span> 件
              </p>
              <p className="text-[11px] text-muted-foreground">
                うち Storage 削除対象: {preview.storage_targets} 件 / 画像なし (DB 行のみ): {preview.orphan_rows} 件
              </p>
              {preview.count > 0 ? (
                <button
                  onClick={handleCleanup}
                  disabled={cleaning}
                  className="mt-2 w-full rounded-[8px] bg-destructive text-white px-3 py-2 text-[12px] font-medium disabled:opacity-50"
                >
                  {cleaning ? "削除中..." : `${preview.count} 件を削除する`}
                </button>
              ) : (
                <p className="text-[11px] text-muted-foreground mt-1">削除対象はありません</p>
              )}
            </div>
          )}

          {cleanResult && (
            <div
              className="rounded-[8px] bg-success/10 p-3 text-[12px] space-y-1"
              style={{ border: "0.5px solid color-mix(in srgb, var(--success) 40%, transparent)" }}
            >
              <p className="text-success font-medium">
                削除完了: DB 行 {cleanResult.deleted} 件 / Storage 画像 {cleanResult.storage_deleted} 件
              </p>
              {cleanResult.storage_warnings.length > 0 && (
                <p className="text-warning text-[11px]">
                  ⚠ {cleanResult.storage_warnings.join(", ")}
                </p>
              )}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
