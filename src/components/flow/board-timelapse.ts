import { playBoardSound } from "@/lib/board-sounds";
import { computeBoardLevelView } from "@/lib/model/board-windows";
import type { FactoryProject } from "@/lib/model/types";
import { useFactoryStore } from "@/store/factory-store";

/**
 * The build timelapse's SCRIPT: the order the board's cards, wires and ink
 * would appear in if someone were building the plan by hand. A dev-menu toy
 * (see DevMenu), so it is entirely a VIEW: the player's plan, selection and
 * undo history are never touched — playback only decides which already-built
 * canvas nodes and edges are hidden on a given beat.
 *
 * The order is "sources first, flowing downstream": start on a card nothing
 * feeds, then repeatedly reveal the card whose inputs are most complete,
 * preferring one wired to something already on the board and, among those,
 * the nearest — so the camera walks the factory the way a builder would
 * instead of teleporting across it. Wires appear on the beat their second
 * endpoint does; an open board's frame appears just before its first member;
 * ink (annotations) is drawn last, in reading order.
 */

export interface TimelapseBeat {
  /** Canvas node ids revealed this beat (a card, plus any frames it needs). */
  nodeIds: string[];
  /** Project edge ids whose both endpoints are now on the canvas. */
  edgeIds: string[];
  /** What the beat reveals, for pacing and sound. */
  kind: "card" | "ink";
}

export interface TimelapseScript {
  beats: TimelapseBeat[];
  /** Every canvas node id the playback hides before the first beat. */
  hiddenNodeIds: string[];
  /** Every edge id the playback hides before the first beat. */
  hiddenEdgeIds: string[];
}

type ProjectSlice = Pick<
  FactoryProject,
  "nodes" | "storages" | "annotations" | "pockets" | "edges"
>;

interface Point {
  x: number;
  y: number;
}

export function buildTimelapseScript(
  project: ProjectSlice,
  /** Absolute flow-space position of a canvas node; stored position fallback. */
  positionOf?: (nodeId: string) => Point | undefined,
): TimelapseScript {
  const view = computeBoardLevelView(project);
  const pocketById = new Map((project.pockets ?? []).map((pocket) => [pocket.id, pocket]));

  // Fallback positions from the plan itself. Members of open boards store
  // frame-relative positions, so absolute geometry from the caller is better,
  // but the order only uses positions as a tie-break and a rough one is fine.
  const storedPositionById = new Map<string, Point>();
  for (const node of project.nodes) {
    storedPositionById.set(node.id, node.position);
  }
  for (const storage of project.storages ?? []) {
    storedPositionById.set(storage.id, storage.position);
  }
  for (const annotation of project.annotations ?? []) {
    storedPositionById.set(annotation.id, annotation.position);
  }
  for (const pocket of project.pockets ?? []) {
    storedPositionById.set(pocket.id, pocket.position);
  }
  const pointFor = (id: string): Point =>
    positionOf?.(id) ?? storedPositionById.get(id) ?? { x: 0, y: 0 };

  // The UNITS are what the canvas actually shows as cards: every node and
  // storage whose owner chain is open, and every collapsed board bar (which
  // stands for everything folded behind it). Open frames are not units — they
  // reveal alongside their first member.
  const units = new Set<string>();
  for (const node of project.nodes) {
    const representative = view.representativeOf(node.id);
    if (representative) {
      units.add(representative);
    }
  }
  for (const storage of project.storages ?? []) {
    const representative = view.representativeOf(storage.id);
    if (representative) {
      units.add(representative);
    }
  }
  // Collapsed boards with no members still have a bar to reveal.
  for (const pocket of view.collapsedBoards) {
    units.add(pocket.id);
  }

  // The unit graph: project edges mapped through their representatives.
  // Edges internal to one collapsed board vanish (same unit both ends).
  const predecessors = new Map<string, Set<string>>();
  const neighbours = new Map<string, Set<string>>();
  const edgesByUnitPair = new Map<string, string[]>();
  for (const edge of project.edges) {
    const source = view.representativeOf(edge.source);
    const target = view.representativeOf(edge.target);
    if (!source || !target || source === target || !units.has(source) || !units.has(target)) {
      continue;
    }
    let preds = predecessors.get(target);
    if (!preds) {
      predecessors.set(target, (preds = new Set()));
    }
    preds.add(source);
    let forward = neighbours.get(source);
    if (!forward) {
      neighbours.set(source, (forward = new Set()));
    }
    forward.add(target);
    let backward = neighbours.get(target);
    if (!backward) {
      neighbours.set(target, (backward = new Set()));
    }
    backward.add(source);
    const pairKey = `${source}|${target}`;
    const pair = edgesByUnitPair.get(pairKey);
    if (pair) {
      pair.push(edge.id);
    } else {
      edgesByUnitPair.set(pairKey, [edge.id]);
    }
  }

  // The open frames a unit needs standing before it can appear: its owner
  // chain, outermost first.
  const framesFor = (unitId: string): string[] => {
    const pocket = pocketById.get(unitId);
    let ownerId = pocket
      ? pocket.parentPocketId
      : project.nodes.find((node) => node.id === unitId)?.pocketId ??
        (project.storages ?? []).find((storage) => storage.id === unitId)?.pocketId ??
        (project.annotations ?? []).find((annotation) => annotation.id === unitId)?.pocketId;
    const frames: string[] = [];
    const seen = new Set<string>();
    while (ownerId !== undefined && !seen.has(ownerId)) {
      seen.add(ownerId);
      frames.unshift(ownerId);
      ownerId = pocketById.get(ownerId)?.parentPocketId;
    }
    return frames;
  };

  const revealedNodes = new Set<string>();
  const revealedEdges = new Set<string>();
  const beats: TimelapseBeat[] = [];

  const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

  const revealUnit = (unitId: string) => {
    const nodeIds: string[] = [];
    for (const frameId of framesFor(unitId)) {
      if (!revealedNodes.has(frameId)) {
        revealedNodes.add(frameId);
        nodeIds.push(frameId);
      }
    }
    revealedNodes.add(unitId);
    nodeIds.push(unitId);
    // Wires land the moment their second endpoint exists.
    const edgeIds: string[] = [];
    for (const other of neighbours.get(unitId) ?? []) {
      if (!revealedNodes.has(other)) {
        continue;
      }
      for (const pairKey of [`${unitId}|${other}`, `${other}|${unitId}`]) {
        for (const edgeId of edgesByUnitPair.get(pairKey) ?? []) {
          if (!revealedEdges.has(edgeId)) {
            revealedEdges.add(edgeId);
            edgeIds.push(edgeId);
          }
        }
      }
    }
    beats.push({ nodeIds, edgeIds, kind: "card" });
  };

  // Greedy build order. Each step scores every unrevealed unit by, in order:
  // how many of its feeders are still missing (0 = every input already on the
  // board), whether anything it is wired to is on the board at all, and how
  // far it sits from the last card placed. Deterministic: ties fall through
  // to the id.
  const remaining = new Set(units);
  let lastPoint: Point | undefined;
  while (remaining.size > 0) {
    let best: string | undefined;
    let bestKey: [number, number, number, string] | undefined;
    for (const unitId of remaining) {
      let missingFeeders = 0;
      for (const pred of predecessors.get(unitId) ?? []) {
        if (!revealedNodes.has(pred)) {
          missingFeeders += 1;
        }
      }
      let adjacent = 0;
      if (revealedNodes.size > 0) {
        adjacent = 1;
        for (const other of neighbours.get(unitId) ?? []) {
          if (revealedNodes.has(other)) {
            adjacent = 0;
            break;
          }
        }
      }
      const point = pointFor(unitId);
      const travel = lastPoint ? distance(point, lastPoint) : point.y * 4 + point.x;
      const key: [number, number, number, string] = [missingFeeders, adjacent, travel, unitId];
      if (
        !bestKey ||
        key[0] < bestKey[0] ||
        (key[0] === bestKey[0] &&
          (key[1] < bestKey[1] ||
            (key[1] === bestKey[1] &&
              (key[2] < bestKey[2] || (key[2] === bestKey[2] && key[3] < bestKey[3])))))
      ) {
        bestKey = key;
        best = unitId;
      }
    }
    if (!best) {
      break;
    }
    remaining.delete(best);
    revealUnit(best);
    lastPoint = pointFor(best);
  }

  // Open boards nothing lives in still have a frame to show.
  for (const pocket of view.openBoards) {
    if (!revealedNodes.has(pocket.id)) {
      const nodeIds = framesFor(pocket.id).filter((id) => !revealedNodes.has(id));
      nodeIds.push(pocket.id);
      for (const id of nodeIds) {
        revealedNodes.add(id);
      }
      beats.push({ nodeIds, edgeIds: [], kind: "card" });
    }
  }

  // Ink last, in reading order.
  const inkUnits = (project.annotations ?? [])
    .map((annotation) => view.representativeOf(annotation.id))
    .filter((id): id is string => Boolean(id && !revealedNodes.has(id)))
    .sort((left, right) => {
      const a = pointFor(left);
      const b = pointFor(right);
      return a.y - b.y || a.x - b.x || (left < right ? -1 : 1);
    });
  for (const inkId of inkUnits) {
    if (revealedNodes.has(inkId)) {
      continue;
    }
    const nodeIds = framesFor(inkId).filter((id) => !revealedNodes.has(id));
    nodeIds.push(inkId);
    for (const id of nodeIds) {
      revealedNodes.add(id);
    }
    beats.push({ nodeIds, edgeIds: [], kind: "ink" });
  }

  // Any edge the walk never claimed (dangling endpoints, edges into units
  // that never revealed) rides the last beat so nothing is left hidden.
  const strayEdges = project.edges
    .map((edge) => edge.id)
    .filter((id) => !revealedEdges.has(id));
  if (strayEdges.length > 0 && beats.length > 0) {
    beats[beats.length - 1].edgeIds.push(...strayEdges);
  }

  return {
    beats,
    hiddenNodeIds: [...revealedNodes],
    hiddenEdgeIds: project.edges.map((edge) => edge.id),
  };
}

/**
 * Absolute flow-space positions from the plan alone: a member of an open
 * board stores a frame-relative position, so its absolute point is its own
 * plus every ancestor frame's corner. Good enough for the script's
 * nearest-card tie-breaks; the camera resolves its own geometry.
 */
function absolutePositionLookup(project: ProjectSlice): (id: string) => Point | undefined {
  const pocketById = new Map((project.pockets ?? []).map((pocket) => [pocket.id, pocket]));
  const entries = new Map<string, { position: Point; ownerId: string | undefined }>();
  for (const node of project.nodes) {
    entries.set(node.id, { position: node.position, ownerId: node.pocketId });
  }
  for (const storage of project.storages ?? []) {
    entries.set(storage.id, { position: storage.position, ownerId: storage.pocketId });
  }
  for (const annotation of project.annotations ?? []) {
    entries.set(annotation.id, { position: annotation.position, ownerId: annotation.pocketId });
  }
  for (const pocket of project.pockets ?? []) {
    entries.set(pocket.id, { position: pocket.position, ownerId: pocket.parentPocketId });
  }
  return (id: string) => {
    const entry = entries.get(id);
    if (!entry) {
      return undefined;
    }
    let x = entry.position.x;
    let y = entry.position.y;
    let ownerId = entry.ownerId;
    const seen = new Set<string>();
    while (ownerId !== undefined && !seen.has(ownerId)) {
      seen.add(ownerId);
      const owner = pocketById.get(ownerId);
      if (!owner) {
        break;
      }
      x += owner.position.x;
      y += owner.position.y;
      ownerId = owner.parentPocketId;
    }
    return { x, y };
  };
}

// ---------------------------------------------------------------------------
// Playback: a module store in the PerfHud shape. DevMenu starts it, the board
// subscribes for the hidden sets, and everything runs off setTimeout beats -
// no React state of its own, no project mutation, one snapshot per beat.
// ---------------------------------------------------------------------------

export interface BoardTimelapseSnapshot {
  revealedNodeIds: ReadonlySet<string>;
  revealedEdgeIds: ReadonlySet<string>;
}

/** The whole run aims at about this long, whatever the board's size... */
const TIMELAPSE_TARGET_MS = 16_000;
/** ...held between these per-card beats, so tiny boards still read as a
 * sequence and huge ones do not run for minutes. */
const TIMELAPSE_MIN_BEAT_MS = 160;
const TIMELAPSE_MAX_BEAT_MS = 650;
/** Ink is a flourish at the end, not the show. */
const TIMELAPSE_INK_BEAT_MS = 220;
/** The finished board holds for a breath before the overlay lifts. */
const TIMELAPSE_FINISH_HOLD_MS = 1600;
/** Camera refits are throttled: beats can be far quicker than the 420ms
 * camera glide, and restarting the glide every beat reads as a shudder. */
const TIMELAPSE_CAMERA_MIN_GAP_MS = 380;

let activeSnapshot: BoardTimelapseSnapshot | undefined;
const listeners = new Set<() => void>();
let stepTimer: ReturnType<typeof setTimeout> | undefined;
let soundTimer: ReturnType<typeof setTimeout> | undefined;
let playToken = 0;

function emit() {
  for (const listener of listeners) {
    listener();
  }
}

export function subscribeBoardTimelapse(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getBoardTimelapseSnapshot(): BoardTimelapseSnapshot | undefined {
  return activeSnapshot;
}

/** SSR half of the useSyncExternalStore pair: never active on the server. */
export function getServerBoardTimelapseSnapshot(): BoardTimelapseSnapshot | undefined {
  return undefined;
}

/** Stops the run and lifts every hidden flag at once. Safe to call idle. */
export function stopBoardTimelapse(): void {
  playToken += 1;
  if (stepTimer !== undefined) {
    clearTimeout(stepTimer);
    stepTimer = undefined;
  }
  if (soundTimer !== undefined) {
    clearTimeout(soundTimer);
    soundTimer = undefined;
  }
  if (activeSnapshot) {
    activeSnapshot = undefined;
    emit();
    // The board is whole again: frame it, the way an arrange or import does.
    useFactoryStore.getState().frameBoardNodes();
  }
}

/**
 * Plays the current plan as a build timelapse. Returns false when there is
 * nothing worth playing (fewer than two cards on the canvas).
 */
export function startBoardTimelapse(): boolean {
  const store = useFactoryStore.getState();
  const project = store.project;
  const script = buildTimelapseScript(project, absolutePositionLookup(project));
  const cardBeats = script.beats.filter((beat) => beat.kind === "card").length;
  if (cardBeats < 2) {
    return false;
  }

  stopBoardTimelapse();
  const token = ++playToken;
  const projectId = project.id;
  const beatMs = Math.min(
    TIMELAPSE_MAX_BEAT_MS,
    Math.max(TIMELAPSE_MIN_BEAT_MS, Math.round(TIMELAPSE_TARGET_MS / cardBeats)),
  );

  activeSnapshot = { revealedNodeIds: new Set(), revealedEdgeIds: new Set() };
  emit();

  let index = 0;
  let lastCameraAt = 0;
  const step = () => {
    stepTimer = undefined;
    if (token !== playToken) {
      return;
    }
    const state = useFactoryStore.getState();
    // A different plan under the same playback means the script is about a
    // board that no longer exists; stop rather than hide the new one.
    if (state.project.id !== projectId || !activeSnapshot) {
      stopBoardTimelapse();
      return;
    }

    const beat = script.beats[index];
    const revealedNodeIds = new Set(activeSnapshot.revealedNodeIds);
    const revealedEdgeIds = new Set(activeSnapshot.revealedEdgeIds);
    for (const id of beat.nodeIds) {
      revealedNodeIds.add(id);
    }
    for (const id of beat.edgeIds) {
      revealedEdgeIds.add(id);
    }
    activeSnapshot = { revealedNodeIds, revealedEdgeIds };
    emit();

    playBoardSound(beat.kind === "ink" ? "adjust" : "place");
    if (beat.edgeIds.length > 0) {
      soundTimer = setTimeout(() => {
        soundTimer = undefined;
        if (token === playToken) {
          playBoardSound("connect");
        }
      }, Math.round(beatMs / 2));
    }

    // The camera fits everything built so far: it starts close on the first
    // machine and backs off as the factory grows, ending on the whole plan.
    const now = Date.now();
    const isLastBeat = index === script.beats.length - 1;
    if (isLastBeat || now - lastCameraAt >= TIMELAPSE_CAMERA_MIN_GAP_MS) {
      lastCameraAt = now;
      state.frameBoardNodes([...revealedNodeIds], { maxZoom: 1 });
    }

    index += 1;
    if (index >= script.beats.length) {
      stepTimer = setTimeout(() => {
        stepTimer = undefined;
        if (token === playToken) {
          playBoardSound("sweep");
          stopBoardTimelapse();
        }
      }, TIMELAPSE_FINISH_HOLD_MS);
      return;
    }
    stepTimer = setTimeout(step, beat.kind === "ink" ? TIMELAPSE_INK_BEAT_MS : beatMs);
  };

  // One quiet moment on the emptied board before the first card lands.
  stepTimer = setTimeout(step, 420);
  return true;
}
