"use client";

import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { memo, useState, type CSSProperties } from "react";
import { Copy, Maximize2, PackageOpen, Save } from "lucide-react";
import type { FactoryPocket } from "@/lib/model/types";
import { RECIPE_NODE_WIDTH } from "@/lib/board-grid";
import { fluidArtPixels, isSwatchFluid, ResourceIcon } from "@/components/nei/ResourceIcon";
import { captureBoardSelection, useFactoryStore } from "@/store/factory-store";
import { useBlueprintStore } from "@/store/blueprint-store";

import { formatSlotRateOrNull } from "./flow-explainers";
import { isWiringConnection, wasRecentWireDrop } from "./connection-drag";
import { useBoardView } from "./board-view";
import { NodeGlanceText } from "./NodeGlance";
import { POCKET_CARD_MAX_ROWS, type PocketCrossing, type PocketSummary } from "./pocket-summary";
import { GT_NODE_RAMPS } from "./node-colors";

export interface PocketNodeData extends Record<string, unknown> {
  pocket: FactoryPocket;
  summary?: PocketSummary;
}

export type PocketFlowNode = Node<PocketNodeData, "pocketNode">;

/**
 * A MINIMIZED BOARD: a summary you can look at, not a machine you can wire.
 *
 * It says what is inside (machines, cards, power) and what crosses its
 * border, and that is all it says. There are no ports on it: a wire from the
 * outside cannot be dropped on it, a drag cannot start from it, and nothing
 * on it claims to be starved or clogged. To change anything about the
 * factory in here you open the window - double-click, or the restore button.
 *
 * That is a deliberate retreat. The card used to wear input and output
 * ports built from a solve of the members with the outside world unhooked,
 * which meant a board holding its own source was told it was starving and a
 * board exporting a byproduct was told it was clogged. The numbers here now
 * come from the plan-wide solve, so they are the same numbers the board
 * itself would show with the window open.
 *
 * The wires crossing the border still land on the card - they have to go
 * somewhere - but they dock anywhere on its perimeter, like a drawer's, not
 * on a row that means something.
 */
export const POCKET_NODE_WIDTH = RECIPE_NODE_WIDTH;

/**
 * The inert anchors every crossing wire lands on. React Flow needs an
 * endpoint handle to exist for an edge to render at all; these have no size,
 * take no pointer, and mean nothing beyond "the wire ends at this card".
 */
export const POCKET_CARD_TARGET_HANDLE = "board-card-in";
export const POCKET_CARD_SOURCE_HANDLE = "board-card-out";

/** The purple ink pair: names in white, figures a step down. */
const INK_MUTED = "text-[#c9b8ec]";

const INERT_HANDLE =
  "nodrag !pointer-events-none !h-0 !w-0 !min-h-0 !min-w-0 !border-0 !bg-transparent !opacity-0";

function PocketNodeComponent({ data, selected }: NodeProps<PocketFlowNode>) {
  const { pocket, summary } = data;
  const expandPocket = useFactoryStore((state) => state.expandPocket);
  const dissolvePocket = useFactoryStore((state) => state.dissolvePocket);
  const renamePocket = useFactoryStore((state) => state.renamePocket);
  const deleteBoardSelection = useFactoryStore((state) => state.deleteBoardSelection);
  const [draftName, setDraftName] = useState<string | undefined>(undefined);
  // Presentation mode: the head row loses its edit chrome, exactly as a
  // machine card's does. A rename half-typed when the mode flips goes back to
  // being a plain name bar rather than stranding an input on a calm board.
  const { calmMode } = useBoardView();
  const isRenaming = draftName !== undefined && !calmMode;

  const incoming = summary?.incoming ?? [];
  const outgoing = summary?.outgoing ?? [];
  const shownIncoming = incoming.slice(0, POCKET_CARD_MAX_ROWS);
  const shownOutgoing = outgoing.slice(0, POCKET_CARD_MAX_ROWS);
  const hiddenIncoming = incoming.length - shownIncoming.length;
  const hiddenOutgoing = outgoing.length - shownOutgoing.length;
  const hasCrossings = incoming.length > 0 || outgoing.length > 0;

  // Pointing at a resource in the right-hand panel lights every card that
  // touches it. A minimized board touches one whenever it crosses the
  // border, so it lights on the same terms as a machine card.
  const hoveredFlowResourceKey = useFactoryStore((state) => state.hoveredFlowResourceKey);
  const selectedFlowResourceKey = useFactoryStore((state) => state.selectedFlowResourceKey);
  const litResourceKey = hoveredFlowResourceKey ?? selectedFlowResourceKey;
  const isResourceHighlighted =
    litResourceKey !== undefined &&
    [...incoming, ...outgoing].some((crossing) => crossing.key === litResourceKey);

  const commitRename = () => {
    if (draftName !== undefined) {
      renamePocket(pocket.id, draftName);
    }
    setDraftName(undefined);
  };

  // Clone the whole board — the frame, every member, every internal
  // wire — through the same capture/paste path Ctrl+C/Ctrl+V uses, so the
  // copy lands beside the original, selected and ready to drag.
  const duplicatePocket = () => {
    const state = useFactoryStore.getState();
    const payload = captureBoardSelection(state.project, [pocket.id]);
    if (!payload) {
      return;
    }
    const pastedIds = state.pasteBoardItems(payload, { x: POCKET_NODE_WIDTH + 40, y: 0 });
    if (pastedIds.length > 0) {
      state.setPendingBoardSelection(pastedIds);
    }
  };

  // Shelve the whole board: the save dialog opens
  // prefilled with the board's name and stat card, plus an icon to pick.
  const saveAsBlueprint = () => {
    const payload = captureBoardSelection(useFactoryStore.getState().project, [pocket.id]);
    if (payload) {
      useBlueprintStore.getState().setSaveRequest({ payload, name: pocket.name });
    }
  };

  return (
    <div
      className={[
        "group relative font-mono text-white",
        selected ? "ring-2 ring-purple-500" : "",
        // On the shell, exactly where a machine card wears it, so the outline
        // frames the whole board rather than its inner window.
        isResourceHighlighted ? "resource-glow" : "",
      ].join(" ")}
      style={{ width: POCKET_NODE_WIDTH }}
      onDoubleClick={(event) => {
        // The name field manages its own double-click, the buttons are their
        // own controls, and the mouseup that lands a wire must never read as
        // "open the window".
        if (isWiringConnection() || wasRecentWireDrop()) {
          return;
        }
        const target = event.target as HTMLElement;
        if (!target.closest("input, button")) {
          expandPocket(pocket.id);
        }
      }}
    >
      {/* Where the crossing wires end. Inert on purpose: a minimized board
          is not a wiring surface. */}
      <Handle
        id={POCKET_CARD_TARGET_HANDLE}
        type="target"
        position={Position.Left}
        isConnectable={false}
        className={INERT_HANDLE}
      />
      <Handle
        id={POCKET_CARD_SOURCE_HANDLE}
        type="source"
        position={Position.Right}
        isConnectable={false}
        className={INERT_HANDLE}
      />
      {/* The window: same inset-frame construction as a recipe card (a real
          border would push the rows off the grid), painted star-field purple. */}
      <div
        data-node-glance-root=""
        // Painted like a colour-tagged machine card: the purple ramp is
        // declared here, so everything the card borrows arrives purple
        // instead of board grey. The bright bevels and the head buttons are
        // the board's own identity and stay hand-painted.
        className="relative bg-[#3b2d52] shadow-[inset_0_0_0_2px_#241b33,inset_4px_4px_0_#5e4a85,inset_-4px_-4px_0_#1a1326]"
        style={GT_NODE_RAMPS.purple as CSSProperties}
      >
        {/* Zoomed out, the card is a star on purple — a board, not a machine.
            Hovering opens the same reveal a machine card gives. */}
        <NodeGlanceText text="✦" className={INK_MUTED} />
        <PocketGlanceReveal name={pocket.name} incoming={incoming} outgoing={outgoing} />
        <div className="px-2">
          {/* One head row, exactly two cells tall, like every machine card:
              delete/clone on the left like every card's edit chrome, the
              name in the middle, shelve, dump and restore on the right —
              restore rightmost, where a window keeps it. Calm mode drops all
              five and gives the whole row to the name. */}
          <div
            className={[
              "grid h-[40px] min-w-0 items-center gap-1",
              calmMode
                ? "grid-cols-[minmax(0,1fr)]"
                : "grid-cols-[24px_24px_minmax(0,1fr)_24px_24px_24px]",
            ].join(" ")}
          >
            {!calmMode ? (
              <>
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    deleteBoardSelection({ nodeIds: [pocket.id] });
                  }}
                  className="nodrag flex h-6 w-6 items-center justify-center border-2 border-[#241b33] bg-[#5e4a85] text-white shadow-[inset_2px_2px_0_#8d6fd1,inset_-2px_-2px_0_#2b2140] hover:bg-red-700"
                  title="Delete this board (everything inside goes with it)"
                  aria-label={`Delete board ${pocket.name}`}
                >
                  {/* Drawn rather than a "-" glyph: at this size Monocraft's
                      metrics baseline-align the hyphen low instead of centring. */}
                  <span aria-hidden className="block h-[2px] w-[8px] bg-white" />
                </button>
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    duplicatePocket();
                  }}
                  className="nodrag flex h-6 w-6 items-center justify-center border-2 border-[#241b33] bg-[#5e4a85] text-white shadow-[inset_2px_2px_0_#8d6fd1,inset_-2px_-2px_0_#2b2140] hover:bg-[#8d6fd1]"
                  title="Clone this board (everything inside comes along)"
                  aria-label={`Clone board ${pocket.name}`}
                >
                  <Copy aria-hidden className="h-3.5 w-3.5" />
                </button>
              </>
            ) : null}
            {!isRenaming ? (
              <div
                className="minecraft-title flex h-6 min-w-0 items-center border-2 border-[#241b33] bg-[#5e4a85] px-2 text-[13px] leading-[18px] shadow-[inset_2px_2px_0_#8d6fd1,inset_-2px_-2px_0_#2b2140]"
                title={
                  calmMode
                    ? `${pocket.name} (double-click the card to open the window)`
                    : `${pocket.name} (double-click the name to rename, double-click the card to open the window)`
                }
                onDoubleClick={
                  // Renaming is editing, so calm mode lets the double-click
                  // fall through to the card and just open the window.
                  calmMode
                    ? undefined
                    : (event) => {
                        event.stopPropagation();
                        setDraftName(pocket.name);
                      }
                }
              >
                <span className="mx-auto min-w-0 truncate">✦ {pocket.name}</span>
              </div>
            ) : (
              <input
                autoFocus
                value={draftName}
                onChange={(event) => setDraftName(event.target.value)}
                onBlur={commitRename}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    commitRename();
                  }
                  if (event.key === "Escape") {
                    setDraftName(undefined);
                  }
                  event.stopPropagation();
                }}
                className="nodrag h-6 min-w-0 border-2 border-[#8d6fd1] bg-[#241b33] px-1 text-[13px] leading-none text-white outline-none"
              />
            )}
            {!calmMode ? (
              <>
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    saveAsBlueprint();
                  }}
                  className="nodrag flex h-6 w-6 items-center justify-center border-2 border-[#241b33] bg-[#5e4a85] text-white shadow-[inset_2px_2px_0_#8d6fd1,inset_-2px_-2px_0_#2b2140] hover:bg-[#8d6fd1]"
                  title={`Save "${pocket.name}" to my shelf (sign in required)`}
                  aria-label={`Save board ${pocket.name} to my shelf`}
                >
                  <Save aria-hidden className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    dissolvePocket(pocket.id);
                  }}
                  className="nodrag flex h-6 w-6 items-center justify-center border-2 border-[#241b33] bg-[#5e4a85] text-white shadow-[inset_2px_2px_0_#8d6fd1,inset_-2px_-2px_0_#2b2140] hover:bg-[#8d6fd1]"
                  title="Dump this board: the frame goes, the cards come back where they were"
                  aria-label={`Dump board ${pocket.name}`}
                >
                  <PackageOpen aria-hidden className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    expandPocket(pocket.id);
                  }}
                  className="nodrag flex h-6 w-6 items-center justify-center border-2 border-[#241b33] bg-[#5e4a85] text-white shadow-[inset_2px_2px_0_#8d6fd1,inset_-2px_-2px_0_#2b2140] hover:bg-[#8d6fd1]"
                  title="Open the window (or double-click the card)"
                  aria-label={`Open board ${pocket.name}`}
                >
                  <Maximize2 aria-hidden className="h-3.5 w-3.5" />
                </button>
              </>
            ) : null}
          </div>

          {/* What crosses the border, and which way. Reading only: no ports,
              nothing to grab, nothing to drop a wire on. */}
          {!hasCrossings ? (
            <div
              className={`flex h-[80px] items-center justify-center text-center text-[11px] leading-4 ${INK_MUTED}`}
            >
              Nothing crosses the border.
              <br />
              Open the window to work on it.
            </div>
          ) : (
            <>
              <div
                className={`grid h-[20px] grid-cols-2 items-center gap-2 text-[10px] leading-3 ${INK_MUTED}`}
              >
                <span>{incoming.length > 0 ? "COMING IN" : ""}</span>
                <span className="text-right">{outgoing.length > 0 ? "GOING OUT" : ""}</span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="flex min-w-0 flex-col">
                  {shownIncoming.map((crossing) => (
                    <CrossingRow key={crossing.key} crossing={crossing} side="in" />
                  ))}
                  {hiddenIncoming > 0 ? <MoreRow count={hiddenIncoming} side="in" /> : null}
                </div>
                <div className="flex min-w-0 flex-col">
                  {shownOutgoing.map((crossing) => (
                    <CrossingRow key={crossing.key} crossing={crossing} side="out" />
                  ))}
                  {hiddenOutgoing > 0 ? <MoreRow count={hiddenOutgoing} side="out" /> : null}
                </div>
              </div>
            </>
          )}

          {/* What is inside, in one line. */}
          <div
            className={`flex h-[40px] min-w-0 items-center justify-center gap-2 border-t border-[#5e4a85] text-[11px] leading-4 ${INK_MUTED}`}
          >
            <span className="truncate">
              {summary
                ? [
                    `${summary.machineCount}× ${summary.machineCount === 1 ? "machine" : "machines"}`,
                    `${summary.memberCount} ${summary.memberCount === 1 ? "card" : "cards"}`,
                    summary.euPerTick > 0
                      ? `${Math.round(summary.euPerTick).toLocaleString()} EU/t`
                      : undefined,
                  ]
                    .filter(Boolean)
                    .join(" · ")
                : "minimized board"}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * One resource crossing the border: its icon, its name, and what is really
 * moving. Two cells tall, like a machine card's port row, so the card stays
 * on the grid — but it is a line of text, not a port.
 */
function CrossingRow({ crossing, side }: { crossing: PocketCrossing; side: "in" | "out" }) {
  const rate = formatSlotRateOrNull(crossing.ratePerSecond, crossing.kind);
  const icon = (
    <span className="flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden">
      <ResourceIcon
        resource={{ ...crossing, id: crossing.resourceId, amount: 1 }}
        bare
        tooltip={false}
        showAmount={false}
        iconPixelSize={
          crossing.kind === "fluid"
            ? isSwatchFluid(crossing)
              ? 32
              : fluidArtPixels(24)
            : undefined
        }
        className={crossing.kind === "fluid" ? "!h-6 !w-6" : "!h-6 !w-6 origin-center scale-150"}
      />
    </span>
  );
  const text = (
    <span className={`flex min-w-0 flex-1 flex-col ${side === "out" ? "text-right" : ""}`}>
      <span className="truncate text-[11px] font-bold leading-[14px] text-white">
        {crossing.displayName ?? crossing.resourceId}
      </span>
      <span className={`truncate text-[10px] leading-[12px] tabular-nums ${INK_MUTED}`}>
        {rate ?? "0/s"}
        {crossing.wireCount > 1 ? ` · ${crossing.wireCount} wires` : ""}
      </span>
    </span>
  );
  return (
    <span
      className="flex h-[40px] min-w-0 items-center gap-1"
      title={`${crossing.displayName ?? crossing.resourceId}: ${rate ?? "nothing moving"}`}
    >
      {side === "in" ? (
        <>
          {icon}
          {text}
        </>
      ) : (
        <>
          {text}
          {icon}
        </>
      )}
    </span>
  );
}

/** The overflow line: a long border list stops rather than growing forever. */
function MoreRow({ count, side }: { count: number; side: "in" | "out" }) {
  return (
    <span
      className={[
        "flex h-[40px] min-w-0 items-center text-[10px] leading-3",
        INK_MUTED,
        side === "out" ? "justify-end" : "",
      ].join(" ")}
    >
      and {count} more
    </span>
  );
}

// Position props change every drag frame; the component only reads `data` and
// `selected`, so comparing exactly those keeps the card from re-rendering while
// its wrapper is translated (see RecipeNode for the long version).
export const PocketNode = memo(
  PocketNodeComponent,
  (previous, next) => previous.data === next.data && previous.selected === next.selected,
);

/**
 * The zoomed-out hover reveal: the same summary at screen size. Pure CSS
 * shows it (globals.css `.glance-io`) only at the glance detail level on
 * hover — the panel is in the DOM from the start, so hovering never rebuilds
 * the board. `absolute inset-0` like every glance layer: no say in the
 * card's size, invisible to the router.
 */
function PocketGlanceReveal({
  name,
  incoming,
  outgoing,
}: {
  name: string;
  incoming: PocketCrossing[];
  outgoing: PocketCrossing[];
}) {
  return (
    <div
      data-node-detail="glance"
      aria-hidden
      className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center"
    >
      <span className="glance-io absolute left-1/2 top-full z-30 w-[560px] origin-top flex-col gap-2 border-2 border-[#241b33] bg-[#3b2d52] p-3 font-mono text-white shadow-[8px_8px_0_rgba(0,0,0,0.55)]">
        <span className="minecraft-title flex h-8 min-w-0 items-center border-2 border-[#241b33] bg-[#5e4a85] px-2 text-[16px] leading-[22px] shadow-[inset_2px_2px_0_#8d6fd1,inset_-2px_-2px_0_#2b2140]">
          <span className="mx-auto min-w-0 truncate">✦ {name}</span>
        </span>
        {incoming.length > 0 || outgoing.length > 0 ? (
          <span className="grid grid-cols-[minmax(0,1fr)_24px_minmax(0,1fr)] items-start gap-x-1">
            <span className="flex min-w-0 flex-col gap-1">
              {incoming.map((crossing) => (
                <PocketGlanceIoRow key={crossing.key} crossing={crossing} />
              ))}
            </span>
            <span
              className={`flex items-start justify-center pt-2 text-[20px] font-black leading-6 ${INK_MUTED}`}
            >
              →
            </span>
            <span className="flex min-w-0 flex-col gap-1">
              {outgoing.map((crossing) => (
                <PocketGlanceIoRow key={crossing.key} crossing={crossing} />
              ))}
            </span>
          </span>
        ) : (
          <span className={`text-center text-[13px] ${INK_MUTED}`}>
            Nothing crosses the border.
          </span>
        )}
      </span>
    </div>
  );
}

/** One line of the reveal, in the board's own clothes. */
function PocketGlanceIoRow({ crossing }: { crossing: PocketCrossing }) {
  const rate = formatSlotRateOrNull(crossing.ratePerSecond, crossing.kind);
  return (
    <span className="pocket-port flex items-center gap-1.5 px-1 py-0.5">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden">
        <ResourceIcon
          resource={{ ...crossing, id: crossing.resourceId, amount: 1 }}
          bare
          tooltip={false}
          showAmount={false}
          iconPixelSize={
            crossing.kind === "fluid"
              ? isSwatchFluid(crossing)
                ? 50
                : fluidArtPixels(36)
              : undefined
          }
          className={crossing.kind === "fluid" ? "!h-9 !w-9" : "!h-9 !w-9 origin-center scale-150"}
        />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[14px] font-bold leading-[17px] text-white">
          {crossing.displayName ?? crossing.resourceId}
        </span>
        {rate ? (
          <span className={`truncate text-[13px] leading-4 tabular-nums ${INK_MUTED}`}>{rate}</span>
        ) : null}
      </span>
    </span>
  );
}
