"use client";

import {
  ArrowBigUp,
  Cog,
  Download,
  EyeOff,
  Globe,
  LayoutGrid,
  Link2,
  LoaderCircle,
  Square,
  Zap,
} from "lucide-react";
import { useEffect, useRef, useState, type DragEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { FLUID_ICON_SCALE, ResourceIcon } from "@/components/nei/ResourceIcon";
import { MinecraftTooltip } from "@/components/nei/MinecraftTooltip";
import { TierBadge, type VoltageTier } from "@/components/shelf-cards";
import { normalizeBlueprintTags } from "@/lib/blueprints/types";
import type { EntryIcon } from "@/lib/model/types";
import { MENU_WIDTH } from "./library-menu";

/**
 * THE tile: one shape for a design of yours and a post on the network, in
 * every view of the library. Fixed height, three rows:
 *
 *   [face]  Title on one line                           [EV]
 *           creator · 2d ago                    ⋯ (on hover)
 *   ▢ 21   ⚙ 15   ⚡ 5.0k                 OPEN 🌐●   ▲ 12  ⤓ 34
 *
 * Click opens it: one verb, no question. Right click or the dots is the
 * menu. The vote arrow is the one control on the face of it; everything
 * else lives in the menu. Hover reveals the full stat card. No tags on
 * the tile: they live in the search and the hover.
 */

export const DESIGN_DRAG_TYPE = "application/x-gtnh-design";

export interface TileMarks {
  /** On the tab strip. */
  open?: boolean;
  /** On the canvas right now. */
  active?: boolean;
  /** Your own post on the network. */
  posted?: boolean;
  /** Edited since it last matched that post. */
  behind?: boolean;
  /** Opened from someone else's setup. */
  fromNetwork?: boolean;
  /** Linked to a post whose owner the network has not said. */
  linked?: boolean;
  /** A post of yours that is not public. */
  privatePost?: boolean;
}

export interface TileSocial {
  score: number;
  myVote?: 1 | -1;
  onVote?: () => void;
  downloads?: number;
}

export interface LibraryTileProps {
  icon?: EntryIcon;
  name: string;
  /** Who or where, and when: "dom_loid · 1h ago", "Oil · 2d ago". */
  subtitle: ReactNode;
  tier?: VoltageTier;
  cards?: number;
  machines?: number;
  euT?: number;
  social?: TileSocial;
  marks?: TileMarks;
  busy?: boolean;
  hoverCard?: ReactNode | (() => ReactNode);
  menuOpen?: boolean;
  onOpen: () => void;
  onMenu: (left: number, top: number) => void;
  /** Set to make the tile draggable onto a rail folder. */
  dragId?: string;
  renaming?: { onCommit: (name: string) => void; onCancel: () => void };
}

export function LibraryTile({
  icon,
  name,
  subtitle,
  tier,
  cards,
  machines,
  euT,
  social,
  marks = {},
  busy,
  hoverCard,
  menuOpen,
  onOpen,
  onMenu,
  dragId,
  renaming,
}: LibraryTileProps) {
  const body = (
    <div
      draggable={Boolean(dragId) && !renaming}
      onDragStart={
        dragId
          ? (event: DragEvent) => {
              event.dataTransfer.setData(DESIGN_DRAG_TYPE, dragId);
              event.dataTransfer.effectAllowed = "move";
            }
          : undefined
      }
      role="button"
      tabIndex={0}
      onClick={(event) => {
        if (renaming || busy || (event.target as HTMLElement).closest("button, input, a")) {
          return;
        }
        onOpen();
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" && !renaming && !busy) {
          onOpen();
        }
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        onMenu(event.clientX, event.clientY);
      }}
      title={name}
      className={[
        "group relative flex h-[76px] cursor-pointer select-none flex-col justify-between rounded border px-2.5 py-2 text-left",
        marks.active
          ? "border-cyan-500/70 bg-[#182029]"
          : "border-line bg-[#151a21] hover:border-line-strong hover:bg-[#182029]",
        menuOpen ? "border-line-strong" : "",
        busy ? "opacity-60" : "",
      ].join(" ")}
    >
      {/* Row one and two: face, title, who and when; tier at the corner. */}
      <div className="flex items-start gap-2.5">
        <Face icon={icon} size={36} />
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center gap-2">
            {renaming ? (
              <InlineName initialName={name} onCommit={renaming.onCommit} onCancel={renaming.onCancel} />
            ) : (
              <span className="min-w-0 flex-1 truncate text-[12px] font-bold leading-tight text-fg group-hover:text-white">
                {name}
              </span>
            )}
            {tier ? <TierBadge tier={tier} /> : null}
          </div>
          <div className="flex items-center gap-1">
            <span className="min-w-0 flex-1 truncate text-[10px] text-fg-muted">{subtitle}</span>
            <button
              type="button"
              aria-label={`Options for ${name}`}
              aria-expanded={menuOpen}
              onClick={(event) => {
                const rect = event.currentTarget.getBoundingClientRect();
                onMenu(Math.min(rect.left, window.innerWidth - MENU_WIDTH - 8), rect.bottom + 4);
              }}
              className="-my-1 shrink-0 rounded px-1 text-xs leading-none text-fg-muted opacity-0 hover:bg-surface-raised hover:text-fg focus:opacity-100 group-hover:opacity-100 aria-expanded:opacity-100"
            >
              ⋯
            </button>
          </div>
        </div>
      </div>

      {/* Row three: the numbers, then the marks and the social figures. */}
      <div className="flex items-center gap-3 text-[10px] text-fg-muted">
        {cards !== undefined ? (
          <Stat icon={Square} title="Cards" value={String(cards)} />
        ) : null}
        {machines !== undefined ? (
          <Stat icon={Cog} title="Machines" value={String(machines)} />
        ) : null}
        {euT !== undefined ? (
          <Stat icon={Zap} title="EU per tick" value={formatEuT(euT)} tone="text-amber-300/80" />
        ) : null}
        <span className="ml-auto flex items-center gap-2">
          {busy ? <LoaderCircle className="h-3 w-3 animate-spin" aria-hidden /> : null}
          {marks.open ? (
            <span
              title={marks.active ? "On the board now" : "Open on the tab strip"}
              className={[
                "rounded px-1 text-[9px] font-black uppercase tracking-wide",
                marks.active ? "bg-cyan-500/25 text-cyan-200" : "bg-surface-raised text-fg-subtle",
              ].join(" ")}
            >
              open
            </span>
          ) : null}
          {marks.privatePost ? (
            <span title="Private: only you see this post" className="text-fg-muted">
              <EyeOff className="h-3 w-3" aria-hidden />
            </span>
          ) : null}
          <PostGlyph marks={marks} />
          {social ? (
            <>
              <button
                type="button"
                disabled={!social.onVote}
                onClick={social.onVote}
                aria-label={social.myVote === 1 ? "Take back your vote" : "Vote this up"}
                title="Votes"
                className={[
                  "flex items-center gap-0.5 rounded px-0.5",
                  social.myVote === 1
                    ? "text-cyan-300"
                    : "hover:bg-surface-raised hover:text-fg disabled:hover:bg-transparent",
                ].join(" ")}
              >
                <ArrowBigUp className="h-3 w-3" aria-hidden />
                {social.score}
              </button>
              {social.downloads !== undefined ? (
                <span className="flex items-center gap-0.5" title="Downloads">
                  <Download className="h-3 w-3" aria-hidden />
                  {social.downloads}
                </span>
              ) : null}
            </>
          ) : null}
        </span>
      </div>
    </div>
  );

  return hoverCard ? <MinecraftTooltip content={hoverCard}>{body}</MinecraftTooltip> : body;
}

function Stat({
  icon: Icon,
  title,
  value,
  tone,
}: {
  icon: typeof Square;
  title: string;
  value: string;
  tone?: string;
}) {
  return (
    <span className="flex items-center gap-1 tabular-nums" title={title}>
      <Icon className={["h-3 w-3", tone ?? ""].join(" ")} aria-hidden />
      {value}
    </span>
  );
}

function PostGlyph({ marks }: { marks: TileMarks }) {
  if (!marks.posted && !marks.fromNetwork && !marks.linked) {
    return null;
  }
  const Icon = marks.posted ? Globe : marks.fromNetwork ? Download : Link2;
  const title = marks.fromNetwork
    ? "Opened from a shared setup"
    : marks.behind
      ? "Posted. Edited since: use Update post to refresh it."
      : marks.posted
        ? "Posted on the network"
        : "Linked to a post on the network";
  return (
    <span
      title={title}
      className={[
        "relative inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center",
        marks.posted ? "text-emerald-400" : "text-fg-muted",
      ].join(" ")}
    >
      <Icon className="h-3 w-3" aria-hidden />
      {marks.behind && !marks.fromNetwork ? (
        <span
          aria-hidden
          className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-amber-400 ring-2 ring-[#151a21]"
        />
      ) : null}
      <span className="sr-only">{title}</span>
    </span>
  );
}

export function formatEuT(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1e9) return `${(value / 1e9).toFixed(1)}G`;
  if (abs >= 1e6) return `${(value / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${(value / 1e3).toFixed(1)}k`;
  return `${Math.round(value)}`;
}

/** The saved face, drawn oversized so the art fills the box the way tabs do. No box behind it. */
export function Face({ icon, size }: { icon: EntryIcon | undefined; size: number }) {
  const drawable = Boolean(icon && (icon.iconPath || icon.iconAtlas || icon.kind === "fluid"));
  return (
    <span
      aria-hidden
      className="flex shrink-0 items-center justify-center overflow-hidden"
      style={{ width: size, height: size }}
    >
      {drawable && icon ? (
        <ResourceIcon
          resource={{
            id: icon.resourceId,
            kind: icon.kind,
            amount: 1,
            displayName: icon.displayName,
            iconPath: icon.iconPath,
            iconAtlas: icon.iconAtlas,
            dominantColor: icon.dominantColor,
          }}
          bare
          tooltip={false}
          showAmount={false}
          iconPixelSize={
            icon.kind === "fluid" ? Math.round((size - 6) / FLUID_ICON_SCALE) : (size - 6) * 2
          }
          className="!h-full !w-full"
        />
      ) : (
        <LayoutGrid className="h-1/2 w-1/2 text-[#3d4a58]" />
      )}
    </span>
  );
}

export function InlineName({
  initialName,
  placeholder,
  onCommit,
  onCancel,
}: {
  initialName: string;
  placeholder?: string;
  onCommit: (name: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initialName);
  // Committing on blur keeps a click elsewhere from silently discarding the
  // edit. Escape is the one way out without saving, and it must not also
  // commit on the blur it causes.
  const cancelledRef = useRef(false);
  return (
    <input
      autoFocus
      value={value}
      placeholder={placeholder}
      onChange={(event) => setValue(event.target.value)}
      onFocus={(event) => event.target.select()}
      onBlur={() => {
        if (!cancelledRef.current) {
          onCommit(value);
        }
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          onCommit(value);
        } else if (event.key === "Escape") {
          cancelledRef.current = true;
          onCancel();
        }
      }}
      onClick={(event) => event.stopPropagation()}
      aria-label="Name"
      className="min-w-0 w-full rounded border border-cyan-500 bg-surface px-1 text-xs text-fg outline-none"
    />
  );
}

/**
 * The tag editor, as a small box at a viewport point: chips for the tags
 * so far, an input that adds on Enter or comma, and closing saves. One PUT
 * per session of editing.
 */
export function TagEditor({
  left,
  top,
  initialTags,
  onClose,
}: {
  left: number;
  top: number;
  initialTags: string[];
  onClose: (tags: string[]) => void;
}) {
  const [draft, setDraft] = useState<string[]>(initialTags);
  const [input, setInput] = useState("");
  const boxRef = useRef<HTMLDivElement>(null);
  // The outside-click listener is bound once, so it reads the latest draft
  // through refs kept in step after every render.
  const draftRef = useRef(draft);
  const inputRef = useRef(input);
  useEffect(() => {
    draftRef.current = draft;
    inputRef.current = input;
  });

  const finish = () => {
    const pending = inputRef.current.trim();
    onClose(pending ? normalizeBlueprintTags([...draftRef.current, pending]) : draftRef.current);
  };

  useEffect(() => {
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!boxRef.current?.contains(event.target as Node)) {
        finish();
      }
    };
    document.addEventListener("pointerdown", closeOnOutsideClick, true);
    return () => document.removeEventListener("pointerdown", closeOnOutsideClick, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <div
      ref={boxRef}
      style={{
        left: Math.min(left, window.innerWidth - 260 - 8),
        top: Math.min(top, window.innerHeight - 120),
        width: 260,
      }}
      className="fixed z-[100] flex flex-wrap items-center gap-1 rounded border border-line bg-surface-raised p-1.5 shadow-lg"
    >
      {draft.map((tag) => (
        <button
          key={tag}
          type="button"
          onClick={() => setDraft(draft.filter((entry) => entry !== tag))}
          title="Remove this tag"
          className="rounded border border-neutral-700 bg-[#17191d] px-1.5 text-[11px] text-neutral-300 hover:border-red-700 hover:text-red-300"
        >
          #{tag}
        </button>
      ))}
      <input
        autoFocus
        value={input}
        placeholder={draft.length === 0 ? "add tags..." : ""}
        onChange={(event) => setInput(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === ",") {
            event.preventDefault();
            if (input.trim()) {
              setDraft(normalizeBlueprintTags([...draft, input]));
              setInput("");
            } else {
              finish();
            }
          } else if (event.key === "Escape") {
            onClose(initialTags);
          }
        }}
        aria-label="Add a tag"
        className="min-w-[80px] flex-1 bg-transparent text-xs text-fg outline-none placeholder:text-fg-muted"
      />
    </div>,
    document.body,
  );
}
