#!/usr/bin/env bash
set -euo pipefail
if [ "$#" -lt 1 ] || [ "$#" -gt 2 ]; then
  printf 'Usage: ci/export-codex-skills.sh [--check] <package-dir>\n' >&2
  exit 2
fi
exec bun ci/export-codex-skills.ts "$@"
