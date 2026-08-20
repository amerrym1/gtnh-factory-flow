import type { FactoryProject, ResourceKey, ThroughputResult } from "@/lib/model/types";
import { solveEquationsCore } from "@/lib/solver/equations-core";

/**
 * Clog locks: machines frozen at 0% because their surpluses have nowhere to
 * go and every escape route runs through another jammed member.
 *
 * The death spiral's mirror image. A spiral STARVES: the loop loses material
 * every lap, winds down, and every card sits empty. A clog lock CHOKES: the
 * loop makes MORE of some good than it can swallow, the spare piles up until
 * every buffer is full, and then nobody can run because nobody has room. In
 * game the line freezes with every slot stuffed - full inputs, full outputs,
 * no progress arrow - and pulling a stack out by hand buys seconds before it
 * jams again. The solver's zeros are that end state, reached instantly.
 *
 * Detection is a proof, not a guess: the board is re-solved once with every
 * wired output port allowed to shed surplus at a cost (the vent solve in
 * equations-core). Machines that come alive in that world were stopped by
 * nothing but the surplus, and the vents the solve could not avoid name the
 * exact wires a drawer or trash can would rescue. A starving ring stays dead
 * in the vented world too, so the two detectors can never claim the same
 * machines.
 */

const DEAD_EPSILON = 1e-4;
const REVIVED_EPSILON = 1e-3;

export interface ClogLockVent {
  nodeId: string;
  resourceKey: ResourceKey;
  resourceName: string;
  /** What must leave through this port per second for the group to run. */
  perSecond: number;
}

export interface ClogLock {
  /** Stable id: the smallest member node id. Survives re-solves. */
  id: string;
  /** Every frozen card the jam holds, machines and pass-through drawers. */
  nodeIds: string[];
  /** Machine members only - what the copy counts. */
  machineIds: string[];
  /**
   * The machines whose surplus needs the drawer - the only cards that flash.
   * A jam can hold half a board; marking every member painted whole plans
   * blue and pointed nowhere. The victims keep the verdict and its story,
   * the vent sites carry the ring, exactly as the fix copy promises.
   */
  ventNodeIds: string[];
  /** The wires carrying a vented surplus out of a vent site - the ones the
   * drawer tees into. Only these breathe, never the whole web. */
  edgeIds: string[];
  /** The surpluses that need a home, largest first. */
  vents: ClogLockVent[];
}

export interface ClogLockIndex {
  byNode: Map<string, ClogLock>;
  byEdge: Map<string, ClogLock>;
  locks: ClogLock[];
}

const EMPTY_INDEX: ClogLockIndex = { byNode: new Map(), byEdge: new Map(), locks: [] };

// Keyed on object identity like the death-spiral index: the solver hands out
// a fresh result per solve, so a stale index cannot outlive its numbers.
const cache = new WeakMap<
  FactoryProject,
  { result: ThroughputResult | undefined; index: ClogLockIndex }
>();

export function findClogLocks(
  project: FactoryProject,
  result: ThroughputResult | undefined,
): ClogLockIndex {
  const cached = cache.get(project);
  if (cached && cached.result === result) {
    return cached.index;
  }
  const index = build(project, result);
  cache.set(project, { result, index });
  return index;
}

function build(project: FactoryProject, result: ThroughputResult | undefined): ClogLockIndex {
  if (!result) {
    return EMPTY_INDEX;
  }

  // The vent solve costs a real LP, so it only runs when the board shows the
  // symptom: an enabled machine at a dead stop. Healthy boards skip it.
  const frozen = new Set<string>();
  for (const node of project.nodes) {
    if (node.enabled === false) {
      continue;
    }
    const report = result.nodes[node.id];
    if (report && report.status !== "missing-recipe" && report.utilization <= DEAD_EPSILON) {
      frozen.add(node.id);
    }
  }
  if (frozen.size === 0) {
    return EMPTY_INDEX;
  }

  const vented = solveEquationsCore(project, result.nodes, undefined, undefined, {
    ventOutputs: true,
  });
  if (vented.status !== "optimal") {
    return EMPTY_INDEX;
  }

  // Revived: frozen in the books, running once surplus may leave. Stopped by
  // nothing but the jam.
  const revived = new Set<string>();
  for (const id of frozen) {
    if ((vented.utilization.get(id) ?? 0) > REVIVED_EPSILON) {
      revived.add(id);
    }
  }
  if (revived.size === 0) {
    return EMPTY_INDEX;
  }

  // One lock per connected group of revived machines, drawers riding along
  // as pass-through hops, exactly as the death spiral walks its rings.
  const storageIds = new Set((project.storages ?? []).map((storage) => storage.id));
  const adjacency = new Map<string, Set<string>>();
  const link = (a: string, b: string) => {
    let bucket = adjacency.get(a);
    if (!bucket) {
      bucket = new Set();
      adjacency.set(a, bucket);
    }
    bucket.add(b);
  };
  const inGraph = (id: string) => revived.has(id) || storageIds.has(id);
  for (const edge of project.edges) {
    if (inGraph(edge.source) && inGraph(edge.target)) {
      link(edge.source, edge.target);
      link(edge.target, edge.source);
    }
  }

  const byNode = new Map<string, ClogLock>();
  const byEdge = new Map<string, ClogLock>();
  const locks: ClogLock[] = [];
  const visited = new Set<string>();
  for (const seed of revived) {
    if (visited.has(seed)) {
      continue;
    }
    const component = new Set<string>();
    const queue = [seed];
    visited.add(seed);
    while (queue.length > 0) {
      const id = queue.pop()!;
      component.add(id);
      for (const next of adjacency.get(id) ?? []) {
        // Drawers connect members but never pull outsiders in: only walk on
        // through a drawer when a revived machine sits on its far side.
        if (!visited.has(next) && inGraph(next)) {
          visited.add(next);
          queue.push(next);
        }
      }
    }
    const machineIds = [...component].filter((id) => revived.has(id)).sort();
    if (machineIds.length === 0) {
      continue;
    }
    // Drawers count as members when they sit between two members, so the
    // group and its "Show me" hold together across pass-through tanks.
    const memberSet = new Set(machineIds);
    const passThrough = new Set<string>();
    for (const edge of project.edges) {
      if (memberSet.has(edge.source) && storageIds.has(edge.target) && component.has(edge.target)) {
        passThrough.add(edge.target);
      }
      if (memberSet.has(edge.target) && storageIds.has(edge.source) && component.has(edge.source)) {
        passThrough.add(edge.source);
      }
    }

    const vents: ClogLockVent[] = [];
    for (const id of machineIds) {
      const byKey = vented.ventPerSecond?.get(id);
      if (!byKey) {
        continue;
      }
      for (const [resourceKey, perSecond] of byKey) {
        const resourceName =
          result.nodes[id]?.outputs[resourceKey]?.displayName ?? resourceKey.split(":").pop()!;
        vents.push({ nodeId: id, resourceKey, resourceName, perSecond });
      }
    }
    vents.sort((left, right) => right.perSecond - left.perSecond);
    // No vent inside the group means the jam is not this group's own doing
    // (its surplus problem lives elsewhere on the board); stay silent rather
    // than mark cards with no fix to offer.
    if (vents.length === 0) {
      continue;
    }

    // Only the vent sites and their surplus wires get marked. A jam can hold
    // half a board, and flashing every member painted whole plans blue with
    // nothing to point at; the drawer goes on THESE wires, so these carry
    // the light.
    const ventNodeIds = [...new Set(vents.map((vent) => vent.nodeId))].sort();
    const ventPorts = new Set(vents.map((vent) => `${vent.nodeId}|${vent.resourceKey}`));
    const edgeIds: string[] = [];
    for (const edge of project.edges) {
      if (ventPorts.has(`${edge.source}|${edge.resourceKind}:${edge.resourceId}`)) {
        edgeIds.push(edge.id);
      }
    }

    const lock: ClogLock = {
      id: machineIds[0]!,
      nodeIds: [...machineIds, ...passThrough].sort(),
      machineIds,
      ventNodeIds,
      edgeIds,
      vents,
    };
    locks.push(lock);
    for (const id of lock.nodeIds) {
      byNode.set(id, lock);
    }
    for (const id of edgeIds) {
      byEdge.set(id, lock);
    }
  }

  locks.sort((left, right) => right.machineIds.length - left.machineIds.length);
  return { byNode, byEdge, locks };
}

/** One place turns numbers into copy, like describeDeathSpiral next door. */
export function describeClogLock(lock: ClogLock): {
  title: string;
  /** One line, for the board notice. The long version lives on the cards. */
  short: string;
  what: string;
  why: string;
  fix: string;
} {
  const count = lock.machineIds.length;
  const vent = lock.vents[0]!;
  const rate =
    vent.perSecond >= 10
      ? Math.round(vent.perSecond).toString()
      : vent.perSecond.toFixed(vent.perSecond >= 1 ? 1 : 2);
  const more = lock.vents.length > 1 ? ` (${lock.vents.length - 1} more like it)` : "";

  return {
    title: count === 1 ? "This machine is choking on its own surplus" : "These machines are choking on a surplus",
    short:
      count === 1
        ? `A machine stopped because its spare ${vent.resourceName} has nowhere to go. Wire it to a drawer and it runs.`
        : `${count} machines stopped because spare ${vent.resourceName} has nowhere to go. Give it a drawer and they all run.`,
    what: `${count === 1 ? "One machine" : `${count} machines`} sit at 0% with everything they need. The line makes more ${vent.resourceName} than it uses, and the spare has no drawer, no trash can and no consumer with room.`,
    why: "In game the spare piles up until every chest and slot on the line is full, and then nothing can run because nothing has room. Full inputs, full outputs, no progress: the opposite of starving. Taking a stack out by hand restarts it for a few seconds before it jams the same way again.",
    fix: `Give ${vent.resourceName} somewhere to go${more}: a drawer or a trash can on the marked wire. About ${rate}/s needs to leave for the line to run at the speed shown.`,
  };
}
