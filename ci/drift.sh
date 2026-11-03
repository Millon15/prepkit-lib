#!/usr/bin/env bash
set -euo pipefail
if [ "$#" -ne 0 ]; then
  printf 'Usage: ci/drift.sh\n' >&2
  exit 2
fi
exec bun ci/drift.ts
