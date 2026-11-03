#!/usr/bin/env bash
# Shared helpers for the prepkit scripts. Sourced, never run.

PREPKIT_LIB_REPO="${PREPKIT_LIB_REPO:-Millon15/prepkit-lib}"
PREPKIT_LIB_DIR="${PREPKIT_LIB_DIR:-}"

log() { printf '[prepkit] %s\n' "$*" >&2; }

die() {
  printf '[prepkit] error: %s\n' "$1" >&2
  exit "${2:-1}"
}

need() {
  local tool
  for tool in "$@"; do
    command -v "$tool" >/dev/null 2>&1 || die "missing tool: $tool"
  done
}

refuse_occupied_dir() {
  local dir="$1"
  [ -e "$dir" ] || return 0
  [ -d "$dir" ] || die "$dir exists and is not a directory" 2
  [ -z "$(ls -A "$dir")" ] || die "$dir is not empty; prepkit only works in a new or empty directory" 2
}

resolve_lib_ref() {
  if [ -n "${PREPKIT_LIB_REF:-}" ]; then
    printf '%s' "$PREPKIT_LIB_REF"
    return
  fi
  git ls-remote "https://github.com/$PREPKIT_LIB_REPO" HEAD | cut -f1
}

lib_label() {
  [ -z "$PREPKIT_LIB_DIR" ] || {
    printf '%s (local)' "$PREPKIT_LIB_DIR"
    return
  }
  printf '%s@%.8s' "$PREPKIT_LIB_REPO" "$1"
}

preset_source() { # <preset> <ref>
  if [ -n "$PREPKIT_LIB_DIR" ]; then
    printf '%s/presets/%s' "$PREPKIT_LIB_DIR" "$1"
    return
  fi
  printf '%s/presets/%s#%s' "$PREPKIT_LIB_REPO" "$1" "$2"
}

split_csv() { tr ',' '\n' <<<"$1" | sed '/^$/d'; }

render() { # <template> <dest>; substitutes __NAME__, __OWNER__, __BUN__, __WEB_PORT__
  sed \
    -e "s|__NAME__|${NAME:-}|g" \
    -e "s|__OWNER__|${OWNER:-}|g" \
    -e "s|__BUN__|${BUN_VERSION:-}|g" \
    -e "s|__WEB_PORT__|${WEB_PORT:-}|g" \
    "$1" >"$2"
}
