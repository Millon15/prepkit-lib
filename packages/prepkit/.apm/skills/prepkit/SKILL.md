---
name: prepkit
description: Set up an agent-ready TypeScript project with apm presets from prepkit-lib. Use when asked to scaffold a new project ("new project", "greenfield", "start a repo with frontend and backend"), to add curated skills or a preset to an existing repo ("add front-ts", "set up apm here", "install the design skills"), or to start a project's own skill library ("our own prepkit-lib", "a package library for our skills").
---

# prepkit

Three scripts under `scripts/` beside this file. Run each with `bash` by its path from this folder. They need
`git`, `bun`, `apm` (microsoft/apm 0.35.x) and, for a running stack, `docker compose`.

| Ask | Run | Result |
| --- | --- | --- |
| new project | `scripts/new.sh <dir> [--preset front-ts,back-ts] [--no-up] [--gh owner/name --visibility private\|public]` | Vite React web + Bun API in Docker, presets installed, first commit |
| presets onto an existing repo | `scripts/init.sh [--preset a,b] [--targets claude,codex] [--dry-run] [dir]` | `apm.yml` created or extended, skills deployed |
| own package library | `scripts/lib-init.sh <dir> [--name NAME] [--owner OWNER]` | prepkit-lib shape: AGENTS.md rules, schema, `ci/`, one example preset |

## Before running

- Ask which presets when the user did not say. Available: `front-ts`, `back-ts`; the library README lists what each
  installs.
- `new.sh` and `lib-init.sh` refuse a directory that exists and is not empty (exit 2). Pick another directory; never
  empty one for them.
- The GitHub step runs only with `--gh`. Ask for owner/name and visibility; never guess them.
- Generators are pinned inside `new.sh` (create-vite, the Bun image). Pass no other versions.

## After running

- `new.sh --no-up` skipped Docker: tell the user to run `docker compose up` in the directory.
- `new.sh` ends with a doctor: the web app answers, `/api/health` answers through the Vite proxy, an edit to
  `web/src/App.tsx` shows up through the dev server. A red doctor leaves the stack running; read
  `docker compose logs web api` before changing anything.
- apm deployed the skills to `.claude/skills/` and `.agents/skills/` and pinned them in `apm.lock.yaml`. Commit those
  with `apm.yml`.
- `lib-init.sh` ran the new library's own `ci/lint.sh`; a failure there is reported, not hidden.

## Environment

| Variable | Default | Use |
| --- | --- | --- |
| `PREPKIT_LIB_REPO` | `Millon15/prepkit-lib` | a fork of the library |
| `PREPKIT_LIB_REF` | HEAD of that repo | pin the presets to one library commit |
| `PREPKIT_LIB_DIR` | unset | a local checkout; presets and `ci/` come from it instead of GitHub |
| `PREPKIT_WEB_PORT` | `5173` | host port for the web container |
