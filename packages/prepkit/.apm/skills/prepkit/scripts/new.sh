#!/usr/bin/env bash
# prepkit new: a dockerized Vite + Bun TypeScript project with prepkit presets installed.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEMPLATES="$SCRIPT_DIR/../templates/project"
# shellcheck source=lib.sh
. "$SCRIPT_DIR/lib.sh"

CREATE_VITE_VERSION=9.3.3
# shellcheck disable=SC2034  # read by render() in lib.sh
BUN_VERSION=1.4.2

usage() {
  cat >&2 <<'EOF'
usage: new.sh <dir> [--preset a,b] [--targets claude,codex] [--no-up]
              [--gh owner/name] [--visibility private|public]
EOF
  exit 2
}

main() {
  parse_args "$@"
  check_tools
  refuse_occupied_dir "$DIR"
  scaffold_dir
  scaffold_web
  scaffold_api
  scaffold_root
  install_presets
  install_deps
  commit_initial
  start_stack
  create_github_repo
  report
}

parse_args() {
  DIR=""
  PRESETS="front-ts,back-ts"
  TARGETS="claude,codex"
  UP=1
  GH_REPO=""
  VISIBILITY="private"
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
    --gh)
      GH_REPO="${2:?--gh needs owner/name}"
      shift 2
      ;;
    --visibility)
      VISIBILITY="${2:?--visibility needs private|public}"
      shift 2
      ;;
    --no-up)
      UP=0
      shift
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
  case "$VISIBILITY" in private | public) ;; *) usage ;; esac
  NAME="$(basename "$DIR")"
  WEB_PORT="${PREPKIT_WEB_PORT:-5173}"
}

check_tools() {
  need git bun bunx apm curl
  [ "$UP" = 0 ] || need docker
  [ "$UP" = 0 ] || docker compose version >/dev/null 2>&1 || die "docker compose is not available"
  [ -z "$GH_REPO" ] || need gh
}

scaffold_dir() {
  mkdir -p "$DIR"
  DIR="$(cd "$DIR" && pwd)"
  git -C "$DIR" init -q -b main
}

scaffold_web() {
  log "web: create-vite@$CREATE_VITE_VERSION react-ts"
  (cd "$DIR" && bunx --bun "create-vite@$CREATE_VITE_VERSION" web --template react-ts --no-interactive --no-immediate >/dev/null)
  cp "$TEMPLATES/web/vite.config.ts" "$DIR/web/vite.config.ts"
}

scaffold_api() {
  log "api: Bun server"
  mkdir -p "$DIR/api/src"
  cp "$TEMPLATES/api/package.json" "$DIR/api/package.json"
  cp "$TEMPLATES/api/tsconfig.json" "$DIR/api/tsconfig.json"
  cp "$TEMPLATES/api/src/index.ts" "$DIR/api/src/index.ts"
}

scaffold_root() {
  log "root: workspaces, compose"
  render "$TEMPLATES/package.json" "$DIR/package.json"
  render "$TEMPLATES/compose.yml" "$DIR/compose.yml"
  render "$TEMPLATES/README.md" "$DIR/README.md"
  render "$TEMPLATES/_gitignore" "$DIR/.gitignore"
  render "$TEMPLATES/_dockerignore" "$DIR/.dockerignore"
}

install_presets() {
  local ref
  ref="$(resolve_lib_ref)"
  log "apm: presets $PRESETS from $(lib_label "$ref")"
  write_apm_manifest "$ref"
  (cd "$DIR" && apm install)
}

write_apm_manifest() {
  local ref="$1" preset
  {
    printf 'name: %s\nversion: 0.1.0\ntargets:\n' "$NAME"
    split_csv "$TARGETS" | sed 's/^/  - /'
    printf 'dependencies:\n  apm:\n'
    for preset in $(split_csv "$PRESETS"); do
      printf '    - %s\n' "$(preset_source "$preset" "$ref")"
    done
  } >"$DIR/apm.yml"
}

install_deps() {
  [ "$UP" = 1 ] || return 0
  log "docker: bun install in the deps container (writes bun.lock)"
  (cd "$DIR" && docker compose run --rm deps bun install >/dev/null)
}

commit_initial() {
  git -C "$DIR" add -A
  git -C "$DIR" commit -q -m "Scaffold with prepkit (presets: $PRESETS)"
}

start_stack() {
  [ "$UP" = 1 ] || {
    log "docker: skipped (--no-up); run 'docker compose up' in $DIR"
    return 0
  }
  log "docker: compose up"
  (cd "$DIR" && docker compose up -d --wait)
  doctor
}

doctor() {
  local base="http://127.0.0.1:$WEB_PORT"
  wait_for_http "$base/" 90 || doctor_fail "web did not answer on $base within 90s"
  check_http "$base/" "web answers"
  check_http "$base/api/health" "api answers through the vite proxy"
  check_edit_visible "$base"
  log "doctor: all green"
}

wait_for_http() { # <url> <seconds>
  local i=0
  until curl -fsS -o /dev/null "$1"; do
    i=$((i + 1))
    [ "$i" -lt "$2" ] || return 1
    sleep 1
  done
}

check_http() { # <url> <label>
  curl -fsS -o /dev/null "$1" || doctor_fail "$2 ($1)"
  log "doctor: ok  $2"
}

check_edit_visible() { # <base url>
  local file="$DIR/web/src/App.tsx" marker kept
  marker="prepkit_doctor_$(date +%s)"
  printf '\nexport const %s = true\n' "$marker" >>"$file"
  sleep 3
  if curl -fsS "$1/src/App.tsx" | grep -q "$marker"; then
    log "doctor: ok  the dev server serves a fresh edit (live source refresh; browser HMR not checked)"
  else
    doctor_fail "the dev server did not serve a fresh edit (bind mount or file watcher)"
  fi
  kept="$(grep -v "$marker" "$file")"
  printf '%s\n' "$kept" >"$file"
}

doctor_fail() {
  die "doctor: $1. The stack stays up; inspect with: docker compose -f $DIR/compose.yml logs web api"
}

create_github_repo() {
  [ -n "$GH_REPO" ] || return 0
  log "github: $GH_REPO ($VISIBILITY)"
  gh repo create "$GH_REPO" "--$VISIBILITY" --source "$DIR" --remote origin --push
}

report() {
  cat <<EOF

prepkit: $DIR is ready
  presets   $PRESETS (apm.yml, apm.lock.yaml, .claude/skills, .agents/skills)
  web       http://127.0.0.1:$WEB_PORT  (Vite, React, TypeScript)
  api       http://127.0.0.1:$WEB_PORT/api/health  (Bun, proxied)
  run       docker compose up        stop: docker compose down
  skills    apm install              (after editing apm.yml)
EOF
}

main "$@"
