"use client";

import {
  ArrowBigUp,
  ArrowLeft,
  Download,
  Globe,
  Image as ImageIcon,
  Link2,
  MessageSquare,
} from "lucide-react";
import { useEffect, useState } from "react";
import { renderIoStats, TierBadge, type VoltageTier } from "@/components/shelf-cards";
import type { PlanResourceStat } from "@/lib/community/types";
import type { EntryIcon } from "@/lib/model/types";
import { Face, formatEuT, type TileMarks, type TileSocial } from "./LibraryTile";

/**
 * The step between a tile and the board: the grid gives way to one page
 * with the board's photograph on top, the design's face and figures under
 * it, its actions, what it needs and makes, and the comments. Not a popup:
 * it stands where the grid stood, and Back (or Escape) brings the grid
 * back.
 *
 * The photograph is the one the post carries (taken when it was shared);
 * a design that was never posted shows a placeholder until it is.
 * Comments are laid out but not wired: the section says so.
 */

/** The board photograph a post carries, taken when it was shared. */
export function previewUrlFor(planId: string): string {
  return `/api/community/plans/${encodeURIComponent(planId)}/preview`;
}

export interface LibraryDetailEntry {
  name: string;
  icon?: EntryIcon;
  creator?: string;
  when: string;
  tier?: VoltageTier;
  machines?: number;
  euT?: number;
  description?: string;
  tags?: string[];
  needs?: PlanResourceStat[];
  outputs?: PlanResourceStat[];
  /** The board photograph, when there is one. */
  previewUrl?: string;
  social?: TileSocial;
  marks?: TileMarks;
  /** The big button: Open, or Open as a tab. */
  primary: { label: string; onClick: () => void };
  /** The rest, as plain buttons under it. */
  actions?: { label: string; onClick: () => void; tone?: "danger" }[];
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
  // Derived from the probe, so nothing is set during the effect itself.
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

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden text-fg">
      <div className="flex min-h-0 flex-1 flex-col">
        {/* THE PHOTOGRAPH. */}
        <div className="relative aspect-[16/7] w-full shrink-0 bg-[#0b0e12]">
          {picture === "ok" && entry.previewUrl ? (
            // Not next/image: the picture is served by our own route and
            // changes when the post is re-shared.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={entry.previewUrl}
              alt=""
              className="h-full w-full object-contain"
            />
          ) : picture === "loading" ? null : (
            <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-fg-muted">
              <ImageIcon className="h-8 w-8 opacity-40" aria-hidden />
              <span className="text-[12px]">
                {entry.previewUrl
                  ? "No picture of this board yet. One is taken when it is next shared."
                  : "No picture yet. One is taken when the design is posted."}
              </span>
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
          <div className="flex flex-col gap-4 px-5 py-4 compact:px-3">
            {/* FACE, NAME, WHO, WHEN, TIER. */}
            <div className="flex items-start gap-3">
              <Face icon={entry.icon} size={56} />
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <div className="flex items-center gap-2">
                  <h2 className="min-w-0 flex-1 truncate text-[18px] font-black leading-tight text-white">
                    {entry.name}
                  </h2>
                  {entry.tier ? <TierBadge tier={entry.tier} /> : null}
                </div>
                <div className="flex items-center gap-2 text-[12px] text-fg-muted">
                  {entry.creator ? <span className="text-fg-subtle">{entry.creator}</span> : null}
                  {entry.creator ? <span>·</span> : null}
                  <span>{entry.when}</span>
                  {marks.open ? (
                    <span className="rounded bg-surface-raised px-1 text-[9px] font-black uppercase tracking-wide text-fg-subtle">
                      open
                    </span>
                  ) : null}
                  {marks.posted ? (
                    <span className="flex items-center gap-1 text-emerald-400">
                      <Globe className="h-3 w-3" aria-hidden />
                      {marks.behind ? "posted, edited since" : marks.privatePost ? "posted, private" : "posted"}
                    </span>
                  ) : null}
                </div>
                <div className="flex items-center gap-4 text-[12px] text-fg-subtle">
                  {entry.machines !== undefined ? (
                    <span>
                      <span className="font-bold text-fg">{entry.machines}</span> machines
                    </span>
                  ) : null}
                  {entry.euT !== undefined ? (
                    <span>
                      <span className="font-bold text-amber-300">{formatEuT(entry.euT)}</span> EU/t
                    </span>
                  ) : null}
                  {entry.social ? (
                    <>
                      <span className="flex items-center gap-1">
                        <ArrowBigUp className="h-3.5 w-3.5" aria-hidden />
                        {entry.social.score}
                      </span>
                      {entry.social.downloads !== undefined ? (
                        <span className="flex items-center gap-1">
                          <Download className="h-3.5 w-3.5" aria-hidden />
                          {entry.social.downloads}
                        </span>
                      ) : null}
                    </>
                  ) : null}
                </div>
              </div>
            </div>

            {/* ACTIONS. */}
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={entry.primary.onClick}
                className="flex h-8 items-center gap-1.5 rounded border border-cyan-500/60 bg-cyan-500/20 px-3.5 text-[13px] font-bold text-cyan-100 hover:bg-cyan-500/30"
              >
                {entry.primary.label}
              </button>
              {entry.social?.onVote ? (
                <button
                  type="button"
                  onClick={entry.social.onVote}
                  className={[
                    "flex h-8 items-center gap-1 rounded border px-3 text-[12px] font-medium",
                    entry.social.myVote === 1
                      ? "border-cyan-500 bg-cyan-500/15 text-cyan-200"
                      : "border-line-strong bg-surface text-fg-subtle hover:text-fg",
                  ].join(" ")}
                >
                  <ArrowBigUp className="h-3.5 w-3.5" aria-hidden />
                  {entry.social.myVote === 1 ? "Voted" : "Vote up"}
                </button>
              ) : null}
              {entry.actions?.map((action) => (
                <button
                  key={action.label}
                  type="button"
                  onClick={action.onClick}
                  className={[
                    "flex h-8 items-center gap-1 rounded border px-3 text-[12px] font-medium",
                    action.tone === "danger"
                      ? "border-red-800 bg-red-950/60 text-red-300 hover:border-red-600"
                      : "border-line-strong bg-surface text-fg-subtle hover:text-fg",
                  ].join(" ")}
                >
                  {action.label === "Copy link" ? <Link2 className="h-3.5 w-3.5" aria-hidden /> : null}
                  {action.label}
                </button>
              ))}
            </div>

            {entry.description ? (
              <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-fg-subtle">
                {entry.description}
              </p>
            ) : null}

            {entry.tags && entry.tags.length > 0 ? (
              <div className="flex flex-wrap gap-1">
                {entry.tags.map((tag) => (
                  <span
                    key={tag}
                    className="rounded border border-neutral-700 bg-[#17191d] px-1.5 text-[11px] text-neutral-300"
                  >
                    #{tag}
                  </span>
                ))}
              </div>
            ) : null}

            {(entry.needs && entry.needs.length > 0) || (entry.outputs && entry.outputs.length > 0) ? (
              <div className="rounded border border-line bg-[#151a21] p-3">
                {renderIoStats(entry.needs ?? [], entry.outputs ?? [], {
                  layout: "side-by-side",
                  limit: 24,
                })}
              </div>
            ) : null}

            {/* COMMENTS: the shape of it, not yet the thing. */}
            <section className="flex flex-col gap-2 border-t border-line pt-4">
              <h3 className="flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.14em] text-[#aebccd]">
                <MessageSquare className="h-3.5 w-3.5 text-fg-muted" aria-hidden />
                Comments
              </h3>
              <p className="text-[12px] text-fg-muted">No comments yet.</p>
              <div className="flex flex-col gap-1.5 rounded border border-line bg-[#151a21] p-2 opacity-60">
                <textarea
                  disabled
                  rows={2}
                  placeholder="Say something about this setup"
                  className="w-full resize-none bg-transparent text-[13px] text-fg outline-none placeholder:text-fg-muted"
                />
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-fg-muted">Comments are coming soon.</span>
                  <button
                    type="button"
                    disabled
                    className="h-7 rounded border border-line-strong bg-surface px-3 text-[12px] font-medium text-fg-muted"
                  >
                    Post
                  </button>
                </div>
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
