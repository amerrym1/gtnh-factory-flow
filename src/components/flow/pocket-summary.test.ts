import { describe, expect, it } from "vitest";
import { calculateThroughput } from "@/lib/solver";
import { PROJECT_SCHEMA_VERSION, type FactoryProject } from "@/lib/model/types";
import {
  computePocketSummaries,
  countPocketCrossings,
  pocketCardHeight,
  POCKET_CARD_MAX_ROWS,
} from "./pocket-summary";

/**
 * A board holding its OWN source: a mine that needs nothing, feeding a
 * smelter, whose plates leave for a machine outside. The old card ran a
 * members-only solve and called this starving; nothing crosses the border
 * on the way in, so the summary must say so and simply report the plates
 * going out.
 */
function makeSelfFedBoard(): FactoryProject {
  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    id: "board-summary-project",
    name: "Board summary test",
    recipes: [
      {
        id: "mine",
        name: "Mine",
        machineType: "Ore Drill",
        minimumTier: "LV",
        durationTicks: 20,
        eut: 30,
        inputs: [],
        outputs: [{ kind: "item", id: "iron_ore", amount: 1 }],
      },
      {
        id: "smelt",
        name: "Smelt",
        machineType: "Electric Furnace",
        minimumTier: "LV",
        durationTicks: 20,
        eut: 30,
        inputs: [{ kind: "item", id: "iron_ore", amount: 1 }],
        outputs: [{ kind: "item", id: "iron_plate", amount: 1 }],
      },
      {
        id: "assemble",
        name: "Assemble",
        machineType: "Assembler",
        minimumTier: "LV",
        durationTicks: 20,
        eut: 30,
        inputs: [{ kind: "item", id: "iron_plate", amount: 1 }],
        // Nothing comes back out of it, so the chain has somewhere to put
        // its plates and the whole board runs.
        outputs: [],
      },
    ],
    nodes: [
      {
        id: "mine-1",
        recipeId: "mine",
        machineCount: 1,
        parallel: 1,
        overclockTier: "LV",
        enabled: true,
        position: { x: 0, y: 0 },
        pocketId: "board-1",
      },
      {
        id: "smelter",
        recipeId: "smelt",
        machineCount: 1,
        parallel: 1,
        overclockTier: "LV",
        enabled: true,
        position: { x: 300, y: 0 },
        pocketId: "board-1",
      },
      {
        id: "assembler",
        recipeId: "assemble",
        machineCount: 1,
        parallel: 1,
        overclockTier: "LV",
        enabled: true,
        position: { x: 900, y: 0 },
      },
    ],
    edges: [
      {
        id: "e-ore",
        source: "mine-1",
        target: "smelter",
        resourceKind: "item",
        resourceId: "iron_ore",
      },
      {
        id: "e-plate",
        source: "smelter",
        target: "assembler",
        resourceKind: "item",
        resourceId: "iron_plate",
      },
    ],
    storages: [],
    annotations: [],
    pockets: [{ id: "board-1", name: "Plates", position: { x: 0, y: 0 } }],
    fuelProfiles: [],
  };
}

describe("computePocketSummaries", () => {
  it("reports what crosses the border and never claims a shortage", () => {
    const project = makeSelfFedBoard();
    const result = calculateThroughput(project);
    const summary = computePocketSummaries(project, project.pockets ?? [], result).get("board-1");

    expect(summary).toBeDefined();
    // The ore never leaves the board, so it is not a border crossing — and
    // the board with its own source asks the outside world for nothing.
    expect(summary!.incoming).toEqual([]);
    expect(summary!.outgoing.map((crossing) => crossing.resourceId)).toEqual(["iron_plate"]);
    expect(summary!.outgoing[0]!.ratePerSecond).toBeGreaterThan(0);
    expect(summary!.outgoing[0]!.wireCount).toBe(1);

    expect(summary!.machineCount).toBe(2);
    expect(summary!.memberCount).toBe(2);
    expect(summary!.euPerTick).toBeGreaterThan(0);
  });

  it("reads zero rather than guessing when the plan has not been solved", () => {
    const project = makeSelfFedBoard();
    const summary = computePocketSummaries(project, project.pockets ?? []).get("board-1");
    expect(summary!.outgoing.map((crossing) => crossing.ratePerSecond)).toEqual([0]);
  });

  it("folds several wires carrying one resource into one line", () => {
    const project = makeSelfFedBoard();
    project.nodes.push({
      id: "assembler-2",
      recipeId: "assemble",
      machineCount: 1,
      parallel: 1,
      overclockTier: "LV",
      enabled: true,
      position: { x: 900, y: 400 },
    });
    project.edges.push({
      id: "e-plate-2",
      source: "smelter",
      target: "assembler-2",
      resourceKind: "item",
      resourceId: "iron_plate",
    });

    const summary = computePocketSummaries(
      project,
      project.pockets ?? [],
      calculateThroughput(project),
    ).get("board-1");
    expect(summary!.outgoing).toHaveLength(1);
    expect(summary!.outgoing[0]!.wireCount).toBe(2);
  });

  it("counts crossings without a solve, for the arranger", () => {
    expect(countPocketCrossings(makeSelfFedBoard(), "board-1")).toEqual({
      incoming: 0,
      outgoing: 1,
    });
  });
});

describe("pocketCardHeight", () => {
  it("stands on whole grid cells", () => {
    for (const [incoming, outgoing] of [
      [0, 0],
      [1, 0],
      [3, 2],
      [9, 9],
    ] as const) {
      expect(pocketCardHeight(incoming, outgoing) % 20).toBe(0);
    }
  });

  it("grows with the busier side, then stops", () => {
    expect(pocketCardHeight(2, 1)).toBeGreaterThan(pocketCardHeight(1, 1));
    // Past the cap the card gains one line for "and N more" and no more.
    const capped = pocketCardHeight(POCKET_CARD_MAX_ROWS, 0);
    expect(pocketCardHeight(POCKET_CARD_MAX_ROWS + 4, 0)).toBe(capped + 40);
    expect(pocketCardHeight(POCKET_CARD_MAX_ROWS + 40, 0)).toBe(capped + 40);
  });
});
