# 実装報告書: 法務系ページ補強 + ログイン不要問い合わせ窓口（#1+#2）

- 報告日: 2026-05-24
- 対象 plan: `docs/plans/2026-05-24_pre_public_blocker_resolution_plan.md` §4-3
- 対象レビュー: `docs/reports/2026-05-20_pre_public_readiness_review.md` 公開ブロッカー #1 / #2
- ステータス: **main 反映完了**（一次案として運用、公開後に専門家確認予定。`contact@tierlog.app` の受信確認は Cloudflare Email Routing 設定後）
- 対象ファイル: `src/app/privacy/page.tsx` / `src/app/terms/page.tsx` / `src/app/contact/page.tsx` (新規) / `src/app/account/page.tsx` / `src/app/auth/page.tsx` / `src/components/providers/BanGuard.tsx`

---

## 1. サマリ

2026-05-20 の readiness review §4-3 で挙げられた法務系の公開ブロッカー 2 件（#1 / #2）に対応した。

- **#1**: privacy / terms の不足修正 — 開示等請求手順、外部サービス委託先と OAuth 連携の整理、外国第三者提供（個人情報保護法第28条第2項）、運営者情報・苦情申出先、管轄裁判所（東京地方裁判所）、Cloudflare Web Analytics 公式表現への寄せ
- **#2**: ログイン不要の問い合わせ窓口 — `/contact` ページを新設し、`contact@tierlog.app` を窓口として明示。privacy / terms / account / auth から導線を追加、`BanGuard` の EXCLUDED_PATHS にも追加

実装は個人情報保護委員会（PPC）の公式ガイドラインを WebFetch で確認した上で行ったが、**最終的な法的判断ではなく、公開後に専門家（弁護士等）の確認を経て改訂する想定**（plan §Resolved Decisions [専門家確認] 参照）。

---

## 2. 着手前に確定したユーザー判断（plan §Resolved Decisions）

| 論点 | 決定内容 |
|---|---|
| 問い合わせ窓口の形式 | **メール公開（`contact@tierlog.app` 新設）**。Cloudflare Email Routing で運営者 Gmail へ転送 |
| 専属的合意管轄裁判所 | **東京地方裁判所** |
| 法務文言の専門家確認 | **一次案で公開し、公開後に専門家確認**。今回は PPC ガイドラインベースで一次案を整える範囲 |

これらは `docs/plans/2026-05-24_pre_public_blocker_resolution_plan.md` §Resolved Decisions に永続化済。

---

## 3. 変更内容

### 3.1 privacy/page.tsx 全面改訂（7 → 13 section）

| 節 | 内容 | 状態 |
|---|---|---|
| 1 | 取得する個人情報 | 列挙拡充（メールアドレス・SNS識別子・対戦記録・Discord サーバー情報・Cookie・アクセス情報） |
| 2 | 利用目的 | 整理（認証 / 対戦記録機能 / 環境統計 / 改善 / 不正防止 / お問い合わせ対応） |
| 3 | 個人データの第三者提供 | 法令例外と委託の区別を明記 |
| 4 | 外部サービスの利用 | **a. 委託先**（Supabase Inc. / Cloudflare, Inc.）と **b. 認証プロバイダ・外部サービス連携**（Google LLC / X Corp. / Discord Inc.）を分離。OAuth を「委託」と断定しない |
| 5 | **外国にある第三者への提供（新設）** | 法第28条第2項・規則第17条第2項に基づき、提供先所在国（US）/ 当該国の制度（CCPA/CPRA/CBPR/FISA）/ 提供先の相当措置（SOC 2 等）を記載 |
| 6 | Cookie・セッション | Cloudflare Web Analytics の Cookie 不使用を Cloudflare 公式表現に寄せ |
| 7 | データの保管・安全管理措置 | TLS / RLS / Secret 暗号化 / アカウント削除時の伝播を明記 |
| 8 | ユーザーの権利・自分で行える操作 | 既存維持 |
| 9 | **保有個人データの開示・訂正・利用停止等の請求（新設）** | 申出先・本人確認・回答期限（2 週間）・手数料無料の明記 |
| 10 | **運営者情報・苦情の申出先（新設）** | 個人開発で住所等非開示、必要に応じ別途開示の方針 |
| 11 | お問い合わせ窓口 | `contact@tierlog.app` を mailto: で記載 |
| 12 | 未成年者の利用 | 13 歳未満不可（既存維持） |
| 13 | プライバシーポリシーの変更 | 既存維持 |

### 3.2 terms/page.tsx 修正

| 修正項目 | 内容 |
|---|---|
| 最終更新日 | 2026年5月19日 → **2026年5月24日** |
| 第3条（禁止事項） | 商用利用禁止・なりすまし禁止を追加 |
| 第4条（免責事項） | 「故意または重過失がある場合を除き」の但書追加 |
| 第9条（個人情報の取扱い、新設） | プライバシーポリシーへの参照リンク |
| **第10条（お問い合わせ、新設）** | `contact@tierlog.app` を mailto: で記載 |
| **第11条（準拠法・管轄）** | 旧「運営者の所在地を管轄する裁判所」→ **東京地方裁判所**を第一審の専属的合意管轄裁判所と明記 |

### 3.3 contact/page.tsx 新規作成

- ログイン不要のトップレベル URL（`/contact`）
- メール窓口: `contact@tierlog.app`（mailto: リンク）
- 主な受付内容: プライバシー / 開示等請求 / 不具合報告 / ご意見・ご要望 / 利用規約に関する質問
- 回答までの目安（2 週間）
- 本人確認のお願い（開示等請求時）
- アプリ内 feedback とのすみ分け（ログイン必須 vs 不要）

### 3.4 導線追加

- `src/app/account/page.tsx`: 利用規約 / プライバシーポリシーの下に「お問い合わせ」リンク追加
- `src/app/auth/page.tsx`: フッターに `/contact` リンク追加
- `src/components/providers/BanGuard.tsx`: `EXCLUDED_PATHS` に `/contact` 追加。コメントで各パスの目的を明記（ban されたユーザーも contact に到達できる必要があることを特記）

### 3.5 ユーザーレビュー反映（main 反映前の軽微修正）

main 反映前にユーザーから 5 点の指摘があり対応:

| # | 指摘 | 対応 |
|---:|---|---|
| 1 | OAuth を「委託」と断定しない | privacy §4 を a. 委託 / b. 認証プロバイダ に 2 分割 |
| 2 | 「委託先は提供以外の目的で利用しません」が OAuth まで保証して読める | 「適切な取扱いを求めています」へ弱め、OAuth は別文言で「各社のプライバシーポリシーに従う」 |
| 3 | Supabase「主に米国」が未確認情報 | 「Supabase プロジェクトの設定リージョン（米国・EU 等のデータセンターのいずれか）」に修正 |
| 4 | 「一次案であり、公開後に専門家確認」表記を public ページから外す | privacy / terms の冒頭注釈を削除。専門家確認予定は本報告書および plan §Resolved Decisions に残す |
| 5 | BanGuard コメントに `/contact` 反映 | EXCLUDED_PATHS 上部コメントと effect 内コメントの両方で `/contact` を反映 |

---

## 4. 参照した公式資料

### 4.1 個人情報保護委員会（PPC）

- 通則編: https://www.ppc.go.jp/files/pdf/241202_guidelines01.pdf
  - 3-8-1 本人の知り得る状態に置く事項（事業者氏名/名称・住所・代表者氏名、利用目的、開示等請求の手続、安全管理措置、苦情申出先）
  - 3-8-7 開示等請求の受付方法（過重な負担を課さない、本人確認の比例性）
- 外国にある第三者への提供編: https://www.ppc.go.jp/files/pdf/251212_guidelines02.pdf
  - 5-2 同意取得時の情報提供（所在国名・制度情報・相当措置）
- FAQ Q1-62（未成年者の同意年齢）/ Q9-1（本人の知り得る状態の代替方法）

### 4.2 Cloudflare 公式

- Cloudflare Web Analytics: https://developers.cloudflare.com/web-analytics/about/
  - 訪問者の個人情報を収集・使用しないと明記。Cookie・指紋・端末識別子を使用しない設計
- Cloudflare Email Routing: https://developers.cloudflare.com/email-routing/
  - 無料、Cloudflare 管理ドメインで利用可。受信専用（送信不可）、既存 MX と排他

---

## 5. 検証結果

### 5.1 Claude 自前検証（完了）

| 検証項目 | 結果 |
|---|---|
| `npx tsc --noEmit` | 0 error |
| `npm run lint` | 0 problems（errors 0 / warnings 0） |
| GitHub Actions CI（`26363966105`） | green |
| `git diff --check` | 問題なし |

### 5.2 dev preview 動作確認（ユーザー実施・完了）

- `/privacy` `/terms` `/contact` 表示確認
- privacy §4 の 2 分割表示確認
- privacy §5 冒頭の「委託または利用者の同意に基づく第三者提供」表現確認
- privacy §4 a の Supabase 設定リージョン表記確認
- privacy / terms の冒頭「一次案」表記なし確認
- `/account` / `/auth` からの `/contact` リンク動作確認

### 5.3 main 反映後の本番動作確認（ユーザー実施想定）

`https://tierlog.app/privacy` `https://tierlog.app/terms` `https://tierlog.app/contact` で同様の確認。本番ビルド完了後（3〜5 分）に実施。

---

## 6. 残作業

### 6.1 Cloudflare Email Routing 設定（ユーザー側、本報告書時点では未実施）

`contact@tierlog.app` を実際に受信可能にするため、Cloudflare Dashboard で以下を設定する必要がある（5〜10 分の dashboard 操作）:

1. Cloudflare Dashboard → `tierlog.app` zone → **Email Routing**
2. MX/TXT レコード自動追加: **Add records and enable**
3. **Routing rules** → **Custom addresses** → **Create address**
4. 入力: Custom address = `contact`、Destination = 運営者 Gmail
5. Cloudflare からの確認メール内 verify リンクで destination を verify
6. **Verified** 確認後、外部メールアドレスから `contact@tierlog.app` 宛にテストメールを送信して転送動作確認

**注意点**:
- 既存 MX レコードがあれば削除を求められる（事前確認推奨）
- 受信専用（送信不可）、返信は転送先 Gmail から
- SPF/DKIM パスしない送信元は転送拒否

### 6.2 法務文言の専門家確認（公開後）

ユーザー判断（plan §Resolved Decisions [専門家確認]）により、本一次案で公開し、公開後に弁護士等の専門家確認を経て改訂する。確認後の改訂は別 commit / 別報告書で扱う。

特に確認を依頼すべき論点:
- 開示等請求の受付方法（手数料無料・回答期限 2 週間の妥当性）
- 個人開発者の住所等非開示運用の妥当性（PPC FAQ Q9-1 ベースだが、専門家解釈の確認）
- 外国第三者提供の「相当措置」記載粒度（SOC 2 等の認証取得への言及で足りるか）
- 第4条免責事項の「故意または重過失」但書の表現
- 第11条管轄条項（東京地方裁判所）の有効性

### 6.3 他の公開ブロッカー

| # | 状態 |
|---:|---|
| #0 / #3 / #5 | 完了（本日 main 反映済） |
| **#1 / #2** | **完了（本報告書）** |
| #4 最小ユニットテスト | 未着手 |
| #6 エラートラッキング + 障害対応 runbook | 未着手（次は #6 spike から着手予定） |

---

## 7. 影響範囲

### 7.1 ランタイム挙動

- `/privacy` `/terms` のコンテンツ大幅拡充
- `/contact` ページ新設（新規 URL、ログイン不要）
- `/account` の設定リストに「お問い合わせ」項目追加
- `/auth` のフッターに `/contact` リンク追加
- `BanGuard` で `/contact` を bypass（ban ユーザーも `/contact` 到達可能）

### 7.2 既存機能への影響

- 既存の auth / アカウント削除 / アプリ内 feedback 機能には変更なし
- 既存の middleware / 認証フロー / RLS / RPC には変更なし

### 7.3 SEO / アクセシビリティ

- `/contact` は新規 URL のため、当面は外部リンク・サイトマップ未掲載。検索インデックスは Cloudflare 本番ビルド後に自動的に登録される見込み
- 各ページの `<button onClick={() => router.back()}>` には `aria-label="戻る"` を付与済

---

## 8. 関連 commit

| commit | 内容 |
|---|---|
| 94e3d0e | feat(legal): privacy/terms 補強 + contact 新設 (#1+#2 一次案) |
| 3eb7f46 | fix(legal): privacy/terms の表現を弱め、BanGuard コメント追記 (#1+#2) |
| 9e83da5 | fix(legal): BanGuard.tsx effect 内コメントに /contact を反映 (#1+#2) |
| 886ef4e | (main merge) — 3 commits を main に統合 |

---

## 9. 参考

- plan: `docs/plans/2026-05-24_pre_public_blocker_resolution_plan.md` §4-3 / §Resolved Decisions
- 元レビュー: `docs/reports/2026-05-20_pre_public_readiness_review.md` §4-3
- 直前の #0/#3/#5 完了報告書: `docs/reports/2026-05-24_lint_errors_resolution.md`
