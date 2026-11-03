import { cp, mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

async function reportPreset(preset: string) {
  const root = await mkdtemp(join(tmpdir(), `prepkit-drift-${preset}-`));
  await cp(join(process.cwd(), "presets", preset), join(root, "presets", preset), { recursive: true });
  console.log(`\nDrift report: ${preset} (${root})`);
  const install = Bun.spawn(["apm", "install", `./presets/${preset}`, "--target", "claude,codex"], {
    cwd: root, stdin: "ignore", stdout: "inherit", stderr: "inherit",
  });
  if (await install.exited !== 0) throw new Error(`${preset}: could not prepare locked dependencies`);
  const outdated = Bun.spawn(["apm", "outdated"], { cwd: root, stdout: "inherit", stderr: "inherit" });
  console.log(`${preset}: apm outdated exited ${await outdated.exited} (advisory)`);
}

async function main() {
  if (process.argv.length !== 2) { console.error("Usage: ci/drift.sh"); process.exitCode = 2; return; }
  const presets = await readdir("presets", { withFileTypes: true });
  for (const preset of presets.filter((entry) => entry.isDirectory())) {
    try { await reportPreset(preset.name); }
    catch (error) { console.error(`Drift check unavailable: ${String(error)}`); }
  }
}

main().catch((error) => { console.error(`Drift check unavailable: ${String(error)}`); });
