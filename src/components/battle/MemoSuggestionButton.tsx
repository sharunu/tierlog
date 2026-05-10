"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Trash2 } from "lucide-react";

type Props = {
  memo: string;
  isSelected: boolean;
  onSelect: (memo: string) => void;
  onDelete: (memo: string) => Promise<void>;
};

export function MemoSuggestionButton({ memo, isSelected, onSelect, onDelete }: Props) {
  const [showPopup, setShowPopup] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isLongPress = useRef(false);
  const moved = useRef(false);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const startTimer = useCallback(() => {
    isLongPress.current = false;
    moved.current = false;
    timerRef.current = setTimeout(() => {
      isLongPress.current = true;
      setShowPopup(true);
    }, 500);
  }, []);

  const handleClick = useCallback(() => {
    if (!isLongPress.current && !moved.current && !showPopup) {
      onSelect(memo);
    }
  }, [onSelect, memo, showPopup]);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    clearTimer();
    isLongPress.current = true;
    setShowPopup(true);
  }, [clearTimer]);

  const handleTouchMove = useCallback(() => {
    moved.current = true;
    clearTimer();
  }, [clearTimer]);

  useEffect(() => {
    if (!showPopup) return;
    const handleOutside = (e: MouseEvent | TouchEvent) => {
      if (
        popupRef.current && !popupRef.current.contains(e.target as Node) &&
        btnRef.current && !btnRef.current.contains(e.target as Node)
      ) {
        setShowPopup(false);
      }
    };
    document.addEventListener("mousedown", handleOutside);
    document.addEventListener("touchstart", handleOutside);
    return () => {
      document.removeEventListener("mousedown", handleOutside);
      document.removeEventListener("touchstart", handleOutside);
    };
  }, [showPopup]);

  const handleDelete = async () => {
    setDeleting(true);
    await onDelete(memo);
    setDeleting(false);
    setShowPopup(false);
  };

  return (
    <span className="relative inline-block">
      <button
        ref={btnRef}
        type="button"
        onMouseDown={startTimer}
        onMouseUp={clearTimer}
        onMouseLeave={clearTimer}
        onTouchStart={startTimer}
        onTouchEnd={clearTimer}
        onTouchMove={handleTouchMove}
        onContextMenu={handleContextMenu}
        onClick={handleClick}
        className={`px-2.5 py-1 text-[11px] rounded-md transition-all select-none ${
          isSelected
            ? "bg-primary/15 border border-primary text-foreground"
            : "bg-surface-2 border border-border-subtle text-foreground"
        }`}
      >
        {memo}
      </button>

      {showPopup && (
        <div
          ref={popupRef}
          className="absolute left-1/2 -translate-x-1/2 z-50"
          style={{ bottom: "calc(100% + 8px)", animation: "memoPopupIn 0.18s ease-out" }}
        >
          <div className="rounded-[10px] border border-destructive/40 bg-surface-2 shadow-lg flex flex-col items-center px-1 py-1.5 min-w-[56px]">
            <button
              type="button"
              onClick={handleDelete}
              disabled={deleting}
              aria-label="メモを削除"
              className={`flex flex-col items-center gap-0.5 px-3 py-1.5 transition-opacity ${
                deleting ? "opacity-50" : "opacity-100"
              }`}
            >
              <Trash2 size={18} className="text-destructive" />
              <span className="text-[10px] text-destructive font-medium">
                {deleting ? "..." : "削除"}
              </span>
            </button>
          </div>
          <div
            className="mx-auto"
            style={{
              width: 0,
              height: 0,
              borderLeft: "6px solid transparent",
              borderRight: "6px solid transparent",
              borderTop: "6px solid var(--surface-2)",
            }}
          />
          <style>{`
            @keyframes memoPopupIn {
              from { opacity: 0; transform: translateX(-50%) scale(0.8) translateY(4px); }
              to { opacity: 1; transform: translateX(-50%) scale(1) translateY(0); }
            }
          `}</style>
        </div>
      )}
    </span>
  );
}
