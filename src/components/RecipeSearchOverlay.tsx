"use client";

import { ArrowLeftRight, Plus, Search, Star, X } from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent, UIEvent } from "react";
import type { DatasetResourceIndexEntry, RecipeSummary } from "@/lib/datasets/types";
import type { RecipeQueryRole, RecipeQuerySideOp } from "@/lib/datasets/recipe-query";
import {
  GT_VOLTAGE_TIERS,
  formatRate,
  getRecipeMachineHandlers,
  isOreDictionaryResource,
  resourceMatchesInput,
} from "@/lib/model";
import type { MachineTier, ResourceAmount } from "@/lib/model/types";
import { GT_TIER_COLORS } from "./flow/tier-colors";
import type { TierFilter } from "@/store/factory-store";
import { useDebouncedValue } from "@/lib/hooks/use-debounced-value";
import { machineArtPixels } from "./flow/MachinePicker";
import { useMachineHandlerIcons } from "./flow/machine-icons";
import { ResourceIcon } from "./nei/ResourceIcon";
import {
  contextualizePreviewRecipe,
  summaryToPreviewRecipe,
  type PreviewContextResource,
} from "./recipe-preview";

/**
 * One condition on the stencil: a resource and the side of the recipe it must
 * appear on, dressed to draw its own chip.
 */
export interface StencilClause
  extends Pick<
    ResourceAmount,
    "kind" | "id" | "displayName" | "iconPath" | "iconAtlas" | "dominantColor"
  > {
  role: RecipeQueryRole;
}

export interface RecipeMapChip {
  id: string;
  label: string;
  count?: number;
  icon?: Pick<
    ResourceAmount,
    "kind" | "id" | "amount" | "displayName" | "iconPath" | "iconAtlas" | "dominantColor"
  >;
}

/**
 * The recipe search: one screen, no browse step.
 *
 * The top band is a STENCIL of the recipe being looked for - inputs on the
 * left, outputs on the right, exactly the way a machine card reads - and the
 * rest of the screen is the answers, updating as the stencil changes. Each
 * side combines its items with ANY (either of these) or ALL (every one of
 * them); a recipe must satisfy both sides.
 */
export function RecipeSearchOverlay({
  clauses,
  takesOp,
  makesOp,
  onClausesChange,
  onTakesOpChange,
  onMakesOpChange,
  onSwapSides,
  recipeMapChips,
  activeRecipeMap,
  onRecipeMapChange,
  onRecipeMapHover,
  recipes,
  queryTotal,
  totalAcrossMaps,
  hasMore,
  isLoading,
  queryError,
  query,
  onQueryChange,
  maxTier,
  onMaxTierChange,
  selectedRecipeId,
  onSelectRecipe,
  onAdd,
  onPrefetch,
  onBrowseResource,
  onLoadMore,
  onClose,
  contextResource,
  searchPickerResources,
}: {
  clauses: StencilClause[];
  takesOp: RecipeQuerySideOp;
  makesOp: RecipeQuerySideOp;
  onClausesChange: (clauses: StencilClause[]) => void;
  onTakesOpChange: (op: RecipeQuerySideOp) => void;
  onMakesOpChange: (op: RecipeQuerySideOp) => void;
  onSwapSides: () => void;
  recipeMapChips: RecipeMapChip[];
  activeRecipeMap: string;
  onRecipeMapChange: (recipeMap: string) => void;
  onRecipeMapHover: (recipeMap: string) => void;
  recipes: RecipeSummary[];
  queryTotal: number;
  totalAcrossMaps: number;
  hasMore: boolean;
  isLoading: boolean;
  queryError?: string;
  query: string;
  onQueryChange: (query: string) => void;
  maxTier: TierFilter;
  onMaxTierChange: (tier: TierFilter) => void;
  selectedRecipeId?: string;
  onSelectRecipe: (recipeId: string) => void;
  onAdd: (recipe: RecipeSummary, machineHandlerId?: string) => void | Promise<void>;
  onPrefetch?: (recipeId: string) => void;
  onBrowseResource: (resource: ResourceAmount, mode: "recipes" | "uses") => void;
  onLoadMore: () => void;
  onClose: () => void;
  contextResource?: PreviewContextResource;
  searchPickerResources: (
    query: string,
    signal: AbortSignal,
  ) => Promise<DatasetResourceIndexEntry[]>;
}) {
  const panelRef = useRef<HTMLElement>(null);
  const layout = useRecipeSearchViewport();
  const [dragOffset, setDragOffset] = useState(ZERO_OFFSET);
  const [pickerRole, setPickerRole] = useState<RecipeQueryRole | undefined>(undefined);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  } | null>(null);

  // A screen-filling sheet has nowhere to be dragged to, so it ignores any
  // offset rather than forgetting it.
  const appliedOffset = layout.sheet ? ZERO_OFFSET : dragOffset;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const handlePointerDown = (event: PointerEvent<HTMLElement>) => {
    if (event.button !== 0 || layout.sheet) {
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: dragOffset.x,
      originY: dragOffset.y,
    };
  };

  const handlePointerMove = (event: PointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }
    setDragOffset(
      clampDragOffset(
        {
          x: drag.originX + event.clientX - drag.startX,
          y: drag.originY + event.clientY - drag.startY,
        },
        panelRef.current,
      ),
    );
  };

  const handlePointerUp = (event: PointerEvent<HTMLElement>) => {
    if (dragRef.current?.pointerId === event.pointerId) {
      dragRef.current = null;
    }
  };

  const removeClause = (index: number) => {
    onClausesChange(clauses.filter((_, at) => at !== index));
  };

  const addClause = (entry: DatasetResourceIndexEntry, role: RecipeQueryRole) => {
    const already = clauses.some(
      (clause) => clause.role === role && clause.kind === entry.kind && clause.id === entry.id,
    );
    if (!already) {
      onClausesChange([
        ...clauses,
        {
          role,
          kind: entry.kind,
          id: entry.id,
          displayName: entry.displayName,
          iconPath: entry.iconPath,
          iconAtlas: entry.iconAtlas,
          dominantColor: entry.dominantColor ?? entry.iconAtlas?.dominantColor,
        },
      ]);
    }
    setPickerRole(undefined);
  };

  const takesClauses = clauses.filter((clause) => clause.role === "takes");
  const makesClauses = clauses.filter((clause) => clause.role === "makes");
  const shownTotal = activeRecipeMap ? queryTotal : totalAcrossMaps;
  const sentence = stencilSentence(takesClauses, makesClauses, takesOp, makesOp, shownTotal === 1);

  // Loading more when the bottom of the list scrolls near, so the grid reads
  // as one endless list rather than ending on a button.
  const handleResultsScroll = (event: UIEvent<HTMLDivElement>) => {
    const scroller = event.currentTarget;
    if (!hasMore || isLoading) {
      return;
    }
    if (scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 480) {
      onLoadMore();
    }
  };

  return (
    <div
      className={[
        // The dim ground pushes the board back so the search reads as the one
        // thing on screen.
        "pointer-events-auto fixed inset-0 flex items-center justify-center bg-black/45",
        // While the search steps around the board's sidebars it sits under
        // them, so they stay usable. Once it covers them it has to sit over
        // them, or they clip it instead.
        layout.dodgesSidebars ? "z-30" : "z-50",
        layout.sheet ? "" : "px-3 py-4",
      ].join(" ")}
      onPointerDown={onClose}
      style={
        layout.dodgesSidebars
          ? { paddingLeft: layout.sidebars.left, paddingRight: layout.sidebars.right }
          : undefined
      }
    >
      <section
        ref={panelRef}
        className="pointer-events-auto relative flex flex-col font-mono"
        aria-label="Recipe search"
        onPointerDown={(event) => event.stopPropagation()}
        style={{
          transform: `translate(${appliedOffset.x}px, ${appliedOffset.y}px)`,
          width: layout.sheet ? "100%" : `min(${layout.width}px, 100%)`,
          height: layout.sheet ? "100%" : `min(${layout.height}px, 100%)`,
        }}
      >
        <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden border-2 border-[var(--mc-96)] bg-[var(--mc-78)] text-[var(--mc-ink)] shadow-[inset_2px_2px_0_var(--mc-100),inset_-2px_-2px_0_var(--mc-33)]">
          {/* ===== title bar: the query in words ===== */}
          <div className="px-2 pt-2">
            <div
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerUp}
              className="flex h-11 cursor-move select-none items-center gap-3 border-2 border-[var(--mc-33)] bg-[var(--mc-61)] px-2 shadow-[inset_2px_2px_0_var(--mc-85),inset_-2px_-2px_0_var(--mc-29)]"
            >
              <span className="min-w-0 flex-1 leading-[1.1]">
                <span className="block text-[8px] font-bold uppercase tracking-[0.14em] text-[#ececec] [text-shadow:1px_1px_0_#4a4a4a]">
                  Recipe search
                </span>
                <span className="minecraft-title block truncate text-[17px] leading-[20px] text-white [text-shadow:2px_2px_0_var(--mc-24)]">
                  {sentence
                    ? `${shownTotal.toLocaleString()} ${shownTotal === 1 ? "recipe" : "recipes"} ${sentence}`
                    : "Recipe search"}
                </span>
              </span>
              <button
                type="button"
                title="Close recipe search (Esc)"
                aria-label="Close recipe search"
                onPointerDown={(event) => event.stopPropagation()}
                onClick={onClose}
                className="flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center border-2 border-[var(--mc-33)] bg-[var(--mc-71)] text-[var(--mc-ink)] hover:bg-[var(--mc-85)]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* ===== the stencil band ===== */}
          <div className="relative px-3 pt-2">
            <div className="flex flex-wrap items-center gap-2 border-2 border-[var(--mc-15)] bg-[var(--mc-82)] p-2">
              <StencilSide
                label="Takes"
                role="takes"
                sideClauses={takesClauses}
                clauses={clauses}
                op={takesOp}
                onOpChange={onTakesOpChange}
                onRemove={removeClause}
                onOpenPicker={() => setPickerRole(pickerRole === "takes" ? undefined : "takes")}
              />
              <button
                type="button"
                onClick={onSwapSides}
                title="Swap sides: takes become makes and makes become takes"
                aria-label="Swap the takes and makes sides"
                className="group flex h-8 w-8 shrink-0 items-center justify-center border-2 border-transparent text-[20px] font-black leading-6 text-[var(--mc-ink-muted)] hover:border-[var(--mc-33)] hover:bg-[var(--mc-61)] hover:text-[var(--mc-ink)]"
              >
                <span className="group-hover:hidden">→</span>
                <ArrowLeftRight aria-hidden className="hidden h-4 w-4 group-hover:block" />
              </button>
              <StencilSide
                label="Makes"
                role="makes"
                sideClauses={makesClauses}
                clauses={clauses}
                op={makesOp}
                onOpChange={onMakesOpChange}
                onRemove={removeClause}
                onOpenPicker={() => setPickerRole(pickerRole === "makes" ? undefined : "makes")}
              />
              <label className="ml-auto flex h-9 w-[210px] min-w-0 items-center gap-2 border-2 border-[var(--mc-33)] bg-[#17191d] px-2 text-sm text-neutral-100 shadow-[inset_2px_2px_0_#30343b,inset_-2px_-2px_0_#050607] compact:w-full">
                <Search className="h-4 w-4 shrink-0 text-neutral-500" />
                <input
                  value={query}
                  onChange={(event) => onQueryChange(event.target.value)}
                  placeholder="Filter by name..."
                  className="min-w-0 flex-1 bg-transparent text-neutral-100 outline-none placeholder:text-neutral-500"
                />
                {query ? (
                  <button
                    type="button"
                    onClick={() => onQueryChange("")}
                    className="text-neutral-400 hover:text-white"
                    aria-label="Clear the name filter"
                    title="Clear the name filter"
                  >
                    <X className="h-4 w-4" />
                  </button>
                ) : null}
              </label>
              <select
                value={maxTier}
                onChange={(event) => onMaxTierChange(event.target.value as TierFilter)}
                title="Highest tier"
                aria-label="Maximum machine tier"
                className="h-9 w-28 shrink-0 border-2 border-[var(--mc-33)] bg-[#17191d] px-1.5 text-sm text-neutral-100 outline-none shadow-[inset_2px_2px_0_#30343b,inset_-2px_-2px_0_#050607]"
              >
                <option value="all">All tiers</option>
                {GT_VOLTAGE_TIERS.map((entry) => (
                  <option key={entry.tier} value={entry.tier}>
                    ≤ {entry.tier}
                  </option>
                ))}
              </select>
            </div>
            {pickerRole ? (
              <ItemPickerPopover
                role={pickerRole}
                onPick={addClause}
                onClose={() => setPickerRole(undefined)}
                searchPickerResources={searchPickerResources}
              />
            ) : null}
          </div>

          {/* ===== machine chips ===== */}
          <div className="flex max-h-[92px] flex-wrap items-center gap-1.5 overflow-y-auto px-3 pt-2">
            <MachineChip
              label="All"
              count={totalAcrossMaps}
              active={!activeRecipeMap}
              onClick={() => onRecipeMapChange("")}
            />
            {recipeMapChips.map((chip) => (
              <MachineChip
                key={chip.id}
                label={chip.label}
                count={chip.count}
                icon={chip.icon}
                active={chip.id === activeRecipeMap}
                onClick={() => onRecipeMapChange(chip.id)}
                onHover={() => onRecipeMapHover(chip.id)}
              />
            ))}
          </div>

          {/* ===== the answers ===== */}
          <div
            className={[
              "min-h-0 flex-1 overflow-y-auto",
              layout.sheet ? "p-1.5" : "p-3",
            ].join(" ")}
            onScroll={handleResultsScroll}
          >
            {queryError ? (
              <div className="border-2 border-[var(--mc-47)] bg-[var(--mc-71)] p-3 text-sm shadow-[inset_1px_1px_0_var(--mc-93),inset_-1px_-1px_0_var(--mc-47)]">
                {queryError}
              </div>
            ) : clauses.length === 0 && !query.trim() ? (
              <div className="grid min-h-[260px] place-items-center border-2 border-[var(--mc-47)] bg-[var(--mc-71)] p-3 text-sm shadow-[inset_1px_1px_0_var(--mc-93),inset_-1px_-1px_0_var(--mc-47)]">
                Add an item to either side of the stencil.
              </div>
            ) : isLoading && recipes.length === 0 ? (
              <div className="border-2 border-[var(--mc-47)] bg-[var(--mc-71)] p-3 text-sm shadow-[inset_1px_1px_0_var(--mc-93),inset_-1px_-1px_0_var(--mc-47)]">
                Loading recipes...
              </div>
            ) : recipes.length === 0 ? (
              <div className="grid min-h-[260px] place-items-center border-2 border-[var(--mc-47)] bg-[var(--mc-71)] p-3 text-sm shadow-[inset_1px_1px_0_var(--mc-93),inset_-1px_-1px_0_var(--mc-47)]">
                No matching recipes.
              </div>
            ) : (
              <>
                <div
                  className="grid items-start gap-2"
                  style={{
                    gridTemplateColumns: layout.sheet
                      ? "minmax(0, 1fr)"
                      : "repeat(auto-fill, minmax(400px, 1fr))",
                  }}
                >
                  {recipes.map((recipe) => (
                    <CompactRecipeCard
                      key={recipe.id}
                      recipe={recipe}
                      takesClauses={takesClauses}
                      makesClauses={makesClauses}
                      contextResource={contextResource}
                      selected={selectedRecipeId === recipe.id}
                      onSelectRecipe={onSelectRecipe}
                      onAdd={onAdd}
                      onPrefetch={onPrefetch}
                      onBrowseResource={onBrowseResource}
                    />
                  ))}
                </div>
                {isLoading ? (
                  <div className="mt-3 border-2 border-[var(--mc-47)] bg-[var(--mc-71)] p-3 text-center text-sm shadow-[inset_1px_1px_0_var(--mc-93),inset_-1px_-1px_0_var(--mc-47)]">
                    Loading recipes...
                  </div>
                ) : null}
              </>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

/** One side of the stencil: label, ANY/ALL, its clause chips, and the add slot. */
function StencilSide({
  label,
  role,
  sideClauses,
  clauses,
  op,
  onOpChange,
  onRemove,
  onOpenPicker,
}: {
  label: string;
  role: RecipeQueryRole;
  sideClauses: StencilClause[];
  clauses: StencilClause[];
  op: RecipeQuerySideOp;
  onOpChange: (op: RecipeQuerySideOp) => void;
  onRemove: (index: number) => void;
  onOpenPicker: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--mc-ink)]">
        {label}
      </span>
      {sideClauses.length > 1 ? (
        <span className="flex items-center border-2 border-[var(--mc-29)] bg-[var(--mc-55)]">
          <OpPill
            label="Any"
            title={`Match recipes with any of these ${label.toLowerCase()}`}
            active={op === "any"}
            onClick={() => onOpChange("any")}
          />
          <OpPill
            label="All"
            title={`Match only recipes with all of these ${label.toLowerCase()}`}
            active={op === "all"}
            onClick={() => onOpChange("all")}
          />
        </span>
      ) : null}
      {sideClauses.map((clause) => {
        const index = clauses.indexOf(clause);
        return (
          <span
            key={`${clause.role}:${clause.kind}:${clause.id}`}
            className="flex items-center gap-1.5 border-2 border-[var(--mc-33)] bg-[var(--mc-61)] py-0.5 pl-0.5 pr-1 shadow-[inset_1px_1px_0_var(--mc-85)]"
          >
            <span className="flex h-7 w-7 items-center justify-center overflow-hidden bg-[var(--mc-55)] shadow-[inset_2px_2px_0_var(--mc-25),inset_-2px_-2px_0_var(--mc-100)]">
              <ResourceIcon
                resource={{ ...clause, amount: 1 }}
                size="sm"
                bare
                showAmount={false}
                tooltip={false}
                className="!h-full !w-full"
                iconPixelSize={machineArtPixels(28)}
              />
            </span>
            <span className="max-w-[180px] truncate text-[13px] font-bold">
              {clause.displayName ?? clause.id}
            </span>
            <button
              type="button"
              onClick={() => onRemove(index)}
              aria-label={`Remove ${clause.displayName ?? clause.id} from the search`}
              title="Remove this condition"
              className="flex h-5 w-5 items-center justify-center text-[var(--mc-ink-muted)] hover:text-white"
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        );
      })}
      <button
        type="button"
        onClick={onOpenPicker}
        aria-label={role === "takes" ? "Add an input to the search" : "Add an output to the search"}
        title={role === "takes" ? "Add an input" : "Add an output"}
        className="flex h-8 items-center gap-1.5 border-2 border-dashed border-[var(--mc-47)] px-2 text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--mc-ink-muted)] hover:border-[var(--mc-33)] hover:text-[var(--mc-ink)]"
      >
        <Plus className="h-3.5 w-3.5" />
        {role === "takes" ? "Input" : "Output"}
      </button>
    </div>
  );
}

function OpPill({
  label,
  title,
  active,
  onClick,
}: {
  label: string;
  title: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-pressed={active}
      className={[
        "h-5 shrink-0 whitespace-nowrap px-1.5 text-[10px] font-bold uppercase tracking-[0.1em]",
        active
          ? "bg-[var(--mc-85)] text-white shadow-[inset_1px_1px_0_var(--mc-100)]"
          : "text-[var(--mc-ink-muted)] hover:text-[var(--mc-ink)]",
      ].join(" ")}
    >
      {label}
    </button>
  );
}

/** The searchable item drop-down the stencil's add slots open. */
function ItemPickerPopover({
  role,
  onPick,
  onClose,
  searchPickerResources,
}: {
  role: RecipeQueryRole;
  onPick: (entry: DatasetResourceIndexEntry, role: RecipeQueryRole) => void;
  onClose: () => void;
  searchPickerResources: (
    query: string,
    signal: AbortSignal,
  ) => Promise<DatasetResourceIndexEntry[]>;
}) {
  const [pickerQuery, setPickerQuery] = useState("");
  const [results, setResults] = useState<DatasetResourceIndexEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const debouncedQuery = useDebouncedValue(pickerQuery, 125);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // A click elsewhere in the overlay closes the picker; the overlay's own
  // backdrop already closes everything above this.
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
    setLoading(true);
    searchPickerResources(debouncedQuery.trim(), controller.signal)
      .then((entries) => {
        setResults(entries);
        setLoading(false);
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setResults([]);
          setLoading(false);
        }
      });
    return () => controller.abort();
  }, [debouncedQuery, searchPickerResources]);

  return (
    <div
      ref={rootRef}
      className="absolute left-3 right-3 top-full z-20 mt-1 border-2 border-[var(--mc-15)] bg-[var(--mc-61)] p-2 shadow-[6px_6px_0_rgba(0,0,0,0.35)] sm:left-auto sm:w-[640px]"
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
            if (event.key === "Enter" && results[0]) {
              onPick(results[0], role);
            }
          }}
        />
      </label>
      <div className="mt-2 grid max-h-[460px] grid-cols-1 gap-1 overflow-y-auto sm:grid-cols-2">
        {loading && results.length === 0 ? (
          <div className="p-2 text-sm text-[var(--mc-ink-muted)]">Searching...</div>
        ) : results.length === 0 ? (
          <div className="p-2 text-sm text-[var(--mc-ink-muted)]">No matching items.</div>
        ) : (
          results.map((entry) => (
            <button
              key={`${entry.kind}:${entry.id}`}
              type="button"
              onClick={() => onPick(entry, role)}
              className="flex w-full items-center gap-2 border-2 border-[var(--mc-47)] bg-[var(--mc-71)] px-1.5 py-1 text-left shadow-[inset_1px_1px_0_var(--mc-93),inset_-1px_-1px_0_var(--mc-47)] hover:bg-[var(--mc-85)]"
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden bg-[var(--mc-55)] shadow-[inset_2px_2px_0_var(--mc-25),inset_-2px_-2px_0_var(--mc-100)]">
                <ResourceIcon
                  resource={{ ...entry, amount: 1 }}
                  size="sm"
                  bare
                  showAmount={false}
                  tooltip={false}
                  className="!h-full !w-full"
                  iconPixelSize={machineArtPixels(32)}
                />
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

function MachineChip({
  label,
  count,
  icon,
  active,
  onClick,
  onHover,
}: {
  label: string;
  count?: number;
  icon?: RecipeMapChip["icon"];
  active: boolean;
  onClick: () => void;
  onHover?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={onHover}
      aria-pressed={active}
      className={[
        "flex items-center gap-1.5 border-2 py-0.5 pl-0.5 pr-2 text-[13px] font-bold",
        active
          ? "border-[var(--mc-15)] bg-[var(--mc-85)] shadow-[inset_2px_2px_0_var(--mc-100),0_0_0_2px_#22d3ee_inset]"
          : "border-[var(--mc-47)] bg-[var(--mc-78)] shadow-[inset_2px_2px_0_var(--mc-100),inset_-2px_-2px_0_var(--mc-47)] hover:bg-[var(--mc-85)]",
      ].join(" ")}
    >
      <span className="flex h-7 w-7 items-center justify-center overflow-hidden bg-[var(--mc-55)] shadow-[inset_2px_2px_0_var(--mc-25),inset_-2px_-2px_0_var(--mc-100)]">
        {icon ? (
          <ResourceIcon
            resource={{ ...icon, amount: 1 }}
            size="sm"
            bare
            showAmount={false}
            tooltip={false}
            className="!h-full !w-full"
            iconPixelSize={machineArtPixels(28)}
          />
        ) : (
          // An empty slot reads as a mistake, so a chip with no machine art
          // (the All chip) wears a star instead.
          <Star aria-hidden className="h-4 w-4 text-[var(--mc-ink-muted)]" />
        )}
      </span>
      <span className="max-w-[220px] truncate text-[var(--mc-ink)]">{label}</span>
      {count !== undefined ? (
        <span className="text-[12px] font-bold text-[var(--mc-ink-muted)] tabular-nums">
          {count.toLocaleString()}
        </span>
      ) : null}
    </button>
  );
}

/**
 * One recipe as a compact card-flavoured row: the machine and its numbers on
 * the first line, named item chips - inputs, arrow, outputs - on the second.
 * Chips that satisfy a stencil condition wear the cyan ring.
 */
const CompactRecipeCard = memo(function CompactRecipeCard({
  recipe,
  takesClauses,
  makesClauses,
  contextResource,
  selected,
  onSelectRecipe,
  onAdd,
  onPrefetch,
  onBrowseResource,
}: {
  recipe: RecipeSummary;
  takesClauses: StencilClause[];
  makesClauses: StencilClause[];
  contextResource?: PreviewContextResource;
  selected: boolean;
  onSelectRecipe: (recipeId: string) => void;
  onAdd: (recipe: RecipeSummary, machineHandlerId?: string) => void | Promise<void>;
  onPrefetch?: (recipeId: string) => void;
  onBrowseResource: (resource: ResourceAmount, mode: "recipes" | "uses") => void;
}) {
  const machineIcons = useMachineHandlerIcons();
  const preview = useMemo(
    () => contextualizePreviewRecipe(summaryToPreviewRecipe(recipe), contextResource),
    [contextResource, recipe],
  );
  const handlers = useMemo(() => getRecipeMachineHandlers(preview), [preview]);
  const machineLabel = handlers[0]?.label ?? recipe.machineType;
  const machineIcon = handlers[0] ? machineIcons.get(handlers[0].id) : undefined;
  const seconds = recipe.durationTicks / 20;
  const stats = [
    `${formatRate(seconds, seconds >= 10 ? 0 : 1)}s`,
    recipe.eut > 0 ? `${recipe.eut.toLocaleString()} EU/t` : "no power",
  ].join(" · ");
  const tierColor =
    recipe.eut > 0 ? GT_TIER_COLORS[recipe.minimumTier as Exclude<MachineTier, "DEMO">] : undefined;
  // Crafting-grid recipes arrive one slot at a time (nine separate Iron
  // Plates), and oredict slots arrive wearing their oredict name. The chips
  // read as a shopping list instead: same items merged with their amounts
  // summed, oredict slots wearing their first concrete face.
  const inputChips = useMemo(() => mergeChipResources(preview.inputs), [preview]);
  const outputChips = useMemo(() => mergeChipResources(preview.outputs), [preview]);

  // A pointer that settles on a card is probably about to press its plus, so
  // the full recipe starts travelling now. The short fuse keeps a pointer
  // sweeping across the grid from requesting every card it crosses.
  const prefetchTimerRef = useRef<number | undefined>(undefined);
  const cancelPrefetch = useCallback(() => {
    if (prefetchTimerRef.current !== undefined) {
      window.clearTimeout(prefetchTimerRef.current);
      prefetchTimerRef.current = undefined;
    }
  }, []);
  const armPrefetch = useCallback(() => {
    if (!onPrefetch) {
      return;
    }
    cancelPrefetch();
    prefetchTimerRef.current = window.setTimeout(() => {
      prefetchTimerRef.current = undefined;
      onPrefetch(recipe.id);
    }, 150);
  }, [cancelPrefetch, onPrefetch, recipe.id]);
  useEffect(() => cancelPrefetch, [cancelPrefetch]);

  return (
    <article
      onClick={() => onSelectRecipe(recipe.id)}
      onDoubleClick={() => void onAdd(recipe)}
      onPointerEnter={armPrefetch}
      onPointerLeave={cancelPrefetch}
      className={[
        "cursor-pointer border-2 border-[var(--mc-47)] bg-[var(--mc-71)] p-2 shadow-[inset_1px_1px_0_var(--mc-93),inset_-1px_-1px_0_var(--mc-47)]",
        selected ? "ring-1 ring-cyan-400" : "",
      ].join(" ")}
      style={{ contentVisibility: "auto", containIntrinsicSize: "auto 148px" }}
    >
      <div className="flex items-center gap-2">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden bg-[var(--mc-55)] shadow-[inset_2px_2px_0_var(--mc-25),inset_-2px_-2px_0_var(--mc-100)]">
          {machineIcon ? (
            <ResourceIcon
              resource={{ ...machineIcon, amount: 1 }}
              size="sm"
              bare
              showAmount={false}
              tooltip={false}
              className="!h-full !w-full"
              iconPixelSize={machineArtPixels(36)}
            />
          ) : null}
        </span>
        <span className="min-w-0 flex-1 leading-[1.15]">
          <span className="block truncate text-[15px] font-bold text-[var(--mc-ink)]">
            {machineLabel}
          </span>
          <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[11px] text-[var(--mc-ink-muted)]">
            {tierColor ? (
              <span
                className="shrink-0 border px-1 text-[10px] font-bold leading-[14px] shadow-[inset_1px_1px_0_rgba(255,255,255,0.55),inset_-1px_-1px_0_rgba(0,0,0,0.45)]"
                style={{
                  backgroundColor: tierColor.background,
                  borderColor: tierColor.border,
                  color: tierColor.text,
                  textShadow: `1px 1px 0 ${tierColor.shadow}`,
                }}
              >
                {recipe.minimumTier}
              </span>
            ) : null}
            <span className="truncate">{stats}</span>
          </span>
        </span>
        <button
          type="button"
          title="Add recipe node"
          aria-label="Add recipe node"
          onClick={(event) => {
            event.stopPropagation();
            void onAdd(recipe);
          }}
          className="flex h-8 w-8 shrink-0 items-center justify-center border-2 border-[var(--mc-33)] bg-[var(--mc-61)] text-neutral-100 shadow-[inset_1px_1px_0_var(--mc-85)] hover:border-cyan-400 hover:text-cyan-200"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>
      {/* Two fixed halves with the arrow between, exactly the way the machine
          card itself reads: what it takes on the left, what it makes on the
          right, each item on its own line. */}
      <div className="mt-1.5 grid grid-cols-[minmax(0,1fr)_18px_minmax(0,1fr)] items-start gap-x-1">
        <span className="flex min-w-0 flex-col gap-1">
          {inputChips.map((input, index) => (
            <ResourceChip
              key={`in-${index}`}
              resource={input}
              hit={takesClauses.some((clause) => clauseMatchesInput(clause, input))}
              amountText={input.consumed === false ? "NC" : formatChipAmount(input)}
              onBrowseResource={onBrowseResource}
            />
          ))}
        </span>
        <span className="flex items-start justify-center pt-1.5 text-[15px] font-black leading-5 text-[var(--mc-ink-muted)]">
          →
        </span>
        <span className="flex min-w-0 flex-col gap-1">
          {outputChips.map((output, index) => (
            <ResourceChip
              key={`out-${index}`}
              resource={output}
              hit={makesClauses.some((clause) => clauseMatchesOutput(clause, output))}
              amountText={formatChipAmount(output)}
              chance={"chance" in output ? output.chance : undefined}
              onBrowseResource={onBrowseResource}
            />
          ))}
        </span>
      </div>
    </article>
  );
});

/** A named item chip inside a result: icon, name, amount. Clicks browse it. */
function ResourceChip({
  resource,
  hit,
  amountText,
  chance,
  onBrowseResource,
}: {
  resource: ResourceAmount;
  hit: boolean;
  amountText: string;
  chance?: number;
  onBrowseResource: (resource: ResourceAmount, mode: "recipes" | "uses") => void;
}) {
  return (
    <button
      type="button"
      title={`${resource.displayName ?? resource.id}: click for what makes it, right click for what uses it`}
      onClick={(event) => {
        event.stopPropagation();
        onBrowseResource({ ...resource, amount: 1 }, "recipes");
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onBrowseResource({ ...resource, amount: 1 }, "uses");
      }}
      className={[
        "flex w-full items-center gap-1.5 border py-0.5 pl-0.5 pr-1.5 text-left",
        hit
          ? "border-cyan-400 bg-[var(--mc-61)]"
          : "border-[var(--mc-47)] bg-[var(--mc-61)] hover:border-[var(--mc-33)]",
      ].join(" ")}
    >
      <span className="flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden bg-[var(--mc-55)] shadow-[inset_1px_1px_0_var(--mc-25),inset_-1px_-1px_0_var(--mc-100)]">
        <ResourceIcon
          resource={{ ...resource, amount: 1, chance: undefined }}
          size="sm"
          bare
          showAmount={false}
          tooltip={false}
          className="!h-full !w-full"
          iconPixelSize={machineArtPixels(24)}
        />
      </span>
      <span className="min-w-0 flex-1 truncate text-[12px] font-bold text-[var(--mc-ink)]">
        {resource.displayName ?? resource.id}
      </span>
      <span className="shrink-0 text-[11px] text-[var(--mc-ink-muted)] tabular-nums">
        {amountText}
      </span>
      {chance !== undefined && chance < 1 ? (
        <span className="text-[10px] text-[var(--mc-ink-muted)] tabular-nums">
          {Math.round(chance * 1000) / 10}%
        </span>
      ) : null}
    </button>
  );
}

/**
 * An oredict slot wears its first concrete face: the chip is a thing you can
 * click, not the dictionary's internal name.
 */
function chipFaceResource<T extends ResourceAmount>(resource: T): T {
  const face = isOreDictionaryResource(resource) ? resource.alternatives?.[0] : undefined;
  if (!face) {
    return resource;
  }
  return {
    ...resource,
    kind: face.kind,
    id: face.id,
    displayName: face.displayName ?? resource.displayName,
    iconPath: face.iconPath ?? resource.iconPath,
    iconAtlas: face.iconAtlas ?? resource.iconAtlas,
    dominantColor: face.dominantColor ?? face.iconAtlas?.dominantColor ?? resource.dominantColor,
  };
}

/**
 * Crafting-grid recipes list one entry per slot; the same item nine times is
 * one line saying ×9. Non-consumed entries and chanced outputs keep their own
 * lines, because merging those would change what the numbers mean.
 */
function mergeChipResources<T extends ResourceAmount & { consumed?: boolean; chance?: number }>(
  resources: T[],
): T[] {
  const merged = new Map<string, T>();
  for (const raw of resources) {
    const resource = chipFaceResource(raw);
    const key = [
      resource.kind,
      resource.id,
      resource.consumed === false ? "nc" : "c",
      resource.chance ?? 1,
    ].join("|");
    const existing = merged.get(key);
    if (existing) {
      merged.set(key, { ...existing, amount: existing.amount + resource.amount });
    } else {
      merged.set(key, resource);
    }
  }
  return [...merged.values()];
}

function clauseMatchesInput(clause: StencilClause, input: ResourceAmount): boolean {
  if (clause.kind !== input.kind) {
    return false;
  }
  return (
    clause.id === input.id || resourceMatchesInput({ kind: clause.kind, id: clause.id }, input)
  );
}

function clauseMatchesOutput(clause: StencilClause, output: ResourceAmount): boolean {
  if (clause.kind !== output.kind) {
    return false;
  }
  return (
    clause.id === output.id ||
    (output.alternatives?.some(
      (alternative) => alternative.kind === clause.kind && alternative.id === clause.id,
    ) ??
      false)
  );
}

function formatChipAmount(resource: ResourceAmount): string {
  if (resource.kind === "fluid") {
    return `${resource.amount.toLocaleString()} L`;
  }
  return `×${resource.amount.toLocaleString()}`;
}

/** "take Iron Dust or Coal Dust and make Steel Ingot", or "" with no conditions. */
function stencilSentence(
  takesClauses: StencilClause[],
  makesClauses: StencilClause[],
  takesOp: RecipeQuerySideOp,
  makesOp: RecipeQuerySideOp,
  singular: boolean,
): string {
  const nameOf = (clause: StencilClause) => clause.displayName ?? clause.id;
  const joinSide = (clauses: StencilClause[], op: RecipeQuerySideOp) =>
    clauses.map(nameOf).join(op === "all" ? " and " : " or ");
  const parts: string[] = [];
  if (takesClauses.length > 0) {
    parts.push(`${singular ? "takes" : "take"} ${joinSide(takesClauses, takesOp)}`);
  }
  if (makesClauses.length > 0) {
    parts.push(`${singular ? "makes" : "make"} ${joinSide(makesClauses, makesOp)}`);
  }
  return parts.join(" and ");
}

/**
 * How much room the search has, and what shape it should take. Read on every
 * resize, and on the board's own columns changing size, because the overlay
 * steps around them while there is room to.
 */
const BOARD_SIDEBAR_LEFT = 306;
const BOARD_SIDEBAR_RIGHT = 330;
const RECIPE_SEARCH_MIN_WIDTH = 640;
const RECIPE_SEARCH_MAX_WIDTH = 1520;
const RECIPE_SEARCH_MAX_HEIGHT = 900;
const RECIPE_SEARCH_COMFORTABLE_WIDTH = 1080;
const RECIPE_SEARCH_SHEET_BELOW = 700;
const ZERO_OFFSET = { x: 0, y: 0 };

interface RecipeSearchViewport {
  /** Filling the screen rather than floating over the board. */
  sheet: boolean;
  dodgesSidebars: boolean;
  width: number;
  height: number;
  /** Measured, not assumed: these columns can be collapsed. */
  sidebars: { left: number; right: number };
}

function measureBoardSidebars(): { left: number; right: number } {
  if (typeof document === "undefined") {
    return { left: BOARD_SIDEBAR_LEFT, right: BOARD_SIDEBAR_RIGHT };
  }

  const width = (selector: string, fallback: number) => {
    const element = document.querySelector(selector);
    return element ? Math.round(element.getBoundingClientRect().width) : fallback;
  };

  return {
    left: width('aside[data-help-anchor="browser"]', BOARD_SIDEBAR_LEFT),
    right: width('aside[data-help-anchor="inspector"]', BOARD_SIDEBAR_RIGHT),
  };
}

function readRecipeSearchViewport(): RecipeSearchViewport {
  if (typeof window === "undefined") {
    return {
      sheet: false,
      dodgesSidebars: true,
      width: 960,
      height: 760,
      sidebars: { left: BOARD_SIDEBAR_LEFT, right: BOARD_SIDEBAR_RIGHT },
    };
  }

  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const sidebars = measureBoardSidebars();

  // Too narrow to be a window at all: fill the screen instead of leaving a
  // panel that is mostly margin.
  if (viewportWidth < RECIPE_SEARCH_SHEET_BELOW) {
    return {
      sheet: true,
      dodgesSidebars: false,
      width: viewportWidth,
      height: viewportHeight,
      sidebars,
    };
  }

  // The board's own sidebars are worth keeping in view, but only while
  // stepping around them still leaves the search a comfortable size. Below
  // that it covers them, which is the lesser loss.
  const besideSidebars = viewportWidth - sidebars.left - sidebars.right - 24;
  const dodgesSidebars = besideSidebars >= RECIPE_SEARCH_COMFORTABLE_WIDTH;
  const available = dodgesSidebars ? besideSidebars : viewportWidth - 24;

  return {
    sheet: false,
    dodgesSidebars,
    width: Math.min(RECIPE_SEARCH_MAX_WIDTH, Math.max(RECIPE_SEARCH_MIN_WIDTH, available)),
    height: Math.min(RECIPE_SEARCH_MAX_HEIGHT, Math.max(360, viewportHeight - 32)),
    sidebars,
  };
}

function useRecipeSearchViewport(): RecipeSearchViewport {
  const [viewport, setViewport] = useState(readRecipeSearchViewport);

  useEffect(() => {
    const update = () => setViewport(readRecipeSearchViewport());

    window.addEventListener("resize", update);
    // Hiding a column is not a window resize, and the search has to give back
    // the room either way.
    const observer = new ResizeObserver(update);
    for (const selector of [
      'aside[data-help-anchor="browser"]',
      'aside[data-help-anchor="inspector"]',
    ]) {
      const element = document.querySelector(selector);
      if (element) {
        observer.observe(element);
      }
    }

    return () => {
      window.removeEventListener("resize", update);
      observer.disconnect();
    };
  }, []);

  return viewport;
}

function clampDragOffset(offset: { x: number; y: number }, panel: HTMLElement | null) {
  if (!panel || typeof window === "undefined") {
    return offset;
  }

  const rect = panel.getBoundingClientRect();
  const margin = 12;
  const maxX = Math.max(0, (window.innerWidth - rect.width) / 2 - margin);
  const maxY = Math.max(0, (window.innerHeight - rect.height) / 2 - margin);

  return {
    x: Math.min(maxX, Math.max(-maxX, offset.x)),
    y: Math.min(maxY, Math.max(-maxY, offset.y)),
  };
}
