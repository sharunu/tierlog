import { TierlogLogo } from "@/components/brand/TierlogLogo";

export default function Loading() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-6 px-6">
      <TierlogLogo className="h-12 w-auto text-foreground" />
      <div className="flex items-center gap-3">
        <div
          className="animate-spin h-5 w-5 border-2 border-primary-soft border-t-transparent rounded-full"
          aria-hidden
        />
        <p className="text-sm text-muted-foreground" aria-live="polite">
          読み込み中…
        </p>
      </div>
    </div>
  );
}
