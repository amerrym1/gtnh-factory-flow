# Comment draft for upstream issue #11

Issue: https://github.com/jackwrichards/gtnh-factory-flow/issues/11
("[Bug]: Missing Items in 2.8.4")

> The missing items and the unchanged multiblock numbers had the same cause:
> the app was reading a 2.9 dataset (or the retired 2.8.4 entry) while the
> machine table only knew 2.9 behaviour.
>
> I picked this up in a fork: https://github.com/amerrym1/gtnh-factory-flow
>
> What it does for 2.8.4:
>
> - Builds a real 2.8.4 dataset from the 2.8.4 server pack, exported by the
>   same oracle mod: 228,537 recipes across 158 maps, all from the 2.8.4
>   registries. The missing items in the screenshots come from this dataset,
>   not from a search fallback.
> - Transcribes the 2.8.4 machine table from GT5-Unofficial 5.09.51.482
>   (`MACHINES_V28`, 77 families), and routes each recipe by its own
>   `source.datasetVersionId`. A 2.8.4 recipe now gets 2.8.4 speed, EU,
>   parallels and overclock rules; a 2.9 plan is unchanged.
> - Renders the 2.8.4 multiblock previews from BlockRenderer6343 inside the
>   2.8.4 client, so the cards show the 2.8.4 structures rather than the 2.9
>   shots (`public/power-art/2.8/`).
>
> The fork currently runs 2.8.4-only on purpose. Upstream's Game picker is
> hard-disabled (`SHOW_PACK_PICKER = false`) and the global switch migrates an
> open design by recipe content, which is not a safe way to share plans across
> packs. A dual-pack deployment wants the version to be a property of the
> design (pick once, lock it, load the matching dataset when opening or
> importing), not a global switch.
>
> Known 2.8.4 gaps: ore veins and small ores are skipped because the exporter
> targets 2.9's `IStoneType`/`IOreMaterial` API, and the High Current
> Industrial Arc Furnace is not modelled because its parallels depend on the
> structure width.
>
> Build notes and the known gaps are in `docs/2.8.4-support.md`.
