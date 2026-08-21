import type { BoardRules, FactoryProject } from "./types";

/** Both rules, always answered - the closed plan is `false, false`. */
export type ResolvedBoardRules = Required<BoardRules>;

export const CLOSED_BOARD: ResolvedBoardRules = { freeInputs: false, freeOutputs: false };

/**
 * What this plan's rules are, legacy included.
 *
 * Sketch mode (`assumeBoundaries`) was the pair of them at once, so a plan
 * saved under it reads as both on. `normalizeLoadedProject` rewrites the old
 * flag on the way in; this still honours it, because fixtures and tests build
 * projects by hand and never go through that funnel.
 */
export function getBoardRules(project: {
  boardRules?: BoardRules;
  assumeBoundaries?: boolean;
}): ResolvedBoardRules {
  const rules = project.boardRules;
  if (!rules) {
    const legacy = project.assumeBoundaries === true;
    return { freeInputs: legacy, freeOutputs: legacy };
  }
  return { freeInputs: rules.freeInputs === true, freeOutputs: rules.freeOutputs === true };
}

/** True when the plan is closed: it must wire its own boundary. */
export function isClosedBoard(project: FactoryProject): boolean {
  const rules = getBoardRules(project);
  return !rules.freeInputs && !rules.freeOutputs;
}

/** Stored form: nothing set at all when both rules are off. */
export function packBoardRules(rules: ResolvedBoardRules): BoardRules | undefined {
  if (!rules.freeInputs && !rules.freeOutputs) {
    return undefined;
  }
  return {
    freeInputs: rules.freeInputs || undefined,
    freeOutputs: rules.freeOutputs || undefined,
  };
}
