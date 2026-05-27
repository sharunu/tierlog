"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";

export function PrivacyClient() {
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
        <h1 className="text-[20px] font-medium">プライバシーポリシー</h1>
      </div>

      <div className="bg-surface-2 rounded-[10px] px-4 py-5 space-y-5 text-[13px] text-foreground leading-relaxed">
        <p className="text-[11px] text-muted-foreground">最終更新日: 2026年5月24日</p>

        <p className="text-[12px] text-muted-foreground">
          本ポリシーは、個人情報の保護に関する法律（個人情報保護法）および同ガイドラインに基づき、
          Tierlog（以下「本サービス」）における個人情報の取り扱いを定めるものです。
        </p>

        <section>
          <h2 className="text-[14px] font-medium text-foreground mb-2">1. 取得する個人情報</h2>
          <p>本サービスは、利用にあたり以下の個人情報を取得します。</p>
          <ul className="list-disc list-inside space-y-1 mt-1">
            <li>メールアドレス（メールログインの場合）</li>
            <li>SNSアカウント識別子・表示名（Google / X / Discord ログインの場合、認証に必要な範囲）</li>
            <li>ユーザー名（任意で設定）</li>
            <li>対戦記録データ（デッキ名、対戦結果、先攻 / 後攻、対戦日時、メモ等）</li>
            <li>Discord サーバー情報（Discord 連携時、所属サーバーの ID・名称・メンバー情報）</li>
            <li>Cookie・セッショントークン（ログイン状態の維持）</li>
            <li>アクセス情報（ページ閲覧数、参照元、デバイス情報等の匿名統計）</li>
          </ul>
        </section>

        <section>
          <h2 className="text-[14px] font-medium text-foreground mb-2">2. 利用目的</h2>
          <p>取得した個人情報は、以下の目的の範囲内で利用します。</p>
          <ul className="list-disc list-inside space-y-1 mt-1">
            <li>ユーザー認証およびアカウント管理</li>
            <li>対戦記録の保存・表示・分析機能の提供</li>
            <li>環境統計データ（匿名化集計）の作成・表示</li>
            <li>本サービスの改善・不具合の調査および修正</li>
            <li>不正利用の防止および利用規約違反への対応</li>
            <li>お問い合わせへの対応</li>
          </ul>
        </section>

        <section>
          <h2 className="text-[14px] font-medium text-foreground mb-2">3. 個人データの第三者提供</h2>
          <p>
            本サービスは、法令に基づく場合またはご本人の同意がある場合を除き、取得した個人データを
            第三者に提供しません。ただし、本サービスの運営に必要な範囲で、後述する外部サービスへの
            個人データの取扱いの委託および外国にある第三者への提供を行います。
          </p>
        </section>

        <section>
          <h2 className="text-[14px] font-medium text-foreground mb-2">4. 外部サービスの利用</h2>
          <p>本サービスの運営に必要な範囲で、以下の外部サービスを利用しています。</p>

          <p className="mt-3 font-medium">a. 個人データの取扱いを委託している外部サービス</p>
          <ul className="list-disc list-inside space-y-1 mt-1">
            <li><span className="font-medium">Supabase Inc.（米国）</span>：ユーザー認証およびデータベース。データは、本サービスで利用する Supabase プロジェクトの設定リージョン（Supabase Inc. が運営する米国・EU 等のデータセンターのいずれか）に保管されます。</li>
            <li><span className="font-medium">Cloudflare, Inc.（米国）</span>：アプリケーションの実行・配信（Cloudflare Workers）、および匿名アクセス統計（Cloudflare Web Analytics）。Cloudflare 公式の説明によれば、Cloudflare Web Analytics は訪問者の個人情報を収集・使用せず、Cookie・指紋・端末識別子を使用しない設計です。</li>
          </ul>
          <p className="mt-2 text-[12px] text-muted-foreground">
            委託先各社とは、各社の利用規約・プライバシーポリシー・セキュリティ仕様等に基づき、本サービスの提供に必要な範囲で個人データを適切に取り扱うよう求めています。
          </p>

          <p className="mt-3 font-medium">b. 認証プロバイダ・外部サービス連携</p>
          <ul className="list-disc list-inside space-y-1 mt-1">
            <li><span className="font-medium">Google LLC（米国）</span>：Google ログイン</li>
            <li><span className="font-medium">X Corp.（米国）</span>：X 連携および X ログイン</li>
            <li><span className="font-medium">Discord Inc.（米国）</span>：Discord ログインおよび Discord サーバー連携機能</li>
          </ul>
          <p className="mt-2 text-[12px] text-muted-foreground">
            利用者が各社のソーシャルログインまたは連携機能を有効化すると、本サービスと各社の間で認証情報・プロフィール情報等の連携が行われます。これは、本サービスと各社の間で個別の委託契約を締結しているものではなく、利用者が各社のサービス利用規約に同意した上で連携を有効化する形で実現されています。各社による個人情報の取扱いは、各社のプライバシーポリシーに従います。
          </p>
        </section>

        <section>
          <h2 className="text-[14px] font-medium text-foreground mb-2">5. 外国にある第三者への提供</h2>
          <p>
            前項のとおり、本サービスは以下の外国にある第三者（外国法人）に個人データの取扱いを委託し、
            または利用者の同意に基づき個人データの第三者提供を行っています。個人情報保護法第28条第2項
            および同法施行規則第17条第2項に基づき、以下の情報を提供します。
          </p>
          <div className="mt-2 space-y-2">
            <div>
              <p className="font-medium">提供先の所在国</p>
              <p>アメリカ合衆国（Supabase Inc. / Cloudflare, Inc. / Discord Inc. / Google LLC / X Corp.）</p>
            </div>
            <div>
              <p className="font-medium">当該国の個人情報保護制度の概要</p>
              <p>
                アメリカ合衆国は連邦レベルでの包括的個人情報保護法を有していませんが、州法（カリフォルニア州 CCPA / CPRA 等）や分野別法律により規律されています。
                APEC 越境プライバシールール（CBPR）にも参加しています。一方で、政府機関による外国情報収集に関する制度
                （FISA 等）が存在し、本人の権利行使に一定の影響を及ぼす可能性があります。詳細は個人情報保護委員会が公表する
                外国制度情報をご参照ください。
              </p>
            </div>
            <div>
              <p className="font-medium">提供先が講ずる相当措置</p>
              <p>
                各委託先は、SOC 2 / ISO 27001 等の認証取得、データ暗号化、アクセス制御、GDPR 対応等の安全管理措置を講じています。
                本サービスは委託先各社の最新のプライバシーポリシー・利用規約・セキュリティ仕様により、これらの措置が
                継続されていることを確認します。
              </p>
            </div>
          </div>
        </section>

        <section>
          <h2 className="text-[14px] font-medium text-foreground mb-2">6. Cookie・セッション</h2>
          <p>本サービスで使用する Cookie および類似技術：</p>
          <ul className="list-disc list-inside space-y-1 mt-1">
            <li>Supabase のセッション Cookie：ログイン状態の維持に使用</li>
            <li>選択中ゲーム・フォーマット等の UI 状態：localStorage に保存（個人を特定する情報は含みません）</li>
          </ul>
          <p className="mt-2">
            Cloudflare Web Analytics は Cookie を使用しません。トラッキング目的の Cookie・広告タグは使用していません。
          </p>
        </section>

        <section>
          <h2 className="text-[14px] font-medium text-foreground mb-2">7. データの保管・安全管理措置</h2>
          <p>
            個人データは前項の外部サービス上に保管されます。本サービスは以下の安全管理措置を実施します。
          </p>
          <ul className="list-disc list-inside space-y-1 mt-1">
            <li>通信は HTTPS（TLS）で暗号化</li>
            <li>Supabase の Row Level Security によるユーザー単位のアクセス制御</li>
            <li>管理者権限の最小化（admin 操作の限定）</li>
            <li>機密情報（API キー等）は Cloudflare Workers の Secret として暗号化保管し、コード・公開バンドルには含めない</li>
            <li>アカウント削除時に、ユーザー本人の個人データ（戦績・連携情報・認証情報等）を関連テーブルから削除</li>
          </ul>
        </section>

        <section>
          <h2 className="text-[14px] font-medium text-foreground mb-2">8. ユーザーの権利・自分で行える操作</h2>
          <p>ユーザーは、ログイン中のアカウント画面からいつでも以下を行えます。</p>
          <ul className="list-disc list-inside space-y-1 mt-1">
            <li>登録情報（ユーザー名等）の閲覧・訂正</li>
            <li>対戦記録の閲覧・編集・削除</li>
            <li>アカウントの削除（関連データ一括削除）</li>
            <li>SNS 連携の解除</li>
          </ul>
        </section>

        <section>
          <h2 className="text-[14px] font-medium text-foreground mb-2">9. 保有個人データの開示・訂正・利用停止等の請求</h2>
          <p>
            ユーザー本人は、本サービスが保有する個人データに関し、開示・訂正・追加・削除・利用停止・第三者提供の停止
            （以下「開示等」）を請求できます。
          </p>
          <p className="mt-2"><span className="font-medium">請求の受付方法</span></p>
          <ol className="list-decimal list-inside space-y-1 mt-1">
            <li>本ポリシー第11項に記載の窓口宛にメールで請求内容を送付してください。</li>
            <li>本人確認のため、ご登録メールアドレス・ユーザー名・対象データを特定できる情報のご提供をお願いする場合があります。法定代理人による請求の場合は、本人と代理人の関係を示す書類のご提示をお願いします。</li>
            <li>請求から原則として 2 週間以内に、開示等の可否および対応内容を回答します（個人データ量・本人確認の状況により延長する場合があります）。</li>
            <li>手数料はかかりません（ただし、開示の方法として書面の郵送をご希望の場合、実費を別途ご負担いただく場合があります）。</li>
          </ol>
          <p className="mt-2 text-[12px] text-muted-foreground">
            なお、開示等の請求が法令の要件を満たさない場合、本サービスの権利を不当に害する場合、技術上の理由により対応できない場合等は、ご要望に沿いかねることがあります。
          </p>
        </section>

        <section>
          <h2 className="text-[14px] font-medium text-foreground mb-2">10. 運営者情報・苦情の申出先</h2>
          <p>
            本サービスは個人によって運営されています。個人情報の取扱いに関する苦情・ご相談・運営者識別情報の
            開示請求は、本ポリシー第11項に記載のメール窓口宛にご連絡ください。法令に基づく必要な範囲で、ご本人に
            対し運営者の氏名・住所等を別途開示します。
          </p>
        </section>

        <section>
          <h2 className="text-[14px] font-medium text-foreground mb-2">11. お問い合わせ窓口</h2>
          <p>
            個人情報の取扱いに関するお問い合わせ・開示等の請求は、以下の窓口で受け付けます。アプリへのログインは不要です。
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
            アプリ内の「ご意見・バグ報告」機能（ログイン必須）からもご連絡いただけます。
            ログイン不要の窓口は{" "}
            <Link href="/contact" className="text-primary underline">こちらのページ</Link>
            にも案内があります。
          </p>
        </section>

        <section>
          <h2 className="text-[14px] font-medium text-foreground mb-2">12. 未成年者の利用</h2>
          <p>
            13 歳未満の方は本サービスを利用できません。13 歳以上の未成年者は、保護者の同意を得た上でご利用ください。
          </p>
        </section>

        <section>
          <h2 className="text-[14px] font-medium text-foreground mb-2">13. プライバシーポリシーの変更</h2>
          <p>
            本サービスは、必要に応じて本ポリシーを変更することがあります。変更後の内容は、本サービス上に
            表示した時点で効力を生じます。重要な変更については、可能な範囲で事前にお知らせします。
          </p>
        </section>
      </div>
    </div>
  );
}
