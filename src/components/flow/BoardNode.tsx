"use client";

import { NodeToolbar, Position, type Node, type NodeProps, useReactFlow } from "@xyflow/react";
import { memo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Copy, Minimize2, PackageOpen, Save, X } from "lucide-react";
import type { FactoryNodeColorTag, FactoryPocket } from "@/lib/model/types";
import { boardWindowSize } from "@/lib/model/board-windows";
import {
  BOARD_GRID,
  BOARD_WINDOW_FIT_PAD,
  BOARD_WINDOW_MIN_HEIGHT,
  BOARD_WINDOW_MIN_WIDTH,
} from "@/lib/board-grid";
import { captureBoardSelection, useFactoryStore } from "@/store/factory-store";
import { useBlueprintStore } from "@/store/blueprint-store";
import { useBoardView } from "./board-view";
import { CANVAS_THEMES, getCanvasTheme } from "./canvas-themes";
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
  /** The floor: a flat paper colour, its grain, and its own grid dots. */
  floorColor: string;
  floorTexture?: string;
  dotColor: string;
  frameLine: string;
  grip: string;
}

/** The unpapered look: the purple family the minimized card wears. */
const DEFAULT_CHROME: BoardChrome = {
  barBg: "#3b2d52",
  barBevelHi: "#5e4a85",
  barBevelLo: "#1a1326",
  barBorder: "#241b33",
  nameBg: "#5e4a85",
  ink: "#ffffff",
  inkMuted: "#c9b8ec",
  floorColor: "#2a2140",
  dotColor: "#5b4c7a",
  frameLine: "#5e4a85",
  grip: "#8d6fd1",
};

/**
 * The papers a board may be laid on: the canvas themes, minus the light
 * ones. A pale sheet under the board's dark cards reads as a hole cut in
 * the plan rather than as a surface the cards sit on, so the picker simply
 * does not offer them. A board that already carries one still renders it.
 */
const BOARD_PAPERS = CANVAS_THEMES.filter((theme) => !isLightColor(theme.base));

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

/** Mix a #rrggbb toward black (amount < 0) or white (amount > 0). */
function shadeHex(hex: string, amount: number): string {
  const value = hex.replace("#", "");
  if (value.length < 6) {
    return hex;
  }
  const mix = (channel: number) =>
    Math.round(
      amount >= 0 ? channel + (255 - channel) * amount : channel * (1 + amount),
    )
      .toString(16)
      .padStart(2, "0");
  return `#${mix(parseInt(value.slice(0, 2), 16))}${mix(
    parseInt(value.slice(2, 4), 16),
  )}${mix(parseInt(value.slice(4, 6), 16))}`;
}

/**
 * A board's clothes. The PAPER comes first: a canvas theme gives the floor
 * its colour, its grain and the ink its own grid dots are drawn in, and the
 * title bar is cut from the same paper a few shades off so the window reads
 * as one object. A board with no paper falls back to a colour tag (the paint
 * tool still works on boards), and with neither to the house purple.
 */
function chromeFor(
  themeId: string | undefined,
  colorTag: FactoryNodeColorTag | undefined,
): BoardChrome {
  if (themeId) {
    const theme = getCanvasTheme(themeId);
    const light = isLightColor(theme.base);
    const ink = light ? "#1b1d21" : "#f4f4f5";
    return {
      // The bar: the same paper, pushed away from the floor so the two never
      // read as one flat slab.
      barBg: shadeHex(theme.base, light ? -0.12 : 0.16),
      barBevelHi: shadeHex(theme.base, light ? -0.02 : 0.28),
      barBevelLo: shadeHex(theme.base, light ? -0.3 : -0.4),
      barBorder: shadeHex(theme.base, light ? -0.45 : -0.55),
      nameBg: shadeHex(theme.base, light ? -0.05 : 0.24),
      ink,
      inkMuted: light ? "rgba(27, 29, 33, 0.7)" : "rgba(244, 244, 245, 0.7)",
      floorColor: theme.base,
      floorTexture: theme.texture,
      dotColor: theme.patternColor,
      frameLine: shadeHex(theme.base, light ? -0.35 : 0.34),
      grip: theme.patternColor,
    };
  }
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
    floorColor: `${paint.swatch}22`,
    dotColor: paint.border,
    frameLine: paint.border,
    grip: paint.swatch,
  };
}

function BoardNodeComponent({ data, width, height }: NodeProps<BoardWindowFlowNode>) {
  const { pocket, memberCount } = data;
  const minimizePocket = useFactoryStore((state) => state.minimizePocket);
  const renamePocket = useFactoryStore((state) => state.renamePocket);
  const setPocketSize = useFactoryStore((state) => state.setPocketSize);
  const setPocketTheme = useFactoryStore((state) => state.setPocketTheme);
  const deleteBoardSelection = useFactoryStore((state) => state.deleteBoardSelection);
  const dissolvePocket = useFactoryStore((state) => state.dissolvePocket);
  const { calmMode } = useBoardView();
  const { getZoom, getNodes } = useReactFlow();
  const [draftName, setDraftName] = useState<string | undefined>(undefined);
  const [isPaletteOpen, setPaletteOpen] = useState(false);
  const isRenaming = draftName !== undefined && !calmMode;
  const chrome = chromeFor(pocket.theme, pocket.colorTag);

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
      {/* The background palette, in a React Flow toolbar PORTAL: the frame
          itself sits under every card, and a popover drawn in the node's own
          layer would be buried by the very members it floats over. */}
      <NodeToolbar
        isVisible={isPaletteOpen}
        position={Position.Top}
        align="start"
        style={{ zIndex: 30 }}
      >
        <div className="nodrag flex max-w-[420px] flex-wrap gap-1 border-2 border-[#8d6fd1] bg-[#241b33] p-1 shadow-[4px_4px_0_rgba(0,0,0,0.45)]">
          <button
            type="button"
            onClick={() => {
              setPocketTheme(pocket.id, undefined);
              setPaletteOpen(false);
            }}
            className="flex h-7 w-9 items-center justify-center border-2 border-[#241b33] bg-[#3b2d52] text-white hover:bg-[#5e4a85]"
            title="Back to the house purple"
            aria-label={`Clear the paper on board ${pocket.name}`}
          >
            <X className="h-3.5 w-3.5" />
          </button>
          {BOARD_PAPERS.map((theme) => (
            <button
              key={theme.id}
              type="button"
              onClick={() => {
                setPocketTheme(pocket.id, theme.id);
                setPaletteOpen(false);
              }}
              className={[
                "flex h-7 w-9 shrink-0 items-center justify-center gap-1 border-2",
                pocket.theme === theme.id
                  ? "border-white ring-2 ring-cyan-300"
                  : "border-[#241b33]",
              ].join(" ")}
              style={{ backgroundColor: theme.base, backgroundImage: theme.texture }}
              title={theme.name}
              aria-label={`Paper board ${pocket.name} in ${theme.name}`}
            >
              {[0, 1, 2].map((dot) => (
                <span
                  key={dot}
                  aria-hidden
                  className="h-[3px] w-[3px]"
                  style={{ backgroundColor: theme.patternColor }}
                />
              ))}
            </button>
          ))}
        </div>
      </NodeToolbar>
      {/* The frame line only. The PAPER is a separate node underneath the
          wire layer (BoardFloorNode) so a board's own members keep their
          wiring in plain sight while foreign wires pass beneath the board. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{ boxShadow: `inset 0 0 0 2px ${chrome.frameLine}` }}
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
                setPaletteOpen((open) => !open);
              }}
              className="nodrag flex h-6 w-6 shrink-0 items-center justify-center border-2 hover:brightness-125"
              style={buttonStyle}
              title="Choose this board's paper"
              aria-label={`Choose paper for board ${pocket.name}`}
            >
              <span
                aria-hidden
                className="block h-3.5 w-3.5 border"
                style={{
                  backgroundColor: chrome.floorColor,
                  backgroundImage: chrome.floorTexture,
                  borderColor: chrome.barBorder,
                }}
              />
            </button>
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
                dissolvePocket(pocket.id);
              }}
              className="nodrag flex h-6 w-6 shrink-0 items-center justify-center border-2 hover:brightness-125"
              style={buttonStyle}
              title="Dump this board: the frame goes, the cards stay where they are"
              aria-label={`Dump board ${pocket.name}`}
            >
              <PackageOpen aria-hidden className="h-3.5 w-3.5" />
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

/**
 * One board's paper, painted by the floor LAYER rather than by the board's
 * own node.
 *
 * The layer is a viewport portal parked under the wires (see BoardFloors in
 * FactoryFlow): a board's chrome has to sit OVER the wires that cross it
 * while its floor sits UNDER them, and a node cannot be in two places in the
 * stack — React Flow also pins every child node above its parent, so the
 * floor cannot simply be a child either. Pure decoration: no pointer events,
 * no geometry, invisible to routing, drop targeting and the camera.
 */
export function BoardFloor({
  pocket,
  width,
  height,
}: {
  pocket: FactoryPocket;
  width: number;
  height: number;
}) {
  const chrome = chromeFor(pocket.theme, pocket.colorTag);
  return (
    <div
      aria-hidden
      data-board-floor={pocket.id}
      className="pointer-events-none absolute"
      style={{
        transform: `translate(${pocket.position.x}px, ${pocket.position.y}px)`,
        width,
        height,
        backgroundColor: chrome.floorColor,
        // The board's own grid dots, on the same 20px pitch the canvas uses,
        // over the theme's grain: a board reads as a piece of board rather
        // than a tinted rectangle.
        backgroundImage: [
          `radial-gradient(circle at 1px 1px, ${chrome.dotColor} 1.5px, transparent 1.5px)`,
          chrome.floorTexture,
        ]
          .filter(Boolean)
          .join(", "),
        backgroundSize: `${BOARD_GRID}px ${BOARD_GRID}px, auto`,
      }}
    />
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
