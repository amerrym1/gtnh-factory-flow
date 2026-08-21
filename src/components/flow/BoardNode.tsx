"use client";

import { type Node, type NodeProps, useReactFlow } from "@xyflow/react";
import { memo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Copy, Minimize2, Save } from "lucide-react";
import type { FactoryNodeColorTag, FactoryPocket } from "@/lib/model/types";
import { boardWindowSize } from "@/lib/model/board-windows";
import {
  BOARD_WINDOW_FIT_PAD,
  BOARD_WINDOW_MIN_HEIGHT,
  BOARD_WINDOW_MIN_WIDTH,
} from "@/lib/board-grid";
import { captureBoardSelection, useFactoryStore } from "@/store/factory-store";
import { useBlueprintStore } from "@/store/blueprint-store";
import { useBoardView } from "./board-view";
import { GT_NODE_COLORS } from "./node-colors";

/**
 * A board standing OPEN: a window frame whose members render as ordinary
 * cards INSIDE it (React Flow children of this node). This component draws
 * only the chrome — a title bar that drags the whole household and carries
 * the board's actions, a wash for a floor, and a corner grip. Wires pass
 * through the frame only when they belong to it; see the router exemptions.
 *
 * The floor is paintable: the board's `colorTag` (set with the paint tool,
 * like any card) recolours the wash, the frame line and the bar. Untagged
 * boards wear the house purple, the same family the minimized card wears.
 */

/** The title bar is the only place a drag can grab the frame. */
export const BOARD_DRAG_HANDLE_CLASS = "board-window-grab";

export interface BoardNodeData extends Record<string, unknown> {
  pocket: FactoryPocket;
  /** Direct members in the frame: cards, drawers, ink, nested boards. */
  memberCount: number;
}

export type BoardWindowFlowNode = Node<BoardNodeData, "boardNode">;

interface BoardChrome {
  barBg: string;
  barBevelHi: string;
  barBevelLo: string;
  barBorder: string;
  nameBg: string;
  ink: string;
  inkMuted: string;
  washFill: string;
  frameLine: string;
  grip: string;
}

/** The untagged look: the purple family the minimized card wears. */
const DEFAULT_CHROME: BoardChrome = {
  barBg: "#3b2d52",
  barBevelHi: "#5e4a85",
  barBevelLo: "#1a1326",
  barBorder: "#241b33",
  nameBg: "#5e4a85",
  ink: "#ffffff",
  inkMuted: "#c9b8ec",
  washFill: "rgba(59, 45, 82, 0.15)",
  frameLine: "#5e4a85",
  grip: "#8d6fd1",
};

/** Rough luminance of a #rrggbb colour, for picking readable ink. */
function isLightColor(hex: string): boolean {
  const value = hex.replace("#", "");
  if (value.length < 6) {
    return false;
  }
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return 0.299 * r + 0.587 * g + 0.114 * b > 150;
}

function chromeFor(colorTag: FactoryNodeColorTag | undefined): BoardChrome {
  if (!colorTag) {
    return DEFAULT_CHROME;
  }
  const paint = GT_NODE_COLORS[colorTag];
  if (!paint) {
    return DEFAULT_CHROME;
  }
  const ink = isLightColor(paint.header) ? "#1b1d21" : "#ffffff";
  return {
    barBg: paint.header,
    barBevelHi: paint.panel,
    barBevelLo: paint.border,
    barBorder: paint.border,
    nameBg: paint.panel,
    ink,
    inkMuted: ink === "#ffffff" ? "rgba(255, 255, 255, 0.75)" : "rgba(27, 29, 33, 0.75)",
    // A wash, not a paint bucket: ~13% of the swatch over the canvas.
    washFill: `${paint.swatch}22`,
    frameLine: paint.border,
    grip: paint.swatch,
  };
}

function BoardNodeComponent({ data, width, height }: NodeProps<BoardWindowFlowNode>) {
  const { pocket, memberCount } = data;
  const minimizePocket = useFactoryStore((state) => state.minimizePocket);
  const renamePocket = useFactoryStore((state) => state.renamePocket);
  const setPocketSize = useFactoryStore((state) => state.setPocketSize);
  const deleteBoardSelection = useFactoryStore((state) => state.deleteBoardSelection);
  const { calmMode } = useBoardView();
  const { getZoom, getNodes } = useReactFlow();
  const [draftName, setDraftName] = useState<string | undefined>(undefined);
  const isRenaming = draftName !== undefined && !calmMode;
  const chrome = chromeFor(pocket.colorTag);

  // A resize follows the pointer live through local state and lands in the
  // store once, on release — where it snaps to whole cells. Same commit
  // discipline as an annotation's NodeResizer.
  const [draftSize, setDraftSizeState] = useState<
    { width: number; height: number } | undefined
  >(undefined);
  const draftSizeRef = useRef<{ width: number; height: number } | undefined>(undefined);
  const setDraftSize = (size: { width: number; height: number } | undefined) => {
    draftSizeRef.current = size;
    setDraftSizeState(size);
  };

  const storedSize = boardWindowSize(pocket);
  const frameWidth = draftSize?.width ?? width ?? storedSize.width;
  const frameHeight = draftSize?.height ?? height ?? storedSize.height;

  const commitRename = () => {
    if (draftName !== undefined) {
      renamePocket(pocket.id, draftName);
    }
    setDraftName(undefined);
  };

  // Clone the whole board — the frame, every member, every internal wire —
  // through the same capture/paste path Ctrl+C/Ctrl+V uses, so the copy
  // lands beside the original.
  const duplicateBoard = () => {
    const state = useFactoryStore.getState();
    const payload = captureBoardSelection(state.project, [pocket.id]);
    if (!payload) {
      return;
    }
    const pastedIds = state.pasteBoardItems(payload, { x: frameWidth + 40, y: 0 });
    if (pastedIds.length > 0) {
      state.setPendingBoardSelection(pastedIds);
    }
  };

  // Shelve the whole board: the save dialog opens prefilled with its name.
  const saveAsBlueprint = () => {
    const payload = captureBoardSelection(useFactoryStore.getState().project, [pocket.id]);
    if (payload) {
      useBlueprintStore.getState().setSaveRequest({ payload, name: pocket.name });
    }
  };

  const beginResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const startClient = { x: event.clientX, y: event.clientY };
    const startSize = { width: frameWidth, height: frameHeight };
    // The frame must contain what is on it: the floor of a resize is the
    // members' extent plus a cell of air, measured once at grab time from
    // React Flow's own child geometry (member positions are frame-relative).
    let minWidth = BOARD_WINDOW_MIN_WIDTH;
    let minHeight = BOARD_WINDOW_MIN_HEIGHT;
    for (const child of getNodes()) {
      if (child.parentId !== pocket.id) {
        continue;
      }
      const childWidth = child.measured?.width ?? child.width ?? 0;
      const childHeight = child.measured?.height ?? child.height ?? 0;
      minWidth = Math.max(minWidth, child.position.x + childWidth + BOARD_WINDOW_FIT_PAD);
      minHeight = Math.max(minHeight, child.position.y + childHeight + BOARD_WINDOW_FIT_PAD);
    }
    const handleMove = (move: PointerEvent) => {
      const zoom = getZoom() || 1;
      setDraftSize({
        width: Math.max(minWidth, startSize.width + (move.clientX - startClient.x) / zoom),
        height: Math.max(minHeight, startSize.height + (move.clientY - startClient.y) / zoom),
      });
    };
    const handleUp = () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
      const draft = draftSizeRef.current;
      setDraftSize(undefined);
      if (draft) {
        setPocketSize(pocket.id, draft);
      }
    };
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
  };

  const buttonStyle = {
    borderColor: chrome.barBorder,
    backgroundColor: chrome.nameBg,
    color: chrome.ink,
    boxShadow: `inset 2px 2px 0 ${chrome.barBevelHi}, inset -2px -2px 0 ${chrome.barBevelLo}`,
  };

  return (
    <div
      className="relative font-mono"
      style={{ width: frameWidth, height: frameHeight, color: chrome.ink }}
    >
      {/* The floor: the board's own background, painted by its colour tag.
          Clicks fall through to the pane, so panning and marquee selection
          work over the floor exactly as they do over bare canvas. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundColor: chrome.washFill,
          boxShadow: `inset 0 0 0 2px ${chrome.frameLine}`,
        }}
      />
      {/* The title bar: the window's one handle. Dragging it moves the board
          and every member with it. */}
      <div
        className={[
          BOARD_DRAG_HANDLE_CLASS,
          "absolute inset-x-0 top-0 flex h-[40px] cursor-grab items-center gap-1 border-2 px-2",
        ].join(" ")}
        style={{
          pointerEvents: "all",
          backgroundColor: chrome.barBg,
          borderColor: chrome.barBorder,
          boxShadow: `inset 2px 2px 0 ${chrome.barBevelHi}, inset -2px -2px 0 ${chrome.barBevelLo}`,
        }}
        title={
          calmMode
            ? `${pocket.name} (drag to move the board and everything on it)`
            : `${pocket.name} (drag to move the board and everything on it, double-click the name to rename)`
        }
      >
        {!calmMode && !isRenaming ? (
          <>
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                deleteBoardSelection({ nodeIds: [pocket.id] });
              }}
              className="nodrag flex h-6 w-6 shrink-0 items-center justify-center border-2 hover:!bg-red-700 hover:!text-white"
              style={buttonStyle}
              title="Delete this board (everything inside goes with it)"
              aria-label={`Delete board ${pocket.name}`}
            >
              {/* Drawn rather than a "-" glyph: at this size Monocraft's
                  metrics baseline-align the hyphen low instead of centring. */}
              <span aria-hidden className="block h-[2px] w-[8px]" style={{ backgroundColor: chrome.ink }} />
            </button>
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                duplicateBoard();
              }}
              className="nodrag flex h-6 w-6 shrink-0 items-center justify-center border-2 hover:brightness-125"
              style={buttonStyle}
              title="Clone this board (everything inside comes along)"
              aria-label={`Clone board ${pocket.name}`}
            >
              <Copy aria-hidden className="h-3.5 w-3.5" />
            </button>
          </>
        ) : null}
        {!isRenaming ? (
          <div
            className="minecraft-title flex h-6 min-w-0 flex-1 items-center border-2 px-2 text-[13px] leading-[18px]"
            style={{
              backgroundColor: chrome.nameBg,
              borderColor: chrome.barBorder,
              boxShadow: `inset 2px 2px 0 ${chrome.barBevelHi}, inset -2px -2px 0 ${chrome.barBevelLo}`,
            }}
            onDoubleClick={
              calmMode
                ? undefined
                : (event) => {
                    event.stopPropagation();
                    setDraftName(pocket.name);
                  }
            }
          >
            <span className="min-w-0 truncate">✦ {pocket.name}</span>
            <span className="ml-auto shrink-0 pl-2 text-[11px]" style={{ color: chrome.inkMuted }}>
              {memberCount} {memberCount === 1 ? "card" : "cards"}
            </span>
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
            className="nodrag h-6 min-w-0 flex-1 border-2 border-[#8d6fd1] bg-[#241b33] px-1 text-[13px] leading-none text-white outline-none"
          />
        )}
        {!calmMode && !isRenaming ? (
          <>
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                saveAsBlueprint();
              }}
              className="nodrag flex h-6 w-6 shrink-0 items-center justify-center border-2 hover:brightness-125"
              style={buttonStyle}
              title={`Save "${pocket.name}" to my shelf (sign in required)`}
              aria-label={`Save board ${pocket.name} to my shelf`}
            >
              <Save aria-hidden className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                minimizePocket(pocket.id);
              }}
              className="nodrag flex h-6 w-6 shrink-0 items-center justify-center border-2 hover:brightness-125"
              style={buttonStyle}
              title="Fold this board into its minimized card"
              aria-label={`Fold board ${pocket.name} into a pocket card`}
            >
              <Minimize2 aria-hidden className="h-3.5 w-3.5" />
            </button>
          </>
        ) : null}
      </div>
      {/* The corner grip: resize follows the pointer, snaps on release, and
          never shrinks past what the board holds. */}
      <div
        onPointerDown={beginResize}
        className="nodrag absolute bottom-0 right-0 h-5 w-5 cursor-nwse-resize"
        style={{ pointerEvents: "all" }}
        title="Drag to resize this board (it always keeps its cards inside)"
      >
        <span
          aria-hidden
          className="absolute bottom-[3px] right-[3px] block h-2.5 w-2.5 border-b-2 border-r-2"
          style={{ borderColor: chrome.grip }}
        />
      </div>
    </div>
  );
}

// Position props change every drag frame; the chrome only reads `data` and its
// frame size, so comparing exactly those keeps the window from re-rendering
// while React Flow translates its wrapper (see RecipeNode for the long story).
export const BoardNode = memo(
  BoardNodeComponent,
  (previous, next) =>
    previous.data === next.data &&
    previous.width === next.width &&
    previous.height === next.height,
);
