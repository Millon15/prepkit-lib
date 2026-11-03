# prepkit-lib

A library of apm packages: presets that list vetted third-party skills, and vendored packages of our own.
[apm](https://github.com/microsoft/apm) is the only installer. Nothing here runs on a consumer's machine except
what apm copies into their project. Other people's skills are curated here; our own plugins are authored elsewhere
and only exported into apm shape.

## Layout

| Path | What | Rule |
| --- | --- | --- |
| `presets/<name>/apm.yml` + `.apm/.gitkeep` | deps-only package | every dependency pinned `#<40-hex sha>`, one `x-prepkit.entries` row per dependency |
| `packages/<name>/apm.yml` + `.apm/skills/<skill>/` | vendored package | scripts and templates inside the skill folder |
| `schema/x-prepkit.schema.json` | the `x-prepkit` block | CI validates every manifest against it |
| `ci/*.sh` | checks, run from the repo root | exit 0 pass, 1 fail, 2 usage |
| `.claude-plugin/marketplace.json` | written by `apm pack` | committed, never edited by hand |

## Scripts

- A script belongs to the skill that runs it: `.apm/skills/<name>/scripts/<file>`, with a SKILL.md that says when to
  run it. apm copies the whole skill folder and keeps the executable bit.
- A script that answers an agent event (session start, tool call) is a hook handler: ship it in the package's hook
  bundle, never inside a skill. Hooks from dependencies need `apm approve` once on the consumer side.
- Never reference `${CLAUDE_PLUGIN_ROOT}` or a path outside the skill; Codex and OpenClaw cannot resolve them, and apm
  leaves the token literal when it copies a skill.
- A Claude command (`.apm/commands/<name>.md`) is invisible to Codex. `bash ci/export-codex-skills.sh <package-dir>`
  turns it into a self-contained Codex skill under `.apm/skills/<name>/`; commit both. CI runs the `--check` form
  over every package and fails on drift; replacing a stale generated skill locally needs the `trash` CLI.

## Adding or bumping a dependency

1. Read the upstream skill at one commit. Note its license: the repo `LICENSE`, else `package.json`, else the README.
2. Write the dependency line with `#<sha>` and its `x-prepkit.entries` row: `reviewed` is that same sha, `license` the
   SPDX id, `note` where the license was read when it was not a `LICENSE` file.
3. `conflicts` names the alternatives a consumer should not install beside it; it is advisory, CI tests combinations.
4. Run `bash ci/lint.sh`, `bash ci/licenses.sh`, `bash ci/fresh-install.sh <preset>`; bump the preset `version`.

## Pins

- apm is pinned in `.github/actions/install-apm` (0.x, weekly releases with breaking changes). Bump it on purpose, with
  a fresh-install run.
- rulesync is pinned in `package.json` and runs in CI only, for the command-to-skill export. It never writes
  `.rulesync/` into a consumer project.
- Generators used by the prepkit skill (create-vite, the Bun image) are pinned inside `new.sh`.

## Public repo

No company names, internal hostnames, ticket keys or private paths in any file or commit message.
