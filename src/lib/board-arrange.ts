/**
 * Auto-arrange: one deterministic layout pass over the visible board.
 *
 * The shape it aims for is the one players draw by hand when they have the
 * patience. A factory plan is almost a TREE: one main product line, fed by
 * side chains, which are fed by their own side chains - with a few wires
 * that double back (recycles) or cross over (one pump feeding four
 * machines). So the layout leans into that:
 *
 *  - Flow runs LEFT TO RIGHT, raw inputs to final products, one column past
 *    the cards that feed you.
 *  - The TRUNK - the chain behind the plan's biggest final product - runs
 *    through the middle. Every feeder chain that joins it is a SECTION: its
 *    cards stay together as one contiguous band, big sections hugging the
 *    trunk, with clear air between bands. That is what kills spaghetti -
 *    a wire's two ends are almost always in the same band.
 *  - Recycles stay tight. The forward half of a loop reads left to right;
 *    the wire that doubles back hugs its own section instead of lassoing
 *    the board.
 *  - Wires want to be short and straight. Columns sit close (growing only
 *    when many wires must cross a boundary), and the vertical pass lines
 *    each card's ports up with the ports they feed, weighted by how much
 *    actually flows - the busiest lines get the straightest runs.
 *  - Cards with no wire to the main graph become their own islands below;
 *    cards wired to nothing at all are gathered onto a shelf at the bottom.
 *
 * The result is a pure function of the graph: same cards and wires in, same
 * layout out, regardless of camera, render order, or what the board looked
 * like before. Everything lands on the 20px grid.
 */

import { BOARD_GRID, cells, snapToGrid } from "./board-grid";

/** A card to place: its id, footprint, and where it sits today. */
export interface ArrangeCard {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /**
   * "storage" marks drawers, tanks and trash cans - the small tiles. A
   * storage whose every wire meets one machine becomes a SATELLITE: it
   * leaves the column system entirely and pins itself against that
   * machine's edge at the port it serves - supplies on the left, catches
   * on the right - the way players park them. Absent means machine.
   */
  role?: "machine" | "storage";
}

/** A wire between two cards, source makes the resource, target drinks it. */
export interface ArrangeWire {
  /**
   * The project edge behind this wire, when the caller wants steering back:
   * long-haul wires get waypoint routes named by this id. Absent wires
   * still place cards, they just cannot be steered.
   */
  id?: string;
  source: string;
  target: string;
  /**
   * The port's centre, measured from its card's TOP edge, when the board has
   * measured it. Absent (culled, never-rendered cards) falls back to the
   * card's vertical centre - alignment degrades gracefully, never breaks.
   */
  sourcePortY?: number;
  targetPortY?: number;
  /**
   * How much this wire matters, on any consistent scale (the board passes
   * a compressed live flow rate). Heavier wires pull harder in every pass:
   * their chain becomes the trunk, their ends sit closer, their runs come
   * out straighter. Absent means 1.
   */
  weight?: number;
}

/** Ink (boxes, zones, notes, arrows): follows the cards it was written over. */
export interface ArrangeInk {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ArrangeMove {
  id: string;
  position: { x: number; y: number };
}

export interface ArrangeResult {
  moves: ArrangeMove[];
  /**
   * The rectangle every island landed in (waypoint lanes included), in
   * final board coordinates - what an island box is drawn around. The
   * shelf of strays is the last entry when one exists.
   */
  islands: Array<{ x: number; y: number; width: number; height: number }>;
  /**
   * Steering for the wires that must travel: a long-haul wire gets two
   * stops in a clear lane above or below its island, so it runs the
   * outside of the board instead of weaving between cards. Ids are the
   * ArrangeWire ids; wires without routes here should have their old
   * steering cleared.
   */
  wireRoutes: Array<{ id: string; waypoints: Array<{ x: number; y: number }> }>;
}

export interface ArrangeInput {
  cards: readonly ArrangeCard[];
  wires: readonly ArrangeWire[];
  ink?: readonly ArrangeInk[];
  /**
   * Where the arranged bounding box's top-left corner lands. Defaults to the
   * OLD bounding box's top-left, so a tidied plan stays in its own
   * neighbourhood instead of teleporting across board space.
   */
  origin?: { x: number; y: number };
}

/* ---------------------------------------------------------------------- */
/* Spacing taste, all in whole cells.                                      */
/* ---------------------------------------------------------------------- */

/** The narrowest corridor between two columns. */
const COLUMN_GAP_MIN = cells(3);
/** A column corridor grows one cell per this many wires crossing it... */
const COLUMN_GAP_WIRES_PER_CELL = 3;
/** ...up to this much. */
const COLUMN_GAP_MAX = cells(10);
/** Vertical air between stacked cards of one section. */
const ROW_GAP = cells(2);
/** Vertical air between two different sections sharing a column. */
const SECTION_GAP = cells(4);
/**
 * Air around a whole island. Deliberately generous: islands reading as
 * clearly separate places is the point of having them.
 */
const ISLAND_GAP = cells(12);
/** A long-haul wire travels this many columns or more to earn a lane. */
const LANE_MIN_SPAN = 3;
/** Air between parked, unwired cards on the shelf. */
const SHELF_GAP = cells(2);
/** Ink counts as "written over" a card up to this far away from it. */
const INK_REACH = cells(2);

/* ---------------------------------------------------------------------- */
/* Internal graph model.                                                   */
/* ---------------------------------------------------------------------- */

interface CardSlot {
  card: ArrangeCard;
  /** Position in the input array: the deterministic tiebreak everywhere. */
  index: number;
  layer: number;
  /** Global vertical theme: cards sort within their column by this. */
  seq: number;
  /** The band this card belongs to; a boundary between bands adds air. */
  section: number;
  /** On the main line. Trunk-to-trunk wires get the straightest runs. */
  trunk: boolean;
  y: number;
}

interface WireLink {
  id?: string;
  from: CardSlot;
  to: CardSlot;
  fromAnchor: number;
  toAnchor: number;
  weight: number;
}

interface Placement {
  x: number;
  y: number;
}

/** Where a satellite storage rides: which machine, which side, which port. */
interface SatellitePlan {
  anchor: CardSlot;
  side: "left" | "right";
  /** Satellite top relative to the anchor's top, ports aligned. */
  offsetY: number;
}

/** One laid-out block (an island), positions relative to its own top-left. */
interface Block {
  ids: string[];
  places: Placement[];
  /** Waypoint lanes for the block's long-haul wires, block-relative. */
  routes: Array<{ id: string; points: Placement[] }>;
  width: number;
  height: number;
  size: number;
  minIndex: number;
  /** The parked-strays shelf: always takes the bottom row of the page. */
  shelf?: boolean;
}

export function arrangeBoard(input: ArrangeInput): ArrangeResult {
  const { cards, wires } = input;
  if (cards.length === 0) {
    return { moves: [], islands: [], wireRoutes: [] };
  }

  const slotById = new Map<string, CardSlot>();
  cards.forEach((card, index) => {
    slotById.set(card.id, { card, index, layer: 0, seq: 0, section: 0, trunk: false, y: 0 });
  });

  // Wires with a missing end or both ends on one card place nothing.
  const links: WireLink[] = [];
  for (const wire of wires) {
    const from = slotById.get(wire.source);
    const to = slotById.get(wire.target);
    if (!from || !to || from === to) {
      continue;
    }
    links.push({
      id: wire.id,
      from,
      to,
      fromAnchor: wire.sourcePortY ?? from.card.height / 2,
      toAnchor: wire.targetPortY ?? to.card.height / 2,
      weight: Math.max(wire.weight ?? 1, 0.01),
    });
  }

  // Drawers that serve exactly one machine leave the graph here and come
  // back at the very end, pinned against that machine's side. The layout
  // then only has to solve the machines and the true multi-way buffers.
  const satellitePlans = planSatellites(slotById, links);
  const mainLinks = links.filter(
    (link) => !satellitePlans.has(link.from) && !satellitePlans.has(link.to),
  );
  const anchors = new Set([...satellitePlans.values()].map((plan) => plan.anchor));

  // Split into islands: weakly-connected components of the wire graph.
  const componentOf = unionComponents(cards.length, mainLinks);
  const componentSlots = new Map<number, CardSlot[]>();
  for (const slot of slotById.values()) {
    if (satellitePlans.has(slot)) {
      continue;
    }
    const root = componentOf(slot.index);
    const members = componentSlots.get(root);
    if (members) {
      members.push(slot);
    } else {
      componentSlots.set(root, [slot]);
    }
  }

  const blocks: Block[] = [];
  const parked: CardSlot[] = [];
  for (const members of componentSlots.values()) {
    // A card with no wires parks on the shelf - unless satellites ride on
    // it, which makes it a one-card island that keeps its drawers.
    if (
      members.length === 1 &&
      !mainLinks.some((l) => l.from === members[0] || l.to === members[0]) &&
      !anchors.has(members[0])
    ) {
      parked.push(members[0]);
      continue;
    }
    members.sort((a, b) => a.index - b.index);
    const memberSet = new Set(members);
    const memberLinks = mainLinks.filter((link) => memberSet.has(link.from));
    const memberSatellites = new Map<CardSlot, SatellitePlan>();
    for (const [sat, plan] of satellitePlans) {
      if (memberSet.has(plan.anchor)) {
        memberSatellites.set(sat, plan);
      }
    }
    blocks.push(layoutIsland(members, memberLinks, memberSatellites));
  }

  // The biggest island is the main line and leads; the rest pack below it in
  // rows, and the unwired cards close the page as a shelf at the very bottom.
  blocks.sort((a, b) => b.size - a.size || a.minIndex - b.minIndex);
  if (parked.length > 0) {
    blocks.push(layoutShelf(parked, blocks[0]?.width ?? 0));
  }

  const origin = input.origin ?? boundingTopLeft(cards);
  const originX = snapToGrid(origin.x);
  const originY = snapToGrid(origin.y);

  const moves: ArrangeMove[] = [];
  const islands: ArrangeResult["islands"] = [];
  const wireRoutes: ArrangeResult["wireRoutes"] = [];
  const newById = new Map<string, Placement>();
  const targetWidth = Math.max(blocks[0]?.width ?? 0, cells(80));
  let rowX = 0;
  let rowY = 0;
  let rowHeight = 0;
  blocks.forEach((block, blockIndex) => {
    // The main island owns its row; later islands share rows while they fit;
    // the shelf of strays never rides beside an island.
    const startsRow =
      blockIndex === 0 || blockIndex === 1 || block.shelf || rowX + block.width > targetWidth;
    if (startsRow) {
      rowY += rowHeight + (blockIndex === 0 ? 0 : ISLAND_GAP);
      rowX = 0;
      rowHeight = 0;
    }
    const blockX = snapToGrid(originX + rowX);
    const blockY = snapToGrid(originY + rowY);
    block.ids.forEach((id, i) => {
      const position = {
        x: blockX + block.places[i].x,
        y: blockY + block.places[i].y,
      };
      moves.push({ id, position });
      newById.set(id, position);
    });
    for (const route of block.routes) {
      wireRoutes.push({
        id: route.id,
        waypoints: route.points.map((point) => ({
          x: blockX + point.x,
          y: blockY + point.y,
        })),
      });
    }
    islands.push({ x: blockX, y: blockY, width: block.width, height: block.height });
    rowX += block.width + ISLAND_GAP;
    rowHeight = Math.max(rowHeight, block.height);
  });

  // Ink follows the cards it overlapped: a note pinned on a machine, a box
  // framing a cluster, each rides the average displacement of the cards it
  // reached. Ink over empty canvas has nothing to follow and stays put.
  for (const ink of input.ink ?? []) {
    let deltaX = 0;
    let deltaY = 0;
    let touched = 0;
    for (const card of cards) {
      const moved = newById.get(card.id);
      if (!moved) {
        continue;
      }
      if (
        ink.x - INK_REACH < card.x + card.width &&
        ink.x + ink.width + INK_REACH > card.x &&
        ink.y - INK_REACH < card.y + card.height &&
        ink.y + ink.height + INK_REACH > card.y
      ) {
        deltaX += moved.x - card.x;
        deltaY += moved.y - card.y;
        touched += 1;
      }
    }
    if (touched > 0) {
      moves.push({
        id: ink.id,
        position: {
          x: snapToGrid(ink.x + deltaX / touched),
          y: snapToGrid(ink.y + deltaY / touched),
        },
      });
    }
  }

  return { moves, islands, wireRoutes };
}

function boundingTopLeft(cards: readonly ArrangeCard[]): { x: number; y: number } {
  let x = Number.POSITIVE_INFINITY;
  let y = Number.POSITIVE_INFINITY;
  for (const card of cards) {
    x = Math.min(x, card.x);
    y = Math.min(y, card.y);
  }
  return { x, y };
}

/** Union-find over card indices, unioned along the wires. */
function unionComponents(count: number, links: WireLink[]): (index: number) => number {
  const parent = Array.from({ length: count }, (_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  for (const link of links) {
    const a = find(link.from.index);
    const b = find(link.to.index);
    if (a !== b) {
      parent[Math.max(a, b)] = Math.min(a, b);
    }
  }
  return find;
}

/**
 * Which storages ride as satellites. A drawer whose every wire meets one
 * other card is furniture for that card, not a station of its own: a supply
 * pins to the left edge, a catch to the right, each at the port row it
 * serves. Two lone storages wired only to each other stay ordinary cards -
 * a satellite needs solid ground to pin to.
 */
function planSatellites(
  slotById: Map<string, CardSlot>,
  links: WireLink[],
): Map<CardSlot, SatellitePlan> {
  const bySlot = new Map<CardSlot, WireLink[]>();
  for (const link of links) {
    push(bySlot, link.from, link);
    push(bySlot, link.to, link);
  }
  const plans = new Map<CardSlot, SatellitePlan>();
  for (const slot of slotById.values()) {
    if (slot.card.role !== "storage") {
      continue;
    }
    const myLinks = bySlot.get(slot) ?? [];
    if (myLinks.length === 0) {
      continue;
    }
    const partners = new Set(myLinks.map((l) => (l.from === slot ? l.to : l.from)));
    if (partners.size !== 1) {
      continue;
    }
    const anchor = [...partners][0];
    const feeds = myLinks.some((l) => l.from === slot);
    const fed = myLinks.some((l) => l.to === slot);
    // Ports aligned: the satellite's port row meets the machine's port row.
    let sum = 0;
    let weight = 0;
    for (const l of myLinks) {
      const anchorPort = l.from === slot ? l.toAnchor : l.fromAnchor;
      const ownPort = l.from === slot ? l.fromAnchor : l.toAnchor;
      sum += (anchorPort - ownPort) * l.weight;
      weight += l.weight;
    }
    plans.set(slot, {
      anchor,
      side: feeds && !fed ? "left" : "right",
      offsetY: sum / weight,
    });
  }
  for (const [slot, plan] of [...plans]) {
    if (plans.has(plan.anchor)) {
      plans.delete(slot);
      plans.delete(plan.anchor);
    }
  }
  return plans;
}

/**
 * The wires of every two-card loop (A feeds B, B feeds A). Those pairs are
 * drawn STACKED - same column, one above the other - the way players draw
 * an electrolyzer trading with its reactor, so their wires stay off the
 * column system entirely.
 */
function twoCycleLinks(links: WireLink[]): Set<WireLink> {
  const directions = new Set<string>();
  for (const link of links) {
    directions.add(`${link.from.index}>${link.to.index}`);
  }
  const pairs = new Set<WireLink>();
  for (const link of links) {
    if (directions.has(`${link.to.index}>${link.from.index}`)) {
      pairs.add(link);
    }
  }
  return pairs;
}

/* ---------------------------------------------------------------------- */
/* One island: trunk, sections, columns.                                   */
/* ---------------------------------------------------------------------- */

function layoutIsland(
  members: CardSlot[],
  links: WireLink[],
  satellites: Map<CardSlot, SatellitePlan>,
): Block {
  // -- Cycles. A layered layout needs an acyclic graph to rank, so a DFS in
  // input order marks the wires that close each loop. Those wires still
  // exist for every later pass - they pull their ends together vertically -
  // they just do not constrain the columns, so the forward half of a
  // recycle reads left to right and the return wire doubles back beside it.
  // Two-card loops are lifted out before any of that: their wires never
  // touch the column system, and the pair stacks in one column.
  const pairs = twoCycleLinks(links);
  const forward = breakCycles(members, links, pairs);

  assignLayers(members, forward, pairs);

  // -- The fold. A big recycle ring flattened into one line leaves its
  // closure wire lassoing the whole board. Folding the ring's far half back
  // over the top turns the line into the loop the player would draw: flow
  // runs out along the bottom deck, back along the top, and every closure
  // is a short vertical hop. Where the fold lands is chosen by arithmetic
  // (least total wire span), so the arbitrary cycle break stops mattering.
  const { topDeck, pinned } = foldBigCycles(members, links, pairs);
  // The fold moved the ring; everything hanging off it re-slides to its new
  // wires (the ring itself is pinned), pairs re-stack, and a drawer shared
  // by several machines sits between them rather than to the right of all.
  slideTowardWires(members, forward, pinned);
  pullPairsTogether(pairs, forward);
  relaxSharedStorages(members, links, pinned);
  packLayers(members);

  buildBands(members, links, forward);
  if (topDeck.size > 0) {
    // The return deck rides ABOVE the line it feeds: its cards keep their
    // relative order but outrank every bottom-deck seq. Each CONNECTED run
    // of deck cards is its own band - two unrelated returns folded onto the
    // deck must not interleave.
    const shift = members.length * 4;
    const deckChunk = new Map<CardSlot, number>();
    let nextChunk = 0;
    for (const slot of members) {
      if (!topDeck.has(slot) || deckChunk.has(slot)) {
        continue;
      }
      deckChunk.set(slot, nextChunk);
      const queue = [slot];
      for (let head = 0; head < queue.length; head += 1) {
        for (const link of links) {
          const other =
            link.from === queue[head] ? link.to : link.to === queue[head] ? link.from : undefined;
          if (other && topDeck.has(other) && !deckChunk.has(other)) {
            deckChunk.set(other, nextChunk);
            queue.push(other);
          }
        }
      }
      nextChunk += 1;
    }
    for (const slot of members) {
      if (topDeck.has(slot)) {
        slot.seq -= shift;
        slot.section = -1 - (deckChunk.get(slot) ?? 0);
      }
    }
  }

  // A provisional vertical pass, then the anti-crossing polish: with real
  // positions on the board, cards are reordered WITHIN their column and
  // section to follow where their wires pull - a drawer whose feed leaves
  // the bottom of its machine belongs below it, not above, and two wires
  // that would cross between columns uncross by swapping their ends. Bands
  // survive: the polish permutes order only among cards already sharing a
  // column and a section. Then the column settles again.
  placeRows(collectLayers(members), links);
  for (let pass = 0; pass < 3; pass += 1) {
    polishColumnOrder(collectLayers(members), links);
    placeRows(collectLayers(members), links);
  }
  straightenRows(collectLayers(members), links);
  const layers = collectLayers(members);

  // -- Columns. Every column is as wide as its widest card; the corridor
  // between two columns grows with the number of wires that must cross it,
  // so busy boundaries get room to ribbon while quiet ones stay snug.
  const columnWidth = layers.map((layer) =>
    layer.reduce((max, slot) => Math.max(max, slot.card.width), 0),
  );
  const crossings = new Array<number>(Math.max(layers.length - 1, 0)).fill(0);
  for (const link of links) {
    const lo = Math.min(link.from.layer, link.to.layer);
    const hi = Math.max(link.from.layer, link.to.layer);
    for (let i = lo; i < hi; i += 1) {
      crossings[i] += 1;
    }
  }
  // Corridors widen where satellites ride: a column whose machines carry
  // supply drawers needs room on its left, catch drawers need it on the
  // right.
  const leftPad = new Array<number>(layers.length).fill(0);
  const rightPad = new Array<number>(layers.length).fill(0);
  for (const [sat, plan] of satellites) {
    const need = sat.card.width + cells(2);
    if (plan.side === "left") {
      leftPad[plan.anchor.layer] = Math.max(leftPad[plan.anchor.layer], need);
    } else {
      rightPad[plan.anchor.layer] = Math.max(rightPad[plan.anchor.layer], need);
    }
  }
  const columnX: number[] = [];
  let x = 0;
  layers.forEach((_, i) => {
    x += leftPad[i];
    columnX.push(x);
    x += columnWidth[i] + rightPad[i];
    if (i < layers.length - 1) {
      const gap = COLUMN_GAP_MIN + cells(Math.floor(crossings[i] / COLUMN_GAP_WIRES_PER_CELL));
      x += Math.min(gap, COLUMN_GAP_MAX);
    }
  });

  // Normalise the island to its own top-left and centre each card in its
  // column, snapped so a narrow drawer between wide machine columns still
  // sits on a cell corner.
  let top = Number.POSITIVE_INFINITY;
  for (const slot of members) {
    top = Math.min(top, slot.y);
  }
  const ids: string[] = [];
  const places: Placement[] = [];
  const placeBySlot = new Map<CardSlot, Placement>();
  for (const slot of members) {
    const place = {
      x: snapToGrid(columnX[slot.layer] + (columnWidth[slot.layer] - slot.card.width) / 2),
      y: snapToGrid(slot.y - top),
    };
    ids.push(slot.card.id);
    places.push(place);
    placeBySlot.set(slot, place);
  }

  // Satellites, pinned to their machine's side at the port row they serve
  // and stacked apart when several share a side.
  const satGroups = new Map<string, Array<{ sat: CardSlot; plan: SatellitePlan }>>();
  for (const [sat, plan] of satellites) {
    push(satGroups, `${plan.anchor.index}:${plan.side}`, { sat, plan });
  }
  for (const group of satGroups.values()) {
    group.sort((a, b) => a.plan.offsetY - b.plan.offsetY || a.sat.index - b.sat.index);
    let previousBottom = Number.NEGATIVE_INFINITY;
    for (const { sat, plan } of group) {
      const anchorPlace = placeBySlot.get(plan.anchor)!;
      const place = {
        x: snapToGrid(
          plan.side === "left"
            ? anchorPlace.x - cells(2) - sat.card.width
            : anchorPlace.x + plan.anchor.card.width + cells(2),
        ),
        y: snapToGrid(
          Math.max(anchorPlace.y + plan.offsetY, previousBottom + cells(1)),
        ),
      };
      previousBottom = place.y + sat.card.height;
      ids.push(sat.card.id);
      places.push(place);
    }
  }

  // Long-haul wires get a LANE: two stops in the clear above or below the
  // island, so the wire runs along the outside instead of weaving between
  // cards. The lane side is whichever half of the island the wire's ends
  // sit in; every lane on a side steps one further out.
  const routes: Block["routes"] = [];
  {
    let islandBottom = 0;
    for (const [slot, place] of placeBySlot) {
      islandBottom = Math.max(islandBottom, place.y + slot.card.height);
    }
    const longHaul = links
      .filter(
        (link) =>
          link.id !== undefined &&
          Math.abs(link.from.layer - link.to.layer) >= LANE_MIN_SPAN,
      )
      .sort((a, b) => a.from.index - b.from.index || a.to.index - b.to.index);
    let topLanes = 0;
    let bottomLanes = 0;
    for (const link of longHaul) {
      const from = placeBySlot.get(link.from)!;
      const to = placeBySlot.get(link.to)!;
      const wireMid = (from.y + link.fromAnchor + to.y + link.toAnchor) / 2;
      const above = wireMid < islandBottom / 2;
      topLanes += above ? 1 : 0;
      bottomLanes += above ? 0 : 1;
      const laneY = above ? -cells(2) * topLanes : islandBottom + cells(2) * bottomLanes;
      routes.push({
        id: link.id!,
        points: [
          { x: snapToGrid(from.x + link.from.card.width + cells(3)), y: snapToGrid(laneY) },
          { x: snapToGrid(to.x - cells(3)), y: snapToGrid(laneY) },
        ],
      });
    }
  }

  // Satellites and lanes can poke past the island's top or left edge; pull
  // the whole block back to its own origin, then measure it around
  // everything it owns.
  let minX = 0;
  let minY = 0;
  for (const place of places) {
    minX = Math.min(minX, place.x);
    minY = Math.min(minY, place.y);
  }
  for (const route of routes) {
    for (const point of route.points) {
      minX = Math.min(minX, point.x);
      minY = Math.min(minY, point.y);
    }
  }
  let width = 0;
  let height = 0;
  for (const place of places) {
    place.x -= minX;
    place.y -= minY;
  }
  for (const route of routes) {
    for (const point of route.points) {
      point.x -= minX;
      point.y -= minY;
      width = Math.max(width, point.x);
      height = Math.max(height, point.y);
    }
  }
  const slotOf = new Map<string, CardSlot>();
  for (const slot of members) {
    slotOf.set(slot.card.id, slot);
  }
  for (const sat of satellites.keys()) {
    slotOf.set(sat.card.id, sat);
  }
  ids.forEach((id, i) => {
    const slot = slotOf.get(id)!;
    width = Math.max(width, places[i].x + slot.card.width);
    height = Math.max(height, places[i].y + slot.card.height);
  });
  return {
    ids,
    places,
    routes,
    width,
    height,
    size: members.length + satellites.size,
    minIndex: members[0].index,
  };
}

/**
 * Mark the links that close a cycle. Returns the FORWARD links (the DAG);
 * marked links simply do not constrain layering.
 */
function breakCycles(
  members: CardSlot[],
  links: WireLink[],
  pairs: ReadonlySet<WireLink>,
): WireLink[] {
  const outgoing = new Map<CardSlot, WireLink[]>();
  for (const link of links) {
    if (!pairs.has(link)) {
      push(outgoing, link.from, link);
    }
  }
  const VISITING = 1;
  const DONE = 2;
  const state = new Map<CardSlot, number>();
  const reversed = new Set<WireLink>();
  for (const start of members) {
    if (state.has(start)) {
      continue;
    }
    // Iterative DFS: a recursive one blows the stack on thousand-card boards.
    const stack: Array<{ slot: CardSlot; nextLink: number }> = [{ slot: start, nextLink: 0 }];
    state.set(start, VISITING);
    while (stack.length > 0) {
      const frame = stack[stack.length - 1];
      const list = outgoing.get(frame.slot) ?? [];
      if (frame.nextLink >= list.length) {
        state.set(frame.slot, DONE);
        stack.pop();
        continue;
      }
      const link = list[frame.nextLink];
      frame.nextLink += 1;
      const seen = state.get(link.to);
      if (seen === VISITING) {
        reversed.add(link);
      } else if (seen === undefined) {
        state.set(link.to, VISITING);
        stack.push({ slot: link.to, nextLink: 0 });
      }
    }
  }
  return links.filter((link) => !pairs.has(link) && !reversed.has(link));
}

/**
 * Rank every card into a column. Longest path from the sources puts each card
 * one column past the furthest card that feeds it; the tightening sweeps then
 * slide cards toward whichever side holds more of their wire WEIGHT, which
 * pulls a lone raw-material source right up beside its consumer instead of
 * leaving it stranded in column zero, and keeps a heavy line's ends adjacent.
 */
function assignLayers(
  members: CardSlot[],
  forward: WireLink[],
  pairs: ReadonlySet<WireLink>,
): void {
  const incoming = new Map<CardSlot, WireLink[]>();
  const outgoing = new Map<CardSlot, WireLink[]>();
  for (const link of forward) {
    push(outgoing, link.from, link);
    push(incoming, link.to, link);
  }

  const order = topologicalOrder(members, outgoing);
  for (const slot of order) {
    let layer = 0;
    for (const link of incoming.get(slot) ?? []) {
      layer = Math.max(layer, link.from.layer + 1);
    }
    slot.layer = layer;
  }

  slideTowardWires(members, forward);
  pullPairsTogether(pairs, forward);
  packLayers(members);
}

/**
 * Slide every card toward whichever side holds more of its wire weight,
 * within what its wires allow. Pinned cards (a folded ring) hold still but
 * still anchor their neighbours.
 */
function slideTowardWires(
  members: CardSlot[],
  forward: WireLink[],
  pinned?: ReadonlySet<CardSlot>,
): void {
  const incoming = new Map<CardSlot, WireLink[]>();
  const outgoing = new Map<CardSlot, WireLink[]>();
  for (const link of forward) {
    push(outgoing, link.from, link);
    push(incoming, link.to, link);
  }
  for (let pass = 0; pass < 3; pass += 1) {
    for (const slot of members) {
      if (pinned?.has(slot)) {
        continue;
      }
      const ins = incoming.get(slot) ?? [];
      const outs = outgoing.get(slot) ?? [];
      let lower = 0;
      for (const link of ins) {
        lower = Math.max(lower, link.from.layer + 1);
      }
      let upper = Number.POSITIVE_INFINITY;
      for (const link of outs) {
        upper = Math.min(upper, link.to.layer - 1);
      }
      if (upper === Number.POSITIVE_INFINITY) {
        upper = slot.layer;
      }
      if (upper < lower) {
        continue;
      }
      // Total weighted wire length is linear in this card's column, so the
      // best spot is whichever end of the feasible range the heavier side
      // points to.
      const inWeight = ins.reduce((sum, link) => sum + link.weight, 0);
      const outWeight = outs.reduce((sum, link) => sum + link.weight, 0);
      if (outWeight > inWeight) {
        slot.layer = upper;
      } else if (inWeight > outWeight) {
        slot.layer = lower;
      } else if (ins.length > 0 && outs.length > 0) {
        // A tie is flat under linear cost, but long wires read worst, so
        // split the difference.
        slot.layer = Math.round((lower + upper) / 2);
      }
    }
  }
}

/**
 * Two-card loops share a column, stacked, the way players draw an
 * electrolyzer trading with its reactor: the member with fewer other
 * wires adopts the better-anchored one's column.
 */
function pullPairsTogether(pairs: ReadonlySet<WireLink>, forward: WireLink[]): void {
  const degree = new Map<CardSlot, number>();
  for (const link of forward) {
    degree.set(link.from, (degree.get(link.from) ?? 0) + 1);
    degree.set(link.to, (degree.get(link.to) ?? 0) + 1);
  }
  for (const link of pairs) {
    if (link.from.index < link.to.index) {
      const a = link.from;
      const b = link.to;
      if ((degree.get(a) ?? 0) >= (degree.get(b) ?? 0)) {
        b.layer = a.layer;
      } else {
        a.layer = b.layer;
      }
    }
  }
}

/**
 * A drawer serving several machines belongs BETWEEN them, not to the right
 * of them all: left-to-right ranking only means something for cards that
 * transform, and a shared chest just collects. Its column becomes the
 * weighted middle of its partners'.
 */
function relaxSharedStorages(
  members: CardSlot[],
  links: WireLink[],
  pinned: ReadonlySet<CardSlot>,
): void {
  const bySlot = new Map<CardSlot, WireLink[]>();
  for (const link of links) {
    push(bySlot, link.from, link);
    push(bySlot, link.to, link);
  }
  for (const slot of members) {
    if (slot.card.role !== "storage" || pinned.has(slot)) {
      continue;
    }
    const myLinks = bySlot.get(slot) ?? [];
    const partners = new Set(myLinks.map((l) => (l.from === slot ? l.to : l.from)));
    if (partners.size < 2) {
      continue;
    }
    let sum = 0;
    let weight = 0;
    for (const link of myLinks) {
      const other = link.from === slot ? link.to : link.from;
      sum += other.layer * link.weight;
      weight += link.weight;
    }
    slot.layer = Math.round(sum / weight);
  }
}

/** Layers come out sparse after tightening and folding; close the holes. */
function packLayers(members: CardSlot[]): void {
  const used = [...new Set(members.map((slot) => slot.layer))].sort((a, b) => a - b);
  const packed = new Map(used.map((layer, i) => [layer, i]));
  for (const slot of members) {
    slot.layer = packed.get(slot.layer) ?? 0;
  }
}

/**
 * Strongly connected components of the island, iterative Tarjan in input
 * order: the cards that can all reach each other - a recycle ring and
 * everything riding it.
 */
function strongComponents(members: CardSlot[], links: WireLink[]): Map<CardSlot, number> {
  const outgoing = new Map<CardSlot, CardSlot[]>();
  for (const link of links) {
    push(outgoing, link.from, link.to);
  }
  const component = new Map<CardSlot, number>();
  const indexOf = new Map<CardSlot, number>();
  const low = new Map<CardSlot, number>();
  const onStack = new Set<CardSlot>();
  const tarjanStack: CardSlot[] = [];
  let nextIndex = 0;
  let nextComponent = 0;
  for (const start of members) {
    if (indexOf.has(start)) {
      continue;
    }
    const work: Array<{ slot: CardSlot; next: number }> = [{ slot: start, next: 0 }];
    indexOf.set(start, nextIndex);
    low.set(start, nextIndex);
    nextIndex += 1;
    tarjanStack.push(start);
    onStack.add(start);
    while (work.length > 0) {
      const frame = work[work.length - 1];
      const near = outgoing.get(frame.slot) ?? [];
      if (frame.next < near.length) {
        const other = near[frame.next];
        frame.next += 1;
        if (!indexOf.has(other)) {
          indexOf.set(other, nextIndex);
          low.set(other, nextIndex);
          nextIndex += 1;
          tarjanStack.push(other);
          onStack.add(other);
          work.push({ slot: other, next: 0 });
        } else if (onStack.has(other)) {
          low.set(frame.slot, Math.min(low.get(frame.slot)!, indexOf.get(other)!));
        }
        continue;
      }
      work.pop();
      if (work.length > 0) {
        const parent = work[work.length - 1].slot;
        low.set(parent, Math.min(low.get(parent)!, low.get(frame.slot)!));
      }
      if (low.get(frame.slot) === indexOf.get(frame.slot)) {
        for (;;) {
          const popped = tarjanStack.pop()!;
          onStack.delete(popped);
          component.set(popped, nextComponent);
          if (popped === frame.slot) {
            break;
          }
        }
        nextComponent += 1;
      }
    }
  }
  return component;
}

/**
 * Fold each big ring back over itself. For every strongly connected group
 * of four or more cards, try each fold point: cards past it mirror onto a
 * return deck heading back left. Keep the fold whose total wire span is
 * smallest, if it beats the unfolded line. Returns the cards on top decks.
 */
function foldBigCycles(
  members: CardSlot[],
  links: WireLink[],
  pairs: ReadonlySet<WireLink>,
): { topDeck: Set<CardSlot>; pinned: Set<CardSlot> } {
  const component = strongComponents(members, links);
  const groups = new Map<number, CardSlot[]>();
  for (const slot of members) {
    push(groups, component.get(slot) ?? -1, slot);
  }
  const topDeck = new Set<CardSlot>();
  const pinned = new Set<CardSlot>();
  for (const group of groups.values()) {
    if (group.length < 4) {
      continue;
    }
    const inGroup = new Set(group);
    const inner = links.filter(
      (link) => inGroup.has(link.from) && inGroup.has(link.to) && !pairs.has(link),
    );
    const minLayer = group.reduce((min, slot) => Math.min(min, slot.layer), Infinity);
    const flat = new Map(group.map((slot) => [slot, slot.layer - minLayer]));
    const span = group.reduce((max, slot) => Math.max(max, flat.get(slot)!), 0);
    // SQUARED span: one wire lassoing four columns is far worse than four
    // wires each hopping one - long wires are the ugliness being priced.
    // A same-column link is NOT free: an output feeding an input in its own
    // column wraps around the cards, so it prices like a two-column hop.
    // Without this, two rings sharing a machine fold into one tower.
    const cost = (layerOf: (slot: CardSlot) => number) =>
      inner.reduce((sum, link) => {
        const d = Math.abs(layerOf(link.from) - layerOf(link.to));
        return sum + (d === 0 ? 4 : d * d);
      }, 0);
    const baseCost = cost((slot) => flat.get(slot)!);
    let bestM = -1;
    let bestCost = baseCost;
    for (let m = 0; m < span; m += 1) {
      const layerOf = (slot: CardSlot) => {
        const f = flat.get(slot)!;
        return f <= m ? f : 2 * m + 1 - f;
      };
      if (group.some((slot) => layerOf(slot) < 0)) {
        continue;
      }
      const folded = cost(layerOf);
      if (folded < bestCost) {
        bestCost = folded;
        bestM = m;
      }
    }
    if (bestM < 0) {
      continue;
    }
    for (const slot of group) {
      pinned.add(slot);
      const f = flat.get(slot)!;
      if (f > bestM) {
        slot.layer = minLayer + 2 * bestM + 1 - f;
        topDeck.add(slot);
      }
    }
  }
  return { topDeck, pinned };
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key);
  if (list) {
    list.push(value);
  } else {
    map.set(key, [value]);
  }
}

function topologicalOrder(
  members: CardSlot[],
  outgoing: Map<CardSlot, WireLink[]>,
): CardSlot[] {
  const indegree = new Map<CardSlot, number>();
  for (const slot of members) {
    indegree.set(slot, 0);
  }
  for (const links of outgoing.values()) {
    for (const link of links) {
      indegree.set(link.to, (indegree.get(link.to) ?? 0) + 1);
    }
  }
  // A plain queue seeded in input order keeps the walk deterministic.
  const queue = members.filter((slot) => indegree.get(slot) === 0);
  const order: CardSlot[] = [];
  for (let head = 0; head < queue.length; head += 1) {
    const slot = queue[head];
    order.push(slot);
    for (const link of outgoing.get(slot) ?? []) {
      const remaining = (indegree.get(link.to) ?? 0) - 1;
      indegree.set(link.to, remaining);
      if (remaining === 0) {
        queue.push(link.to);
      }
    }
  }
  return order;
}

/**
 * The heart of the sectioned look. The island is almost a tree, so treat it
 * as one: grow a spanning tree from the plan's main product (the final sink
 * with the most machinery behind it), heaviest wires claimed first. The
 * TRUNK is the chain of largest subtrees down from that root - the main
 * line. Every subtree hanging off the trunk becomes a SECTION.
 *
 * A single in-order walk then hands out two numbers per card: `seq`, the
 * global vertical theme (cards sort within their column by it, so a
 * subtree's cards stay contiguous in every column they touch - a wire's two
 * ends land in the same band, which is the anti-spaghetti), and `section`,
 * which buys the air between bands. Sections are balanced around the trunk,
 * the biggest hugging it from either side, so the main line runs through
 * the middle of its factory rather than along an edge.
 */
function buildBands(members: CardSlot[], links: WireLink[], forward: WireLink[]): void {
  // Undirected adjacency, parallel wires merged, heaviest first.
  const adjacency = new Map<CardSlot, Array<{ other: CardSlot; weight: number }>>();
  {
    const paired = new Map<CardSlot, Map<CardSlot, number>>();
    const add = (a: CardSlot, b: CardSlot, weight: number) => {
      let row = paired.get(a);
      if (!row) {
        row = new Map();
        paired.set(a, row);
      }
      row.set(b, (row.get(b) ?? 0) + weight);
    };
    for (const link of links) {
      add(link.from, link.to, link.weight);
      add(link.to, link.from, link.weight);
    }
    for (const [slot, row] of paired) {
      adjacency.set(
        slot,
        [...row.entries()]
          .map(([other, weight]) => ({ other, weight }))
          .sort((a, b) => b.weight - a.weight || a.other.index - b.other.index),
      );
    }
  }

  // The root: among cards nothing forward flows OUT of (final products,
  // export drawers), the one with the most cards feeding it wins. A machine
  // outranks a drawer - growing the tree from a chest gives the walk a
  // trivial first step and scrambles the bands behind it.
  const hasForwardOut = new Set(forward.map((link) => link.from));
  const allSinks = members.filter((slot) => !hasForwardOut.has(slot));
  const machineSinks = allSinks.filter((slot) => slot.card.role !== "storage");
  const sinks = machineSinks.length > 0 ? machineSinks : allSinks;
  const feeders = new Map<CardSlot, WireLink[]>();
  for (const link of forward) {
    push(feeders, link.to, link);
  }
  let root = members[0];
  let rootReach = -1;
  for (const sink of sinks) {
    const seen = new Set<CardSlot>([sink]);
    const queue = [sink];
    for (let head = 0; head < queue.length; head += 1) {
      for (const link of feeders.get(queue[head]) ?? []) {
        if (!seen.has(link.from)) {
          seen.add(link.from);
          queue.push(link.from);
        }
      }
    }
    if (seen.size > rootReach) {
      root = sink;
      rootReach = seen.size;
    }
  }

  // Spanning tree from the root, heaviest neighbours claimed first.
  const parent = new Map<CardSlot, CardSlot>();
  const children = new Map<CardSlot, CardSlot[]>();
  {
    const visited = new Set<CardSlot>([root]);
    const stack = [root];
    while (stack.length > 0) {
      const slot = stack.pop()!;
      // Reverse so the heaviest neighbour is popped (visited) first.
      const near = adjacency.get(slot) ?? [];
      for (let i = near.length - 1; i >= 0; i -= 1) {
        const { other } = near[i];
        if (!visited.has(other)) {
          visited.add(other);
          parent.set(other, slot);
          push(children, slot, other);
          stack.push(other);
        }
      }
    }
  }

  // Subtree sizes and rough band heights, accumulated bottom-up without
  // recursion (the tree can be deep), then the trunk: follow the biggest
  // child down.
  const subtreeSize = new Map<CardSlot, number>();
  const subtreeHeight = new Map<CardSlot, number>();
  {
    const order: CardSlot[] = [];
    const stack = [root];
    while (stack.length > 0) {
      const slot = stack.pop()!;
      order.push(slot);
      for (const child of children.get(slot) ?? []) {
        stack.push(child);
      }
    }
    for (let i = order.length - 1; i >= 0; i -= 1) {
      let size = 1;
      let height = order[i].card.height + ROW_GAP;
      for (const child of children.get(order[i]) ?? []) {
        size += subtreeSize.get(child) ?? 1;
        height += subtreeHeight.get(child) ?? 0;
      }
      subtreeSize.set(order[i], size);
      subtreeHeight.set(order[i], height);
    }
  }
  const onTrunk = new Set<CardSlot>([root]);
  {
    let slot: CardSlot | undefined = root;
    while (slot) {
      const kids = children.get(slot) ?? [];
      let next: CardSlot | undefined;
      for (const child of kids) {
        if (!next || (subtreeSize.get(child) ?? 1) > (subtreeSize.get(next) ?? 1)) {
          next = child;
        }
      }
      if (next) {
        onTrunk.add(next);
      }
      slot = next;
    }
  }
  for (const slot of onTrunk) {
    slot.trunk = true;
  }

  // Which trunk-child subtree each off-trunk card hangs from, and how hard
  // that whole branch holds onto the trunk: every wire between the branch
  // and ANY trunk card counts. This is what puts each branch where its
  // wires want it - a recycle loop (a wire out AND a wire back) hugs the
  // line, a heavy feed sits closer than a trickle, and a big-but-loose
  // branch drifts outward instead of shouldering in on card count alone.
  const branchRoot = new Map<CardSlot, CardSlot>();
  for (const trunkSlot of onTrunk) {
    for (const child of children.get(trunkSlot) ?? []) {
      if (onTrunk.has(child)) {
        continue;
      }
      const queue = [child];
      branchRoot.set(child, child);
      for (let head = 0; head < queue.length; head += 1) {
        for (const grand of children.get(queue[head]) ?? []) {
          branchRoot.set(grand, child);
          queue.push(grand);
        }
      }
    }
  }
  const coupling = new Map<CardSlot, number>();
  for (const link of links) {
    const fromTrunk = onTrunk.has(link.from);
    const toTrunk = onTrunk.has(link.to);
    if (fromTrunk === toTrunk) {
      continue;
    }
    const branch = branchRoot.get(fromTrunk ? link.to : link.from);
    if (branch) {
      coupling.set(branch, (coupling.get(branch) ?? 0) + link.weight);
    }
  }

  // The in-order walk. At a trunk card, side sections split above and below
  // it, biggest nearest the trunk; elsewhere children keep claim order.
  let seqCounter = 0;
  let sectionCounter = 0;
  type Visit = { slot: CardSlot; section: number };
  const walk = (start: Visit) => {
    const stack: Array<{ slot: CardSlot; section: number; phase: number }> = [
      { ...start, phase: 0 },
    ];
    while (stack.length > 0) {
      const frame = stack.pop()!;
      const { slot, section } = frame;
      if (frame.phase === 1) {
        slot.seq = seqCounter;
        seqCounter += 1;
        slot.section = section;
        continue;
      }
      const kids = children.get(slot) ?? [];
      if (!onTrunk.has(slot)) {
        // A section interior: the card, then its children in claim order,
        // every one inheriting the section.
        slot.seq = seqCounter;
        seqCounter += 1;
        slot.section = section;
        for (let i = kids.length - 1; i >= 0; i -= 1) {
          stack.push({ slot: kids[i], section, phase: 0 });
        }
        continue;
      }
      // A trunk card: hang its branches around the line and push the trunk
      // continuation through the middle. BUDS - single stray cards, a
      // byproduct drawer, a lone supply - are not sections at all: they keep
      // the trunk's band and nestle right against their machine. Real
      // branches become sections, placed in coupling order (the branch with
      // the most wire into the trunk sits nearest, which is what keeps a
      // recycle loop or a heavy feed snug), and dealt above or below
      // whichever side is currently shorter, so the main line stays
      // vertically centred in its own factory.
      const trunkChild = kids.find((child) => onTrunk.has(child));
      const sides = kids
        .filter((child) => child !== trunkChild)
        .sort(
          (a, b) =>
            (coupling.get(b) ?? 0) - (coupling.get(a) ?? 0) ||
            (subtreeSize.get(b) ?? 1) - (subtreeSize.get(a) ?? 1) ||
            a.index - b.index,
        );
      const above: Visit[] = [];
      const below: Visit[] = [];
      let aboveHeight = 0;
      let belowHeight = 0;
      const buds = sides.filter((child) => (subtreeSize.get(child) ?? 1) === 1);
      const branches = sides.filter((child) => (subtreeSize.get(child) ?? 1) > 1);
      // Buds first, so they hold the positions nearest the trunk card while
      // the sections stack outward past them.
      for (const child of [...buds, ...branches]) {
        const isBud = (subtreeSize.get(child) ?? 1) === 1;
        let childSection = section;
        if (!isBud) {
          sectionCounter += 1;
          childSection = sectionCounter;
        }
        const height = subtreeHeight.get(child) ?? 0;
        if (aboveHeight <= belowHeight) {
          above.unshift({ slot: child, section: childSection });
          aboveHeight += height;
        } else {
          below.push({ slot: child, section: childSection });
          belowHeight += height;
        }
      }
      // Pushed in reverse of the wanted visit order (it is a stack): below
      // branches, then the trunk continuation, then this card, then above.
      for (let i = below.length - 1; i >= 0; i -= 1) {
        stack.push({ ...below[i], phase: 0 });
      }
      if (trunkChild) {
        stack.push({ slot: trunkChild, section, phase: 0 });
      }
      stack.push({ slot, section, phase: 1 });
      for (let i = above.length - 1; i >= 0; i -= 1) {
        stack.push({ ...above[i], phase: 0 });
      }
    }
  };
  walk({ slot: root, section: 0 });
}

function collectLayers(members: CardSlot[]): CardSlot[][] {
  const count = members.reduce((max, slot) => Math.max(max, slot.layer), 0) + 1;
  const layers: CardSlot[][] = Array.from({ length: count }, () => []);
  for (const slot of members) {
    layers[slot.layer].push(slot);
  }
  for (const layer of layers) {
    layer.sort((a, b) => a.seq - b.seq || a.index - b.index);
  }
  return layers;
}

/**
 * The vertical pass: give every card a y that lines its ports up with the
 * ports on the other end of its wires, without two cards in a column ever
 * overlapping, and with section boundaries holding their air.
 *
 * Each sweep computes where every card WANTS to sit (the flow-weighted
 * average of its wire partners' port lines, measured port to port), then
 * settles the column with an exact solve: minimising the weighted squared
 * distance to those wishes subject to "stay in order, keep your gaps" is
 * isotonic regression, and pool-adjacent-violators gives the optimum in
 * linear time. Busy cards carry more weight, so a hub holds its line and
 * stragglers come to it.
 */
interface PartnerEntry {
  other: CardSlot;
  own: number;
  their: number;
  weight: number;
}
type PartnerMap = Map<CardSlot, PartnerEntry[]>;

function buildPartners(links: WireLink[]): PartnerMap {
  const partners: PartnerMap = new Map();
  for (const link of links) {
    // The main line is the one wire run that must read ruler-straight, so a
    // trunk-to-trunk wire pulls several times harder than its flow alone.
    const emphasis = link.from.trunk && link.to.trunk ? 3 : 1;
    push(partners, link.from, {
      other: link.to,
      own: link.fromAnchor,
      their: link.toAnchor,
      weight: link.weight * emphasis,
    });
    push(partners, link.to, {
      other: link.from,
      own: link.toAnchor,
      their: link.fromAnchor,
      weight: link.weight * emphasis,
    });
  }
  return partners;
}

/** Where a card's wires would put it, port to port, weighted by flow. */
function wishFor(
  slot: CardSlot,
  list: PartnerEntry[] | undefined,
): { wish: number; weight: number } {
  if (!list || list.length === 0) {
    return { wish: slot.y, weight: 0.1 };
  }
  let sum = 0;
  let total = 0;
  for (const p of list) {
    sum += (p.other.y + p.their - p.own) * p.weight;
    total += p.weight;
  }
  return { wish: sum / total, weight: total };
}

/**
 * The anti-crossing pass, at two levels. Within one column, every SECTION
 * moves as one block to where its members' wires pull on average, and the
 * members reorder inside their block by their own pull - so a whole band
 * dealt to the wrong side of the trunk migrates across it, a drawer fed
 * from the bottom of its machine drops below it, and two wires that would
 * cross between columns uncross, while a band can never be split up.
 * The column's seq numbers are dealt back out in the new order; seq only
 * ever means "my order within my column", so nothing else moves.
 */
function polishColumnOrder(layers: CardSlot[][], links: WireLink[]): void {
  const partners = buildPartners(links);
  for (const layer of layers) {
    if (layer.length < 2) {
      continue;
    }
    const wish = new Map<CardSlot, { y: number; w: number }>();
    for (const slot of layer) {
      const { wish: y, weight } = wishFor(slot, partners.get(slot));
      wish.set(slot, { y, w: weight });
    }
    const groups = new Map<number, CardSlot[]>();
    for (const slot of layer) {
      push(groups, slot.section, slot);
    }
    const blocks = [...groups.values()].map((cardsInGroup) => {
      cardsInGroup.sort((a, b) => wish.get(a)!.y - wish.get(b)!.y || a.seq - b.seq);
      let sum = 0;
      let weight = 0;
      for (const slot of cardsInGroup) {
        sum += wish.get(slot)!.y * wish.get(slot)!.w;
        weight += wish.get(slot)!.w;
      }
      return {
        cards: cardsInGroup,
        mean: weight > 0 ? sum / weight : 0,
        minSeq: cardsInGroup.reduce((min, slot) => Math.min(min, slot.seq), Infinity),
      };
    });
    blocks.sort((a, b) => a.mean - b.mean || a.minSeq - b.minSeq);
    const seqs = layer.map((slot) => slot.seq).sort((a, b) => a - b);
    let next = 0;
    for (const block of blocks) {
      for (const slot of block.cards) {
        slot.seq = seqs[next];
        next += 1;
      }
    }
  }
}

function placeRows(layers: CardSlot[][], links: WireLink[]): void {
  const partners = buildPartners(links);

  // First stacking: straight down in order, so every wish below starts from
  // a legal picture.
  for (const layer of layers) {
    let y = 0;
    let previous: CardSlot | undefined;
    for (const slot of layer) {
      if (previous) {
        y += gapBetween(previous, slot);
      }
      slot.y = y;
      y += slot.card.height;
      previous = slot;
    }
  }

  for (let sweep = 0; sweep < 8; sweep += 1) {
    const downward = sweep % 2 === 0;
    for (let i = 0; i < layers.length; i += 1) {
      const layer = layers[downward ? i : layers.length - 1 - i];
      const wishes = layer.map((slot) => wishFor(slot, partners.get(slot)));
      settleColumn(layer, wishes);
    }
  }

  // Pull the whole island up so its top card sits at zero.
  let top = Number.POSITIVE_INFINITY;
  for (const layer of layers) {
    for (const slot of layer) {
      top = Math.min(top, slot.y);
    }
  }
  for (const layer of layers) {
    for (const slot of layer) {
      slot.y -= top;
    }
  }
}

/** The air owed between two vertically adjacent cards in one column. */
function gapBetween(upper: CardSlot, lower: CardSlot): number {
  return upper.section === lower.section ? ROW_GAP : SECTION_GAP;
}

/**
 * The last word on straight wires. Every card lands on the grid, then each
 * card in turn snaps onto the exact line of its heaviest wire, when that is
 * a nudge of two cells or less and its column neighbours keep their air -
 * the difference between a wire that is almost straight and one that IS.
 */
function straightenRows(layers: CardSlot[][], links: WireLink[]): void {
  const partners = buildPartners(links);
  for (const layer of layers) {
    for (const slot of layer) {
      slot.y = snapToGrid(slot.y);
    }
  }
  for (let sweep = 0; sweep < 2; sweep += 1) {
    const leftToRight = sweep % 2 === 0;
    for (let i = 0; i < layers.length; i += 1) {
      const layer = layers[leftToRight ? i : layers.length - 1 - i];
      layer.forEach((slot, row) => {
        let best: { y: number; weight: number } | undefined;
        for (const p of partners.get(slot) ?? []) {
          const aligned = p.other.y + p.their - p.own;
          if (aligned % BOARD_GRID !== 0) {
            continue;
          }
          const distance = Math.abs(aligned - slot.y);
          if (distance === 0 || distance > cells(2)) {
            continue;
          }
          if (!best || p.weight > best.weight) {
            best = { y: aligned, weight: p.weight };
          }
        }
        if (!best) {
          return;
        }
        const previous = layer[row - 1];
        const next = layer[row + 1];
        const lowest = previous
          ? previous.y + previous.card.height + gapBetween(previous, slot)
          : Number.NEGATIVE_INFINITY;
        const highest = next
          ? next.y - slot.card.height - gapBetween(slot, next)
          : Number.POSITIVE_INFINITY;
        if (best.y >= lowest && best.y <= highest) {
          slot.y = best.y;
        }
      });
    }
  }
}

/**
 * Weighted isotonic regression with gaps (pool adjacent violators): place the
 * column's cards as close to their wishes as the ordering and the gaps
 * allow, exactly.
 */
function settleColumn(
  layer: CardSlot[],
  wishes: Array<{ wish: number; weight: number }>,
): void {
  if (layer.length === 0) {
    return;
  }
  // Substitute out the card heights and gaps: z_i = y_i - offset_i must
  // merely be non-decreasing.
  const offsets: number[] = [];
  let offset = 0;
  layer.forEach((slot, i) => {
    if (i > 0) {
      offset += layer[i - 1].card.height + gapBetween(layer[i - 1], slot);
    }
    offsets.push(offset);
  });
  const pools: Array<{ mean: number; weight: number; count: number }> = [];
  wishes.forEach((entry, i) => {
    let mean = entry.wish - offsets[i];
    let weight = entry.weight;
    let count = 1;
    while (pools.length > 0 && pools[pools.length - 1].mean >= mean) {
      const prev = pools.pop()!;
      mean = (prev.mean * prev.weight + mean * weight) / (prev.weight + weight);
      weight += prev.weight;
      count += prev.count;
    }
    pools.push({ mean, weight, count });
  });
  let index = 0;
  for (const pool of pools) {
    for (let i = 0; i < pool.count; i += 1) {
      layer[index].y = pool.mean + offsets[index];
      index += 1;
    }
  }
}

/* ---------------------------------------------------------------------- */
/* The shelf: cards wired to nothing, parked in tidy rows.                 */
/* ---------------------------------------------------------------------- */

function layoutShelf(parked: CardSlot[], mainWidth: number): Block {
  // Sort by footprint so alike cards sit together - drawers with drawers,
  // machines with machines - then by input order so the shelf is stable.
  const sorted = [...parked].sort(
    (a, b) =>
      b.card.height - a.card.height ||
      b.card.width - a.card.width ||
      a.index - b.index,
  );
  const targetWidth = Math.max(mainWidth, cells(60));
  const ids: string[] = [];
  const places: Placement[] = [];
  let x = 0;
  let y = 0;
  let rowHeight = 0;
  let width = 0;
  let height = 0;
  for (const slot of sorted) {
    if (x > 0 && x + slot.card.width > targetWidth) {
      x = 0;
      y += rowHeight + SHELF_GAP;
      rowHeight = 0;
    }
    ids.push(slot.card.id);
    places.push({ x, y });
    width = Math.max(width, x + slot.card.width);
    height = Math.max(height, y + slot.card.height);
    rowHeight = Math.max(rowHeight, slot.card.height);
    x += slot.card.width + SHELF_GAP;
  }
  return {
    ids,
    places,
    routes: [],
    width,
    height,
    size: sorted.length,
    minIndex: sorted.reduce((min, slot) => Math.min(min, slot.index), Number.POSITIVE_INFINITY),
    shelf: true,
  };
}
