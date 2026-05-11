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
