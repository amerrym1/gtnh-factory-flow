"use client";

import { Search, Zap } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { DatasetResourceIndexEntry } from "@/lib/datasets/types";
import type { RecipeQueryRole } from "@/lib/datasets/recipe-query";
import { useDebouncedValue } from "@/lib/hooks/use-debounced-value";
import { POWER_EU_CLAUSE_ID, queryAsksForPower } from "@/lib/power/power-search";
import { machineArtPixels } from "./flow/MachinePicker";
import { ResourceIcon } from "./nei/ResourceIcon";

/**
 * The item picker behind the stencil's "+ takes" / "+ makes" keys: one
 * search box over a two-column list of dataset resources, first result on
 * Enter, a click anywhere else closes it. The recipe search opens it ABOVE
 * the stencil (the stencil sits at the bottom of the screen); the library
 * opens it BELOW its header keys. Same picker, one `placement`.
 */
export function ItemPickerPopover({
  role,
  placement = "above",
  onPick,
  onClose,
  searchPickerResources,
}: {
  role: RecipeQueryRole;
  placement?: "above" | "below";
  onPick: (entry: DatasetResourceIndexEntry, role: RecipeQueryRole) => void;
  onClose: () => void;
  searchPickerResources: (
    query: string,
    signal: AbortSignal,
  ) => Promise<DatasetResourceIndexEntry[]>;
}) {
  const [pickerQuery, setPickerQuery] = useState("");
  // Results remember the query they answer, so "loading" is simply
  // "the answer on screen is not for the query being asked".
  const [answer, setAnswer] = useState<{ query: string; entries: DatasetResourceIndexEntry[] }>();
  const debouncedQuery = useDebouncedValue(pickerQuery, 125);
  const asked = debouncedQuery.trim();
  const results = answer?.entries ?? [];
  const loading = answer?.query !== asked;
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // A click elsewhere closes the picker.
  useEffect(() => {
    const onPointerDown = (event: globalThis.PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        onClose();
      }
    };
    window.addEventListener("pointerdown", onPointerDown, true);
    return () => window.removeEventListener("pointerdown", onPointerDown, true);
  }, [onClose]);

  useEffect(() => {
    const controller = new AbortController();
    searchPickerResources(asked, controller.signal)
      .then((entries) => setAnswer({ query: asked, entries }))
      .catch(() => {
        if (!controller.signal.aborted) {
          setAnswer({ query: asked, entries: [] });
        }
      });
    return () => controller.abort();
  }, [asked, searchPickerResources]);

  // Power is not a dataset resource, but it IS something machines make: the
  // makes side offers it as a condition, and generators answer it.
  const displayResults: DatasetResourceIndexEntry[] =
    role === "makes" && queryAsksForPower(pickerQuery)
      ? [
          {
            kind: "fluid",
            id: POWER_EU_CLAUSE_ID,
            displayName: "Power (EU)",
            dominantColor: "#d99a2b",
          } as DatasetResourceIndexEntry,
          ...results,
        ]
      : results;

  return (
    <div
      ref={rootRef}
      className={[
        "absolute z-20 w-full max-w-[640px] border-2 border-[var(--mc-15)] bg-[var(--mc-61)] p-2 shadow-[6px_6px_0_rgba(0,0,0,0.45)] sm:w-[640px]",
        placement === "above"
          ? "bottom-full left-1/2 mb-2 -translate-x-1/2"
          : "left-0 top-full mt-2",
      ].join(" ")}
    >
      <label className="flex h-9 items-center gap-2 border-2 border-[var(--mc-33)] bg-[#17191d] px-2 text-sm text-neutral-100 shadow-[inset_2px_2px_0_#30343b,inset_-2px_-2px_0_#050607]">
        <Search className="h-4 w-4 shrink-0 text-neutral-500" />
        <input
          ref={inputRef}
          value={pickerQuery}
          onChange={(event) => setPickerQuery(event.target.value)}
          placeholder={role === "takes" ? "Add an input..." : "Add an output..."}
          className="min-w-0 flex-1 bg-transparent text-neutral-100 outline-none placeholder:text-neutral-500"
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.stopPropagation();
              onClose();
            }
            if (event.key === "Enter" && displayResults[0]) {
              onPick(displayResults[0], role);
            }
          }}
        />
      </label>
      <div className="recipe-search-scroll mt-2 grid max-h-[460px] grid-cols-1 gap-1 overflow-y-auto compact:max-h-[max(140px,calc(100vh-320px))] sm:grid-cols-2">
        {loading && displayResults.length === 0 ? (
          <div className="p-2 text-sm text-[var(--mc-ink-muted)]">Searching...</div>
        ) : displayResults.length === 0 ? (
          <div className="p-2 text-sm text-[var(--mc-ink-muted)]">No matching items.</div>
        ) : (
          displayResults.map((entry) => (
            <button
              key={`${entry.kind}:${entry.id}`}
              type="button"
              onClick={() => onPick(entry, role)}
              className="flex w-full items-center gap-2 border-2 border-transparent bg-[var(--mc-47)] px-1.5 py-1 text-left hover:bg-[var(--mc-61)]"
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden">
                {entry.id === POWER_EU_CLAUSE_ID ? (
                  <Zap className="h-4 w-4 fill-current text-amber-300" aria-hidden />
                ) : (
                  <ResourceIcon
                    resource={{ ...entry, amount: 1 }}
                    size="sm"
                    bare
                    showAmount={false}
                    tooltip={false}
                    className="!h-full !w-full"
                    iconPixelSize={machineArtPixels(32)}
                  />
                )}
              </span>
              <span className="min-w-0 flex-1 truncate text-[14px] font-bold text-[var(--mc-ink)]">
                {entry.displayName ?? entry.id}
              </span>
            </button>
          ))
        )}
      </div>
    </div>
  );
}
