// vitest 設定。#4-b 最小ユニットテスト導入 (2026-05-25)。
//
// 方針 (plan §4-5):
// - 純関数中心。Supabase 実 DB や外部 API には接続しない (Node 環境のみ)。
// - tsconfig の `@/*` alias を resolve に設定 (Next.js と同じ参照パス)。
// - include は src/**/*.test.ts のみ (テストファイルは対象モジュールと併置)。
// - coverage 設定は後回し (最低限 lint + typecheck + test の 3 ジョブ通過を優先)。

import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "./src"),
    },
  },
});
