import { describe, expect, it } from "vitest";
import { PROJECT_SCHEMA_VERSION, type FactoryProject, type FactoryStorage } from "@/lib/model/types";
import { calculateThroughput } from "./throughput";

/**
 * Solve mode's exam, through the production path. One op per second per
 * machine (20-tick recipes), so amounts read as rates and the solved
 * machine count is the target divided by the per-machine rate.
 */

function recipe(id: string, inputs: [string, number][], outputs: [string, number][]) {
  return {
    id,
    name: id,
    machineType: "Lab Machine",
    minimumTier: "LV",
    durationTicks: 20,
    eut: 30,
    inputs: inputs.map(([itemId, amount]) => ({ kind: "item" as const, id: itemId, amount })),
    outputs: outputs.map(([itemId, amount]) => ({ kind: "item" as const, id: itemId, amount })),
  };
}

function node(id: string, recipeId: string, machineCount = 1) {
  return {
    id,
    recipeId,
    machineCount,
    parallel: 1,
    overclockTier: "LV",
    enabled: true,
    position: { x: 0, y: 0 },
  };
}

function drawer(id: string, resourceId: string, extra?: Partial<FactoryStorage>): FactoryStorage {
  return { id, kind: "item", resourceId, position: { x: 0, y: 0 }, ...extra };
}

let edgeSeq = 0;
function wire(source: string, target: string, resourceId: string) {
  edgeSeq += 1;
  return { id: `sm${edgeSeq}`, source, target, resourceKind: "item" as const, resourceId };
}

function project(over: Partial<FactoryProject>): FactoryProject {
  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    id: "solve-exam",
    name: "solve-exam",
    solveMode: true,
    recipes: [],
    nodes: [],
    edges: [],
    fuelProfiles: [],
    ...over,
  } as FactoryProject;
}

describe("solve mode", () => {
  it("scales a chain to exactly the typed amount", () => {
    const result = calculateThroughput(
      project({
        recipes: [recipe("make", [["ore", 1]], [["gear", 1]]), recipe("use", [["gear", 1]], [["kit", 1]])],
        nodes: [node("a", "make"), node("b", "use")],
        storages: [drawer("src", "ore"), drawer("out", "kit", { targetPerSecond: 3 })],
        edges: [wire("src", "a", "ore"), wire("a", "b", "gear"), wire("b", "out", "kit")],
      }),
      { generatedAt: "fixed" },
    );
    expect(result.nodes["a"]!.theoreticalMachinesRequired).toBeCloseTo(3, 5);
    expect(result.nodes["b"]!.theoreticalMachinesRequired).toBeCloseTo(3, 5);
    expect(result.storages["out"]!.producedPerSecond).toBeCloseTo(3, 5);
    expect(result.storages["out"]!.targetUnreachable).toBeUndefined();
    // Scaled books: EU rides the solved counts, 3x of two 30 EU/t machines.
    expect(result.totalEuT).toBeCloseTo(180, 4);
  });

  it("counts machines by recipe ratio, fractions allowed", () => {
    // make yields 10 gear per op, use eats 5: two kits per second wants use
    // at x2 and make at x1.
    const result = calculateThroughput(
      project({
        recipes: [recipe("make", [["ore", 1]], [["gear", 10]]), recipe("use", [["gear", 5]], [["kit", 1]])],
        nodes: [node("a", "make"), node("b", "use")],
        storages: [drawer("src", "ore"), drawer("out", "kit", { targetPerSecond: 2 })],
        edges: [wire("src", "a", "ore"), wire("a", "b", "gear"), wire("b", "out", "kit")],
      }),
      { generatedAt: "fixed" },
    );
    expect(result.nodes["a"]!.theoreticalMachinesRequired).toBeCloseTo(1, 5);
    expect(result.nodes["b"]!.theoreticalMachinesRequired).toBeCloseTo(2, 5);
  });

  it("built counts are the unit, not the ceiling: a half machine is a half", () => {
    const result = calculateThroughput(
      project({
        recipes: [recipe("make", [["ore", 1]], [["gear", 1]])],
        nodes: [node("a", "make", 4)],
        storages: [drawer("src", "ore"), drawer("out", "gear", { targetPerSecond: 2 })],
        edges: [wire("src", "a", "ore"), wire("a", "out", "gear")],
      }),
      { generatedAt: "fixed" },
    );
    // 4 built, each 1/s; 2/s needs 2 machines whatever was built.
    expect(result.nodes["a"]!.theoreticalMachinesRequired).toBeCloseTo(2, 5);
  });

  it("a chain no target needs solves to zero machines", () => {
    const result = calculateThroughput(
      project({
        recipes: [recipe("make", [["ore", 1]], [["gear", 1]])],
        nodes: [node("a", "make")],
        storages: [drawer("src", "ore"), drawer("out", "gear")],
        edges: [wire("src", "a", "ore"), wire("a", "out", "gear")],
      }),
      { generatedAt: "fixed" },
    );
    expect(result.nodes["a"]!.theoreticalMachinesRequired).toBeCloseTo(0, 5);
    expect(result.nodes["a"]!.utilization).toBe(0);
  });

  it("a byproduct drawer catches the ratio's forced overshoot", () => {
    // Every op makes 1 kit and 2 slag. Two kits per second necessarily
    // makes four slag per second; the byproduct drawer reads the spare.
    const result = calculateThroughput(
      project({
        recipes: [recipe("make", [["ore", 1]], [["kit", 1], ["slag", 2]])],
        nodes: [node("a", "make")],
        storages: [
          drawer("src", "ore"),
          drawer("out", "kit", { targetPerSecond: 2 }),
          drawer("spare", "slag", { drainMode: "byproduct" }),
        ],
        edges: [wire("src", "a", "ore"), wire("a", "out", "kit"), wire("a", "spare", "slag")],
      }),
      { generatedAt: "fixed" },
    );
    expect(result.nodes["a"]!.theoreticalMachinesRequired).toBeCloseTo(2, 5);
    expect(result.storages["spare"]!.producedPerSecond).toBeCloseTo(4, 5);
  });

  it("targets are minimums when two share one recipe's fixed ratio", () => {
    // The distillation shape: one op makes 1 heavy and 4 light. Asking for
    // 2 heavy and 1 light runs the tower for the heavy; the light target is
    // met with surplus rather than reported broken.
    const result = calculateThroughput(
      project({
        recipes: [recipe("still", [["oil", 1]], [["heavy", 1], ["light", 4]])],
        nodes: [node("a", "still")],
        storages: [
          drawer("src", "oil"),
          drawer("h", "heavy", { targetPerSecond: 2 }),
          drawer("l", "light", { targetPerSecond: 1 }),
        ],
        edges: [wire("src", "a", "oil"), wire("a", "h", "heavy"), wire("a", "l", "light")],
      }),
      { generatedAt: "fixed" },
    );
    expect(result.nodes["a"]!.theoreticalMachinesRequired).toBeCloseTo(2, 5);
    expect(result.storages["h"]!.producedPerSecond).toBeCloseTo(2, 5);
    expect(result.storages["l"]!.producedPerSecond).toBeCloseTo(8, 5);
    expect(result.storages["h"]!.targetUnreachable).toBeUndefined();
    expect(result.storages["l"]!.targetUnreachable).toBeUndefined();
  });

  it("names an unreachable target and still solves the rest", () => {
    // The gear chain's maker has a bare ore input (no source wire), so no
    // machine scale reaches the gear target; the kit chain still solves.
    const result = calculateThroughput(
      project({
        recipes: [
          recipe("make", [["ore", 1]], [["gear", 1]]),
          recipe("brew", [["water", 1]], [["kit", 1]]),
        ],
        nodes: [node("a", "make"), node("b", "brew")],
        storages: [
          drawer("w", "water"),
          drawer("g", "gear", { targetPerSecond: 1 }),
          drawer("k", "kit", { targetPerSecond: 2 }),
        ],
        edges: [wire("a", "g", "gear"), wire("w", "b", "water"), wire("b", "k", "kit")],
      }),
      { generatedAt: "fixed" },
    );
    expect(result.storages["g"]!.targetUnreachable).toBe(true);
    expect(result.storages["k"]!.targetUnreachable).toBeUndefined();
    expect(result.nodes["b"]!.theoreticalMachinesRequired).toBeCloseTo(2, 5);
    expect(result.bottlenecks.some((b) => b.id === "solve-target:g")).toBe(true);
  });

  it("a product with no number typed is unconstrained, not an error", () => {
    const result = calculateThroughput(
      project({
        recipes: [recipe("make", [["ore", 1]], [["gear", 1]])],
        nodes: [node("a", "make")],
        storages: [drawer("src", "ore"), drawer("out", "gear")],
        edges: [wire("src", "a", "ore"), wire("a", "out", "gear")],
      }),
      { generatedAt: "fixed" },
    );
    expect(result.storages["out"]!.targetUnreachable).toBeUndefined();
    expect(result.bottlenecks).toHaveLength(0);
  });
});
