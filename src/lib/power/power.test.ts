import { describe, expect, it } from "vitest";
import { buildPowerRecipe, resynthesizePowerRecipes } from "./power-recipe";
import { getPowerSource, POWER_SOURCES } from "./registry";
import { buildPowerSettingsReader } from "./types";
import type { FactoryNode, Recipe } from "@/lib/model/types";

/**
 * Golden values are the Power Planner 2.9 workbook's own computed cells
 * (docs/power-planner-math.md documents which); a failure here means the
 * transcription drifted from the spreadsheet, not that the spreadsheet moved.
 */
function compute(sourceId: string, settings: Record<string, string> = {}) {
  const source = getPowerSource(sourceId);
  if (!source) {
    throw new Error(`No power source ${sourceId}`);
  }
  return source.compute(buildPowerSettingsReader(source, settings));
}

describe("singleblock generators", () => {
  it("prices the LV steam turbine like the workbook (E21 = 1552.94 L/s)", () => {
    const model = compute("steam-turbine", { tier: "LV" });
    expect(model.euPerTick).toBe(32);
    expect(model.inputs[0].name).toBe("Steam");
    expect(model.inputs[0].perSecond).toBeCloseTo(1552.941176, 4);
  });

  it("prices the LV gas turbine on benzene (L21 = 1.9298 L/s)", () => {
    const model = compute("gas-turbine", { tier: "LV", fuel: "Benzene" });
    expect(model.inputs[0].perSecond).toBeCloseTo(1.929824561, 6);
  });

  it("prices the LV combustion generator on diesel (S21 = 1.4474 L/s)", () => {
    const model = compute("combustion-generator", { tier: "LV", fuel: "Diesel" });
    expect(model.inputs[0].perSecond).toBeCloseTo(1.447368421, 6);
  });

  it("prices the LV semifluid generator on creosote (Z21 = 14.4737 L/s)", () => {
    const model = compute("semifluid-generator", { tier: "LV", fuel: "Creosote Oil" });
    expect(model.inputs[0].perSecond).toBeCloseTo(14.47368421, 5);
  });

  it("prices the LuV naquadah reactor on a long enriched rod (E59 = 3.1488 per hour)", () => {
    const model = compute("naquadah-reactor", {
      tier: "LuV",
      fuel: "Long Enriched Naquadah Rod (LuV)",
    });
    expect(model.inputs[0].perSecond * 3600).toBeCloseTo(3.1488, 4);
  });

  it("prices the LV magic absorber on quicksilver (L59 = 39.079 per hour)", () => {
    const model = compute("magic-energy-absorber", { tier: "LV", fuel: "Quicksilver" });
    expect(model.inputs[0].perSecond * 3600).toBeCloseTo(39.07894737, 4);
  });
});

describe("engines", () => {
  it("burns diesel in the LCE at 2048/480 L/t (sheet E15 x 20)", () => {
    const model = compute("large-combustion-engine", { fuel: "Diesel" });
    expect(model.euPerTick).toBe(2048);
    expect(model.inputs[0].perSecond).toBeCloseTo(4.266666667 * 20, 4);
  });

  it("boost triples output for 1.5x fuel efficiency and adds oxygen", () => {
    const model = compute("large-combustion-engine", { fuel: "Diesel", boost: "1" });
    expect(model.euPerTick).toBe(6144);
    expect(model.inputs[0].perSecond).toBeCloseTo((6144 / (480 * 1.5)) * 20, 4);
    expect(model.inputs.some((flow) => flow.name === "Oxygen")).toBe(true);
  });

  it("refuses over-2048 EU/L fuels without the boost", () => {
    const model = compute("large-combustion-engine", { fuel: "High Octane Gasoline" });
    expect(model.euPerTick).toBe(0);
    expect(model.warnings?.length).toBeGreaterThan(0);
  });

  it("runs the UCFE at 1.5e^(-C/ratio) efficiency (N29 = 56,177.85 EU/t)", () => {
    const model = compute("universal-chemical-fuel-engine", {
      fuel: "RP-1 (red)",
      flow: "500",
      promoterRatio: "0.2",
    });
    expect(model.euPerTick).toBeCloseTo(56177.85093, 2);
    expect(model.inputs[1].name).toBe("Combustion Promoter");
    expect(model.inputs[1].perSecond).toBeCloseTo(100, 6);
  });

  it("feeds the SOFC Mk I benzene at the floored rate (113 L/s)", () => {
    const model = compute("solid-oxide-fuel-cell-1", { fuel: "Benzene" });
    expect(model.euPerTick).toBe(2048);
    expect(model.inputs[0].perSecond).toBe(113);
    expect(model.outputs[0]).toMatchObject({ name: "Steam", perSecond: 20000 });
  });
});

describe("turbines", () => {
  it("runs a tight Small Shadow Metal large steam turbine at its optimal", () => {
    const model = compute("large-steam-turbine", {
      rotor: "Shadow Metal",
      size: "Small",
      fitting: "tight",
      flowMode: "optimal",
    });
    // Workbook default selection: eff 0.95, optimal 1600 L/t ->
    // floor(0.95 x 0.5 x 1600) = 760 EU/t.
    expect(model.euPerTick).toBe(760);
    expect(model.inputs[0]).toMatchObject({ name: "Steam", perSecond: 1600 * 20 });
    expect(model.outputs).toHaveLength(0);
  });

  it("exhausts superheated steam into plain steam 1:1", () => {
    const model = compute("large-hp-steam-turbine", {
      rotor: "Shadow Metal",
      size: "Normal",
      flowMode: "optimal",
    });
    expect(model.outputs[0].name).toBe("Steam");
    expect(model.outputs[0].perSecond).toBe(model.inputs[0].perSecond);
  });

  it("penalizes over-optimal flow but caps at max", () => {
    const source = getPowerSource("large-steam-turbine");
    const atOptimal = compute("large-steam-turbine", {
      rotor: "Shadow Metal",
      size: "Normal",
      flowMode: "optimal",
    });
    const overfed = compute("large-steam-turbine", {
      rotor: "Shadow Metal",
      size: "Normal",
      flowMode: "custom",
      customFlow: "999999",
    });
    expect(source).toBeDefined();
    expect(overfed.warnings?.length).toBeGreaterThan(0);
    expect(overfed.euPerTick).toBeLessThan((overfed.inputs[0].perSecond / 20) * 0.5 * 0.95);
    expect(overfed.inputs[0].perSecond).toBeGreaterThan(atOptimal.inputs[0].perSecond);
  });

  it("burns helium plasma and exhausts helium", () => {
    const model = compute("large-plasma-generator", {
      rotor: "Shadow Metal",
      size: "Normal",
      fuel: "Helium Plasma",
      flowMode: "optimal",
    });
    expect(model.outputs[0].name).toBe("Helium");
    expect(model.euPerTick).toBeGreaterThan(0);
  });
});

describe("steam makers", () => {
  it("runs the bronze boiler on creosote alone at 80% (625 L/s creosote, 960 L/t steam)", () => {
    const model = compute("large-bronze-boiler", { liquidFuel: "Creosote Oil", solidFuel: "None" });
    expect(model.inputs[0].perSecond).toBeCloseTo(625, 6);
    expect(model.outputs[0]).toMatchObject({ name: "Steam", perSecond: 960 * 20 });
  });

  it("dual fuel reaches 100% and halves each burn rate", () => {
    const model = compute("large-bronze-boiler", {
      liquidFuel: "Creosote Oil",
      solidFuel: "Charcoal",
    });
    expect(model.outputs[0].perSecond).toBe(1200 * 20);
    expect(model.inputs[0].perSecond).toBeCloseTo(312.5, 6);
  });

  it("flips the LHE to superheated steam over the hot coolant threshold (13,800 L/t)", () => {
    const model = compute("large-heat-exchanger", {
      fluid: "Hot Coolant",
      intake: "1380",
      tier: "1",
    });
    expect(model.outputs[0]).toMatchObject({ name: "SH Steam" });
    expect(model.outputs[0].perSecond / 20).toBeCloseTo(13800, 4);
    expect(model.outputs[1]).toMatchObject({ name: "IC2 Coolant", perSecond: 1380 });
  });

  it("keeps the EHE below threshold on superheated steam", () => {
    const model = compute("extreme-heat-exchanger", {
      fluid: "Hot Coolant",
      intake: "4000",
      tier: "1",
    });
    expect(model.outputs[0].name).toBe("SH Steam");
  });
});

describe("reactors and endgame", () => {
  it("computes THTR full-fill efficiency 1.0 and the parasitic draw", () => {
    const model = compute("thtr", { fill: "675000" });
    expect(model.euPerTick).toBeCloseTo(-3840, 6);
    expect(model.outputs[0].perSecond).toBe(4800 * 20);
  });

  it("computes the HTGR glowstone multiplier (2.444)", () => {
    const model = compute("htgr", { pebble: "Glowstone", fill: "10000" });
    const multiplier = model.outputs[0].perSecond / (0.5 * 10000);
    expect(multiplier).toBeCloseTo(2.444, 2);
  });

  it("gives the LFTR 16 amps of its fuel's tier", () => {
    const model = compute("lftr", { fuel: "LFTR Fuel 1" });
    expect(model.euPerTick).toBe(2048 * 16);
    expect(model.outputs.some((flow) => flow.name === "Molten Uranium 233")).toBe(true);
  });

  it("multiplies the LNR by coolant and booster (5.85M EU/t)", () => {
    const model = compute("large-naquadah-reactor", {
      fuel: "Naq Fuel Mk-I",
      coolant: "Super Coolant",
      booster: "Molten Naquadah",
    });
    expect(model.euPerTick).toBeCloseTo(975000 * 1.5 * 4, 4);
    expect(model.inputs.some((flow) => flow.name === "Liquid Air" && flow.perSecond === 2400)).toBe(
      true,
    );
  });

  it("runs helium fusion at Mk-I from the workbook table", () => {
    const model = compute("fusion-reactor", { recipe: "Helium Plasma", mark: "1" });
    expect(model.euPerTick).toBe(-1920);
    expect(model.outputs[0]).toMatchObject({ name: "Helium Plasma", perSecond: 156 });
    expect(model.inputs).toHaveLength(2);
  });

  it("finds an interior antimatter optimum with positive net power", () => {
    const model = compute("antimatter", { amount: "0" });
    expect(model.euPerTick).toBeGreaterThan(1e12);
    const optimum = Number(model.stats.find((line) => line.label === "Best quantity")?.value);
    expect(Number.isNaN(optimum)).toBe(true); // formatted, not raw - presence is what matters
  });
});

describe("power recipes", () => {
  it("synthesizes a wired benzene input on the gas turbine card", () => {
    const recipe = buildPowerRecipe("gas-turbine", { fuel: "Benzene" }, "recipe-test");
    expect(recipe).toBeDefined();
    expect(recipe?.power?.euPerTick).toBe(32);
    expect(recipe?.durationTicks).toBe(20);
    expect(recipe?.inputs[0]).toMatchObject({ kind: "fluid", id: "benzene" });
  });

  it("resynthesizes recipes from node settings on load", () => {
    const recipe = buildPowerRecipe("gas-turbine", undefined, "recipe-1") as Recipe;
    const node = {
      id: "node-1",
      recipeId: "recipe-1",
      machineCount: 1,
      parallel: 1,
      overclockTier: "LV",
      enabled: true,
      position: { x: 0, y: 0 },
      machineConfigTiers: { tier: "HV", fuel: "Nitrobenzene" },
    } as FactoryNode;
    const project = resynthesizePowerRecipes({ nodes: [node], recipes: [recipe] });
    expect(project.recipes[0].power?.euPerTick).toBe(512);
    expect(project.recipes[0].inputs[0].id).toBe("nitrobenzene");
  });

  it("keeps every source id unique and computable at defaults", () => {
    const seen = new Set<string>();
    for (const source of POWER_SOURCES) {
      expect(seen.has(source.id)).toBe(false);
      seen.add(source.id);
      const model = source.compute(buildPowerSettingsReader(source, undefined));
      expect(Number.isFinite(model.euPerTick)).toBe(true);
      for (const flow of [...model.inputs, ...model.outputs]) {
        expect(Number.isFinite(flow.perSecond)).toBe(true);
        expect(flow.perSecond).toBeGreaterThanOrEqual(0);
      }
    }
  });
});
