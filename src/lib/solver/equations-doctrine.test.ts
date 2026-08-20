import { describe, expect, it } from "vitest";
import { PROJECT_SCHEMA_VERSION, type FactoryProject, type FactoryStorage } from "@/lib/model/types";
import { calculateThroughput } from "./throughput";

/**
 * The equations doctrine exam: the acceptance boards from
 * docs/solver-equations.md whose game truth is known by hand or by the tick
 * simulator, run through the PRODUCTION path (calculateThroughput with the
 * equation books wired in). One op per second per recipe, so amounts read as
 * rates. The ruling these encode, Jack, 2026-08-19: if it would fail in the
 * game it fails here, and otherwise everything runs as hard as it can.
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

function node(id: string, recipeId: string) {
  return {
    id,
    recipeId,
    machineCount: 1,
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
  return { id: `e${edgeSeq}`, source, target, resourceKind: "item" as const, resourceId };
}

function project(over: Partial<FactoryProject>): FactoryProject {
  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    id: "eq-exam",
    name: "eq-exam",
    recipes: [],
    nodes: [],
    edges: [],
    fuelProfiles: [],
    ...over,
  } as FactoryProject;
}

describe("the equations doctrine", () => {
  it("runs a balanced chain at full speed", () => {
    const result = calculateThroughput(
      project({
        recipes: [recipe("make", [["ore", 1]], [["gear", 1]]), recipe("use", [["gear", 1]], [["kit", 1]])],
        nodes: [node("a", "make"), node("b", "use")],
        storages: [drawer("src", "ore"), drawer("out", "kit")],
        edges: [wire("src", "a", "ore"), wire("a", "b", "gear"), wire("b", "out", "kit")],
      }),
      { generatedAt: "fixed" },
    );
    expect(result.nodes["a"]!.utilization).toBeCloseTo(1, 5);
    expect(result.nodes["b"]!.utilization).toBeCloseTo(1, 5);
  });

  it("the clog is an equals sign: an overproducer runs at its taker's pace", () => {
    const result = calculateThroughput(
      project({
        recipes: [recipe("make", [["ore", 1]], [["gear", 10]]), recipe("use", [["gear", 5]], [["kit", 1]])],
        nodes: [node("a", "make"), node("b", "use")],
        storages: [drawer("src", "ore"), drawer("out", "kit")],
        edges: [wire("src", "a", "ore"), wire("a", "b", "gear"), wire("b", "out", "kit")],
      }),
      { generatedAt: "fixed" },
    );
    expect(result.nodes["a"]!.utilization).toBeCloseTo(0.5, 5);
    expect(result.nodes["b"]!.utilization).toBeCloseTo(1, 5);
  });

  it("a PRODUCT drawer on the spare output pulls the maker to full", () => {
    const result = calculateThroughput(
      project({
        recipes: [recipe("make", [["ore", 1]], [["gear", 10]]), recipe("use", [["gear", 5]], [["kit", 1]])],
        nodes: [node("a", "make"), node("b", "use")],
        storages: [drawer("src", "ore"), drawer("out", "kit"), drawer("spare", "gear")],
        edges: [
          wire("src", "a", "ore"),
          wire("a", "b", "gear"),
          wire("a", "spare", "gear"),
          wire("b", "out", "kit"),
        ],
      }),
      { generatedAt: "fixed" },
    );
    expect(result.nodes["a"]!.utilization).toBeCloseTo(1, 5);
    expect(result.nodes["b"]!.utilization).toBeCloseTo(1, 5);
  });

  it("a BYPRODUCT drawer on the spare output also lets the maker run full", () => {
    // The pill changes the bookkeeping, never the pace: in game a fed
    // machine with somewhere to put its surplus runs, and a drawer is
    // somewhere. Only the boundary lists care which pill the drawer wears.
    const result = calculateThroughput(
      project({
        recipes: [recipe("make", [["ore", 1]], [["gear", 10]]), recipe("use", [["gear", 5]], [["kit", 1]])],
        nodes: [node("a", "make"), node("b", "use")],
        storages: [drawer("src", "ore"), drawer("out", "kit"), drawer("spare", "gear", { drainMode: "byproduct" })],
        edges: [
          wire("src", "a", "ore"),
          wire("a", "b", "gear"),
          wire("a", "spare", "gear"),
          wire("b", "out", "kit"),
        ],
      }),
      { generatedAt: "fixed" },
    );
    expect(result.nodes["a"]!.utilization).toBeCloseTo(1, 5);
    expect(result.nodes["b"]!.utilization).toBeCloseTo(1, 5);
  });

  it("closes the mirror-lab hole: no phantom co-product finance", () => {
    // The parked mirror-bound bug's board: the refinery must jam to the
    // digester's pace, and the packer's line reads a tenth, not 100%.
    const result = calculateThroughput(
      project({
        recipes: [
          recipe("refine", [["crude", 1]], [["needium", 1], ["xium", 10]]),
          recipe("pack", [["needium", 1]], [["pack", 1]]),
          recipe("digest", [["xium", 10]], [["gold", 1], ["sludge", 10]]),
          recipe("boil", [["sludge", 1]], [["brick", 1]]),
        ],
        nodes: [node("refinery", "refine"), node("packer", "pack"), node("digester", "digest"), node("boiler", "boil")],
        storages: [drawer("s-crude", "crude"), drawer("s-pack", "pack"), drawer("s-gold", "gold"), drawer("s-brick", "brick")],
        edges: [
          wire("s-crude", "refinery", "crude"),
          wire("refinery", "packer", "needium"),
          wire("packer", "s-pack", "pack"),
          wire("refinery", "digester", "xium"),
          wire("digester", "s-gold", "gold"),
          wire("digester", "boiler", "sludge"),
          wire("boiler", "s-brick", "brick"),
        ],
      }),
      { generatedAt: "fixed" },
    );
    expect(result.nodes["boiler"]!.utilization).toBeCloseTo(1, 5);
    expect(result.nodes["digester"]!.utilization).toBeCloseTo(0.1, 5);
    expect(result.nodes["refinery"]!.utilization).toBeCloseTo(0.1, 5);
    expect(result.nodes["packer"]!.utilization).toBeCloseTo(0.1, 5);
  });

  it("a deficit loop reads zero with quiet wires", () => {
    const result = calculateThroughput(
      project({
        recipes: [
          recipe("mixline", [["lye", 9], ["ore", 1]], [["slurry", 1]]),
          recipe("refine", [["slurry", 1]], [["lye", 0.75], ["alumina", 1]]),
        ],
        nodes: [node("mx", "mixline"), node("rf", "refine")],
        storages: [drawer("src-ore", "ore"), drawer("d-al", "alumina")],
        edges: [
          wire("src-ore", "mx", "ore"),
          wire("mx", "rf", "slurry"),
          wire("rf", "mx", "lye"),
          wire("rf", "d-al", "alumina"),
        ],
      }),
      { generatedAt: "fixed" },
    );
    expect(result.nodes["mx"]!.utilization).toBeCloseTo(0, 5);
    expect(result.nodes["rf"]!.utilization).toBeCloseTo(0, 5);
  });

  it("a source into the mixer revives the deficit loop, importing only the shortfall", () => {
    // Digimen's fix, in miniature: with lye importable the loop runs flat
    // out, and the import stage buys only the genuine deficit (8.25 of 9)
    // because the recycled 0.75 displaces imports by conservation.
    const lyeImport = wire("src-lye", "mx", "lye");
    const result = calculateThroughput(
      project({
        recipes: [
          recipe("mixline", [["lye", 9], ["ore", 1]], [["slurry", 1]]),
          recipe("refine", [["slurry", 1]], [["lye", 0.75], ["alumina", 1]]),
        ],
        nodes: [node("mx", "mixline"), node("rf", "refine")],
        storages: [drawer("src-ore", "ore"), drawer("src-lye", "lye"), drawer("d-al", "alumina")],
        edges: [
          wire("src-ore", "mx", "ore"),
          lyeImport,
          wire("mx", "rf", "slurry"),
          wire("rf", "mx", "lye"),
          wire("rf", "d-al", "alumina"),
        ],
      }),
      { generatedAt: "fixed" },
    );
    expect(result.nodes["mx"]!.utilization).toBeCloseTo(1, 5);
    expect(result.nodes["rf"]!.utilization).toBeCloseTo(1, 5);
    expect(result.edges[lyeImport.id]!.transferredPerSecond).toBeCloseTo(8.25, 4);
  });

  it("a balanced ring holds its highest level", () => {
    // Gain exactly 1.0: the continuum resolves to the top because the
    // maximize stages leave no reason to sit lower.
    const result = calculateThroughput(
      project({
        recipes: [
          recipe("r1", [["la", 1], ["water", 1]], [["lb", 1], ["prod", 1]]),
          recipe("r2", [["lb", 1]], [["lc", 1]]),
          recipe("r3", [["lc", 1]], [["la", 1]]),
        ],
        nodes: [node("n1", "r1"), node("n2", "r2"), node("n3", "r3")],
        storages: [drawer("src-water", "water"), drawer("d-prod", "prod")],
        edges: [
          wire("src-water", "n1", "water"),
          wire("n1", "n2", "lb"),
          wire("n2", "n3", "lc"),
          wire("n3", "n1", "la"),
          wire("n1", "d-prod", "prod"),
        ],
      }),
      { generatedAt: "fixed" },
    );
    expect(result.nodes["n1"]!.utilization).toBeCloseTo(1, 5);
    expect(result.nodes["n2"]!.utilization).toBeCloseTo(1, 5);
    expect(result.nodes["n3"]!.utilization).toBeCloseTo(1, 5);
  });

  it("a machine wired only to a byproduct drawer still runs", () => {
    // In game nothing stops it: fed from a source, surplus caught. The old
    // "catches without motivating" idle was planner fiction and is gone.
    const result = calculateThroughput(
      project({
        recipes: [recipe("make", [["ore", 1]], [["gear", 1]])],
        nodes: [node("a", "make")],
        storages: [drawer("src", "ore"), drawer("spare", "gear", { drainMode: "byproduct" })],
        edges: [wire("src", "a", "ore"), wire("a", "spare", "gear")],
      }),
      { generatedAt: "fixed" },
    );
    expect(result.nodes["a"]!.utilization).toBeCloseTo(1, 5);
  });

  it("a tap on a break-even ring bleeds it dead", () => {
    // The ring passes on exactly what it eats, so alone it would hold at
    // 100%. Wiring a 2/s tap onto one of its outputs kills it: the tap's
    // hopper round-robins with the ring wire and cannot be refused, and a
    // gain-1.0 ring leaks to zero. The LP also contains the fantasy point
    // (ring spins, tap starves forever); the equal-fill rows are what
    // exclude it. If it would fail in the game, it fails here.
    const result = calculateThroughput(
      project({
        recipes: [
          recipe("r1", [["la", 10]], [["lb", 10]]),
          recipe("r2", [["lb", 10]], [["la", 10]]),
          recipe("tap", [["lb", 2]], [["kit", 1]]),
        ],
        nodes: [node("n1", "r1"), node("n2", "r2"), node("t", "tap")],
        storages: [drawer("out", "kit")],
        edges: [
          wire("n1", "n2", "lb"),
          wire("n2", "n1", "la"),
          wire("n1", "t", "lb"),
          wire("t", "out", "kit"),
        ],
      }),
      { generatedAt: "fixed" },
    );
    expect(result.nodes["n1"]!.utilization).toBeCloseTo(0, 5);
    expect(result.nodes["n2"]!.utilization).toBeCloseTo(0, 5);
    expect(result.nodes["t"]!.utilization).toBeCloseTo(0, 5);
  });

  it("contended supply splits fairly, never one twin starved", () => {
    // 10/s of gear for two consumers asking 8/s each: the game round-robins
    // items, so both run at 5/8ths. A lopsided corner (one full, one at a
    // quarter) satisfies the same totals and must not be picked.
    const result = calculateThroughput(
      project({
        recipes: [recipe("make", [["ore", 1]], [["gear", 10]]), recipe("use", [["gear", 8]], [["kit", 1]])],
        nodes: [node("p", "make"), node("c1", "use"), node("c2", "use")],
        storages: [drawer("src", "ore"), drawer("out", "kit")],
        edges: [
          wire("src", "p", "ore"),
          wire("p", "c1", "gear"),
          wire("p", "c2", "gear"),
          wire("c1", "out", "kit"),
          wire("c2", "out", "kit"),
        ],
      }),
      { generatedAt: "fixed" },
    );
    expect(result.nodes["p"]!.utilization).toBeCloseTo(1, 5);
    expect(result.nodes["c1"]!.utilization).toBeCloseTo(0.625, 4);
    expect(result.nodes["c2"]!.utilization).toBeCloseTo(0.625, 4);
  });
});
