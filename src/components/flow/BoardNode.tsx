"use client";

import { type Node, type NodeProps, useReactFlow } from "@xyflow/react";
import { memo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Minimize2 } from "lucide-react";
import type { FactoryPocket } from "@/lib/model/types";
import { boardWindowSize } from "@/lib/model/board-windows";
import { BOARD_WINDOW_MIN_HEIGHT, BOARD_WINDOW_MIN_WIDTH } from "@/lib/board-grid";
import { useFactoryStore } from "@/store/factory-store";
import { useBoardView } from "./board-view";

/**
 * A pocket standing OPEN: a window frame on its parent board. The members
 * render as ordinary cards INSIDE the frame (React Flow children of this
 * node), so this component draws only the chrome — a title bar that drags the
 * whole household, a wash that says "these belong together", and a corner
 * grip. Wires pass straight through the frame; only the cards inside are
 * obstacles, which is why the frame publishes no geometry of its own.
 */

/** The title bar is the only place a drag can grab the frame. */
export const BOARD_DRAG_HANDLE_CLASS = "board-window-grab";

export interface BoardNodeData extends Record<string, unknown> {
  pocket: FactoryPocket;
  /** Direct members in the frame: cards, drawers, ink, nested pockets. */
  memberCount: number;
}

export type BoardWindowFlowNode = Node<BoardNodeData, "boardNode">;

function BoardNodeComponent({ data, width, height }: NodeProps<BoardWindowFlowNode>) {
  const { pocket, memberCount } = data;
  const minimizePocket = useFactoryStore((state) => state.minimizePocket);
  const renamePocket = useFactoryStore((state) => state.renamePocket);
  const setPocketSize = useFactoryStore((state) => state.setPocketSize);
  const { calmMode } = useBoardView();
  const { getZoom } = useReactFlow();
  const [draftName, setDraftName] = useState<string | undefined>(undefined);
  const isRenaming = draftName !== undefined && !calmMode;

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

  const beginResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const startClient = { x: event.clientX, y: event.clientY };
    const startSize = { width: frameWidth, height: frameHeight };
    const handleMove = (move: PointerEvent) => {
      const zoom = getZoom() || 1;
      setDraftSize({
        width: Math.max(
          BOARD_WINDOW_MIN_WIDTH,
          startSize.width + (move.clientX - startClient.x) / zoom,
        ),
        height: Math.max(
          BOARD_WINDOW_MIN_HEIGHT,
          startSize.height + (move.clientY - startClient.y) / zoom,
        ),
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

  return (
    <div
      className="relative font-mono text-white"
      style={{ width: frameWidth, height: frameHeight }}
    >
      {/* The body: a faint wash and a frame line, purely paint. Clicks fall
          through to the pane, so panning and marquee selection work over the
          board's floor exactly as they do over bare canvas. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[#3b2d52]/15 shadow-[inset_0_0_0_2px_#5e4a85]"
      />
      {/* The title bar: the window's one handle. Dragging it moves the board
          and every member with it. */}
      <div
        className={[
          BOARD_DRAG_HANDLE_CLASS,
          "absolute inset-x-0 top-0 flex h-[40px] cursor-grab items-center gap-1 border-2 border-[#241b33] bg-[#3b2d52] px-2 shadow-[inset_2px_2px_0_#5e4a85,inset_-2px_-2px_0_#1a1326]",
        ].join(" ")}
        style={{ pointerEvents: "all" }}
        title={
          calmMode
            ? `${pocket.name} (drag to move the board and everything on it)`
            : `${pocket.name} (drag to move the board and everything on it, double-click the name to rename)`
        }
      >
        {!isRenaming ? (
          <div
            className="minecraft-title flex h-6 min-w-0 flex-1 items-center border-2 border-[#241b33] bg-[#5e4a85] px-2 text-[13px] leading-[18px] shadow-[inset_2px_2px_0_#8d6fd1,inset_-2px_-2px_0_#2b2140]"
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
            <span className="ml-auto shrink-0 pl-2 text-[11px] text-[#c9b8ec]">
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
        {!calmMode ? (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              minimizePocket(pocket.id);
            }}
            className="nodrag flex h-6 w-6 shrink-0 items-center justify-center border-2 border-[#241b33] bg-[#5e4a85] text-white shadow-[inset_2px_2px_0_#8d6fd1,inset_-2px_-2px_0_#2b2140] hover:bg-[#8d6fd1]"
            title="Fold this board into a pocket card"
            aria-label={`Fold board ${pocket.name} into a pocket card`}
          >
            <Minimize2 aria-hidden className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </div>
      {/* The corner grip: resize follows the pointer, snaps on release. */}
      <div
        onPointerDown={beginResize}
        className="nodrag absolute bottom-0 right-0 h-5 w-5 cursor-nwse-resize"
        style={{ pointerEvents: "all" }}
        title="Drag to resize this board"
      >
        <span
          aria-hidden
          className="absolute bottom-[3px] right-[3px] block h-2.5 w-2.5 border-b-2 border-r-2 border-[#8d6fd1]"
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
