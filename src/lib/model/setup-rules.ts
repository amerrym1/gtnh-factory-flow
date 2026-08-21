import type { SetupRules } from "./types";

/** Both rules, always answered - the closed setup is `false, false`. */
export type ResolvedSetupRules = Required<SetupRules>;

/**
 * What this plan's rules are, legacy included.
 *
 * Sketch mode (`assumeBoundaries`) was the pair of them at once, so a plan
 * saved under it reads as both on. `normalizeLoadedProject` rewrites the old
 * flag on the way in; this still honours it, because fixtures and tests build
 * projects by hand and never go through that funnel.
 */
export function getSetupRules(project: {
  setupRules?: SetupRules;
  assumeBoundaries?: boolean;
}): ResolvedSetupRules {
  const rules = project.setupRules;
  if (!rules) {
    const legacy = project.assumeBoundaries === true;
    return { freeInputs: legacy, freeOutputs: legacy };
  }
  return { freeInputs: rules.freeInputs === true, freeOutputs: rules.freeOutputs === true };
}

/** Stored form: nothing set at all when both rules are off. */
export function packSetupRules(rules: ResolvedSetupRules): SetupRules | undefined {
  if (!rules.freeInputs && !rules.freeOutputs) {
    return undefined;
  }
  return {
    freeInputs: rules.freeInputs || undefined,
    freeOutputs: rules.freeOutputs || undefined,
  };
}
