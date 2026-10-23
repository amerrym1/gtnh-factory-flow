import fs from "node:fs/promises";
import { createReadStream, createWriteStream, existsSync } from "node:fs";
import path from "node:path";
import readline from "node:readline";
import zlib from "node:zlib";
import { buildMachineHandlerTemplates } from "./machine-configs.mjs";

/**
 * Rebuild `machineHandlerIcons` for a dataset that was normalized before its
 * icons existed.
 *
 * The 2.8.4 server export normalizes with no rendered icons, so the
 * normalizer's handler-icon registration finds no iconPath and ships an empty
 * array. The later icon passes fill the resource catalog. This script walks
 * the raw oracle's catalysts, rebuilds the same handler families the
 * normalizer used, and writes each family's face (and tier variants) from the
 * catalog resource with the matching id.
 *
 * Usage: populate-machine-handler-icons.mjs <recipes.json> <resource-index.json.gz> <raw-oracle.json>
 */
const [datasetPath, resourceIndexPath, rawPath] = process.argv.slice(2);
if (!datasetPath || !resourceIndexPath || !rawPath) {
  throw new Error(
    "Usage: populate-machine-handler-icons.mjs <recipes.json> <resource-index.json.gz> <raw-oracle.json>",
  );
}

const catalog = await readJson(resourceIndexPath);
const raw = JSON.parse(await fs.readFile(rawPath, "utf8"));
const domain = (raw.domains ?? []).find((entry) => entry.id === "gregtech");
if (!domain) {
  throw new Error("Raw export has no gregtech domain.");
}
const byKey = new Map();
for (const resource of catalog.resources ?? []) {
  if (resource.iconPath) {
    byKey.set(`${resource.kind}:${resource.id}`, resource);
  }
}

const templatesByMap = (domain.recipeMaps ?? []).map((map) =>
  buildMachineHandlerTemplates(map.name, map.catalysts),
);
const singleblockFamilyIds = new Set(
  templatesByMap.flatMap((templates) =>
    templates.filter((template) => template.kind === "single").map((template) => template.id),
  ),
);
const iconByFamily = new Map();
for (const map of domain.recipeMaps ?? []) {
  for (const template of buildMachineHandlerTemplates(
    map.name,
    map.catalysts,
    singleblockFamilyIds,
  )) {
    const face = byKey.get(resourceKey(template.catalystResource));
    if (!face || iconByFamily.has(template.id)) {
      continue;
    }
    const tiers = (template.tierIcons ?? [])
      .map((variant) => {
        const resource = byKey.get(resourceKey(variant.resource));
        return resource ? { tier: variant.tier, resource: compact(resource) } : undefined;
      })
      .filter(Boolean);
    iconByFamily.set(template.id, {
      familyId: template.id,
      resource: compact(face),
      ...(tiers.length > 1 ? { tiers } : {}),
    });
  }
}

const entries = [...iconByFamily.values()].sort((left, right) =>
  left.familyId.localeCompare(right.familyId),
);
const payload = JSON.stringify(entries);
console.log(`Writing ${entries.length} machine handler icon entries.`);

const tempPath = `${datasetPath}.handlers-tmp`;
const input = createReadStream(datasetPath, { encoding: "utf8" });
const output = createWriteStream(tempPath);
const lines = readline.createInterface({ input, crlfDelay: Infinity });
let replaced = false;
try {
  for await (const rawLine of lines) {
    if (/^\s*"machineHandlerIcons"\s*:/.test(rawLine) && !replaced) {
      const indent = rawLine.slice(0, rawLine.length - rawLine.trimStart().length);
      const comma = rawLine.trim().endsWith(",") ? "," : "";
      output.write(`${indent}"machineHandlerIcons": ${payload}${comma}\n`);
      replaced = true;
      continue;
    }
    output.write(`${rawLine}\n`);
  }
} finally {
  await new Promise((resolve, reject) => {
    output.on("error", reject);
    output.end(resolve);
  });
  input.destroy();
}
if (!replaced) {
  await fs.rm(tempPath, { force: true });
  throw new Error("No machineHandlerIcons key found in the dataset.");
}
await fs.rename(tempPath, datasetPath);

async function readJson(filePath) {
  if (!existsSync(filePath)) {
    throw new Error(`Missing ${filePath}`);
  }
  const data = await fs.readFile(filePath);
  return JSON.parse(
    filePath.endsWith(".gz") ? zlib.gunzipSync(data).toString("utf8") : data.toString("utf8"),
  );
}

function resourceKey(resource) {
  return `${resource.kind}:${resource.id}`;
}

function compact(resource) {
  return {
    kind: resource.kind,
    id: resource.id,
    amount: 1,
    ...(resource.displayName ? { displayName: resource.displayName } : {}),
    ...(resource.iconPath ? { iconPath: resource.iconPath } : {}),
    ...(resource.dominantColor ? { dominantColor: resource.dominantColor } : {}),
  };
}
