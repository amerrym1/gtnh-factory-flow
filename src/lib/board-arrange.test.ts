import { describe, expect, it } from "vitest";
import { arrangeBoard, type ArrangeCard, type ArrangeWire } from "./board-arrange";
import { BOARD_GRID } from "./board-grid";

function card(id: string, overrides: Partial<ArrangeCard> = {}): ArrangeCard {
  return { id, x: 0, y: 0, width: 360, height: 280, ...overrides };
}

function wire(source: string, target: string, extra: Partial<ArrangeWire> = {}): ArrangeWire {
  return { source, target, ...extra };
}

function positionsById(moves: ReturnType<typeof arrangeBoard>) {
  return new Map(moves.map((move) => [move.id, move.position]));
}

function rectsOverlap(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

function expectNoOverlaps(cards: ArrangeCard[], moves: ReturnType<typeof arrangeBoard>) {
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
    const moves = arrangeBoard({ cards, wires: [wire("a", "b"), wire("b", "c")] });
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
    const moves = arrangeBoard({ cards, wires: [wire("a", "b")] });
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
    const moves = arrangeBoard({
      cards,
      wires: [wire("a1", "a2"), wire("a2", "a3"), wire("b1", "b2")],
      origin: { x: 0, y: 0 },
    });
    const p = positionsById(moves);
    const mainBottom = Math.max(
      ...["a1", "a2", "a3"].map((id) => p.get(id)!.y + 280),
    );
    const islandTop = Math.min(...["b1", "b2"].map((id) => p.get(id)!.y));
    expect(islandTop).toBeGreaterThanOrEqual(mainBottom + 100);
    expectNoOverlaps(cards, moves);
  });

  it("parks unwired cards on a shelf below everything", () => {
    const cards = [
      card("a"),
      card("b"),
      card("loose1", { width: 100, height: 80 }),
      card("loose2", { width: 100, height: 80 }),
    ];
    const moves = arrangeBoard({ cards, wires: [wire("a", "b")], origin: { x: 0, y: 0 } });
    const p = positionsById(moves);
    const wiredBottom = Math.max(p.get("a")!.y + 280, p.get("b")!.y + 280);
    expect(p.get("loose1")!.y).toBeGreaterThanOrEqual(wiredBottom);
    expect(p.get("loose2")!.y).toBeGreaterThanOrEqual(wiredBottom);
    expectNoOverlaps(cards, moves);
  });

  it("puts a buffer in its own column between producer and consumer", () => {
    const cards = [card("machineA"), card("tank", { width: 100, height: 80 }), card("machineB")];
    const moves = arrangeBoard({
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
    const moves = arrangeBoard({
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
    const moves = arrangeBoard({
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
    const moves = arrangeBoard({
      cards,
      wires: [wire("maker", "eater", { sourcePortY: 100, targetPortY: 60 })],
    });
    const p = positionsById(moves);
    expect(p.get("maker")!.y + 100).toBe(p.get("eater")!.y + 60);
  });

  it("moves ink with the cards it was written over, and leaves far ink alone", () => {
    const cards = [card("a", { x: 0, y: 0 }), card("b", { x: 0, y: 1000 })];
    const moves = arrangeBoard({
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
    // A and two feeders share the column before B; each is its own section,
    // so the gaps between them must be section-sized, not row-sized.
    const cards = [card("a"), card("x"), card("y"), card("b"), card("c")];
    const moves = arrangeBoard({
      cards,
      wires: [wire("a", "b"), wire("x", "b"), wire("y", "b"), wire("b", "c")],
    });
    const p = positionsById(moves);
    const columnYs = ["a", "x", "y"]
      .map((id) => p.get(id)!.y)
      .sort((left, right) => left - right);
    expect(columnYs[1] - (columnYs[0] + 280)).toBeGreaterThanOrEqual(100);
    expect(columnYs[2] - (columnYs[1] + 280)).toBeGreaterThanOrEqual(100);
    expectNoOverlaps(cards, moves);
  });

  it("keeps a recycle loop tight beside its section", () => {
    const cards = [card("a"), card("m2"), card("b"), card("m6", { height: 200 })];
    const moves = arrangeBoard({
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
    const moves = arrangeBoard({
      cards,
      wires: [wire("hub", "heavy", { weight: 10 }), wire("hub", "light", { weight: 1 })],
    });
    const p = positionsById(moves);
    const centre = (id: string) => p.get(id)!.y + 140;
    expect(Math.abs(centre("hub") - centre("heavy"))).toBeLessThanOrEqual(
      Math.abs(centre("hub") - centre("light")),
    );
  });

  it("handles an empty board and wires to missing cards", () => {
    expect(arrangeBoard({ cards: [], wires: [wire("x", "y")] })).toEqual([]);
    const moves = arrangeBoard({ cards: [card("a")], wires: [wire("a", "ghost")] });
    expect(moves).toHaveLength(1);
  });
});
