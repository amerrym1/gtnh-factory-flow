import type { FactoryAnnotation, FactoryNode, FactoryPocket, FactoryStorage } from "./types";
import { BOARD_WINDOW_DEFAULT_SIZE, BOARD_WINDOW_TITLE_HEIGHT } from "@/lib/board-grid";

/**
 * The board-window view of the pocket tree.
 *
 * A pocket has two states: collapsed (the classic card) and OPEN (`expanded`),
 * a window frame whose members render inside it on the parent board. The view
 * therefore no longer shows exactly one level — it shows the active level plus
 * the contents of every open board whose whole chain of ancestors down to the
 * active level is open too. Everything here is pure derivation from the
 * project; nothing is stored beyond the `expanded` flag and the frame size.
 *
 * Coordinate spaces: an item's stored position is relative to its OWNER's
 * frame origin (the window's top-left corner), and an item owned by the level
 * being viewed is in plain flow space. That is exactly React Flow's parent/
 * child contract, which is what lets a dragged frame carry its members.
 */

/** The slice of a project the view derives from. */
export interface BoardLevelInput {
  nodes: FactoryNode[];
  storages?: FactoryStorage[];
  annotations?: FactoryAnnotation[];
  pockets?: FactoryPocket[];
}

export interface BoardLevelView {
  /**
   * Whether a level's CONTENTS are in view: the active level itself, or an
   * open board whose ancestors up to the active level are all open.
   */
  isLevelShown: (levelId: string | undefined) => boolean;
  /**
   * What stands for an item in this view: the item itself when its level is
   * shown, the outermost collapsed ancestor card otherwise, undefined when
   * nothing in this view shows it (the rest of the plan while dived in).
   */
  representativeOf: (itemId: string) => string | undefined;
  /** Pockets drawn as collapsed cards in this view. */
  pocketCards: FactoryPocket[];
  /** Pockets standing open as window frames, parents always before children. */
  openBoards: FactoryPocket[];
}

export function computeBoardLevelView(
  input: BoardLevelInput,
  activePocketId: string | undefined,
): BoardLevelView {
  const pockets = input.pockets ?? [];
  const pocketById = new Map(pockets.map((pocket) => [pocket.id, pocket]));

  const shownMemo = new Map<string, boolean>();
  const isLevelShown = (levelId: string | undefined): boolean => {
    if (levelId === activePocketId) {
      return true;
    }
    if (levelId === undefined) {
      return false;
    }
    const cached = shownMemo.get(levelId);
    if (cached !== undefined) {
      return cached;
    }
    // Seed false first: a cyclic parent chain (repaired on load, but never
    // trusted here) terminates instead of recursing forever.
    shownMemo.set(levelId, false);
    const pocket = pocketById.get(levelId);
    const shown = Boolean(pocket?.expanded && isLevelShown(pocket.parentPocketId));
    shownMemo.set(levelId, shown);
    return shown;
  };

  const ownerById = new Map<string, string | undefined>();
  for (const node of input.nodes) {
    ownerById.set(node.id, node.pocketId);
  }
  for (const storage of input.storages ?? []) {
    ownerById.set(storage.id, storage.pocketId);
  }
  for (const annotation of input.annotations ?? []) {
    ownerById.set(annotation.id, annotation.pocketId);
  }

  const representativeOf = (itemId: string): string | undefined => {
    let level = ownerById.get(itemId);
    if (isLevelShown(level)) {
      return itemId;
    }
    // Climb to the outermost collapsed ancestor whose own card is in view.
    const seen = new Set<string>();
    while (level !== undefined && !seen.has(level)) {
      seen.add(level);
      const pocket = pocketById.get(level);
      if (!pocket) {
        return undefined;
      }
      if (isLevelShown(pocket.parentPocketId)) {
        // This ancestor sits in view; were it open its level would have been
        // shown above, so it is a collapsed card standing in for the item.
        return pocket.id;
      }
      level = pocket.parentPocketId;
    }
    return undefined;
  };

  const pocketCards = pockets.filter(
    (pocket) => !isLevelShown(pocket.id) && isLevelShown(pocket.parentPocketId),
  );
  // Parents before children — React Flow requires a parent node to appear
  // before every node that names it in `parentId`.
  const openBoards = pockets
    .filter((pocket) => isLevelShown(pocket.id) && pocket.id !== activePocketId)
    .sort((left, right) => boardDepth(pocketById, left) - boardDepth(pocketById, right));

  return { isLevelShown, representativeOf, pocketCards, openBoards };
}

function boardDepth(pocketById: Map<string, FactoryPocket>, pocket: FactoryPocket): number {
  let depth = 0;
  let parentId = pocket.parentPocketId;
  const seen = new Set<string>([pocket.id]);
  while (parentId !== undefined && !seen.has(parentId)) {
    seen.add(parentId);
    depth += 1;
    parentId = pocketById.get(parentId)?.parentPocketId;
  }
  return depth;
}

/** An open board's frame in flow space (the active level's coordinates). */
export interface OpenBoardRect {
  id: string;
  /** Nesting depth below the active level; deeper wins a containment tie. */
  depth: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export function boardWindowSize(pocket: FactoryPocket): { width: number; height: number } {
  return pocket.size ?? BOARD_WINDOW_DEFAULT_SIZE;
}

/**
 * Absolute frames for every open board in view. Frame positions are stored
 * relative to their parent frame, so the rects accumulate down the tree —
 * `openBoards` already comes parents-first from `computeBoardLevelView`.
 */
export function computeOpenBoardRects(
  openBoards: FactoryPocket[],
  activePocketId: string | undefined,
): OpenBoardRect[] {
  const rects = new Map<string, OpenBoardRect>();
  for (const board of openBoards) {
    const parent =
      board.parentPocketId !== undefined && board.parentPocketId !== activePocketId
        ? rects.get(board.parentPocketId)
        : undefined;
    const size = boardWindowSize(board);
    rects.set(board.id, {
      id: board.id,
      depth: (parent?.depth ?? 0) + 1,
      x: (parent?.x ?? 0) + board.position.x,
      y: (parent?.y ?? 0) + board.position.y,
      width: size.width,
      height: size.height,
    });
  }
  return [...rects.values()];
}

/**
 * Which open board a dropped point lands in: the deepest frame whose BODY
 * (everything under the title bar) contains the point, skipping excluded
 * boards (the dragged board itself and its descendants — nothing may become
 * its own ancestor). Undefined = the point lands on the active level.
 */
export function pickBoardOwnerAt(
  rects: OpenBoardRect[],
  point: { x: number; y: number },
  excludedIds?: ReadonlySet<string>,
): string | undefined {
  let winner: OpenBoardRect | undefined;
  for (const rect of rects) {
    if (excludedIds?.has(rect.id)) {
      continue;
    }
    const inBody =
      point.x >= rect.x &&
      point.x <= rect.x + rect.width &&
      point.y >= rect.y + BOARD_WINDOW_TITLE_HEIGHT &&
      point.y <= rect.y + rect.height;
    if (inBody && (!winner || rect.depth > winner.depth)) {
      winner = rect;
    }
  }
  return winner?.id;
}

/** Every pocket nested anywhere under `rootId`, transitively. */
export function collectPocketDescendantIds(pockets: FactoryPocket[], rootId: string): Set<string> {
  const childrenByParent = new Map<string | undefined, FactoryPocket[]>();
  for (const pocket of pockets) {
    const siblings = childrenByParent.get(pocket.parentPocketId);
    if (siblings) {
      siblings.push(pocket);
    } else {
      childrenByParent.set(pocket.parentPocketId, [pocket]);
    }
  }
  const descendants = new Set<string>();
  const queue = [rootId];
  while (queue.length > 0) {
    const parentId = queue.pop()!;
    for (const child of childrenByParent.get(parentId) ?? []) {
      if (!descendants.has(child.id)) {
        descendants.add(child.id);
        queue.push(child.id);
      }
    }
  }
  return descendants;
}
