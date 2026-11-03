import { cp, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dependencies, object, readManifest, parseYaml, type PinnedDependency, type RecordValue } from "./lib";

function requireApmVersion() {
  const version = Bun.spawnSync(["apm", "--version"], { stdout: "pipe", stderr: "pipe" });
  if (version.exitCode || !/\b0\.35\.0\b/.test(version.stdout.toString())) {
    throw new Error("Fresh installs require APM 0.35.0");
  }
}

function canonicalSource(source: string, defaultHost = "github.com"): string {
  const locator = source.replace(/^https?:\/\//, "").replace(/^git@([^:]+):/, "$1/")
    .replace(/\.git(?=\/|$)/, "").replace(/\/$/, "");
  return locator.split("/")[0].includes(".") ? locator : `${defaultHost}/${locator}`;
}

function lockedSource(entry: RecordValue): string | undefined {
  if (typeof entry.repo_url !== "string") return undefined;
  const path = typeof entry.virtual_path === "string" ? `/${entry.virtual_path}` : "";
  const host = typeof entry.host === "string" ? entry.host : "github.com";
  return canonicalSource(`${entry.repo_url}${path}`, host);
}

function findLockedDependency(entries: RecordValue[], dependency: PinnedDependency): RecordValue {
  const matches = entries.filter((entry) => lockedSource(entry) === canonicalSource(dependency.source)
    && entry.resolved_commit === dependency.reviewed);
  if (matches.length !== 1) throw new Error(`Expected one locked entry for ${dependency.source}#${dependency.reviewed}; found ${matches.length}`);
  return matches[0];
}

function deployedSkills(entry: RecordValue, target: string): string[] {
  if (!Array.isArray(entry.deployed_files)) throw new Error(`${entry.repo_url}: missing deployed_files ledger`);
  return entry.deployed_files.filter((file): file is string => {
    if (typeof file !== "string" || !file.startsWith(`${target}/`)) return false;
    const parts = file.split("/");
    return parts.length === 4 && parts[2] !== "." && parts[2] !== ".." && parts[2] !== ""
      && !parts[2].includes("\\") && parts[3] === "SKILL.md";
  });
}

async function installedSkillName(path: string): Promise<string> {
  const body = await readFile(path, "utf8");
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(body);
  if (!match) throw new Error(`Missing skill frontmatter: ${path}`);
  const metadata = parseYaml(match[1], path);
  if (typeof metadata.name !== "string" || !metadata.name.trim()) throw new Error(`Missing skill name: ${path}`);
  return metadata.name;
}

export async function verifyInstalledSkills(root: string, expected: PinnedDependency[]) {
  const lock = await readManifest(join(root, "apm.lock.yaml"));
  if (!Array.isArray(lock.dependencies)) throw new Error("Lockfile dependencies must be an array");
  const entries = lock.dependencies.map((entry) => object(entry, "locked dependency"));
  for (const dependency of expected) {
    const entry = findLockedDependency(entries, dependency);
    for (const target of [".claude/skills", ".agents/skills"]) {
      const paths = deployedSkills(entry, target);
      if (!paths.length) throw new Error(`${dependency.source}: no deployed SKILL.md recorded for ${target}`);
      for (const path of paths) console.log(`${path}: ${await installedSkillName(join(root, path))}`);
    }
  }
}

async function main() {
  const [preset, ...extra] = process.argv.slice(2);
  if (!preset || !/^[a-z0-9][a-z0-9-]*$/.test(preset) || extra.length) {
    console.error("Usage: ci/fresh-install.sh <preset>");
    process.exitCode = 2;
    return;
  }
  requireApmVersion();
  const source = join(process.cwd(), "presets", preset);
  const expected = dependencies(await readManifest(join(source, "apm.yml")));
  if (!expected.length) throw new Error(`Preset ${preset} has no pinned skill dependencies`);
  const root = await mkdtemp(join(tmpdir(), `prepkit-${preset}-`));
  await cp(source, join(root, "presets", preset), { recursive: true });
  console.log(`Fresh install project: ${root}`);
  const child = Bun.spawn(["apm", "install", `./presets/${preset}`, "--target", "claude,codex"], {
    cwd: root, stdout: "inherit", stderr: "inherit", stdin: "ignore",
  });
  if (await child.exited !== 0) throw new Error(`APM install failed for ${preset}; inspect ${root}`);
  await verifyInstalledSkills(root, expected);
  console.log(`fresh-install: ${preset} passed for Claude and Codex`);
}

if (import.meta.main) main().catch((error) => { console.error(String(error)); process.exitCode = 1; });
