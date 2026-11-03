#!/usr/bin/env bash
set -euo pipefail
if [ "$#" -ne 1 ] || [[ "$1" == -* ]]; then
  printf 'Usage: ci/fresh-install.sh <preset>\n' >&2
  exit 2
fi
exec bun ci/fresh-install.ts "$1"
