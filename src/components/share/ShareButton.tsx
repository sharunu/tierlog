"use client";

import { useState } from "react";
import { Share2, Lock, X as CloseIcon } from "lucide-react";
import Link from "next/link";
import dynamic from "next/dynamic";

const ShareModal = dynamic(
  () => import("./ShareModal").then((m) => ({ default: m.ShareModal })),
  { ssr: false }
);

export type StatsShareData = {
  totalWins: number;
  totalLosses: number;
  totalDraws: number;
  winRate: number | null;
  firstWins: number;
  firstLosses: number;
  firstDraws: number;
  secondWins: number;
  secondLosses: number;
  secondDraws: number;
  unknownWins: number;
  unknownLosses: number;
  unknownDraws: number;
  encounterDistribution: { name: string; count: number; percentage: number; winRate: number | null }[];
  period: string;
  format: string;
  game: string;
};

export type DeckShareData = {
  deckName: string;
  totalWins: number;
  totalLosses: number;
  totalDraws: number;
  winRate: number | null;
  firstWins: number;
  firstLosses: number;
  firstDraws: number;
  secondWins: number;
  secondLosses: number;
  secondDraws: number;
  topMatchups: { name: string; wins: number; losses: number; draws: number; winRate: number | null }[];
  period: string;
  format: string;
  game: string;
};

type Props = {
  type: "stats" | "deck" | "opponent";
  data: StatsShareData | DeckShareData;
  xConnected?: boolean;
};

export function ShareButton({ type, data, xConnected = true }: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const [showGate, setShowGate] = useState(false);

  if (!xConnected) {
    return (
      <>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setShowGate(true)}
            className="relative p-2 rounded-lg opacity-60 hover:opacity-80 transition-opacity"
            title="シェアにはX連携が必要です"
            aria-label="シェア (X連携が必要)"
          >
            <Share2 size={18} className="text-muted-foreground" />
            <Lock
              size={10}
              className="absolute text-foreground bg-surface-1 rounded-sm p-px"
              style={{ bottom: 4, right: 4 }}
            />
          </button>
          <Link
            href="/account"
            className="flex items-center gap-1 px-2 py-1 text-[11px] rounded-md bg-surface-2 text-foreground hover:bg-surface-3 transition-colors border border-border-subtle"
            title="アカウント設定でX連携"
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
              <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
            </svg>
            X連携
          </Link>
        </div>
        {showGate && (
          <div
            className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60"
            onClick={(e) => {
              if (e.target === e.currentTarget) setShowGate(false);
            }}
          >
            <div className="w-full max-w-sm mx-4 rounded-[12px] overflow-hidden bg-surface-1 border border-border-subtle">
              <div className="flex items-center justify-between px-5 py-4">
                <h2 className="text-[15px] font-medium">シェア機能</h2>
                <button
                  onClick={() => setShowGate(false)}
                  className="text-muted-foreground hover:text-foreground"
                  aria-label="閉じる"
                >
                  <CloseIcon size={20} />
                </button>
              </div>
              <div className="px-5 pb-4">
                <p className="text-[13px] text-foreground leading-relaxed">
                  シェア機能はX連携済みのユーザーのみご利用いただけます。
                  <br />
                  アカウント設定からX連携すると、シェア機能が解放されます。
                </p>
              </div>
              <div className="px-5 pb-5 space-y-2">
                <Link
                  href="/account"
                  className="w-full bg-primary text-primary-foreground rounded-[10px] px-4 py-3 text-[14px] font-medium hover:bg-primary/90 flex items-center justify-center gap-2"
                >
                  アカウント設定へ
                </Link>
                <button
                  onClick={() => setShowGate(false)}
                  className="w-full bg-transparent text-muted-foreground rounded-[10px] px-4 py-3 text-[13px] font-medium hover:text-foreground"
                >
                  閉じる
                </button>
              </div>
            </div>
          </div>
        )}
      </>
    );
  }

  return (
    <>
      <button
        onClick={() => setIsOpen(true)}
        aria-label="シェア"
        className="p-2 rounded-lg hover:bg-surface-2 transition-colors"
        title="シェア"
      >
        <Share2 size={18} className="text-muted-foreground" />
      </button>
      {isOpen && <ShareModal type={type} data={data} onClose={() => setIsOpen(false)} />}
    </>
  );
}
