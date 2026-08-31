"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, ArrowRight, Search, X, Zap } from "lucide-react";
import { useIsCompactViewport } from "@/lib/compact-view";
import { getPowerMachineIcon } from "@/lib/power/planner-data";
import {
  hitPlacementSettings,
  searchPowerSources,
  type PowerSearchHit,
} from "@/lib/power/power-search";
import { formatAmount } from "@/lib/power/sources/helpers";
import { POWER_GROUPS } from "@/lib/power/registry";
import { buildPowerSettingsReader, type PowerSourceDefinition } from "@/lib/power/types";
import { ResourceIcon } from "@/components/nei/ResourceIcon";
import { useFactoryStore } from "@/store/factory-store";

/**
 * The power source picker: the recipe search's sibling, at the recipe
 * search's size. Browsing shows the whole catalog in groups; typing searches
 * the machines AND everything they take or make under any setting - so
 * "benzene" finds every machine that burns it, and picking one places the
 * card with that fuel already dialed in.
 */
export function PowerSourceOverlay() {
  const open = useFactoryStore((state) => state.powerMenuOpen);
  const closePowerMenu = useFactoryStore((state) => state.closePowerMenu);
  const addPowerSourceNode = useFactoryStore((state) => state.addPowerSourceNode);
  const compact = useIsCompactViewport();
  const [query, setQuery] = useState("");
  const layout = usePowerPickerViewport(open);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        closePowerMenu();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, closePowerMenu]);

  useEffect(() => {
    if (!open) {
      setQuery("");
    }
  }, [open]);

  const hits = useMemo(() => (open ? searchPowerSources(query) : []), [open, query]);

  if (!open) {
    return null;
  }

  const searching = query.trim() !== "";
  const place = (hit: PowerSearchHit) => {
    addPowerSourceNode(hit.source.id, hitPlacementSettings(hit));
  };

  return createPortal(
    <div
      className={[
        "pointer-events-auto fixed inset-0 flex items-center justify-center bg-black/70",
        compact ? "z-[90]" : "z-50",
        layout.sheet ? "" : "px-3 py-2",
      ].join(" ")}
      onPointerDown={closePowerMenu}
      // Like the recipe search: the dim starts where the item browser ends,
      // so the left column stays bright beside it.
      style={{ left: layout.sheet ? 0 : layout.leftInset }}
    >
      <section
        className="pointer-events-auto relative flex flex-col font-mono"
        aria-label="Power sources"
        style={{
          width: layout.sheet ? "100%" : `min(${layout.width}px, 100%)`,
          height: layout.sheet ? "100%" : `min(${layout.height}px, 100%)`,
        }}
      >
        <div
          className="relative flex min-h-0 flex-1 flex-col overflow-hidden border-4 border-[#23262d] bg-[#101215] text-[var(--mc-ink)] shadow-[inset_2px_2px_0_rgba(255,255,255,0.05),inset_-2px_-2px_0_rgba(0,0,0,0.6)]"
          onPointerDown={(event) => event.stopPropagation()}
        >
          <div className="flex items-center gap-2 border-b-2 border-[#23262d] p-2 pl-3">
            <Zap className="h-4 w-4 shrink-0 text-amber-300" aria-hidden />
            <span className="shrink-0 text-sm uppercase tracking-wide">Power sources</span>
            <label className="relative ml-auto flex min-w-0 flex-1 items-center sm:max-w-[340px]">
              <Search className="pointer-events-none absolute left-2 h-3.5 w-3.5 opacity-60" aria-hidden />
              <input
                autoFocus={!compact}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Machine, fuel, or product..."
                className="h-9 w-full border-2 border-[var(--mc-33)] bg-[var(--mc-61)] pl-7 pr-2 text-sm text-[var(--mc-ink)] placeholder:text-[var(--mc-ink)]/50 focus:outline-none"
              />
            </label>
            <button
              type="button"
              title="Close (Esc)"
              aria-label="Close power sources"
              onClick={closePowerMenu}
              className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center border-2 border-[var(--mc-33)] bg-[var(--mc-61)] hover:bg-[var(--mc-85)]"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="recipe-search-scroll min-h-0 flex-1 overflow-y-auto p-3">
            {searching ? (
              hits.length === 0 ? (
                <p className="p-2 text-sm text-[var(--mc-ink)]/60">
                  No power source matches. Machines are searched by name and by every fuel and
                  product they can run on.
                </p>
              ) : (
                <PowerHitGrid hits={hits} onPlace={place} />
              )
            ) : (
              POWER_GROUPS.map((group) => {
                const groupHits = hits.filter((hit) => hit.source.group === group.id);
                if (groupHits.length === 0) {
                  return null;
                }
                return (
                  <div key={group.id} className="mb-5 last:mb-0">
                    <div className="mb-2 flex items-baseline gap-2">
                      <span className="text-xs uppercase tracking-wider text-amber-200/90">
                        {group.name}
                      </span>
                      <span className="truncate text-[11px] text-[var(--mc-ink)]/50">
                        {group.blurb}
                      </span>
                    </div>
                    <PowerHitGrid hits={groupHits} onPlace={place} />
                  </div>
                );
              })
            )}
          </div>
        </div>
      </section>
    </div>,
    document.body,
  );
}

function PowerHitGrid({
  hits,
  onPlace,
}: {
  hits: PowerSearchHit[];
  onPlace: (hit: PowerSearchHit) => void;
}) {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(250px,1fr))] gap-2">
      {hits.map((hit) => (
        <PowerSourceCard key={hit.source.id} hit={hit} onPlace={onPlace} />
      ))}
    </div>
  );
}

function PowerSourceCard({
  hit,
  onPlace,
}: {
  hit: PowerSearchHit;
  onPlace: (hit: PowerSearchHit) => void;
}) {
  const { source, via } = hit;
  const icon = getPowerMachineIcon(source.id);
  const preview = useMemo(
    () => describeOutput(source, hitPlacementSettings(hit)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [source.id, via?.settingId, via?.optionKey],
  );
  return (
    <button
      type="button"
      onClick={() => onPlace(hit)}
      className="group flex cursor-pointer items-stretch gap-2 border-2 border-[var(--mc-33)] bg-[var(--mc-71)] p-2 text-left hover:border-amber-300/70 hover:bg-[var(--mc-85)]"
    >
      <span className="flex h-14 w-14 shrink-0 items-center justify-center self-center overflow-hidden border border-[var(--mc-47)] bg-[var(--mc-55)]">
        {icon?.iconPath ? (
          // The machine's own item art, through ResourceIcon so the sprite's
          // baked-in transparent padding is zoomed away like everywhere else.
          <ResourceIcon
            resource={{
              kind: "item",
              id: icon.id,
              amount: 1,
              displayName: icon.displayName,
              iconPath: icon.iconPath,
              dominantColor: icon.dominantColor,
            }}
            bare
            tooltip={false}
            showAmount={false}
            showConsumedState={false}
            // These are 3D block renders whose art fills the middle ~60% of
            // the sprite: 96px through a 56px window crops the padding away
            // without diving into the block's face.
            iconPixelSize={96}
            className="!h-14 !w-14"
          />
        ) : (
          <Zap className="h-6 w-6 text-amber-300" aria-hidden />
        )}
      </span>
      <span className="flex min-w-0 flex-1 flex-col justify-center gap-0.5">
        <span className="flex items-center gap-1.5">
          <span className="min-w-0 flex-1 truncate text-[13px] font-bold text-[var(--mc-ink)]">
            {source.name}
          </span>
          {source.unlock ? (
            <span className="shrink-0 border border-[var(--mc-33)] px-1 text-[9px] uppercase text-[var(--mc-ink)]/70">
              {source.unlock}
            </span>
          ) : null}
        </span>
        <span className="truncate text-[11px] leading-tight text-[var(--mc-ink)]/55">
          {source.blurb}
        </span>
        <span className="truncate text-[11px] text-emerald-300/90">{preview}</span>
        {via ? (
          // The search matched through a flow: say which one, in the stencil
          // family's cyan, with the direction as an arrow.
          <span className="flex items-center gap-1 truncate text-[11px] text-cyan-300">
            {via.direction === "takes" ? (
              <ArrowRight className="h-3 w-3 shrink-0" aria-hidden />
            ) : (
              <ArrowLeft className="h-3 w-3 shrink-0" aria-hidden />
            )}
            {via.direction === "takes" ? `Takes ${via.name}` : `Makes ${via.name}`}
          </span>
        ) : null}
      </span>
    </button>
  );
}

function describeOutput(
  source: PowerSourceDefinition,
  settings: Record<string, string> | undefined,
): string {
  try {
    const model = source.compute(buildPowerSettingsReader(source, settings));
    if (model.euPerTick > 0) {
      return `Makes ${formatAmount(model.euPerTick)} EU/t`;
    }
    const output = model.outputs[0];
    if (output) {
      const draw = model.euPerTick < 0 ? `, draws ${formatAmount(-model.euPerTick)} EU/t` : "";
      return `Makes ${formatAmount(output.perSecond)} ${output.unit === "L" ? "L" : ""}/s ${output.name}${draw}`;
    }
    if (model.euPerTick < 0) {
      return `Draws ${formatAmount(-model.euPerTick)} EU/t`;
    }
    return "Pick a fuel on the card";
  } catch {
    return "";
  }
}

// ---- viewport: mirrors the recipe search's sizing so the two feel like one
// tool (RecipeSearchOverlay.tsx keeps the originals).

const PICKER_SIDEBAR_LEFT = 306;
const PICKER_MIN_WIDTH = 640;
const PICKER_MAX_WIDTH = 2200;
const PICKER_MAX_HEIGHT = 1200;
const PICKER_SHEET_BELOW = 700;

interface PickerViewport {
  sheet: boolean;
  leftInset: number;
  width: number;
  height: number;
}

function readPickerViewport(): PickerViewport {
  if (typeof window === "undefined") {
    return { sheet: false, leftInset: PICKER_SIDEBAR_LEFT, width: 960, height: 760 };
  }
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  if (viewportWidth < PICKER_SHEET_BELOW) {
    return { sheet: true, leftInset: 0, width: viewportWidth, height: viewportHeight };
  }
  const browser = document.querySelector('aside[data-help-anchor="browser"]');
  const leftInset = browser
    ? Math.round(browser.getBoundingClientRect().width)
    : PICKER_SIDEBAR_LEFT;
  return {
    sheet: false,
    leftInset,
    width: Math.min(PICKER_MAX_WIDTH, Math.max(PICKER_MIN_WIDTH, viewportWidth - leftInset - 24)),
    height: Math.min(PICKER_MAX_HEIGHT, Math.max(360, viewportHeight - 20)),
  };
}

function usePowerPickerViewport(open: boolean): PickerViewport {
  const [viewport, setViewport] = useState(readPickerViewport);
  useEffect(() => {
    if (!open) {
      return;
    }
    const update = () => setViewport(readPickerViewport());
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [open]);
  return viewport;
}
