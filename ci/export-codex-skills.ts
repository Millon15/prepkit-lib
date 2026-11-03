import { cp, lstat, mkdir, mkdtemp, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import { stringify } from "yaml";
import { filesUnder, parseYaml } from "./lib";

type CommandSkill = { name: string; source: string; markdown: string };
type ExportOptions = { check?: boolean; trash?: (path: string) => Promise<void> };
type Change = { destination: string; source?: string };
const markerName = "prepkit-command.json";
const forbiddenRuntimePath = /\.rulesync\/|\$(?:\{CLAUDE_(?:PLUGIN_ROOT|SKILL_DIR)\}|CLAUDE_(?:PLUGIN_ROOT|SKILL_DIR)\b)/;

const guidance = "Use the current agent's shell, file-reading, editing, and delegation tools. " +
  "Treat `$ARGUMENTS` below as the arguments supplied by the user with this skill. " +
  "Do not assume Claude-specific tool names or permission flags exist.\n\n";

export function commandSkill(source: string, text: string): CommandSkill {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  const metadata = match ? parseYaml(match[1], source) : {};
  const body = (match ? text.slice(match[0].length) : text).trim();
  const name = basename(source, ".md");
  if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) throw new Error(`Invalid command skill name: ${name}`);
  if (!body) throw new Error(`Command is empty: ${source}`);
  if (forbiddenRuntimePath.test(body)) {
    throw new Error(`${source}: replace project/plugin runtime paths before exporting`);
  }
  const description = typeof metadata.description === "string" ? metadata.description : `Run the ${name} workflow.`;
  const header = stringify({ name, description, "disable-model-invocation": true, targets: ["codexcli"] });
  return { name, source, markdown: `---\n${header}---\n\n${guidance}${body}\n` };
}

async function copyCompanions(commands: string, destination: string) {
  const entries = await readdir(commands, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isSymbolicLink()) throw new Error(`Command companion is a symlink: ${entry.name}`);
    if (entry.name.endsWith(".md") && entry.isFile()) continue;
    await cp(join(commands, entry.name), join(destination, entry.name), { recursive: true, preserveTimestamps: true });
  }
}

async function rejectEscapingReferences(skill: CommandSkill, destination: string) {
  for (const match of skill.markdown.matchAll(/\[[^\]]*\]\(([^\s)]+)(?:\s+[^)]*)?\)/g)) {
    const link = match[1];
    if (/^(?:[a-z][a-z0-9+.-]*:|#)/i.test(link)) continue;
    const path = decodeURIComponent(link.split("#")[0]);
    const resolved = resolve(destination, path);
    if (isAbsolute(path) || relative(destination, resolved).startsWith("..")) {
      throw new Error(`${skill.source}: reference escapes the exported skill: ${link}`);
    }
    await stat(resolved).catch(() => { throw new Error(`${skill.source}: missing bundled reference: ${link}`); });
  }
}

async function stageSkills(packageRoot: string, stage: string): Promise<CommandSkill[]> {
  const commands = join(packageRoot, ".apm/commands");
  if (!await directoryExists(commands)) return [];
  await filesUnder(commands);
  const entries = await readdir(commands, { withFileTypes: true });
  const sources = entries.filter((entry) => entry.isFile() && entry.name.endsWith(".md")).map((entry) => entry.name).sort();
  const skills: CommandSkill[] = [];
  for (const source of sources) {
    const skill = commandSkill(source, await readFile(join(commands, source), "utf8"));
    const destination = join(stage, "source/skills", skill.name);
    await mkdir(destination, { recursive: true });
    await copyCompanions(commands, destination);
    await rejectEscapingReferences(skill, destination);
    await writeFile(join(destination, "SKILL.md"), skill.markdown);
    await writeFile(join(destination, markerName), `${JSON.stringify({ generator: "prepkit-command-v1", source })}\n`);
    skills.push(skill);
  }
  return skills;
}

async function render(stage: string, repositoryRoot: string) {
  const config = { targets: ["codexcli"], features: ["skills"], delete: false, global: false };
  await writeFile(join(stage, "render.jsonc"), JSON.stringify(config));
  const cli = join(repositoryRoot, "node_modules/rulesync/dist/cli/index.js");
  const child = Bun.spawn([process.execPath, cli, "generate", "--config", "render.jsonc",
    "--input-roots", join(stage, "source"), "--output-roots", join(stage, "output")], {
    cwd: stage, stdin: "ignore", stdout: "inherit", stderr: "inherit",
  });
  if (await child.exited !== 0) throw new Error("Rulesync command-skill rendering failed");
}

async function directoryExists(path: string): Promise<boolean> {
  const info = await lstat(path).catch((error) => {
    if (error.code === "ENOENT") return undefined;
    throw error;
  });
  if (!info) return false;
  if (info.isSymbolicLink() || !info.isDirectory()) throw new Error(`Expected a real directory: ${path}`);
  return true;
}

async function ownedSource(destination: string): Promise<string | undefined> {
  const marker = Bun.file(join(destination, markerName));
  if (!await marker.exists()) return undefined;
  const data = await marker.json();
  return data.generator === "prepkit-command-v1" && typeof data.source === "string" ? data.source : undefined;
}

async function validateRendered(directory: string) {
  for (const file of await filesUnder(directory)) {
    const bytes = await readFile(file);
    if (!/\.(?:md|txt|sh|[cm]?js|ts|json|ya?ml)$/.test(file) && bytes.subarray(0, 2).toString() !== "#!") continue;
    if (forbiddenRuntimePath.test(bytes.toString("utf8"))) {
      throw new Error(`Rendered skill has an unresolved runtime path: ${file}`);
    }
  }
}

async function sameDirectory(source: string, destination: string): Promise<boolean> {
  const wanted = (await filesUnder(source)).map((path) => relative(source, path));
  const actual = (await filesUnder(destination)).map((path) => relative(destination, path));
  if (JSON.stringify(wanted) !== JSON.stringify(actual)) return false;
  for (const path of wanted) {
    const left = join(source, path), right = join(destination, path);
    if (!(await readFile(left)).equals(await readFile(right))) return false;
    if (((await stat(left)).mode & 0o111) !== ((await stat(right)).mode & 0o111)) return false;
  }
  return true;
}

async function planChanges(packageRoot: string, stage: string, skills: CommandSkill[]): Promise<Change[]> {
  const root = join(packageRoot, ".apm/skills");
  const existing = await directoryExists(root) ? await readdir(root, { withFileTypes: true }) : [];
  const changes: Change[] = [];
  for (const skill of skills) {
    const source = join(stage, "output/.agents/skills", skill.name), destination = join(root, skill.name);
    await validateRendered(source);
    const exists = await directoryExists(destination);
    if (exists && await ownedSource(destination) !== skill.source) throw new Error(`Refusing to overwrite an authored skill: ${destination}`);
    if (!exists || !await sameDirectory(source, destination)) changes.push({ source, destination });
  }
  for (const entry of existing.filter((entry) => entry.isDirectory() && !skills.some((skill) => skill.name === entry.name))) {
    const destination = join(root, entry.name);
    if (await directoryExists(destination) && await ownedSource(destination)) changes.push({ destination });
  }
  return changes;
}

async function trashPath(path: string) {
  if (!Bun.which("trash")) throw new Error("Install the trash CLI before replacing stale generated skills");
  const child = Bun.spawn(["trash", path], { stdout: "inherit", stderr: "inherit" });
  if (await child.exited !== 0) throw new Error(`Could not move generated skill to Trash: ${path}`);
}

async function applyChanges(changes: Change[], remove: (path: string) => Promise<void>) {
  for (const change of changes) {
    if (await directoryExists(change.destination)) await remove(change.destination);
    if (change.source) await cp(change.source, change.destination, { recursive: true, preserveTimestamps: true });
  }
}

export async function exportCommands(packageRoot: string, repositoryRoot = process.cwd(), options: ExportOptions = {}) {
  const stage = await mkdtemp(join(tmpdir(), "prepkit-export-"));
  const skills = await stageSkills(packageRoot, stage);
  if (skills.length) await render(stage, repositoryRoot);
  const changes = await planChanges(packageRoot, stage, skills);
  if (options.check && changes.length) throw new Error(`Command export drift:\n${changes.map((change) => change.destination).join("\n")}`);
  if (!options.check) await applyChanges(changes, options.trash ?? trashPath);
  console.log(`${options.check ? "Checked" : "Exported"} ${skills.length} self-contained command skill(s)`);
}

async function main() {
  const args = process.argv.slice(2);
  const check = args[0] === "--check";
  const [path, ...extra] = check ? args.slice(1) : args;
  if (!path || extra.length || isAbsolute(path) || path.startsWith("-")) {
    console.error("Usage: ci/export-codex-skills.sh [--check] <relative-package-dir>"); process.exitCode = 2; return;
  }
  await exportCommands(resolve(path), process.cwd(), { check });
}

if (import.meta.main) main().catch((error) => { console.error(String(error)); process.exitCode = 1; });
