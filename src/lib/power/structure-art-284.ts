/**
 * Structure renders shot in a GTNH 2.8.4 client with BlockRenderer6343
 * (public/power-art/2.8/<handler-id>.png). The 2.9 art is a different set of
 * structures and must not stand in for these: a handler without a 2.8 render
 * falls back to its controller icon instead.
 */
export const MACHINE_STRUCTURE_ART_IDS_28: ReadonlySet<string> = new Set([
  "amazon-warehousing-depot",
  "big-barrel-brewery",
  "density-2",
  "dissection-apparatus",
  "electric-blast-furnace",
  "fluid-shaper",
  "fusion-control-computer-mark-i",
  "fusion-control-computer-mark-ii",
  "fusion-control-computer-mark-iii",
  "fusiontech-mk-iv",
  "fusiontech-mk-v",
  "high-current-industrial-arc-furnace",
  "hot-isostatic-pressurization-unit",
  "hyper-intensity-laser-engraver",
  "implosion-compressor",
  "industrial-autoclave",
  "industrial-cutting-factory",
  "industrial-extrusion-machine",
  "industrial-maceration-stack",
  "industrial-material-press",
  "industrial-precision-lathe",
  "industrial-wire-factory",
  "large-bronze-boiler",
  "large-combustion-engine",
  "large-electric-compressor",
  "large-fluid-extractor",
  "large-plasma-turbine",
  "large-scale-auto-assembler-v1-01",
  "large-sifter-control-block",
  "large-steel-boiler",
  "large-thermal-refinery",
  "large-titanium-boiler",
  "large-tungstensteel-boiler",
  "magnetic-flux-exhibitor",
  "multi-smelter",
  "neutronium-compressor",
  "ore-washing-plant-multiblock",
  "pseudostable-black-hole-containment-field",
  "turbocan-pro",
  "volcanus",
]);

export function getMachine284StructureArt(handlerId: string | undefined): string | undefined {
  return handlerId && MACHINE_STRUCTURE_ART_IDS_28.has(handlerId)
    ? `/power-art/2.8/${handlerId}.png`
    : undefined;
}
