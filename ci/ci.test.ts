import { describe, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, readFile, rename, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pinnedDependency, parseYaml, validateReviewedPins } from "./lib";
import { validateLicenses } from "./validate";
import { commandSkill, exportCommands } from "./export-codex-skills";

const sha = "a".repeat(40);
const source = "example/skills/skills/review";
const manifest = { name: "fixture", version: "0.1.0", dependencies: { apm: [`${source}#${sha}`] },
  "x-prepkit": { entries: { [source]: { reviewed: sha, license: "MIT", conflicts: [] } } } };

describe("curated manifest validation", () => {
  test.each(["example/skills#main", "example/skills#abc123", "./local", { git: "example/skills" }])(
    "rejects an unpinned dependency %p", (dependency) => expect(() => pinnedDependency(dependency)).toThrow());
  test("rejects a reviewed pin different from the installed pin", () => {
    const changed = structuredClone(manifest);
    changed.dependencies.apm = [`${source}#${"b".repeat(40)}`];
    expect(() => validateReviewedPins(changed)).toThrow("Reviewed SHA");
  });
  test("rejects duplicate YAML keys", () => expect(() => parseYaml("name: one\nname: two", "fixture")).toThrow());
  test("rejects missing metadata", () => expect(() => validateReviewedPins({ ...manifest, "x-prepkit": undefined })).toThrow());
  test("accepts an allowed license and rejects an unknown license", () => {
    expect(() => validateLicenses(manifest)).not.toThrow();
    const changed = structuredClone(manifest);
    changed["x-prepkit"].entries[source].license = "Unknown";
    expect(() => validateLicenses(changed)).toThrow("unsupported license");
  });
});

describe("standalone command exports", () => {
  test("embeds the command body and retains explicit invocation", () => {
    const skill = commandSkill("review.md", "---\ndescription: Review changes\n---\nInspect the actual diff.");
    expect(skill.markdown).toContain("Inspect the actual diff.");
    expect(skill.markdown).toContain("disable-model-invocation: true");
    expect(skill.markdown).not.toContain(".rulesync/");
  });
  test("refuses unresolved plugin runtime paths", () => {
    expect(() => commandSkill("review.md", "Run ${CLAUDE_PLUGIN_ROOT}/review.sh")).toThrow("runtime paths");
  });
  test("real Rulesync output is self-contained and idempotent", async () => {
    const root = await mkdtemp(join(tmpdir(), "prepkit-command-test-"));
    await mkdir(join(root, ".apm/commands"), { recursive: true });
    await writeFile(join(root, ".apm/commands/review.md"), "---\ndescription: Review changes\n---\nInspect the actual diff.\n");
    await exportCommands(root);
    const output = join(root, ".apm/skills/review/SKILL.md");
    const first = await readFile(output, "utf8");
    expect(first).toContain("Inspect the actual diff.");
    expect(first).not.toMatch(/\.rulesync\/|\$\{CLAUDE_PLUGIN_ROOT\}/);
    await exportCommands(root);
    expect(await readFile(output, "utf8")).toBe(first);
    const policy = await readFile(join(root, ".apm/skills/review/agents/openai.yaml"), "utf8");
    expect(policy).toContain("allow_implicit_invocation: false");
  });
  test("carries a referenced executable without changing its bytes", async () => {
    const root = await mkdtemp(join(tmpdir(), "prepkit-resource-test-"));
    await mkdir(join(root, ".apm/commands/scripts"), { recursive: true });
    await writeFile(join(root, ".apm/commands/check.md"), "---\ndescription: Run checks\n---\nRun [check](scripts/check.sh).\n");
    const script = Buffer.from("#!/bin/sh\nprintf 'ok\\n'\n");
    await writeFile(join(root, ".apm/commands/scripts/check.sh"), script);
    await chmod(join(root, ".apm/commands/scripts/check.sh"), 0o755);
    await exportCommands(root);
    const output = join(root, ".apm/skills/check/scripts/check.sh");
    expect(await readFile(output)).toEqual(script);
    expect((await stat(output)).mode & 0o111).toBe(0o111);
  });
  test("refuses to overwrite an authored skill", async () => {
    const root = await mkdtemp(join(tmpdir(), "prepkit-collision-test-"));
    await mkdir(join(root, ".apm/commands"), { recursive: true });
    await mkdir(join(root, ".apm/skills/check"), { recursive: true });
    await writeFile(join(root, ".apm/commands/check.md"), "Run the checks.");
    const authored = "---\nname: check\ndescription: Authored\n---\nKeep this.\n";
    const output = join(root, ".apm/skills/check/SKILL.md");
    await writeFile(output, authored);
    await expect(exportCommands(root)).rejects.toThrow("authored skill");
    expect(await readFile(output, "utf8")).toBe(authored);
  });
  test("refuses nested companion symlinks before rendering", async () => {
    const root = await mkdtemp(join(tmpdir(), "prepkit-symlink-test-"));
    await mkdir(join(root, ".apm/commands/scripts"), { recursive: true });
    await writeFile(join(root, ".apm/commands/check.md"), "Run the checks.");
    await symlink("/etc/hosts", join(root, ".apm/commands/scripts/external"));
    await expect(exportCommands(root)).rejects.toThrow("Symlinks");
  });
  test.each(["reference.md", "helper.sh"])("rejects unavailable runtime variables in %s", async (file) => {
    const root = await mkdtemp(join(tmpdir(), "prepkit-token-test-"));
    await mkdir(join(root, ".apm/commands/references"), { recursive: true });
    await writeFile(join(root, ".apm/commands/check.md"), "Run the checks.");
    await writeFile(join(root, ".apm/commands/references", file), "Use ${CLAUDE_SKILL_DIR}/helper.sh");
    await expect(exportCommands(root)).rejects.toThrow("unresolved runtime path");
    expect(await Bun.file(join(root, ".apm/skills/check/SKILL.md")).exists()).toBe(false);
  });
  test("check detects drift without writing, and regeneration retracts obsolete companions and commands", async () => {
    const root = await mkdtemp(join(tmpdir(), "prepkit-stale-test-"));
    const commands = join(root, ".apm/commands");
    await mkdir(join(commands, "scripts"), { recursive: true });
    await writeFile(join(commands, "check.md"), "Run the checks.");
    await writeFile(join(commands, "scripts/old.sh"), "#!/bin/sh\nexit 0\n");
    await expect(exportCommands(root, process.cwd(), { check: true })).rejects.toThrow("drift");
    const output = join(root, ".apm/skills/check");
    expect(await Bun.file(join(output, "SKILL.md")).exists()).toBe(false);
    await exportCommands(root);
    await rename(join(commands, "scripts/old.sh"), join(root, "old-source.sh"));
    await expect(exportCommands(root, process.cwd(), { check: true })).rejects.toThrow("drift");
    expect(await Bun.file(join(output, "scripts/old.sh")).exists()).toBe(true);
    let archived = 0;
    const trash = async (path: string) => { await rename(path, join(root, `retained-${++archived}`)); };
    await exportCommands(root, process.cwd(), { trash });
    expect(await Bun.file(join(output, "scripts/old.sh")).exists()).toBe(false);
    await rename(join(commands, "check.md"), join(root, "old-command.md"));
    await exportCommands(root, process.cwd(), { trash });
    expect(await Bun.file(join(output, "SKILL.md")).exists()).toBe(false);
    expect(archived).toBe(2);
  });
});
