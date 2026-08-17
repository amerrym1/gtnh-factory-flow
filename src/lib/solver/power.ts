import { getMachineBehaviour } from "@/lib/machines/machine-table";
import {
  getRecipeMinimumVoltageTier,
  getRunVoltageTier,
  getVoltageTierForEuT,
  getVoltageTierIndex,
  getVoltageTierMaxEuT,
  resolveVoltageTier,
} from "@/lib/model/tiers";
import type { FactoryNode, MachineTier, Recipe } from "@/lib/model/types";

type VoltageTier = Exclude<MachineTier, "DEMO">;
type PowerRecipeInput = Partial<
  Pick<Recipe, "machineType" | "machineHandlers" | "machineProfile">
>;
type PowerNodeInput = Partial<Pick<FactoryNode, "energyHatches">>;

/**
 * Whether the machine actually running this recipe is a multiblock, which is
 * what decides whether energy hatches exist at all.
 *
 * A handler exported with the recipe knows its own kind. When the recipe
 * carries no handlers, `getRecipeMachineHandlers` invents one stamped
 * `single` as a placeholder - not evidence - so the curated table answers
 * instead, whose entries are multiblocks unless marked `kind: "single"`.
 */
export function isMultiblockRecipe(recipe: PowerRecipeInput): boolean {
  if ((recipe.machineHandlers?.length ?? 0) > 0) {
    return recipe.machineProfile?.kind === "multiblock";
  }
  const behaviour = getMachineBehaviour(recipe.machineType);
  return behaviour !== undefined && behaviour.kind !== "single";
}

/**
 * The tier this node runs at. A singleblock is floored at the recipe's
 * minimum - there is no lower machine to build, and legacy plans store
 * below-minimum tiers that always meant "the minimum". A multiblock honours
 * the pick as made: hatches below the recipe's tier are a real build, and the
 * power report is what says whether it starts.
 */
export function getNodeRunTier(
  recipe: PowerRecipeInput & Pick<Recipe, "eut" | "minimumTier">,
  node: PowerNodeInput & Partial<Pick<FactoryNode, "overclockTier">>,
): VoltageTier {
  if (!isMultiblockRecipe(recipe)) {
    return getRunVoltageTier(recipe, node.overclockTier);
  }
  return resolveVoltageTier(node.overclockTier, getRecipeMinimumVoltageTier(recipe));
}

/** The node's hatch count, defaulting to one and meaningless on singleblocks. */
export function getNodeEnergyHatches(recipe: PowerRecipeInput, node: PowerNodeInput): number {
  if (!isMultiblockRecipe(recipe)) {
    return 1;
  }
  const hatches = node.energyHatches ?? 1;
  return Number.isFinite(hatches) ? Math.max(1, Math.floor(hatches)) : 1;
}

/**
 * Working amps for a hatch count, from `setProcessingLogicPower`: exactly one
 * standard hatch is clamped to 1 amp; two or more work at 2 amps each.
 */
export function getHatchAmps(hatches: number): number {
  return hatches <= 1 ? 1 : 2 * hatches;
}

/**
 * The amps the machine's power maths run on: hatch amps for a multiblock, the
 * machine's own amperage for a singleblock (1 for nearly everything, 3 for
 * the arc furnaces).
 */
export function getNodePowerAmps(recipe: PowerRecipeInput, node: PowerNodeInput): number {
  if (isMultiblockRecipe(recipe)) {
    return getHatchAmps(getNodeEnergyHatches(recipe, node));
  }
  return getMachineBehaviour(recipe.machineType)?.amperage ?? 1;
}

/** Total EU/t the build can drink: tier voltage times its working amps. */
export function getPowerPoolEuT(
  recipe: PowerRecipeInput,
  node: PowerNodeInput,
  tier: VoltageTier,
): number {
  return getVoltageTierMaxEuT(tier) * getNodePowerAmps(recipe, node);
}

/**
 * The voltage-tier ordinal the machine's own formulas see, which is NOT
 * simply the hatch tier: `GTUtility.getTier(getMaxInputVoltage())` reads the
 * SUM of hatch voltages, so two MV hatches (256 V) already count as HV for
 * "parallels per voltage tier" scaling and for the blast furnaces' 100 K per
 * tier heat bonus. One hatch leaves the ordinal at its own tier.
 */
export function getEffectiveVoltageOrdinal(
  recipe: PowerRecipeInput,
  node: PowerNodeInput,
  tier: VoltageTier,
): number {
  const hatches = getNodeEnergyHatches(recipe, node);
  const summedVoltage = getVoltageTierMaxEuT(tier) * hatches;
  if (!Number.isFinite(summedVoltage)) {
    return getVoltageTierIndex(tier);
  }
  return getVoltageTierIndex(getVoltageTierForEuT(summedVoltage));
}
