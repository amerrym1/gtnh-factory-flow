import { describe, expect, it } from "vitest";
import { PROJECT_SCHEMA_VERSION, type FactoryProject, type Recipe } from "@/lib/model/types";
import { getNodePowerReport } from "./power-report";
import { getOverclockedRecipeStats } from "./overclock";
import { calculateThroughput } from "./throughput";

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

  it("stalls a wired underpowered node at 0% without hiding its shape", () => {
    // The card must stay a machine at zero, not a blank: nameplate rates keep
    // the ports and wires drawn while the equilibrium pins the node still.
    const recipe = {
      id: "stall-lcr",
      name: "LCR stall test",
      machineType: "Large Chemical Reactor",
      minimumTier: "HV",
      durationTicks: 20,
      eut: 480,
      inputs: [{ kind: "fluid", id: "ethylene", amount: 100 }],
      outputs: [{ kind: "fluid", id: "polyethylene", amount: 150 }],
    } as unknown as Recipe;
    const project: FactoryProject = {
      schemaVersion: PROJECT_SCHEMA_VERSION,
      id: "power-stall",
      name: "Power stall",
      recipes: [recipe],
      nodes: [
        {
          id: "reactor",
          recipeId: "stall-lcr",
          machineCount: 1,
          parallel: 1,
          overclockTier: "MV",
          energyHatches: 1,
          enabled: true,
          position: { x: 0, y: 0 },
        },
      ],
      storages: [
        { id: "in-tank", kind: "fluid", resourceId: "ethylene", position: { x: -160, y: 0 } },
        { id: "out-tank", kind: "fluid", resourceId: "polyethylene", position: { x: 160, y: 0 } },
      ],
      edges: [
        {
          id: "feed",
          source: "in-tank",
          target: "reactor",
          resourceKind: "fluid",
          resourceId: "ethylene",
        },
        {
          id: "ship",
          source: "reactor",
          target: "out-tank",
          resourceKind: "fluid",
          resourceId: "polyethylene",
        },
      ],
      fuelProfiles: [],
    };

    const stalled = calculateThroughput(project);
    const reactor = stalled.nodes.reactor;
    expect(reactor.powerStalled).toBe(true);
    // Nameplate shape survives - one op per second, 100 L in, 150 L out.
    expect(reactor.inputs["fluid:ethylene"].amountPerSecond).toBeCloseTo(100);
    expect(reactor.outputs["fluid:polyethylene"].amountPerSecond).toBeCloseTo(150);
    // But nothing actually moves.
    expect(reactor.utilization).toBeCloseTo(0);
    expect(stalled.edges.ship.transferredPerSecond).toBeCloseTo(0);
    expect(reactor.warnings.some((warning) => warning.includes("Underpowered"))).toBe(true);

    // The same build with a second hatch runs.
    const powered = calculateThroughput({
      ...project,
      nodes: [{ ...project.nodes[0], energyHatches: 2 }],
    });
    expect(powered.nodes.reactor.powerStalled).toBe(false);
    expect(powered.nodes.reactor.utilization).toBeGreaterThan(0.99);
    expect(powered.edges.ship.transferredPerSecond).toBeCloseTo(150);
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
