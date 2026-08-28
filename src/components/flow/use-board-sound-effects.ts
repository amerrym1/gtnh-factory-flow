"use client";

import { useEffect } from "react";
import type { FactoryProject } from "@/lib/model/types";
import { playBoardSound } from "@/lib/board-sounds";
import { useFactoryStore } from "@/store/factory-store";

/**
 * Plays the board's interface sounds by WATCHING the project rather than by
 * instrumenting call sites. Every way a card can land (recipe book add,
 * drawer drag, paste, refactor, undo) funnels through the store, so a diff
 * of ids between one project and the next catches all of them - including
 * paths added later, which is the point.
 *
 * Rules, in order:
 * - A tab switch or plan load (the project id changed) is silent: nothing
 *   was DONE, the view just moved.
 * - A bulk change (an arrange, a paste, a big multi-delete) plays ONE soft
 *   sweep instead of a drum roll.
 * - Otherwise one sound per category: cards landing beats wires (a drawer
 *   drag makes both, and the thump tells the story), boards opening and
 *   closing speak for themselves.
 *
 * Undo and redo are deliberately NOT special-cased: undoing a delete diffs
 * as an add and thumps like one, which is what the hand just did.
 *
 * The hook also gives every button in the app a barely-there tick, on
 * pointerdown so it lands with the finger rather than after the release.
 */

interface ProjectSoundSnapshot {
  projectId: string;
  nodeIds: Set<string>;
  edgeIds: Set<string>;
  openPocketIds: Set<string>;
}

function snapshotProject(project: FactoryProject): ProjectSoundSnapshot {
  const nodeIds = new Set<string>();
  for (const node of project.nodes) {
    nodeIds.add(node.id);
  }
  for (const storage of project.storages ?? []) {
    nodeIds.add(storage.id);
  }
  const edgeIds = new Set<string>();
  for (const edge of project.edges) {
    edgeIds.add(edge.id);
  }
  const openPocketIds = new Set<string>();
  for (const pocket of project.pockets ?? []) {
    if (pocket.expanded) {
      openPocketIds.add(pocket.id);
    }
  }
  return { projectId: project.id, nodeIds, edgeIds, openPocketIds };
}

function countMissing(from: Set<string>, inSet: Set<string>): number {
  let count = 0;
  for (const id of from) {
    if (!inSet.has(id)) {
      count += 1;
    }
  }
  return count;
}

/** At or past this many changed ids, one change is a bulk change. */
const BULK_THRESHOLD = 8;

function playProjectDiff(prev: ProjectSoundSnapshot, next: ProjectSoundSnapshot): void {
  const addedNodes = countMissing(next.nodeIds, prev.nodeIds);
  const removedNodes = countMissing(prev.nodeIds, next.nodeIds);
  const addedEdges = countMissing(next.edgeIds, prev.edgeIds);
  const removedEdges = countMissing(prev.edgeIds, next.edgeIds);
  const opened = countMissing(next.openPocketIds, prev.openPocketIds);
  const closed = countMissing(prev.openPocketIds, next.openPocketIds);

  const total = addedNodes + removedNodes + addedEdges + removedEdges;
  if (total >= BULK_THRESHOLD) {
    playBoardSound("sweep");
    return;
  }

  if (addedNodes > 0) {
    playBoardSound("place");
  } else if (addedEdges > 0) {
    playBoardSound("connect");
  }
  if (removedNodes > 0) {
    playBoardSound("delete");
  } else if (removedEdges > 0) {
    playBoardSound("unwire");
  }
  if (opened > 0) {
    playBoardSound("open");
  } else if (closed > 0) {
    playBoardSound("close");
  }
}

export function useBoardSoundEffects(): void {
  useEffect(() => {
    let snapshot = snapshotProject(useFactoryStore.getState().project);

    const unsubscribe = useFactoryStore.subscribe((state, prevState) => {
      if (state.project === prevState.project) {
        return;
      }
      const next = snapshotProject(state.project);
      const prev = snapshot;
      snapshot = next;
      // A different plan arriving is navigation, not an action.
      if (next.projectId !== prev.projectId) {
        return;
      }
      playProjectDiff(prev, next);
    });

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) {
        return;
      }
      if (target.closest("button, [role='button']")) {
        playBoardSound("tick");
      }
    };
    document.addEventListener("pointerdown", onPointerDown, { capture: true, passive: true });

    return () => {
      unsubscribe();
      document.removeEventListener("pointerdown", onPointerDown, { capture: true });
    };
  }, []);
}
