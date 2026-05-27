import type { Metadata } from "next";
import { ContactClient } from "./ContactClient";

export const metadata: Metadata = {
  title: "お問い合わせ | Tierlog",
  description:
    "Tierlog のお問い合わせ窓口。アプリへのログイン不要でメールで連絡いただけます。個人情報の取扱い・開示等の請求、不具合報告、ご意見・ご要望を受け付けます。",
  alternates: { canonical: "/contact" },
  openGraph: {
    title: "お問い合わせ | Tierlog",
    description:
      "Tierlog のお問い合わせ窓口。アプリへのログイン不要でメールで連絡いただけます。",
    type: "article",
    locale: "ja_JP",
  },
};

export default function ContactPage() {
  return <ContactClient />;
}
