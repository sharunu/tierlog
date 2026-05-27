"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";

export function TermsClient() {
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
        <h1 className="text-[20px] font-medium">利用規約</h1>
      </div>

      <div className="bg-surface-2 rounded-[10px] px-4 py-5 space-y-5 text-[13px] text-foreground leading-relaxed">
        <p className="text-[11px] text-muted-foreground">最終更新日: 2026年5月24日</p>

        <section>
          <h2 className="text-[14px] font-medium text-foreground mb-2">非公式ツールについて</h2>
          <p>
            本アプリは、対応するデジタルカードゲーム（以下「対応ゲーム」）の非公式ファンツールです。
            各対応ゲームの開発元・運営元とは一切の関係がなく、公式に承認・提携されたものではありません。
            各対応ゲームの名称・関連用語は、それぞれの権利者に帰属します。
          </p>
        </section>

        <section>
          <h2 className="text-[14px] font-medium text-foreground mb-2">第1条（適用）</h2>
          <p>
            本規約は、Tierlog（以下「本サービス」）の利用に関する条件を、運営者と利用者の間で定めるものです。
            利用者は本サービスを利用することにより、本規約に同意したものとみなします。
          </p>
        </section>

        <section>
          <h2 className="text-[14px] font-medium text-foreground mb-2">第2条（サービス内容）</h2>
          <p>
            本サービスは、対応ゲームの対戦記録を管理・分析するための個人開発ツールです。公式サービスではなく、
            各対応ゲームの開発元・運営元とは一切関係ありません。本サービスは現状有姿で提供され、機能の追加・変更・
            廃止は事前の通知なく行われることがあります。
          </p>
        </section>

        <section>
          <h2 className="text-[14px] font-medium text-foreground mb-2">第3条（禁止事項）</h2>
          <p>利用者は、本サービスの利用にあたり、以下の行為をしてはなりません。</p>
          <ul className="list-disc list-inside space-y-1 mt-1">
            <li>不正アクセス、リバースエンジニアリング、サーバーに過度な負荷をかける行為</li>
            <li>他の利用者の利用を妨害する行為</li>
            <li>虚偽の情報を登録する行為、他者になりすます行為</li>
            <li>本サービスを商用目的または営利目的で利用する行為（運営者の事前の同意がある場合を除く）</li>
            <li>法令または公序良俗に反する行為</li>
            <li>本サービスの運営を妨害する行為</li>
            <li>その他、運営者が不適切と判断する行為</li>
          </ul>
        </section>

        <section>
          <h2 className="text-[14px] font-medium text-foreground mb-2">第4条（免責事項）</h2>
          <p>
            本サービスは現状有姿で提供されます。運営者は、本サービスの正確性、完全性、有用性、特定目的への適合性、
            継続的提供等について一切保証しません。本サービスの利用または利用不能により利用者に生じた損害について、
            運営者は故意または重過失がある場合を除き、一切の責任を負いません。
          </p>
        </section>

        <section>
          <h2 className="text-[14px] font-medium text-foreground mb-2">第5条（サービスの変更・終了）</h2>
          <p>
            運営者は、事前の通知なく本サービスの内容を変更し、または提供を終了することがあります。
            これにより利用者に生じた損害について、運営者は前条に定める範囲で責任を負います。
          </p>
        </section>

        <section>
          <h2 className="text-[14px] font-medium text-foreground mb-2">第6条（規約の変更）</h2>
          <p>
            運営者は、必要に応じて本規約を変更できるものとします。変更後の規約は、本サービス上に表示した時点で
            効力を生じます。重要な変更については、可能な範囲で事前にお知らせします。
          </p>
        </section>

        <section>
          <h2 className="text-[14px] font-medium text-foreground mb-2">第7条（投稿コンテンツ）</h2>
          <p>
            利用者が本サービスに入力する対戦メモ・デッキ名等のコンテンツの権利は利用者に帰属します。
            ただし、運営者は本サービスの提供・改善および匿名化された統計情報の作成・利用のため、これらを
            無償・非独占的に利用できるものとします。
          </p>
        </section>

        <section>
          <h2 className="text-[14px] font-medium text-foreground mb-2">第8条（未成年者の利用）</h2>
          <p>
            13 歳未満の方は本サービスを利用できません。13 歳以上の未成年者は、保護者の同意を得た上でご利用ください。
          </p>
        </section>

        <section>
          <h2 className="text-[14px] font-medium text-foreground mb-2">第9条（個人情報の取扱い）</h2>
          <p>
            運営者は、本サービスの利用において取得する利用者の個人情報を、別途定める
            <Link href="/privacy" className="text-primary underline mx-1">プライバシーポリシー</Link>
            に従い適切に取り扱います。
          </p>
        </section>

        <section>
          <h2 className="text-[14px] font-medium text-foreground mb-2">第10条（お問い合わせ）</h2>
          <p>
            本サービスに関するお問い合わせは、以下の窓口で受け付けます。アプリへのログインは不要です。
          </p>
          <p className="mt-2">
            <a
              href="mailto:contact@tierlog.app"
              className="text-primary underline break-all"
            >
              contact@tierlog.app
            </a>
          </p>
          <p className="mt-2 text-[12px] text-muted-foreground">
            個人情報に関する開示等の請求も同じ窓口で受け付けます。詳細は
            <Link href="/privacy" className="text-primary underline mx-1">プライバシーポリシー</Link>
            をご覧ください。
          </p>
        </section>

        <section>
          <h2 className="text-[14px] font-medium text-foreground mb-2">第11条（準拠法・管轄）</h2>
          <p>
            本規約の解釈および本サービスの利用に関しては、日本法を準拠法とします。本サービスに関して
            利用者と運営者の間に生じた紛争については、東京地方裁判所を第一審の専属的合意管轄裁判所とします。
          </p>
        </section>
      </div>
    </div>
  );
}
