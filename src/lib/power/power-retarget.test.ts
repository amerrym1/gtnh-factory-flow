import { describe, expect, it } from "vitest";
import { useFactoryStore } from "@/store/factory-store";
import { buildPowerRecipe } from "./power-recipe";
import { PROJECT_SCHEMA_VERSION, type FactoryProject } from "@/lib/model/types";

/**
 * Switching a power card's fuel with wires attached: a source drawer that
 * serves ONLY this card follows the fuel (same wire, new resource); a drawer
 * with other duties keeps them and just loses this wire; a machine at the
 * far end always loses the wire - its output is what it is.
 */
const TURBINE_SETTINGS = {
  rotor: "Carbon",
  size: "Normal",
  fitting: "tight",
  flowMode: "optimal",
  fuel: "Benzene",
};

function turbineProject(extra: Partial<FactoryProject>): FactoryProject {
  const recipe = buildPowerRecipe("large-gas-turbine", TURBINE_SETTINGS, "r-gt")!;
  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    id: "p",
    name: "p",
    recipes: [recipe],
    nodes: [
      {
        id: "n-gt",
        recipeId: "r-gt",
        machineCount: 1,
        parallel: 1,
        overclockTier: "LV",
        enabled: true,
        position: { x: 0, y: 0 },
        machineConfigTiers: TURBINE_SETTINGS,
      },
    ],
    storages: [
      { id: "s", kind: "fluid", resourceId: "benzene", displayName: "Benzene", position: { x: 0, y: 0 } },
    ],
    edges: [
      {
        id: "e",
        source: "s",
        target: "n-gt",
        sourceHandle: "output:fluid:benzene",
        targetHandle: "input:fluid:benzene",
        resourceKind: "fluid",
        resourceId: "benzene",
      },
    ],
    fuelProfiles: [],
    setupRules: { freeInputs: true, freeOutputs: true },
    ...extra,
  } as unknown as FactoryProject;
}

describe("fuel switches with wires attached", () => {
  it("retargets a lone source drawer to the new fuel, wire intact", () => {
    useFactoryStore.getState().setProject(turbineProject({}));
    useFactoryStore.getState().setPowerSetting("n-gt", "fuel", "Nitrobenzene");
    const after = useFactoryStore.getState().project;
    expect(after.storages?.[0]).toMatchObject({ resourceId: "nitrobenzene", kind: "fluid" });
    expect(after.edges[0]).toMatchObject({
      resourceId: "nitrobenzene",
      sourceHandle: "output:fluid:nitrobenzene",
      targetHandle: "input:fluid:nitrobenzene",
    });
  });

  it("only drops the wire when the drawer serves anything else", () => {
    const base = turbineProject({});
    const recipe2 = buildPowerRecipe("large-gas-turbine", TURBINE_SETTINGS, "r-gt2")!;
    useFactoryStore.getState().setProject({
      ...base,
      recipes: [...base.recipes, recipe2],
      nodes: [
        ...base.nodes,
        {
          id: "n-other",
          recipeId: "r-gt2",
          machineCount: 1,
          parallel: 1,
          overclockTier: "LV",
          enabled: true,
          position: { x: 0, y: 200 },
          machineConfigTiers: TURBINE_SETTINGS,
        },
      ],
      edges: [
        ...base.edges,
        {
          id: "e2",
          source: "s",
          target: "n-other",
          resourceKind: "fluid",
          resourceId: "benzene",
        },
      ],
    } as FactoryProject);
    useFactoryStore.getState().setPowerSetting("n-gt", "fuel", "Nitrobenzene");
    const after = useFactoryStore.getState().project;
    // The drawer still owes benzene to the other card, so it stays benzene;
    // the switched card's wire is gone, the other card's survives.
    expect(after.storages?.[0]?.resourceId).toBe("benzene");
    expect(after.edges.map((edge) => edge.id).sort()).toEqual(["e2"]);
  });

  it("drops the wire when the far end is a machine", () => {
    const base = turbineProject({});
    const maker = {
      id: "r-maker",
      name: "maker",
      machineType: "Distillery",
      minimumTier: "LV",
      durationTicks: 20,
      eut: 24,
      inputs: [],
      outputs: [{ kind: "fluid" as const, id: "benzene", amount: 40 }],
    };
    useFactoryStore.getState().setProject({
      ...base,
      recipes: [...base.recipes, maker],
      nodes: [
        ...base.nodes,
        {
          id: "n-maker",
          recipeId: "r-maker",
          machineCount: 1,
          parallel: 1,
          overclockTier: "LV",
          enabled: true,
          position: { x: 0, y: 200 },
        },
      ],
      storages: [],
      edges: [
        {
          id: "e-machine",
          source: "n-maker",
          target: "n-gt",
          resourceKind: "fluid",
          resourceId: "benzene",
        },
      ],
    } as FactoryProject);
    useFactoryStore.getState().setPowerSetting("n-gt", "fuel", "Nitrobenzene");
    const after = useFactoryStore.getState().project;
    expect(after.edges).toHaveLength(0);
    expect(after.recipes.find((entry) => entry.id === "r-gt")?.inputs[0]?.id).toBe("nitrobenzene");
  });
});
