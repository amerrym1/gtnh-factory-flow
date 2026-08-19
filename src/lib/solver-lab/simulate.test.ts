import { describe, expect, it } from "vitest";
import { PROJECT_SCHEMA_VERSION, type FactoryProject, type FactoryStorage } from "@/lib/model/types";
import { simulateSteadyState } from "./simulate";

/**
 * The truth machine's own exam: boards whose in-game steady state is
 * derivable by hand, asserted against the simulation. Every recipe runs one
 * op per second (20 ticks, LV), so amounts read as rates.
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
    id: "sim-lab",
    name: "sim-lab",
    recipes: [],
    nodes: [],
    edges: [],
    fuelProfiles: [],
    ...over,
  } as FactoryProject;
}

describe("the truth machine", () => {
  it("runs a balanced chain at full speed", () => {
    const sim = simulateSteadyState(
      project({
        recipes: [recipe("make", [["ore", 1]], [["gear", 1]]), recipe("use", [["gear", 1]], [["kit", 1]])],
        nodes: [node("a", "make"), node("b", "use")],
        storages: [drawer("src", "ore"), drawer("out", "kit")],
        edges: [wire("src", "a", "ore"), wire("a", "b", "gear"), wire("b", "out", "kit")],
      }),
    );
    expect(sim.settled).toBe(true);
    expect(sim.utilization["a"]).toBeCloseTo(1, 1);
    expect(sim.utilization["b"]).toBeCloseTo(1, 1);
  });

  it("jams an overproducer down to its taker's pace", () => {
    // 10 gears made per op, 5 eaten per op, no drawer: the output hopper
    // fills and the maker runs half the time. The game's clog, reproduced.
    const sim = simulateSteadyState(
      project({
        recipes: [recipe("make", [["ore", 1]], [["gear", 10]]), recipe("use", [["gear", 5]], [["kit", 1]])],
        nodes: [node("a", "make"), node("b", "use")],
        storages: [drawer("src", "ore"), drawer("out", "kit")],
        edges: [wire("src", "a", "ore"), wire("a", "b", "gear"), wire("b", "out", "kit")],
      }),
    );
    expect(sim.settled).toBe(true);
    expect(sim.utilization["a"]).toBeCloseTo(0.5, 1);
    expect(sim.utilization["b"]).toBeCloseTo(1, 1);
  });

  it("lets a drawer on the spare output unclog the maker", () => {
    const sim = simulateSteadyState(
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
    );
    expect(sim.settled).toBe(true);
    expect(sim.utilization["a"]).toBeCloseTo(1, 1);
    expect(sim.utilization["b"]).toBeCloseTo(1, 1);
  });

  it("drags the whole mirror-lab chain to the washer's pace", () => {
    // The parked bug's board (docs/solver-equations.md): the game answer is
    // 10% everywhere upstream of the little boiler, and the simulator is the
    // first component in this repo that reproduces it.
    const sim = simulateSteadyState(
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
    );
    expect(sim.settled).toBe(true);
    expect(sim.utilization["boiler"]).toBeCloseTo(1, 1);
    expect(sim.utilization["digester"]).toBeCloseTo(0.1, 1);
    expect(sim.utilization["refinery"]).toBeCloseTo(0.1, 1);
    expect(sim.utilization["packer"]).toBeCloseTo(0.1, 1);
  });

  it("burns the prime and dies on a deficit loop", () => {
    // The bauxite shape: the mixer needs 9 lye per op, the loop returns
    // 0.75. In game it runs while the primed lye lasts and then stands
    // still; the long-run rate is zero.
    const sim = simulateSteadyState(
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
    );
    expect(sim.utilization["mx"]).toBeLessThan(0.02);
    expect(sim.utilization["rf"]).toBeLessThan(0.02);
  });
});
