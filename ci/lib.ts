import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { parseDocument } from "yaml";

export type RecordValue = Record<string, unknown>;
export type PinnedDependency = { source: string; reviewed: string };

export function object(value: unknown, label: string): RecordValue {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as RecordValue;
}

export function parseYaml(text: string, label: string): RecordValue {
  const document = parseDocument(text, { uniqueKeys: true });
  if (document.errors.length) throw new Error(`${label}: ${document.errors[0].message}`);
  return object(document.toJS({ maxAliasCount: 0 }), label);
}

export async function readManifest(path: string): Promise<RecordValue> {
  return parseYaml(await readFile(path, "utf8"), path);
}

export async function filesUnder(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    const path = join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Symlinks are not supported: ${path}`);
    if (entry.isDirectory()) return filesUnder(path);
    return [path];
  }));
  return files.flat().sort();
}

export async function manifestPaths(root: string): Promise<string[]> {
  const groups = await Promise.all(["packages", "presets"].map(async (directory) => {
    const entries = await readdir(join(root, directory), { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory())
      .map((entry) => join(root, directory, entry.name, "apm.yml"));
  }));
  return [join(root, "apm.yml"), ...groups.flat().sort()];
}

export function pinnedDependency(value: unknown): PinnedDependency {
  if (typeof value !== "string" || !/^[^#\s]+#[a-f0-9]{40}$/.test(value)) {
    throw new Error(`APM dependency must be a source#<40-hex SHA>: ${JSON.stringify(value)}`);
  }
  const separator = value.lastIndexOf("#");
  return { source: value.slice(0, separator), reviewed: value.slice(separator + 1) };
}

export function dependencies(manifest: RecordValue): PinnedDependency[] {
  return ["dependencies", "devDependencies"].flatMap((field) => {
    if (manifest[field] === undefined) return [];
    const group = object(manifest[field], field);
    if (group.apm === undefined) return [];
    if (!Array.isArray(group.apm)) throw new Error(`${field}.apm must be an array`);
    return group.apm.map(pinnedDependency);
  });
}

export function metadataEntries(manifest: RecordValue): RecordValue {
  if (manifest["x-prepkit"] === undefined) return {};
  return object(object(manifest["x-prepkit"], "x-prepkit").entries, "x-prepkit.entries");
}

export function validateReviewedPins(manifest: RecordValue): void {
  const entries = metadataEntries(manifest);
  const selected = dependencies(manifest);
  const sources = new Set<string>();
  for (const dependency of selected) {
    if (sources.has(dependency.source)) throw new Error(`Duplicate dependency: ${dependency.source}`);
    sources.add(dependency.source);
    const entry = object(entries[dependency.source], `metadata for ${dependency.source}`);
    if (entry.reviewed !== dependency.reviewed) {
      throw new Error(`Reviewed SHA does not match dependency: ${dependency.source}`);
    }
  }
}

export function relativeLabel(root: string, path: string): string {
  return relative(root, path) || ".";
}
