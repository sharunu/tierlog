import Link from "next/link";
import { TierlogLogo } from "@/components/brand/TierlogLogo";
import { GAMES, type GameSlug } from "@/lib/games";

type Props = {
  defaultGame: GameSlug;
};

// Plan B RD-B6 (案 i): SSR ランディング。SSR HTML に意味のあるコンテンツを出すことで
// AdSense / 検索流入向けのコンテンツ要件を満たす。ログイン済ユーザーは「アプリを開く」
// CTA から `/${defaultGame}/home` へ 1 クリックで遷移できる (BanGuard で認証チェック)。
//
// "use client" 不要 (動的処理ゼロ、純粋な SSR component)。
export function LandingHero({ defaultGame }: Props) {
  const features = [
    {
      title: "戦績を一瞬で記録",
      description:
        "デッキ・対面・先攻後攻・結果をワンタップで保存。タグやメモも残せます。",
    },
    {
      title: "環境統計を可視化",
      description:
        "勝率・対面分布・先後別・期間別の集計を自動で更新。recharts によるグラフ表示。",
    },
    {
      title: "Discord でチーム連携",
      description:
        "サーバー所属の仲間とチーム結成。メンバーの戦績を集計してメタ把握に使えます。",
    },
    {
      title: "Google / X ログイン",
      description:
        "ソーシャルログインで即スタート。アカウント管理は最小限、完全無料で利用できます。",
    },
  ];

  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border/30 bg-surface-1/40 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4">
          <TierlogLogo className="h-8 w-auto text-foreground" />
          <Link
            href={`/${defaultGame}/home`}
            className="rounded-full bg-primary px-5 py-2 text-[13px] font-medium text-primary-foreground transition hover:opacity-90"
          >
            アプリを開く
          </Link>
        </div>
      </header>

      <section className="mx-auto max-w-5xl px-4 pt-12 pb-16 sm:pt-20 sm:pb-24">
        <div className="flex flex-col items-center text-center">
          <h1 className="text-[28px] font-semibold leading-tight sm:text-[40px]">
            デュエプレ・ポケポケの
            <br className="sm:hidden" />
            対戦記録と環境分析
          </h1>
          <p className="mt-5 max-w-2xl text-[14px] leading-relaxed text-muted-foreground sm:text-[16px]">
            Tierlog は、デュエル・マスターズ プレイスとポケモンカードゲーム
            ポケットの対戦記録を保存し、勝率や環境統計を可視化する個人開発の非公式ファンツールです。
            X / Google ログインで無料で始められます。
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Link
              href={`/${defaultGame}/home`}
              className="inline-flex items-center justify-center rounded-full bg-primary px-7 py-3 text-[14px] font-semibold text-primary-foreground transition hover:opacity-90"
            >
              アプリを開く
            </Link>
            <Link
              href={`/auth?game=${defaultGame}&next=${encodeURIComponent(`/${defaultGame}/home`)}`}
              className="inline-flex items-center justify-center rounded-full border border-border px-7 py-3 text-[14px] font-semibold text-foreground transition hover:bg-surface-2"
            >
              ログイン / 新規登録
            </Link>
          </div>
        </div>
      </section>

      <section className="border-t border-border/30 bg-surface-1/30">
        <div className="mx-auto max-w-5xl px-4 py-12 sm:py-16">
          <h2 className="text-center text-[20px] font-semibold sm:text-[24px]">
            主な機能
          </h2>
          <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2">
            {features.map((f) => (
              <div
                key={f.title}
                className="rounded-2xl border border-border/40 bg-surface-2 p-5"
              >
                <h3 className="text-[15px] font-medium">{f.title}</h3>
                <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
                  {f.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="border-t border-border/30">
        <div className="mx-auto max-w-5xl px-4 py-12 sm:py-16">
          <h2 className="text-center text-[20px] font-semibold sm:text-[24px]">
            対応ゲーム
          </h2>
          <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2">
            {Object.values(GAMES).map((g) => (
              <Link
                key={g.slug}
                href={`/${g.slug}/home`}
                className="block rounded-2xl border border-border/40 bg-surface-2 p-5 transition hover:border-primary/50"
              >
                <div className="text-[12px] uppercase tracking-wider text-primary">
                  {g.shortName}
                </div>
                <div className="mt-1 text-[16px] font-medium">{g.displayName}</div>
                <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
                  {g.description}
                </p>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <footer className="border-t border-border/30 bg-surface-1/40">
        <div className="mx-auto flex max-w-5xl flex-col gap-3 px-4 py-8 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-[12px] text-muted-foreground">
            &copy; Tierlog. 非公式ファンツール。各対応ゲームの権利は各社に帰属します。
          </p>
          <nav className="flex gap-5 text-[12px] text-muted-foreground">
            <Link href="/terms" className="hover:text-foreground">
              利用規約
            </Link>
            <Link href="/privacy" className="hover:text-foreground">
              プライバシー
            </Link>
            <Link href="/contact" className="hover:text-foreground">
              お問い合わせ
            </Link>
          </nav>
        </div>
      </footer>
    </main>
  );
}
