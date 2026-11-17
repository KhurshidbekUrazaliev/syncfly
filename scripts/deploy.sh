#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ "$(uname -s)" != Linux ]]; then
  echo 'Deploy on the Linux Docker host, not from a remote Docker context or this development computer.' >&2
  exit 1
fi
if [[ ! -f .env ]]; then
  echo 'First run: python3 scripts/configure-cloud.py --domain YOUR_HOSTNAME' >&2
  exit 1
fi
command -v docker >/dev/null || { echo 'Install Docker Engine and its Compose plugin first.' >&2; exit 1; }
docker compose version
docker info --format '{{.ServerVersion}}' >/dev/null
compose=(docker compose -f compose.yaml -f compose.production.yaml)
"${compose[@]}" config --quiet
# Compose validates configuration; suppress resolved output because it includes credentials.
"${compose[@]}" build
"${compose[@]}" up -d --wait --wait-timeout 180
"${compose[@]}" ps
printf '\nContainers are started. Verify HTTPS, /readyz, provider sign-in, and a small real task before inviting testers.\n'
