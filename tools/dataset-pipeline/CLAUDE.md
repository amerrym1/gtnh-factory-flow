# Dataset pipeline (tools/dataset-pipeline)

A Forge mod (`gtnh-calc-oracle`) running inside a real GTNH client exports every
recipe map, NEI layout, catalyst, multiblock config and rendered icon. The 2.9 client
is the production line; this fork also exports 2.8.4 from the server pack for recipes
(see `docs/2.8.4-support.md`). Node scripts in
`scripts/` normalize that into the `RecipeDataset` the app reads:
`normalize-oracle-export.mjs`, `machine-configs.mjs`, `build-resource-index.mjs`,
`build-recipe-index.mjs` (recipe index, lookup index, 250-recipe shards).

## Rebuild and publish (by hand, in WSL)

The GitHub "GTNH dataset pipeline" workflow is a decoy (no runner). Never dispatch it.

1. `~/gtnh-factory-flow` in WSL Ubuntu is a git-less SNAPSHOT: copy changed pipeline
   scripts into it first or the rebuild runs old code.
2. Raw exports live at `~/gtnh-factory-flow/.pipeline/raw-export/<id>/oracle-export.json`
   with `rendered-icons/` beside them; reuse them while the pack version stands. For a
   2.9 publish never export with `GTNH_RENDER_STACK_ICONS=false`: the export stamps icon
   filenames, and a run without them broke live search. A 2.8.4 server export has no
   rendered pass; it uses the streaming texture pass and `reuse-published-icons.mjs`
   instead (`docs/2.8.4-support.md`).
3. `~/run-both.sh` (fuller: `~/rebuild-cokeoven.sh`) normalizes, indexes and gzips into
   `~/gtnh-export/datasets/gtnh/<id>`. 2.9 is the production line; this fork also builds
   2.8.4 (`docs/2.8.4-support.md`), whose normalizer output is about 1 GB and needs
   `NODE_OPTIONS=--max-old-space-size=6144`.
4. `~/copy-datasets.sh` copies results into the Windows repo's `public/datasets/gtnh`.
5. Publish: scp the changed gzips, shards and oracle-report to the droplet's
   `/opt/shared/gtnh-datasets/<id>/` (stage first; move staging dirs out of the datasets
   root before `rebuild-manifest.mjs`), then `systemctl restart gtnh-flow`. Before the
   swap, compare icon counts and icon tables against live. Verify the live manifest and
   the published gzip afterwards.

Rebuilds must run `normalize-fluid-icon-alpha.mjs` (with `--rename`) after the index
builds and before publishing, or faint fluids ship invisible. Texture URLs are cache-immutable: fix pixels under a NEW filename (`--rename`),
and patch whole basenames only.

A fresh export is NOT deterministic: crafting, furnace, bee, crop and essentia recipes
reorder, re-minting ~37,000 ids. When an export only ADDS fields, graft them onto the
published export (`~/graft-sparge.js`, matching recipes by content key) and confirm with
a shard diff (`~/cmp-field.js`). The 2.9 export in WSL is such a graft.

A new pack (or any fresh export) keeps the previous dataset's recipe ids with
`scripts/carry-recipe-ids.mjs <previous recipes.json.gz> <new recipes.json> [report]`, run
after normalize and before the indexes: same map (GT++'s `gtpp.recipe.*` read as RC-2's
`gt.recipe.*`), slots, amounts, chances, ticks and EU keep the old id (its old dataset
prefix included); bees, crops, veins, mobs and underground fluids keep theirs by identity.
`local-2.9.0-rc-2` carries beta-2's ids this way (`~/rebuild-rc2.sh` in WSL; the report is
`oracle/recipe-id-carry.json`).

## Import principles

- Prefer data exported from NEI or the runtime over hand-written tables and fallbacks.
- A missing recipe: check the raw oracle export first, then the mod source at the pack's
  exact GT tag.
- A map with one uncapped machine family carries no `machineHandlers` by design; a lone
  capped singleblock keeps its handler (below).
- Never parse tooltips globally. Multiblock stats come from tooltips only for catalysts
  flagged `multiblock` (`isMultiblockCatalyst` in `machine-configs.mjs`); singleblocks read
  only `Voltage IN` and `Machine Type`.
- Fold singleblock tier variants into one family (Liquefying Suckers are Fluid
  Extractors); multiblocks stay separate handlers (Large Fluid Extractor, Steam
  Separator). A map with one real family keeps the map name.
- Singleblock families: group voltage-input singleblocks by Java class plus their
  `Machine Type` tooltip (else recipe-map membership), named from the lowest tier. Keep a
  lone capped handler, or its `maximumTier` disappears. Exam:
  `scripts/singleblock-tiers.test.mjs`. A multiblock whose name collides with a
  singleblock gets its own id.
- Concrete items carry their oredict membership.
- NEI layout: keep exported slot positions and progress bars; empty slots stay visible;
  non-consumed slots stay visible except TGS tool placeholders; never replace a real slot
  with a fake label.
- Every fluid-touching Canner recipe is mirrored into the synthesized "Tank" map
  (`addTankRecipe`, 0 EU, 1 tick, real slots).
- Extreme Entity Crusher mobs come from the `kubatech-eec-mobs` oracle adapter (drop
  chances replayed in `eec-drops.mjs`). Sparge Tower rolled outputs and fusion startup EU
  are per-recipe export fields; `sparge-byproducts.mjs` appends rolled slots AFTER the
  exported ones so recipe ids stay stable.
- Faint fluid icons: repair only captures under 20% mean opacity, starting from the
  original PNGs (`normalize-fluid-icon-alpha.mjs`).

## 2.8.4 exports

- Use the 2.8.4 **server** pack for recipes (`GTNH_EXPORT_PACK_KIND=server`,
  `GTNH_RENDER_STACK_ICONS=false`). The 2.8.4 client pack only matters for a rendered
  icon pass, which is hours on a small machine.
- `GTNH_EXPORT_MAX_MEMORY` must be at least `3G`: CodeChickenCore refuses to boot below
  it, and the error looks like a `Loader.mccversion is null` crash.
- The normalizer output is about 1 GB. The runner raises Node's old-space limit to 6 GB;
  `apply-texture-icons.mjs` switches to a line-by-line pass when the dataset is too large
  for `fs.readFile`.
- Borrowed icons from a published sibling dataset are recorded in
  `textures/rendered/icon-borrow-report.json`. Rebuild the indexes after the borrow pass.
- Ore veins and small ores are skipped on 2.8.4: the exporter targets 2.9's ore/stone API.
