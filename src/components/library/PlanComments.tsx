"use client";

import { LoaderCircle, MessageSquare, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useCommunityUser } from "@/components/community/auth";
import { formatRelativeDate } from "@/components/shelf-cards";
import { deletePlanComment, listPlanComments, postPlanComment } from "@/lib/community/client";
import type { CommunityComment } from "@/lib/community/types";
import { COMMUNITY_COMMENT_MAX_LENGTH } from "@/lib/community/types";

/**
 * The comments on a shared setup, on its focus page. Oldest first, the way
 * a thread reads. Signed in you can post; your own comments, and every
 * comment on your own post, can be deleted. Signed out you can read.
 */
export function PlanComments({ planId }: { planId: string }) {
  const { user } = useCommunityUser();
  const [loaded, setLoaded] = useState<{ planId: string; comments: CommunityComment[] }>();
  const [error, setError] = useState<string>();
  const [draft, setDraft] = useState("");
  const [posting, setPosting] = useState(false);
  const [deletingId, setDeletingId] = useState<string>();
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    listPlanComments(planId).then(
      (comments) => {
        if (!cancelled) {
          setLoaded({ planId, comments });
          setError(undefined);
        }
      },
      (thrown: unknown) => {
        if (!cancelled) {
          setError(thrown instanceof Error ? thrown.message : "Comments could not be loaded.");
        }
      },
    );
    return () => {
      cancelled = true;
    };
    // The viewer changing (sign in, sign out) changes who may delete what.
  }, [planId, user?.username, tick]);

  const comments = loaded?.planId === planId ? loaded.comments : undefined;

  const post = async () => {
    const text = draft.trim();
    if (!text || posting) {
      return;
    }
    setPosting(true);
    try {
      const comment = await postPlanComment(planId, text);
      setLoaded((current) =>
        current && current.planId === planId
          ? { planId, comments: [...current.comments, comment] }
          : { planId, comments: [comment] },
      );
      setDraft("");
      setError(undefined);
    } catch (thrown) {
      setError(thrown instanceof Error ? thrown.message : "The comment could not be posted.");
    } finally {
      setPosting(false);
    }
  };

  const remove = async (comment: CommunityComment) => {
    setDeletingId(comment.id);
    try {
      await deletePlanComment(planId, comment.id);
      setLoaded((current) =>
        current
          ? { ...current, comments: current.comments.filter((entry) => entry.id !== comment.id) }
          : current,
      );
    } catch (thrown) {
      setError(thrown instanceof Error ? thrown.message : "The comment could not be deleted.");
      setTick((value) => value + 1);
    } finally {
      setDeletingId(undefined);
    }
  };

  return (
    <section className="flex flex-col gap-2">
      <h3 className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.14em] text-[var(--mc-ink)]">
        <MessageSquare className="h-3.5 w-3.5 text-[var(--mc-ink-muted)]" aria-hidden />
        Comments
        {comments ? (
          <span className="font-medium text-[var(--mc-ink-muted)]">{comments.length}</span>
        ) : null}
      </h3>

      {/* The box to write in comes first: the thread grows under it. */}
      {user ? (
        <div className="flex items-end gap-2 border-2 border-[var(--mc-33)] bg-[#17191d] px-2.5 py-1.5 shadow-[inset_2px_2px_0_#30343b,inset_-2px_-2px_0_#050607]">
          <textarea
            value={draft}
            onChange={(event) => {
              setDraft(event.target.value.slice(0, COMMUNITY_COMMENT_MAX_LENGTH));
              // Grows with the text, one line at rest.
              event.target.style.height = "auto";
              event.target.style.height = `${Math.min(event.target.scrollHeight, 120)}px`;
            }}
            onKeyDown={(event) => {
              // Enter posts; Shift+Enter breaks a line.
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void post();
              }
            }}
            rows={1}
            placeholder="Write a comment"
            aria-label="Your comment"
            className="min-w-0 flex-1 resize-none bg-transparent py-0.5 text-[12px] leading-relaxed text-neutral-100 outline-none placeholder:text-neutral-500"
          />
          <button
            type="button"
            disabled={!draft.trim() || posting}
            onClick={() => void post()}
            aria-label="Post the comment"
            className="flex h-6 shrink-0 items-center gap-1 text-[11px] font-bold text-cyan-300 hover:text-cyan-100 disabled:text-neutral-600"
          >
            {posting ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden /> : null}
            Post
          </button>
        </div>
      ) : (
        <p className="text-[11px] text-[var(--mc-ink-muted)]">Sign in (top right) to comment.</p>
      )}

      {error ? <p className="text-[11px] text-red-400">{error}</p> : null}

      {!comments ? (
        <div className="flex h-8 items-center">
          <LoaderCircle className="h-4 w-4 animate-spin text-neutral-400" aria-label="Loading" />
        </div>
      ) : comments.length === 0 ? (
        <p className="text-[12px] text-[var(--mc-ink-muted)]">No comments yet.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-[var(--mc-33)]">
          {comments.map((comment) => (
            <li key={comment.id} className="group flex flex-col gap-0.5 py-2">
              <div className="flex items-center gap-2 text-[11px]">
                <span className="font-bold text-neutral-100">{comment.authorName}</span>
                <span className="text-[var(--mc-ink-muted)]">
                  {formatRelativeDate(comment.createdAt)}
                </span>
                {comment.canDelete ? (
                  <button
                    type="button"
                    disabled={deletingId === comment.id}
                    onClick={() => void remove(comment)}
                    aria-label="Delete this comment"
                    className="ml-auto text-[var(--mc-ink-muted)] opacity-0 hover:text-red-300 focus:opacity-100 group-hover:opacity-100 disabled:opacity-50"
                  >
                    {deletingId === comment.id ? (
                      <LoaderCircle className="h-3 w-3 animate-spin" aria-hidden />
                    ) : (
                      <X className="h-3 w-3" aria-hidden />
                    )}
                  </button>
                ) : null}
              </div>
              <p className="whitespace-pre-wrap break-words text-[12px] leading-relaxed text-neutral-300">
                {comment.body}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
