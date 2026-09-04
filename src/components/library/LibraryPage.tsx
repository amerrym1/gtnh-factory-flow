"use client";

import {
  Download,
  Factory,
  Folder,
  FolderPlus,
  Globe,
  LayoutGrid,
  Link2,
  PanelsTopLeft,
  Plus,
  Search,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { FLUID_ICON_SCALE, ResourceIcon } from "@/components/nei/ResourceIcon";
import { BlueprintPanel } from "@/components/BlueprintPanel";
import { SetupsPanel } from "@/components/SetupsPanel";
import { useCommunityUser } from "@/components/community/auth";
import { listCommunityPlans } from "@/lib/community/client";
import { formatRelativeDate } from "@/components/shelf-cards";
import type { DesignFolder, DesignSummary } from "@/lib/designs/design-library";
import { openDesigns } from "@/lib/designs/design-library";
import type { EntryIcon } from "@/lib/model/types";
import { SETUPS_CHANGED_EVENT, requestShareDialog } from "@/lib/setups-tab";
import { setLibraryView, useLibraryTab, type LibraryView } from "@/lib/library/library-tab";
import { useDesignStore } from "@/store/design-store";

/**
 * The Shelf: all your designs, in folders, with the strip's open tabs as
 * one view of the same list.
 *
 * The rail on the left is the tree: Everything, Open, Shared, then the
 * folders and Unfiled. The right side is the designs as tiles, grouped by
 * folder under one title each when the whole shelf is showing, so
 * "Everything" reads as your folders in one scroll instead of a soup.
 *
 * Every tile is one design. Click opens it (onto the strip if it was
 * closed), right click or the dots is the menu, and a drag onto a rail
 * folder files it. Closing a tab never deletes; delete lives here, armed.
 *
 * SHARED is your posts on the network, the same list the Setups column used
 * to show under Mine, with the same owner tools. A design whose board has
 * moved on since it was last posted wears an amber ring on its globe, and
 * its menu offers "Update post": the design goes onto the canvas and the
 * ordinary share dialog opens on it, already pointed at the post.
 */

const DESIGN_DRAG_TYPE = "application/x-gtnh-design";
const MENU_WIDTH = 220;
/** The server's page cap; my posts are read a page at a time up to this. */
const POSTS_PAGE_SIZE = 48;
const POSTS_MAX_PAGES = 6;

type SortKey = "edited" | "name" | "created";

const SORTS: { value: SortKey; label: string }[] = [
  { value: "edited", label: "Last edited" },
  { value: "name", label: "Name" },
  { value: "created", label: "Newest" },
];

interface TileMenu {
  designId: string;
  left: number;
  top: number;
}

interface FolderMenu {
  folderId: string;
  left: number;
  top: number;
}

export function LibraryPage() {
  const shelf = useLibraryTab();
  const designs = useDesignStore((state) => state.designs);
  const folders = useDesignStore((state) => state.folders);
  const activeDesignId = useDesignStore((state) => state.activeDesignId);
  const switchToDesign = useDesignStore((state) => state.switchToDesign);
  const addDesign = useDesignStore((state) => state.addDesign);
  const copyDesign = useDesignStore((state) => state.copyDesign);
  const renameDesign = useDesignStore((state) => state.renameDesign);
  const closeDesign = useDesignStore((state) => state.closeDesign);
  const removeDesign = useDesignStore((state) => state.removeDesign);
  const moveDesignToFolder = useDesignStore((state) => state.moveDesignToFolder);
  const createFolder = useDesignStore((state) => state.createFolder);
  const renameFolder = useDesignStore((state) => state.renameFolder);
  const deleteFolder = useDesignStore((state) => state.deleteFolder);

  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("edited");
  const [tileMenu, setTileMenu] = useState<TileMenu>();
  const [folderMenu, setFolderMenu] = useState<FolderMenu>();
  const [armedDeleteId, setArmedDeleteId] = useState<string>();
  const [renamingId, setRenamingId] = useState<string>();
  const [renamingFolderId, setRenamingFolderId] = useState<string>();
  const [namingFolder, setNamingFolder] = useState(false);
  /** The rail entry a dragged tile is over, by view key. */
  const [dropKey, setDropKey] = useState<string>();
  const myPosts = useMyPostIds();

  const closeMenus = useCallback(() => {
    setTileMenu(undefined);
    setFolderMenu(undefined);
    setArmedDeleteId(undefined);
  }, []);

  // A view naming a folder that has since gone falls back to everything.
  useEffect(() => {
    if (
      shelf.view.kind === "folder" &&
      !folders.some((folder) => folder.id === (shelf.view as { folderId: string }).folderId)
    ) {
      setLibraryView({ kind: "all" });
    }
  }, [folders, shelf.view]);

  const search = query.trim().toLowerCase();
  const matches = useMemo(
    () => (search ? designs.filter((design) => design.name.toLowerCase().includes(search)) : designs),
    [designs, search],
  );
  const sorted = useMemo(() => sortForShelf(matches, sort), [matches, sort]);

  const counts = useMemo(() => {
    const perFolder = new Map<string, number>();
    let unfiled = 0;
    let shared = 0;
    for (const design of designs) {
      if (design.folderId) {
        perFolder.set(design.folderId, (perFolder.get(design.folderId) ?? 0) + 1);
      } else {
        unfiled += 1;
      }
      if (design.communityPlanId) {
        shared += 1;
      }
    }
    return { perFolder, unfiled, shared, open: openDesigns(designs).length };
  }, [designs]);

  const sections = useMemo(
    () => sectionsFor(shelf.view, sorted, folders),
    [shelf.view, sorted, folders],
  );

  const open = (id: string) => {
    void switchToDesign(id);
  };

  const updatePost = async (id: string) => {
    await switchToDesign(id);
    requestShareDialog();
  };

  const onRailDrop = (event: DragEvent, folderId: string | undefined) => {
    event.preventDefault();
    setDropKey(undefined);
    const id = event.dataTransfer.getData(DESIGN_DRAG_TYPE);
    if (id) {
      void moveDesignToFolder(id, folderId);
    }
  };

  const railDropProps = (key: string, folderId: string | undefined) => ({
    onDragOver: (event: DragEvent) => {
      if (event.dataTransfer.types.includes(DESIGN_DRAG_TYPE)) {
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        if (dropKey !== key) {
          setDropKey(key);
        }
      }
    },
    onDragLeave: () => setDropKey((current) => (current === key ? undefined : current)),
    onDrop: (event: DragEvent) => onRailDrop(event, folderId),
  });

  const menuDesign = tileMenu ? designs.find((design) => design.id === tileMenu.designId) : undefined;
  const menuFolder = folderMenu
    ? folders.find((folder) => folder.id === folderMenu.folderId)
    : undefined;

  const title = viewTitle(shelf.view, folders);

  const embedded = embeddedPanelFor(shelf.view);

  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-canvas text-fg">
      {/*
        ONE PAGE, not a second sidebar: one framed panel inset from the
        columns either side, with the rail INSIDE the frame so it reads as
        this page's tree rather than another column bolted onto the recipe
        book. No title: the tab strip already says where you are.
      */}
      <div className="min-h-0 flex-1 p-4 compact:p-2">
        <div className="flex h-full min-h-0 overflow-hidden rounded border border-line bg-[#12161b] compact:flex-col">
          {/* THE RAIL. On a phone it turns into one scrolling row of chips. */}
          <aside className="flex w-[210px] shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-line bg-surface/70 px-2 py-2 compact:w-full compact:flex-row compact:items-center compact:overflow-x-auto compact:overflow-y-hidden compact:border-b compact:border-r-0 compact:py-1.5">
            <RailGroup label="Mine" />
            <RailItem
              icon={LayoutGrid}
              label="Everything"
              count={designs.length}
              selected={shelf.view.kind === "all"}
              onClick={() => setLibraryView({ kind: "all" })}
            />
            <RailItem
              icon={PanelsTopLeft}
              label="Open tabs"
              count={counts.open}
              selected={shelf.view.kind === "open"}
              onClick={() => setLibraryView({ kind: "open" })}
            />
            <RailItem
              icon={Globe}
              label="Shared"
              count={counts.shared}
              selected={shelf.view.kind === "shared"}
              onClick={() => setLibraryView({ kind: "shared" })}
            />
            {folders.map((folder) => (
              <RailItem
                key={folder.id}
                icon={Folder}
                label={folder.name}
                count={counts.perFolder.get(folder.id) ?? 0}
                selected={shelf.view.kind === "folder" && shelf.view.folderId === folder.id}
                highlighted={dropKey === `folder:${folder.id}`}
                renaming={renamingFolderId === folder.id}
                onRename={(name) => {
                  setRenamingFolderId(undefined);
                  void renameFolder(folder.id, name);
                }}
                onCancelRename={() => setRenamingFolderId(undefined)}
                onClick={() => setLibraryView({ kind: "folder", folderId: folder.id })}
                onDoubleClick={() => setRenamingFolderId(folder.id)}
                onMenu={(left, top) => {
                  closeMenus();
                  setFolderMenu({ folderId: folder.id, left, top });
                }}
                {...railDropProps(`folder:${folder.id}`, folder.id)}
              />
            ))}
            {namingFolder ? (
              <div className="flex h-7 items-center gap-1.5 rounded px-2">
                <Folder className="h-3.5 w-3.5 shrink-0 text-fg-muted" aria-hidden />
                <InlineName
                  initialName=""
                  placeholder="Folder name"
                  onCommit={(name) => {
                    setNamingFolder(false);
                    if (name.trim()) {
                      void createFolder(name).then((folder) =>
                        setLibraryView({ kind: "folder", folderId: folder.id }),
                      );
                    }
                  }}
                  onCancel={() => setNamingFolder(false)}
                />
              </div>
            ) : null}
            {folders.length > 0 ? (
              <RailItem
                icon={Folder}
                label="Unfiled"
                count={counts.unfiled}
                muted
                selected={shelf.view.kind === "unfiled"}
                highlighted={dropKey === "unfiled"}
                onClick={() => setLibraryView({ kind: "unfiled" })}
                {...railDropProps("unfiled", undefined)}
              />
            ) : null}
            <button
              type="button"
              onClick={() => setNamingFolder(true)}
              className="flex h-7 shrink-0 items-center gap-1.5 rounded px-2 text-xs text-fg-muted hover:bg-surface-raised hover:text-fg"
            >
              <FolderPlus className="h-3.5 w-3.5" aria-hidden />
              <span className="text-xs">New folder</span>
            </button>

            <RailGroup label="Network" />
            <RailItem
              icon={Factory}
              label="Public setups"
              selected={shelf.view.kind === "public"}
              onClick={() => setLibraryView({ kind: "public" })}
            />

            <RailGroup label="Boards" />
            <RailItem
              chip="✦"
              label="My boards"
              selected={shelf.view.kind === "boards"}
              onClick={() => setLibraryView({ kind: "boards" })}
            />
            <RailItem
              chip="✦"
              label="Public boards"
              selected={shelf.view.kind === "public-boards"}
              onClick={() => setLibraryView({ kind: "public-boards" })}
            />
          </aside>

          {/* THE CONTENT. */}
          <section className="flex min-h-0 min-w-0 flex-1 flex-col">
            {embedded ? (
              <div className="flex min-h-0 flex-1 flex-col">
                <header className="flex h-10 shrink-0 items-center gap-3 border-b border-line px-4">
                  <h2 className="text-[12px] font-black uppercase tracking-[0.12em] text-fg">
                    {title}
                  </h2>
                  <span className="truncate text-[11px] text-fg-muted">{embedded.note}</span>
                </header>
                {/* The list panels keep their own search, tags and sort. */}
                <div className="flex min-h-0 flex-1 flex-col">{embedded.panel}</div>
              </div>
            ) : (
              <>
                <header className="flex h-10 shrink-0 items-center gap-2 border-b border-line px-4 compact:gap-1.5 compact:px-2">
                  <h2 className="mr-2 shrink-0 text-[12px] font-black uppercase tracking-[0.12em] text-fg compact:hidden">
                    {title}
                  </h2>
                  <label className="flex h-7 min-w-0 flex-1 items-center gap-1.5 rounded border border-line-strong bg-surface px-2 text-xs text-fg sm:max-w-[320px]">
                    <Search className="h-3.5 w-3.5 shrink-0 text-fg-muted" aria-hidden />
                    <input
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      placeholder="Search your designs"
                      aria-label="Search your designs"
                      className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-fg-muted"
                    />
                    {query ? (
                      <button
                        type="button"
                        onClick={() => setQuery("")}
                        aria-label="Clear search"
                        className="text-fg-muted hover:text-fg"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    ) : null}
                  </label>
                  <select
                    value={sort}
                    onChange={(event) => setSort(event.target.value as SortKey)}
                    aria-label="Sort designs"
                    className="h-7 shrink-0 rounded border border-line-strong bg-surface px-1 text-xs text-fg outline-none"
                  >
                    {SORTS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => void addDesign()}
                    aria-label="New design"
                    className="ml-auto flex h-7 shrink-0 items-center gap-1 rounded border border-cyan-500/60 bg-cyan-500/15 px-2.5 text-xs font-bold text-cyan-200 hover:bg-cyan-500/25"
                  >
                    <Plus className="h-3.5 w-3.5" aria-hidden />
                    {/* A phone keeps the search box; the word goes. */}
                    <span className="compact:hidden">New design</span>
                  </button>
                </header>

                <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 compact:px-2">
                  {sections.length === 0 ? (
                    <EmptyNote>
                      {search
                        ? "No designs match."
                        : shelf.view.kind === "open"
                          ? "No design is open. Click one in the library to open it."
                          : "Nothing here yet. Press New design, or drag a design onto a folder to file it."}
                    </EmptyNote>
                  ) : (
                    <div className="flex flex-col gap-5">
                      {sections.map((section) => (
                        <div key={section.key} className="flex flex-col gap-2">
                          {section.title ? (
                            <h3 className="flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.14em] text-[#aebccd]">
                              {section.folderId ? (
                                <Folder className="h-3.5 w-3.5 text-fg-muted" aria-hidden />
                              ) : null}
                              {section.title}
                              <span className="font-medium text-fg-muted">
                                {section.designs.length}
                              </span>
                            </h3>
                          ) : null}
                          <div className="grid grid-cols-[repeat(auto-fill,minmax(210px,1fr))] gap-2">
                            {section.designs.map((design) => (
                              <DesignTile
                                key={design.id}
                                design={design}
                                isActive={design.id === activeDesignId}
                                post={postMark(design, myPosts)}
                                renaming={renamingId === design.id}
                                menuOpen={tileMenu?.designId === design.id}
                                onOpen={() => open(design.id)}
                                onRename={(name) => {
                                  setRenamingId(undefined);
                                  void renameDesign(design.id, name);
                                }}
                                onCancelRename={() => setRenamingId(undefined)}
                                onMenu={(left, top) => {
                                  closeMenus();
                                  setTileMenu({ designId: design.id, left, top });
                                }}
                              />
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}
          </section>
        </div>
      </div>


      {tileMenu && menuDesign ? (
        <ShelfMenu
          left={tileMenu.left}
          top={tileMenu.top}
          label={`Options for ${menuDesign.name}`}
          onClose={closeMenus}
        >
          <MenuItem label="Open" onClick={() => {
              closeMenus();
              open(menuDesign.id);
            }} />
          {!menuDesign.closed ? (
            <MenuItem
              label="Close tab"
              onClick={() => {
              closeMenus();
              void closeDesign(menuDesign.id);
            }}
            />
          ) : null}
          <MenuItem
            label="Rename"
            onClick={() => {
              closeMenus();
              setRenamingId(menuDesign.id);
            }}
          />
          <MenuItem
            label="Duplicate"
            onClick={() => {
              closeMenus();
              void copyDesign(menuDesign.id);
            }}
          />
          {menuDesign.communityBehind && postMark(menuDesign, myPosts) !== "theirs" ? (
            <MenuItem
              label="Update post"
              onClick={() => {
              closeMenus();
              void updatePost(menuDesign.id);
            }}
            />
          ) : null}
          {folders.length > 0 ? (
            <>
              <MenuHeading>Move to</MenuHeading>
              {folders.map((folder) => (
                <MenuItem
                  key={folder.id}
                  label={folder.name}
                  indent
                  checked={menuDesign.folderId === folder.id}
                  onClick={() => {
              closeMenus();
              void moveDesignToFolder(menuDesign.id, folder.id);
            }}
                />
              ))}
              <MenuItem
                label="No folder"
                indent
                checked={!menuDesign.folderId}
                onClick={() => {
              closeMenus();
              void moveDesignToFolder(menuDesign.id, undefined);
            }}
              />
            </>
          ) : null}
          <MenuItem
            label={
              armedDeleteId === menuDesign.id
                ? menuDesign.communityPlanId
                  ? "Confirm delete (the post stays up)"
                  : "Confirm delete"
                : "Delete"
            }
            tone="danger"
            onClick={() => {
              if (armedDeleteId === menuDesign.id) {
                closeMenus();
                void removeDesign(menuDesign.id);
              } else {
                setArmedDeleteId(menuDesign.id);
              }
            }}
          />
        </ShelfMenu>
      ) : null}

      {folderMenu && menuFolder ? (
        <ShelfMenu
          left={folderMenu.left}
          top={folderMenu.top}
          label={`Options for folder ${menuFolder.name}`}
          onClose={closeMenus}
        >
          <MenuItem
            label="Rename"
            onClick={() => {
              closeMenus();
              setRenamingFolderId(menuFolder.id);
            }}
          />
          <MenuItem
            label={
              armedDeleteId === menuFolder.id
                ? "Confirm delete (designs stay, unfiled)"
                : "Delete folder"
            }
            tone="danger"
            onClick={() => {
              if (armedDeleteId === menuFolder.id) {
                closeMenus();
                void deleteFolder(menuFolder.id);
              } else {
                setArmedDeleteId(menuFolder.id);
              }
            }}
          />
        </ShelfMenu>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */

interface Section {
  key: string;
  title?: string;
  folderId?: string;
  designs: DesignSummary[];
}

function sectionsFor(view: LibraryView, designs: DesignSummary[], folders: DesignFolder[]): Section[] {
  switch (view.kind) {
    case "open": {
      const open = openDesigns(designs);
      return open.length > 0 ? [{ key: "open", designs: open }] : [];
    }
    case "unfiled": {
      const unfiled = designs.filter((design) => !design.folderId);
      return unfiled.length > 0 ? [{ key: "unfiled", designs: unfiled }] : [];
    }
    case "folder": {
      const inside = designs.filter((design) => design.folderId === view.folderId);
      return inside.length > 0 ? [{ key: view.folderId, designs: inside }] : [];
    }
    case "shared":
    case "public":
    case "boards":
    case "public-boards":
      // Embedded lists draw themselves.
      return [];
    case "all": {
      const sections: Section[] = [];
      for (const folder of folders) {
        const inside = designs.filter((design) => design.folderId === folder.id);
        if (inside.length > 0) {
          sections.push({ key: folder.id, title: folder.name, folderId: folder.id, designs: inside });
        }
      }
      const unfiled = designs.filter(
        (design) => !design.folderId || !folders.some((folder) => folder.id === design.folderId),
      );
      if (unfiled.length > 0) {
        // The title only earns its place once there is something to tell
        // it apart from.
        sections.push({
          key: "unfiled",
          title: folders.length > 0 ? "Unfiled" : undefined,
          designs: unfiled,
        });
      }
      return sections;
    }
  }
}

function sortForShelf(designs: DesignSummary[], sort: SortKey): DesignSummary[] {
  const sorted = [...designs];
  switch (sort) {
    case "name":
      sorted.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
      break;
    case "created":
      sorted.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      break;
    case "edited":
    default:
      sorted.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  return sorted;
}

function viewTitle(view: LibraryView, folders: DesignFolder[]): string {
  switch (view.kind) {
    case "all":
      return "Everything";
    case "open":
      return "Open tabs";
    case "shared":
      return "Shared";
    case "public":
      return "Public setups";
    case "boards":
      return "My boards";
    case "public-boards":
      return "Public boards";
    case "unfiled":
      return "Unfiled";
    case "folder":
      return folders.find((folder) => folder.id === view.folderId)?.name ?? "Folder";
  }
}

/**
 * Whose post a design is linked to. Known only while signed in: the
 * network says which posts are yours. Signed out, a link is just a link.
 */
type PostMark = "mine" | "theirs" | "linked" | undefined;

function postMark(design: DesignSummary, myPosts: Set<string> | undefined): PostMark {
  if (!design.communityPlanId) {
    return undefined;
  }
  if (!myPosts) {
    return "linked";
  }
  return myPosts.has(design.communityPlanId) ? "mine" : "theirs";
}

/**
 * The ids of the signed-in account's posts, or undefined while signed out
 * or still loading. Read once per sign-in and again whenever a share lands.
 */
function useMyPostIds(): Set<string> | undefined {
  const { user } = useCommunityUser();
  const username = user?.username;
  // Keyed by who was signed in when they were read, so signing out (or in
  // as someone else) drops them without a reset of its own.
  const [loaded, setLoaded] = useState<{ username: string; ids: Set<string> }>();
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const refresh = () => setTick((value) => value + 1);
    window.addEventListener(SETUPS_CHANGED_EVENT, refresh);
    return () => window.removeEventListener(SETUPS_CHANGED_EVENT, refresh);
  }, []);

  useEffect(() => {
    if (!username) {
      return;
    }
    let cancelled = false;
    (async () => {
      const found = new Set<string>();
      for (let page = 1; page <= POSTS_MAX_PAGES; page += 1) {
        const response = await listCommunityPlans({
          mine: true,
          sort: "new",
          page,
          pageSize: POSTS_PAGE_SIZE,
        });
        for (const plan of response.plans) {
          found.add(plan.id);
        }
        if (response.plans.length < POSTS_PAGE_SIZE || found.size >= response.total) {
          break;
        }
      }
      if (!cancelled) {
        setLoaded({ username, ids: found });
      }
    })().catch(() => {
      // The marks fall back to "linked"; nothing else depends on this.
    });
    return () => {
      cancelled = true;
    };
  }, [username, tick]);

  return loaded && loaded.username === username ? loaded.ids : undefined;
}

/* ------------------------------------------------------------------ */

/** A group heading in the rail. Hidden on a phone, where the rail is a row. */
function RailGroup({ label }: { label: string }) {
  return (
    <div className="mx-1 mt-3 mb-1 text-[10px] font-black uppercase tracking-[0.14em] text-fg-muted first:mt-1 compact:hidden">
      {label}
    </div>
  );
}

/**
 * The views that are LISTS FROM ELSEWHERE, embedded whole: the network's
 * setups and the board shelves keep their own search, tags and sort, so the
 * library's own header steps aside for them.
 */
function embeddedPanelFor(view: LibraryView): { panel: ReactNode; note: string } | undefined {
  switch (view.kind) {
    case "shared":
      return {
        panel: <SetupsPanel scope="mine" />,
        note: "Your posts on the network. Open one to work on it.",
      };
    case "public":
      return {
        panel: <SetupsPanel scope="network" />,
        note: "Everyone's shared factories. Open one as a tab, or load it as a board.",
      };
    case "boards":
      return {
        panel: <BlueprintPanel scope="mine" />,
        note: "Boards you saved. Place one and it lands on the open design.",
      };
    case "public-boards":
      return {
        panel: <BlueprintPanel scope="public" />,
        note: "Boards other people shared. Place one and it lands on the open design.",
      };
    default:
      return undefined;
  }
}

function RailItem({
  icon: Icon,
  chip,
  label,
  count,
  selected,
  highlighted,
  muted,
  renaming,
  onRename,
  onCancelRename,
  onClick,
  onDoubleClick,
  onMenu,
  onDragOver,
  onDragLeave,
  onDrop,
}: {
  icon?: typeof Folder;
  /** A glyph instead of an icon: the board star. */
  chip?: string;
  label: string;
  count?: number;
  selected: boolean;
  highlighted?: boolean;
  muted?: boolean;
  renaming?: boolean;
  onRename?: (name: string) => void;
  onCancelRename?: () => void;
  onClick: () => void;
  onDoubleClick?: () => void;
  onMenu?: (left: number, top: number) => void;
  onDragOver?: (event: DragEvent) => void;
  onDragLeave?: () => void;
  onDrop?: (event: DragEvent) => void;
}) {
  return (
    <div
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onContextMenu={
        onMenu
          ? (event) => {
              event.preventDefault();
              onMenu(event.clientX, event.clientY);
            }
          : undefined
      }
      className={[
        "group flex h-7 shrink-0 items-center gap-1.5 rounded px-2 text-xs compact:h-8",
        selected
          ? "bg-cyan-500/15 text-cyan-200"
          : muted
            ? "text-fg-muted hover:bg-surface-raised hover:text-fg"
            : "text-fg-subtle hover:bg-surface-raised hover:text-fg",
        highlighted ? "outline outline-2 outline-cyan-400" : "",
      ].join(" ")}
    >
      {Icon ? (
        <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
      ) : (
        <span aria-hidden className="w-3.5 shrink-0 text-center text-[12px] leading-none">
          {chip}
        </span>
      )}
      {renaming && onRename && onCancelRename ? (
        <InlineName initialName={label} onCommit={onRename} onCancel={onCancelRename} />
      ) : (
        <button
          type="button"
          onClick={onClick}
          onDoubleClick={onDoubleClick}
          title={label}
          className="min-w-0 flex-1 truncate text-left font-medium"
        >
          {label}
        </button>
      )}
      {count !== undefined ? (
        <span className="shrink-0 tabular-nums text-[11px] text-fg-muted">{count}</span>
      ) : null}
      {onMenu ? (
        <button
          type="button"
          aria-label={`Options for folder ${label}`}
          onClick={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            onMenu(rect.left, rect.bottom + 4);
          }}
          className="-mr-1 shrink-0 rounded px-1 text-fg-muted opacity-0 hover:bg-surface hover:text-fg focus:opacity-100 group-hover:opacity-100"
        >
          ⋯
        </button>
      ) : null}
    </div>
  );
}

function DesignTile({
  design,
  isActive,
  post,
  renaming,
  menuOpen,
  onOpen,
  onRename,
  onCancelRename,
  onMenu,
}: {
  design: DesignSummary;
  isActive: boolean;
  post: PostMark;
  renaming: boolean;
  menuOpen: boolean;
  onOpen: () => void;
  onRename: (name: string) => void;
  onCancelRename: () => void;
  onMenu: (left: number, top: number) => void;
}) {
  const isOpen = !design.closed;
  return (
    <div
      draggable={!renaming}
      onDragStart={(event) => {
        event.dataTransfer.setData(DESIGN_DRAG_TYPE, design.id);
        event.dataTransfer.effectAllowed = "move";
      }}
      role="button"
      tabIndex={0}
      onClick={(event) => {
        if (renaming || (event.target as HTMLElement).closest("button, input")) {
          return;
        }
        onOpen();
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" && !renaming) {
          onOpen();
        }
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        onMenu(event.clientX, event.clientY);
      }}
      title={design.name}
      className={[
        "group relative flex cursor-pointer select-none items-center gap-2.5 rounded border px-2 py-1.5 text-left",
        isActive
          ? "border-cyan-500/70 bg-[#182029]"
          : "border-line bg-[#151a21] hover:border-line-strong hover:bg-[#182029]",
        menuOpen ? "border-line-strong" : "",
      ].join(" ")}
    >
      <Face icon={design.icon} size={44} />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        {renaming ? (
          <InlineName initialName={design.name} onCommit={onRename} onCancel={onCancelRename} />
        ) : (
          <span className="line-clamp-2 text-[12px] font-bold leading-tight text-fg group-hover:text-white">
            {design.name}
          </span>
        )}
        <span className="flex items-center gap-1.5 text-[10px] text-fg-muted">
          <span className="truncate">{formatRelativeDate(design.updatedAt)}</span>
          {isOpen ? (
            <span
              title={isActive ? "On the board now" : "Open on the tab strip"}
              className={[
                "rounded px-1 font-black uppercase tracking-wide",
                isActive ? "bg-cyan-500/25 text-cyan-200" : "bg-surface-raised text-fg-subtle",
              ].join(" ")}
            >
              open
            </span>
          ) : null}
          <PostGlyph post={post} behind={Boolean(design.communityBehind)} />
        </span>
      </div>
      <button
        type="button"
        aria-label={`Options for ${design.name}`}
        aria-expanded={menuOpen}
        onClick={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          onMenu(Math.min(rect.left, window.innerWidth - MENU_WIDTH - 8), rect.bottom + 4);
        }}
        className="absolute right-1 top-1 rounded px-1 text-xs text-fg-muted opacity-0 hover:bg-surface-raised hover:text-fg focus:opacity-100 group-hover:opacity-100 aria-expanded:opacity-100"
      >
        ⋯
      </button>
    </div>
  );
}

/**
 * The post mark: a globe for your own post, a download arrow for one you
 * opened from someone else, a link when the network has not said whose.
 * Amber ring: the board has been edited since the post last matched it.
 */
function PostGlyph({ post, behind }: { post: PostMark; behind: boolean }) {
  if (!post) {
    return null;
  }
  const Icon = post === "mine" ? Globe : post === "theirs" ? Download : Link2;
  const title =
    post === "theirs"
      ? "Opened from a shared setup"
      : behind
        ? "Posted. Edited since: use Update post to refresh it."
        : post === "mine"
          ? "Posted on the network"
          : "Linked to a post on the network";
  return (
    <span
      title={title}
      className={[
        "relative inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center",
        post === "mine" ? "text-emerald-400" : "text-fg-muted",
      ].join(" ")}
    >
      <Icon className="h-3 w-3" aria-hidden />
      {behind && post !== "theirs" ? (
        <span
          aria-hidden
          className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-amber-400 ring-2 ring-[#151a21]"
        />
      ) : null}
      <span className="sr-only">{title}</span>
    </span>
  );
}

/** A saved face, drawn oversized so the art fills the box the way tabs do. */
function Face({ icon, size }: { icon: EntryIcon | undefined; size: number }) {
  const drawable = Boolean(icon && (icon.iconPath || icon.iconAtlas || icon.kind === "fluid"));
  return (
    <span
      aria-hidden
      className="flex shrink-0 items-center justify-center overflow-hidden rounded bg-[#0f1318]"
      style={{ width: size, height: size }}
    >
      {drawable && icon ? (
        <ResourceIcon
          resource={{
            id: icon.resourceId,
            kind: icon.kind,
            amount: 1,
            displayName: icon.displayName,
            iconPath: icon.iconPath,
            iconAtlas: icon.iconAtlas,
            dominantColor: icon.dominantColor,
          }}
          bare
          tooltip={false}
          showAmount={false}
          iconPixelSize={
            icon.kind === "fluid" ? Math.round((size - 8) / FLUID_ICON_SCALE) : (size - 8) * 2
          }
          className="!h-full !w-full"
        />
      ) : (
        <LayoutGrid className="h-1/2 w-1/2 text-[#3d4a58]" />
      )}
    </span>
  );
}

function EmptyNote({ children }: { children: ReactNode }) {
  return <p className="px-0.5 pt-2 text-[12px] leading-relaxed text-fg-muted">{children}</p>;
}

function InlineName({
  initialName,
  placeholder,
  onCommit,
  onCancel,
}: {
  initialName: string;
  placeholder?: string;
  onCommit: (name: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initialName);
  // Committing on blur keeps a click elsewhere from silently discarding the
  // edit. Escape is the one way out without saving, and it must not also
  // commit on the blur it causes.
  const cancelledRef = useRef(false);
  return (
    <input
      autoFocus
      value={value}
      placeholder={placeholder}
      onChange={(event) => setValue(event.target.value)}
      onFocus={(event) => event.target.select()}
      onBlur={() => {
        if (!cancelledRef.current) {
          onCommit(value);
        }
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          onCommit(value);
        } else if (event.key === "Escape") {
          cancelledRef.current = true;
          onCancel();
        }
      }}
      onClick={(event) => event.stopPropagation()}
      aria-label="Name"
      className="min-w-0 w-full rounded border border-cyan-500 bg-surface px-1 text-xs text-fg outline-none"
    />
  );
}

/**
 * Rendered into `document.body` so no ancestor's `overflow` can clip it, and
 * positioned in viewport coordinates.
 */
function ShelfMenu({
  left,
  top,
  label,
  onClose,
  children,
}: {
  left: number;
  top: number;
  label: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        onClose();
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    document.addEventListener("pointerdown", closeOnOutsideClick, true);
    document.addEventListener("keydown", closeOnEscape);
    window.addEventListener("resize", onClose);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsideClick, true);
      document.removeEventListener("keydown", closeOnEscape);
      window.removeEventListener("resize", onClose);
    };
  }, [onClose]);

  if (typeof document === "undefined") {
    return null;
  }

  // Kept on screen: a right click near the bottom edge would otherwise put
  // half the menu below the fold.
  const clampedLeft = Math.min(left, window.innerWidth - MENU_WIDTH - 8);
  const clampedTop = Math.min(top, window.innerHeight - 320);

  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      aria-label={label}
      style={{ left: clampedLeft, top: Math.max(8, clampedTop), width: MENU_WIDTH }}
      className="fixed z-[100] max-h-[300px] overflow-y-auto rounded border border-line bg-surface-raised py-0.5 shadow-lg"
    >
      {children}
    </div>,
    document.body,
  );
}

function MenuHeading({ children }: { children: ReactNode }) {
  return (
    <div className="mt-1 border-t border-line px-2 pb-0.5 pt-1.5 text-[10px] font-black uppercase tracking-[0.12em] text-fg-muted">
      {children}
    </div>
  );
}

function MenuItem({
  label,
  onClick,
  tone = "default",
  indent,
  checked,
}: {
  label: string;
  onClick: () => void;
  tone?: "default" | "danger";
  indent?: boolean;
  checked?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={[
        "flex w-full items-center gap-1.5 whitespace-nowrap px-2 py-1.5 text-left text-xs hover:bg-surface-sunken",
        indent ? "pl-4" : "",
        tone === "danger" ? "text-red-400" : "text-fg",
      ].join(" ")}
    >
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {checked ? <span className="text-cyan-300">✓</span> : null}
    </button>
  );
}
