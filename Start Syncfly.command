#!/bin/bash
cd "$(dirname "$0")"
/bin/bash scripts/macos.sh Start
status=$?
if [ "$status" -ne 0 ]; then
  echo
  echo 'Syncfly could not start. Read the error above, then try again.'
  read -r -p 'Press Return to close this window. '
fi
exit "$status"
