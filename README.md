# prepkit-lib

Curated [apm](https://github.com/microsoft/apm) presets for AI coding agents, plus one base skill that sets a project
up with them. Think of it as a pinned, reviewed list of other people's skills, grouped by stack, that one command
installs into Claude Code, Codex and the other harnesses apm supports.

## Quick start

```bash
brew install microsoft/apm/apm                                    # or: curl -sSL https://aka.ms/apm-unix | sh
apm install -g Millon15/prepkit-lib/packages/prepkit              # the prepkit skill, user scope
```

Then, in your agent, ask for a new project or a preset. The skill runs one of its scripts:

| You want | The agent runs | You get |
| --- | --- | --- |
| a new project | `scripts/new.sh my-app --preset front-ts,back-ts` | Vite React + Bun API in Docker, presets installed, first commit, a green doctor |
| presets in an existing repo | `scripts/init.sh --preset front-ts` | `apm.yml` with the preset, skills under `.claude/skills` and `.agents/skills` |
| your own library like this one | `scripts/lib-init.sh our-lib` | the same layout, rules and CI, with one example preset |

Without the skill, a preset is one line in a project's `apm.yml`:

```yaml
dependencies:
  apm:
    - Millon15/prepkit-lib/presets/front-ts#<commit sha of this repo>
```

## Presets

| Preset | Installs | Upstream |
| --- | --- | --- |
| `front-ts` | `frontend-design`, `web-design-guidelines`, `vercel-react-best-practices` | anthropics/skills, vercel-labs/agent-skills |
| `back-ts` | `codebase-design`, `domain-modeling` | mattpocock/skills |

Every dependency is pinned to a commit the curator read, with its license recorded beside it (`x-prepkit` in each
`apm.yml`, schema under `schema/`). `apm outdated` shows what moved upstream; a bump is a reviewed change here.

## What CI checks

| Check | Means |
| --- | --- |
| `ci/lint.sh` | manifests parse, every dependency carries a 40-hex sha, `x-prepkit` validates |
| `ci/licenses.sh` | every entry's license is on the allow list |
| `ci/fresh-install.sh <preset>` | a clean project installs the preset for Claude and Codex |
| `ci/export-codex-skills.sh <package>` | Claude commands in vendored packages become Codex skills |
| `ci/drift.sh` | weekly `apm outdated` report |

`AGENTS.md` carries the authoring rules; start there before adding a preset.

## License

MIT. Upstream skills keep their own licenses, recorded per entry.
