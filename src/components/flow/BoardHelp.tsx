import {
  Box,
  Clapperboard,
  Download,
  Eye,
  Factory,
  Focus,
  Gauge,
  ImagePlus,
  Network,
  Paintbrush,
  RefreshCw,
  RotateCcw,
  Search,
  Share2,
  Sigma,
  SlidersHorizontal,
  Sprout,
  Square,
  Trash2,
  TriangleAlert,
  Undo2,
  Upload,
  Volume2,
  Zap,
} from "lucide-react";
import { Fragment, memo, useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import {
  GLANCE_CARD_CLASS,
  GLANCE_LINE,
  GLANCE_QUIET,
  GlanceRows,
  GlanceTitle,
  type GlanceRow,
} from "@/components/help/card-parts";

/**
 * The board's help corner: a "?" where the zoom buttons used to live.
 *
 * Hovering it lays a glance sheet over the whole window: each toolbar gets a
 * dashed ring, an arrow, and a card naming what is in it (see
 * `card-parts.tsx`). The things with no toolbar to ring - what a card does,
 * what a drawer does, the keys, the notices - are LEGEND cards: they stack in
 * whatever column has the room, over the panel they are nearest to.
 *
 * Pure glance layer: pointer events stay off everywhere. Moving away folds the
 * whole thing up again.
 *
 * The sheet portals to <body>: the board, the browser and the inspector each
 * sit in their own stacking contexts, so a scrim rendered inside the board
 * could never dim its neighbours.
 *
 * Regions are found by their `data-help-anchor` attribute and measured once
 * per open, so the overlay follows the real layout instead of hardcoding it.
 * Several elements may share one anchor id, and a ring may union several ids
 * (the tool row is three trays and, folded, a trigger).
 *
 * LAYOUT IS COMPUTED, NOT TUNED. Every card is CARD_W wide and cards live in
 * flex COLUMNS whose corner is fixed to a ring, so no card's position depends
 * on another card's height, and an arrow only ever leaves the card whose edge
 * sits on the column's fixed corner. The old hand-set offsets per card broke
 * at every window size the author had not looked at.
 */

type HelpRect = { left: number; top: number; right: number; bottom: number };

type Measured = {
  rects: Record<string, HelpRect>;
  button?: HelpRect;
  vw: number;
  vh: number;
};

/** Every glance card's width. Rows are written to fit it. */
const CARD_W = 320;
/** Between stacked cards in one column. */
const CARD_GAP = 14;
/** Card edge to ring edge: room for the arrow to read as an arrow. */
const CALLOUT_GAP = 18;
const RING_PAD = 5;
const ARROW_HEAD = 12;
const ARROW_STEM = 3;
/** Long enough to cross the gap from the button to the cards over it. */
const HIDE_GRACE_MS = 160;
/**
 * The smallest window the spread-out glance layout fits: below either of
 * these its columns overlap or spill off the screen, so hover falls back to
 * the one-column panel instead. Checked against screenshots with both
 * columns open (`help-probe.local.mjs` at 1440x920, 1600x1000, 1920x1080):
 * at 1440x920 the left board column has about 30px to spare.
 */
const GLANCE_MIN_VW = 1440;
const GLANCE_MIN_VH = 920;

/**
 * The sheet's own accent: one soft blue-grey.
 *
 * Not cyan: this draws five rings and a dozen cards over the whole window at
 * once, and in cyan that reads as an alarm going off.
 */
const ACCENT = GLANCE_QUIET;
const ACCENT_DIM = "rgba(147, 164, 187, 0.5)";

interface HelpCard {
  title: string;
  rows: GlanceRow[];
}

/* ------------------------------------------------------------------ */
/* The cards. Rows are short on purpose: this is a reminder, not a manual,
   and a row that wraps costs a whole line of the column's budget. */

const BUILD: HelpCard = {
  title: "Build tools",
  rows: [
    { icon: Undo2, text: "Undo and redo" },
    { chip: "/s", text: "*Rate unit*: click or wheel it" },
    { chip: "EU/t", text: "*Power unit*: EU/t or amps" },
    { icon: Zap, text: "*POWER*: place a generator" },
    { icon: Gauge, text: "A *custom rate* card" },
    { icon: Sprout, text: "A *crop farm* card" },
  ],
};

const TOOLS: HelpCard = {
  title: "Board tools",
  rows: [
    { icon: Paintbrush, text: "Pick a colour, *paint* cards" },
    { icon: Square, text: "*Draw*: board, box, arrow, note" },
    { icon: ImagePlus, text: "Add an image, or paste one" },
    { icon: Trash2, text: "*Bin*: click things to delete" },
    { icon: Sigma, text: "*Solve*: type amounts, get counts" },
    { icon: SlidersHorizontal, text: "*Rules*: free ports, loose cells" },
    { icon: Network, text: "*Arrange* the loose cards" },
    { icon: Volume2, text: "Mute the sounds" },
    { icon: Clapperboard, text: "*Watch it build*" },
    { icon: Eye, text: "*View*: paper, wires, motion" },
  ],
};

const FRAMING: HelpCard = {
  title: "Framing",
  rows: [
    { icon: Focus, text: "Fit the plan on screen" },
    { text: "Zoomed out, cards can show:" },
    { icon: Box, text: "Their machine" },
    { icon: Gauge, text: "How hard they run" },
    { icon: TriangleAlert, text: "Why: starved, clogged..." },
    { icon: Zap, text: "Power draw and tier" },
  ],
};

const ON_A_CARD: HelpCard = {
  title: "On a card",
  rows: [
    { text: "Tabs above it pick the *machine*" },
    { chip: "LV", text: "*Tier*: click up, right click down" },
    { chip: "2×", text: "*Hatches*: click to type a count" },
    { chip: "8", text: "*Count*: type, wheel, Shift ×100" },
    { icon: RefreshCw, text: "*Refactor*: swap the recipe" },
    { text: "Hover the name for its *stats*" },
    { text: "Knobs: *coils*, tools, parallels" },
  ],
};

const DRAWERS: HelpCard = {
  title: "Drawers and tanks",
  rows: [
    { chip: "SOURCE", tone: "need", text: "Never runs out. An input." },
    { chip: "PRODUCT", tone: "product", text: "Pulls flat out. Cycles:" },
    { chip: "BYPRODUCT", tone: "output", text: "Takes what is left over" },
    { chip: "TRASH", tone: "internal", text: "Voids what arrives" },
    { chip: "BUFFER", tone: "fine", text: "Pass-through, or *strict*" },
    { text: "Solve mode: type *amounts*" },
  ],
};

const BOARDS: HelpCard = {
  title: "Board windows",
  rows: [
    { chip: "Ctrl+G", text: "Wrap a selection in a *board*" },
    { text: "Drag the bar: all moves" },
    { text: "Drop cards in or out" },
    { text: "*Fold* it to a summary card" },
    { text: "*Dump*: frame goes, cards stay" },
    { text: "Paper: *colour* and ruling" },
  ],
};

const LEFT_COLUMN: HelpCard = {
  title: "The left column",
  rows: [
    { icon: Search, text: "*Items*: search, filters, sorts" },
    { chip: "✦", text: "*Boards*: saved chunks to place" },
    { icon: Factory, text: "*Setups*: shared factories" },
    { text: "Left click makes, right uses" },
  ],
};

const RECIPE_SEARCH: HelpCard = {
  title: "Recipe search",
  rows: [
    { text: "Opens from any item or port" },
    { chip: "ALL", text: "Takes and makes: *any, all, only*" },
    { text: "Machine chips filter the maps" },
    { chip: "/s", text: "Read amounts as rates or *EU*" },
    { mouse: "right", text: "Right click a chip to *add it*" },
    { text: "Card refactor: swap *in place*" },
  ],
};

const THIS_PLAN: HelpCard = {
  title: "This plan",
  rows: [
    { icon: Share2, text: "Share it with everyone" },
    { icon: Upload, text: "Import a plan: JSON or image" },
    { icon: Download, text: "*Export*: image, JSON, diagnostics" },
  ],
};

const PLAN_TOTALS: HelpCard = {
  title: "Plan totals",
  rows: [
    { chip: "INPUTS", tone: "need", text: "Bring this in yourself" },
    { chip: "OUTPUTS", tone: "output", text: "Leaves the plan" },
    { chip: "INTERNAL", tone: "internal", text: "Made and used here" },
    { chip: "RAW/NET", text: "Raw, or the net balance" },
    { chip: "PEAK/AVG", text: "EU at full, or as run" },
    { text: "Hover a row to light it" },
  ],
};

const PLAN_CARD: HelpCard = {
  title: "Plan card",
  rows: [
    { text: "This plan's *icon, name and blurb*" },
    { icon: Share2, text: "Sharing posts them as its face" },
    { icon: RotateCcw, text: "An opened setup can *reset to the post*" },
  ],
};

/**
 * The banners the board raises on its own, so their first sighting is not
 * their first explanation.
 */
const NOTICES: HelpCard = {
  title: "Bottom notices",
  rows: [
    { chip: "NOT WIRED UP", tone: "fine", text: "Slots still to wire" },
    { chip: "LOOSE WIRES", tone: "bottleneck", text: "Cell wires, rule off" },
    { chip: "DEAD LOOP", tone: "bottleneck", text: "A ring starving to *0%*" },
    { chip: "CLOG LOCK", tone: "clogged", text: "Jam: add *a drawer*" },
    { chip: "SOLVE MODE", tone: "product", text: "Products need an *amount*" },
  ],
};

/** The gestures no button reveals. */
const MOVES: HelpCard = {
  title: "Mouse and keys",
  rows: [
    { mouse: "left", text: "Drag a slot to *wire it*" },
    { mouse: "left", text: "Drop on empty: *a drawer*" },
    { mouse: "left", text: "Click or R: *what makes it*" },
    { mouse: "right", text: "Right click or U: *its uses*" },
    { chip: "Shift", text: "Box-select, or add one" },
    { chip: "Ctrl+C/V", text: "Copy and paste cards" },
    { chip: "Del", text: "Delete; *Esc* drops a tool" },
    { chip: "WASD", text: "Pan; the wheel zooms" },
    { chip: "Ctrl+G", text: "Wrap it in *a board*" },
  ],
};

/** The same reminder for a finger: the compact world has no hover and no
 * right button, and telling a phone to right click is worse than nothing. */
const TOUCH_MOVES: HelpCard = {
  title: "Touch moves",
  rows: [
    { text: "Drag from a slot to *wire it*" },
    { text: "Hold a port row: *make it or use it*" },
    { text: "Tap a card first, *then* drag to move it" },
    { text: "Double tap to *zoom*; tap and slide to keep zooming" },
    { text: "Swipe in from either side for the *panels*" },
  ],
};

/** Every card, in reading order, for the one-column formats. */
const LINEAR: HelpCard[] = [
  BUILD,
  TOOLS,
  FRAMING,
  ON_A_CARD,
  DRAWERS,
  BOARDS,
  LEFT_COLUMN,
  RECIPE_SEARCH,
  THIS_PLAN,
  PLAN_TOTALS,
  PLAN_CARD,
  NOTICES,
];

/* ------------------------------------------------------------------ */

function toHelpRect(rect: DOMRect): HelpRect {
  return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
}

function unionRects(...rects: Array<HelpRect | undefined>): HelpRect | undefined {
  let out: HelpRect | undefined;
  for (const rect of rects) {
    if (!rect) {
      continue;
    }
    out = out
      ? {
          left: Math.min(out.left, rect.left),
          top: Math.min(out.top, rect.top),
          right: Math.max(out.right, rect.right),
          bottom: Math.max(out.bottom, rect.bottom),
        }
      : rect;
  }
  return out;
}

function measureAnchors(): Record<string, HelpRect> {
  const rects: Record<string, HelpRect> = {};
  document.querySelectorAll<HTMLElement>("[data-help-anchor]").forEach((element) => {
    const id = element.dataset.helpAnchor;
    const rect = element.getBoundingClientRect();
    if (!id || rect.width <= 0 || rect.height <= 0) {
      return;
    }
    rects[id] = unionRects(rects[id], toHelpRect(rect))!;
  });
  return rects;
}

/** A ring's rect once the ring pad is on it: what arrows aim at. */
function padRect(rect: HelpRect): HelpRect {
  return {
    left: rect.left - RING_PAD,
    top: rect.top - RING_PAD,
    right: rect.right + RING_PAD,
    bottom: rect.bottom + RING_PAD,
  };
}

const clamp = (value: number, low: number, high: number) =>
  Math.max(low, Math.min(high, value));

/**
 * An axis-aligned arrow: a run of points, a head at the last one pointing
 * the way the last segment travels.
 */
type Arrow = { points: Array<{ x: number; y: number }> };

/** A column of cards with one fixed corner. */
type Column = {
  key: string;
  style: CSSProperties;
  cards: HelpCard[];
};

type GlanceLayout = {
  rings: HelpRect[];
  columns: Column[];
  arrows: Arrow[];
};

/**
 * Where everything goes, from the measured rings.
 *
 * Board-left hangs under the build toolbar; the corner stack grows up from
 * the "?"; board-right hangs under the tool row and a second board-right
 * stack sits over the framing dock; the browser cards sit inside the browser
 * column; the legend cards sit over the inspector. A closed panel takes its
 * own cards with it (nothing to explain) and the legend column moves onto
 * the board's extra width.
 */
function layoutGlance({ rects, button, vw, vh }: Measured): GlanceLayout {
  const rings: HelpRect[] = [];
  const columns: Column[] = [];
  const arrows: Arrow[] = [];

  const build = rects.build;
  const toolRow = unionRects(rects.paint, rects.rules, rects.view);
  const dock = rects.glance;
  const browser = rects.browser;
  const inspector = rects.inspector;
  const planActions = rects["plan-actions"];

  // The x the whole right side is hung from: the tool row's right edge,
  // which is also the framing dock's.
  const rightEdge = toolRow?.right ?? dock?.right ?? vw - 12;

  if (build) {
    const ring = padRect(build);
    rings.push(build);
    const top = ring.bottom + CALLOUT_GAP;
    columns.push({
      key: "board-left",
      style: { left: build.left, top, width: CARD_W },
      cards: [BUILD, ON_A_CARD],
    });
    const x = clamp((ring.left + ring.right) / 2, build.left + 24, build.left + CARD_W - 24);
    arrows.push({ points: [{ x, y: top }, { x, y: ring.bottom }] });
  }

  if (toolRow) {
    const ring = padRect(toolRow);
    rings.push(toolRow);
    const top = ring.bottom + CALLOUT_GAP;
    const left = rightEdge - CARD_W;
    columns.push({
      key: "board-right",
      style: { left, top, width: CARD_W },
      cards: [TOOLS, DRAWERS],
    });
    const x = clamp((ring.left + ring.right) / 2, left + 24, left + CARD_W - 24);
    arrows.push({ points: [{ x, y: top }, { x, y: ring.bottom }] });
  }

  if (dock) {
    const ring = padRect(dock);
    rings.push(dock);
    const bottom = ring.top - CALLOUT_GAP;
    const left = dock.right - CARD_W;
    columns.push({
      key: "board-right-bottom",
      style: { left, bottom: vh - bottom, width: CARD_W },
      cards: [FRAMING],
    });
    const x = clamp((ring.left + ring.right) / 2, left + 24, left + CARD_W - 24);
    arrows.push({ points: [{ x, y: bottom }, { x, y: ring.top }] });
  }

  if (button) {
    columns.push({
      key: "corner",
      style: { left: button.left, bottom: vh - button.top + 10, width: CARD_W },
      cards: [MOVES],
    });
  }

  if (browser) {
    rings.push(browser);
    columns.push({
      key: "browser",
      style: { left: browser.left + 12, top: browser.top + 80, width: CARD_W },
      cards: [LEFT_COLUMN, RECIPE_SEARCH],
    });
  }

  // The legend: over the inspector when it is open, else on the board's
  // extra width, left of the board-right column.
  const legendLeft = inspector
    ? inspector.left + Math.max(6, (inspector.right - inspector.left - CARD_W) / 2)
    : rightEdge - CARD_W - CARD_GAP - CARD_W;
  const legendCards = inspector
    ? [THIS_PLAN, PLAN_TOTALS, BOARDS, NOTICES]
    : [THIS_PLAN, BOARDS, NOTICES];
  let legendTop = (toolRow ? padRect(toolRow).bottom : 80) + CALLOUT_GAP;
  if (inspector && planActions) {
    // Over the inspector the column starts right under the header, and the
    // plan card's arrow climbs to the header's plan buttons and elbows
    // across to them: the card cannot sit beside a 28px-tall ring.
    const ring = padRect(planActions);
    rings.push(planActions);
    legendTop = ring.bottom + CALLOUT_GAP + 5;
    const cy = (ring.top + ring.bottom) / 2;
    const x = legendLeft + 28;
    if (x > ring.right) {
      arrows.push({
        points: [
          { x, y: legendTop },
          { x, y: cy },
          { x: ring.right, y: cy },
        ],
      });
    }
  }
  columns.push({
    key: "legend",
    style: { left: legendLeft, top: legendTop, width: CARD_W },
    cards: legendCards,
  });

  return { rings, columns, arrows };
}

/** The arrow's segments as 3px bars, and its head as a border triangle. */
function ArrowMark({ arrow }: { arrow: Arrow }) {
  const { points } = arrow;
  const segments: CSSProperties[] = [];
  for (let index = 1; index < points.length; index += 1) {
    const from = points[index - 1];
    const to = points[index];
    const vertical = from.x === to.x;
    const isLast = index === points.length - 1;
    // The last segment stops short by the head's length, so the head's tip
    // is what touches the ring.
    const trim = isLast ? ARROW_HEAD : 0;
    if (vertical) {
      const y0 = Math.min(from.y, to.y) + (to.y < from.y ? trim : 0);
      const y1 = Math.max(from.y, to.y) - (to.y > from.y ? trim : 0);
      segments.push({
        left: from.x - ARROW_STEM / 2,
        top: y0,
        width: ARROW_STEM,
        height: Math.max(0, y1 - y0),
      });
    } else {
      const x0 = Math.min(from.x, to.x) + (to.x < from.x ? trim : 0);
      const x1 = Math.max(from.x, to.x) - (to.x > from.x ? trim : 0);
      segments.push({
        left: x0,
        top: from.y - ARROW_STEM / 2,
        width: Math.max(0, x1 - x0),
        height: ARROW_STEM,
      });
    }
  }
  const last = points[points.length - 1];
  const prev = points[points.length - 2];
  const direction =
    last.x === prev.x ? (last.y < prev.y ? "up" : "down") : last.x < prev.x ? "left" : "right";
  const head: CSSProperties =
    direction === "up"
      ? {
          left: last.x - 8,
          top: last.y,
          borderLeft: "8px solid transparent",
          borderRight: "8px solid transparent",
          borderBottom: `${ARROW_HEAD}px solid ${ACCENT}`,
        }
      : direction === "down"
        ? {
            left: last.x - 8,
            top: last.y - ARROW_HEAD,
            borderLeft: "8px solid transparent",
            borderRight: "8px solid transparent",
            borderTop: `${ARROW_HEAD}px solid ${ACCENT}`,
          }
        : direction === "left"
          ? {
              left: last.x,
              top: last.y - 8,
              borderTop: "8px solid transparent",
              borderBottom: "8px solid transparent",
              borderRight: `${ARROW_HEAD}px solid ${ACCENT}`,
            }
          : {
              left: last.x - ARROW_HEAD,
              top: last.y - 8,
              borderTop: "8px solid transparent",
              borderBottom: "8px solid transparent",
              borderLeft: `${ARROW_HEAD}px solid ${ACCENT}`,
            };
  return (
    <Fragment>
      {segments.map((style, index) => (
        <span key={index} className="absolute" style={{ ...style, backgroundColor: ACCENT }} />
      ))}
      <span className="absolute h-0 w-0" style={head} />
    </Fragment>
  );
}

/** One of the sheet's cards: a headline, then its rows. */
function GlanceCard({
  card,
  className,
  style,
}: {
  card: HelpCard;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <div
      className={[GLANCE_CARD_CLASS, "px-3 py-2.5", className].filter(Boolean).join(" ")}
      style={{ border: `2px solid ${GLANCE_LINE}`, ...style }}
    >
      <GlanceTitle dense>{card.title}</GlanceTitle>
      <div className="mt-2">
        <GlanceRows rows={card.rows} accent={ACCENT} dense />
      </div>
    </div>
  );
}

const HELP_BUTTON_CLASS =
  "pointer-events-auto flex h-9 w-9 items-center justify-center border-2 border-[var(--mc-15)] bg-[var(--mc-49)] font-mono text-[16px] font-black text-white shadow-[inset_2px_2px_0_var(--mc-85),inset_-2px_-2px_0_var(--mc-25)] hover:brightness-110";

/**
 * The same help, as one scrolling sheet.
 *
 * The glance layer is built out of rings and arrows pointing at the toolbars it
 * describes; on a phone those toolbars are folded into single buttons, its cards
 * are wider than the screen, and there is no hover to open it with. So compact
 * windows get the content and drop the pointing: every card in a column, over a
 * full-screen sheet with one way out.
 */
function HelpSheet({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[120] flex flex-col bg-[#101419] font-mono text-[#dbe3ec]">
      <div
        className="flex h-11 shrink-0 items-center justify-between px-3"
        style={{ borderBottom: `1px solid ${GLANCE_LINE}` }}
      >
        <span className="text-[12px] font-black uppercase tracking-[0.14em] text-[#aebccd]">
          What everything does
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close help"
          className="flex h-9 w-9 items-center justify-center border text-[16px] text-[#aebccd]"
          style={{ borderColor: GLANCE_LINE }}
        >
          ✕
        </button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
        <GlanceCard card={TOUCH_MOVES} />
        {LINEAR.map((card) => (
          <GlanceCard key={card.title} card={card} />
        ))}
      </div>
    </div>
  );
}

/**
 * The help, folded to fit: one scrollable column growing out of the "?".
 *
 * The glance layer needs a big window - a dozen cards spread over the
 * screen, each beside the toolbar it names - and between the phone layout
 * and that spread sits a band of small desktop windows where the spread
 * collapses into a pile of overlapping cards. Those windows get this
 * instead: every card in one column beside the button, scrollable, still
 * opened by hover and closed by leaving. Same content, no pointing.
 */
function HelpHoverPanel({
  measured,
  onEnter,
  onLeave,
}: {
  measured: Measured;
  onEnter: () => void;
  onLeave: () => void;
}) {
  const { button, vw, vh } = measured;
  const anchorTop = button ? button.top : vh - 12;
  const anchorLeft = button ? button.left : 12;
  return (
    <div
      className="pointer-events-none fixed inset-0 z-[120] font-mono"
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
    >
      <div className="absolute inset-0 bg-black/60" />
      <div
        className="pointer-events-auto absolute flex flex-col gap-2 overflow-y-auto pr-1"
        style={{
          left: anchorLeft,
          bottom: vh - anchorTop + 10,
          width: Math.min(380, vw - anchorLeft - 12),
          maxHeight: anchorTop - 22,
        }}
      >
        <GlanceCard card={MOVES} />
        {LINEAR.map((card) => (
          <GlanceCard key={card.title} card={card} />
        ))}
      </div>
    </div>
  );
}

function HelpGlanceSheet({
  measured,
  onEnter,
  onLeave,
}: {
  measured: Measured;
  onEnter: () => void;
  onLeave: () => void;
}) {
  const { button } = measured;
  const { rings, columns, arrows } = layoutGlance(measured);
  return (
    <div
      className="pointer-events-none fixed inset-0 z-[120] font-mono"
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
    >
      <div className="absolute inset-0 bg-black/60" />
      {rings.map((rect, index) => (
        <div
          key={index}
          className="absolute border border-dashed"
          style={{
            borderColor: ACCENT_DIM,
            left: rect.left - RING_PAD,
            top: rect.top - RING_PAD,
            width: rect.right - rect.left + RING_PAD * 2,
            height: rect.bottom - rect.top + RING_PAD * 2,
          }}
        />
      ))}
      {arrows.map((arrow, index) => (
        <ArrowMark key={index} arrow={arrow} />
      ))}
      {columns.map((column) => (
        <div
          key={column.key}
          className="absolute flex flex-col"
          style={{ ...column.style, gap: CARD_GAP }}
        >
          {column.cards.map((card) => (
            <GlanceCard key={card.title} card={card} />
          ))}
        </div>
      ))}
      {button ? (
        /* A lit stand-in over the real (now dimmed) button, so the corner
           the sheet grew from stays readable. Hover still lands on the
           real button underneath. */
        <div
          className="absolute flex items-center justify-center border-2 bg-[var(--mc-49)] font-mono text-[16px] font-black text-white shadow-[inset_2px_2px_0_var(--mc-85),inset_-2px_-2px_0_var(--mc-25)]"
          style={{
            borderColor: ACCENT,
            left: button.left,
            top: button.top,
            width: button.right - button.left,
            height: button.bottom - button.top,
          }}
        >
          ?
        </div>
      ) : null}
    </div>
  );
}

export const BoardHelp = memo(function BoardHelp({ compact }: { compact: boolean }) {
  const [measured, setMeasured] = useState<Measured | undefined>(undefined);
  const [isSheetOpen, setSheetOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const hideTimerRef = useRef<number | undefined>(undefined);

  const show = useCallback(() => {
    window.clearTimeout(hideTimerRef.current);
    const buttonRect = buttonRef.current?.getBoundingClientRect();
    setMeasured({
      rects: measureAnchors(),
      button: buttonRect ? toHelpRect(buttonRect) : undefined,
      vw: window.innerWidth,
      vh: window.innerHeight,
    });
  }, []);
  const scheduleHide = useCallback(() => {
    window.clearTimeout(hideTimerRef.current);
    hideTimerRef.current = window.setTimeout(() => setMeasured(undefined), HIDE_GRACE_MS);
  }, []);
  useEffect(() => () => window.clearTimeout(hideTimerRef.current), []);

  if (compact) {
    return (
      <div className="absolute bottom-3 left-3 z-30">
        <button
          type="button"
          onClick={() => setSheetOpen(true)}
          data-help-anchor="help"
          className={HELP_BUTTON_CLASS}
          title="Board help"
          aria-label="Show board help"
        >
          ?
        </button>
        {isSheetOpen && typeof document !== "undefined"
          ? createPortal(
              <HelpSheet onClose={() => setSheetOpen(false)} />,
              document.body,
            )
          : null}
      </div>
    );
  }

  // Between the phone layout and the full spread sits a band of small
  // desktop windows; they hover the one-column panel instead. Decided per
  // open, so resizing simply changes what the next hover shows.
  const fitsGlance =
    measured !== undefined && measured.vw >= GLANCE_MIN_VW && measured.vh >= GLANCE_MIN_VH;

  return (
    <div
      className="absolute bottom-3 left-3 z-30"
      onMouseEnter={show}
      onMouseLeave={scheduleHide}
    >
      <button
        ref={buttonRef}
        type="button"
        // Click too, not only hover: a pen, a touch screen above the phone
        // breakpoint, or a keyboard's Enter all land here, and help must
        // open for every one of them.
        onClick={show}
        onFocus={show}
        onBlur={scheduleHide}
        data-help-anchor="help"
        className={HELP_BUTTON_CLASS}
        title="Board help"
        aria-label="Show board help"
      >
        ?
      </button>
      {measured
        ? createPortal(
            fitsGlance ? (
              <HelpGlanceSheet measured={measured} onEnter={show} onLeave={scheduleHide} />
            ) : (
              <HelpHoverPanel measured={measured} onEnter={show} onLeave={scheduleHide} />
            ),
            document.body,
          )
        : null}
    </div>
  );
});
