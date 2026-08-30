"use client";

import { useMemo } from "react";
import { Plus, Zap } from "lucide-react";
import { MotionNumberText } from "./flow/board-motion";
import { formatCompact, formatCompactStable } from "@/lib/model/resources";
import { isPowerRecipe } from "@/lib/power/power-recipe";
import { useFactoryStore } from "@/store/factory-store";

/**
 * POWER MADE: the generation summary beside the machine list's draw figures.
 * Phase 1 doctrine (docs/power-sector.md): the two totals sit side by side
 * and nothing couples them - the player compares, the planner does not.
 * Nameplate figures, like every card on the board.
 */
export function PowerMadePanel() {
  const nodes = useFactoryStore((state) => state.project.nodes);
  const recipes = useFactoryStore((state) => state.project.recipes);
  const openPowerMenu = useFactoryStore((state) => state.openPowerMenu);

  const { lines, totalEuT } = useMemo(() => {
    const recipeById = new Map(recipes.map((recipe) => [recipe.id, recipe]));
    const byLabel = new Map<string, { label: string; count: number; euT: number }>();
    let total = 0;
    for (const node of nodes) {
      if (!node.enabled) {
        continue;
      }
      const recipe = recipeById.get(node.recipeId);
      if (!recipe || !isPowerRecipe(recipe)) {
        continue;
      }
      const count = node.machineCount * Math.max(1, node.parallel);
      const euT = recipe.power.euPerTick * count;
      total += euT;
      const entry = byLabel.get(recipe.name) ?? { label: recipe.name, count: 0, euT: 0 };
      entry.count += count;
      entry.euT += euT;
      byLabel.set(recipe.name, entry);
    }
    return {
      lines: [...byLabel.values()].sort((a, b) => b.euT - a.euT),
      totalEuT: total,
    };
  }, [nodes, recipes]);

  return (
    <div className="flex min-h-0 max-h-[30%] shrink-0 flex-col border-t-2 border-[var(--mc-47)]">
      <div className="flex w-full items-center gap-2 border-b border-[var(--mc-47)] bg-[var(--mc-71)] px-2 py-1">
        <span className="text-sm font-bold uppercase tracking-wider">Power made</span>
        <span className="ml-auto flex shrink-0 items-center gap-2">
          {lines.length > 0 ? (
            <span className="shrink-0 whitespace-nowrap text-[13px] font-bold tabular-nums text-emerald-300">
              <Zap className="mr-0.5 inline h-3 w-3 -translate-y-px" aria-hidden />
              <MotionNumberText
                values={[totalEuT]}
                render={(shown) =>
                  shown[0] === totalEuT
                    ? formatCompact(totalEuT)
                    : formatCompactStable(shown[0] ?? totalEuT)
                }
              />
              <span className="ml-0.5 text-[8px] font-normal text-[var(--mc-ink-muted)]">EU/t</span>
            </span>
          ) : null}
          <button
            type="button"
            title="Add a power source"
            onClick={openPowerMenu}
            className="flex h-6 cursor-pointer items-center gap-1 border border-[var(--mc-33)] bg-[var(--mc-61)] px-1.5 text-[10px] uppercase tracking-wide text-[var(--mc-ink)] hover:bg-[var(--mc-85)]"
          >
            <Plus className="h-3 w-3" aria-hidden />
            Add
          </button>
        </span>
      </div>
      {lines.length > 0 ? (
        <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden pb-1">
          {lines.map((line) => (
            <div
              key={line.label}
              className="flex items-center gap-2 px-2 py-0.5 text-[11px] tabular-nums"
            >
              <span className="shrink-0 text-[var(--mc-ink-muted)]">{line.count}x</span>
              <span className="min-w-0 flex-1 truncate">{line.label}</span>
              <span
                className={
                  line.euT >= 0 ? "shrink-0 text-emerald-300" : "shrink-0 text-red-300"
                }
              >
                {line.euT >= 0 ? "+" : ""}
                {formatCompact(line.euT)}
                <span className="ml-0.5 text-[8px] text-[var(--mc-ink-muted)]">EU/t</span>
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
