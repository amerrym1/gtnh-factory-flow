import { describe, expect, it } from "vitest";
import { FOLD_BUILD_BELOW, FOLD_PAINT_BELOW, toolbarFoldFor } from "./toolbar-fold";

describe("toolbarFoldFor", () => {
  it("keeps both rows open on a board wide enough for both", () => {
    expect(toolbarFoldFor(1228, false)).toEqual({ build: false, paint: false, paintBelow: false });
  });

  it("folds the paint row first: a 1400px window with both columns open", () => {
    // 1400 - 344 - 332: the width that buried the paint tray under POWER.
    expect(toolbarFoldFor(722, false)).toEqual({ build: false, paint: true, paintBelow: false });
    // 1366 - 676: the common laptop, where even the folded paint row crowds it.
    expect(toolbarFoldFor(690, false)).toEqual({ build: true, paint: true, paintBelow: false });
  });

  it("folds the build row too when even the folded paint trigger crowds it", () => {
    expect(toolbarFoldFor(FOLD_BUILD_BELOW - 1, false)).toEqual({ build: true, paint: true, paintBelow: false });
    expect(toolbarFoldFor(FOLD_BUILD_BELOW, false)).toEqual({ build: false, paint: true, paintBelow: false });
  });

  it("orders the thresholds so the paint row always folds before the build row", () => {
    expect(FOLD_PAINT_BELOW).toBeGreaterThan(FOLD_BUILD_BELOW);
  });

  it("compact folds both whatever the width", () => {
    expect(toolbarFoldFor(2000, true)).toEqual({ build: true, paint: true, paintBelow: false });
  });
});

describe("toolbarFoldFor on a board too narrow for both folded rows", () => {
  it("steps the paint row down to the second line", () => {
    // 1000 - 676: both columns open on a small window.
    expect(toolbarFoldFor(322, false)).toEqual({ build: true, paint: true, paintBelow: true });
  });

  it("does the same on a narrow phone", () => {
    expect(toolbarFoldFor(390, true)).toEqual({ build: true, paint: true, paintBelow: true });
    expect(toolbarFoldFor(800, true)).toEqual({ build: true, paint: true, paintBelow: false });
  });
});
