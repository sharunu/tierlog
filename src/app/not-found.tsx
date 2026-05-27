import { HomeLink } from "@/components/layout/HomeLink";

export default function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center px-6">
      <div className="max-w-sm w-full text-center space-y-6">
        <div className="space-y-2">
          <h1 className="text-[28px] font-medium">ページが見つかりません</h1>
          <p className="text-sm text-muted-foreground">
            お探しのページは削除されたか、URLが間違っている可能性があります。
          </p>
        </div>
        <HomeLink className="inline-block rounded-[10px] px-5 py-3 text-sm font-medium bg-primary text-primary-foreground hover:opacity-90 transition-opacity" />
      </div>
    </div>
  );
}
