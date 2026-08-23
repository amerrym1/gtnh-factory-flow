"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Zap } from "lucide-react";
import { ENERGY_HATCH_TYPES, type EnergyHatchType } from "@/lib/machines/energy-hatches";
import { GT_OVERCLOCK_TIERS, getVoltageTierIndex } from "@/lib/model/tiers";
import type { MachineTier } from "@/lib/model/types";
import { formatCompact } from "@/lib/model";
import { ResourceIcon } from "@/components/nei/ResourceIcon";
import { GT_TIER_COLORS } from "./tier-colors";
import {
  energyHatchCatalogKey,
  type EnergyHatchCatalog,
  type EnergyHatchCatalogEntry,
} from "./use-energy-hatch-catalog";

type VoltageTier = Exclude<MachineTier, "DEMO">;

const TABS = [
  { id: "all", label: "All" },
  { id: "standard", label: "Hatches" },
  { id: "multiamp", label: "Multi-Amp" },
  { id: "laser", label: "Lasers" },
] as const;
type TabId = (typeof TABS)[number]["id"];

function familyTab(type: EnergyHatchType): TabId {
  if (!type.exotic) {
    return "standard";
  }
  return type.id.startsWith("laser") ? "laser" : "multiamp";
}

interface MenuRow {
  tier: VoltageTier;
  type: EnergyHatchType;
  entry?: EnergyHatchCatalogEntry;
}

/**
 * The energy hatch picker: one table of every buildable hatch, real item
 * icons, a family tab rail, and the power numbers each one means - amps and
 * the EU/t budget it hands the machine. Picking a row sets the card's tier
 * AND hatch family in one move, because in the game that pair is one block.
 */
export function EnergyHatchMenu({
  anchor,
  currentTier,
  currentFamilyId,
  catalog,
  onPick,
  onClose,
}: {
  /** Screen coordinates of the chip's bottom-right corner. */
  anchor: { x: number; y: number };
  currentTier: string;
  currentFamilyId: string;
  catalog: EnergyHatchCatalog;
  onPick: (familyId: string, tier: VoltageTier) => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<TabId>(() =>
    familyTab(ENERGY_HATCH_TYPES.find((type) => type.id === currentFamilyId) ?? ENERGY_HATCH_TYPES[0]),
  );
  const panelRef = useRef<HTMLDivElement>(null);
  const selectedRef = useRef<HTMLButtonElement>(null);

  // Escape, any press outside the panel, and any scroll outside it all close
  // the menu: it is a FIXED body portal (the only layer above the marching
  // dashes and neighbouring cards), so a board pan or zoom would otherwise
  // leave it stranded where the chip used to be.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    // The anchor button is "inside": it runs its own toggle, and closing here
    // first would make that toggle reopen the menu instead.
    const outside = (target: EventTarget | null) =>
      panelRef.current &&
      !panelRef.current.contains(target as Node) &&
      !(target instanceof Element && target.closest("[data-hatch-menu-anchor]"));
    const onPointer = (event: PointerEvent) => {
      if (outside(event.target)) {
        onClose();
      }
    };
    const onWheel = (event: WheelEvent) => {
      if (outside(event.target)) {
        onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer, true);
    document.addEventListener("wheel", onWheel, true);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer, true);
      document.removeEventListener("wheel", onWheel, true);
    };
  }, [onClose]);

  // The list opens with the current build in view.
  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: "center" });
  }, [tab]);

  const rows = useMemo(() => {
    const built: MenuRow[] = [];
    for (const { tier } of GT_OVERCLOCK_TIERS) {
      for (const type of ENERGY_HATCH_TYPES) {
        if (tab !== "all" && familyTab(type) !== tab) {
          continue;
        }
        const entry = catalog.get(energyHatchCatalogKey(tier, type.id));
        // With the catalog loaded, existence is what the dataset says; before
        // it arrives (or offline) the registrations' floor stands in.
        const exists =
          catalog.size > 0
            ? entry !== undefined
            : getVoltageTierIndex(type.minTier as VoltageTier) <= getVoltageTierIndex(tier);
        if (exists) {
          built.push({ tier, type, entry });
        }
      }
    }
    return built;
  }, [catalog, tab]);

  // A body portal at tooltip depth: inside the node's own layer the panel
  // sat under the marching-dash canvas and under later-painted cards.
  const PANEL_WIDTH = 500;
  const PANEL_MAX_HEIGHT = 620;
  return createPortal(
    <div
      ref={panelRef}
      // "nowheel" stops React Flow from zooming the canvas when scrolling the
      // list: its native wheel handler runs before React's synthetic one.
      className="nodrag nowheel fixed z-[9999] w-[500px] border-2 border-[var(--mc-15)] bg-[var(--mc-78)] p-2 shadow-[inset_2px_2px_0_var(--mc-100),inset_-2px_-2px_0_var(--mc-33),4px_4px_0_rgba(0,0,0,0.35)]"
      style={{
        left: Math.max(8, Math.min(anchor.x - PANEL_WIDTH, window.innerWidth - PANEL_WIDTH - 8)),
        top: Math.max(8, Math.min(anchor.y + 4, window.innerHeight - PANEL_MAX_HEIGHT - 8)),
      }}
      onClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
      onWheel={(event) => event.stopPropagation()}
    >
      <div className="mb-1 flex gap-1">
        {TABS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            onClick={() => setTab(entry.id)}
            className={`h-7 flex-1 whitespace-nowrap border px-1 text-[11px] font-bold uppercase leading-none ${
              tab === entry.id
                ? "border-[var(--mc-15)] bg-[var(--mc-100)] text-[var(--mc-ink)] shadow-[inset_1px_1px_0_var(--mc-54)]"
                : "border-[var(--mc-33)] bg-[var(--mc-64)] text-[var(--mc-ink-muted)] hover:bg-[var(--mc-71)]"
            }`}
          >
            {entry.label}
          </button>
        ))}
      </div>
      {/* Column heads: what the block is, then the two power facts. */}
      <div className="grid grid-cols-[minmax(0,1fr)_64px_92px] gap-x-1.5 px-1 pb-1 pr-3.5 text-[11px] font-bold uppercase leading-none text-[var(--mc-ink-muted)]">
        <span>Hatch</span>
        <span className="text-right">Amps</span>
        <span className="text-right">EU/t</span>
      </div>
      <div className="max-h-[480px] overflow-y-auto pr-1.5">
        {rows.map(({ tier, type, entry }) => {
          const selected = tier === currentTier && type.id === currentFamilyId;
          const color = GT_TIER_COLORS[tier];
          const voltage = GT_OVERCLOCK_TIERS.find((t) => t.tier === tier)?.maxEuT ?? 0;
          return (
            <button
              key={`${tier}|${type.id}`}
              ref={selected ? selectedRef : undefined}
              type="button"
              onClick={() => onPick(type.id, tier)}
              className={`grid w-full grid-cols-[minmax(0,1fr)_64px_92px] items-center gap-x-1.5 border px-1 py-1 text-left text-[13px] font-bold leading-5 ${
                selected
                  ? "border-[var(--selection)] bg-[var(--mc-85)] text-[var(--mc-ink)]"
                  : "border-transparent text-[var(--mc-ink)] hover:border-[var(--mc-33)] hover:bg-[var(--mc-85)]"
              }`}
            >
              <span className="flex min-w-0 items-center gap-1.5">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden">
                  {entry && (entry.iconPath || entry.iconAtlas) ? (
                    <ResourceIcon
                      resource={{ kind: "item", amount: 1, ...entry }}
                      bare
                      tooltip={false}
                      showAmount={false}
                      showConsumedState={false}
                      className="!h-9 !w-9 shrink-0"
                    />
                  ) : (
                    <Zap className="h-6 w-6 opacity-60" />
                  )}
                </span>
                <span
                  className="shrink-0 border px-1.5 text-[12px] leading-[17px]"
                  style={{
                    backgroundColor: color.background,
                    borderColor: color.border,
                    color: color.text,
                    textShadow: `1px 1px 0 ${color.shadow}`,
                  }}
                >
                  {tier}
                </span>
                <span className="truncate">{type.label}</span>
              </span>
              <span className="whitespace-nowrap text-right tabular-nums">
                {formatCompact(type.amps)}
              </span>
              <span className="whitespace-nowrap text-right tabular-nums text-[var(--mc-ink-muted)]">
                {formatCompact(voltage * type.amps)}
              </span>
            </button>
          );
        })}
      </div>
      {/* The two rules the numbers above assume, in one breath. */}
      <div className="mt-1 border-t border-[var(--mc-54)] px-1 pt-1 text-[12px] leading-5 text-[var(--mc-ink-muted)]">
        Regular hatches: one works at 1 A, two or more at 2 A each; set how many with the count
        button. Multi-amp and laser hatches: exactly one, of its whole rating.
      </div>
    </div>,
    document.body,
  );
}
