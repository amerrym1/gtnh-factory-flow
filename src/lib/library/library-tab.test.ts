import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The shelf across reloads: a reload while on it lands back on it, in the
 * same view; a new visit (fresh sessionStorage) starts off it.
 */

function makeStorage() {
  const entries = new Map<string, string>();
  return {
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => void entries.set(key, value),
    removeItem: (key: string) => void entries.delete(key),
  };
}

type Storage = ReturnType<typeof makeStorage>;

let local: Storage;
let session: Storage;

function visit(localStorage: Storage, sessionStorage: Storage) {
  (globalThis as { window?: unknown }).window = {
    localStorage,
    sessionStorage,
    location: { search: "" },
  };
  vi.resetModules();
  return import("./library-tab");
}

beforeEach(() => {
  local = makeStorage();
  session = makeStorage();
});

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

describe("shelf tab", () => {
  it("starts closed, on everything", async () => {
    const shelf = await visit(local, session);
    expect(shelf.readLibraryTabState()).toEqual({ active: false, view: { kind: "all" } });
  });

  it("comes back after a reload, in the same view", async () => {
    const first = await visit(local, session);
    first.openLibrary({ kind: "folder", folderId: "f1" });
    const reload = await visit(local, session);
    expect(reload.readLibraryTabState()).toEqual({
      active: true,
      view: { kind: "folder", folderId: "f1" },
    });
  });

  it("is off on a new visit", async () => {
    const first = await visit(local, session);
    first.openLibrary({ kind: "shared" });
    const later = await visit(local, makeStorage());
    expect(later.readLibraryTabState().active).toBe(false);
  });

  it("steps Welcome down when it opens", async () => {
    const shelf = await visit(local, session);
    const welcome = await import("@/lib/welcome/welcome-tab");
    welcome.openWelcomeTab();
    shelf.openLibrary();
    expect(welcome.readWelcomeTabState().active).toBe(false);
    expect(shelf.readLibraryTabState().active).toBe(true);
  });

  it("keeps the view when opened without one", async () => {
    const shelf = await visit(local, session);
    shelf.setLibraryView({ kind: "open" });
    shelf.openLibrary();
    expect(shelf.readLibraryTabState().view).toEqual({ kind: "open" });
    shelf.leaveLibrary();
    expect(shelf.readLibraryTabState()).toEqual({ active: false, view: { kind: "open" } });
  });
});
