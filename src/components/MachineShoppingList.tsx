"use client";

import { useMemo } from "react";
import { GT_TIER_COLORS } from "./flow/tier-colors";
import { useMachineHandlerIcons, type MachineHandlerIcon } from "./flow/machine-icons";
import { ResourceIcon } from "./nei/ResourceIcon";
import { getSelectedMachineHandler } from "@/lib/model/recipe-rules";
import { isCustomRateRecipe } from "@/lib/model/custom-rate";
import { formatCompact } from "@/lib/model/resources";
import { getVoltageTierIndex } from "@/lib/model/tiers";
import type { MachineTier } from "@/lib/model/types";
import {
  getNodePowerReport,
  hasPowerReport,
  type NodePowerState,
} from "@/lib/solver/power-report";
import { useFactoryStore } from "@/store/factory-store";

type VoltageTier = Exclude<MachineTier, "DEMO">;

interface ShoppingRow {
  nodeId: string;
  label: string;
  icon?: MachineHandlerIcon;
  /** The count dialed on this card: machineCount x parallel. */
  count: number;
  hatches: number;
  isMultiblock: boolean;
  tier?: VoltageTier;
  /** The card's whole draw, EU/t - count included, like the card's own cell. */
  euT?: number;
  state: NodePowerState;
}

interface ShoppingBand {
  tier?: VoltageTier;
  rows: ShoppingRow[];
}

/**
 * The build list, a permanent fixture on the panel's floor: one line per CARD
 * on the board - never summed across cards, because two separate reactors are
 * two things to build in two places. Each line speaks the board's own visual
 * language - the machine's art, the count, the name, then the card's fused
 * hatch-and-tier chip and its whole EU/t draw, all on one line. The tiers
 * section the list with nothing but a faint wash of their own colour.
 */
export function MachineShoppingList() {
  const project = useFactoryStore((state) => state.project);
  const focusBoardNode = useFactoryStore((state) => state.focusBoardNode);
  const machineIcons = useMachineHandlerIcons();

  const bands = useMemo<ShoppingBand[]>(() => {
    const recipesById = new Map(project.recipes.map((recipe) => [recipe.id, recipe]));
    const rows: Array<ShoppingRow & { tierIndex: number }> = [];

    for (const node of project.nodes) {
      if (node.enabled === false) {
        continue;
      }
      const recipe = recipesById.get(node.recipeId);
      if (!recipe || isCustomRateRecipe(recipe)) {
        continue;
      }
      const handler = getSelectedMachineHandler(recipe, node);
      const report = hasPowerReport(recipe) ? getNodePowerReport(recipe, node) : undefined;
      const count = node.machineCount * Math.max(1, node.parallel);
      rows.push({
        nodeId: node.id,
        label: handler.label,
        icon: machineIcons.get(handler.id),
        count,
        hatches: report?.hatches ?? 1,
        isMultiblock: report?.isMultiblock ?? false,
        tier: report?.tier,
        euT: report ? report.drawEuT * count : undefined,
        state: report?.state ?? "ok",
        tierIndex: report ? getVoltageTierIndex(report.tier) : Number.POSITIVE_INFINITY,
      });
    }

    rows.sort(
      (a, b) =>
        a.tierIndex - b.tierIndex || (b.euT ?? 0) - (a.euT ?? 0) || a.label.localeCompare(b.label),
    );

    const byTier = new Map<number, ShoppingBand>();
    for (const row of rows) {
      const band = byTier.get(row.tierIndex) ?? { tier: row.tier, rows: [] };
      band.rows.push(row);
      byTier.set(row.tierIndex, band);
    }
    return [...byTier.values()];
  }, [machineIcons, project]);

  const totalMachines = bands.reduce(
    (sum, band) => sum + band.rows.reduce((rows, row) => rows + row.count, 0),
    0,
  );
  const totalEuT = bands.reduce(
    (sum, band) => sum + band.rows.reduce((rows, row) => rows + (row.euT ?? 0), 0),
    0,
  );
  if (totalMachines === 0) {
    return null;
  }

  return (
    <div className="flex min-h-0 shrink-0 basis-[40%] flex-col border-t-2 border-[var(--mc-47)]">
      <div className="flex w-full items-center gap-2 border-b border-[var(--mc-47)] bg-[var(--mc-71)] px-2 py-1">
        <span className="text-sm font-bold uppercase tracking-wider">Machines</span>
        <span className="rounded bg-[var(--mc-56)] px-1.5 py-0.5 text-xs font-bold tabular-nums">
          {totalMachines}
        </span>
        {totalEuT > 0 ? (
          <span className="ml-auto text-[13px] font-bold tabular-nums">
            {formatCompact(totalEuT)}
            <span className="ml-0.5 text-[8px] font-normal text-[var(--mc-ink-muted)]">EU/t</span>
          </span>
        ) : null}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto pb-1">
        {bands.map((band) => (
          <div
            key={band.tier ?? "no-power"}
            // The tier band: no header, just a faint wash of the tier's own
            // colour behind its rows.
            style={
              band.tier
                ? { backgroundColor: `${GT_TIER_COLORS[band.tier].background}14` }
                : undefined
            }
            className="py-0.5"
          >
            {band.rows.map((row) => (
              <ShoppingRowLine
                key={row.nodeId}
                row={row}
                onFocus={() => focusBoardNode(row.nodeId)}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function ShoppingRowLine({ row, onFocus }: { row: ShoppingRow; onFocus: () => void }) {
  const stalled = row.state !== "ok";
  const tierColor = row.tier ? GT_TIER_COLORS[row.tier] : undefined;

  return (
    <button
      type="button"
      onClick={onFocus}
      title={`${row.count}x ${row.label}. Click to jump to this card.`}
      className="flex w-full items-center gap-1.5 px-2 py-0.5 text-left hover:bg-[var(--mc-71)]"
    >
      <span className="flex h-[24px] w-[24px] shrink-0 items-center justify-center overflow-hidden">
        {row.icon ? (
          <ResourceIcon
            resource={{ ...row.icon, amount: 1, consumed: true }}
            size="sm"
            showAmount={false}
            bare
            tooltip={false}
            className="!h-full !w-full"
          />
        ) : null}
      </span>
      <span className="shrink-0 text-[14px] font-bold tabular-nums">{row.count}×</span>
      <span className="min-w-0 flex-1 truncate whitespace-nowrap text-[14px] leading-6">
        {row.label}
      </span>
      {tierColor ? (
        /* The card's own chip, verbatim: hatch count fused left of the tier,
           one paint job, so the panel and the board read as one. */
        <span className="flex shrink-0">
          {row.isMultiblock ? (
            <span
              className="h-5 border-2 border-r-0 px-1 text-[11px] font-bold leading-4"
              style={{
                backgroundColor: tierColor.background,
                borderColor: tierColor.border,
                color: tierColor.text,
                textShadow: `1px 1px 0 ${tierColor.shadow}`,
              }}
            >
              {row.hatches}×
            </span>
          ) : null}
          <span
            className="h-5 border-2 px-1.5 text-[11px] font-bold leading-4"
            style={{
              backgroundColor: tierColor.background,
              borderColor: tierColor.border,
              color: tierColor.text,
              textShadow: `1px 1px 0 ${tierColor.shadow}`,
            }}
          >
            {row.tier}
          </span>
        </span>
      ) : null}
      <span
        className={[
          "shrink-0 whitespace-nowrap text-right text-[13px] tabular-nums",
          stalled ? "font-bold text-red-400" : "",
        ].join(" ")}
      >
        {stalled ? (
          row.state === "under-powered" ? (
            "LOW!"
          ) : (
            "TIER!"
          )
        ) : row.euT !== undefined ? (
          <>
            {formatCompact(row.euT)}
            {/* Same suffix treatment as the card's power cell: small, grey,
                hugging the number. */}
            <span className="ml-0.5 text-[8px] text-[var(--mc-ink-muted)]">EU/t</span>
          </>
        ) : (
          ""
        )}
      </span>
    </button>
  );
}
