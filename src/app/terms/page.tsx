"use client";

import { useRouter } from "next/navigation";

export default function TermsPage() {
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
        <h1 className="text-[20px] font-medium">利用規約</h1>
      </div>

      <div className="bg-surface-2 rounded-[10px] px-4 py-5 space-y-5 text-[13px] text-foreground leading-relaxed">
        <p className="text-[11px] text-muted-foreground">最終更新日: 2026年4月18日</p>

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
            本規約は、ゲーム戦績トラッカー（以下「本サービス」）の利用に関する条件を定めるものです。
            ユーザーは本サービスを利用することにより、本規約に同意したものとみなします。
          </p>
        </section>

        <section>
          <h2 className="text-[14px] font-medium text-foreground mb-2">第2条（サービス内容）</h2>
          <p>
            本サービスは、対応ゲームの対戦記録を管理・分析するための個人開発ツールです。
            公式サービスではなく、各対応ゲームの開発元・運営元とは一切関係ありません。
          </p>
        </section>

        <section>
          <h2 className="text-[14px] font-medium text-foreground mb-2">第3条（禁止事項）</h2>
          <ul className="list-disc list-inside space-y-1">
            <li>不正アクセスやサーバーに過度な負荷をかける行為</li>
            <li>他のユーザーの利用を妨害する行為</li>
            <li>虚偽の情報を登録する行為</li>
            <li>本サービスの運営を妨害する行為</li>
            <li>その他、運営者が不適切と判断する行為</li>
          </ul>
        </section>

        <section>
          <h2 className="text-[14px] font-medium text-foreground mb-2">第4条（免責事項）</h2>
          <p>
            本サービスは現状有姿で提供されます。運営者は、本サービスの正確性、完全性、有用性等について一切保証しません。
            本サービスの利用により生じた損害について、運営者は一切の責任を負いません。
          </p>
        </section>

        <section>
          <h2 className="text-[14px] font-medium text-foreground mb-2">第5条（サービスの変更・終了）</h2>
          <p>
            運営者は、事前の通知なく本サービスの内容を変更、または提供を終了することがあります。
            これによりユーザーに生じた損害について、運営者は一切の責任を負いません。
          </p>
        </section>

        <section>
          <h2 className="text-[14px] font-medium text-foreground mb-2">第6条（規約の変更）</h2>
          <p>
            運営者は、必要に応じて本規約を変更できるものとします。
            変更後の規約は、本サービス上に表示した時点で効力を生じます。
          </p>
        </section>

        <section>
          <h2 className="text-[14px] font-medium text-foreground mb-2">第7条（投稿コンテンツ）</h2>
          <p>
            ユーザーが本サービスに入力する対戦メモ等のコンテンツの権利はユーザーに帰属します。
            ただし、運営者は本サービスの提供・改善および匿名化された統計情報の作成・利用のため、
            これらを利用できるものとします。
          </p>
        </section>

        <section>
          <h2 className="text-[14px] font-medium text-foreground mb-2">第8条（未成年者の利用）</h2>
          <p>
            未成年のユーザーは、保護者の同意を得た上で本サービスを利用してください。
            13歳未満の方は本サービスを利用できません。
          </p>
        </section>

        <section>
          <h2 className="text-[14px] font-medium text-foreground mb-2">第9条（準拠法・管轄）</h2>
          <p>
            本規約の解釈および本サービスの利用に関しては、日本法を準拠法とします。
            本サービスに関する紛争については、運営者の所在地を管轄する裁判所を第一審の専属的合意管轄裁判所とします。
          </p>
        </section>
      </div>
    </div>
  );
}
