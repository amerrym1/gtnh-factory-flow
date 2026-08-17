import { applyMachineHandlerToRecipe } from "@/lib/model/recipe-rules";
import {
  getRecipeMinimumVoltageTier,
  getVoltageTierForEuT,
  getVoltageTierIndex,
  getVoltageTierMaxEuT,
  resolveVoltageTier,
} from "@/lib/model/tiers";
import type { FactoryNode, MachineTier, Recipe } from "@/lib/model/types";
import { getHeatDiscountMultiplier } from "./heat";
import {
  getMachineEutMultiplier,
  getMachineParallelMultiplier,
} from "./machine-effects";
import { getOverclockedRecipeStats } from "./overclock";
import {
  getEffectiveVoltageOrdinal,
  getNodeEnergyHatches,
  getNodePowerAmps,
  getNodeRunTier,
  isMultiblockRecipe,
} from "./power";
import { getCropsNhStats, isIndustrialApiaryMachineType } from "@/lib/model/passive-production";
import { selectRuntimeCalculationVariant } from "./runtime-calculation";

type VoltageTier = Exclude<MachineTier, "DEMO">;
type PowerReportNode = Pick<
  FactoryNode,
  "overclockTier" | "coilTier" | "machineHandlerId" | "machineConfigTiers"
> &
  Partial<Pick<FactoryNode, "energyHatches">>;

/**
 * Whether the build can start at all, straight from the game's checks. There
 * is no slow mode in GT: a machine either runs what the report says or sits
 * idle, so these are the only three states.
 */
export type NodePowerState = "ok" | "under-powered" | "over-tier";

export interface NodePowerReport {
  state: NodePowerState;
  /** The tier the user picked (or the recipe's minimum by default). */
  tier: VoltageTier;
  minimumTier: VoltageTier;
  /** Hatch count on a multiblock; 1 and meaningless on a singleblock. */
  hatches: number;
  isMultiblock: boolean;
  /** Working amps: hatch amps on a multiblock, machine amperage otherwise. */
  amps: number;
  /** Total EU/t the build can drink: tier voltage x amps. */
  poolEuT: number;
  /** One parallel's modified draw, what ParallelHelper checks the pool against. */
  singleDrawEuT: number;
  /** Parallels actually running (structure capped by the pool). */
  parallels: number;
  /** The machine's draw while running: overclocked EU/t x parallels. */
  drawEuT: number;
  overclockSteps: number;
  /** drawEuT / poolEuT, for the usage figure. 0 when the pool is unbounded. */
  usage: number;
}

/**
 * Recipes whose card has no meaningful power section: nothing electric moves
 * through crops, bees, or zero-EU manual work.
 */
export function hasPowerReport(recipe: Recipe): boolean {
  if (!(Math.abs(recipe.eut) > 0) || recipe.durationTicks <= 0) {
    return false;
  }
  if (getCropsNhStats(recipe) || isIndustrialApiaryMachineType(recipe.machineType)) {
    return false;
  }
  return true;
}

export function getNodePowerReport(recipe: Recipe, node: PowerReportNode): NodePowerReport {
  const effectiveRecipe = recipe.machineType ? applyMachineHandlerToRecipe(recipe, node) : recipe;
  const minimumTier = getRecipeMinimumVoltageTier(effectiveRecipe);
  const tier = getNodeRunTier(effectiveRecipe, node);
  const isMultiblock = isMultiblockRecipe(effectiveRecipe);
  const hatches = getNodeEnergyHatches(effectiveRecipe, node);
  const amps = getNodePowerAmps(effectiveRecipe, node);
  const poolEuT = getVoltageTierMaxEuT(tier) * amps;

  const rawEuT = Math.abs(effectiveRecipe.eut);
  const eutMultiplier = getMachineEutMultiplier(effectiveRecipe, node);
  const heatDiscount = getHeatDiscountMultiplier(
    effectiveRecipe,
    node,
    tier,
    getEffectiveVoltageOrdinal(effectiveRecipe, node, tier),
  );
  const singleDrawEuT = Math.ceil(rawEuT * eutMultiplier * heatDiscount);

  const stats = getOverclockedRecipeStats(recipe, node);
  const runtimeVariant = selectRuntimeCalculationVariant(effectiveRecipe, node);
  const parallels = runtimeVariant?.parallel ?? getMachineParallelMultiplier(effectiveRecipe, node);
  const drawEuT = Math.abs(stats.eut) * parallels;

  return {
    state: getPowerState(effectiveRecipe, tier, minimumTier, isMultiblock, poolEuT, singleDrawEuT),
    tier,
    minimumTier,
    hatches,
    isMultiblock,
    amps,
    poolEuT,
    singleDrawEuT,
    parallels,
    drawEuT,
    overclockSteps: stats.overclockSteps,
    usage: Number.isFinite(poolEuT) && poolEuT > 0 ? drawEuT / poolEuT : 0,
  };
}

function getPowerState(
  effectiveRecipe: Recipe,
  tier: VoltageTier,
  minimumTier: VoltageTier,
  isMultiblock: boolean,
  poolEuT: number,
  singleDrawEuT: number,
): NodePowerState {
  const rawEuT = Math.abs(effectiveRecipe.eut);
  if (!(rawEuT > 0) || !Number.isFinite(poolEuT)) {
    return "ok";
  }

  // A structural minimum above the recipe's own power draw (an assembly line
  // gated to a tier, a casing requirement) cannot be bought with amps.
  const powerTier = getVoltageTierForEuT(rawEuT);
  const declaredMinimum = resolveVoltageTier(effectiveRecipe.minimumTier, powerTier);
  if (
    getVoltageTierIndex(declaredMinimum) > getVoltageTierIndex(powerTier) &&
    getVoltageTierIndex(tier) < getVoltageTierIndex(declaredMinimum)
  ) {
    return "over-tier";
  }

  if (isMultiblock) {
    // `OverclockCalculator.getAllowedTierSkip`: a recipe more than one tier
    // above the hatch voltage never runs, however many amps are stacked.
    if (rawEuT > getVoltageTierMaxEuT(tier) * 4) {
      return "over-tier";
    }
    // `ParallelHelper.determineParallel`: the pool must carry one whole
    // parallel of the modified draw or the machine reports insufficient power.
    if (singleDrawEuT > poolEuT) {
      return "under-powered";
    }
    return "ok";
  }

  // A singleblock has no hatches to add: a recipe over its machine's power
  // simply belongs to a higher-tier machine.
  if (singleDrawEuT > poolEuT) {
    return "over-tier";
  }
  return "ok";
}

/** True when the report says the machine cannot start at all. */
export function isPowerStalled(report: NodePowerReport): boolean {
  return report.state !== "ok";
}

/** One-line reason for a stalled build, used by node warnings. */
export function describePowerStall(report: NodePowerReport): string | undefined {
  if (report.state === "under-powered") {
    return (
      `Underpowered: the recipe draws ${report.singleDrawEuT} EU/t but ` +
      `${report.hatches}x ${report.tier} ${report.hatches === 1 ? "hatch supplies" : "hatches supply"} ` +
      `${report.poolEuT} EU/t. Add hatches or raise the tier.`
    );
  }
  if (report.state === "over-tier") {
    return (
      `Won't run at ${report.tier}: this recipe needs at least ` +
      `${report.minimumTier}${report.isMultiblock ? " hatches (amps cannot skip more than one tier)" : ""}.`
    );
  }
  return undefined;
}
