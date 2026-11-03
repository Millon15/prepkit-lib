import { expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { stringify } from "yaml";
import { verifyInstalledSkills } from "./fresh-install";

const expected = [{ source: "example/skills/skills/source-folder", reviewed: "a".repeat(40) }];
const paths = [".claude/skills/deployed-folder/SKILL.md", ".agents/skills/deployed-folder/SKILL.md"];

async function fixture(overrides: Record<string, unknown> = {}, files = paths) {
  const root = await mkdtemp(join(tmpdir(), "prepkit-ledger-test-"));
  const entry = { repo_url: "example/skills", host: "github.com", virtual_path: "skills/source-folder",
    resolved_commit: expected[0].reviewed, deployed_files: paths, ...overrides };
  await writeFile(join(root, "apm.lock.yaml"), stringify({ dependencies: [entry] }));
  for (const path of files) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), "---\nname: a-different-declared-name\ndescription: Fixture\n---\nRun checks.\n");
  }
  return root;
}

test("uses ledger paths when source folder, deployment folder and skill name differ", async () => {
  await verifyInstalledSkills(await fixture(), expected);
});

test.each([
  { repo_url: "unrelated/skills" },
  { virtual_path: "skills/other-folder" },
  { host: "gitlab.com" },
  { resolved_commit: "b".repeat(40) },
])("requires the exact reviewed dependency identity: %p", async (change) => {
  await expect(verifyInstalledSkills(await fixture(change), expected)).rejects.toThrow("Expected one locked entry");
});

test("a skill on disk does not substitute for a missing target deployment record", async () => {
  await expect(verifyInstalledSkills(await fixture({ deployed_files: [paths[0]] }), expected))
    .rejects.toThrow("no deployed SKILL.md recorded for .agents/skills");
});

test("a ledger entry does not substitute for the actual installed file", async () => {
  await expect(verifyInstalledSkills(await fixture({}, [paths[0]]), expected)).rejects.toThrow("ENOENT");
});
