"use client";

import {
  ArrowBigUp,
  Download,
  EyeOff,
  Factory,
  Globe,
  LayoutGrid,
  Link2,
  LoaderCircle,
  Zap,
} from "lucide-react";
import { useEffect, useRef, useState, type DragEvent } from "react";
import { createPortal } from "react-dom";
import { FLUID_ICON_SCALE, ResourceIcon } from "@/components/nei/ResourceIcon";
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
 *   🏭 15   ⚡ 5.0k EU/t                   OPEN 🌐●   ▲ 12  ⤓ 34
 *
 * Click opens it: one verb, no question. Right click or the dots is the
 * menu. The creator's name is a filter (click it, the grid narrows to
 * them) and so is the tier badge. The vote arrow is the one other control
 * on the face of it. NO TOOLTIPS anywhere on a tile: what a thing is must
 * be readable without hovering.
 */

export const DESIGN_DRAG_TYPE = "application/x-gtnh-design";

export interface TileMarks {
  /** On the tab strip. */
  open?: boolean;
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
  /** Who made it (a post) or where it is filed (a design). */
  creator?: string;
  /** Clicking the creator narrows the grid to them. */
  onCreator?: () => void;
  /** "2d ago". */
  when: string;
  tier?: VoltageTier;
  /** Clicking the tier badge narrows the grid to that tier and below. */
  onTier?: () => void;
  /** Machines to build. Drawers, sources and other non-machine cards never count. */
  machines?: number;
  euT?: number;
  social?: TileSocial;
  marks?: TileMarks;
  /** Not posted yet: the dim globe posts it. */
  onPost?: () => void;
  /** Posted: the link button copies the share link. */
  onCopyLink?: () => void;
  busy?: boolean;
  menuOpen?: boolean;
  onOpen: () => void;
  onMenu: (left: number, top: number) => void;
  /**
   * What a drag from this tile carries onto a rail folder: itself, or the
   * whole selection when it is part of one.
   */
  dragIds?: string[];
  /** Part of the current selection: ringed, and dragged with the rest. */
  selected?: boolean;
  /** Ctrl-click toggles; Shift-click extends the range. Plain click opens. */
  onSelect?: (mode: "toggle" | "range") => void;
  renaming?: { onCommit: (name: string) => void; onCancel: () => void };
}

export function LibraryTile({
  icon,
  name,
  creator,
  onCreator,
  when,
  tier,
  onTier,
  machines,
  euT,
  social,
  marks = {},
  onPost,
  onCopyLink,
  busy,
  menuOpen,
  onOpen,
  onMenu,
  dragIds,
  selected,
  onSelect,
  renaming,
}: LibraryTileProps) {
  return (
    <div
      draggable={Boolean(dragIds?.length) && !renaming}
      onDragStart={
        dragIds
          ? (event: DragEvent) => {
              event.dataTransfer.setData(DESIGN_DRAG_TYPE, JSON.stringify(dragIds));
              event.dataTransfer.effectAllowed = "move";
            }
          : undefined
      }
      role="button"
      tabIndex={0}
      data-selected={selected ? "true" : undefined}
      onClick={(event) => {
        if (renaming || busy || (event.target as HTMLElement).closest("button, input, a")) {
          return;
        }
        if (onSelect && (event.ctrlKey || event.metaKey)) {
          onSelect("toggle");
          return;
        }
        if (onSelect && event.shiftKey) {
          onSelect("range");
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
      className={[
        "group relative flex h-[84px] cursor-pointer select-none flex-col justify-between rounded border px-2.5 py-2 text-left",
        selected
          ? "border-cyan-400 bg-[#182029] ring-1 ring-cyan-400"
          : "border-line bg-[#151a21] hover:border-line-strong hover:bg-[#182029]",
        menuOpen ? "border-line-strong" : "",
        busy ? "opacity-60" : "",
      ].join(" ")}
    >
      {/* Row one and two: face, title, who and when; tier at the corner. */}
      <div className="flex items-start gap-2.5">
        <Face icon={icon} size={44} />
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center gap-2">
            {renaming ? (
              <InlineName initialName={name} onCommit={renaming.onCommit} onCancel={renaming.onCancel} />
            ) : (
              <span className="min-w-0 flex-1 truncate text-[12px] font-bold leading-tight text-fg group-hover:text-white">
                {name}
              </span>
            )}
            {tier ? (
              onTier ? (
                <button
                  type="button"
                  onClick={onTier}
                  aria-label={`Show setups up to ${tier}`}
                  className="flex shrink-0 rounded ring-cyan-400 hover:ring-2"
                >
                  <TierBadge tier={tier} />
                </button>
              ) : (
                <TierBadge tier={tier} />
              )
            ) : null}
          </div>
          <div className="flex items-center gap-1 text-[10px] text-fg-muted">
            <span className="min-w-0 flex-1 truncate">
              {creator ? (
                onCreator ? (
                  <button
                    type="button"
                    onClick={onCreator}
                    aria-label={`Show setups by ${creator}`}
                    className="rounded text-fg-subtle hover:bg-surface-raised hover:text-cyan-200"
                  >
                    {creator}
                  </button>
                ) : (
                  <span>{creator}</span>
                )
              ) : null}
              {creator ? " · " : ""}
              {when}
            </span>
            <button
              type="button"
              aria-label={`Options for ${name}`}
              aria-expanded={menuOpen}
              onClick={(event) => {
                const rect = event.currentTarget.getBoundingClientRect();
                onMenu(Math.min(rect.left, window.innerWidth - MENU_WIDTH - 8), rect.bottom + 4);
              }}
              className="-my-1 shrink-0 rounded border border-line px-1.5 text-xs leading-none text-fg-muted hover:border-line-strong hover:bg-surface-raised hover:text-fg aria-expanded:text-fg"
            >
              ⋯
            </button>
          </div>
        </div>
      </div>

      {/* Row three: the numbers, then the marks and the social figures. */}
      <div className="flex items-center gap-3 text-[10px] text-fg-muted">
        {machines !== undefined ? <Stat icon={Factory} value={String(machines)} /> : null}
        {euT !== undefined ? (
          <Stat icon={Zap} value={`${formatEuT(euT)} EU/t`} tone="text-amber-300/80" />
        ) : null}
        <span className="ml-auto flex items-center gap-2">
          {busy ? <LoaderCircle className="h-3 w-3 animate-spin" aria-hidden /> : null}
          {marks.open ? (
            <span
              className="rounded bg-surface-raised px-1 text-[9px] font-black uppercase tracking-wide text-fg-subtle"
            >
              open
            </span>
          ) : null}
          {marks.privatePost ? (
            <span className="text-fg-muted" aria-label="Private post">
              <EyeOff className="h-3 w-3" aria-hidden />
            </span>
          ) : null}
          <PostGlyph marks={marks} onPost={onPost} onCopyLink={onCopyLink} />
          {social ? (
            <>
              <button
                type="button"
                disabled={!social.onVote}
                onClick={social.onVote}
                aria-label={social.myVote === 1 ? "Take back your vote" : "Vote this up"}
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
                <span className="flex items-center gap-0.5" aria-label="Downloads">
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
}

function Stat({ icon: Icon, value, tone }: { icon: typeof Factory; value: string; tone?: string }) {
  return (
    <span className="flex items-center gap-1 tabular-nums">
      <Icon className={["h-3 w-3", tone ?? ""].join(" ")} aria-hidden />
      {value}
    </span>
  );
}

/**
 * The globe, always in the same place: green when this is your post (with
 * an amber dot once the board has moved on from it), dim and clickable when
 * it is not posted yet, a download arrow when it came from someone else's
 * setup. A posted tile also carries the link button beside it.
 */
function PostGlyph({
  marks,
  onPost,
  onCopyLink,
}: {
  marks: TileMarks;
  onPost?: () => void;
  onCopyLink?: () => void;
}) {
  if (marks.fromNetwork) {
    return (
      <span aria-label="Opened from a shared setup" className="text-fg-muted">
        <Download className="h-3 w-3" aria-hidden />
      </span>
    );
  }
  if (marks.posted) {
    return (
      <>
        <span
          aria-label={marks.behind ? "Posted, edited since" : "Posted"}
          className="relative inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center text-emerald-400"
        >
          <Globe className="h-3 w-3" aria-hidden />
          {marks.behind ? (
            <span
              aria-hidden
              className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-amber-400 ring-2 ring-[#151a21]"
            />
          ) : null}
        </span>
        {onCopyLink ? (
          <button
            type="button"
            onClick={onCopyLink}
            aria-label="Copy the share link"
            className="rounded p-0.5 text-fg-muted hover:bg-surface-raised hover:text-cyan-200"
          >
            <Link2 className="h-3 w-3" aria-hidden />
          </button>
        ) : null}
      </>
    );
  }
  if (marks.linked) {
    return (
      <span aria-label="Linked to a post" className="text-fg-muted">
        <Link2 className="h-3 w-3" aria-hidden />
      </span>
    );
  }
  if (onPost) {
    return (
      <button
        type="button"
        onClick={onPost}
        aria-label="Post this design to the network"
        className="rounded p-0.5 text-fg-muted/60 hover:bg-surface-raised hover:text-emerald-300"
      >
        <Globe className="h-3 w-3" aria-hidden />
      </button>
    );
  }
  return null;
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
          aria-label={`Remove tag ${tag}`}
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
