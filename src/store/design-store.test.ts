import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DesignSummary } from "@/lib/designs/design-library";

const storage = vi.hoisted(() => ({
  listDesignSummaries: vi.fn<() => Promise<DesignSummary[]>>(),
  readDesign: vi.fn(),
  writeDesign: vi.fn(async () => undefined),
  writeDesignSummary: vi.fn(async () => undefined),
  deleteDesign: vi.fn(async () => undefined),
  readActiveDesignId: vi.fn<() => string | undefined>(),
  writeActiveDesignId: vi.fn(),
}));

vi.mock("@/lib/designs/design-storage", () => storage);
vi.mock("@/lib/designs/design-camera", () => ({
  keepDesignCameras: vi.fn(),
  forgetDesignCameras: vi.fn(),
  rememberDesignCamera: vi.fn(),
  readDesignCamera: vi.fn(),
  beginDesignHandover: vi.fn(),
  endDesignHandover: vi.fn(),
}));

import { useDesignStore } from "./design-store";

function summary(id: string): DesignSummary {
  return {
    id,
    name: `Design ${id}`,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    machineCount: 0,
    nodeCount: 0,
    order: 0,
  } as DesignSummary;
}

describe("opening the design library", () => {
  beforeEach(() => {
    useDesignStore.setState({
      designs: [],
      activeDesignId: undefined,
      isHydrated: false,
      error: undefined,
    });
    storage.listDesignSummaries.mockResolvedValue([summary("a"), summary("b")]);
    storage.readActiveDesignId.mockReturnValue("a");
  });

  it("still lists every tab when the remembered design cannot be opened", async () => {
    // Issue #45: a plan saved by an older version that trips a load-time
    // migration used to take the whole strip down with it - the player saw
    // every design gone, though nothing but that one plan was at fault.
    storage.readDesign.mockRejectedValue(new TypeError("Cannot read properties of undefined"));

    await useDesignStore.getState().hydrate();

    const state = useDesignStore.getState();
    expect(state.isHydrated).toBe(true);
    expect(state.designs.map((design) => design.id)).toEqual(["a", "b"]);
    expect(state.activeDesignId).toBeUndefined();
    expect(state.error).toContain("Cannot read");
  });

  it("never makes an unreadable design active over an empty canvas", async () => {
    // With the record active and nothing on the canvas, the next autosave
    // wrote the empty canvas over the plan. Listed, yes; active, never.
    storage.readDesign.mockResolvedValue(undefined);

    await useDesignStore.getState().hydrate();

    const state = useDesignStore.getState();
    expect(state.designs).toHaveLength(2);
    expect(state.activeDesignId).toBeUndefined();
    expect(storage.writeActiveDesignId).not.toHaveBeenCalledWith("a");
    expect(storage.writeDesign).not.toHaveBeenCalled();
  });
});
