import fs from "node:fs/promises";
import { createReadStream, createWriteStream, existsSync } from "node:fs";
import path from "node:path";
import readline from "node:readline";
import zlib from "node:zlib";

/**
 * Fill a dataset's missing icons from a published sibling dataset.
 *
 * A 2.8.4 oracle export renders no icons on the server, and a compatible
 * client pass is the proper long-term source. Until that runs, most item ids
 * still exist in the published 2.9 dataset, so its rendered PNGs can stand in
 * wherever the ids match. This is a bootstrap, not a substitute: call it only
 * for a dataset whose ids are close to the published one, and keep the
 * icon-report so the borrowed count is visible.
 *
 * Usage:
 *   reuse-published-icons.mjs <recipes.json> <dataset-out-dir> \
 *     <published-resource-index.json.gz> [published-base-url]
 */
const [datasetPath, outDir, publishedIndexPath, publishedBaseArg] = process.argv.slice(2);
if (!datasetPath || !outDir || !publishedIndexPath) {
  throw new Error(
    "Usage: reuse-published-icons.mjs <recipes.json> <dataset-out-dir> <published-resource-index.json.gz> [published-base-url]",
  );
}
const publishedBase = (publishedBaseArg ?? "https://gtnhplanner.com").replace(/\/+$/, "");
const concurrency = positiveIntEnv("GTNH_ICON_BORROW_CONCURRENCY", 24);
const limit = positiveIntEnv("GTNH_ICON_BORROW_LIMIT", 0);

const versionId = await readDatasetVersionId(datasetPath);
const published = await readIndex(publishedIndexPath);
const local = await readIndex(path.join(outDir, "resource-index.json.gz"));
const publishedIcons = new Map();
for (const resource of published.resources ?? []) {
  const iconPath = resource.iconPath;
  if (typeof iconPath === "string" && iconPath.startsWith("/datasets/")) {
    publishedIcons.set(resourceKey(resource), iconPath);
  }
}

const iconByKey = new Map();
for (const resource of local.resources ?? []) {
  if (resource.iconPath) {
    continue;
  }
  const publishedPath = publishedIcons.get(resourceKey(resource));
  if (!publishedPath) {
    continue;
  }
  iconByKey.set(resourceKey(resource), publishedPath);
  if (limit > 0 && iconByKey.size >= limit) {
    break;
  }
}

const renderedDir = path.join(outDir, "textures", "rendered");
await fs.mkdir(renderedDir, { recursive: true });
const uniquePaths = [...new Set(iconByKey.values())];
console.log(
  `Borrowing ${uniquePaths.length} rendered icon(s) for ${iconByKey.size} resource(s) from ${publishedBase}.`,
);

let downloaded = 0;
let reused = 0;
let failed = 0;
const jobs = [...uniquePaths];
async function worker() {
  while (jobs.length > 0) {
    const publishedPath = jobs.pop();
    const fileName = path.posix.basename(publishedPath);
    const target = path.join(renderedDir, fileName);
    try {
      const stat = await fs.stat(target).catch(() => undefined);
      if (stat && stat.size > 0) {
        reused += 1;
        continue;
      }
      const response = await fetchWithRetry(`${publishedBase}${publishedPath}`);
      if (!response.ok) {
        failed += 1;
        continue;
      }
      await fs.writeFile(target, Buffer.from(await response.arrayBuffer()));
      downloaded += 1;
      if ((downloaded + reused) % 2000 === 0) {
        console.log(`  ${downloaded + reused}/${uniquePaths.length} icons (${failed} failed)`);
      }
    } catch {
      failed += 1;
    }
  }
}
await Promise.all(Array.from({ length: concurrency }, () => worker()));

const localBase = `/datasets/gtnh/${versionId}/textures/rendered`;
const iconPathByKey = new Map();
for (const [key, publishedPath] of iconByKey) {
  iconPathByKey.set(key, `${localBase}/${path.posix.basename(publishedPath)}`);
}

let updated = 0;
const tempPath = `${datasetPath}.icons-tmp`;
const input = createReadStream(datasetPath, { encoding: "utf8" });
const output = createWriteStream(tempPath);
const lines = readline.createInterface({ input, crlfDelay: Infinity });
try {
  for await (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed.startsWith('{"') || (!trimmed.endsWith("}") && !trimmed.endsWith("},"))) {
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
    if (applyIcon(value, iconPathByKey)) {
      updated += 1;
    }
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
  path.join(renderedDir, "icon-borrow-report.json"),
  `${JSON.stringify(
    {
      schemaVersion: 1,
      datasetVersionId: versionId,
      generatedAt: new Date().toISOString(),
      source: publishedBase,
      publishedIndex: path.basename(publishedIndexPath),
      borrowedResources: iconByKey.size,
      uniqueIcons: uniquePaths.length,
      downloaded,
      reused,
      failed,
      updatedEntries: updated,
      notes:
        "Icons are borrowed from a published sibling dataset only where resource kind and id match exactly. Run a client icon export for a version whose ids do not line up.",
    },
    null,
    2,
  )}\n`,
);
console.log(
  `Borrowed ${iconByKey.size} icon(s): ${downloaded} downloaded, ${reused} reused, ${failed} failed; ${updated} dataset entries updated.`,
);

function applyIcon(value, iconPathByKey) {
  let changed = false;
  if (Array.isArray(value.inputs) || Array.isArray(value.outputs)) {
    for (const resource of [...(value.inputs ?? []), ...(value.outputs ?? [])]) {
      changed = applyResource(resource, iconPathByKey) || changed;
    }
    return changed;
  }
  if (value.resource && typeof value.resource === "object") {
    return applyResource(value.resource, iconPathByKey);
  }
  if (value.kind && value.id) {
    return applyResource(value, iconPathByKey);
  }
  return false;
}

function applyResource(resource, iconPathByKey) {
  if (!resource || typeof resource !== "object" || resource.iconPath) {
    return false;
  }
  const iconPath = iconPathByKey.get(resourceKey(resource));
  if (!iconPath) {
    return false;
  }
  resource.iconPath = iconPath;
  return true;
}

function resourceKey(resource) {
  return `${resource.kind}:${resource.id}`;
}

async function readDatasetVersionId(filePath) {
  const handle = await fs.open(filePath, "r");
  try {
    const buffer = Buffer.alloc(4096);
    await handle.read(buffer, 0, buffer.length, 0);
    const match = /"datasetVersionId"\s*:\s*"([^"]+)"/.exec(buffer.toString("utf8"));
    if (!match) {
      throw new Error(`Could not read datasetVersionId from ${filePath}.`);
    }
    return match[1];
  } finally {
    await handle.close();
  }
}

async function readIndex(filePath) {
  if (!existsSync(filePath)) {
    throw new Error(`Index not found: ${filePath}`);
  }
  const data = await fs.readFile(filePath);
  return JSON.parse(
    filePath.endsWith(".gz") ? zlib.gunzipSync(data).toString("utf8") : data.toString("utf8"),
  );
}

async function fetchWithRetry(url, attempts = 4) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok || response.status === 404) {
        return response;
      }
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250 * attempt));
  }
  throw lastError;
}

function positiveIntEnv(name, fallback) {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }
  const value = Number.parseInt(raw, 10);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}
