import { describe, expect, it } from "vitest";
import type {
  FactoryAnnotation,
  FactoryEdge,
  FactoryNode,
  FactoryPocket,
  FactoryStorage,
} from "@/lib/model/types";
import { buildTimelapseScript } from "./board-timelapse";

function node(id: string, x: number, y: number, pocketId?: string): FactoryNode {
  return {
    id,
    recipeId: `recipe-${id}`,
    machineCount: 1,
    parallel: 1,
    overclockTier: "LV",
    enabled: true,
    pocketId,
    position: { x, y },
  };
}

function storage(id: string, x: number, y: number, pocketId?: string): FactoryStorage {
  return { id, kind: "item", resourceId: "item:test", pocketId, position: { x, y } };
}

function edge(id: string, source: string, target: string): FactoryEdge {
  return { id, source, target, resourceKind: "item", resourceId: "item:test" };
}

function pocket(id: string, x: number, y: number, expanded?: boolean): FactoryPocket {
  return {
    id,
    name: id,
    position: { x, y },
    expanded,
    size: expanded ? { width: 400, height: 300 } : undefined,
  };
}

function annotation(id: string, x: number, y: number): FactoryAnnotation {
  return {
    id,
    kind: "text",
    position: { x, y },
    size: { width: 100, height: 40 },
  } as FactoryAnnotation;
}

const revealedOrder = (script: ReturnType<typeof buildTimelapseScript>) =>
  script.beats.flatMap((beat) => beat.nodeIds);

describe("buildTimelapseScript", () => {
  it("reveals a chain source first, wiring each hop on its second endpoint's beat", () => {
    const script = buildTimelapseScript({
      nodes: [node("a", 0, 0), node("b", 400, 0), node("c", 800, 0)],
      edges: [edge("ab", "a", "b"), edge("bc", "b", "c")],
    });

    expect(revealedOrder(script)).toEqual(["a", "b", "c"]);
    expect(script.beats.map((beat) => beat.edgeIds)).toEqual([[], ["ab"], ["bc"]]);
  });

  it("walks downstream even when the sink sits nearer the source than a feeder", () => {
    // d consumes both a and c; c consumes a. Feeder-completeness outranks
    // distance, so c comes before d however the cards are placed.
    const script = buildTimelapseScript({
      nodes: [node("a", 0, 0), node("d", 100, 0), node("c", 900, 0)],
      edges: [edge("ad", "a", "d"), edge("ac", "a", "c"), edge("cd", "c", "d")],
    });

    expect(revealedOrder(script)).toEqual(["a", "c", "d"]);
    const last = script.beats[script.beats.length - 1];
    expect([...last.edgeIds].sort()).toEqual(["ad", "cd"]);
  });

  it("still finishes a plan whose graph is one big cycle", () => {
    const script = buildTimelapseScript({
      nodes: [node("a", 0, 0), node("b", 400, 0)],
      edges: [edge("ab", "a", "b"), edge("ba", "b", "a")],
    });

    expect(revealedOrder(script).sort()).toEqual(["a", "b"]);
    expect(script.beats.flatMap((beat) => beat.edgeIds).sort()).toEqual(["ab", "ba"]);
  });

  it("stands an open board's frame up on the beat of its first member", () => {
    const script = buildTimelapseScript({
      nodes: [node("a", 0, 0), node("m", 40, 60, "board")],
      storages: [],
      pockets: [pocket("board", 600, 0, true)],
      edges: [edge("am", "a", "m")],
    });

    expect(script.beats[0].nodeIds).toEqual(["a"]);
    expect(script.beats[1].nodeIds).toEqual(["board", "m"]);
    expect(script.beats[1].edgeIds).toEqual(["am"]);
  });

  it("treats a collapsed board as one unit standing for its members", () => {
    const script = buildTimelapseScript({
      nodes: [node("a", 0, 0), node("m1", 40, 60, "board"), node("m2", 40, 120, "board")],
      pockets: [pocket("board", 600, 0, false)],
      edges: [edge("am1", "a", "m1"), edge("am2", "a", "m2"), edge("mm", "m1", "m2")],
    });

    expect(revealedOrder(script)).toEqual(["a", "board"]);
    // Both crossing wires land together; the internal one rides along as a
    // stray so nothing stays hidden after the run.
    expect(script.beats[1].edgeIds.sort()).toEqual(["am1", "am2", "mm"]);
  });

  it("draws ink last, in reading order", () => {
    const script = buildTimelapseScript({
      nodes: [node("a", 0, 0), node("b", 400, 0)],
      annotations: [annotation("note-low", 0, 500), annotation("note-high", 0, -100)],
      edges: [edge("ab", "a", "b")],
    });

    const inkBeats = script.beats.filter((beat) => beat.kind === "ink");
    expect(inkBeats.map((beat) => beat.nodeIds)).toEqual([["note-high"], ["note-low"]]);
    expect(script.beats.map((beat) => beat.kind)).toEqual(["card", "card", "ink", "ink"]);
  });

  it("reveals storages like any other card", () => {
    const script = buildTimelapseScript({
      nodes: [node("a", 0, 0)],
      storages: [storage("drawer", 400, 0)],
      edges: [edge("ad", "a", "drawer")],
    });

    expect(revealedOrder(script)).toEqual(["a", "drawer"]);
    expect(script.beats[1].edgeIds).toEqual(["ad"]);
  });
});
