"use client";

import { useSyncExternalStore } from "react";
import { subscribeTourState } from "./tour-state";

/**
 * Whether the board is showing the loop-diseases EXAMPLE notices.
 *
 * The "When a line feeds itself" step describes two failures this healthy
 * board does not have, and a notice the reader has never seen is a shape
 * they will not recognise when it is real. So the step conjures the two
 * banners at the bottom of the board, marked as examples, and the plan is
 * never touched - the board stays exactly as solved.
 *
 * Same module-state shape as tour-state.ts. Any step change hides the
 * example (the incoming step's own `before` re-shows it when it wants it),
 * so leaving the step sideways - Back, a dot jump, Esc - can never strand
 * a specimen banner on the board. Subscribed lazily, not at module scope:
 * tour-state -> lessons -> this module is a cycle, and an eval-time call
 * could run against a half-initialised module.
 */
let shown = false;
const listeners = new Set<() => void>();
let cancelArmed = false;

function publish(next: boolean) {
  if (shown === next) {
    return;
  }
  shown = next;
  for (const listener of listeners) {
    listener();
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useTourLoopNoticeExample(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => shown,
    () => false,
  );
}

export function showTourLoopNoticeExample(): void {
  if (!cancelArmed) {
    cancelArmed = true;
    subscribeTourState(() => publish(false));
  }
  publish(true);
}

export function hideTourLoopNoticeExample(): void {
  publish(false);
}
