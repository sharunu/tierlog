import type { Metadata } from "next";
import { TermsClient } from "./TermsClient";

export const metadata: Metadata = {
  title: "利用規約 | Tierlog",
  description:
    "Tierlog の利用規約。サービス内容、禁止事項、免責事項、未成年者の利用、お問い合わせ窓口、準拠法と管轄を定めます。",
  alternates: { canonical: "/terms" },
  openGraph: {
    title: "利用規約 | Tierlog",
    description:
      "Tierlog の利用規約。サービス内容、禁止事項、免責事項、未成年者の利用、お問い合わせ窓口、準拠法と管轄を定めます。",
    type: "article",
    locale: "ja_JP",
  },
};

export default function TermsPage() {
  return <TermsClient />;
}
