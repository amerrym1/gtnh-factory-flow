import { describe, expect, it } from "vitest";
import { PROJECT_SCHEMA_VERSION, type FactoryProject, type FactoryStorage } from "@/lib/model/types";
import { calculateThroughput } from "@/lib/solver/throughput";
import { findDeathSpirals } from "./death-spiral";
import { describeClogLock, describeClogLockForNode, findClogLocks } from "./clog-lock";
import { deriveNodeVerdict } from "./node-verdict";

/**
 * The clog lock's exam: the minimal board is two machines whose loop hands
 * back more of its own feedstock than it drinks. In game that line runs
 * until every chest is full, then freezes solid with every slot stuffed;
 * on the board it reads as a field of 0% with no author. The detector must
 * name it, name the surplus, and stay silent about everything that is not
 * this exact disease.
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
    id: "clog-lock-exam",
    name: "clog-lock-exam",
    recipes: [],
    nodes: [],
    edges: [],
    fuelProfiles: [],
    ...over,
  } as FactoryProject;
}

const LOOP_RECIPES = [
  recipe("weave", [["thread", 1]], [["cloth", 2]]),
  recipe("unravel", [["cloth", 2]], [["thread", 2]]),
];

function loopProject(extra?: Partial<FactoryProject>): FactoryProject {
  return project({
    recipes: LOOP_RECIPES,
    nodes: [node("m1", "weave"), node("m2", "unravel")],
    edges: [wire("m1", "m2", "cloth"), wire("m2", "m1", "thread")],
    ...extra,
  });
}

describe("findClogLocks", () => {
  it("names the two-machine loop that breeds its own feedstock", () => {
    const proj = loopProject();
    const result = calculateThroughput(proj, { generatedAt: "fixed" });

    expect(result.nodes["m1"]!.utilization).toBeCloseTo(0, 4);
    expect(result.nodes["m2"]!.utilization).toBeCloseTo(0, 4);

    const { locks, byNode, byEdge } = findClogLocks(proj, result);
    expect(locks).toHaveLength(1);
    expect(locks[0]!.machineIds).toEqual(["m1", "m2"]);
    expect(byNode.get("m1")).toBe(byNode.get("m2"));

    // Only the vent site and its surplus wire carry the light: the drawer
    // goes on the thread line out of m2, so that is what flashes. m1 keeps
    // the verdict and the story, never a ring.
    expect(locks[0]!.ventNodeIds).toEqual(["m2"]);
    const threadWire = proj.edges.find((edge) => edge.resourceId === "thread")!;
    const clothWire = proj.edges.find((edge) => edge.resourceId === "cloth")!;
    expect(byEdge.has(threadWire.id)).toBe(true);
    expect(byEdge.has(clothWire.id)).toBe(false);

    // The vent names thread as the surplus with no home: the loop spends 1
    // and gets 2 back per lap, so about 1/s must leave for it to run.
    const vent = locks[0]!.vents[0]!;
    expect(vent.resourceKey).toBe("item:thread");
    expect(vent.perSecond).toBeCloseTo(1, 2);

    const story = describeClogLock(locks[0]!);
    expect(story.fix).toContain("thread");
    expect(story.fix).toContain("drawer");

    // The culprit's card speaks in the first person; the victim's card says
    // why it is frozen and names the machine to go fix, so twenty cards
    // never share one generic sentence with no address in it.
    const culprit = describeClogLockForNode(locks[0]!, "m2");
    expect(culprit.title).toContain("nowhere to go");
    expect(culprit.detail).toContain("drawer");
    const victim = describeClogLockForNode(locks[0]!, "m1");
    expect(victim.title).toBe("Frozen by a clog lock");
    expect(victim.detail).toContain("unravel");

    // The card wears it as its verdict, so the strip and hover explain it.
    expect(deriveNodeVerdict(proj, result, "m1").kind).toBe("clog-lock");

    // And the death spiral stays silent: this loop is stuffed, not starving.
    expect(findDeathSpirals(proj, result).spirals).toHaveLength(0);
  });

  it("keeps only the vents the lock truly needs, not every full-throttle spill", () => {
    // The thread lock again, but unravel also makes sawdust for a sander
    // that can only chew a third of it. At full throttle sawdust overflows
    // too - but the board RUNS with just a thread drawer (the line settles
    // at a third and the sander keeps up), so sawdust is an ordinary clog,
    // not part of the lock. The fix list must say thread and only thread.
    const proj = project({
      recipes: [
        recipe("weave", [["thread", 1]], [["cloth", 2]]),
        recipe("unravel2", [["cloth", 2]], [["thread", 2], ["sawdust", 3]]),
        recipe("sand", [["sawdust", 1]], [["grit", 1]]),
      ],
      nodes: [node("m1", "weave"), node("m2", "unravel2"), node("s", "sand")],
      storages: [drawer("d-grit", "grit")],
      edges: [
        wire("m1", "m2", "cloth"),
        wire("m2", "m1", "thread"),
        wire("m2", "s", "sawdust"),
        wire("s", "d-grit", "grit"),
      ],
    });
    const result = calculateThroughput(proj, { generatedAt: "fixed" });

    expect(result.nodes["m1"]!.utilization).toBeCloseTo(0, 4);
    expect(result.nodes["s"]!.utilization).toBeCloseTo(0, 4);

    const { locks } = findClogLocks(proj, result);
    expect(locks).toHaveLength(1);
    expect(locks[0]!.machineIds).toEqual(["m1", "m2", "s"]);
    expect(locks[0]!.vents).toHaveLength(1);
    expect(locks[0]!.vents[0]!.resourceKey).toBe("item:thread");
    expect(locks[0]!.ventNodeIds).toEqual(["m2"]);
  });

  it("says nothing once the surplus has a drawer", () => {
    const proj = loopProject({
      storages: [drawer("d", "thread", { drainMode: "byproduct" })],
      edges: [wire("m1", "m2", "cloth"), wire("m2", "m1", "thread"), wire("m2", "d", "thread")],
    });
    const result = calculateThroughput(proj, { generatedAt: "fixed" });

    expect(result.nodes["m1"]!.utilization).toBeCloseTo(1, 4);
    expect(findClogLocks(proj, result).locks).toHaveLength(0);
  });

  it("says nothing about a starving ring: that is the death spiral's case", () => {
    // The loop loses on every lap (2 in, 1 back) and venting surplus cannot
    // feed anyone, so nothing revives and the clog lock stays quiet.
    const proj = project({
      recipes: [
        recipe("forward", [["a", 2]], [["b", 2]]),
        recipe("back", [["b", 2]], [["a", 1]]),
      ],
      nodes: [node("m1", "forward"), node("m2", "back")],
      edges: [wire("m1", "m2", "b"), wire("m2", "m1", "a")],
    });
    const result = calculateThroughput(proj, { generatedAt: "fixed" });

    expect(result.nodes["m1"]!.utilization).toBeCloseTo(0, 4);
    expect(findClogLocks(proj, result).locks).toHaveLength(0);
    expect(findDeathSpirals(proj, result).spirals).toHaveLength(1);
  });

  it("says nothing about an ordinary throttled overproducer", () => {
    // Maker at half speed because its taker eats half: paced, not frozen.
    const proj = project({
      recipes: [
        recipe("make", [], [["gear", 10]]),
        recipe("use", [["gear", 5]], [["kit", 1]]),
      ],
      nodes: [node("a", "make"), node("b", "use")],
      storages: [drawer("src", "ore"), drawer("out", "kit")],
      edges: [wire("a", "b", "gear"), wire("b", "out", "kit")],
    });
    const result = calculateThroughput(proj, { generatedAt: "fixed" });

    expect(result.nodes["a"]!.utilization).toBeCloseTo(0.5, 4);
    expect(findClogLocks(proj, result).locks).toHaveLength(0);
  });

  it("stays quiet on a machine that is merely unwired", () => {
    // A bare output pins its machine, but that is the unwired story: venting
    // does not revive it, so no lock is claimed.
    const proj = project({
      recipes: [recipe("make", [["ore", 1]], [["gear", 1], ["dust", 1]])],
      nodes: [node("a", "make")],
      storages: [drawer("src", "ore"), drawer("out", "gear")],
      edges: [wire("src", "a", "ore"), wire("a", "out", "gear")],
    });
    const result = calculateThroughput(proj, { generatedAt: "fixed" });

    expect(result.nodes["a"]!.utilization).toBeCloseTo(0, 4);
    expect(findClogLocks(proj, result).locks).toHaveLength(0);
  });
  it("stays quiet when the taker is stopped by an unwired slot of its own", () => {
    // A mine feeds a smelter whose flux slot is still bare, and a press
    // waits behind the smelter. The mine sits at 0% with its ore wire full,
    // exactly what a clog lock looks like from the outside - but the ore
    // has a taker, and that taker has simply not been finished. No lock:
    // the mine says who stopped, the press says who starved it, and the
    // smelter's own card marks the slot. Unwiring one slot on a working
    // line must never light the rest of it up as a jam.
    const proj = project({
      recipes: [
        recipe("mine", [], [["ore", 1]]),
        recipe("smelt", [["ore", 1], ["flux", 1]], [["ingot", 1]]),
        recipe("press", [["ingot", 1]], [["plate", 1]]),
      ],
      nodes: [node("a", "mine"), node("b", "smelt"), node("c", "press")],
      storages: [drawer("out", "plate")],
      edges: [wire("a", "b", "ore"), wire("b", "c", "ingot"), wire("c", "out", "plate")],
    });
    const result = calculateThroughput(proj, { generatedAt: "fixed" });

    expect(result.nodes["a"]!.utilization).toBeCloseTo(0, 4);
    expect(findClogLocks(proj, result).locks).toHaveLength(0);
    expect(findDeathSpirals(proj, result).spirals).toHaveLength(0);

    const mine = deriveNodeVerdict(proj, result, "a");
    expect(mine.kind).toBe("clogged");
    expect(mine.clog?.stoppedTakerName).toBe("Lab Machine");
    expect(mine.clog?.takenPerSecond).toBe(0);
    expect(deriveNodeVerdict(proj, result, "b").kind).toBe("unwired");
    const press = deriveNodeVerdict(proj, result, "c");
    expect(press.kind).toBe("starved");
    expect(press.binding?.upstream?.pct).toBe(0);
  });

  it("stays quiet on a source feeding a ring whose member is unwired", () => {
    // The loop that used to breed thread, with a dye slot left bare on the
    // weaver and a thread source wired in. Every card reads 0%: the source
    // once wore CLOG LOCK and the unraveller DEAD LOOP, two alarms for one
    // missing wire. Now the weaver alone says unwired, the source says it
    // is waiting on the weaver, and the unraveller says who starved it.
    const proj = project({
      recipes: [
        recipe("weave", [["thread", 1], ["dye", 1]], [["cloth", 2]]),
        recipe("unravel", [["cloth", 2]], [["thread", 1]]),
        recipe("spin", [], [["thread", 1]]),
      ],
      nodes: [node("m1", "weave"), node("m2", "unravel"), node("s", "spin")],
      edges: [wire("m1", "m2", "cloth"), wire("m2", "m1", "thread"), wire("s", "m1", "thread")],
    });
    const result = calculateThroughput(proj, { generatedAt: "fixed" });

    expect(findClogLocks(proj, result).locks).toHaveLength(0);
    expect(findDeathSpirals(proj, result).spirals).toHaveLength(0);
    expect(deriveNodeVerdict(proj, result, "m1").kind).toBe("unwired");
    expect(deriveNodeVerdict(proj, result, "m2").kind).toBe("starved");
    const source = deriveNodeVerdict(proj, result, "s");
    expect(source.kind).toBe("clogged");
    expect(source.clog?.stoppedTakerName).toBe("Lab Machine");
  });

  it("still names the lock when the surplus's taker is a jammed member", () => {
    // The plain thread loop: the sweep that withdraws vents on dead takers
    // must keep a vent whose taker the vent itself revives - that IS the
    // lock, and the sweep must never talk itself out of it.
    const proj = loopProject();
    const result = calculateThroughput(proj, { generatedAt: "fixed" });
    expect(findClogLocks(proj, result).locks).toHaveLength(1);
  });
});
