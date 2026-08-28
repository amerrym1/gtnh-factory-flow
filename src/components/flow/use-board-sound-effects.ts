"use client";

import { useEffect } from "react";
import type { FactoryProject } from "@/lib/model/types";
import { playBoardSound, primeBoardSounds } from "@/lib/board-sounds";
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
 * There is deliberately NO generic click sound. A tick on every button was
 * tried and rejected: sound marks the PLAN changing, not the mouse working.
 */

interface ProjectSoundSnapshot {
  projectId: string;
  nodeIds: Set<string>;
  edgeIds: Set<string>;
  openPocketIds: Set<string>;
  /**
   * Every card serialized WITHOUT its position: machine counts, tiers,
   * drain pills, config choices. When the structure is unchanged but this
   * moved, a knob was turned somewhere and the adjust tap plays. Positions
   * are excluded so drags stay silent; a project write only happens per
   * user action, so the stringify cost is nothing.
   */
  configSignature: string;
}

export function snapshotProject(project: FactoryProject): ProjectSoundSnapshot {
  const nodeIds = new Set<string>();
  const signatureParts: string[] = [];
  for (const node of project.nodes) {
    nodeIds.add(node.id);
    const { position: _position, ...rest } = node;
    signatureParts.push(JSON.stringify(rest));
  }
  for (const storage of project.storages ?? []) {
    nodeIds.add(storage.id);
    const { position: _position, ...rest } = storage;
    signatureParts.push(JSON.stringify(rest));
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
  return {
    projectId: project.id,
    nodeIds,
    edgeIds,
    openPocketIds,
    configSignature: signatureParts.join("\n"),
  };
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

export function playProjectDiff(prev: ProjectSoundSnapshot, next: ProjectSoundSnapshot): void {
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

  // Nothing structural moved, but a card's settings did: a machine count
  // stepped, a drain pill cycled, a config chosen. One neutral tap.
  if (total === 0 && opened === 0 && closed === 0) {
    if (next.configSignature !== prev.configSignature) {
      playBoardSound("adjust");
    }
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

    // Warm the audio path on the first gesture so the first REAL sound
    // never plays into a cold output stream (Chrome parks the hardware
    // stream during silence and eats short notes while it wakes).
    const prime = () => primeBoardSounds();
    window.addEventListener("pointerdown", prime, { once: true, passive: true });

    return () => {
      unsubscribe();
      window.removeEventListener("pointerdown", prime);
    };
  }, []);
}
