"use client";
import { useGame } from "@/lib/games/context";

import { useState, useEffect, useRef } from "react";
import { X, Download, Loader2, AlertCircle } from "lucide-react";
import type { StatsShareData, DeckShareData } from "./ShareButton";
import { StatsShareCard } from "./StatsShareCard";
import { DeckShareCard } from "./DeckShareCard";
import { createClient } from "@/lib/supabase/client";
import { generateShareId } from "@/lib/share-utils";
import { formatWLTJa } from "@/lib/battle/result-format";

type Props = {
  type: "stats" | "deck" | "opponent";
  data: StatsShareData | DeckShareData;
  onClose: () => void;
};

export function ShareModal({ type, data, onClose }: Props) {
  const { trackerName, slug: game } = useGame();
  const cardRef = useRef<HTMLDivElement>(null);
  const [imageBlob, setImageBlob] = useState<Blob | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [capturing, setCapturing] = useState(true);
  const [posting, setPosting] = useState(false);
  const [uploadFailed, setUploadFailed] = useState(false);
  const [uploadRetrying, setUploadRetrying] = useState(false);

  const appUrl = typeof window !== "undefined" ? window.location.origin : (process.env.NEXT_PUBLIC_APP_URL ?? "");

  const shareText = (() => {
    const fmt = (rate: number | null) => rate === null ? "--" : rate;
    if (type === "stats") {
      const d = data as StatsShareData;
      return `${trackerName}で戦績を記録中！\n勝率 ${fmt(d.winRate)}%（${formatWLTJa(d.totalWins, d.totalLosses, d.totalDraws, d.game)}）`;
    } else if (type === "deck") {
      const d = data as DeckShareData;
      return `【${d.deckName}】勝率 ${fmt(d.winRate)}%（${formatWLTJa(d.totalWins, d.totalLosses, d.totalDraws, d.game)}）`;
    } else {
      const d = data as DeckShareData;
      return `【vs ${d.deckName}】勝率 ${fmt(d.winRate)}%（${formatWLTJa(d.totalWins, d.totalLosses, d.totalDraws, d.game)}）`;
    }
  })();

  useEffect(() => {
    const capture = async () => {
      if (!cardRef.current) return;
      try {
        if (document.fonts?.ready) {
          await document.fonts.ready;
        }
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const html2canvas = (await import("html2canvas")).default;
        const canvas = await html2canvas(cardRef.current, {
          scale: 2,
          useCORS: true,
          backgroundColor: null,
          width: 1200,
          height: 630,
          windowWidth: 1200,
          windowHeight: 630,
          logging: false,
        });
        canvas.toBlob((blob) => {
          if (blob) {
            setImageBlob(blob);
            setImageUrl(URL.createObjectURL(blob));
          } else {
            setError(true);
          }
          setCapturing(false);
        }, "image/png");
      } catch {
        setError(true);
        setCapturing(false);
      }
    };
    // DOMレンダリング後にキャプチャ
    const timer = setTimeout(capture, 300);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    return () => {
      if (imageUrl) URL.revokeObjectURL(imageUrl);
    };
  }, [imageUrl]);

  const handleMobileShare = async () => {
    if (!imageBlob) return;
    const file = new File([imageBlob], "duepure-stats.png", { type: "image/png" });
    if (navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ text: shareText, files: [file] });
      } catch {
        // ユーザーがキャンセル
      }
    }
  };

  const handleDownload = () => {
    if (!imageUrl) return;
    const a = document.createElement("a");
    a.href = imageUrl;
    a.download = "duepure-stats.png";
    a.click();
  };

  const proceedXPost = async ({ skipUpload }: { skipUpload: boolean }) => {
    setPosting(true);

    // モバイルのポップアップブロック回避: async処理の前にウィンドウを同期的に開く
    const newWindow = window.open("", "_blank");

    try {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");
      if (!imageBlob) throw new Error("Image not ready");

      const id = generateShareId();

      // Upload captured image to Supabase Storage so X can use it as og:image
      let imageUrl: string | null = null;
      if (!skipUpload) {
        // upload error 専用 catch — auth / shares INSERT 失敗とは混同しない
        try {
          const filePath = `${user.id}/${id}.png`;
          const { error: uploadError } = await supabase.storage
            .from("share-images")
            .upload(filePath, imageBlob, {
              contentType: "image/png",
              cacheControl: "604800",
            });
          if (uploadError) throw uploadError;
          const { data: pub } = supabase.storage.from("share-images").getPublicUrl(filePath);
          imageUrl = pub.publicUrl;
        } catch {
          // upload 失敗時のみ警告 UI に遷移、newWindow リーク対策
          if (newWindow && !newWindow.closed) newWindow.close();
          setUploadFailed(true);
          return;
        }
      }

      const insertPayload: Record<string, unknown> = {
        id,
        share_type: type,
        share_data: data as unknown as import("@/lib/supabase/database.types").Json,
        user_id: user.id,
        game_title: game,
      };
      if (imageUrl) insertPayload.image_url = imageUrl;

      const { error: insertError } = await supabase
        .from("shares")
        .insert(insertPayload as never);

      if (insertError) throw insertError;

      const shareUrl = `${appUrl}/share/${id}`;
      const intentUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}&url=${encodeURIComponent(shareUrl)}`;

      if (newWindow) {
        newWindow.location.href = intentUrl;
      } else {
        window.location.href = intentUrl;
      }
    } catch {
      // upload 以外のエラー (auth / shares INSERT 失敗等) は従来の silent fallback (テキストのみ)
      const fallbackText = `${shareText}\n${appUrl}`;
      const fallbackUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(fallbackText)}`;
      if (newWindow) {
        newWindow.location.href = fallbackUrl;
      } else {
        window.location.href = fallbackUrl;
      }
    } finally {
      setPosting(false);
    }
  };

  const handleXPost = () => proceedXPost({ skipUpload: false });

  const handleRetryUpload = async () => {
    setUploadRetrying(true);
    setUploadFailed(false);
    try {
      await proceedXPost({ skipUpload: false });
    } finally {
      setUploadRetrying(false);
    }
  };

  const handlePostWithoutImage = () => {
    setUploadFailed(false);
    return proceedXPost({ skipUpload: true });
  };

  const handleCancelUploadError = () => {
    setUploadFailed(false);
  };

  const isMobile = typeof navigator !== "undefined" && /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
  const canNativeShare = typeof navigator !== "undefined" && !!navigator.canShare;

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center"
      style={{ backgroundColor: "rgba(0,0,0,0.6)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="w-full max-w-lg mx-4 rounded-[12px] overflow-hidden"
        style={{ backgroundColor: "#1a1d2e", border: "0.5px solid rgba(100,100,150,0.3)" }}
      >
        {/* ヘッダー */}
        <div className="flex items-center justify-between px-5 py-4">
          <h2 className="text-[16px] font-medium">戦績をシェア</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300">
            <X size={20} />
          </button>
        </div>

        {/* プレビュー */}
        <div className="px-5 pb-4">
          {capturing ? (
            <div className="flex items-center justify-center h-[200px]">
              <div className="animate-spin h-6 w-6 border-2 border-[#818cf8] border-t-transparent rounded-full" />
            </div>
          ) : error ? (
            <div className="text-center py-8">
              <p className="text-[13px] text-gray-400">画像の生成に失敗しました</p>
            </div>
          ) : imageUrl ? (
            <div className="rounded-lg overflow-hidden">
              <img
                src={imageUrl}
                alt="シェア画像プレビュー"
                className="w-full h-auto"
              />
            </div>
          ) : null}
        </div>

        {/* Upload error 警告ブロック */}
        {uploadFailed && (
          <div
            className="mx-5 mb-3 rounded-[8px] px-3 py-3"
            style={{ backgroundColor: "rgba(239,68,68,0.1)", border: "0.5px solid rgba(239,68,68,0.4)" }}
          >
            <div className="flex items-start gap-2 mb-3">
              <AlertCircle size={16} className="text-red-400 mt-0.5 shrink-0" />
              <p className="text-[13px] text-red-300">
                画像のアップロードに失敗しました。再試行するか、画像なしで投稿できます。
              </p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleRetryUpload}
                disabled={posting || uploadRetrying}
                className="flex-1 bg-[#6366f1] text-white rounded-[8px] px-3 py-2 text-[12px] font-medium hover:opacity-90 disabled:opacity-50"
              >
                {uploadRetrying ? "再試行中..." : "再試行"}
              </button>
              <button
                onClick={handlePostWithoutImage}
                disabled={posting || uploadRetrying}
                className="flex-1 bg-[#232640] text-white rounded-[8px] px-3 py-2 text-[12px] font-medium hover:opacity-90 disabled:opacity-50"
                style={{ border: "0.5px solid rgba(100,100,150,0.3)" }}
              >
                画像なしで投稿
              </button>
              <button
                onClick={handleCancelUploadError}
                disabled={posting || uploadRetrying}
                className="flex-1 bg-transparent text-gray-400 rounded-[8px] px-3 py-2 text-[12px] font-medium hover:text-gray-200 disabled:opacity-50"
              >
                キャンセル
              </button>
            </div>
          </div>
        )}

        {/* アクション */}
        <div className="px-5 pb-5 space-y-3">
          {isMobile && canNativeShare && imageBlob ? (
            <button
              onClick={handleMobileShare}
              className="w-full bg-[#6366f1] text-white rounded-[10px] px-4 py-3 text-[14px] font-medium hover:opacity-90"
            >
              シェアする
            </button>
          ) : (
            <>
              {imageBlob && (
                <button
                  onClick={handleDownload}
                  className="w-full bg-[#232640] text-white rounded-[10px] px-4 py-3 text-[14px] font-medium hover:opacity-90 flex items-center justify-center gap-2"
                  style={{ border: "0.5px solid rgba(100,100,150,0.3)" }}
                >
                  <Download size={16} />
                  画像を保存
                </button>
              )}
              <button
                onClick={handleXPost}
                disabled={posting || uploadFailed}
                className="w-full bg-[#232640] text-white rounded-[10px] px-4 py-3 text-[14px] font-medium hover:opacity-90 flex items-center justify-center gap-2 disabled:opacity-50"
                style={{ border: "0.5px solid rgba(100,100,150,0.3)" }}
              >
                {posting ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="white">
                    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
                  </svg>
                )}
                {posting ? "準備中..." : "Xに投稿"}
              </button>
            </>
          )}
        </div>
      </div>

      {/* 非表示のシェアカード（キャプチャ用） */}
      {type === "stats" ? (
        <StatsShareCard ref={cardRef} data={data as StatsShareData} />
      ) : (
        <DeckShareCard ref={cardRef} data={data as DeckShareData} type={type} />
      )}
    </div>
  );
}
