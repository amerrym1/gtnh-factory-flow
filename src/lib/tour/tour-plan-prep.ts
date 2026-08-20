import type { FactoryProject } from "@/lib/model/types";
import { closeBoundaries } from "@/lib/solver/close-boundaries";
import { getStorageRoles } from "@/lib/model/storage-role";

/**
 * The plan a lesson is allowed to point at, whatever state it was posted in.
 *
 * Two repairs, both because the lesson reads the board OUT LOUD and every
 * claim has to survive contact with the live solve:
 *
 * - `closeBoundaries`: plans worth teaching from were authored before a plan
 *   had to declare its own edges, so raw ingredients arrive from nowhere and
 *   the product goes nowhere - a board of NO WIRES at 0%, which teaches
 *   nothing.
 * - strict buffers are unset. The posted titanium line carries a strict flag
 *   left over from the old engine's drawer lab, and the lesson teaches the
 *   PLAIN buffer: flow passes through, extra piles up. On this line the taker
 *   is always the hungrier end, so a strict flag changes no rate at all -
 *   it only swaps the feeder's word for a story about a jam the wires
 *   visibly do not have.
 */
export function prepareTourProject(project: FactoryProject): FactoryProject {
  const closed = closeBoundaries(project);
  return {
    ...closed,
    storages: (closed.storages ?? []).map(({ bufferMode: _unset, ...storage }) => storage),
  };
}

/**
 * The drawer lab's one experiment: every Product drawer flipped to Byproduct.
 *
 * Under the equation books this changes NO speed anywhere - a fed machine
 * with somewhere to put its output keeps running, so the whole board holds
 * its numbers and only the bookkeeping moves. That stillness IS the lesson,
 * and `tour-board-alive.test.ts` pins it.
 */
export function quietStage(project: FactoryProject): FactoryProject {
  const roles = getStorageRoles(project);
  return {
    ...project,
    storages: (project.storages ?? []).map((storage) =>
      roles.get(storage.id) === "product"
        ? { ...storage, drainMode: "byproduct" as const }
        : storage,
    ),
  };
}
