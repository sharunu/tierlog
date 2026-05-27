"use client";

type Props = {
  label?: string;
  className?: string;
};

export function LoadingSpinner({ label = "読み込み中…", className }: Props) {
  return (
    <div
      className={
        className ??
        "min-h-screen flex flex-col items-center justify-center gap-3 px-6"
      }
    >
      <div
        className="animate-spin h-6 w-6 border-2 border-primary-soft border-t-transparent rounded-full"
        aria-hidden
      />
      <p className="text-sm text-muted-foreground" aria-live="polite">
        {label}
      </p>
    </div>
  );
}
