#!/bin/bash
# Pushes server env vars from .env.local to Vercel production without echoing values.
set -e
val() { grep -E "^$1=" .env.local | head -1 | cut -d= -f2- | sed -E 's/^"(.*)"$/\1/'; }
for k in NEBIUS_API_KEY TAVILY_API_KEY; do
  v="$(val $k)"; [ -n "$v" ] || { echo "missing $k"; exit 1; }
  npx vercel env rm $k production --yes >/dev/null 2>&1 || true
  printf '%s' "$v" | npx vercel env add $k production --sensitive >/dev/null 2>&1 && echo "set $k" || { printf '%s' "$v" | npx vercel env add $k production >/dev/null 2>&1 && echo "set $k (plain)"; }
done
for kv in "DAILY_MODEL_CAP=300" "NEXT_PUBLIC_SITE_URL=https://tagout-recalls.vercel.app"; do
  k="${kv%%=*}"; v="${kv#*=}"; npx vercel env rm $k production --yes >/dev/null 2>&1 || true
  printf '%s' "$v" | npx vercel env add $k production >/dev/null 2>&1 && echo "set $k"
done
