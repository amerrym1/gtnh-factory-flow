"use client";

import { useMemo, useRef } from "react";
import { MotionNumberText } from "./flow/board-motion";
import { GT_TIER_COLORS } from "./flow/tier-colors";
import { useMachineHandlerIcons, type MachineHandlerIcon } from "./flow/machine-icons";
import { MinecraftTooltip } from "./nei/MinecraftTooltip";
import { ResourceIcon } from "./nei/ResourceIcon";
import { getSelectedMachineHandler } from "@/lib/model/recipe-rules";
import { isCustomRateRecipe } from "@/lib/model/custom-rate";
import { formatCompact, formatCompactStable } from "@/lib/model/resources";
import { getVoltageTierIndex } from "@/lib/model/tiers";
import type { MachineTier } from "@/lib/model/types";
import {
  getNodePowerReport,
  hasPowerReport,
  type NodePowerState,
} from "@/lib/solver/power-report";
import { useFactoryStore } from "@/store/factory-store";

type VoltageTier = Exclude<MachineTier, "DEMO">;

/**
 * One BUILD: a machine at one power configuration, summed across every card
 * that runs it. A singleblock build is its tier; a multiblock build is its
 * tier AND its hatch count, because a two-hatch reactor and a one-hatch
 * reactor are different things to construct even at the same voltage.
 */
interface BuildLine {
  key: string;
  count: number;
  hatches: number;
  isMultiblock: boolean;
  tier?: VoltageTier;
  tierIndex: number;
  euT?: number;
  state: NodePowerState;
  nodeIds: string[];
}

interface MachineGroup {
  label: string;
  icon?: MachineHandlerIcon;
  count: number;
  euT?: number;
  builds: BuildLine[];
  nodeIds: string[];
  minTierIndex: number;
}

/**
 * The build list, a permanent fixture on the panel's floor — and one list
 * that reads two ways at once. Machines group by WHAT they are: every
 * electrolyzer on the board lands on one line with the total to build, the
 * fused hatch-and-tier chip and the summed draw, whichever cards they came
 * from. Only when one machine exists in more than one BUILD (an HV reactor
 * and an MV one, a one-hatch and a two-hatch) does the machine become a bare
 * name line with one sub-line per build underneath, each washed in its own
 * tier colour and carrying its own count, chip and draw. The name line adds
 * no numbers of its own: a summed figure over different builds answers no
 * question anyone shops with.
 *
 * Clicking a line jumps to its card; clicking again walks to the NEXT card
 * of that kind, so an aggregated line still leads to every board location
 * behind it.
 */
export function MachineShoppingList() {
  const project = useFactoryStore((state) => state.project);
  const focusBoardNode = useFactoryStore((state) => state.focusBoardNode);
  const machineIcons = useMachineHandlerIcons();

  const groups = useMemo<MachineGroup[]>(() => {
    const recipesById = new Map(project.recipes.map((recipe) => [recipe.id, recipe]));
    const byMachine = new Map<
      string,
      MachineGroup & { buildsByKey: Map<string, BuildLine> }
    >();

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
      const euT = report ? report.drawEuT * count : undefined;

      const group =
        byMachine.get(handler.label) ??
        (() => {
          const created = {
            label: handler.label,
            icon: undefined as MachineHandlerIcon | undefined,
            count: 0,
            euT: undefined as number | undefined,
            builds: [],
            nodeIds: [],
            minTierIndex: Number.POSITIVE_INFINITY,
            buildsByKey: new Map<string, BuildLine>(),
          };
          byMachine.set(handler.label, created);
          return created;
        })();
      group.icon ??= machineIcons.get(handler.id);
      group.count += count;
      group.nodeIds.push(node.id);
      if (euT !== undefined) {
        group.euT = (group.euT ?? 0) + euT;
      }

      // The stacking rule: singleblocks of one tier are one build; a
      // multiblock's hatch count splits it further.
      const buildKey = report
        ? `${report.tier}|${report.isMultiblock ? report.hatches : "single"}`
        : "plain";
      const tierIndex = report ? getVoltageTierIndex(report.tier) : Number.POSITIVE_INFINITY;
      group.minTierIndex = Math.min(group.minTierIndex, tierIndex);
      const build =
        group.buildsByKey.get(buildKey) ??
        (() => {
          const created: BuildLine = {
            key: `${handler.label}|${buildKey}`,
            count: 0,
            hatches: report?.hatches ?? 1,
            isMultiblock: report?.isMultiblock ?? false,
            tier: report?.tier,
            tierIndex,
            euT: undefined,
            state: "ok",
            nodeIds: [],
          };
          group.buildsByKey.set(buildKey, created);
          group.builds.push(created);
          return created;
        })();
      build.count += count;
      build.nodeIds.push(node.id);
      if (euT !== undefined) {
        build.euT = (build.euT ?? 0) + euT;
      }
      if (report && report.state !== "ok" && build.state === "ok") {
        build.state = report.state;
      }
    }

    const list = [...byMachine.values()];
    for (const group of list) {
      group.builds.sort(
        (a, b) => a.tierIndex - b.tierIndex || (b.euT ?? 0) - (a.euT ?? 0),
      );
    }
    list.sort(
      (a, b) =>
        a.minTierIndex - b.minTierIndex ||
        (b.euT ?? 0) - (a.euT ?? 0) ||
        a.label.localeCompare(b.label),
    );
    return list;
  }, [machineIcons, project]);

  // Click-to-cycle state: which card of a line the last click landed on.
  // A ref, not state — advancing it must not re-render the list.
  const cycleRef = useRef(new Map<string, number>());
  const focusNext = (key: string, nodeIds: string[]) => {
    const next = ((cycleRef.current.get(key) ?? -1) + 1) % nodeIds.length;
    cycleRef.current.set(key, next);
    const nodeId = nodeIds[next];
    if (nodeId) {
      focusBoardNode(nodeId);
    }
  };

  const totalMachines = groups.reduce((sum, group) => sum + group.count, 0);
  const totalEuT = groups.reduce((sum, group) => sum + (group.euT ?? 0), 0);
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
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto pb-1">
        {groups.map((group) => {
          const uniform = group.builds.length === 1;
          const build = group.builds[0];
          return (
            <div key={group.label} className="py-0.5">
              <ListLine
                icon={group.icon}
                // A uniform group is one whole line: count, chip, draw,
                // warning. A mixed one is a bare NAME — its counts and
                // numbers all live on the build sub-lines below.
                count={uniform ? group.count : undefined}
                label={group.label}
                chip={uniform ? build : undefined}
                euT={uniform ? build?.euT : undefined}
                state={uniform ? (build?.state ?? "ok") : "ok"}
                wash={uniform ? build?.tier : undefined}
                explain={
                  uniform && build
                    ? explainBuild(group.label, build)
                    : [
                        `${group.label}: ${group.count} machines in ${group.builds.length} different builds`,
                        ...clickHint(group.nodeIds.length),
                      ]
                }
                onClick={() => focusNext(group.label, group.nodeIds)}
              />
              {uniform
                ? null
                : group.builds.map((buildLine, index) => (
                    <ListLine
                      key={buildLine.key}
                      indent
                      isLast={index === group.builds.length - 1}
                      count={buildLine.count}
                      chip={buildLine}
                      euT={buildLine.euT}
                      state={buildLine.state}
                      wash={buildLine.tier}
                      explain={explainBuild(group.label, buildLine)}
                      onClick={() => focusNext(buildLine.key, buildLine.nodeIds)}
                    />
                  ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function clickHint(cards: number): string[] {
  return [cards > 1 ? "Click to jump to each card in turn." : "Click to jump to its card."];
}

/**
 * The hover, in plain English: what this line actually asks you to build.
 * "3 machines, each with 2 HV energy hatches" says out loud what the fused
 * chip abbreviates, and a stalled build states its problem in words.
 */
function explainBuild(
  label: string,
  build: Pick<BuildLine, "count" | "tier" | "hatches" | "isMultiblock" | "state"> & {
    nodeIds: string[];
  },
): string[] {
  const lines: string[] = [];
  if (!build.tier) {
    lines.push(`${label}: ${build.count} ${build.count === 1 ? "machine" : "machines"}`);
  } else if (build.isMultiblock) {
    const hatches = `${build.hatches} ${build.tier} energy ${build.hatches === 1 ? "hatch" : "hatches"}`;
    lines.push(
      build.count === 1
        ? `${label}: 1 machine with ${hatches}`
        : `${label}: ${build.count} machines, each with ${hatches}`,
    );
  } else {
    lines.push(
      build.count === 1
        ? `${label}: 1 machine running at ${build.tier}`
        : `${label}: ${build.count} machines running at ${build.tier}`,
    );
  }
  if (build.state === "under-powered") {
    lines.push("Underpowered: these hatches can't carry the recipe.");
  } else if (build.state === "over-tier") {
    lines.push("Won't run: the recipe is above this tier.");
  }
  lines.push(...clickHint(build.nodeIds.length));
  return lines;
}

function ListLine({
  icon,
  indent = false,
  isLast = false,
  count,
  label,
  chip,
  euT,
  state,
  wash,
  explain,
  onClick,
}: {
  icon?: MachineHandlerIcon;
  /** A build sub-line: the icon column carries the tree branch instead. */
  indent?: boolean;
  /** The last sub-line closes its branch with an L instead of a T. */
  isLast?: boolean;
  /** Absent on a mixed machine's name line; "1×" is otherwise said out loud. */
  count?: number;
  label?: string;
  /** The fused hatch-and-tier chip, when this line is one build. */
  chip?: Pick<BuildLine, "tier" | "hatches" | "isMultiblock">;
  euT?: number;
  state: NodePowerState;
  /** Tier whose colour faintly washes the whole line. */
  wash?: VoltageTier;
  /** The hover's plain-English lines. MinecraftTooltip, not `title`: the
   * OS tooltip arrives late and slides about, and every other hover in the
   * app already speaks through the game panel. */
  explain: string[];
  onClick: () => void;
}) {
  const stalled = state !== "ok";
  const chipColor = chip?.tier ? GT_TIER_COLORS[chip.tier] : undefined;

  return (
    <MinecraftTooltip label={explain}>
      <button
        type="button"
        onClick={onClick}
        // The wash sits at ~12% - present enough to read as the tier's
        // colour without competing with the chips that name it.
        style={wash ? { backgroundColor: `${GT_TIER_COLORS[wash].background}1f` } : undefined}
        className="relative flex w-full items-center gap-1.5 py-0.5 pl-2 pr-2 text-left hover:bg-[var(--mc-71)]"
      >
        {indent ? (
          /* The branch: a vertical line dropping from under the parent's
             icon, elbowing out to this build's count. Anchored to the
             BUTTON's box (inset-y-0), not the flex row - the row's box
             stops at the padding, and the 4px of it between rows is
             exactly the gap that used to chop the stem into dashes. The
             last build stops at its elbow, closing the stem in an L. */
          <>
            <span aria-hidden className="absolute bottom-0 left-2 top-0 w-[24px] opacity-60">
              <span
                className={[
                  "absolute left-[11px] top-0 w-[2px] bg-[var(--mc-ink-muted)]",
                  isLast ? "h-[calc(50%+1px)]" : "bottom-0",
                ].join(" ")}
              />
              <span className="absolute left-[11px] right-0 top-1/2 h-[2px] -translate-y-[1px] bg-[var(--mc-ink-muted)]" />
            </span>
            <span className="w-[24px] shrink-0" />
          </>
        ) : (
          <span className="flex h-[24px] w-[24px] shrink-0 items-center justify-center overflow-hidden">
            {icon ? (
              <ResourceIcon
                resource={{ ...icon, amount: 1, consumed: true }}
                size="sm"
                showAmount={false}
                bare
                tooltip={false}
                className="!h-full !w-full"
              />
            ) : null}
          </span>
        )}
        {count !== undefined ? (
          <span className="shrink-0 text-[14px] font-bold tabular-nums">{count}×</span>
        ) : null}
        <span className="min-w-0 flex-1 truncate whitespace-nowrap text-[14px] leading-6">
          {label ?? ""}
        </span>
        {chipColor && chip ? (
          /* The card's own chip, verbatim: hatch count fused left of the
             tier, one paint job, so the panel and the board read as one.
             Always in the right-hand column, so every chip on the list sits
             on one line however the rows around it are shaped. */
          <span className="flex shrink-0">
            {chip.isMultiblock ? (
              <span
                className="h-5 border-2 border-r-0 px-1 text-[11px] font-bold leading-4"
                style={{
                  backgroundColor: chipColor.background,
                  borderColor: chipColor.border,
                  color: chipColor.text,
                  textShadow: `1px 1px 0 ${chipColor.shadow}`,
                }}
              >
                {chip.hatches}×
              </span>
            ) : null}
            <span
              className="h-5 border-2 px-1.5 text-[11px] font-bold leading-4"
              style={{
                backgroundColor: chipColor.background,
                borderColor: chipColor.border,
                color: chipColor.text,
                textShadow: `1px 1px 0 ${chipColor.shadow}`,
              }}
            >
              {chip.tier}
            </span>
          </span>
        ) : null}
      <span
        className={[
          // Fixed width so every tier chip sits on one column, however wide a
          // row's power figure runs. formatCompact caps the number at four
          // characters, so the worst case fits.
          "w-[58px] shrink-0 whitespace-nowrap text-right text-[13px] tabular-nums",
          stalled ? "font-bold text-red-400" : "",
        ].join(" ")}
      >
        {stalled ? (
          state === "under-powered" ? (
            "LOW!"
          ) : (
            "TIER!"
          )
        ) : euT !== undefined ? (
          <>
            <MotionNumberText
              values={[euT]}
              render={(shown) =>
                shown[0] === euT
                  ? formatCompact(euT)
                  : formatCompactStable(shown[0] ?? euT)
              }
            />
            {/* Same suffix treatment as the card's power cell: small, grey,
                hugging the number. */}
            <span className="ml-0.5 text-[8px] text-[var(--mc-ink-muted)]">EU/t</span>
          </>
        ) : (
          ""
        )}
        </span>
      </button>
    </MinecraftTooltip>
  );
}
