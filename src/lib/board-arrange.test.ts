import { describe, expect, it } from "vitest";
import {
  arrangeBoard,
  type ArrangeCard,
  type ArrangeMove,
  type ArrangeWire,
} from "./board-arrange";
import { BOARD_GRID } from "./board-grid";

function card(id: string, overrides: Partial<ArrangeCard> = {}): ArrangeCard {
  return { id, x: 0, y: 0, width: 360, height: 280, ...overrides };
}

function wire(source: string, target: string, extra: Partial<ArrangeWire> = {}): ArrangeWire {
  return { source, target, ...extra };
}

function positionsById(moves: ArrangeMove[]) {
  return new Map(moves.map((move) => [move.id, move.position]));
}

function rectsOverlap(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

function expectNoOverlaps(cards: ArrangeCard[], moves: ArrangeMove[]) {
  const byId = positionsById(moves);
  const rects = cards.map((c) => {
    const p = byId.get(c.id)!;
    return { id: c.id, x: p.x, y: p.y, width: c.width, height: c.height };
  });
  for (let i = 0; i < rects.length; i += 1) {
    for (let j = i + 1; j < rects.length; j += 1) {
      expect(
        rectsOverlap(rects[i], rects[j]),
        `${rects[i].id} overlaps ${rects[j].id}`,
      ).toBe(false);
    }
  }
}

describe("arrangeBoard", () => {
  it("lays a chain out left to right on the grid", () => {
    const cards = [card("c", { x: 500, y: 900 }), card("a", { x: 40, y: 40 }), card("b")];
    const { moves } = arrangeBoard({ cards, wires: [wire("a", "b"), wire("b", "c")] });
    const p = positionsById(moves);

    expect(p.get("a")!.x).toBeLessThan(p.get("b")!.x);
    expect(p.get("b")!.x).toBeLessThan(p.get("c")!.x);
    for (const move of moves) {
      expect(move.position.x % BOARD_GRID).toBe(0);
      expect(move.position.y % BOARD_GRID).toBe(0);
    }
    expectNoOverlaps(cards, moves);
  });

  it("is deterministic, and independent of where the cards started", () => {
    const wires = [wire("a", "b"), wire("a", "c"), wire("b", "d"), wire("c", "d")];
    const near = [card("a"), card("b"), card("c"), card("d")];
    const scattered = [
      card("a", { x: 5000, y: -2000 }),
      card("b", { x: -400, y: 60 }),
      card("c", { x: 120, y: 8000 }),
      card("d", { x: 0, y: 0 }),
    ];

    const first = arrangeBoard({ cards: near, wires, origin: { x: 0, y: 0 } });
    const second = arrangeBoard({ cards: near, wires, origin: { x: 0, y: 0 } });
    const moved = arrangeBoard({ cards: scattered, wires, origin: { x: 0, y: 0 } });

    expect(second).toEqual(first);
    expect(moved).toEqual(first);
  });

  it("anchors the layout at the old bounding box by default", () => {
    const cards = [card("a", { x: 1000, y: 2000 }), card("b", { x: 1400, y: 2400 })];
    const { moves } = arrangeBoard({ cards, wires: [wire("a", "b")] });
    const p = positionsById(moves);
    expect(Math.min(p.get("a")!.x, p.get("b")!.x)).toBe(1000);
    expect(Math.min(p.get("a")!.y, p.get("b")!.y)).toBe(2000);
  });

  it("keeps separate islands apart", () => {
    const cards = [
      card("a1"),
      card("a2"),
      card("a3"),
      card("b1"),
      card("b2"),
    ];
    const { moves } = arrangeBoard({
      cards,
      wires: [wire("a1", "a2"), wire("a2", "a3"), wire("b1", "b2")],
      origin: { x: 0, y: 0 },
    });
    const p = positionsById(moves);
    // Apart on SOME axis by a clear island gap - side by side or stacked,
    // never interleaved.
    const aRight = Math.max(...["a1", "a2", "a3"].map((id) => p.get(id)!.x + 360));
    const aBottom = Math.max(...["a1", "a2", "a3"].map((id) => p.get(id)!.y + 280));
    const bLeft = Math.min(...["b1", "b2"].map((id) => p.get(id)!.x));
    const bTop = Math.min(...["b1", "b2"].map((id) => p.get(id)!.y));
    expect(bLeft - aRight >= 100 || bTop - aBottom >= 100).toBe(true);
    expectNoOverlaps(cards, moves);
  });

  it("parks unwired cards on a shelf below everything", () => {
    const cards = [
      card("a"),
      card("b"),
      card("loose1", { width: 100, height: 80 }),
      card("loose2", { width: 100, height: 80 }),
    ];
    const { moves } = arrangeBoard({ cards, wires: [wire("a", "b")], origin: { x: 0, y: 0 } });
    const p = positionsById(moves);
    const wiredBottom = Math.max(p.get("a")!.y + 280, p.get("b")!.y + 280);
    expect(p.get("loose1")!.y).toBeGreaterThanOrEqual(wiredBottom);
    expect(p.get("loose2")!.y).toBeGreaterThanOrEqual(wiredBottom);
    expectNoOverlaps(cards, moves);
  });

  it("puts a buffer in its own column between producer and consumer", () => {
    const cards = [card("machineA"), card("tank", { width: 100, height: 80 }), card("machineB")];
    const { moves } = arrangeBoard({
      cards,
      wires: [wire("machineA", "tank"), wire("tank", "machineB")],
    });
    const p = positionsById(moves);
    expect(p.get("machineA")!.x + 360).toBeLessThan(p.get("tank")!.x);
    expect(p.get("tank")!.x + 100).toBeLessThan(p.get("machineB")!.x);
    expectNoOverlaps(cards, moves);
  });

  it("survives a recycle loop and keeps the majority direction", () => {
    const cards = [card("a"), card("b"), card("c")];
    const { moves } = arrangeBoard({
      cards,
      wires: [wire("a", "b"), wire("b", "c"), wire("c", "a")],
    });
    const p = positionsById(moves);
    expect(p.get("a")!.x).toBeLessThan(p.get("b")!.x);
    expect(p.get("b")!.x).toBeLessThan(p.get("c")!.x);
  });

  it("stacks a fan-out without overlaps", () => {
    const consumers = ["c1", "c2", "c3", "c4", "c5"].map((id, i) =>
      card(id, { height: 200 + i * 40 }),
    );
    const cards = [card("hub"), ...consumers];
    const { moves } = arrangeBoard({
      cards,
      wires: consumers.map((c) => wire("hub", c.id)),
    });
    expectNoOverlaps(cards, moves);
    const p = positionsById(moves);
    for (const consumer of consumers) {
      expect(p.get("hub")!.x + 360).toBeLessThan(p.get(consumer.id)!.x);
    }
  });

  it("lines measured ports up straight across a wire", () => {
    const cards = [card("maker"), card("eater")];
    const { moves } = arrangeBoard({
      cards,
      wires: [wire("maker", "eater", { sourcePortY: 100, targetPortY: 60 })],
    });
    const p = positionsById(moves);
    expect(p.get("maker")!.y + 100).toBe(p.get("eater")!.y + 60);
  });

  it("moves ink with the cards it was written over, and leaves far ink alone", () => {
    const cards = [card("a", { x: 0, y: 0 }), card("b", { x: 0, y: 1000 })];
    const { moves } = arrangeBoard({
      cards,
      wires: [wire("a", "b")],
      origin: { x: 2000, y: 2000 },
      ink: [
        { id: "note-on-a", x: 40, y: 40, width: 240, height: 80 },
        { id: "floater", x: 9000, y: 9000, width: 240, height: 80 },
      ],
    });
    const p = positionsById(moves);
    const deltaX = p.get("a")!.x - 0;
    const deltaY = p.get("a")!.y - 0;
    expect(p.get("note-on-a")).toEqual({ x: 40 + deltaX, y: 40 + deltaY });
    expect(p.has("floater")).toBe(false);
  });

  it("separates feeder sections with extra air around the trunk", () => {
    // Three two-card feeder chains join B: one becomes the trunk, the other
    // two are sections, so where they share a column the gaps must be
    // section-sized, not row-sized.
    const cards = [
      card("a1"),
      card("a2"),
      card("x1"),
      card("x2"),
      card("y1"),
      card("y2"),
      card("b"),
      card("c"),
    ];
    const { moves } = arrangeBoard({
      cards,
      wires: [
        wire("a1", "a2"),
        wire("a2", "b"),
        wire("x1", "x2"),
        wire("x2", "b"),
        wire("y1", "y2"),
        wire("y2", "b"),
        wire("b", "c"),
      ],
    });
    const p = positionsById(moves);
    const columnYs = ["a2", "x2", "y2"]
      .map((id) => p.get(id)!.y)
      .sort((left, right) => left - right);
    expect(columnYs[1] - (columnYs[0] + 280)).toBeGreaterThanOrEqual(60);
    expect(columnYs[2] - (columnYs[1] + 280)).toBeGreaterThanOrEqual(60);
    expectNoOverlaps(cards, moves);
  });

  it("tucks a lone byproduct drawer in beside its machine as a bud", () => {
    const cards = [
      card("a"),
      card("b"),
      card("c"),
      card("slag-drawer", { width: 100, height: 80 }),
    ];
    const { moves } = arrangeBoard({
      cards,
      wires: [wire("a", "b"), wire("b", "c"), wire("b", "slag-drawer")],
    });
    const p = positionsById(moves);
    const centreB = p.get("b")!.y + 140;
    const centreDrawer = p.get("slag-drawer")!.y + 40;
    expect(Math.abs(centreDrawer - centreB)).toBeLessThan(300);
    expectNoOverlaps(cards, moves);
  });

  it("keeps a recycle loop tight beside its section", () => {
    const cards = [card("a"), card("m2"), card("b"), card("m6", { height: 200 })];
    const { moves } = arrangeBoard({
      cards,
      wires: [wire("a", "m2"), wire("m2", "b"), wire("m2", "m6"), wire("m6", "m2")],
    });
    const p = positionsById(moves);
    const centre = (id: string, height: number) => p.get(id)!.y + height / 2;
    expect(Math.abs(centre("m6", 200) - centre("m2", 280))).toBeLessThan(400);
    expectNoOverlaps(cards, moves);
  });

  it("lets the heavier wire hold the straighter line", () => {
    const cards = [card("hub"), card("heavy"), card("light")];
    const { moves } = arrangeBoard({
      cards,
      wires: [wire("hub", "heavy", { weight: 10 }), wire("hub", "light", { weight: 1 })],
    });
    const p = positionsById(moves);
    const centre = (id: string) => p.get(id)!.y + 140;
    expect(Math.abs(centre("hub") - centre("heavy"))).toBeLessThanOrEqual(
      Math.abs(centre("hub") - centre("light")),
    );
  });

  it("puts a bud on the side its wire leaves from, instead of crossing the trunk", () => {
    // The drawer is fed from a port at the BOTTOM of t1 while the trunk wire
    // leaves the middle, so the drawer belongs below the trunk line: leaving
    // it above would drag its wire across the t1-to-t2 run.
    const cards = [card("t1"), card("t2"), card("t3"), card("d", { width: 100, height: 80 })];
    const { moves } = arrangeBoard({
      cards,
      wires: [
        wire("t1", "t2", { sourcePortY: 140, targetPortY: 140 }),
        wire("t2", "t3", { sourcePortY: 140, targetPortY: 140 }),
        wire("t1", "d", { sourcePortY: 260, targetPortY: 40 }),
      ],
    });
    const p = positionsById(moves);
    expect(p.get("d")!.y).toBeGreaterThan(p.get("t2")!.y);
    expectNoOverlaps(cards, moves);
  });

  it("pins a lone supply drawer against its machine's left edge", () => {
    const cards = [
      card("machine"),
      card("supply", { width: 100, height: 80, role: "storage" }),
      card("next"),
    ];
    const { moves } = arrangeBoard({
      cards,
      wires: [wire("supply", "machine", { targetPortY: 140 }), wire("machine", "next")],
    });
    const p = positionsById(moves);
    const gap = p.get("machine")!.x - (p.get("supply")!.x + 100);
    expect(gap).toBeGreaterThanOrEqual(20);
    expect(gap).toBeLessThanOrEqual(120);
    // Vertically it sits at the port it feeds, inside the machine's height.
    expect(p.get("supply")!.y).toBeGreaterThanOrEqual(p.get("machine")!.y);
    expect(p.get("supply")!.y).toBeLessThan(p.get("machine")!.y + 280);
  });

  it("pins a catch drawer against its machine's right edge", () => {
    const cards = [
      card("prev"),
      card("machine"),
      card("catch", { width: 100, height: 80, role: "storage" }),
    ];
    const { moves } = arrangeBoard({
      cards,
      wires: [wire("prev", "machine"), wire("machine", "catch", { sourcePortY: 220 })],
    });
    const p = positionsById(moves);
    const gap = p.get("catch")!.x - (p.get("machine")!.x + 360);
    expect(gap).toBeGreaterThanOrEqual(20);
    expect(gap).toBeLessThanOrEqual(120);
  });

  it("puts a drawer shared by two machines between them", () => {
    const cards = [
      card("a"),
      card("mid"),
      card("b"),
      card("shared", { width: 100, height: 80, role: "storage" }),
    ];
    const { moves } = arrangeBoard({
      cards,
      wires: [wire("a", "mid"), wire("mid", "b"), wire("a", "shared"), wire("b", "shared")],
    });
    const p = positionsById(moves);
    expect(p.get("shared")!.x).toBeGreaterThan(p.get("a")!.x);
    expect(p.get("shared")!.x).toBeLessThan(p.get("b")!.x + 360);
    expectNoOverlaps(cards, moves);
  });

  it("folds a long recycle ring into a loop instead of a line", () => {
    const ids = ["r1", "r2", "r3", "r4", "r5", "r6"];
    const cards = ids.map((id) => card(id));
    const { moves } = arrangeBoard({
      cards,
      wires: ids.map((id, i) => wire(id, ids[(i + 1) % ids.length])),
      origin: { x: 0, y: 0 },
    });
    const p = positionsById(moves);
    const width = Math.max(...ids.map((id) => p.get(id)!.x + 360));
    // A six-card chain would run ~2500px; the fold halves it.
    expect(width).toBeLessThan(1800);
    // The closure wire is a hop, not a lasso.
    expect(Math.abs(p.get("r6")!.x - p.get("r1")!.x)).toBeLessThan(500);
    expectNoOverlaps(cards, moves);
  });

  it("stands a buffer shared by several islands between them", () => {
    // One filler island and two drinker islands share the buffer, so it
    // steps out and stands bare in the gap. A buffer passing between just
    // two islands stays inside one of them (see the next test).
    const chain = (prefix: string) => [1, 2, 3, 4].map((i) => card(`${prefix}${i}`));
    const chainWires = (prefix: string) =>
      [1, 2, 3].map((i) => wire(`${prefix}${i}`, `${prefix}${i + 1}`));
    const cards = [
      ...chain("a"),
      card("pool", { width: 100, height: 80, role: "storage" }),
      ...chain("b"),
      ...chain("c"),
    ];
    const result = arrangeBoard({
      cards,
      wires: [
        ...chainWires("a"),
        wire("a4", "pool"),
        wire("pool", "b1"),
        wire("pool", "c1"),
        ...chainWires("b"),
        ...chainWires("c"),
      ],
      origin: { x: 0, y: 0 },
    });
    expect(result.islands).toHaveLength(4);
    expect(result.islands.filter((island) => !island.backdrop)).toHaveLength(1);
    const p = positionsById(result.moves);
    expect(p.get("pool")!.x).toBeGreaterThan(p.get("a4")!.x);
    expect(p.get("pool")!.x).toBeLessThan(p.get("b1")!.x);
    expect(p.get("pool")!.x).toBeLessThan(p.get("c1")!.x);
  });

  it("keeps a pass-through buffer inside its island", () => {
    const cards = [
      card("a1"),
      card("a2"),
      card("a3"),
      card("a4"),
      card("pass", { width: 100, height: 80, role: "storage" }),
      card("b1"),
      card("b2"),
      card("b3"),
      card("b4"),
    ];
    const result = arrangeBoard({
      cards,
      wires: [
        wire("a1", "a2"),
        wire("a2", "a3"),
        wire("a3", "a4"),
        wire("a4", "pass"),
        wire("pass", "b1"),
        wire("b1", "b2"),
        wire("b2", "b3"),
        wire("b3", "b4"),
      ],
      origin: { x: 0, y: 0 },
    });
    // Two islands only: the buffer serves ONE other island, so it stays in.
    expect(result.islands.filter((island) => !island.backdrop)).toHaveLength(0);
  });

  it("orders islands within a column so their bridges do not cross", () => {
    // Feeder island 1 serves consumer island 2 and vice versa - stacked in
    // index order their bridges would make an X between the columns.
    const chain = (prefix: string) => [1, 2, 3, 4].map((i) => card(`${prefix}${i}`));
    const chainWires = (prefix: string) =>
      [1, 2, 3].map((i) => wire(`${prefix}${i}`, `${prefix}${i + 1}`));
    const cards = [...chain("f"), ...chain("g"), ...chain("x"), ...chain("y")];
    const result = arrangeBoard({
      cards,
      wires: [
        ...chainWires("f"),
        ...chainWires("g"),
        ...chainWires("x"),
        ...chainWires("y"),
        wire("f4", "y1"),
        wire("g4", "x1"),
      ],
      origin: { x: 0, y: 0 },
    });
    expect(result.islands).toHaveLength(4);
    const p = positionsById(result.moves);
    // Uncrossed means the vertical order of the feeders matches the order
    // of the islands they feed.
    const fAboveG = p.get("f4")!.y < p.get("g4")!.y;
    const yAboveX = p.get("y1")!.y < p.get("x1")!.y;
    expect(yAboveX).toBe(fAboveG);
  });

  it("taste: islands off keeps a loose web whole", () => {
    const cards = [
      card("a"),
      card("b"),
      card("c"),
      card("d"),
      card("e"),
      card("e2"),
      card("f"),
      card("g"),
    ];
    const wires = [
      wire("a", "b"),
      wire("b", "c"),
      wire("c", "d"),
      wire("e", "f"),
      wire("e2", "f"),
      wire("f", "g"),
      wire("g", "b"),
    ];
    const together = arrangeBoard({ cards, wires, origin: { x: 0, y: 0 }, taste: { islands: "off" } });
    expect(together.islands).toHaveLength(1);
    const split = arrangeBoard({ cards, wires, origin: { x: 0, y: 0 } });
    expect(split.islands).toHaveLength(2);
  });

  it("taste: snug spacing packs tighter than airy", () => {
    const cards = [card("a"), card("x1"), card("x2"), card("b"), card("c")];
    const wires = [wire("a", "b"), wire("x1", "x2"), wire("x2", "b"), wire("b", "c")];
    const area = (taste: { spacing: "compact" | "roomy" }) => {
      const { moves } = arrangeBoard({ cards, wires, origin: { x: 0, y: 0 }, taste });
      let maxX = 0;
      let maxY = 0;
      for (const move of moves) {
        maxX = Math.max(maxX, move.position.x + 360);
        maxY = Math.max(maxY, move.position.y + 280);
      }
      return maxX * maxY;
    };
    expect(area({ spacing: "compact" })).toBeLessThan(area({ spacing: "roomy" }));
  });

  it("handles an empty board and wires to missing cards", () => {
    expect(arrangeBoard({ cards: [], wires: [wire("x", "y")] }).moves).toEqual([]);
    const { moves } = arrangeBoard({ cards: [card("a")], wires: [wire("a", "ghost")] });
    expect(moves).toHaveLength(1);
  });

  it("splits a loosely attached cluster into its own island", () => {
    // A four-card cluster feeding the main chain through ONE wire is its
    // own island, connected component or not.
    const cards = [
      card("a"),
      card("b"),
      card("c"),
      card("d"),
      card("e"),
      card("e2"),
      card("f"),
      card("g"),
    ];
    const result = arrangeBoard({
      cards,
      wires: [
        wire("a", "b"),
        wire("b", "c"),
        wire("c", "d"),
        wire("e", "f"),
        wire("e2", "f"),
        wire("f", "g"),
        wire("g", "b"),
      ],
      origin: { x: 0, y: 0 },
    });
    expect(result.islands).toHaveLength(2);
    const p = positionsById(result.moves);
    const inIsland = (id: string, island: { x: number; y: number; width: number; height: number }) =>
      p.get(id)!.x >= island.x && p.get(id)!.y >= island.y;
    const clusterIsland = result.islands.find((island) => inIsland("f", island))!;
    for (const id of ["e", "e2", "g"]) {
      expect(inIsland(id, clusterIsland)).toBe(true);
    }
    expectNoOverlaps(cards, result.moves);
  });

  it("stands a feeding island to the left of the island it feeds, aligned", () => {
    const cards = [
      card("p1"),
      card("p2"),
      card("p3"),
      card("p4"),
      card("m1"),
      card("m2"),
      card("m3"),
      card("m4"),
    ];
    const result = arrangeBoard({
      cards,
      wires: [
        wire("p1", "p2"),
        wire("p2", "p3"),
        wire("p3", "p4"),
        wire("m1", "m2"),
        wire("m2", "m3"),
        wire("m3", "m4"),
        wire("p4", "m1"),
      ],
      origin: { x: 0, y: 0 },
    });
    expect(result.islands).toHaveLength(2);
    const p = positionsById(result.moves);
    const feeder = result.islands.find(
      (island) => p.get("p1")!.x >= island.x && p.get("p1")!.y >= island.y,
    )!;
    const eater = result.islands.find((island) => island !== feeder)!;
    // Left of, not above: the islands trade, so they sit side by side with
    // vertical ranges that overlap.
    expect(feeder.x + feeder.width).toBeLessThanOrEqual(eater.x);
    expect(feeder.y).toBeLessThan(eater.y + eater.height);
    expect(eater.y).toBeLessThan(feeder.y + feeder.height);
  });

  it("keeps a tightly coupled web as one island", () => {
    // The same shape wired back so every big-enough split would cut three
    // or more wires: it stays together.
    const cards = [
      card("a"),
      card("b"),
      card("c"),
      card("d"),
      card("e"),
      card("e2"),
      card("f"),
      card("g"),
    ];
    const result = arrangeBoard({
      cards,
      wires: [
        wire("a", "b"),
        wire("b", "c"),
        wire("c", "d"),
        wire("e", "f"),
        wire("e2", "f"),
        wire("f", "g"),
        wire("g", "b"),
        wire("g", "c"),
        wire("e", "a"),
        wire("e2", "d"),
      ],
      origin: { x: 0, y: 0 },
    });
    expect(result.islands).toHaveLength(1);
  });

  it("steers a bridge around an island standing in its way", () => {
    // Three narrow islands share one line, plus a direct bridge from the
    // first to the third: the bridge would cut straight through the middle
    // island, so it gets grid-aligned stops walking it around that
    // island's ground. Bridges between neighbouring islands stay stop-free.
    const hub = (prefix: string) => [1, 2, 3, 4].map((i) => card(`${prefix}${i}`));
    const hubWires = (prefix: string) =>
      [2, 3, 4].map((i) => wire(`${prefix}1`, `${prefix}${i}`));
    const cards = [...hub("a"), ...hub("b"), ...hub("c")];
    const result = arrangeBoard({
      cards,
      wires: [
        ...hubWires("a"),
        ...hubWires("b"),
        ...hubWires("c"),
        { ...wire("a2", "b1"), id: "near" },
        { ...wire("b2", "c1"), id: "next" },
        { ...wire("a3", "c3"), id: "haul" },
      ],
      origin: { x: 0, y: 0 },
    });
    expect(result.islands).toHaveLength(3);
    const haul = result.wireRoutes.find((entry) => entry.id === "haul");
    expect(haul).toBeDefined();
    expect(haul!.waypoints.length).toBeGreaterThanOrEqual(2);
    for (const point of haul!.waypoints) {
      expect(point.x % BOARD_GRID).toBe(0);
      expect(point.y % BOARD_GRID).toBe(0);
      for (const island of result.islands) {
        const inside =
          point.x > island.x &&
          point.x < island.x + island.width &&
          point.y > island.y &&
          point.y < island.y + island.height;
        expect(inside, "a stop sits inside an island").toBe(false);
      }
    }
    expect(result.wireRoutes.find((entry) => entry.id === "near")).toBeUndefined();
    expect(result.wireRoutes.find((entry) => entry.id === "next")).toBeUndefined();
  });

  it("stands each bypass buffer between its own two machines", () => {
    // Two buffers bypassing different spans of one trunk must each sit in
    // their own span's column, not stacked together beside one machine.
    const cards = [
      card("t1"),
      card("t2"),
      card("t3"),
      card("t4"),
      card("b1", { width: 100, height: 80, role: "storage" }),
      card("b2", { width: 100, height: 80, role: "storage" }),
    ];
    const { moves } = arrangeBoard({
      cards,
      wires: [
        wire("t1", "t2"),
        wire("t2", "t3"),
        wire("t3", "t4"),
        wire("t1", "b1"),
        wire("b1", "t3"),
        wire("t2", "b2"),
        wire("b2", "t4"),
      ],
      origin: { x: 0, y: 0 },
    });
    const p = positionsById(moves);
    expect(p.get("b1")!.x).toBeGreaterThan(p.get("t1")!.x + 360);
    expect(p.get("b1")!.x + 100).toBeLessThan(p.get("t3")!.x);
    expect(p.get("b2")!.x).toBeGreaterThan(p.get("t2")!.x + 360);
    expect(p.get("b2")!.x + 100).toBeLessThan(p.get("t4")!.x);
    expect(p.get("b1")!.x).not.toBe(p.get("b2")!.x);
    expectNoOverlaps(cards, moves);
  });

  it("reports one rectangle per island, covering its cards", () => {
    const cards = [card("a1"), card("a2"), card("b1"), card("b2")];
    const result = arrangeBoard({
      cards,
      wires: [wire("a1", "a2"), wire("b1", "b2")],
      origin: { x: 0, y: 0 },
    });
    expect(result.islands).toHaveLength(2);
    const p = positionsById(result.moves);
    for (const [ids, island] of [
      [["a1", "a2"], result.islands[0]],
      [["b1", "b2"], result.islands[1]],
    ] as const) {
      for (const id of ids) {
        const pos = p.get(id)!;
        expect(pos.x).toBeGreaterThanOrEqual(island.x);
        expect(pos.y).toBeGreaterThanOrEqual(island.y);
        expect(pos.x + 360).toBeLessThanOrEqual(island.x + island.width);
        expect(pos.y + 280).toBeLessThanOrEqual(island.y + island.height);
      }
    }
  });
});
