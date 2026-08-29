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
  /** Canvas node ids revealed this beat; empty for a pure wire beat. */
  nodeIds: string[];
  /** Project edge ids whose both endpoints are now on the canvas. */
  edgeIds: string[];
  /**
   * What the beat does, for pacing and sound. A machine lands as a `card`
   * beat and its wires follow as a separate `wire` beat - placing and
   * wiring are two acts. A storage is the exception: the app's own drawer
   * gesture creates drawer and wire together, so its card beat carries its
   * edges. A `board` beat stands an open frame up AFTER everything in it
   * is on the table.
   */
  kind: "card" | "wire" | "board" | "ink";
  /**
   * What the camera should watch during this beat when that is not the
   * revealed nodes themselves. A wire beat names only its NEAR end - the
   * card whose wiring pass this is. The far end already stands, often a
   * screen away, and a shot stretched to hold both ends of every dock
   * was what kept the camera cutting instead of holding its vantage.
   */
  focusNodeIds?: string[];
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

  // Which open board a unit sits in directly (undefined = the root), and
  // how many completion members each open board still waits on. A frame
  // does NOT stand before its members - it is drawn AROUND them once the
  // last one is on the table, the way Ctrl+G wraps a finished selection.
  // Annotations deliberately do not hold a frame up; ink comes last.
  const storageIds = new Set((project.storages ?? []).map((storage) => storage.id));
  const unitOwner = new Map<string, string | undefined>();
  for (const node of project.nodes) {
    if (units.has(node.id)) {
      unitOwner.set(node.id, node.pocketId);
    }
  }
  for (const storage of project.storages ?? []) {
    if (units.has(storage.id)) {
      unitOwner.set(storage.id, storage.pocketId);
    }
  }
  for (const pocket of view.collapsedBoards) {
    unitOwner.set(pocket.id, pocket.parentPocketId);
  }
  const pendingMembers = new Map<string, number>();
  for (const pocket of view.openBoards) {
    pendingMembers.set(pocket.id, 0);
  }
  const countMemberOf = (ownerId: string | undefined) => {
    if (ownerId !== undefined && pendingMembers.has(ownerId)) {
      pendingMembers.set(ownerId, (pendingMembers.get(ownerId) ?? 0) + 1);
    }
  };
  for (const [, ownerId] of unitOwner) {
    countMemberOf(ownerId);
  }
  for (const pocket of view.openBoards) {
    // A child board's frame is itself a member its parent waits on.
    countMemberOf(pocket.parentPocketId);
  }

  const revealedNodes = new Set<string>();
  const revealedEdges = new Set<string>();
  const beats: TimelapseBeat[] = [];

  const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

  // A member landed: any open board whose last member this was gets its
  // frame drawn, which can in turn finish the board above it.
  const settleFrames = (ownerId: string | undefined) => {
    while (ownerId !== undefined && pendingMembers.has(ownerId)) {
      const left = (pendingMembers.get(ownerId) ?? 0) - 1;
      pendingMembers.set(ownerId, left);
      if (left > 0) {
        return;
      }
      revealedNodes.add(ownerId);
      beats.push({ nodeIds: [ownerId], edgeIds: [], kind: "board" });
      ownerId = pocketById.get(ownerId)?.parentPocketId;
    }
  };

  // MACHINES anchor the show; sources and products are their attendants. A
  // drawer, tank or custom-rate card never leads - it spins in beside the
  // machine that wants it, wire attached, the way the drawer gesture makes
  // both at once. Everything else lands bare and wires up beat by beat.
  const attachmentIds = new Set<string>();
  for (const id of storageIds) {
    if (units.has(id)) {
      attachmentIds.add(id);
    }
  }
  for (const node of project.nodes) {
    if (units.has(node.id) && node.customRate) {
      attachmentIds.add(node.id);
    }
  }
  const machineIds = [...units].filter((id) => !attachmentIds.has(id));

  // A machine's REAL feeders for the build order: upstream machines, seen
  // directly or through one attachment (a buffer between two machines). A
  // pure source drawer is not a feeder - it spawns on demand, so a machine
  // fed only by sources counts as ready.
  const machinePreds = new Map<string, Set<string>>();
  for (const machineId of machineIds) {
    const preds = new Set<string>();
    for (const pred of predecessors.get(machineId) ?? []) {
      if (!attachmentIds.has(pred)) {
        preds.add(pred);
      } else {
        for (const behind of predecessors.get(pred) ?? []) {
          if (!attachmentIds.has(behind)) {
            preds.add(behind);
          }
        }
      }
    }
    machinePreds.set(machineId, preds);
  }

  // Every wire is its own action: one edge per beat, drawn only once both
  // ends stand.
  const revealWiresOf = (unitId: string) => {
    for (const other of neighbours.get(unitId) ?? []) {
      if (!revealedNodes.has(other)) {
        continue;
      }
      for (const pairKey of [`${unitId}|${other}`, `${other}|${unitId}`]) {
        for (const edgeId of edgesByUnitPair.get(pairKey) ?? []) {
          if (!revealedEdges.has(edgeId)) {
            revealedEdges.add(edgeId);
            beats.push({
              nodeIds: [],
              edgeIds: [edgeId],
              kind: "wire",
              focusNodeIds: [unitId],
            });
          }
        }
      }
    }
  };

  // An attendant arrives with every wire it can already dock - usually just
  // the one to the machine that summoned it.
  const revealAttachment = (unitId: string) => {
    revealedNodes.add(unitId);
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
    beats.push({ nodeIds: [unitId], edgeIds, kind: "card" });
    settleFrames(unitOwner.get(unitId));
  };

  const readingOrder = (left: string, right: string) => {
    const a = pointFor(left);
    const b = pointFor(right);
    return a.y - b.y || a.x - b.x || (left < right ? -1 : 1);
  };

  // The machine lands bare; each wire to what already stands is its own
  // beat; then its sources spin in, then its products, each with their wire.
  const revealMachine = (unitId: string) => {
    revealedNodes.add(unitId);
    beats.push({ nodeIds: [unitId], edgeIds: [], kind: "card" });
    revealWiresOf(unitId);
    const sources: string[] = [];
    const products: string[] = [];
    for (const other of neighbours.get(unitId) ?? []) {
      if (!attachmentIds.has(other) || revealedNodes.has(other)) {
        continue;
      }
      (edgesByUnitPair.has(`${other}|${unitId}`) ? sources : products).push(other);
    }
    sources.sort(readingOrder);
    products.sort(readingOrder);
    for (const attachment of [...sources, ...products]) {
      revealAttachment(attachment);
    }
    settleFrames(unitOwner.get(unitId));
  };

  // Greedy build order over the MACHINES. Each step scores every unplaced
  // machine by, in order: how many of its feeder machines are still missing
  // (0 = its whole upstream already runs), whether anything it is wired to
  // is on the board at all, and how far it sits from the last machine
  // placed. Deterministic: ties fall through to the id.
  const remaining = new Set(machineIds);
  let lastPoint: Point | undefined;
  while (remaining.size > 0) {
    let best: string | undefined;
    let bestKey: [number, number, number, string] | undefined;
    for (const unitId of remaining) {
      let missingFeeders = 0;
      for (const pred of machinePreds.get(unitId) ?? []) {
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
    revealMachine(best);
    lastPoint = pointFor(best);
  }

  // Attendants nothing summoned: loose drawers, or attachment-only chains.
  // They arrive last among the cards, in reading order, wires included.
  const strayAttachments = [...attachmentIds]
    .filter((id) => !revealedNodes.has(id))
    .sort(readingOrder);
  for (const attachment of strayAttachments) {
    revealAttachment(attachment);
  }

  // Boards holding no completion members (empty, or ink-only) still have a
  // frame to draw. Deepest last in view.openBoards order is parents-first;
  // reversing it stands children before the parent that waits on nothing.
  for (const pocket of [...view.openBoards].reverse()) {
    if (!revealedNodes.has(pocket.id)) {
      revealedNodes.add(pocket.id);
      beats.push({ nodeIds: [pocket.id], edgeIds: [], kind: "board" });
      // An empty child was the member its parent still waited on.
      settleFrames(pocket.parentPocketId);
    }
  }

  // Ink last, in reading order. Every frame already stands by now.
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
    revealedNodes.add(inkId);
    beats.push({ nodeIds: [inkId], edgeIds: [], kind: "ink" });
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
  /**
   * What the camera should be watching, as an ordered lookahead: the
   * current beat's action first, then the next beats'. The follower in
   * FactoryFlow plans a SHOT from these - a vantage covering as much of
   * the upcoming action as fits without dropping to glance zoom - and then
   * HOLDS it while beats land inside the view, so ten things happening in
   * one vicinity get one steady shot, not ten micro-moves. The final beat
   * hands over one group holding everything for the pull-back ending.
   */
  focusGroups: ReadonlyArray<readonly string[]>;
  /**
   * The last beat's pull-back over the whole board. Until it, the follow
   * camera holds a zoom floor above the glance threshold - the cards must
   * never drop to their zoomed-out faces mid-show.
   */
  finale: boolean;
  /** The live playback speed multiplier, for the overlay chip. */
  speed: number;
}

/** The speeds the chip offers. 1 is the scripted pace. */
export const BOARD_TIMELAPSE_SPEEDS = [0.5, 1, 2, 4] as const;

const TIMELAPSE_SPEED_KEY = "gtnh-factory-flow.dev.timelapse-speed";

let timelapseSpeed = readStoredTimelapseSpeed();

function readStoredTimelapseSpeed(): number {
  if (typeof window === "undefined") {
    return 1;
  }
  try {
    const stored = Number(window.localStorage.getItem(TIMELAPSE_SPEED_KEY));
    if (BOARD_TIMELAPSE_SPEEDS.some((speed) => speed === stored)) {
      return stored;
    }
  } catch {
    // Storage blocked: run at the scripted pace.
  }
  return 1;
}

export function getBoardTimelapseSpeed(): number {
  return timelapseSpeed;
}

/**
 * The timelapse's own sound level, 0..1, on top of the app's master volume.
 * 0.5 plays the shuffle voices as authored; the dial reaches double that,
 * and 0 skips scheduling entirely.
 */
const TIMELAPSE_VOLUME_KEY = "gtnh-factory-flow.dev.timelapse-volume";
const DEFAULT_TIMELAPSE_VOLUME = 0.5;

let timelapseVolume = readStoredTimelapseVolume();

function readStoredTimelapseVolume(): number {
  if (typeof window === "undefined") {
    return DEFAULT_TIMELAPSE_VOLUME;
  }
  try {
    const raw = window.localStorage.getItem(TIMELAPSE_VOLUME_KEY);
    if (raw !== null) {
      const value = Number(raw);
      if (Number.isFinite(value)) {
        return Math.min(1, Math.max(0, value));
      }
    }
  } catch {
    // Storage blocked: author's level.
  }
  return DEFAULT_TIMELAPSE_VOLUME;
}

export function getBoardTimelapseVolume(): number {
  return timelapseVolume;
}

export function setBoardTimelapseVolume(volume: number): void {
  timelapseVolume = Math.min(1, Math.max(0, volume));
  try {
    window.localStorage.setItem(TIMELAPSE_VOLUME_KEY, String(timelapseVolume));
  } catch {
    // Session-only volume is fine.
  }
}

function playTimelapseSound(kind: Parameters<typeof playBoardSound>[0]): void {
  if (timelapseVolume <= 0) {
    return;
  }
  playBoardSound(kind, { gain: timelapseVolume * 2 });
}

/** Takes effect from the next beat; mid-run changes are the point. */
export function setBoardTimelapseSpeed(speed: number): void {
  if (!BOARD_TIMELAPSE_SPEEDS.some((allowed) => allowed === speed)) {
    return;
  }
  timelapseSpeed = speed;
  try {
    window.localStorage.setItem(TIMELAPSE_SPEED_KEY, String(speed));
  } catch {
    // Session-only speed is fine.
  }
  if (activeSnapshot) {
    activeSnapshot = { ...activeSnapshot, speed };
    emit();
  }
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
/** How far ahead the camera may read the script when planning a shot. Deep
 * enough to cover a machine with all its attendants and wires plus the
 * next machine or two when they are close; the zoom floor is what stops a
 * shot from swallowing a distant cluster. */
const TIMELAPSE_SHOT_LOOKAHEAD = 14;

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
  // Cards and frames pace at a full beat, wires at their half-step - and
  // with every wire its own beat now they are the bulk of the show, so the
  // target length is spread over the WEIGHTED count, not the card count.
  const paceUnits = script.beats.reduce(
    (sum, beat) =>
      sum + (beat.kind === "wire" ? 0.55 : beat.kind === "ink" ? 0 : 1),
    0,
  );
  const beatMs = Math.min(
    TIMELAPSE_MAX_BEAT_MS,
    Math.max(TIMELAPSE_MIN_BEAT_MS, Math.round(TIMELAPSE_TARGET_MS / Math.max(1, paceUnits))),
  );
  const delayBefore = (beat: TimelapseBeat) =>
    beat.kind === "wire"
      ? beatMs * 0.55
      : beat.kind === "ink"
        ? TIMELAPSE_INK_BEAT_MS
        : beatMs;

  // The camera's reading of the script from a given beat: the action of
  // that beat and the next few, in order, empties skipped.
  const focusGroupsAt = (startIndex: number): string[][] => {
    const groups: string[][] = [];
    for (
      let i = startIndex;
      i < script.beats.length && groups.length <= TIMELAPSE_SHOT_LOOKAHEAD;
      i += 1
    ) {
      const focus = script.beats[i].focusNodeIds ?? script.beats[i].nodeIds;
      if (focus.length > 0) {
        groups.push([...focus]);
      }
    }
    return groups;
  };

  activeSnapshot = {
    revealedNodeIds: new Set(),
    revealedEdgeIds: new Set(),
    // The approach shot: planned over the opening beats while the board is
    // still empty, so the camera is already standing where the first
    // machines will land.
    focusGroups: focusGroupsAt(0),
    finale: false,
    speed: timelapseSpeed,
  };
  emit();

  let index = 0;
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
    const isLastBeat = index === script.beats.length - 1;
    activeSnapshot = {
      revealedNodeIds,
      revealedEdgeIds,
      // This beat's action first, the upcoming beats' behind it; the last
      // beat hands over everything for the pull-back ending.
      focusGroups: isLastBeat ? [[...revealedNodeIds]] : focusGroupsAt(index),
      finale: isLastBeat,
      speed: timelapseSpeed,
    };
    emit();

    // The shuffle family: brushes, not thumps. A storage's combined beat
    // slides the drawer in and whisks its wire a half-beat later.
    switch (beat.kind) {
      case "card":
        playTimelapseSound("shuffle");
        if (beat.edgeIds.length > 0) {
          soundTimer = setTimeout(
            () => {
              soundTimer = undefined;
              if (token === playToken) {
                playTimelapseSound("shuffleWire");
              }
            },
            Math.round(beatMs / 2 / timelapseSpeed),
          );
        }
        break;
      case "wire":
        playTimelapseSound("shuffleWire");
        break;
      case "board":
        playTimelapseSound("shuffleBoard");
        break;
      case "ink":
        playTimelapseSound("shuffleWire");
        break;
    }

    index += 1;
    if (index >= script.beats.length) {
      stepTimer = setTimeout(() => {
        stepTimer = undefined;
        if (token === playToken) {
          playTimelapseSound("sweep");
          stopBoardTimelapse();
        }
      }, TIMELAPSE_FINISH_HOLD_MS / timelapseSpeed);
      return;
    }
    // Speed and the NEXT beat's kind decide the gap, read at scheduling
    // time, so a chip press mid-run changes the pace from the very next
    // beat and a wire follows its card quickly.
    stepTimer = setTimeout(step, delayBefore(script.beats[index]) / timelapseSpeed);
  };

  // One quiet moment on the emptied board before the first card lands.
  stepTimer = setTimeout(step, 420 / timelapseSpeed);
  return true;
}
