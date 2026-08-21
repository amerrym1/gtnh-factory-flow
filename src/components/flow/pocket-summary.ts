import { BOARD_GRID } from "@/lib/board-grid";
import { getNodeMachineBuildCount } from "@/lib/model/passive-production";
import type {
  FactoryPocket,
  FactoryProject,
  ResourceAmount,
  ResourceBalance,
  ThroughputResult,
} from "@/lib/model/types";

/**
 * What a MINIMIZED board says about itself.
 *
 * A minimized board is a SUMMARY, not a machine: you cannot wire to it, it
 * has no ports, and it makes no claim about being fed. It reports two
 * things - what is inside (machines, cards, power) and what crosses its
 * border right now - and both come straight out of the plan-wide solve.
 *
 * That is the whole design, and it is deliberately smaller than what came
 * before. The card used to run its own SCOPED solve over the members with
 * the outside world unhooked, and then wear the result as input and output
 * ports. It read like a machine and lied like one: a board holding its own
 * source was told it was starving, because the scoped solve cut the source's
 * wires; a board exporting a byproduct was told it was clogged. Every one of
 * those verdicts was about a factory that does not exist - the members are
 * ordinary cards in the flat graph, and the real solver has been simulating
 * them, with their real supply, all along.
 */

/** One resource crossing a minimized board's border, in one direction. */
export interface PocketCrossing {
  key: string;
  kind: ResourceBalance["kind"];
  resourceId: string;
  displayName?: string;
  iconPath?: string;
  iconAtlas?: ResourceAmount["iconAtlas"];
  dominantColor?: string;
  /** What is really moving across the border, summed over its wires. */
  ratePerSecond: number;
  /** How many wires carry it. */
  wireCount: number;
}

export interface PocketSummary {
  /** Resources arriving from outside, busiest first. */
  incoming: PocketCrossing[];
  /** Resources leaving for outside, busiest first. */
  outgoing: PocketCrossing[];
  /** Machines inside, nested boards included. */
  machineCount: number;
  /** Cards inside, nested boards included. */
  memberCount: number;
  /** What those machines are drawing at the speed they are running. */
  euPerTick: number;
}

/** Crossing lines the card draws per side before it says "and N more". */
export const POCKET_CARD_MAX_ROWS = 5;

/**
 * How tall a minimized card stands, from the number of crossings alone.
 *
 * The card and the auto-arranger both call this, so the layout can size a
 * minimized board before it has ever been measured on screen: head row,
 * the two column labels, a row per crossing line, and the stat footer.
 */
export function pocketCardHeight(incoming: number, outgoing: number): number {
  const crossings = Math.max(incoming, outgoing);
  if (crossings === 0) {
    // Head, one line saying nothing crosses, footer.
    return BOARD_GRID * 6;
  }
  const shown = Math.min(crossings, POCKET_CARD_MAX_ROWS);
  const overflow =
    incoming > POCKET_CARD_MAX_ROWS || outgoing > POCKET_CARD_MAX_ROWS ? 1 : 0;
  return BOARD_GRID * (2 + 1 + 2 * (shown + overflow) + 2);
}

/** Every board nested under `pocketId`, itself included. */
function pocketFamily(allPockets: FactoryPocket[], pocketId: string): Set<string> {
  const family = new Set<string>([pocketId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const entry of allPockets) {
      if (
        entry.parentPocketId !== undefined &&
        family.has(entry.parentPocketId) &&
        !family.has(entry.id)
      ) {
        family.add(entry.id);
        grew = true;
      }
    }
  }
  return family;
}

/** The cards living inside a board, nested boards included. */
function pocketMemberIds(project: FactoryProject, pocketId: string): Set<string> {
  const family = pocketFamily(project.pockets ?? [], pocketId);
  const members = new Set<string>();
  for (const node of project.nodes) {
    if (node.pocketId !== undefined && family.has(node.pocketId)) {
      members.add(node.id);
    }
  }
  for (const storage of project.storages ?? []) {
    if (storage.pocketId !== undefined && family.has(storage.pocketId)) {
      members.add(storage.id);
    }
  }
  return members;
}

/**
 * How many distinct resources cross a board's border each way.
 *
 * Structural: no solve, no rates. The auto-arranger sizes a minimized card
 * with this before any of it is on screen, and the card draws exactly this
 * many rows, so the two agree without one having to wait for the other.
 */
export function countPocketCrossings(
  project: FactoryProject,
  pocketId: string,
): { incoming: number; outgoing: number } {
  const members = pocketMemberIds(project, pocketId);
  const incoming = new Set<string>();
  const outgoing = new Set<string>();
  for (const edge of project.edges) {
    const sourceInside = members.has(edge.source);
    const targetInside = members.has(edge.target);
    if (sourceInside === targetInside) {
      continue;
    }
    (targetInside ? incoming : outgoing).add(`${edge.resourceKind}:${edge.resourceId}`);
  }
  return { incoming: incoming.size, outgoing: outgoing.size };
}

export function computePocketSummaries(
  project: FactoryProject,
  pockets: FactoryPocket[],
  result?: ThroughputResult,
): Map<string, PocketSummary> {
  const summaries = new Map<string, PocketSummary>();
  if (pockets.length === 0) {
    return summaries;
  }

  const icons = buildResourceIconLookup(project);
  const recipesById = new Map(project.recipes.map((recipe) => [recipe.id, recipe]));

  for (const pocket of pockets) {
    const memberIds = pocketMemberIds(project, pocket.id);
    const incoming = new Map<string, PocketCrossing>();
    const outgoing = new Map<string, PocketCrossing>();

    for (const edge of project.edges) {
      const sourceInside = memberIds.has(edge.source);
      const targetInside = memberIds.has(edge.target);
      if (sourceInside === targetInside) {
        continue;
      }
      const side = targetInside ? incoming : outgoing;
      const key = `${edge.resourceKind}:${edge.resourceId}`;
      // Several wires carrying one resource across one border are ONE line
      // on the card, exactly as they are one drawn wire on the board.
      const existing = side.get(key);
      const rate = result?.edges[edge.id]?.transferredPerSecond ?? 0;
      if (existing) {
        existing.ratePerSecond += rate;
        existing.wireCount += 1;
        continue;
      }
      const icon = icons.get(key);
      side.set(key, {
        key,
        kind: edge.resourceKind,
        resourceId: edge.resourceId,
        displayName: icon?.displayName ?? edge.label,
        iconPath: icon?.iconPath,
        iconAtlas: icon?.iconAtlas,
        dominantColor: icon?.dominantColor,
        ratePerSecond: rate,
        wireCount: 1,
      });
    }

    let machineCount = 0;
    let euPerTick = 0;
    for (const node of project.nodes) {
      if (!memberIds.has(node.id)) {
        continue;
      }
      machineCount += getNodeMachineBuildCount(recipesById.get(node.recipeId), node);
      const nodeResult = result?.nodes[node.id];
      if (nodeResult) {
        // Solver figures are FULL SPEED; what a board is drawing is what its
        // machines are actually running at.
        euPerTick += nodeResult.euT * Math.min(Math.max(nodeResult.utilization ?? 0, 0), 1);
      }
    }

    summaries.set(pocket.id, {
      incoming: sortCrossings(incoming),
      outgoing: sortCrossings(outgoing),
      machineCount,
      memberCount: memberIds.size,
      euPerTick,
    });
  }

  return summaries;
}

/** Busiest first, then by name, so the card's order is stable and useful. */
function sortCrossings(crossings: Map<string, PocketCrossing>): PocketCrossing[] {
  return [...crossings.values()].sort((left, right) => {
    if (right.ratePerSecond !== left.ratePerSecond) {
      return right.ratePerSecond - left.ratePerSecond;
    }
    return (left.displayName ?? left.resourceId).localeCompare(
      right.displayName ?? right.resourceId,
    );
  });
}

type ResourceIconMeta = Pick<
  ResourceAmount,
  "displayName" | "iconPath" | "iconAtlas" | "dominantColor"
>;

function buildResourceIconLookup(project: FactoryProject): Map<string, ResourceIconMeta> {
  const icons = new Map<string, ResourceIconMeta>();
  const add = (resource: Pick<ResourceAmount, "kind" | "id"> & ResourceIconMeta) => {
    const key = `${resource.kind}:${resource.id}`;
    const existing = icons.get(key);
    if (!existing || (!existing.iconPath && resource.iconPath)) {
      icons.set(key, resource);
    }
  };

  for (const recipe of project.recipes) {
    for (const resource of [...recipe.inputs, ...recipe.outputs]) {
      add(resource);
    }
  }
  for (const storage of project.storages ?? []) {
    add({
      kind: storage.kind,
      id: storage.resourceId,
      displayName: storage.displayName,
      iconPath: storage.iconPath,
      iconAtlas: storage.iconAtlas,
      dominantColor: storage.dominantColor,
    });
  }
  return icons;
}
