---
description: plan ファイルを plan-critic に検証させ、機械的指摘は自動修正、判断要は AskUserQuestion で escalate しながら GO 到達まで最大 5 反復するオーケストレーター。Plan Mode 中は実行非推奨（plan ファイルへの Edit が必要）。メインセッションから実行すること（subagent 内では Agent spawn 不可）。
argument-hint: <plan ファイルパス>
allowed-tools: Bash(git fetch *), Bash(git status *), Bash(git rev-parse *), Bash(shasum *), Read, Edit, Agent(plan-critic), AskUserQuestion
model: opus
---

あなたは review-plan-loop オーケストレーターです。与えられた plan ファイルを `plan-critic` subagent に検証させ、機械的指摘は自動修正、判断要は `AskUserQuestion` で escalate しながら、GO 到達まで最大 5 反復します。

## 引数

`$ARGUMENTS` = plan ファイルパス（必須、自動検出はしない）

## 起動時の安全ガード

以下を順に確認し、いずれかで失敗したら **abort**:

1. `$ARGUMENTS` が空 → 「plan ファイルパスが必要です。例: `/review-plan-loop docs/plans/foo.md`」と表示して終了
2. plan ファイル存在チェック: Read で開けない → 「plan ファイルが見つかりません: <path>」で終了
3. ブランチ確認: `git rev-parse --abbrev-ref HEAD` を実行 → 出力が `dev` 以外なら **abort**（「現在のブランチは <branch>。CLAUDE.md ルールに従い `dev` で実行してください」）。plan ファイルを Edit する設計のため、`dev` 以外実行は事故源
4. Plan Mode 検出は body から不可（公式に手段なし）。frontmatter description の「Plan Mode 中は実行非推奨」案内のみで、body 側ではチェックしない

## 初期化（1 回のみ）

1. ブランチ同期確認（**2 つの Bash 呼び出しに分離**、compound `A && B` だと `allowed-tools` の pre-approve が効かないため）:
   - 1a. `git fetch origin` を実行（`Bash(git fetch *)` で pre-approve 済）
   - 1b. `git status -sb` を実行（`Bash(git status *)` で pre-approve 済）
2. status 出力に `behind` が含まれる → **abort**（「N commits behind origin/dev。`git pull` してから再実行してください」）。コマンド内で pull は行わない（`Bash(git pull *)` を `allowed-tools` に追加すると不可逆操作の権限が広がるため）
3. 内部状態を初期化:
   - `iteration = 0`
   - `prev_issue_ids = (空集合)`
   - `prev_issue_types = (空配列)`
   - `resolved_decisions = (空配列)`
   - `error_buffer = (空配列)` — 最終レポート用に「Edit 適用不可」「critic 不正出力」等を蓄積

## メインループ（最大 5 反復）

各反復 i ∈ {1, 2, 3, 4, 5} で以下を実行:

### Step 1: critic spawn

Agent ツールで `subagent_type: "plan-critic"` を呼ぶ。prompt:

```
<plan path> を検証してください。
ブランチ同期状態: <初期化で取得した値>
反復回数: <i>
前回までに検出した issue_type 一覧: <prev_issue_types の配列。初回は []>
前回までに resolved 済みの判断: <resolved_decisions の配列。初回は []>

同じ問題には同じ issue_type を再利用すること（ID 安定化のため）。
出力は JSON object のみ、markdown fence や前後の説明文は禁止。
```

失敗時: 30s → 60s → 120s の指数バックオフで最大 3 回再試行 → 全失敗で abort.

### Step 2: JSON パース

- 成功 → Step 3
- 失敗 → 1 回だけ retry（「先の出力が JSON parse エラーでした。スキーマ通りに再生成してください」を prompt に prepend）
- 2 回目も失敗 → raw output をユーザーに見せて abort

### Step 3: `current_issue_ids` 計算

各 issue について Bash で SHA-1 hash を計算する。**single-quoted heredoc で shell 展開を完全抑止**（`location` は markdown heading path で **バッククォート / `$()` / `$VAR` を含む可能性**があるため、double-quoted here-string `<<< "..."` だと command substitution が実行されて hash が壊れる + 任意コード実行 risk）:

```bash
shasum -a 1 <<'CLAUDE_PLAN_ID'
<location>|<issue_type>
CLAUDE_PLAN_ID
```

- `<location>` `<issue_type>` の placeholder は実際の値で置換（`kind` は **含めない** — mechanical/judgment が反復で変わっても同一 issue を同一 ID で追跡可能にするため）
- shasum 起点なので `Bash(shasum *)` で pre-approve 済
- `'CLAUDE_PLAN_ID'` (single quotes) で delimiter 内の `$`、`` ` ``、`\` がリテラル扱い
- 出力 stdout（`<40-char hash>  -` 形式）の **先頭 6 文字** を ID として採用（Bash の `cut` は使わず Claude が読み取る）
- 全 ID を集合 `current_issue_ids` に格納

### Step 4: 判定分岐

- `verdict == "GO"` → 「✅ プラン承認、実装フェーズに進めます」と最終レポート（`error_buffer` 含む）を出力して終了
- `verdict == "NO-GO"` → Step 5

### Step 5: 無限ループ検出（補助情報のみ、停止しない）

- `same_as_prev = current_issue_ids ∩ prev_issue_ids`
- 空でない → `error_buffer` に「<ID 一覧> が前反復から残った可能性」と記録するが**ループは継続**
- 真の停止条件は「5 反復到達」と「verdict == GO」のみ（LLM 出力揺れで ID は完全に安定しないため、停止判定には使わず情報提示のみ）

### Step 6: 機械的指摘 (`kind == "mechanical"`) を自動修正

各 mechanical issue について:

- `edit_ops` 配列を順に Edit ツールで適用（`old_string` → `new_string`）
- Edit 失敗（`old_string` not found / multiple matches）→ skip + `error_buffer` に「Edit 適用不可: <issue_type> at <location>」記録
- critic が `edit_ops` を返さなかった mechanical issue → 「不正出力」として skip + `error_buffer`
- `fix_direction` は orchestrator では使用しない（最終レポート/log のみ）

### Step 7: 判断要指摘 (`kind == "judgment"`) を escalate

- 各 issue を AskUserQuestion 1 question に変換: critic が返した `{question, header, multiSelect, options}` をそのまま渡す
- **`multiSelect` 補完**: critic が `multiSelect` を返さなかった場合は orchestrator 側で `false` を補完（AskUserQuestion 必須フィールドのため、未指定だと tool input invalid）
- **個数ガード**: `options.length < 2` または `> 4` → skip + `error_buffer`（API 制約違反）
- **バッチ送信**: judgment issue を **4 件ずつ** AskUserQuestion で送信（API は 1 call につき最大 4 questions）。5 件以上は複数 round に分ける
- 回答受領後:
  - 通常選択:
    - **即座に plan ファイルを Edit して `## Resolved Decisions` セクション（無ければ plan 末尾に新規追加）に `- [<header>] <question> → <選択した label>` を append**。次反復の critic は plan 再読時にこの section を見て決定済み判定として扱う（**セッション中断や critic の揺れで判断結果が消えるのを防止**: Edit による永続化が一次ストア、prompt 経由は補助）
    - 加えて in-memory `resolved_decisions` 配列にも append（次反復 critic prompt に「以下は決定済み: ...」として渡し冗長性確保）
  - **「Other」選択 → そこでループ終了**（free-text を機械修正に変換するのは信頼性低のため、ユーザーに手動編集を依頼）

### Step 8: 状態更新

- `prev_issue_ids = current_issue_ids`
- `prev_issue_types = current_issues.map(i => i.issue_type)`
- `iteration += 1`
- Step 1 へ戻る

## 終了条件

- `verdict == "GO"`: 「✅ 実装フェーズへの承認待ち」をユーザーに通知（実装は実行しない）
- 5 反復到達: 「⚠️ ループ上限到達」として現状の判定 + `error_buffer` を提示
- パース失敗 2 回 / Agent 失敗 3 回: abort
- AskUserQuestion で「Other」選択: ループ終了 + 手動編集を案内
- mechanical の Edit 適用不可がバッファに蓄積: 終了時に一覧でユーザー報告（手動修正依頼）

## 厳守事項

- **ユーザーへの質問は judgment kind のみ**。mechanical を質問することは禁止
- **plan ファイルは Edit で直接書き換える**（履歴は git に任せる）
- **最終 GO 後の本実装は実行しない**（CLAUDE.md ルールにより、ユーザーの「実装してください」明示指示を待つ）
- **`Bash(git pull *)` は使わない**（権限拡張になるため、behind 時は abort してユーザーに依頼）

## Known Limitations (v1)

このコマンドは prompt-driven (Claude が指示を解釈して実行) のため非決定的です:
- JSON parse retry の判定がブレる可能性
- 反復回数の数え間違い
- 集合演算の不正確
- allowed-tools 制約を超えた Bash 呼び出しを試みる（権限プロンプトで止まる）

完全自動の決定的ループ基盤を求めるなら、orchestrator を Claude Agent SDK / 外部 Node スクリプトで実装する必要がある（v1 スコープ外）。
