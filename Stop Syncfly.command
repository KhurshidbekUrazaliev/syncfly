#!/bin/bash
cd "$(dirname "$0")"
/bin/bash scripts/macos.sh Stop
status=$?
if [ "$status" -ne 0 ]; then read -r -p 'Press Return to close this window. '; fi
exit "$status"
