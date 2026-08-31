/**
 * The bridge from a power source to the rest of the app: each power card
 * OWNS a synthesized one-second recipe in project.recipes (the custom-rate
 * precedent), so ports, wires, the solver, boards and import/export all
 * treat it as an ordinary machine. Settings live on the node
 * (machineConfigTiers); changing one rewrites the recipe through
 * buildPowerRecipe, and normalizeLoadedProject resynthesizes on load so
 * stored plans pick up corrected math.
 */
import type { FactoryNode, Recipe, RecipeInput, RecipeOutput } from "@/lib/model/types";
import { resolvePowerResource } from "./planner-data";
import { getPowerSource } from "./registry";
import { buildPowerSettingsReader, type PowerFlowLine, type PowerModel } from "./types";
import { formatAmount } from "./sources/helpers";

export const POWER_RECIPE_CATEGORY = "power-source";

export interface RecipePowerInfo {
  sourceId: string;
  /** Net EU/t of one machine at the baked settings; negative = parasitic. */
  euPerTick: number;
  stats: Array<{ label: string; value: string }>;
  warnings?: string[];
}

export function isPowerRecipe(
  recipe: Pick<Recipe, "power" | "category"> | undefined,
): recipe is Recipe & { power: RecipePowerInfo } {
  return Boolean(recipe?.power);
}

export function isPowerNodeId(
  project: {
    nodes: Array<Pick<FactoryNode, "id" | "recipeId">>;
    recipes: Array<Pick<Recipe, "id" | "power" | "category">>;
  },
  nodeId: string | null | undefined,
): boolean {
  if (!nodeId) {
    return false;
  }
  const node = project.nodes.find((entry) => entry.id === nodeId);
  return Boolean(node && isPowerRecipe(project.recipes.find((entry) => entry.id === node.recipeId)));
}

function flowToSlot(flow: PowerFlowLine): (RecipeInput & RecipeOutput) | undefined {
  const resource = resolvePowerResource(flow.name);
  if (!resource || !(flow.perSecond > 0)) {
    return undefined;
  }
  return {
    kind: resource.kind,
    id: resource.id,
    amount: flow.perSecond,
    displayName: resource.displayName,
    iconPath: resource.iconPath,
    dominantColor: resource.dominantColor,
  };
}

/** The flows the resource map cannot wire, shown as stat lines instead. */
function unresolvedFlowStats(model: PowerModel): Array<{ label: string; value: string }> {
  const lines: Array<{ label: string; value: string }> = [];
  for (const [flows, direction] of [
    [model.inputs, "in"],
    [model.outputs, "out"],
  ] as const) {
    for (const flow of flows) {
      if (!resolvePowerResource(flow.name) && flow.perSecond > 0) {
        lines.push({
          label: flow.name,
          value: `${formatAmount(flow.perSecond)}${flow.unit === "L" ? " L" : ""}/s ${direction}`,
        });
      }
    }
  }
  return lines;
}

/**
 * The recipe for one power card at the given settings. Amount per craft is
 * amount per second: the recipe runs one craft a second, like custom rate
 * cards, so the solver needs no special case.
 */
export function buildPowerRecipe(
  sourceId: string,
  settings: Record<string, string> | undefined,
  recipeId: string,
): Recipe | undefined {
  const source = getPowerSource(sourceId);
  if (!source) {
    return undefined;
  }
  const model = source.compute(buildPowerSettingsReader(source, settings));
  const inputs = model.inputs.map(flowToSlot).filter(Boolean) as RecipeInput[];
  const outputs = model.outputs.map(flowToSlot).filter(Boolean) as RecipeOutput[];

  return {
    id: recipeId,
    name: source.name,
    kind: "custom",
    category: POWER_RECIPE_CATEGORY,
    machineType: source.name,
    minimumTier: "NONE",
    durationTicks: 20,
    eut: 0,
    inputs,
    outputs,
    notes: source.blurb,
    source: { recipeMap: "power-source" },
    power: {
      sourceId,
      euPerTick: model.euPerTick,
      stats: [...model.stats, ...unresolvedFlowStats(model)],
      warnings: model.warnings,
    },
  };
}

/**
 * Every power card's recipe rebuilt from its node's settings. Runs in the
 * load funnel so old plans pick up corrected math and resource fixes; a
 * recipe whose source id is unknown (a newer plan on an older build) is
 * left exactly as saved.
 */
export function resynthesizePowerRecipes<
  Project extends { nodes: FactoryNode[]; recipes: Recipe[] },
>(project: Project): Project {
  let changed = false;
  const settingsByRecipeId = new Map<string, Record<string, string> | undefined>();
  const powerRecipeIds = new Set<string>();
  for (const node of project.nodes) {
    settingsByRecipeId.set(node.recipeId, node.machineConfigTiers);
  }
  const recipes = project.recipes.map((recipe) => {
    if (!isPowerRecipe(recipe)) {
      return recipe;
    }
    powerRecipeIds.add(recipe.id);
    const rebuilt = buildPowerRecipe(
      recipe.power.sourceId,
      settingsByRecipeId.get(recipe.id),
      recipe.id,
    );
    if (!rebuilt) {
      return recipe;
    }
    changed = true;
    return rebuilt;
  });
  // Input overrides stamped onto a power node (by the connect gesture, before
  // it learned to skip power cards) repaint the rebuilt slots forever - a
  // card wired to benzene once stayed benzene through every fuel switch.
  // Power slots are exact, so a power node never legitimately carries one.
  const nodes = project.nodes.map((node) => {
    if (!powerRecipeIds.has(node.recipeId) || node.recipeInputOverrides === undefined) {
      return node;
    }
    changed = true;
    return { ...node, recipeInputOverrides: undefined };
  });
  return changed ? { ...project, recipes, nodes } : project;
}
