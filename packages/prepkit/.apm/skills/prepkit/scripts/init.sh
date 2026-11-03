#!/usr/bin/env bash
# prepkit init: add prepkit presets to an existing repo through apm; creates apm.yml when there is none.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
. "$SCRIPT_DIR/lib.sh"

usage() {
  cat >&2 <<'EOF'
usage: init.sh [--preset a,b] [--targets claude,codex] [--dry-run] [dir]
EOF
  exit 2
}

main() {
  parse_args "$@"
  need apm git
  [ -d "$DIR" ] || die "$DIR is not a directory" 2
  install_presets
  report
}

parse_args() {
  DIR="."
  PRESETS="front-ts,back-ts"
  TARGETS=""
  DRY_RUN=""
  while [ $# -gt 0 ]; do
    case "$1" in
    --preset)
      PRESETS="${2:?--preset needs a value}"
      shift 2
      ;;
    --targets)
      TARGETS="${2:?--targets needs a value}"
      shift 2
      ;;
    --dry-run)
      DRY_RUN="--dry-run"
      shift
      ;;
    -*) usage ;;
    *)
      DIR="$1"
      shift
      ;;
    esac
  done
}

install_presets() {
  local ref preset
  ref="$(resolve_lib_ref)"
  log "apm: presets $PRESETS from $(lib_label "$ref") into $DIR"
  for preset in $(split_csv "$PRESETS"); do
    # shellcheck disable=SC2046
    (cd "$DIR" && apm install $DRY_RUN $(target_flag) "$(preset_source "$preset" "$ref")")
  done
}

target_flag() {
  [ -z "$TARGETS" ] || {
    printf -- '--target %s' "$TARGETS"
    return
  }
  [ -f "$DIR/apm.yml" ] || printf -- '--target claude,codex'
}

report() {
  [ -z "$DRY_RUN" ] || return 0
  log "deployed skills:"
  # shellcheck disable=SC2012  # skill folder names are plain
  ls -1 "$DIR/.claude/skills" "$DIR/.agents/skills" 2>/dev/null | sed 's/^/  /' >&2 || true
  log "commit apm.yml, apm.lock.yaml and the deployed skill folders"
}

main "$@"
