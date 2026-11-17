#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="/usr/local/bin:/opt/homebrew/bin:$PATH"
action="${1:-Start}"
config=".env.desktop"
read_value() {
  if [ -f "$config" ]; then sed -n "s/^$1=//p" "$config" | tail -n 1; fi
}
compose() { docker compose --env-file "$config" -f compose.desktop.yaml "$@"; }
save_config() {
  umask 077
  local temporary
  temporary=$(mktemp .env.desktop.XXXXXX)
  printf '%s\n' "RELAY_PUBLIC_URL=$public_url" "RELAY_HOST_DATA_DIR=$mountpoint" "RELAY_INVITE_CODE=$invite" "RELAY_ALLOW_SIGNUP=$signup" "RELAY_MAX_ACTIVE_TASKS=$limit" > "$temporary"
  mv "$temporary" "$config"
}
if ! command -v docker >/dev/null; then
  echo 'Install Docker Desktop for your Mac, start it, then open Start Syncfly again.' >&2
  echo 'https://docs.docker.com/desktop/setup/install/mac-install/' >&2
  exit 1
fi
if ! engine=$(docker info --format '{{.OSType}}' 2>/dev/null); then
  echo 'Docker is not running. Start Docker Desktop, wait until it is ready, then retry.' >&2
  exit 1
fi
[ "$engine" = 'linux' ] || { echo 'Syncfly needs the Linux Docker engine.' >&2; exit 1; }
public_url=$(read_value RELAY_PUBLIC_URL); public_url=${public_url:-http://localhost:4310}
invite=$(read_value RELAY_INVITE_CODE)
signup=$(read_value RELAY_ALLOW_SIGNUP); signup=${signup:-false}
limit=$(read_value RELAY_MAX_ACTIVE_TASKS); limit=${limit:-1}
mountpoint=$(read_value RELAY_HOST_DATA_DIR)
if [ "$action" = Start ]; then
  docker volume create syncfly_data >/dev/null
  mountpoint=$(docker volume inspect syncfly_data --format '{{.Mountpoint}}')
  [ -n "$invite" ] || invite=$(openssl rand -hex 32)
  save_config
  compose config --quiet
  compose --parallel 1 build
  compose up -d --wait --wait-timeout 180
  echo "Syncfly is ready at $public_url"
  if [ "${2:-}" != '--no-browser' ]; then open "$public_url/#setup=$invite"; fi
  echo 'Your browser opens with the setup code filled in. Create an account, or sign in to your existing account.'
  exit 0
fi
[ -f "$config" ] || { echo 'Open Start Syncfly first.' >&2; exit 1; }
case "$action" in
  Stop) compose --profile private stop ;;
  Status) compose --profile private ps ;;
  Logs) compose logs --tail 100 relay ;;
  Invitation) printf 'Private signup code: %s\n' "$invite" ;;
  OpenInvites|CloseInvites)
    if [ "$action" = OpenInvites ]; then signup=true; else signup=false; fi
    save_config
    compose up -d --force-recreate relay
    echo "Registration enabled: $signup"
    ;;
  *) echo 'Actions: Start, Stop, Status, Logs, Invitation, OpenInvites, CloseInvites' >&2; exit 1 ;;
esac
