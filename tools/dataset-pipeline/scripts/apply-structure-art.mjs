import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

/**
 * Name BlockRenderer6343's zipped structure renders after the dataset's
 * machine handler ids. The exporter writes `<display-name>-<item>_<meta>.png`
 * plus index.json; this maps each multiblock handler through its controller
 * item (machineHandlerIcons) and, when that entry is missing, its label.
 *
 * Usage:
 *   apply-structure-art.mjs <render-dir> <resource-index.json.gz> \
 *     <recipe-index.json.gz> <out-dir>
 */
const [renderDir, resourceIndexPath, recipeIndexPath, outDir] = process.argv.slice(2);
if (!renderDir || !resourceIndexPath || !recipeIndexPath || !outDir) {
  throw new Error(
    "Usage: apply-structure-art.mjs <render-dir> <resource-index.json.gz> <recipe-index.json.gz> <out-dir>",
  );
}

const renders = JSON.parse(fs.readFileSync(path.join(renderDir, "index.json"), "utf8"));
const resources = JSON.parse(zlib.gunzipSync(fs.readFileSync(resourceIndexPath)).toString("utf8"));
const recipeIndex = JSON.parse(zlib.gunzipSync(fs.readFileSync(recipeIndexPath)).toString("utf8"));
const byResourceId = new Map(
  renders.map((entry) => [entry.registryName + (entry.meta ? `@${entry.meta}` : ""), entry]),
);
const byName = new Map(renders.map((entry) => [entry.displayName, entry]));
const handlerIcons = new Map(
  (resources.machineHandlerIcons ?? []).map((entry) => [entry.familyId, entry.resource]),
);
const handlers = new Map();
for (const shard of recipeIndex.shards) {
  const shardPath = path.join(
    path.dirname(recipeIndexPath),
    "recipes-shards",
    path.basename(shard.path),
  );
  const data = JSON.parse(zlib.gunzipSync(fs.readFileSync(shardPath)).toString("utf8"));
  for (const recipe of data.recipes) {
    for (const handler of recipe.machineHandlers ?? []) {
      if (handler.kind === "multiblock") {
        handlers.set(handler.id, handler.label);
      }
    }
  }
}

fs.mkdirSync(outDir, { recursive: true });
const copied = [];
const missing = [];
for (const [handlerId, label] of handlers) {
  const icon = handlerIcons.get(handlerId);
  const entry = (icon?.id ? byResourceId.get(icon.id) : undefined) ?? byName.get(label);
  if (!entry) {
    missing.push({ handlerId, label });
    continue;
  }
  fs.copyFileSync(path.join(renderDir, entry.file), path.join(outDir, `${handlerId}.png`));
  copied.push({ handlerId, label, render: entry.file });
}

copied.sort((left, right) => left.handlerId.localeCompare(right.handlerId));
fs.writeFileSync(
  path.join(renderDir, "structure-render-map.json"),
  `${JSON.stringify({ copied, missing }, null, 2)}\n`,
);
console.log(`Copied ${copied.length} render(s); ${missing.length} handler(s) missing.`);
if (missing.length > 0) {
  for (const entry of missing) {
    console.log(`  MISSING ${entry.handlerId}\t${entry.label}`);
  }
}
console.log("Handler ids for structure-art-284.ts:");
for (const entry of copied) {
  console.log(`  "${entry.handlerId}",`);
}
