"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";

export default function ContactPage() {
  const router = useRouter();

  return (
    <div className="min-h-screen pb-20 px-4 pt-6 max-w-lg mx-auto">
      <div className="flex items-center gap-3 mb-5">
        <button
          onClick={() => router.back()}
          className="text-muted-foreground text-[18px]"
          aria-label="戻る"
        >
          &lsaquo;
        </button>
        <h1 className="text-[20px] font-medium">お問い合わせ</h1>
      </div>

      <div className="bg-surface-2 rounded-[10px] px-4 py-5 space-y-5 text-[13px] text-foreground leading-relaxed">
        <p className="text-[12px] text-muted-foreground">
          Tierlog（以下「本サービス」）に関するお問い合わせ窓口です。アプリへのログインは不要です。
          メールで以下のアドレス宛にご連絡ください。
        </p>

        <section>
          <h2 className="text-[14px] font-medium text-foreground mb-2">メール窓口</h2>
          <p>
            <a
              href="mailto:contact@tierlog.app"
              className="text-primary underline break-all text-[15px] font-medium"
            >
              contact@tierlog.app
            </a>
          </p>
          <p className="mt-2 text-[12px] text-muted-foreground">
            受信専用のアドレスです。お送りいただいたメールは運営者の受信箱へ転送され、別のアドレスから返信される場合があります。
          </p>
        </section>

        <section>
          <h2 className="text-[14px] font-medium text-foreground mb-2">主な受付内容</h2>
          <ul className="list-disc list-inside space-y-1">
            <li>個人情報の取扱いに関するお問い合わせ（プライバシー）</li>
            <li>保有個人データの開示・訂正・利用停止等の請求</li>
            <li>不具合・障害のご報告</li>
            <li>ご意見・ご要望</li>
            <li>利用規約に関するご質問</li>
            <li>その他、本サービスに関する一般的なお問い合わせ</li>
          </ul>
        </section>

        <section>
          <h2 className="text-[14px] font-medium text-foreground mb-2">回答までの目安</h2>
          <p>
            原則として 2 週間以内に回答します。お問い合わせ内容、個人情報の取扱い量、本人確認の状況等により、回答までに
            お時間をいただく場合があります。
          </p>
        </section>

        <section>
          <h2 className="text-[14px] font-medium text-foreground mb-2">本人確認のお願い</h2>
          <p>
            保有個人データの開示等の請求の場合、本人確認のため、ご登録メールアドレス・ユーザー名・対象データを特定できる情報の
            ご提供をお願いする場合があります。法定代理人による請求の場合は、本人と代理人の関係を示す書類のご提示をお願いします。
            詳細は
            <Link href="/privacy" className="text-primary underline mx-1">プライバシーポリシー</Link>
            「9. 保有個人データの開示・訂正・利用停止等の請求」をご覧ください。
          </p>
        </section>

        <section>
          <h2 className="text-[14px] font-medium text-foreground mb-2">アプリ内からのご連絡</h2>
          <p>
            ログイン済みのユーザーは、アプリ内の「ご意見・バグ報告」機能からもご連絡いただけます。本ページは
            ログイン不要の窓口として、ゲスト・退会済みの方・未登録の方にもご利用いただけます。
          </p>
        </section>

        <section>
          <h2 className="text-[14px] font-medium text-foreground mb-2">関連ページ</h2>
          <ul className="list-disc list-inside space-y-1">
            <li>
              <Link href="/privacy" className="text-primary underline">プライバシーポリシー</Link>
            </li>
            <li>
              <Link href="/terms" className="text-primary underline">利用規約</Link>
            </li>
          </ul>
        </section>
      </div>
    </div>
  );
}
