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
export type LibraryView =
  /* MINE: your designs. */
  | { kind: "all" }
  | { kind: "open" }
  | { kind: "shared" }
  | { kind: "unfiled" }
  | { kind: "folder"; folderId: string }
  /* NETWORK: everyone's public setups. */
  | { kind: "public" }
  /* BOARDS: saved chunks to place, yours and everyone's. */
  | { kind: "boards" }
  | { kind: "public-boards" };

export interface LibraryTabState {
  /** It is the thing being shown, covering the board. */
  active: boolean;
  view: LibraryView;
}

const SHELF_SESSION_KEY = "gtnh-factory-flow-library";

const CLOSED: LibraryTabState = { active: false, view: { kind: "all" } };

let state: LibraryTabState = CLOSED;
let loaded = false;
const listeners = new Set<() => void>();

function readStored(): LibraryTabState {
  try {
    const raw = window.sessionStorage.getItem(SHELF_SESSION_KEY);
    if (!raw) {
      return CLOSED;
    }
    const parsed = JSON.parse(raw) as Partial<LibraryTabState>;
    return {
      active: parsed.active === true,
      view: isShelfView(parsed.view) ? parsed.view : { kind: "all" },
    };
  } catch {
    return CLOSED;
  }
}

function isShelfView(value: unknown): value is LibraryView {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const kind = (value as { kind?: unknown }).kind;
  if (kind === "folder") {
    return typeof (value as { folderId?: unknown }).folderId === "string";
  }
  return (
    kind === "all" ||
    kind === "open" ||
    kind === "shared" ||
    kind === "unfiled" ||
    kind === "public" ||
    kind === "boards" ||
    kind === "public-boards"
  );
}

function getSnapshot(): LibraryTabState {
  if (!loaded) {
    loaded = true;
    state = readStored();
  }
  return state;
}

function getServerSnapshot(): LibraryTabState {
  return CLOSED;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function write(patch: Partial<LibraryTabState>) {
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

export function useLibraryTab(): LibraryTabState {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/** The current state without subscribing. For tests and one-shot reads. */
export function readLibraryTabState(): LibraryTabState {
  return getSnapshot();
}

/**
 * Show the shelf, on `view` if given and otherwise wherever it was last.
 * Exactly one of Welcome and the shelf can be up, so Welcome steps down.
 */
export function openLibrary(view?: LibraryView) {
  leaveWelcomeTab();
  write({ active: true, ...(view ? { view } : {}) });
}

/** Change what the open shelf is looking at. */
export function setLibraryView(view: LibraryView) {
  write({ view });
}

/** Step off the shelf onto whatever design is active. */
export function leaveLibrary() {
  if (!getSnapshot().active) {
    return;
  }
  write({ active: false });
}
