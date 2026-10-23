import fs from "node:fs";
import path from "node:path";
import { PNG } from "pngjs";
import { describe, expect, it } from "vitest";

import { MACHINE_STRUCTURE_ART_IDS_28, getMachine284StructureArt } from "./structure-art-284";
import { getMachineStructureArt, getPowerStructureArt } from "./structure-art";

const DIR = path.join(process.cwd(), "public", "power-art", "2.8");

describe("the 2.8.4 multiblock structure renders", () => {
  it("has a render on disk for every listed handler", () => {
    const missing = [...MACHINE_STRUCTURE_ART_IDS_28].filter(
      (id) => !fs.existsSync(path.join(DIR, `${id}.png`)),
    );
    expect(missing).toEqual([]);
  });

  it("ships no 2.8 render no handler can reach", () => {
    const orphans = fs
      .readdirSync(DIR)
      .filter((file) => file.endsWith(".png"))
      .map((file) => file.replace(/\.png$/, ""))
      .filter((id) => !MACHINE_STRUCTURE_ART_IDS_28.has(id));
    expect(orphans).toEqual([]);
  });

  it("renders every image at the shared 640x640 canvas", () => {
    for (const id of MACHINE_STRUCTURE_ART_IDS_28) {
      const png = PNG.sync.read(fs.readFileSync(path.join(DIR, `${id}.png`)));
      expect([png.width, png.height], id).toEqual([640, 640]);
    }
  });

  it("routes 2.8 cards to the 2.8 renders and 2.9 cards to the shared ones", () => {
    expect(getMachineStructureArt("multi-smelter", "2.8")).toBe("/power-art/2.8/multi-smelter.png");
    expect(getMachineStructureArt("large-fluid-extractor", "2.8")).toBe(
      "/power-art/2.8/large-fluid-extractor.png",
    );
    expect(getMachineStructureArt("multi-smelter", "2.9")).toBeUndefined();
    expect(getMachineStructureArt("large-fluid-extractor")).toBe(
      "/power-art/large-fluid-extractor.png",
    );
    expect(getPowerStructureArt("large-bronze-boiler", "2.8")).toBe(
      "/power-art/2.8/large-bronze-boiler.png",
    );
  });

  it("falls back to the controller icon when 2.8 has no render", () => {
    expect(getMachine284StructureArt("vacuum-furnace")).toBeUndefined();
    expect(getMachineStructureArt("vacuum-furnace", "2.8")).toBeUndefined();
    expect(getMachineStructureArt(undefined, "2.8")).toBeUndefined();
  });
});
