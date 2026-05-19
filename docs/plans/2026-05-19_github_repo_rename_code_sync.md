# GitHub repo リネーム後のコード内 repo/package 名同期 (2026-05-19)

## 1. 背景

GitHub リポジトリ名を `sharunu/duepure-tracker` → `sharunu/tierlog` にリネーム済み。ローカル `origin` も `https://github.com/sharunu/tierlog.git` に更新済み。

この時点ではコードベース側の package 名・GitHub URL 参照・ドキュメント表記がまだ `duepure-tracker` のまま残っている。今回は **GitHub repo 名に紐づく文字列のみ** を `tierlog` に揃える。

過去 plan (`docs/plans/2026-05-19_tierlog_rebrand.md`) では「Q3: GitHub リポジトリ名は変更しない」としていたが、その後方針転換して repo 名変更が完了したため、本 plan で残った同期作業を行う。

## 2. 目的 / スコープ

- repo 名に紐づく純粋なメタデータ (package.json / package-lock.json / supabase/config.toml の project_id) と、コード内の repo URL 参照、構造ガイドの repo 表記を `tierlog` に統一する
- **Cloudflare Worker 名 / dev preview URL / ローカルパス** は維持 (Worker 名変更は KV/D1/環境変数バインディング破壊、dev URL は OAuth redirect 登録済、ローカルパスはユーザーのファイルシステム上の実体名)
- 過去レポート / 過去 plan 内の `duepure-tracker` 表記は **履歴ドキュメント** として保全 (修正しない)

非スコープ:
- Cloudflare Worker 名のリネーム
- dev preview URL (`dev-duepure-tracker.jianrenzhongtian7.workers.dev`) のリネーム
- ローカルディレクトリパス `~/Desktop/GitHub/duepure-tracker` のリネーム
- Supabase remote project 名 (`duepure-tracker` / `duepure-tracker-staging`) のリネーム
- 過去レポート (`docs/reports/*.md`) / 過去 plan (`docs/plans/*.md`) 内の表記修正

## 3. 確定方針 (ユーザー指示)

| # | 項目 | 方針 |
|---|------|------|
| 1 | `package.json` の `name` | `duepure-tracker` → `tierlog` |
| 2 | `package-lock.json` の root `name` (2 箇所) | `duepure-tracker` → `tierlog` |
| 3 | `src/lib/pokepoke/limitless-sync.ts` の GitHub URL | `https://github.com/sharunu/duepure-tracker` → `https://github.com/sharunu/tierlog` |
| 4 | `docs/app-structure-overview.html` の repo 表記 | `duepure-tracker` → `tierlog` (dev URL `dev-duepure-tracker.jianrenzhongtian7.workers.dev` は維持) |
| 5 | `supabase/config.toml` の `project_id` | `duepure-tracker` → `tierlog` (ローカル CLI 識別名) |
| 6 | `wrangler.jsonc` の `name` | **維持** (Cloudflare Worker 名) |
| 7 | dev preview URL `dev-duepure-tracker...` | **維持** |
| 8 | ローカルパス `~/Desktop/GitHub/duepure-tracker` | **維持** |
| 9 | `AGENTS.md` / `CLAUDE.md` の GitHub repo 関連表記 | 該当箇所があれば修正 → **調査結果: 該当なし**。両ファイル内に出現する `duepure-tracker` は Worker 名 / dev URL / ローカルパスのみで、いずれも維持対象 |
| 10 | コミット手法 | `git add .` 禁止、対象ファイルを明示して stage |
| 11 | 検証 | 実装後 `rg` で `duepure-tracker` 残存を確認し、意図的に残すものを報告 |
| 12 | push 先 | `dev` ブランチ |

## 4. 変更対象ファイル詳細

### 4.1 `package.json`

- **L2**: `"name": "duepure-tracker",` → `"name": "tierlog",`

影響: npm の package 識別名。`private: true` のため npm registry へは publish されない。`npm install` / Cloudflare Workers Builds の build には影響しない (name フィールドは識別目的のみ)。

### 4.2 `package-lock.json`

- **L2**: `"name": "duepure-tracker",` → `"name": "tierlog",`
- **L8**: `"name": "duepure-tracker",` (`packages[""]` の name) → `"name": "tierlog",`

影響: lockfile の root project 識別名。dependency tree (`node_modules/*`) には影響しない。lockfileVersion 3 では name 変更後に `npm install` を再実行しても hash 差分は出ない (検証はビルド時間節約のため `npm install` 走行はしない方針)。

### 4.3 `src/lib/pokepoke/limitless-sync.ts`

- **L25**: 
  ```ts
  const USER_AGENT = "tierlog/0.1 (+https://github.com/sharunu/duepure-tracker)";
  ```
  → 
  ```ts
  const USER_AGENT = "tierlog/0.1 (+https://github.com/sharunu/tierlog)";
  ```

影響: LimitlessTCG への HTTP リクエスト時の `User-Agent` ヘッダ。LimitlessTCG 側で URL を踏まれた時のリンク切れ防止が目的。`tierlog/0.1` の product 名部分は既に旧 plan で更新済み (重複作業しない)。

### 4.4 `docs/app-structure-overview.html`

repo 表記 3 箇所のみ変更。dev URL は維持。

- **L299**: 
  ```html
  <div class="meta">対象リポジトリ: <code>duepure-tracker</code> ／ 作成日: 2026-05-11</div>
  ```
  → 
  ```html
  <div class="meta">対象リポジトリ: <code>tierlog</code> ／ 作成日: 2026-05-11</div>
  ```

- **L454** (ディレクトリツリー root):
  ```html
  <span class="dir">duepure-tracker/</span>
  ```
  → 
  ```html
  <span class="dir">tierlog/</span>
  ```

- **L947** (フッタ):
  ```html
  duepure-tracker / アプリ構造ガイド — 一般公開前の理解用ドキュメント<br>
  ```
  → 
  ```html
  tierlog / アプリ構造ガイド — 一般公開前の理解用ドキュメント<br>
  ```

維持箇所 (修正しない):
- **L430**: `<td><code>dev-duepure-tracker.jianrenzhongtian7.workers.dev</code></td>` — dev URL
- **L792**: `<div class="desc"><code>dev-duepure-tracker.jianrenzhongtian7.workers.dev</code></div>` — dev URL

### 4.5 `supabase/config.toml`

- **L5**: 
  ```toml
  project_id = "duepure-tracker"
  ```
  → 
  ```toml
  project_id = "tierlog"
  ```

影響: ローカル `supabase` CLI が複数 project を区別するためのキー。**リモート Supabase project (production: `asjqtqxvwipqmtpcatvz` / staging: `uqndrkaxmbfjuiociuns`) のプロジェクト名やリンク状態には影響しない**。`supabase link --project-ref` で実体は ref 経由でリンクされている。

`supabase` CLI を `--project-ref` なしで叩いた場合に `.supabase/` 配下の local state を識別するために使う。今回 ref は変えないので機能影響ゼロ。

### 4.6 `AGENTS.md` / `CLAUDE.md`

**両ファイルとも GitHub repo 名関連の修正対象なし** (調査結果)。

両ファイル内の `duepure-tracker` 出現箇所:
- `https://dev-duepure-tracker.jianrenzhongtian7.workers.dev` (dev URL) → 維持
- `~/Desktop/GitHub/duepure-tracker` (ローカルパス) → 維持
- `Workers & Pages → duepure-tracker → Settings` (Cloudflare Worker 名) → 維持
- `STAGING_NEXT_PUBLIC_APP_URL = https://dev-duepure-tracker.jianrenzhongtian7.workers.dev` (dev URL) → 維持

GitHub URL (`github.com/sharunu/...` 形式) は両ファイルとも出現せず。**修正なし**。

## 5. 維持対象 (rg で残存しても OK) リスト

実装後の `rg "duepure-tracker"` 結果のうち、意図的に維持するもの:

| ファイル / パス | 出現内容 | 維持理由 |
|----|----|----|
| `wrangler.jsonc:3` | `"name": "duepure-tracker"` | Cloudflare Worker 名。変更すると KV/D1/Insights/環境変数バインディングが破壊される |
| `CLAUDE.md` / `AGENTS.md` (複数箇所) | `dev-duepure-tracker.jianrenzhongtian7.workers.dev` | dev preview URL、OAuth redirect 登録済 |
| `CLAUDE.md` / `AGENTS.md` (複数箇所) | `~/Desktop/GitHub/duepure-tracker` | ローカルパス (ファイルシステム上の実体名) |
| `CLAUDE.md` / `AGENTS.md` (line 69 等) | `Workers & Pages → duepure-tracker → Settings` | Cloudflare ダッシュボード上の Worker 名 (=維持中) |
| `docs/app-structure-overview.html:430, 792` | `dev-duepure-tracker.jianrenzhongtian7.workers.dev` | dev URL |
| `docs/reports/*.md` (全 plan/report 報告書) | `duepure-tracker` (本番 URL, repo URL, Supabase project 名等) | 履歴ドキュメント。過去の事実を残す |
| `docs/plans/*.md` (本 plan 以外) | `duepure-tracker` (本番 URL, repo URL 等) | 履歴 plan。過去の方針を残す |
| `docs/plans/2026-05-19_tierlog_rebrand.md` | `GitHub リポジトリ名 = 今回は変更しない` 等 | 過去 plan の方針記述、履歴として保全 |
| `.claude/` 配下 (worktrees / reports / 設定) | `duepure-tracker` | Claude 内部記録、過去 worktree スナップショット |
| `.codex/` 配下 (もしあれば) | `duepure-tracker` | Codex 内部記録、過去履歴 |

## 6. 実装手順

### 6.1 ブランチ確認

```bash
cd ~/Desktop/GitHub/duepure-tracker
git rev-parse --abbrev-ref HEAD
# → dev であることを確認
git status
# → 既存の M / ?? を確認 (現状: M .claude/commands/review-plan-loop.md, ?? .codex/)
```

`dev` 以外なら `git checkout dev` してから作業開始。

### 6.2 ファイル編集 (Edit ツールで 1 箇所ずつ)

1. `package.json` L2 — `"duepure-tracker"` → `"tierlog"`
2. `package-lock.json` L2 — `"duepure-tracker"` → `"tierlog"` (top-level `name`)
3. `package-lock.json` L8 — `"duepure-tracker"` → `"tierlog"` (`packages[""].name`)
4. `src/lib/pokepoke/limitless-sync.ts` L25 — `sharunu/duepure-tracker` → `sharunu/tierlog`
5. `docs/app-structure-overview.html` L299 — `<code>duepure-tracker</code>` → `<code>tierlog</code>`
6. `docs/app-structure-overview.html` L454 — `<span class="dir">duepure-tracker/</span>` → `<span class="dir">tierlog/</span>`
7. `docs/app-structure-overview.html` L947 — `duepure-tracker / アプリ構造ガイド` → `tierlog / アプリ構造ガイド`
8. `supabase/config.toml` L5 — `project_id = "duepure-tracker"` → `project_id = "tierlog"`

`package-lock.json` の L2 と L8 は同じ文字列 `"name": "duepure-tracker",` だが、L2 は top-level、L8 は `packages[""]` 配下。Edit ツールで `replace_all: true` を使うと両方一発で置換できる。文字列が他に被らないことを `rg -c '"name": "duepure-tracker"' package-lock.json` で 2 件のみと事前確認した上で `replace_all: true` を使う。**もし 3 件以上ヒットした場合は個別 Edit に切り替える**。

### 6.3 検証 (Claude 自前)

```bash
# 残存確認 — リポジトリルートから ripgrep
rg -n "duepure-tracker" --hidden -g '!.git' -g '!node_modules' -g '!.next' -g '!.open-next'
```

期待される残存:
- `wrangler.jsonc:3` (Worker 名)
- `CLAUDE.md` / `AGENTS.md` 内の dev URL / ローカルパス / Worker 名
- `docs/app-structure-overview.html:430, 792` (dev URL)
- `docs/reports/*.md` (履歴)
- `docs/plans/*.md` (本 plan のスコープ記述 + 過去 plan)
- `.claude/` / `.codex/` 配下 (内部記録)

**期待外の残存があれば追加修正**。

```bash
# lint
npm run lint
```

`src/lib/pokepoke/limitless-sync.ts` のみがコード変更対象。lint で型エラーが出ないことを確認。

### 6.4 git stage / commit / push (dev ブランチへ)

`git add .` 禁止のため対象ファイルを明示:

```bash
git add \
  package.json \
  package-lock.json \
  src/lib/pokepoke/limitless-sync.ts \
  docs/app-structure-overview.html \
  supabase/config.toml \
  docs/plans/2026-05-19_github_repo_rename_code_sync.md
```

`.claude/commands/review-plan-loop.md` (既存の M) と `.codex/` (既存の ??) は今回のスコープ外なので **stage しない**。

```bash
git diff --cached --stat
# → 上記 6 ファイル分の変更のみが対象であることを確認
```

```bash
git commit -m "chore(rebrand): repo/package 名を tierlog に同期 (Worker 名・dev URL・ローカルパスは維持)

- package.json / package-lock.json の name フィールドを tierlog に
- src/lib/pokepoke/limitless-sync.ts USER_AGENT の GitHub URL を sharunu/tierlog に
- docs/app-structure-overview.html の repo 表記 3 箇所を tierlog に (dev URL は維持)
- supabase/config.toml の project_id (ローカル CLI 識別名) を tierlog に
- 同期作業 plan を docs/plans/ に追加

GitHub repo は sharunu/tierlog にリネーム済 (origin 更新済)。
Cloudflare Worker 名 (\`duepure-tracker\`) / dev preview URL (\`dev-duepure-tracker...\`)
/ ローカルパス (\`~/Desktop/GitHub/duepure-tracker\`) / 履歴 plan/report は維持。"
```

```bash
git push origin dev
```

Cloudflare Workers Builds が `dev` ビルドをトリガ。

### 6.5 dev preview 動作確認 (ユーザー実機)

dev preview デプロイ完了後 (3〜5 分):

```bash
# Claude 自前: SSR レベルで site が反応するか
curl -sSI https://dev-duepure-tracker.jianrenzhongtian7.workers.dev/ | head -5
```

ユーザー実機: `https://dev-duepure-tracker.jianrenzhongtian7.workers.dev/` でホーム画面が描画されることを確認。今回の変更はメタデータのみなので、UI 表示への影響はない (ビルド成功と SSR 反応で十分)。

## 7. 完了条件

- [ ] 8 箇所すべての置換が完了
- [ ] `rg duepure-tracker` の残存箇所が §5 維持対象リストと一致
- [ ] `npm run lint` が pass
- [ ] dev ブランチへ commit + push 完了
- [ ] `.claude/commands/review-plan-loop.md` と `.codex/` は **stage されていない** (今回スコープ外)
- [ ] Cloudflare dev preview ビルドが成功
- [ ] dev preview URL でホーム画面の 200 応答を確認 (Claude 自前)

## 8. リスク / ロールバック

### リスク
- `package.json` / `package-lock.json` の `name` 変更による副作用: なし (private package のため registry 影響なし、build pipeline は name に依存しない)
- `supabase/config.toml` の `project_id` 変更による副作用: なし (リモート project は `--project-ref` で識別されるため)
- `limitless-sync.ts` の User-Agent 変更による副作用: なし (LimitlessTCG 側で User-Agent によるアクセス制御は確認されていない。新 URL `sharunu/tierlog` も GitHub 上に存在する)
- `docs/app-structure-overview.html` の表記変更: ドキュメント。機能影響なし

### ロールバック
万一 dev preview ビルドが失敗した場合:

```bash
git revert HEAD
git push origin dev
```

または Cloudflare ダッシュボード → Deployments → 旧ビルドへ Rollback (dev 環境のため、本番影響なし)。

## 9. 本番反映

本 plan は **dev ブランチへの commit + push** で完結。`main` ブランチへの merge は別作業 (ユーザーの明示的な「本番反映」指示を待つ)。

main 反映時は CLAUDE.md / `docs/runbooks/` 等の標準フロー (dev → main merge → push) で実施。
