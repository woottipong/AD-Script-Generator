#!/bin/sh
# Runs browser scripts against the preview on 127.0.0.1:4173 (`docker compose --profile test up -d preview`).
# With no arguments it runs every script; a script whose /tmp fixture file is missing is skipped (README lists how to make them).
cd "$(dirname "$0")/../.." || exit 1
pw() { npx --yes --package @playwright/cli playwright-cli -s=ad-check "$@"; }
[ "$#" -gt 0 ] || set -- tests/browser/*.js
pw open http://127.0.0.1:4173/ >/dev/null || exit 1
status=0
for file in "$@"; do
  missing=$(grep -o "'/tmp/[^']*'" "$file" | tr -d "'" | while read -r fixture; do [ -e "$fixture" ] || echo "$fixture"; done)
  if [ -n "$missing" ]; then
    echo "skip $file (missing $(echo $missing))"
    continue
  fi
  output=$(pw run-code --filename "$file" 2>&1)
  if printf '%s\n' "$output" | grep -q '^### Error'; then
    echo "FAIL $file"
    printf '%s\n' "$output" | awk '/^### Error/ { show = 1; next } /^### / { show = 0 } show && NF'
    status=1
  else
    echo "ok   $file"
  fi
done
pw close >/dev/null
exit $status
