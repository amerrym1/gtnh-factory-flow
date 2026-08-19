import { describe, expect, it } from "vitest";
import { PROJECT_SCHEMA_VERSION, type FactoryProject, type FactoryStorage } from "@/lib/model/types";
import { solveEquations } from "./equations";

/**
 * The equations prototype's exam: the acceptance boards from
 * docs/solver-equations.md whose game truth is known by hand or by the
 * truth machine. One op per second per recipe, so amounts read as rates.
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
    id: "eq-lab",
    name: "eq-lab",
    recipes: [],
    nodes: [],
    edges: [],
    fuelProfiles: [],
    ...over,
  } as FactoryProject;
}

describe("the equations prototype", async () => {
  it("runs a balanced chain at full speed", async () => {
    const result = await solveEquations(
      project({
        recipes: [recipe("make", [["ore", 1]], [["gear", 1]]), recipe("use", [["gear", 1]], [["kit", 1]])],
        nodes: [node("a", "make"), node("b", "use")],
        storages: [drawer("src", "ore"), drawer("out", "kit")],
        edges: [wire("src", "a", "ore"), wire("a", "b", "gear"), wire("b", "out", "kit")],
      }),
    );
    expect(result.status).toBe("optimal");
    expect(result.utilization["a"]).toBeCloseTo(1, 5);
    expect(result.utilization["b"]).toBeCloseTo(1, 5);
  });

  it("the clog is an equals sign: an overproducer runs at its taker's pace", async () => {
    const result = await solveEquations(
      project({
        recipes: [recipe("make", [["ore", 1]], [["gear", 10]]), recipe("use", [["gear", 5]], [["kit", 1]])],
        nodes: [node("a", "make"), node("b", "use")],
        storages: [drawer("src", "ore"), drawer("out", "kit")],
        edges: [wire("src", "a", "ore"), wire("a", "b", "gear"), wire("b", "out", "kit")],
      }),
    );
    expect(result.status).toBe("optimal");
    expect(result.utilization["a"]).toBeCloseTo(0.5, 5);
    expect(result.utilization["b"]).toBeCloseTo(1, 5);
  });

  it("a PRODUCT drawer on the spare output pulls the maker to full", async () => {
    const result = await solveEquations(
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
    expect(result.status).toBe("optimal");
    expect(result.utilization["a"]).toBeCloseTo(1, 5);
    expect(result.utilization["b"]).toBeCloseTo(1, 5);
  });

  it("a BYPRODUCT drawer on the spare output unclogs without motivating", async () => {
    // House doctrine, kept: the byproduct drawer catches the surplus so the
    // maker is not clogged, but only the real consumer sets the pace - the
    // maker runs at 50%, not flat out for the drawer's sake.
    const result = await solveEquations(
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
    );
    expect(result.status).toBe("optimal");
    expect(result.utilization["a"]).toBeCloseTo(0.5, 5);
    expect(result.utilization["b"]).toBeCloseTo(1, 5);
  });

  it("closes the mirror-lab hole: no phantom co-product finance", async () => {
    // The parked bug's board: the refinery must jam to the digester's pace,
    // and the packer's iron line reads a tenth, not the dream's 100%.
    const result = await solveEquations(
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
    expect(result.status).toBe("optimal");
    expect(result.utilization["boiler"]).toBeCloseTo(1, 5);
    expect(result.utilization["digester"]).toBeCloseTo(0.1, 5);
    expect(result.utilization["refinery"]).toBeCloseTo(0.1, 5);
    expect(result.utilization["packer"]).toBeCloseTo(0.1, 5);
  });

  it("a deficit loop reads zero with quiet wires", async () => {
    const result = await solveEquations(
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
    expect(result.status).toBe("optimal");
    expect(result.utilization["mx"]).toBeCloseTo(0, 5);
    expect(result.utilization["rf"]).toBeCloseTo(0, 5);
  });

  it("a source into the mixer revives the deficit loop", async () => {
    // Digimen's fix, in miniature: with lye importable the loop runs flat
    // out, and stage 3 imports only the genuine shortfall (8.25 of 9).
    const result = await solveEquations(
      project({
        recipes: [
          recipe("mixline", [["lye", 9], ["ore", 1]], [["slurry", 1]]),
          recipe("refine", [["slurry", 1]], [["lye", 0.75], ["alumina", 1]]),
        ],
        nodes: [node("mx", "mixline"), node("rf", "refine")],
        storages: [drawer("src-ore", "ore"), drawer("src-lye", "lye"), drawer("d-al", "alumina")],
        edges: [
          wire("src-ore", "mx", "ore"),
          wire("src-lye", "mx", "lye"),
          wire("mx", "rf", "slurry"),
          wire("rf", "mx", "lye"),
          wire("rf", "d-al", "alumina"),
        ],
      }),
    );
    expect(result.status).toBe("optimal");
    expect(result.utilization["mx"]).toBeCloseTo(1, 5);
    expect(result.utilization["rf"]).toBeCloseTo(1, 5);
    expect(result.sourcePullPerSecond["src-lye"]).toBeCloseTo(8.25, 4);
  });

  it("a balanced ring holds its highest level", async () => {
    // Gain exactly 1.0: the continuum resolves to the top because stage 1
    // maximizes the product the ring feeds.
    const result = await solveEquations(
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
    );
    expect(result.status).toBe("optimal");
    expect(result.utilization["n1"]).toBeCloseTo(1, 5);
    expect(result.utilization["n2"]).toBeCloseTo(1, 5);
    expect(result.utilization["n3"]).toBeCloseTo(1, 5);
  });

  it("a byproduct drawer catches without motivating", async () => {
    // A machine wired only to a byproduct drawer idles: nothing pulls it.
    const result = await solveEquations(
      project({
        recipes: [recipe("make", [["ore", 1]], [["gear", 1]])],
        nodes: [node("a", "make")],
        storages: [drawer("src", "ore"), drawer("spare", "gear", { drainMode: "byproduct" })],
        edges: [wire("src", "a", "ore"), wire("a", "spare", "gear")],
      }),
    );
    expect(result.status).toBe("optimal");
    expect(result.utilization["a"]).toBeCloseTo(0, 5);
  });
});
