#!/bin/bash
set -euo pipefail
root=$(cd "$(dirname "$0")/.." && pwd)
fixture=$(mktemp -d '/tmp/syncfly launcher.XXXXXX')
trap 'rm -rf "$fixture"' EXIT
mkdir -p "$fixture/scripts" "$fixture/bin"
cp "$root/scripts/macos.sh" "$fixture/scripts/"
cat > "$fixture/bin/docker" <<'MOCK'
#!/bin/bash
case "$1 $2" in
  'info --format') echo linux ;;
  'volume inspect') echo /var/lib/docker/volumes/syncfly_data/_data ;;
esac
MOCK
chmod +x "$fixture/bin/docker"
# The launcher prepends common Docker paths, so use a shell function for the test.
function docker() { "$fixture/bin/docker" "$@"; }
export fixture
export -f docker
bash "$fixture/scripts/macos.sh" Start --no-browser
cp "$fixture/.env.desktop" "$fixture/original"
grep -Eq '^RELAY_INVITE_CODE=[a-f0-9]{64}$' "$fixture/.env.desktop"
grep -q '^RELAY_ALLOW_SIGNUP=false$' "$fixture/.env.desktop"
bash "$fixture/scripts/macos.sh" Start --no-browser
cmp "$fixture/original" "$fixture/.env.desktop"
[ "$(stat -f '%Lp' "$fixture/.env.desktop")" = 600 ]
echo 'macOS launcher setup, permissions, and restart passed.'
