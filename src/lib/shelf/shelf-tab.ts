"use client";

import { useSyncExternalStore } from "react";
import { leaveWelcomeTab } from "@/lib/welcome/welcome-tab";

/**
 * The Shelf: every design you have, open or not, in folders.
 *
 * It is not a tab and not a design. It sits at the head of the tab strip as
 * a fixed square, and like Welcome it COVERS the board rather than replacing
 * it, so nothing about the plan underneath is unmounted while it is up.
 *
 * The strip shows OPEN designs; the shelf shows all of them. Closing a tab
 * puts the design back on the shelf, opening one from the shelf puts it on
 * the strip. Nothing here is ever deleted by closing.
 *
 * `active` and `view` live in sessionStorage: a reload while you are on the
 * shelf lands you back on it, in the same folder, and a new visit starts on
 * whatever design was open. Same scope Welcome uses for the same reason.
 */
export type ShelfView =
  | { kind: "all" }
  | { kind: "open" }
  | { kind: "shared" }
  | { kind: "unfiled" }
  | { kind: "folder"; folderId: string };

export interface ShelfTabState {
  /** It is the thing being shown, covering the board. */
  active: boolean;
  view: ShelfView;
}

const SHELF_SESSION_KEY = "gtnh-factory-flow-shelf";

const CLOSED: ShelfTabState = { active: false, view: { kind: "all" } };

let state: ShelfTabState = CLOSED;
let loaded = false;
const listeners = new Set<() => void>();

function readStored(): ShelfTabState {
  try {
    const raw = window.sessionStorage.getItem(SHELF_SESSION_KEY);
    if (!raw) {
      return CLOSED;
    }
    const parsed = JSON.parse(raw) as Partial<ShelfTabState>;
    return {
      active: parsed.active === true,
      view: isShelfView(parsed.view) ? parsed.view : { kind: "all" },
    };
  } catch {
    return CLOSED;
  }
}

function isShelfView(value: unknown): value is ShelfView {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const kind = (value as { kind?: unknown }).kind;
  if (kind === "folder") {
    return typeof (value as { folderId?: unknown }).folderId === "string";
  }
  return kind === "all" || kind === "open" || kind === "shared" || kind === "unfiled";
}

function getSnapshot(): ShelfTabState {
  if (!loaded) {
    loaded = true;
    state = readStored();
  }
  return state;
}

function getServerSnapshot(): ShelfTabState {
  return CLOSED;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function write(patch: Partial<ShelfTabState>) {
  state = { ...getSnapshot(), ...patch };
  try {
    window.sessionStorage.setItem(SHELF_SESSION_KEY, JSON.stringify(state));
  } catch {
    // Blocked storage costs the reload its place, nothing more.
  }
  for (const listener of listeners) {
    listener();
  }
}

export function useShelfTab(): ShelfTabState {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/** The current state without subscribing. For tests and one-shot reads. */
export function readShelfTabState(): ShelfTabState {
  return getSnapshot();
}

/**
 * Show the shelf, on `view` if given and otherwise wherever it was last.
 * Exactly one of Welcome and the shelf can be up, so Welcome steps down.
 */
export function openShelf(view?: ShelfView) {
  leaveWelcomeTab();
  write({ active: true, ...(view ? { view } : {}) });
}

/** Change what the open shelf is looking at. */
export function setShelfView(view: ShelfView) {
  write({ view });
}

/** Step off the shelf onto whatever design is active. */
export function leaveShelf() {
  if (!getSnapshot().active) {
    return;
  }
  write({ active: false });
}

export function sameShelfView(left: ShelfView, right: ShelfView): boolean {
  if (left.kind !== right.kind) {
    return false;
  }
  return left.kind !== "folder" || left.folderId === (right as { folderId: string }).folderId;
}
