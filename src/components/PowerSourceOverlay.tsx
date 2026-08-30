"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Search, X, Zap } from "lucide-react";
import { useIsCompactViewport } from "@/lib/compact-view";
import { formatAmount } from "@/lib/power/sources/helpers";
import { POWER_GROUPS, POWER_SOURCES } from "@/lib/power/registry";
import { buildPowerSettingsReader, type PowerSourceDefinition } from "@/lib/power/types";
import { useFactoryStore } from "@/store/factory-store";

/**
 * The power source picker: every generator family the planner models, grouped
 * the way players think about them, placed with one click. The recipe book's
 * sibling - same portal shell, same dark ground - but a fixed catalog rather
 * than a search over the dataset.
 */
export function PowerSourceOverlay() {
  const open = useFactoryStore((state) => state.powerMenuOpen);
  const closePowerMenu = useFactoryStore((state) => state.closePowerMenu);
  const addPowerSourceNode = useFactoryStore((state) => state.addPowerSourceNode);
  const compact = useIsCompactViewport();
  const [query, setQuery] = useState("");

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

  // What each card makes at its default settings, computed once: the picker
  // answers "what do I get" before anything is placed.
  const previews = useMemo(() => {
    const map = new Map<string, string>();
    for (const source of POWER_SOURCES) {
      map.set(source.id, describeDefaultOutput(source));
    }
    return map;
  }, []);

  if (!open) {
    return null;
  }

  const trimmed = query.trim().toLowerCase();
  const matches = (source: PowerSourceDefinition) =>
    trimmed === "" ||
    source.name.toLowerCase().includes(trimmed) ||
    source.blurb.toLowerCase().includes(trimmed) ||
    (source.unlock ?? "").toLowerCase() === trimmed;

  return createPortal(
    <div
      className={[
        "pointer-events-auto fixed inset-0 flex items-center justify-center bg-black/70 px-3 py-2",
        compact ? "z-[90]" : "z-50",
      ].join(" ")}
      onPointerDown={closePowerMenu}
    >
      <section
        className="pointer-events-auto relative flex max-h-full flex-col font-mono"
        aria-label="Power sources"
        style={{ width: "min(880px, 100%)", height: compact ? "100%" : "min(720px, 100%)" }}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden border-4 border-[#23262d] bg-[#101215] text-[var(--mc-ink)] shadow-[inset_2px_2px_0_rgba(255,255,255,0.05),inset_-2px_-2px_0_rgba(0,0,0,0.6)]">
          <div className="flex items-center gap-2 border-b-2 border-[#23262d] p-2 pl-3">
            <Zap className="h-4 w-4 shrink-0 text-amber-300" aria-hidden />
            <span className="text-sm uppercase tracking-wide">Power sources</span>
            <label className="relative ml-auto flex min-w-0 flex-1 items-center sm:max-w-[260px]">
              <Search className="pointer-events-none absolute left-2 h-3.5 w-3.5 opacity-60" aria-hidden />
              <input
                autoFocus={!compact}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Find a power source"
                className="h-8 w-full border-2 border-[var(--mc-33)] bg-[var(--mc-61)] pl-7 pr-2 text-xs text-[var(--mc-ink)] placeholder:text-[var(--mc-ink)]/50 focus:outline-none"
              />
            </label>
            <button
              type="button"
              title="Close (Esc)"
              aria-label="Close power sources"
              onClick={closePowerMenu}
              className="flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center border-2 border-[var(--mc-33)] bg-[var(--mc-61)] hover:bg-[var(--mc-85)]"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="recipe-search-scroll min-h-0 flex-1 overflow-y-auto p-3">
            {POWER_GROUPS.map((group) => {
              const sources = POWER_SOURCES.filter(
                (source) => source.group === group.id && matches(source),
              );
              if (sources.length === 0) {
                return null;
              }
              return (
                <div key={group.id} className="mb-4 last:mb-0">
                  <div className="mb-1.5 flex items-baseline gap-2">
                    <span className="text-xs uppercase tracking-wider text-amber-200/90">
                      {group.name}
                    </span>
                    <span className="truncate text-[10px] text-[var(--mc-ink)]/50">{group.blurb}</span>
                  </div>
                  <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
                    {sources.map((source) => (
                      <button
                        key={source.id}
                        type="button"
                        onClick={() => addPowerSourceNode(source.id)}
                        className="group flex cursor-pointer flex-col gap-0.5 border-2 border-[var(--mc-33)] bg-[var(--mc-71)] p-2 text-left hover:border-amber-300/70 hover:bg-[var(--mc-85)]"
                      >
                        <span className="flex items-center gap-1.5">
                          <span className="min-w-0 flex-1 truncate text-xs text-[var(--mc-ink)]">
                            {source.name}
                          </span>
                          {source.unlock ? (
                            <span className="shrink-0 border border-[var(--mc-33)] px-1 text-[9px] uppercase text-[var(--mc-ink)]/70">
                              {source.unlock}
                            </span>
                          ) : null}
                        </span>
                        <span className="truncate text-[10px] text-[var(--mc-ink)]/55">
                          {source.blurb}
                        </span>
                        <span className="text-[10px] text-emerald-300/90">
                          {previews.get(source.id)}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>
    </div>,
    document.body,
  );
}

function describeDefaultOutput(source: PowerSourceDefinition): string {
  try {
    const model = source.compute(buildPowerSettingsReader(source, undefined));
    if (model.euPerTick > 0) {
      return `Makes ${formatAmount(model.euPerTick)} EU/t`;
    }
    const output = model.outputs[0];
    if (output) {
      const draw = model.euPerTick < 0 ? `, draws ${formatAmount(-model.euPerTick)} EU/t` : "";
      return `Makes ${formatAmount(output.perSecond)} ${output.unit}/s ${output.name}${draw}`;
    }
    if (model.euPerTick < 0) {
      return `Draws ${formatAmount(-model.euPerTick)} EU/t`;
    }
    return "Pick a fuel on the card";
  } catch {
    return "";
  }
}
