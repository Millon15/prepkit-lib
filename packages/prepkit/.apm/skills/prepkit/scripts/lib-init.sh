#!/usr/bin/env bash
# prepkit lib-init: seed a project's own apm package library in the prepkit-lib shape.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEMPLATES="$SCRIPT_DIR/../templates/lib"
# shellcheck source=lib.sh
. "$SCRIPT_DIR/lib.sh"

usage() {
  cat >&2 <<'EOF'
usage: lib-init.sh <dir> [--name NAME] [--owner OWNER]
EOF
  exit 2
}

main() {
  parse_args "$@"
  need git
  refuse_occupied_dir "$DIR"
  fetch_lib
  copy_shared_files
  render_lib_files
  init_git
  install_ci_deps
  smoke_test
  report
}

parse_args() {
  DIR=""
  NAME=""
  OWNER=""
  while [ $# -gt 0 ]; do
    case "$1" in
    --name)
      NAME="${2:?--name needs a value}"
      shift 2
      ;;
    --owner)
      OWNER="${2:?--owner needs a value}"
      shift 2
      ;;
    -*) usage ;;
    *)
      [ -z "$DIR" ] || usage
      DIR="$1"
      shift
      ;;
    esac
  done
  [ -n "$DIR" ] || usage
  [ -n "$NAME" ] || NAME="$(basename "$DIR")"
  [ -n "$OWNER" ] || OWNER="$(gh api user -q .login 2>/dev/null || true)"
  [ -n "$OWNER" ] || die "--owner <github-login> is required (gh could not tell me yours)" 2
  [[ "$OWNER" =~ ^[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?$ ]] || die "--owner must be a GitHub login (letters, digits, hyphens), got: $OWNER" 2
}

fetch_lib() {
  if [ -n "$PREPKIT_LIB_DIR" ]; then
    LIB="$PREPKIT_LIB_DIR"
    log "library source: $LIB (local)"
    return
  fi
  local ref
  ref="$(resolve_lib_ref)"
  LIB="$(mktemp -d "${TMPDIR:-/tmp}/prepkit-lib.XXXXXX")"
  log "library source: $PREPKIT_LIB_REPO@${ref:0:8}"
  git -C "$LIB" init -q
  git -C "$LIB" fetch -q --depth 1 "https://github.com/$PREPKIT_LIB_REPO" "$ref"
  git -C "$LIB" checkout -q FETCH_HEAD
}

copy_shared_files() {
  mkdir -p "$DIR"
  DIR="$(cd "$DIR" && pwd)"
  local item
  for item in ci schema .github .gitignore .editorconfig package.json bun.lock; do
    [ -e "$LIB/$item" ] || continue
    cp -R "$LIB/$item" "$DIR/$item"
  done
}

render_lib_files() {
  mkdir -p "$DIR/presets/example/.apm" "$DIR/packages"
  touch "$DIR/presets/example/.apm/.gitkeep"
  sed -e "s|prepkit-lib|$NAME|g" -e "s|Millon15|$OWNER|g" "$LIB/AGENTS.md" >"$DIR/AGENTS.md"
  render "$TEMPLATES/apm.yml" "$DIR/apm.yml"
  render "$TEMPLATES/README.md" "$DIR/README.md"
  render "$TEMPLATES/presets/example/apm.yml" "$DIR/presets/example/apm.yml"
}

init_git() {
  git -C "$DIR" init -q -b master
}

install_ci_deps() {
  [ -f "$DIR/package.json" ] || return 0
  command -v bun >/dev/null 2>&1 || {
    log "bun not found; run 'bun install' in $DIR before ci/"
    return 0
  }
  log "ci deps: bun install"
  (cd "$DIR" && bun install --frozen-lockfile >/dev/null)
}

smoke_test() {
  [ -f "$DIR/ci/lint.sh" ] || {
    log "ci/lint.sh not in the library copy; smoke test skipped"
    return 0
  }
  log "smoke: ci/lint.sh in $DIR"
  (cd "$DIR" && bash ci/lint.sh) || die "the new library fails its own ci/lint.sh; see the output above"
}

report() {
  cat <<EOF

prepkit: library $NAME seeded in $DIR
  AGENTS.md          authoring rules (scripts inside skills, pinned shas, x-prepkit rows)
  presets/example    one preset to copy; delete it once you have a real one
  packages/          your vendored packages, each with apm.yml and .apm/skills/<name>/
  ci/                checks copied from $PREPKIT_LIB_REPO; run from the repo root
  next               git add -A && git commit -m "Seed $NAME"; then add presets
EOF
}

main "$@"
