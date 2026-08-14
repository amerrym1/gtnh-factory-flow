import { describe, expect, it } from "vitest";
import {
  getRecipeProgrammedCircuit,
  isProgrammedCircuitResource,
} from "./programmed-circuit";
import type { Recipe } from "./types";

function makeRecipe(recipe: Partial<Recipe>): Recipe {
  return {
    id: "test",
    name: "Test",
    kind: "gregtech_machine",
    machineType: "Assembler",
    minimumTier: "LV",
    durationTicks: 100,
    eut: 30,
    inputs: [],
    outputs: [],
    ...recipe,
  };
}

describe("isProgrammedCircuitResource", () => {
  it("matches the circuit item at any configuration", () => {
    expect(
      isProgrammedCircuitResource({ kind: "item", id: "gregtech:gt.integrated_circuit@11" }),
    ).toBe(true);
    expect(
      isProgrammedCircuitResource({ kind: "item", id: "gregtech:gt.integrated_circuit" }),
    ).toBe(true);
  });

  it("does not claim ordinary ingredients that happen to be circuits", () => {
    expect(isProgrammedCircuitResource({ kind: "item", id: "gregtech:gt.circuit_board@2" })).toBe(
      false,
    );
    expect(
      isProgrammedCircuitResource({ kind: "fluid", id: "gregtech:gt.integrated_circuit" }),
    ).toBe(false);
  });
});

describe("getRecipeProgrammedCircuit", () => {
  it("reports the setting and the item to draw", () => {
    const circuit = getRecipeProgrammedCircuit(
      makeRecipe({
        programmedCircuit: "11",
        inputs: [
          { kind: "item", id: "minecraft:iron_ingot", amount: 1 },
          { kind: "item", id: "gregtech:gt.integrated_circuit@11", amount: 0, consumed: false },
        ],
      }),
    );
    expect(circuit?.setting).toBe("11");
    expect(circuit?.resource?.id).toBe("gregtech:gt.integrated_circuit@11");
  });

  it("still answers for a GregTech recipe with no setting, so the empty slot draws", () => {
    const circuit = getRecipeProgrammedCircuit(makeRecipe({ inputs: [] }));
    expect(circuit).toEqual({ setting: undefined, resource: undefined });
  });

  it("ignores a setting that is a whole item id rather than a dial number", () => {
    const circuit = getRecipeProgrammedCircuit(
      makeRecipe({ programmedCircuit: "configuration 32100" }),
    );
    expect(circuit?.setting).toBeUndefined();
  });

  it("has nothing to say about a recipe with no circuit slot", () => {
    expect(
      getRecipeProgrammedCircuit(makeRecipe({ kind: "crop_produce", programmedCircuit: "2" })),
    ).toBeUndefined();
  });
});
