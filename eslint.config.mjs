import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // OpenNext / Cloudflare Workers 生成物
    ".open-next/**",
    ".wrangler/**",
    // Claude Code worktrees
    ".claude/worktrees/**",
  ]),
  // `_` prefix を持つ引数は意図的な未使用（マルチゲーム対応の format-only RPC で
  // _game を API 互換のため受け取るが、callee 内では未使用、など）として許可。
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },
]);

export default eslintConfig;
