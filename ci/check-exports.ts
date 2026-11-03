import { readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { exportCommands } from "./export-codex-skills";

async function main() {
  const packages = await readdir("packages", { withFileTypes: true });
  for (const entry of packages.filter((entry) => entry.isDirectory())) {
    await exportCommands(resolve("packages", entry.name), process.cwd(), { check: true });
  }
}

main().catch((error) => { console.error(String(error)); process.exitCode = 1; });
