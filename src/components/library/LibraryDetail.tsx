"use client";

import {
  ArrowBigUp,
  ArrowLeft,
  Check,
  Download,
  EyeOff,
  Globe,
  Image as ImageIcon,
  Link2,
  MessageSquare,
  Upload,
  X,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { formatSlotRate } from "@/components/flow/flow-explainers";
import { fluidArtPixels, isSwatchFluid, ResourceIcon } from "@/components/nei/ResourceIcon";
import { TierBadge, type VoltageTier } from "@/components/shelf-cards";
import type { PlanResourceStat } from "@/lib/community/types";
import type { EntryIcon } from "@/lib/model/types";
import { Face, formatEuT, type TileMarks } from "./LibraryTile";

/**
 * The step between a tile and the board: the grid gives way to one page
 * that fits on one screen. A short strip of the board photograph across
 * the top, then the face, name, who and when, the figures, a short toolbar
 * of ICON keys (vote, link, visibility, close tab, delete) and one big
 * Open button; the description; needs and makes as tight columns; then
 * the comments. Back (or Escape) brings the grid back. Not a popup.
 */

/** The board photograph a post carries, taken when it was shared. */
export function previewUrlFor(planId: string): string {
  return `/api/community/plans/${encodeURIComponent(planId)}/preview`;
}

export interface DetailKey {
  /** What the key does, read aloud. */
  label: string;
  icon: "vote" | "link" | "public" | "private" | "post" | "close" | "delete";
  onClick: () => void;
  /** Lit, for a vote already cast. */
  active?: boolean;
  /** A number beside the icon: the vote count. */
  count?: number;
  /** Two clicks: the first arms, the second fires. */
  arm?: boolean;
}

export interface LibraryDetailEntry {
  name: string;
  icon?: EntryIcon;
  creator?: string;
  when: string;
  tier?: VoltageTier;
  machines?: number;
  euT?: number;
  downloads?: number;
  description?: string;
  tags?: string[];
  needs?: PlanResourceStat[];
  outputs?: PlanResourceStat[];
  /** The board photograph, when there is one. */
  previewUrl?: string;
  marks?: TileMarks;
  /** The big button: Open, or Open as a tab. */
  primary: { label: string; onClick: () => void };
  /** The icon keys beside it. */
  keys?: DetailKey[];
}

export function LibraryDetail({
  entry,
  onClose,
}: {
  entry: LibraryDetailEntry;
  onClose: () => void;
}) {
  // The picture is probed up front: an <img> that 404s before React has
  // attached its onError never reports, and the frame would sit dark.
  const [probed, setProbed] = useState<{ url: string; ok: boolean }>();
  const [armedKey, setArmedKey] = useState<string>();
  const [flashKey, setFlashKey] = useState<string>();
  const marks = entry.marks ?? {};
  useEffect(() => {
    if (!entry.previewUrl) {
      return;
    }
    const url = entry.previewUrl;
    let alive = true;
    const probe = new Image();
    probe.onload = () => alive && setProbed({ url, ok: true });
    probe.onerror = () => alive && setProbed({ url, ok: false });
    probe.src = url;
    return () => {
      alive = false;
    };
  }, [entry.previewUrl]);
  const picture: "loading" | "ok" | "none" = !entry.previewUrl
    ? "none"
    : probed?.url === entry.previewUrl
      ? probed.ok
        ? "ok"
        : "none"
      : "loading";

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  const pressKey = (key: DetailKey) => {
    if (key.arm && armedKey !== key.label) {
      setArmedKey(key.label);
      return;
    }
    setArmedKey(undefined);
    key.onClick();
    if (key.icon === "link") {
      setFlashKey(key.label);
      window.setTimeout(() => setFlashKey((current) => (current === key.label ? undefined : current)), 1200);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden text-fg">
      {/* THE PHOTOGRAPH: the top half, whole, never cropped. */}
      <div className="relative h-1/2 w-full shrink-0 bg-[#0b0e12]">
        {picture === "ok" && entry.previewUrl ? (
          // Not next/image: the picture is served by our own route and
          // changes when the post is re-shared.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={entry.previewUrl} alt="" className="h-full w-full object-contain" />
        ) : picture === "loading" ? null : (
          <div className="flex h-full w-full items-center justify-center gap-2 text-[12px] text-fg-muted">
            <ImageIcon className="h-4 w-4 opacity-50" aria-hidden />
            {entry.previewUrl
              ? "No picture of this board yet."
              : "No picture yet. One is taken when the design is posted."}
          </div>
        )}
        <button
          type="button"
          onClick={onClose}
          className="absolute left-3 top-3 flex h-7 items-center gap-1.5 rounded border border-line bg-[#12161b]/90 px-2 text-xs font-medium text-fg-subtle hover:text-fg"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
          Back
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="flex flex-col gap-3 px-5 py-3 compact:px-3">
          {/* FACE, NAME, WHO, WHEN, FIGURES; the keys and Open on the right. */}
          <div className="flex items-start gap-3">
            <Face icon={entry.icon} size={48} />
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <div className="flex items-center gap-2">
                <h2 className="min-w-0 truncate text-[17px] font-black leading-tight text-white">
                  {entry.name}
                </h2>
                {entry.tier ? <TierBadge tier={entry.tier} /> : null}
                {marks.open ? (
                  <span className="rounded bg-surface-raised px-1 text-[9px] font-black uppercase tracking-wide text-fg-subtle">
                    open
                  </span>
                ) : null}
              </div>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[12px] text-fg-muted">
                <span>
                  {entry.creator ? <span className="text-fg-subtle">{entry.creator}</span> : null}
                  {entry.creator ? " · " : ""}
                  {entry.when}
                </span>
                {entry.machines !== undefined ? (
                  <span>
                    <span className="font-bold text-fg-subtle">{entry.machines}</span> machines
                  </span>
                ) : null}
                {entry.euT !== undefined ? (
                  <span>
                    <span className="font-bold text-amber-300">{formatEuT(entry.euT)}</span> EU/t
                  </span>
                ) : null}
                {entry.downloads !== undefined ? (
                  <span className="flex items-center gap-1">
                    <Download className="h-3 w-3" aria-hidden />
                    {entry.downloads}
                  </span>
                ) : null}
                {marks.posted ? (
                  <span className="flex items-center gap-1 text-emerald-400">
                    <Globe className="h-3 w-3" aria-hidden />
                    {marks.behind ? "posted, edited since" : marks.privatePost ? "posted, private" : "posted"}
                  </span>
                ) : null}
              </div>
              {entry.description ? (
                <p className="mt-1 line-clamp-3 whitespace-pre-wrap text-[12px] leading-relaxed text-fg-subtle">
                  {entry.description}
                </p>
              ) : null}
              {entry.tags && entry.tags.length > 0 ? (
                <div className="mt-1 flex flex-wrap gap-1">
                  {entry.tags.map((tag) => (
                    <span
                      key={tag}
                      className="rounded border border-neutral-700 bg-[#17191d] px-1.5 text-[10px] text-neutral-300"
                    >
                      #{tag}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>

            {/* THE KEYS. Icons, one job each, read by their label. */}
            <div className="flex shrink-0 flex-col items-end gap-1.5">
              <button
                type="button"
                onClick={entry.primary.onClick}
                className="flex h-7 items-center rounded border border-cyan-500/60 bg-cyan-500/20 px-3 text-[12px] font-bold text-cyan-100 hover:bg-cyan-500/30"
              >
                {entry.primary.label}
              </button>
              <div className="flex items-center gap-1">
                {entry.keys?.map((key) => (
                  <IconKey
                    key={key.label}
                    label={armedKey === key.label ? `${key.label}: click again` : key.label}
                    active={key.active}
                    armed={armedKey === key.label}
                    danger={key.icon === "delete"}
                    count={key.count}
                    onClick={() => pressKey(key)}
                  >
                    {flashKey === key.label ? (
                      <Check className="h-3 w-3 text-emerald-300" aria-hidden />
                    ) : (
                      keyIcon(key.icon)
                    )}
                  </IconKey>
                ))}
              </div>
            </div>
          </div>

          {/* NEEDS AND MAKES: tight columns, all of them. */}
          {(entry.needs && entry.needs.length > 0) || (entry.outputs && entry.outputs.length > 0) ? (
            <div className="grid grid-cols-2 gap-3 compact:grid-cols-1">
              <StatColumns label="Needs" stats={entry.needs ?? []} />
              <StatColumns label="Makes" stats={entry.outputs ?? []} />
            </div>
          ) : null}

          {/* COMMENTS: the shape of it, not yet the thing. */}
          <section className="flex flex-col gap-1.5 border-t border-line pt-3">
            <h3 className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.14em] text-[#aebccd]">
              <MessageSquare className="h-3.5 w-3.5 text-fg-muted" aria-hidden />
              Comments
            </h3>
            <p className="text-[12px] text-fg-muted">No comments yet.</p>
            <div className="flex items-center gap-2 rounded border border-line bg-[#151a21] px-2 py-1.5 opacity-60">
              <input
                disabled
                placeholder="Say something about this setup"
                className="min-w-0 flex-1 bg-transparent text-[12px] text-fg outline-none placeholder:text-fg-muted"
              />
              <span className="text-[10px] text-fg-muted">coming soon</span>
              <button
                type="button"
                disabled
                className="h-6 rounded border border-line-strong bg-surface px-2.5 text-[11px] font-medium text-fg-muted"
              >
                Post
              </button>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function keyIcon(icon: DetailKey["icon"]): ReactNode {
  switch (icon) {
    case "vote":
      return <ArrowBigUp className="h-3 w-3" aria-hidden />;
    case "link":
      return <Link2 className="h-3 w-3" aria-hidden />;
    case "public":
      return <Globe className="h-3 w-3" aria-hidden />;
    case "private":
      return <EyeOff className="h-3 w-3" aria-hidden />;
    case "post":
      return <Upload className="h-3 w-3" aria-hidden />;
    case "close":
      return <X className="h-3 w-3" aria-hidden />;
    case "delete":
      return <X className="h-3 w-3" aria-hidden />;
  }
}

function IconKey({
  label,
  active,
  armed,
  danger,
  count,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  armed?: boolean;
  danger?: boolean;
  count?: number;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={[
        "flex h-6 min-w-6 items-center justify-center gap-1 rounded border px-1.5 text-[10px] font-medium",
        armed
          ? "border-red-500 bg-red-950 text-red-200"
          : active
            ? "border-cyan-500 bg-cyan-500/15 text-cyan-200"
            : danger
              ? "border-line-strong bg-surface text-fg-muted hover:border-red-700 hover:text-red-300"
              : "border-line-strong bg-surface text-fg-subtle hover:border-line-strong hover:text-fg",
      ].join(" ")}
    >
      {children}
      {count !== undefined ? <span className="tabular-nums">{count}</span> : null}
    </button>
  );
}

/** One side of needs or makes: every stat, in as many columns as fit. */
function StatColumns({ label, stats }: { label: string; stats: PlanResourceStat[] }) {
  return (
    <div className="min-w-0 rounded border border-line bg-[#151a21] p-2">
      <div className="mb-1 text-[10px] font-black uppercase tracking-[0.14em] text-[#aebccd]">
        {label}
        <span className="ml-1.5 font-medium text-fg-muted">{stats.length}</span>
      </div>
      {stats.length === 0 ? (
        <div className="text-[11px] text-fg-muted">Nothing</div>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-x-3 gap-y-0.5">
          {stats.map((stat) => (
            <div key={`${stat.kind}:${stat.resourceId}`} className="flex min-w-0 items-center gap-1.5">
              <span className="flex h-4 w-4 shrink-0 items-center justify-center overflow-hidden">
                <ResourceIcon
                  resource={{ ...stat, id: stat.resourceId, amount: 1 }}
                  bare
                  tooltip={false}
                  showAmount={false}
                  iconPixelSize={
                    stat.kind === "fluid" ? (isSwatchFluid(stat) ? 30 : fluidArtPixels(16)) : undefined
                  }
                  className={stat.kind === "fluid" ? "!h-4 !w-4" : "!h-4 !w-4 origin-center scale-150"}
                />
              </span>
              <span className="min-w-0 flex-1 truncate text-[11px] text-fg-subtle">
                {stat.displayName ?? stat.resourceId}
              </span>
              <span className="shrink-0 tabular-nums text-[11px] text-fg-muted">
                {formatSlotRate(stat.ratePerSecond, stat.kind)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
