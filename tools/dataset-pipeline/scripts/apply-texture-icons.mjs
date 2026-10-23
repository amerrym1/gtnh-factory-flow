import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { writeDatasetJson } from "./dataset-json-writer.mjs";

const instanceRoot = process.argv[2];
const datasetPath = process.argv[3];
const outDir = process.argv[4];

if (!instanceRoot || !datasetPath || !outDir) {
  throw new Error(
    "Usage: apply-texture-icons.mjs <gtnh-instance-root> <recipes.json> <dataset-output-dir>",
  );
}

if (!existsSync(datasetPath)) {
  throw new Error(`Dataset not found: ${datasetPath}`);
}

const maxDatasetBytes = positiveIntEnv("GTNH_TEXTURE_ICON_MAX_DATASET_BYTES", 450_000_000);
const datasetSizeBytes = (await fs.stat(datasetPath)).size;
// A 2.8.4 dataset is around 1 GB, larger than Node's maximum string length, so
// the whole-file JSON path cannot read it. The line-delimited writer puts one
// array entry per line, which lets the streaming pass rewrite it in place
// without ever holding the dataset in memory.
if (datasetSizeBytes > maxDatasetBytes) {
  await applyTextureIconsStreaming();
  process.exit(0);
}

const dataset = JSON.parse(await fs.readFile(datasetPath, "utf8"));
const versionId = dataset.datasetVersionId;
const textureOutDir = path.join(outDir, "textures");
const publicTextureBase = `/datasets/gtnh/${versionId}/textures`;
const bundledAspectIcons = await readBundledAspectIconNames();

console.log("Indexing real GTNH texture assets from mod jars.");
const textureIndex = await buildTextureIndex(instanceRoot);
console.log(`Indexed ${textureIndex.byPath.size} texture PNGs from ${textureIndex.jarCount} jars.`);

await fs.mkdir(textureOutDir, { recursive: true });
await fs.rm(path.join(textureOutDir, "item"), { recursive: true, force: true });
await fs.rm(path.join(textureOutDir, "fluid"), { recursive: true, force: true });

const resourcesByKey = new Map();
for (const resource of dataset.resources ?? []) {
  resourcesByKey.set(resourceKey(resource), resource);
}
for (const recipe of dataset.recipes ?? []) {
  for (const resource of [...(recipe.inputs ?? []), ...(recipe.outputs ?? [])]) {
    const key = resourceKey(resource);
    if (!resourcesByKey.has(key)) {
      resourcesByKey.set(key, resource);
    }
  }
}
for (const entry of dataset.recipeMapIcons ?? []) {
  if (!entry?.resource) {
    continue;
  }
  const key = resourceKey(entry.resource);
  if (!resourcesByKey.has(key)) {
    resourcesByKey.set(key, entry.resource);
  }
}

const iconsByKey = new Map();
let matched = 0;
let missing = 0;
let preservedRendered = 0;

for (const [key, resource] of resourcesByKey) {
  clearMissingBundledAspectIcon(resource, bundledAspectIcons);
  const hintedTexture = findIconPathTextureHint(resource, textureIndex);
  if (hintedTexture) {
    const iconPath = await extractTexture(
      resource,
      hintedTexture,
      textureOutDir,
      publicTextureBase,
    );
    iconsByKey.set(key, iconPath);
    matched += 1;
    continue;
  }
  clearUnresolvedIconPathTextureHint(resource);
  if (resource.iconPath) {
    preservedRendered += 1;
    continue;
  }

  const match = findTexture(resource, textureIndex);
  if (!match) {
    missing += 1;
    continue;
  }

  const iconPath = await extractTexture(resource, match, textureOutDir, publicTextureBase);
  iconsByKey.set(key, iconPath);
  matched += 1;
}

for (const resource of dataset.resources ?? []) {
  applyIcon(resource, iconsByKey);
}
for (const recipe of dataset.recipes ?? []) {
  for (const resource of [...(recipe.inputs ?? []), ...(recipe.outputs ?? [])]) {
    applyIcon(resource, iconsByKey);
  }
}
for (const entry of dataset.recipeMapIcons ?? []) {
  if (entry?.resource) {
    applyIcon(entry.resource, iconsByKey);
  }
}

await writeDatasetJson(datasetPath, dataset);
await fs.writeFile(
  path.join(textureOutDir, "icon-report.json"),
  `${JSON.stringify(
    {
      schemaVersion: 1,
      datasetVersionId: versionId,
      generatedAt: new Date().toISOString(),
      source: "minecraft-asset-pngs",
      matchedResources: matched,
      missingResources: missing,
      preservedRenderedIcons: preservedRendered,
      notes:
        "Only real PNG files extracted from the GTNH instance/mod jars or rendered by the GTNH client from real ItemStacks are used. Missing icons are intentionally left blank; no generated or guessed item art is published.",
    },
    null,
    2,
  )}\n`,
);

console.log(
  `Applied ${matched} real texture icons and preserved ${preservedRendered} rendered stack icons. ${missing} resources remain iconless.`,
);

async function buildTextureIndex(root) {
  const jars = (await findFiles(path.join(root, "mods"), ".jar")).sort();
  const byPath = new Map();
  const byStem = new Map();
  const byLooseStem = new Map();

  for (const jar of jars) {
    const list = spawnSync("unzip", ["-Z", "-1", jar], {
      encoding: "utf8",
      maxBuffer: 50 * 1024 * 1024,
    });

    if (list.status !== 0) {
      continue;
    }

    for (const entry of list.stdout.split(/\r?\n/)) {
      if (!isTextureEntry(entry)) {
        continue;
      }

      const lowerEntry = entry.toLowerCase();
      const asset = parseAssetTexturePath(lowerEntry);
      if (!asset) {
        continue;
      }

      const texture = { jar, entry, namespace: asset.namespace, stem: asset.stem };
      byPath.set(lowerEntry, texture);
      addFirst(byStem, `${asset.namespace}:${asset.stem}`, texture);
      addFirst(byLooseStem, asset.stem, texture);
    }
  }

  return { byPath, byStem, byLooseStem, jarCount: jars.length };
}

function findTexture(resource, textureIndex) {
  if (requiresRenderedStackIcon(resource)) {
    return undefined;
  }

  const parsed = parseResourceId(resource.id);
  const candidates = textureCandidates(resource, parsed);

  for (const candidate of candidates.fullPaths) {
    const match = textureIndex.byPath.get(candidate.toLowerCase());
    if (match) {
      return match;
    }
  }

  if (parsed.namespace) {
    for (const stem of candidates.stems) {
      const match = textureIndex.byStem.get(`${parsed.namespace}:${stem.toLowerCase()}`);
      if (match) {
        return match;
      }
    }
  }

  for (const stem of candidates.looseStems) {
    const match = textureIndex.byLooseStem.get(stem.toLowerCase());
    if (match) {
      return match;
    }
  }

  return undefined;
}

function findIconPathTextureHint(resource, textureIndex) {
  if (typeof resource.iconPath !== "string" || !resource.iconPath.startsWith("asset:")) {
    return undefined;
  }

  const hint = resource.iconPath.slice("asset:".length);
  const separatorIndex = hint.indexOf(":");
  if (separatorIndex <= 0) {
    return undefined;
  }

  const namespace = hint.slice(0, separatorIndex).toLowerCase();
  const resourcePath = hint
    .slice(separatorIndex + 1)
    .replace(/^\/+/, "")
    .toLowerCase();
  return textureIndex.byPath.get(`assets/${namespace}/${resourcePath}`);
}

function clearUnresolvedIconPathTextureHint(resource) {
  if (typeof resource.iconPath === "string" && resource.iconPath.startsWith("asset:")) {
    delete resource.iconPath;
  }
}

function requiresRenderedStackIcon(resource) {
  const id = String(resource.id ?? "").toLowerCase();
  return resource.kind === "item" && id.includes("@") && /^gregtech:gt\.metaitem\./.test(id);
}

function textureCandidates(resource, parsed) {
  const namespace = parsed.namespace;
  const name = parsed.name;
  const stems = unique([
    name,
    name.replace(/^item\./i, ""),
    name.replace(/^tile\./i, ""),
    name.replace(/\./g, "_"),
    name.replace(/\./g, "/"),
    name.split(".").at(-1),
    resource.displayName ? slug(resource.displayName) : "",
  ]).filter(Boolean);

  const fullPaths = [];
  if (namespace) {
    const textureFolders =
      resource.kind === "aspect"
        ? ["aspects", "aspect", "items", "item"]
        : resource.kind === "fluid"
          ? ["fluids", "fluid", "items", "blocks"]
          : ["items", "item", "blocks", "block"];

    for (const folder of textureFolders) {
      for (const stem of stems) {
        fullPaths.push(`assets/${namespace}/textures/${folder}/${stem}.png`);
      }
    }
  }

  const fluidStems =
    resource.kind === "fluid"
      ? stems.flatMap((stem) => [stem, `${stem}_still`, `still_${stem}`, `${stem}.still`])
      : [];

  const looseStems =
    resource.kind === "fluid" || resource.kind === "aspect"
      ? unique([...stems, ...fluidStems])
      : [];

  return {
    fullPaths,
    stems: unique([...stems, ...fluidStems]),
    looseStems,
  };
}

async function extractTexture(resource, texture, textureOutDir, publicTextureBase) {
  const keyHash = crypto
    .createHash("sha1")
    .update(`${resource.kind}:${resource.id}:${texture.entry}`)
    .digest("hex")
    .slice(0, 12);
  const filename = `${safeFileName(resource.id)}-${keyHash}.png`;
  const relativePath = path.posix.join(resource.kind, filename);
  const outputPath = path.join(textureOutDir, resource.kind, filename);

  await fs.mkdir(path.dirname(outputPath), { recursive: true });

  const extract = spawnSync("unzip", ["-p", texture.jar, texture.entry], {
    encoding: "buffer",
    maxBuffer: 10 * 1024 * 1024,
  });
  if (extract.status !== 0 || extract.stdout.length === 0) {
    throw new Error(`Failed to extract ${texture.entry} from ${texture.jar}`);
  }

  await fs.writeFile(outputPath, extract.stdout);
  return `${publicTextureBase}/${relativePath}`;
}

function applyIcon(resource, iconsByKey) {
  if (resource.iconPath) {
    return;
  }

  const iconPath = iconsByKey.get(resourceKey(resource));
  if (iconPath) {
    resource.iconPath = iconPath;
  }
}

async function findFiles(root, extension) {
  if (!existsSync(root)) {
    return [];
  }

  const found = [];
  for (const entry of await fs.readdir(root, { withFileTypes: true })) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      found.push(...(await findFiles(fullPath, extension)));
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith(extension)) {
      found.push(fullPath);
    }
  }
  return found;
}

function isTextureEntry(entry) {
  const lower = entry.toLowerCase();
  return lower.startsWith("assets/") && lower.includes("/textures/") && lower.endsWith(".png");
}

function parseAssetTexturePath(entry) {
  const match = entry.match(
    /^assets\/([^/]+)\/textures\/(?:items?|blocks?|fluids?|aspects?)\/(.+)\.png$/,
  );
  if (!match) {
    return undefined;
  }
  return {
    namespace: match[1],
    stem: match[2],
  };
}

function parseResourceId(id) {
  const withoutMeta = String(id).split("@")[0];
  const separator = withoutMeta.indexOf(":");
  if (separator === -1) {
    return { namespace: undefined, name: withoutMeta.toLowerCase() };
  }
  return {
    namespace: withoutMeta.slice(0, separator).toLowerCase(),
    name: withoutMeta.slice(separator + 1).toLowerCase(),
  };
}

function resourceKey(resource) {
  return `${resource.kind}:${resource.id}`;
}

/**
 * Streaming twin of the whole-dataset path above, for datasets past Node's
 * string limit. Every array entry is one line (dataset-json-writer.mjs), so a
 * line is parsed, given its icon, and written back. Icon work is cached per
 * resource key because the same item appears in hundreds of recipes.
 */
async function applyTextureIconsStreaming() {
  const readline = (await import("node:readline")).default;
  const { createReadStream, createWriteStream } = await import("node:fs");
  const versionId = path.basename(outDir);
  const textureOutDir = path.join(outDir, "textures");
  const publicTextureBase = `/datasets/gtnh/${versionId}/textures`;
  const bundledAspectIcons = await readBundledAspectIconNames();

  console.log("Indexing real GTNH texture assets from mod jars.");
  const textureIndex = await buildTextureIndex(instanceRoot);
  console.log(`Indexed ${textureIndex.byPath.size} texture PNGs from ${textureIndex.jarCount} jars.`);

  await fs.mkdir(textureOutDir, { recursive: true });
  await fs.rm(path.join(textureOutDir, "item"), { recursive: true, force: true });
  await fs.rm(path.join(textureOutDir, "fluid"), { recursive: true, force: true });

  const iconByKey = new Map();
  const counters = { matched: 0, missing: 0, preserved: 0 };
  let parsedLines = 0;

  async function iconFor(resource) {
    if (!resource || typeof resource !== "object" || typeof resource.id !== "string") {
      return undefined;
    }
    const key = resourceKey(resource);
    if (iconByKey.has(key)) {
      return iconByKey.get(key);
    }

    clearMissingBundledAspectIcon(resource, bundledAspectIcons);
    const hintedTexture = findIconPathTextureHint(resource, textureIndex);
    if (hintedTexture) {
      const iconPath = await extractTexture(resource, hintedTexture, textureOutDir, publicTextureBase);
      iconByKey.set(key, iconPath);
      counters.matched += 1;
      return iconPath;
    }

    clearUnresolvedIconPathTextureHint(resource);
    if (resource.iconPath) {
      iconByKey.set(key, undefined);
      counters.preserved += 1;
      return undefined;
    }

    const match = findTexture(resource, textureIndex);
    if (!match) {
      iconByKey.set(key, undefined);
      counters.missing += 1;
      return undefined;
    }

    const iconPath = await extractTexture(resource, match, textureOutDir, publicTextureBase);
    iconByKey.set(key, iconPath);
    counters.matched += 1;
    return iconPath;
  }

  async function iconForLineValue(value) {
    if (!value || typeof value !== "object") {
      return;
    }
    if (Array.isArray(value.inputs) || Array.isArray(value.outputs)) {
      for (const resource of [...(value.inputs ?? []), ...(value.outputs ?? [])]) {
        const iconPath = await iconFor(resource);
        if (iconPath && !resource.iconPath) {
          resource.iconPath = iconPath;
        }
      }
      return;
    }
    if (value.resource && typeof value.resource === "object") {
      const iconPath = await iconFor(value.resource);
      if (iconPath && !value.resource.iconPath) {
        value.resource.iconPath = iconPath;
      }
      return;
    }
    if (value.kind && value.id) {
      const iconPath = await iconFor(value);
      if (iconPath && !value.iconPath) {
        value.iconPath = iconPath;
      }
    }
  }

  const tempPath = `${datasetPath}.icons-tmp`;
  const input = createReadStream(datasetPath, { encoding: "utf8" });
  const output = createWriteStream(tempPath);
  const lines = readline.createInterface({ input, crlfDelay: Infinity });

  try {
    for await (const rawLine of lines) {
      const trimmed = rawLine.trim();
      if (!trimmed.startsWith("{\"") || !trimmed.endsWith("}") && !trimmed.endsWith("},")) {
        output.write(`${rawLine}\n`);
        continue;
      }
      const hasComma = trimmed.endsWith(",");
      const body = hasComma ? trimmed.slice(0, -1) : trimmed;
      let value;
      try {
        value = JSON.parse(body);
      } catch {
        output.write(`${rawLine}\n`);
        continue;
      }
      parsedLines += 1;
      await iconForLineValue(value);
      const indent = rawLine.slice(0, rawLine.length - rawLine.trimStart().length);
      output.write(`${indent}${JSON.stringify(value)}${hasComma ? "," : ""}\n`);
    }
  } finally {
    await new Promise((resolve, reject) => {
      output.on("error", reject);
      output.end(resolve);
    });
    input.destroy();
  }

  await fs.rename(tempPath, datasetPath);
  await fs.writeFile(
    path.join(textureOutDir, "icon-report.json"),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        datasetVersionId: versionId,
        generatedAt: new Date().toISOString(),
        source: "minecraft-asset-pngs",
        streaming: true,
        matchedResources: counters.matched,
        missingResources: counters.missing,
        preservedRenderedIcons: counters.preserved,
        parsedEntries: parsedLines,
        notes:
          "Only real PNG files extracted from the GTNH instance/mod jars or rendered by the GTNH client from real ItemStacks are used. Missing icons are intentionally left blank; no generated or guessed item art is published.",
      },
      null,
      2,
    )}\n`,
  );
  console.log(
    `Applied ${counters.matched} real texture icons and preserved ${counters.preserved} rendered stack icons. ${counters.missing} resources remain iconless.`,
  );
}


async function readBundledAspectIconNames() {
  const aspectDir = path.resolve("public", "nei", "thaumcraft", "aspects");
  if (!existsSync(aspectDir)) {
    return new Set();
  }

  const entries = await fs.readdir(aspectDir);
  return new Set(
    entries
      .filter((entry) => entry.toLowerCase().endsWith(".png"))
      .map((entry) => entry.toLowerCase()),
  );
}

function clearMissingBundledAspectIcon(resource, bundledAspectIcons) {
  if (resource.kind !== "aspect" || typeof resource.iconPath !== "string") {
    return;
  }

  const prefix = "/nei/thaumcraft/aspects/";
  if (!resource.iconPath.toLowerCase().startsWith(prefix)) {
    return;
  }

  const fileName = path.posix.basename(resource.iconPath).toLowerCase();
  if (!bundledAspectIcons.has(fileName)) {
    delete resource.iconPath;
  }
}

function addFirst(map, key, value) {
  if (!map.has(key)) {
    map.set(key, value);
  }
}

function positiveIntEnv(name, defaultValue) {
  const rawValue = process.env[name];
  if (!rawValue) {
    return defaultValue;
  }

  const parsed = Number.parseInt(rawValue, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }

  return parsed;
}

function unique(values) {
  return [...new Set(values.map((value) => String(value ?? "").trim()).filter(Boolean))];
}

function slug(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9./_-]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function safeFileName(value) {
  return (
    slug(value)
      .replace(/[/:@]+/g, "_")
      .slice(0, 90) || "resource"
  );
}
