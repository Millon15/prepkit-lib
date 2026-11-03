# __NAME__

Vite React frontend (`web/`) and Bun API (`api/`), both run in Docker. Scaffolded by prepkit.

```bash
docker compose up          # deps installs once, then web on http://127.0.0.1:__WEB_PORT__ and api behind /api
docker compose down
```

| Path | What |
| --- | --- |
| `web/` | Vite + React + TypeScript; `vite.config.ts` proxies `/api` to the api container |
| `api/` | Bun server on port 3000; `/api/health` |
| `compose.yml` | `deps` is the only installer; `web` and `api` start after it |
| `apm.yml` | agent skills from prepkit presets; `apm install` after editing it |

Dependencies live in named volumes, one per workspace. Add a package with `docker compose run --rm deps bun add
<pkg> --cwd web` (or `--cwd api`), then restart the service.
