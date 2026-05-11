"use client";

import { useRouter } from "next/navigation";

export default function PrivacyPage() {
  const router = useRouter();

  return (
    <div className="min-h-screen pb-20 px-4 pt-6 max-w-lg mx-auto">
      <div className="flex items-center gap-3 mb-5">
        <button
          onClick={() => router.back()}
          className="text-muted-foreground text-[18px]"
        >
          &lsaquo;
        </button>
        <h1 className="text-[20px] font-medium">プライバシーポリシー</h1>
      </div>

      <div className="bg-surface-2 rounded-[10px] px-4 py-5 space-y-5 text-[13px] text-foreground leading-relaxed">
        <p className="text-[11px] text-muted-foreground">最終更新日: 2026年4月18日</p>

        <section>
          <h2 className="text-[14px] font-medium text-foreground mb-2">1. 収集する情報</h2>
          <ul className="list-disc list-inside space-y-1">
            <li>メールアドレス（メールログインの場合）</li>
            <li>SNSアカウント情報（Google/X/Discordログインの場合、認証に必要な範囲のみ）</li>
            <li>ユーザー名（任意で設定）</li>
            <li>対戦記録データ（デッキ名、対戦結果、先攻/後攻など）</li>
            <li>Discordサーバー情報（Discordログイン時、所属サーバー名とメンバー情報）</li>
            <li>アクセス情報（ページ閲覧数、参照元、デバイス情報等の匿名統計）</li>
          </ul>
        </section>

        <section>
          <h2 className="text-[14px] font-medium text-foreground mb-2">2. 利用目的</h2>
          <ul className="list-disc list-inside space-y-1">
            <li>ユーザー認証およびアカウント管理</li>
            <li>対戦記録の保存・表示・分析機能の提供</li>
            <li>環境統計データの集計・表示</li>
            <li>サービスの改善・不具合の修正</li>
          </ul>
        </section>

        <section>
          <h2 className="text-[14px] font-medium text-foreground mb-2">3. 第三者提供・外部サービス利用</h2>
          <p>
            収集した個人情報を第三者に直接提供することはありません。
            対戦記録データは、匿名化された統計情報として本サービス内の環境分析に利用されます。
          </p>
          <p className="mt-2">本サービスの運用に必要な範囲で、以下の外部サービスを利用しています：</p>
          <ul className="list-disc list-inside space-y-1 mt-1">
            <li>Supabase：ユーザー認証・データベース</li>
            <li>Cloudflare Workers：アプリケーションホスティング</li>
            <li>Cloudflare Web Analytics：匿名アクセス統計（Cookieや個人情報は収集しません）</li>
          </ul>
        </section>

        <section>
          <h2 className="text-[14px] font-medium text-foreground mb-2">4. Cookie・セッション</h2>
          <p>本サービスで使用する Cookie・類似技術：</p>
          <ul className="list-disc list-inside space-y-1 mt-1">
            <li>Supabaseのセッション Cookie：ログイン状態の維持に使用</li>
          </ul>
          <p className="mt-2">
            Cloudflare Web Analytics は Cookie を使用せず、個人を特定する情報も収集しません。
            トラッキング目的の Cookie は使用していません。
          </p>
        </section>

        <section>
          <h2 className="text-[14px] font-medium text-foreground mb-2">5. データの保管</h2>
          <p>
            ユーザーデータは Supabase（海外のクラウドデータベース）に保管されます。
            アプリケーションは Cloudflare Workers（グローバルに分散したサーバー）で提供されます。
            アカウントを削除した場合、関連するすべてのデータが削除されます。
          </p>
        </section>

        <section>
          <h2 className="text-[14px] font-medium text-foreground mb-2">6. ユーザーの権利</h2>
          <p>ユーザーはいつでも以下の操作を行えます：</p>
          <ul className="list-disc list-inside space-y-1 mt-1">
            <li>登録情報・対戦データの閲覧・訂正</li>
            <li>アカウントの削除（アカウント設定画面より）</li>
            <li>登録SNS連携の解除</li>
          </ul>
        </section>

        <section>
          <h2 className="text-[14px] font-medium text-foreground mb-2">7. お問い合わせ</h2>
          <p>
            プライバシーに関するお問い合わせは、アプリ内の「ご意見・バグ報告」機能よりご連絡ください。
          </p>
        </section>
      </div>
    </div>
  );
}
