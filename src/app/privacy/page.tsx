import type { Metadata } from "next";
import { PrivacyClient } from "./PrivacyClient";

export const metadata: Metadata = {
  title: "プライバシーポリシー | Tierlog",
  description:
    "Tierlog における個人情報の取り扱い、第三者提供、外部サービス利用、Cookie、保有個人データの開示等の請求方法について定めるプライバシーポリシー。",
  alternates: { canonical: "/privacy" },
  openGraph: {
    title: "プライバシーポリシー | Tierlog",
    description:
      "Tierlog における個人情報の取り扱い、第三者提供、外部サービス利用、Cookie、保有個人データの開示等の請求方法について定めるプライバシーポリシー。",
    type: "article",
    locale: "ja_JP",
  },
};

export default function PrivacyPage() {
  return <PrivacyClient />;
}
