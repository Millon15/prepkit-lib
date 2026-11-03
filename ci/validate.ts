import { readFile } from "node:fs/promises";
import { join } from "node:path";
import Ajv from "ajv";
import Ajv2020 from "ajv/dist/2020.js";
import { dependencies, manifestPaths, metadataEntries, object, readManifest, relativeLabel, validateReviewedPins } from "./lib";

export const LICENSES = new Set(["MIT", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "ISC", "MPL-2.0"]);

export function validateLicenses(manifest: Record<string, unknown>): void {
  for (const [source, value] of Object.entries(metadataEntries(manifest))) {
    const entry = object(value, source);
    if (typeof entry.license !== "string" || !LICENSES.has(entry.license)) {
      throw new Error(`${source}: unsupported license ${JSON.stringify(entry.license)}`);
    }
  }
  for (const { source } of dependencies(manifest)) {
    if (!Object.hasOwn(metadataEntries(manifest), source)) throw new Error(`${source}: missing license metadata`);
  }
}

async function schemaValidator(root: string) {
  const schema = JSON.parse(await readFile(join(root, "schema/x-prepkit.schema.json"), "utf8"));
  const Constructor = schema.$schema?.includes("2020-12") ? Ajv2020 : Ajv;
  const ajv = new Constructor({ allErrors: true, strict: true });
  return { ajv, validate: ajv.compile(schema) };
}

async function validateManifest(path: string, mode: string, schema: Awaited<ReturnType<typeof schemaValidator>>) {
  const manifest = await readManifest(path);
  if (typeof manifest.name !== "string" || !manifest.name.trim()) throw new Error("name must be a nonempty string");
  if (typeof manifest.version !== "string" || !manifest.version.trim()) throw new Error("version must be a string");
  if (manifest["x-prepkit"] !== undefined && !schema.validate(manifest["x-prepkit"])) {
    throw new Error(schema.ajv.errorsText(schema.validate.errors));
  }
  validateReviewedPins(manifest);
  if (mode === "licenses") validateLicenses(manifest);
}

export async function validateRepository(root: string, mode: string): Promise<string[]> {
  const schema = await schemaValidator(root);
  const errors: string[] = [];
  for (const path of await manifestPaths(root)) {
    try { await validateManifest(path, mode, schema); }
    catch (error) { errors.push(`${relativeLabel(root, path)}: ${String(error)}`); }
  }
  return errors;
}

async function main() {
  const [mode, ...extra] = process.argv.slice(2);
  if (!["lint", "licenses"].includes(mode) || extra.length) {
    console.error("Usage: bun ci/validate.ts <lint|licenses>");
    process.exitCode = 2;
    return;
  }
  const errors = await validateRepository(process.cwd(), mode);
  errors.forEach((error) => console.error(error));
  process.exitCode = errors.length ? 1 : 0;
  if (!errors.length) console.log(`${mode}: all package manifests passed`);
}

if (import.meta.main) main().catch((error) => { console.error(String(error)); process.exitCode = 1; });
