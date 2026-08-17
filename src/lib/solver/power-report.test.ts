import { describe, expect, it } from "vitest";
import type { Recipe } from "@/lib/model/types";
import { getNodePowerReport } from "./power-report";
import { getOverclockedRecipeStats } from "./overclock";

/** A synthetic LCR recipe: the table marks the machine a multiblock. */
function lcrRecipe(eut: number, minimumTier: string): Recipe {
  return {
    id: `lcr-${eut}`,
    name: "LCR test",
    machineType: "Large Chemical Reactor",
    minimumTier,
    durationTicks: 400,
    eut,
    inputs: [],
    outputs: [],
  } as unknown as Recipe;
}

describe("energy hatches", () => {
  it("lets two MV hatches run an HV recipe at full recipe speed", () => {
    // The classic just-hit-HV build: 2 hatches work at 2 amps each, so the
    // pool is 128 x 4 = 512 EU/t - enough for the 480 EU/t draw, one tier
    // above the hatches (the game allows exactly one tier of skip).
    const report = getNodePowerReport(lcrRecipe(480, "HV"), {
      overclockTier: "MV",
      energyHatches: 2,
    });

    expect(report.state).toBe("ok");
    expect(report.amps).toBe(4);
    expect(report.poolEuT).toBe(512);
    expect(report.overclockSteps).toBe(0);
  });

  it("calls one MV hatch on that same recipe underpowered", () => {
    const report = getNodePowerReport(lcrRecipe(480, "HV"), {
      overclockTier: "MV",
      energyHatches: 1,
    });

    expect(report.state).toBe("under-powered");
    expect(report.poolEuT).toBe(128);
  });

  it("refuses a recipe more than one tier above the hatches, whatever the amps", () => {
    const report = getNodePowerReport(lcrRecipe(1920, "EV"), {
      overclockTier: "MV",
      energyHatches: 16,
    });

    expect(report.state).toBe("over-tier");
  });

  it("buys overclocks with amps past the hatches' own tier", () => {
    // Two HV hatches carry 2048 EU/t: an MV recipe overclocks TWICE, one step
    // more than the hatch tier alone would suggest - amperage overclocking,
    // straight from OverclockCalculator. Both steps are the LCR's perfect
    // kind: duration over sixteen for sixteen times the EU/t.
    const stats = getOverclockedRecipeStats(lcrRecipe(120, "MV"), {
      overclockTier: "HV",
      energyHatches: 2,
    });

    expect(stats.overclockSteps).toBe(2);
    expect(stats.durationTicks).toBe(400 / 16);
    expect(stats.eut).toBe(120 * 16);
  });

  it("keeps single hatches identical to the old model", () => {
    const withField = getOverclockedRecipeStats(lcrRecipe(120, "MV"), {
      overclockTier: "HV",
      energyHatches: 1,
    });
    const without = getOverclockedRecipeStats(lcrRecipe(120, "MV"), {
      overclockTier: "HV",
    });

    expect(withField).toEqual(without);
    expect(withField.overclockSteps).toBe(1);
  });

  it("ignores hatch counts on a singleblock and floors its tier at the minimum", () => {
    // Legacy plans store below-minimum tiers on singleblocks ("ULV" canners);
    // those always meant the minimum, and no lower machine exists to build.
    const single = {
      id: "canner",
      name: "Canner test",
      machineType: "Canner Test Machine",
      minimumTier: "LV",
      durationTicks: 16,
      eut: 1,
      inputs: [],
      outputs: [],
    } as unknown as Recipe;

    const report = getNodePowerReport(single, {
      overclockTier: "ULV",
      energyHatches: 8,
    });

    expect(report.isMultiblock).toBe(false);
    expect(report.tier).toBe("LV");
    expect(report.amps).toBe(1);
    expect(report.state).toBe("ok");
  });
});
