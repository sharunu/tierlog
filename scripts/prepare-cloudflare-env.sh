#!/bin/sh

# Source this script before Cloudflare/OpenNext builds.
# It maps staging-specific variables to the public Next.js variables only for
# the dev branch, keeping the production branch on the default Cloudflare values.

branch="${WORKERS_CI_BRANCH:-${CF_PAGES_BRANCH:-}}"
use_staging="${DUEPURE_USE_STAGING_SUPABASE:-}"

if [ "$branch" = "dev" ] || [ "$use_staging" = "1" ]; then
  if [ -z "${STAGING_NEXT_PUBLIC_SUPABASE_URL:-}" ]; then
    echo "Missing STAGING_NEXT_PUBLIC_SUPABASE_URL for staging build" >&2
    return 1 2>/dev/null || exit 1
  fi
  if [ -z "${STAGING_NEXT_PUBLIC_SUPABASE_ANON_KEY:-}" ]; then
    echo "Missing STAGING_NEXT_PUBLIC_SUPABASE_ANON_KEY for staging build" >&2
    return 1 2>/dev/null || exit 1
  fi
  if [ -z "${STAGING_NEXT_PUBLIC_APP_URL:-}" ]; then
    echo "Missing STAGING_NEXT_PUBLIC_APP_URL for staging build" >&2
    return 1 2>/dev/null || exit 1
  fi

  export NEXT_PUBLIC_SUPABASE_URL="$STAGING_NEXT_PUBLIC_SUPABASE_URL"
  export NEXT_PUBLIC_SUPABASE_ANON_KEY="$STAGING_NEXT_PUBLIC_SUPABASE_ANON_KEY"
  export NEXT_PUBLIC_APP_URL="$STAGING_NEXT_PUBLIC_APP_URL"
  export NEXT_PUBLIC_SUPABASE_ENV="staging"

  echo "Using staging Supabase variables for branch: ${branch:-manual}"
else
  echo "Using default Supabase variables for branch: ${branch:-local}"
fi

# Plan E / E-6: build marker (git SHA) を NEXT_PUBLIC_BUILD_SHA として build 時 inline する。
# Cloudflare Workers Builds は WORKERS_CI_COMMIT_SHA に full 40 桁 SHA1 を注入する
# (公式 docs: developers.cloudflare.com/workers/ci-cd/builds/configuration/)。
# local fallback は git rev-parse HEAD、git が無ければ unknown。
# 先頭 12 桁に統一 (Cloudflare も local も常に 12 桁) し、git rev-parse --short=12 と突合できるようにする。
# branch 分岐の外で常に export し、staging / production どちらの build でも marker を出す。
# 値は非 secret な git SHA のみ (env 全体や内部設定は出さない)。
raw_sha="${WORKERS_CI_COMMIT_SHA:-$(git rev-parse HEAD 2>/dev/null || echo unknown)}"
export NEXT_PUBLIC_BUILD_SHA="$(printf '%s' "$raw_sha" | cut -c1-12)"
echo "Build marker NEXT_PUBLIC_BUILD_SHA=${NEXT_PUBLIC_BUILD_SHA}"
